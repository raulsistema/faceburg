import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob } from '@/lib/printing';

type ProductPriceRow = {
  id: string;
  name: string;
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

export async function POST(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const customerName = String(body.customerName || '').trim();
  const paymentMethod = String(body.paymentMethod || 'pix').trim();
  const paymentMethodId = String(body.paymentMethodId || '').trim();
  const discountAmountRaw = Number(body.discountAmount || 0);
  const discountAmount = Number.isFinite(discountAmountRaw) ? Math.max(0, discountAmountRaw) : 0;
  const type = String(body.type || 'pickup').trim();
  const items = (body.items || []) as CheckoutItemInput[];

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
    `SELECT id, name, price::text, available
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
  if (discountAmount > subtotal) {
    return NextResponse.json({ error: 'Desconto maior que o subtotal.' }, { status: 400 });
  }

  const total = Number((subtotal - discountAmount).toFixed(2));
  if (!(total > 0)) {
    return NextResponse.json({ error: 'Total invalido.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderId = randomUUID();
    let selectedMethod: PaymentMethodRow | null = null;
    if (paymentMethodId) {
      const byId = await client.query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
         FROM payment_methods
         WHERE tenant_id = $1 AND id = $2 AND active = TRUE
         LIMIT 1`,
        [session.tenantId, paymentMethodId],
      );
      selectedMethod = byId.rows[0] || null;
    }
    if (!selectedMethod) {
      const byType = await client.query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
         FROM payment_methods
         WHERE tenant_id = $1 AND method_type = $2 AND active = TRUE
         ORDER BY created_at ASC
         LIMIT 1`,
        [session.tenantId, paymentMethod],
      );
      selectedMethod = byType.rows[0] || null;
    }

    const feePercent = Number(selectedMethod?.fee_percent || 0);
    const feeFixed = Number(selectedMethod?.fee_fixed || 0);
    const feeAmount = Number((total * (feePercent / 100) + feeFixed).toFixed(2));
    const netAmount = Number((total - feeAmount).toFixed(2));

    await client.query(
      `INSERT INTO orders
       (id, tenant_id, customer_name, payment_method, payment_method_id, payment_fee_amount, payment_net_amount, total, status, type, payment_status, updated_at)
       VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6, $7, $8, 'completed', $9, 'paid', NOW())`,
      [
        orderId,
        session.tenantId,
        customerName,
        selectedMethod?.method_type || paymentMethod,
        selectedMethod?.id || null,
        feeAmount,
        netAmount,
        total,
        type === 'delivery' ? 'delivery' : type === 'table' ? 'table' : 'pickup',
      ],
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
         VALUES ($1, $2, $3, $4, $5)`,
        [randomUUID(), orderId, item.productId, item.quantity, item.unitPrice],
      );
    }

    const isImmediateSettlement = !selectedMethod || selectedMethod.settlement_days === 0;
    if (isImmediateSettlement) {
      const openCashSession = await client.query<{ id: string }>(
        `SELECT id
         FROM cash_register_sessions
         WHERE tenant_id = $1 AND status = 'open'
         ORDER BY opened_at DESC
         LIMIT 1`,
        [session.tenantId],
      );
      if (openCashSession.rowCount) {
        const movementUser = await client.query<{ id: string }>(
          `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
          [session.userId, session.tenantId],
        );
        await client.query(
          `INSERT INTO cash_movements
           (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
           VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7)`,
          [
            randomUUID(),
            session.tenantId,
            openCashSession.rows[0].id,
            netAmount,
            `Venda PDV ${orderId.slice(0, 8)} (${selectedMethod?.name || paymentMethod})`,
            orderId,
            movementUser.rowCount ? session.userId : null,
          ],
        );
      }
    }

    if (selectedMethod && selectedMethod.settlement_days > 0) {
      await client.query(
        `INSERT INTO receivables
         (id, tenant_id, order_id, payment_method_id, gross_amount, fee_amount, net_amount, due_date, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, (NOW()::date + $8::int), 'pending')`,
        [randomUUID(), session.tenantId, orderId, selectedMethod.id, total, feeAmount, netAmount, selectedMethod.settlement_days],
      );
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
      paymentMethod,
      itemsCount: resolvedItems.length,
    });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao finalizar venda.' }, { status: 500 });
  } finally {
    client.release();
  }
}
