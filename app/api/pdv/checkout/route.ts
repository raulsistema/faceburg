import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob } from '@/lib/printing';
import { getOpenCashSession } from '@/lib/cash-register';
import { parseMoneyInput } from '@/lib/finance-utils';

type ProductPriceRow = {
  id: string;
  price: string;
  available: boolean;
};

type CheckoutItemInput = {
  productId: string;
  quantity: number;
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

function amountsMatch(a: number, b: number) {
  return Math.abs(a - b) <= 0.01;
}

function normalizeExtraAmount(value: unknown) {
  const parsed = parseMoneyInput(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return roundMoney(Math.max(0, parsed));
}

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const customerName = String(body.customerName || '').trim();
  const paymentMethod = normalizePaymentMethod(String(body.paymentMethod || 'pix'));
  const paymentMethodId = String(body.paymentMethodId || '').trim();
  const discountAmount = normalizeExtraAmount(body.discountAmount);
  const surchargeAmount = normalizeExtraAmount(body.surchargeAmount);
  const deliveryFeeAmount = normalizeExtraAmount(body.deliveryFeeAmount);
  const type = String(body.type || 'pickup').trim();
  const items = (body.items || []) as CheckoutItemInput[];
  const paymentSplits: Array<Record<string, unknown>> = Array.isArray(body.payments)
    ? (body.payments as Array<Record<string, unknown>>)
    : [];

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Carrinho vazio.' }, { status: 400 });
  }

  const normalizedItems = items
    .map((item) => ({
      productId: String(item.productId || '').trim(),
      quantity: Number(item.quantity || 0),
    }))
    .filter((item) => item.productId && item.quantity > 0);

  if (!normalizedItems.length) {
    return NextResponse.json({ error: 'Itens invalidos.' }, { status: 400 });
  }

  const productIds = normalizedItems.map((item) => item.productId);
  const productsResult = await query<ProductPriceRow>(
    `SELECT id, price::text, available
     FROM products
     WHERE tenant_id = $1
       AND id = ANY($2::text[])`,
    [session.tenantId, productIds],
  );

  const productMap = new Map(productsResult.rows.map((product) => [product.id, product]));

  let subtotal = 0;
  let resolvedItems: Array<{ productId: string; quantity: number; unitPrice: number }>;
  try {
    resolvedItems = normalizedItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product || !product.available) {
        throw new Error(`Produto invalido ou indisponivel: ${item.productId}`);
      }
      const unitPrice = Number(product.price);
      const lineTotal = unitPrice * item.quantity;
      subtotal += lineTotal;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
      };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Produto invalido.';
    return NextResponse.json({ error: message }, { status: 400 });
  }

  if (!(subtotal > 0)) {
    return NextResponse.json({ error: 'Subtotal invalido.' }, { status: 400 });
  }
  if (Number.isNaN(discountAmount)) {
    return NextResponse.json({ error: 'Desconto invalido.' }, { status: 400 });
  }
  if (discountAmount > subtotal) {
    return NextResponse.json({ error: 'Desconto maior que o subtotal.' }, { status: 400 });
  }
  if (Number.isNaN(surchargeAmount)) {
    return NextResponse.json({ error: 'Acrescimo invalido.' }, { status: 400 });
  }
  if (Number.isNaN(deliveryFeeAmount)) {
    return NextResponse.json({ error: 'Taxa de entrega invalida.' }, { status: 400 });
  }

  const total = roundMoney(subtotal - discountAmount + surchargeAmount + deliveryFeeAmount);
  if (!(total > 0)) {
    return NextResponse.json({ error: 'Total invalido.' }, { status: 400 });
  }

  const parsedPaymentInputs: PaymentSplitInput[] = paymentSplits
    .map((entry) => ({
      paymentMethodId: String(entry?.paymentMethodId || '').trim(),
      methodType: normalizePaymentMethod(String(entry?.methodType || '')),
      amount: normalizeExtraAmount(entry?.amount),
    }));
  if (parsedPaymentInputs.some((entry) => Number.isNaN(entry.amount))) {
    return NextResponse.json({ error: 'Valor de pagamento invalido.' }, { status: 400 });
  }

  const normalizedPaymentInputs = parsedPaymentInputs
    .filter((entry) => entry.amount > 0 && (entry.paymentMethodId || entry.methodType));

  const paymentInputs =
    normalizedPaymentInputs.length > 0
      ? normalizedPaymentInputs
      : [{ paymentMethodId, methodType: paymentMethod, amount: total }];

  const paymentSum = roundMoney(paymentInputs.reduce((sum, payment) => sum + payment.amount, 0));
  if (!amountsMatch(paymentSum, total)) {
    return NextResponse.json({ error: 'A soma das formas de pagamento deve ser igual ao total da venda.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

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
    const requiresCashSession = resolvedPayments.some((payment) => payment.method.settlement_days === 0);
    if (requiresCashSession) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cash-register:${session.tenantId}`]);
    }
    const openCashSession = requiresCashSession ? await getOpenCashSession(session.tenantId, client) : null;

    if (requiresCashSession && !openCashSession) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Nenhum caixa aberto. Abra o caixa no financeiro para concluir a venda.' }, { status: 409 });
    }

    await client.query(
      `INSERT INTO orders
       (
         id,
         tenant_id,
         customer_name,
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
         payment_status,
         cash_session_id,
         updated_at
       )
       VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, $9, $10, $11, $12, 'completed', $13, 'paid', $14, NOW())`,
      [
        orderId,
        session.tenantId,
        customerName,
        singlePayment ? singlePayment.method.method_type : 'split',
        singlePayment ? singlePayment.method.id : null,
        totalFeeAmount,
        totalNetAmount,
        subtotal,
        discountAmount,
        surchargeAmount,
        deliveryFeeAmount,
        total,
        type === 'delivery' ? 'delivery' : type === 'table' ? 'table' : 'pickup',
        openCashSession?.id || null,
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

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), orderId, item.productId, item.quantity, item.unitPrice],
      );
    }

    const movementUser = await client.query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId],
    );
    const movementUserId = movementUser.rowCount ? session.userId : null;

    for (const payment of resolvedPayments) {
      if (payment.method.settlement_days === 0) {
        await client.query(
          `INSERT INTO cash_movements
           (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
           VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7)`,
          [
            randomUUID(),
            session.tenantId,
            openCashSession!.id,
            payment.netAmount,
            `Venda PDV ${orderId.slice(0, 8)} (${payment.method.name})`,
            orderId,
            movementUserId,
          ],
        );
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

    await client.query('COMMIT');

    try {
      await enqueueOrderPrintJob(session.tenantId, orderId, 'new_order');
    } catch {
      // Nao bloqueia venda do PDV por falha de impressao.
    }

    return NextResponse.json({
      ok: true,
      orderId,
      total,
      itemsCount: resolvedItems.length,
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
    return NextResponse.json({ error: 'Falha ao finalizar venda.' }, { status: 500 });
  } finally {
    client.release();
  }
}
