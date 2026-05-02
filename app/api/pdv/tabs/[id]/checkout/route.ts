import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob } from '@/lib/printing';
import { notifyOrderEvent } from '@/lib/realtime';

type TabRow = {
  id: string;
  table_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
  status: 'open' | 'closed' | 'cancelled';
};

type TabItemRow = {
  product_id: string;
  quantity: number;
  unit_price: string;
  line_total: string;
  notes: string | null;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
  fee_percent: string;
  fee_fixed: string;
  settlement_days: number;
};

type PaymentSplitInput = {
  paymentMethodId: string;
  methodType: string;
  amount: number;
};

type ResolvedPaymentSplit = {
  method: PaymentMethodRow;
  amount: number;
  feeAmount: number;
  netAmount: number;
};

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function normalizePaymentMethod(value: string) {
  const method = value.trim().toLowerCase();
  if (!method) return 'pix';
  return method;
}

function clampDiscount(subtotal: number, discount: number) {
  if (!(subtotal > 0)) return 0;
  return Number(Math.min(subtotal, Math.max(0, discount)).toFixed(2));
}

function amountsMatch(a: number, b: number) {
  return Math.abs(a - b) <= 0.01;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const paymentMethod = normalizePaymentMethod(String(body.paymentMethod || 'pix'));
  const paymentMethodId = String(body.paymentMethodId || '').trim();
  const customerNameOverride = String(body.customerName || '').trim();
  const customerPhoneOverride = String(body.customerPhone || '').trim();
  const paymentSplits: Array<Record<string, unknown>> = Array.isArray(body.payments)
    ? (body.payments as Array<Record<string, unknown>>)
    : [];

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tabResult = await client.query<TabRow>(
      `SELECT
         id,
         table_number,
         customer_name,
         customer_phone,
         discount_amount::text,
         surcharge_amount::text,
         delivery_fee_amount::text,
         status
       FROM pdv_tabs
       WHERE id = $1
         AND tenant_id = $2
       FOR UPDATE`,
      [id, session.tenantId],
    );

    if (!tabResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda nao encontrada.' }, { status: 404 });
    }

    const tab = tabResult.rows[0];
    if (tab.status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda ja encerrada.' }, { status: 400 });
    }

    const itemsResult = await client.query<TabItemRow>(
      `SELECT product_id, quantity, unit_price::text, line_total::text, notes
       FROM pdv_tab_items
       WHERE tab_id = $1
         AND tenant_id = $2
       ORDER BY created_at ASC`,
      [id, session.tenantId],
    );

    if (!itemsResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda sem itens.' }, { status: 400 });
    }

    const subtotal = roundMoney(itemsResult.rows.reduce((sum, item) => sum + Number(item.line_total || 0), 0));
    const discount = clampDiscount(subtotal, Number(tab.discount_amount || 0));
    const surcharge = subtotal > 0 ? roundMoney(Number(tab.surcharge_amount || 0)) : 0;
    const deliveryFee = subtotal > 0 ? roundMoney(Number(tab.delivery_fee_amount || 0)) : 0;
    const total = roundMoney(subtotal - discount + surcharge + deliveryFee);
    if (!(total > 0)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Total invalido para fechamento.' }, { status: 400 });
    }

    const normalizedPaymentInputs: PaymentSplitInput[] = paymentSplits
      .map((entry) => ({
        paymentMethodId: String(entry?.paymentMethodId || '').trim(),
        methodType: normalizePaymentMethod(String(entry?.methodType || '')),
        amount: roundMoney(Number(entry?.amount || 0)),
      }))
      .filter((entry) => entry.amount > 0 && (entry.paymentMethodId || entry.methodType));

    const paymentInputs =
      normalizedPaymentInputs.length > 0
        ? normalizedPaymentInputs
        : [{ paymentMethodId, methodType: paymentMethod, amount: total }];

    const paymentSum = roundMoney(paymentInputs.reduce((sum, payment) => sum + payment.amount, 0));
    if (!amountsMatch(paymentSum, total)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'A soma das formas de pagamento deve ser igual ao total da venda.' }, { status: 400 });
    }

    const methodsById = new Map<string, PaymentMethodRow>();
    const methodIds = Array.from(new Set(paymentInputs.map((payment) => payment.paymentMethodId).filter(Boolean)));
    if (methodIds.length > 0) {
      const methodsResult = await client.query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
         FROM payment_methods
         WHERE tenant_id = $1
           AND active = TRUE
           AND id = ANY($2::text[])`,
        [session.tenantId, methodIds],
      );
      for (const method of methodsResult.rows) {
        methodsById.set(method.id, method);
      }
    }

    const methodsByType = new Map<string, PaymentMethodRow>();
    const missingTypes = Array.from(new Set(paymentInputs.map((payment) => payment.methodType).filter(Boolean)));
    for (const methodType of missingTypes) {
      const byType = await client.query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
         FROM payment_methods
         WHERE tenant_id = $1
           AND method_type = $2
           AND active = TRUE
         ORDER BY created_at ASC
         LIMIT 1`,
        [session.tenantId, methodType],
      );
      if (byType.rowCount) {
        methodsByType.set(methodType, byType.rows[0]);
      }
    }

    const resolvedPayments: ResolvedPaymentSplit[] = [];
    for (const payment of paymentInputs) {
      const method =
        (payment.paymentMethodId ? methodsById.get(payment.paymentMethodId) : null) || methodsByType.get(payment.methodType) || null;
      if (!method) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Forma de pagamento invalida ou inativa.' }, { status: 400 });
      }
      const feePercent = Number(method.fee_percent || 0);
      const feeFixed = Number(method.fee_fixed || 0);
      const feeAmount = roundMoney(payment.amount * (feePercent / 100) + feeFixed);
      const netAmount = roundMoney(payment.amount - feeAmount);
      if (netAmount < 0) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `Taxa maior que o valor na forma ${method.name}.` }, { status: 400 });
      }
      resolvedPayments.push({
        method,
        amount: payment.amount,
        feeAmount,
        netAmount,
      });
    }

    const totalFeeAmount = roundMoney(resolvedPayments.reduce((sum, payment) => sum + payment.feeAmount, 0));
    const totalNetAmount = roundMoney(total - totalFeeAmount);
    const orderId = randomUUID();
    const singlePayment = resolvedPayments.length === 1 ? resolvedPayments[0] : null;

    await client.query(
      `INSERT INTO orders
       (
         id,
         tenant_id,
         customer_name,
         customer_phone,
         payment_method,
         payment_method_id,
         payment_fee_amount,
         payment_net_amount,
         subtotal_amount,
         discount_amount,
         surcharge_amount,
         delivery_fee_amount,
         total,
         status,
         type,
         table_number,
         payment_status,
         updated_at
       )
       VALUES
       (
         $1, $2, NULLIF($3, ''), NULLIF($4, ''), $5, $6, $7, $8, $9, $10, $11, $12, $13, 'completed', 'table', $14, 'paid', NOW()
       )`,
      [
        orderId,
        session.tenantId,
        customerNameOverride || tab.customer_name || '',
        customerPhoneOverride || tab.customer_phone || '',
        singlePayment ? singlePayment.method.method_type : 'split',
        singlePayment ? singlePayment.method.id : null,
        totalFeeAmount,
        totalNetAmount,
        subtotal,
        discount,
        surcharge,
        deliveryFee,
        total,
        tab.table_number,
      ],
    );

    for (const payment of resolvedPayments) {
      await client.query(
        `INSERT INTO order_payments
         (id, tenant_id, order_id, payment_method_id, method_type, method_name, gross_amount, fee_amount, net_amount, settlement_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          session.tenantId,
          orderId,
          payment.method.id,
          payment.method.method_type,
          payment.method.name,
          payment.amount,
          payment.feeAmount,
          payment.netAmount,
          payment.method.settlement_days,
        ],
      );
    }

    for (const item of itemsResult.rows) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, notes)
         VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''))`,
        [
          randomUUID(),
          orderId,
          item.product_id,
          item.quantity,
          Number(item.unit_price || 0),
          item.notes || '',
        ],
      );
    }

    const openCashSession = await client.query<{ id: string }>(
      `SELECT id
       FROM cash_register_sessions
       WHERE tenant_id = $1 AND status = 'open'
       ORDER BY opened_at DESC
       LIMIT 1`,
      [session.tenantId],
    );
    const movementUser = await client.query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId],
    );
    const hasOpenCash = Boolean(openCashSession.rowCount);
    const movementUserId = movementUser.rowCount ? session.userId : null;

    for (const payment of resolvedPayments) {
      if (payment.method.settlement_days === 0) {
        if (hasOpenCash) {
          await client.query(
            `INSERT INTO cash_movements
             (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
             VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7)`,
            [
              randomUUID(),
              session.tenantId,
              openCashSession.rows[0].id,
              payment.netAmount,
              `Venda mesa ${tab.table_number} (${payment.method.name})`,
              orderId,
              movementUserId,
            ],
          );
        }
      } else {
        await client.query(
          `INSERT INTO receivables
           (id, tenant_id, order_id, payment_method_id, gross_amount, fee_amount, net_amount, due_date, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7, (NOW()::date + $8::int), 'pending')`,
          [
            randomUUID(),
            session.tenantId,
            orderId,
            payment.method.id,
            payment.amount,
            payment.feeAmount,
            payment.netAmount,
            payment.method.settlement_days,
          ],
        );
      }
    }

    await client.query(
      `UPDATE pdv_tabs
       SET
         customer_name = NULLIF($3, ''),
         customer_phone = NULLIF($4, ''),
         subtotal_amount = $5,
         discount_amount = $6,
         surcharge_amount = $7,
         delivery_fee_amount = $8,
         total_amount = $9,
         status = 'closed',
         closed_by_user_id = $10,
         order_id = $11,
         closed_at = NOW(),
         updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $2`,
      [
        id,
        session.tenantId,
        customerNameOverride || tab.customer_name || '',
        customerPhoneOverride || tab.customer_phone || '',
        subtotal,
        discount,
        surcharge,
        deliveryFee,
        total,
        session.userId,
        orderId,
      ],
    );

    await client.query('COMMIT');

    await Promise.allSettled([
      enqueueOrderPrintJob(session.tenantId, orderId, 'new_order'),
      notifyOrderEvent(session.tenantId, 'created', orderId),
    ]);

    return NextResponse.json({
      ok: true,
      orderId,
      total,
      tableNumber: tab.table_number,
      payments: resolvedPayments.map((payment) => ({
        paymentMethodId: payment.method.id,
        methodType: payment.method.method_type,
        methodName: payment.method.name,
        amount: payment.amount,
        feeAmount: payment.feeAmount,
        netAmount: payment.netAmount,
      })),
    });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao fechar comanda.' }, { status: 500 });
  } finally {
    client.release();
  }
}
