import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob } from '@/lib/printing';
import { notifyOrderEvent } from '@/lib/realtime';
import { enqueueOrderWhatsappJob } from '@/lib/whatsapp';
import { randomUUID } from 'node:crypto';

const allowedStatus = new Set(['pending', 'processing', 'delivering', 'completed', 'cancelled']);

type OrderFinanceRow = {
  id: string;
  total: string;
  payment_method: string | null;
  payment_method_id: string | null;
  payment_fee_amount: string | null;
  payment_net_amount: string | null;
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

function normalizePaymentMethodType(value: string | null) {
  const paymentMethod = String(value || '').trim().toLowerCase();
  if (paymentMethod === 'pix') return 'pix';
  if (paymentMethod === 'cash' || paymentMethod === 'money' || paymentMethod === 'dinheiro') return 'cash';
  if (paymentMethod === 'card' || paymentMethod === 'cartao' || paymentMethod === 'credito' || paymentMethod === 'debito') return 'card';
  if (paymentMethod === 'bank_slip' || paymentMethod === 'boleto') return 'bank_slip';
  if (paymentMethod === 'wallet' || paymentMethod === 'carteira') return 'wallet';
  if (paymentMethod === 'other') return 'other';
  return '';
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
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

    await client.query('BEGIN');

    const orderFinance = await client.query<OrderFinanceRow>(
      `SELECT id, total::text, payment_method, payment_method_id, payment_fee_amount::text, payment_net_amount::text
       FROM orders
       WHERE id = $1 AND tenant_id = $2
       LIMIT 1`,
      [id, session.tenantId],
    );
    if (!orderFinance.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    }

    const result = await client.query<{ id: string }>(
      `UPDATE orders
       SET status = $1,
           cancellation_reason = CASE WHEN $1 = 'cancelled' THEN NULLIF($4, '') ELSE NULL END,
           updated_at = NOW()
       WHERE id = $2 AND tenant_id = $3
       RETURNING id`,
      [status, id, session.tenantId, cancelReason],
    );

    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    }

    if (status === 'completed') {
      const currentOrder = orderFinance.rows[0];
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

      if (selectedMethod) {
        const total = Number(currentOrder.total || 0);
        const storedFeeAmount = Number(currentOrder.payment_fee_amount || 0);
        const storedNetAmount = Number(currentOrder.payment_net_amount || 0);
        const hasStoredFinance = currentOrder.payment_method_id === selectedMethod.id && storedNetAmount > 0;
        const feePercent = Number(selectedMethod.fee_percent || 0);
        const feeFixed = Number(selectedMethod.fee_fixed || 0);
        const feeAmount = hasStoredFinance ? storedFeeAmount : Number((total * (feePercent / 100) + feeFixed).toFixed(2));
        const netAmount = hasStoredFinance ? storedNetAmount : Number((total - feeAmount).toFixed(2));

        await client.query(
          `UPDATE orders
           SET payment_method = COALESCE(NULLIF(payment_method, ''), $3),
               payment_method_id = $4,
               payment_fee_amount = $5,
               payment_net_amount = $6
           WHERE id = $1 AND tenant_id = $2`,
          [id, session.tenantId, selectedMethod.name, selectedMethod.id, feeAmount, netAmount],
        );

        if (selectedMethod.settlement_days > 0) {
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

    const sideEffects: Array<Promise<unknown>> = [];
    if (shouldQueuePrint) {
      sideEffects.push(enqueueOrderPrintJob(session.tenantId, id, 'status_update'));
    }
    if (shouldQueueWhatsapp) {
      sideEffects.push(enqueueOrderWhatsappJob(session.tenantId, id, 'status_update'));
    }
    sideEffects.push(notifyOrderEvent(session.tenantId, orderEventKind, id));

    await Promise.allSettled(sideEffects);

    return NextResponse.json({ ok: true });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao atualizar pedido.' }, { status: 500 });
  } finally {
    client.release();
  }
}
