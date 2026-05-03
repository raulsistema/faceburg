import { after, NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob } from '@/lib/printing';
import { notifyOrderEvent } from '@/lib/realtime';
import { enqueueOrderWhatsappJob } from '@/lib/whatsapp';
import { randomUUID } from 'node:crypto';

const allowedStatus = new Set(['pending', 'processing', 'delivering', 'completed', 'cancelled']);

type OrderFinanceRow = {
  id: string;
  status: string;
  type: string | null;
  total: string;
  payment_method: string | null;
  payment_method_id: string | null;
  payment_fee_amount: string | null;
  payment_net_amount: string | null;
  cash_session_id: string | null;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
  fee_percent: string;
  fee_fixed: string;
  settlement_days: number;
};

type ReceivableRow = {
  id: string;
};

type CashMovementRow = {
  id: string;
  session_id: string;
  session_status: string;
  amount: string;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizePaymentMethodType(value: string | null) {
  const paymentMethod = String(value || '').trim().toLowerCase();
  if (paymentMethod === 'pix') return 'pix';
  if (paymentMethod === 'cash' || paymentMethod === 'money' || paymentMethod === 'dinheiro') return 'cash';
  if (paymentMethod === 'card' || paymentMethod === 'cartao' || paymentMethod === 'cartão' || paymentMethod === 'credito' || paymentMethod === 'debito') return 'card';
  if (paymentMethod === 'bank_slip' || paymentMethod === 'boleto') return 'bank_slip';
  if (paymentMethod === 'wallet' || paymentMethod === 'carteira') return 'wallet';
  if (paymentMethod === 'other') return 'other';
  return '';
}

function canTransitionOrderStatus(currentStatus: string, nextStatus: string, orderType: string | null) {
  if (currentStatus === nextStatus) return true;
  if (currentStatus === 'cancelled') return false;
  if (currentStatus === 'completed') return nextStatus === 'cancelled';
  if (nextStatus === 'delivering' && orderType !== 'delivery') return false;
  if (currentStatus === 'pending') return nextStatus === 'processing' || nextStatus === 'cancelled';
  if (currentStatus === 'processing') return nextStatus === 'delivering' || nextStatus === 'completed' || nextStatus === 'cancelled';
  if (currentStatus === 'delivering') return nextStatus === 'completed' || nextStatus === 'cancelled';
  return false;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const status = String(body.status || '').trim();
  const cancelReason = String(body.cancelReason || '').trim();

  if (!allowedStatus.has(status)) {
    return NextResponse.json({ error: 'Status invalido.' }, { status: 400 });
  }
  if (status === 'cancelled' && cancelReason.length < 3) {
    return NextResponse.json({ error: 'Motivo do cancelamento e obrigatorio.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    let shouldQueuePrint = false;
    let shouldQueueWhatsapp = false;
    let orderEventKind: 'updated' | 'cancelled' = 'updated';
    let completionCashSessionId: string | null = null;

    await client.query('BEGIN');

    const orderFinance = await client.query<OrderFinanceRow>(
      `SELECT id, status, type, total::text, payment_method, payment_method_id, payment_fee_amount::text, payment_net_amount::text, cash_session_id
       FROM orders
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1
       FOR UPDATE`,
      [id, session.tenantId],
    );
    if (!orderFinance.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    }

    const currentOrder = orderFinance.rows[0];
    const wasAlreadyCompleted = currentOrder.status === 'completed';
    const wasCancelled = currentOrder.status === 'cancelled';

    if (!canTransitionOrderStatus(currentOrder.status, status, currentOrder.type)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Transicao de status invalida para este pedido.' }, { status: 409 });
    }

    if (status === 'completed' || (status === 'cancelled' && wasAlreadyCompleted)) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cash-register:${session.tenantId}`]);
    }

    const result = await client.query<{ id: string }>(
      `UPDATE orders
       SET status = $1,
           cancellation_reason = CASE WHEN $1 = 'cancelled' THEN NULLIF($4, '') ELSE NULL END,
           payment_status = CASE
             WHEN $1 = 'completed' THEN 'paid'
             WHEN $1 = 'cancelled' THEN 'cancelled'
             ELSE payment_status
           END,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [status, id, session.tenantId, cancelReason],
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    }

    if (status === 'completed' && wasCancelled) {
      await client.query(
        `DELETE FROM cash_movements
         WHERE tenant_id = $1
           AND reference_order_id = $2
           AND movement_type = 'refund'`,
        [session.tenantId, id],
      );

      await client.query(
        `UPDATE receivables
         SET status = 'pending',
             received_at = NULL
         WHERE tenant_id = $1
           AND order_id = $2
           AND status = 'cancelled'`,
        [session.tenantId, id],
      );
    }

    if (status === 'cancelled' && wasAlreadyCompleted) {
      const saleMovements = await client.query<CashMovementRow>(
        `SELECT cm.id, cm.session_id, crs.status AS session_status, cm.amount::text
         FROM cash_movements cm
         JOIN cash_register_sessions crs
           ON crs.id = cm.session_id
          AND crs.tenant_id = cm.tenant_id
         WHERE cm.tenant_id = $1
           AND cm.reference_order_id = $2
           AND cm.movement_type = 'sale'
         ORDER BY cm.created_at ASC`,
        [session.tenantId, id],
      );

      if (saleMovements.rowCount) {
        let openRefundSessionId: string | null = null;
        const movementUser = await client.query<{ id: string }>(
          `SELECT id
           FROM tenant_users
           WHERE id = $1 AND tenant_id = $2
           LIMIT 1`,
          [session.userId, session.tenantId],
        );
        const movementUserId = movementUser.rowCount ? session.userId : null;
        const orderLabel =
          currentOrder.type === 'delivery' ? 'Cancelamento pedido delivery' : currentOrder.type === 'table' ? 'Cancelamento pedido mesa' : 'Cancelamento pedido';

        for (const movement of saleMovements.rows) {
          let refundSessionId = movement.session_id;
          if (movement.session_status !== 'open') {
            if (!openRefundSessionId) {
              const openCashSession = await client.query<{ id: string }>(
                `SELECT id
                 FROM cash_register_sessions
                 WHERE tenant_id = $1
                   AND status = 'open'
                 ORDER BY opened_at DESC
                 LIMIT 1
                 FOR UPDATE`,
                [session.tenantId],
              );
              if (!openCashSession.rowCount) {
                await client.query('ROLLBACK');
                return NextResponse.json(
                  { error: 'Abra um caixa para registrar o estorno deste pedido finalizado em caixa ja fechado.' },
                  { status: 409 },
                );
              }
              openRefundSessionId = openCashSession.rows[0].id;
            }
            refundSessionId = openRefundSessionId;
          }

          await client.query(
            `INSERT INTO cash_movements
             (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
             VALUES ($1, $2, $3, 'refund', $4, $5, $6, $7)`,
            [
              randomUUID(),
              session.tenantId,
              refundSessionId,
              roundMoney(-Math.abs(Number(movement.amount || 0))),
              `${orderLabel} ${id.slice(0, 8)}`,
              id,
              movementUserId,
            ],
          );
        }
      }

      await client.query(
        `UPDATE receivables
         SET status = 'cancelled',
             received_at = NULL
         WHERE tenant_id = $1
           AND order_id = $2
           AND status <> 'cancelled'`,
        [session.tenantId, id],
      );
    }

    if (status === 'completed') {
      let selectedMethod: PaymentMethodRow | null = null;
      if (currentOrder.payment_method_id) {
        const byId = await client.query<PaymentMethodRow>(
          `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
           FROM payment_methods
           WHERE tenant_id = $1 AND id = $2
           LIMIT 1`,
          [session.tenantId, currentOrder.payment_method_id],
        );
        selectedMethod = byId.rows[0] || null;
      }
      if (!selectedMethod && currentOrder.payment_method) {
        const byName = await client.query<PaymentMethodRow>(
          `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
           FROM payment_methods
           WHERE tenant_id = $1 AND lower(name) = lower($2)
           ORDER BY active DESC, created_at ASC
           LIMIT 1`,
          [session.tenantId, currentOrder.payment_method],
        );
        selectedMethod = byName.rows[0] || null;
      }
      if (!selectedMethod) {
        const normalizedPaymentType = normalizePaymentMethodType(currentOrder.payment_method);
        if (normalizedPaymentType) {
          const byType = await client.query<PaymentMethodRow>(
            `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
             FROM payment_methods
             WHERE tenant_id = $1 AND method_type = $2 AND active = TRUE
             ORDER BY created_at ASC
             LIMIT 1`,
            [session.tenantId, normalizedPaymentType],
          );
          selectedMethod = byType.rows[0] || null;
        }
      }

      if (!selectedMethod) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Forma de pagamento do pedido nao esta configurada no financeiro.' }, { status: 409 });
      }

      if (selectedMethod) {
        const total = Number(currentOrder.total || 0);
        const storedFeeAmount = Number(currentOrder.payment_fee_amount || 0);
        const storedNetAmount = Number(currentOrder.payment_net_amount || 0);
        const hasStoredFinance = currentOrder.payment_method_id === selectedMethod.id && storedNetAmount > 0;
        const requiresCashSession = selectedMethod.settlement_days === 0 && !wasAlreadyCompleted;

        if (requiresCashSession) {
          const openCashSession = await client.query<{ id: string }>(
            `SELECT id
             FROM cash_register_sessions
             WHERE tenant_id = $1
               AND status = 'open'
             ORDER BY opened_at DESC
             LIMIT 1
             FOR UPDATE`,
            [session.tenantId],
          );
          if (!openCashSession.rowCount) {
            await client.query('ROLLBACK');
            return NextResponse.json({ error: 'Nenhum caixa aberto. Abra o caixa no financeiro para concluir o pedido.' }, { status: 409 });
          }
          completionCashSessionId = openCashSession.rows[0].id;
        }

        const feePercent = Number(selectedMethod.fee_percent || 0);
        const feeFixed = Number(selectedMethod.fee_fixed || 0);
        const feeAmount = hasStoredFinance ? storedFeeAmount : Number((total * (feePercent / 100) + feeFixed).toFixed(2));
        const netAmount = hasStoredFinance ? storedNetAmount : Number((total - feeAmount).toFixed(2));

        if (netAmount < 0) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'A taxa configurada para essa forma excede o valor do pedido.' }, { status: 400 });
        }

        await client.query(
          `UPDATE orders
           SET payment_method = COALESCE(NULLIF(payment_method, ''), $3),
               payment_method_id = $4,
               payment_fee_amount = $5,
               payment_net_amount = $6,
               cash_session_id = COALESCE($7::text, cash_session_id)
           WHERE id = $1 AND tenant_id = $2`,
          [id, session.tenantId, selectedMethod.name, selectedMethod.id, feeAmount, netAmount, completionCashSessionId],
        );

        if (selectedMethod.settlement_days === 0) {
          await client.query(
            `DELETE FROM receivables
             WHERE tenant_id = $1 AND order_id = $2`,
            [session.tenantId, id],
          );

          if (!wasAlreadyCompleted && completionCashSessionId) {
            const existingCashMovement = await client.query<{ id: string }>(
              `SELECT id
               FROM cash_movements
               WHERE tenant_id = $1
                 AND reference_order_id = $2
                 AND movement_type = 'sale'
               LIMIT 1`,
              [session.tenantId, id],
            );

            if (!existingCashMovement.rowCount) {
              const movementUser = await client.query<{ id: string }>(
                `SELECT id
                 FROM tenant_users
                 WHERE id = $1 AND tenant_id = $2
                 LIMIT 1`,
                [session.userId, session.tenantId],
              );
              const movementUserId = movementUser.rowCount ? session.userId : null;
              const orderLabel = currentOrder.type === 'delivery' ? 'Pedido delivery' : currentOrder.type === 'table' ? 'Pedido mesa' : 'Pedido';

              await client.query(
                `INSERT INTO cash_movements
                 (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
                 VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7)`,
                [
                  randomUUID(),
                  session.tenantId,
                  completionCashSessionId,
                  netAmount,
                  `${orderLabel} ${id.slice(0, 8)} (${selectedMethod.name})`,
                  id,
                  movementUserId,
                ],
              );
            }
          }
        } else {
          const receivable = await client.query<ReceivableRow>(
            `SELECT id
             FROM receivables
             WHERE tenant_id = $1 AND order_id = $2
             LIMIT 1`,
            [session.tenantId, id],
          );
          if (receivable.rowCount) {
            await client.query(
              `UPDATE receivables
               SET payment_method_id = $3,
                   gross_amount = $4,
                   fee_amount = $5,
                   net_amount = $6,
                   due_date = (NOW()::date + $7::int),
                   status = 'pending'
               WHERE id = $1 AND tenant_id = $2`,
              [receivable.rows[0].id, session.tenantId, selectedMethod.id, total, feeAmount, netAmount, selectedMethod.settlement_days],
            );
          } else {
            await client.query(
              `INSERT INTO receivables
               (id, tenant_id, order_id, payment_method_id, gross_amount, fee_amount, net_amount, due_date, status)
               VALUES ($1, $2, $3, $4, $5, $6, $7, (NOW()::date + $8::int), 'pending')`,
              [randomUUID(), session.tenantId, id, selectedMethod.id, total, feeAmount, netAmount, selectedMethod.settlement_days],
            );
          }
        }
      }
    }

    shouldQueuePrint = status === 'processing' || status === 'delivering' || status === 'completed' || status === 'cancelled';
    shouldQueueWhatsapp = status === 'delivering';
    orderEventKind = status === 'cancelled' ? 'cancelled' : 'updated';

    await client.query('COMMIT');

    const tenantId = session.tenantId;
    const orderId = id;
    const eventKind = orderEventKind;
    const queuePrint = shouldQueuePrint;
    const queueWhatsapp = shouldQueueWhatsapp;

    after(() => {
      const sideEffects: Array<Promise<unknown>> = [];
      if (queuePrint) {
        sideEffects.push(enqueueOrderPrintJob(tenantId, orderId, 'status_update'));
      }
      if (queueWhatsapp) {
        sideEffects.push(enqueueOrderWhatsappJob(tenantId, orderId, 'status_update'));
      }
      sideEffects.push(notifyOrderEvent(tenantId, eventKind, orderId));
      return Promise.allSettled(sideEffects).then(() => undefined);
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/orders/[id]/status failed', error);
    return NextResponse.json({ error: 'Falha ao atualizar pedido.' }, { status: 500 });
  } finally {
    client.release();
  }
}
