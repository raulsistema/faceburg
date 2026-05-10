import { randomUUID } from 'node:crypto';
import { after, NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import pool from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { isCashPaymentType } from '@/lib/cash-summary';
import { notifyOrderEvent } from '@/lib/realtime';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type OrderRow = {
  id: string;
  status: 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';
  type: 'delivery' | 'pickup' | 'table';
  payment_method: string | null;
  payment_method_id: string | null;
  discount_amount: string | null;
  surcharge_amount: string | null;
  delivery_fee_amount: string | null;
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

type ProductRow = {
  id: string;
  name: string;
  price: string;
};

type ItemRow = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  notes: string | null;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizePaymentMethodType(value: string | null | undefined) {
  const paymentMethod = String(value || '').trim().toLowerCase();
  if (paymentMethod === 'pix') return 'pix';
  if (paymentMethod === 'cash' || paymentMethod === 'money' || paymentMethod === 'dinheiro') return 'cash';
  if (paymentMethod === 'card' || paymentMethod === 'cartao' || paymentMethod === 'credito' || paymentMethod === 'debito') return 'card';
  if (paymentMethod === 'bank_slip' || paymentMethod === 'boleto') return 'bank_slip';
  if (paymentMethod === 'wallet' || paymentMethod === 'carteira') return 'wallet';
  if (paymentMethod === 'other') return 'other';
  return '';
}

function normalizeQuantity(value: unknown) {
  const quantity = Math.round(Number(value || 0));
  if (!Number.isFinite(quantity)) return 0;
  return Math.min(99, Math.max(0, quantity));
}

function parseStringArray(value: unknown) {
  return Array.isArray(value)
    ? Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean)))
    : [];
}

async function resolvePaymentMethod(
  client: PoolClient,
  tenantId: string,
  paymentMethodId: string,
  currentOrder: OrderRow,
) {
  if (paymentMethodId) {
    const byId = await client.query<PaymentMethodRow>(
      `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
       FROM payment_methods
       WHERE tenant_id = $1
         AND id = $2
         AND active = TRUE
       LIMIT 1`,
      [tenantId, paymentMethodId],
    );
    return byId.rows[0] || null;
  }

  if (currentOrder.payment_method_id) {
    const byCurrentId = await client.query<PaymentMethodRow>(
      `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
       FROM payment_methods
       WHERE tenant_id = $1
         AND id = $2
       LIMIT 1`,
      [tenantId, currentOrder.payment_method_id],
    );
    if (byCurrentId.rowCount) return byCurrentId.rows[0];
  }

  if (currentOrder.payment_method) {
    const byName = await client.query<PaymentMethodRow>(
      `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
       FROM payment_methods
       WHERE tenant_id = $1
         AND lower(name) = lower($2)
       ORDER BY active DESC, created_at ASC
       LIMIT 1`,
      [tenantId, currentOrder.payment_method],
    );
    if (byName.rowCount) return byName.rows[0];

    const methodType = normalizePaymentMethodType(currentOrder.payment_method);
    if (methodType) {
      const byType = await client.query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
         FROM payment_methods
         WHERE tenant_id = $1
           AND method_type = $2
           AND active = TRUE
         ORDER BY created_at ASC
         LIMIT 1`,
        [tenantId, methodType],
      );
      if (byType.rowCount) return byType.rows[0];
    }
  }

  return null;
}

async function serializeOrder(client: PoolClient, tenantId: string, orderId: string) {
  const orderResult = await client.query<{
    id: string;
    customer_name: string | null;
    customer_phone: string | null;
    delivery_address: string | null;
    order_sequence_number: number | null;
    subtotal_amount: string | null;
    discount_amount: string | null;
    surcharge_amount: string | null;
    delivery_fee_amount: string | null;
    total: string;
    status: OrderRow['status'];
    cancellation_reason: string | null;
    type: OrderRow['type'];
    payment_method: string | null;
    change_for: string | null;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id,
            customer_name,
            customer_phone,
            delivery_address,
            order_sequence_number,
            subtotal_amount::text,
            discount_amount::text,
            surcharge_amount::text,
            delivery_fee_amount::text,
            total::text,
            status,
            cancellation_reason,
            type,
            payment_method,
            change_for::text,
            created_at,
            updated_at
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [tenantId, orderId],
  );
  const order = orderResult.rows[0];

  const itemsResult = await client.query<ItemRow>(
    `SELECT oi.id,
            oi.product_id,
            COALESCE(p.name, 'Produto removido') AS product_name,
            oi.quantity,
            oi.unit_price::text,
            oi.notes
     FROM order_items oi
     JOIN orders o
       ON o.id = oi.order_id
      AND o.tenant_id = $1
     LEFT JOIN products p
       ON p.id = oi.product_id
      AND p.tenant_id = o.tenant_id
     WHERE oi.order_id = $2
     ORDER BY oi.ctid ASC`,
    [tenantId, orderId],
  );

  const itemsSummary = itemsResult.rows
    .map((item) => `${item.quantity}x ${item.product_name}`)
    .join(', ');

  return {
    id: order.id,
    customerName: order.customer_name || 'Sem nome',
    customerPhone: order.customer_phone || '',
    deliveryAddress: order.delivery_address || '',
    orderSequenceNumber: order.order_sequence_number ?? null,
    subtotalAmount: Number(order.subtotal_amount || 0),
    discountAmount: Number(order.discount_amount || 0),
    surchargeAmount: Number(order.surcharge_amount || 0),
    deliveryFeeAmount: Number(order.delivery_fee_amount || 0),
    total: Number(order.total || 0),
    status: order.status,
    cancelReason: order.cancellation_reason || '',
    type: order.type,
    paymentMethod: order.payment_method || 'pix',
    changeFor: Number(order.change_for || 0),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    itemsSummary,
    items: itemsResult.rows.map((item) => {
      let notesParsed: unknown = null;
      if (item.notes) {
        try {
          notesParsed = JSON.parse(item.notes);
        } catch {
          notesParsed = item.notes;
        }
      }
      return {
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price || 0),
        notesRaw: item.notes,
        notesParsed,
      };
    }),
  };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Corpo da requisicao invalido.' }, { status: 400 });
  }

  const paymentMethodId = String(body.paymentMethodId || '').trim();
  const removeItemIds = parseStringArray(body.removeItemIds);
  const updateItems = Array.isArray(body.updateItems) ? (body.updateItems as Array<Record<string, unknown>>) : [];
  const addItems = Array.isArray(body.addItems) ? (body.addItems as Array<Record<string, unknown>>) : [];

  if (!paymentMethodId && !removeItemIds.length && !updateItems.length && !addItems.length) {
    return NextResponse.json({ error: 'Nenhum ajuste informado.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const orderResult = await client.query<OrderRow>(
      `SELECT id,
              status,
              type,
              payment_method,
              payment_method_id,
              discount_amount::text,
              surcharge_amount::text,
              delivery_fee_amount::text,
              cash_session_id
       FROM orders
       WHERE tenant_id = $1
         AND id = $2
       LIMIT 1
       FOR UPDATE`,
      [session.tenantId, id],
    );

    if (!orderResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
    }

    const order = orderResult.rows[0];
    if (order.status === 'cancelled') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido cancelado nao pode ser editado.' }, { status: 400 });
    }

    if (removeItemIds.length) {
      await client.query(
        `DELETE FROM order_items oi
         USING orders o
         WHERE o.id = oi.order_id
           AND o.tenant_id = $1
           AND oi.order_id = $2
           AND oi.id = ANY($3::text[])`,
        [session.tenantId, id, removeItemIds],
      );
    }

    for (const item of updateItems) {
      const itemId = String(item.id || '').trim();
      const quantity = normalizeQuantity(item.quantity);
      if (!itemId) continue;
      if (quantity <= 0) {
        await client.query(
          `DELETE FROM order_items oi
           USING orders o
           WHERE o.id = oi.order_id
             AND o.tenant_id = $1
             AND oi.order_id = $2
             AND oi.id = $3`,
          [session.tenantId, id, itemId],
        );
        continue;
      }
      await client.query(
        `UPDATE order_items oi
         SET quantity = $4
         FROM orders o
         WHERE o.id = oi.order_id
           AND o.tenant_id = $1
           AND oi.order_id = $2
           AND oi.id = $3`,
        [session.tenantId, id, itemId, quantity],
      );
    }

    const normalizedAddItems = addItems
      .map((item) => ({
        productId: String(item.productId || '').trim(),
        quantity: normalizeQuantity(item.quantity),
      }))
      .filter((item) => item.productId && item.quantity > 0);

    if (normalizedAddItems.length) {
      const productIds = Array.from(new Set(normalizedAddItems.map((item) => item.productId)));
      const productsResult = await client.query<ProductRow>(
        `SELECT id, name, price::text
         FROM products
         WHERE tenant_id = $1
           AND id = ANY($2::text[])
           AND available = TRUE
           AND product_type <> 'ingredient'`,
        [session.tenantId, productIds],
      );
      const productMap = new Map(productsResult.rows.map((product) => [product.id, product]));
      for (const item of normalizedAddItems) {
        const product = productMap.get(item.productId);
        if (!product) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Produto invalido ou indisponivel.' }, { status: 400 });
        }
        await client.query(
          `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price)
           VALUES ($1, $2, $3, $4, $5)`,
          [randomUUID(), id, product.id, item.quantity, Number(product.price || 0)],
        );
      }
    }

    const subtotalResult = await client.query<{ subtotal: string }>(
      `SELECT COALESCE(SUM(quantity * unit_price), 0)::text AS subtotal
       FROM order_items
       WHERE order_id = $1`,
      [id],
    );
    const subtotalAmount = roundMoney(Number(subtotalResult.rows[0]?.subtotal || 0));
    if (!(subtotalAmount > 0)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'O pedido precisa ter pelo menos um item.' }, { status: 400 });
    }

    const discountAmount = roundMoney(Number(order.discount_amount || 0));
    const surchargeAmount = roundMoney(Number(order.surcharge_amount || 0));
    const deliveryFeeAmount = roundMoney(Number(order.delivery_fee_amount || 0));
    if (discountAmount > subtotalAmount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'O desconto do pedido ficou maior que o subtotal.' }, { status: 400 });
    }

    const total = roundMoney(subtotalAmount - discountAmount + surchargeAmount + deliveryFeeAmount);
    if (!(total > 0)) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Total do pedido invalido.' }, { status: 400 });
    }

    const selectedMethod = await resolvePaymentMethod(client, session.tenantId, paymentMethodId, order);
    if (!selectedMethod) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Forma de pagamento invalida ou inativa.' }, { status: 400 });
    }

    const feeAmount = roundMoney(total * (Number(selectedMethod.fee_percent || 0) / 100) + Number(selectedMethod.fee_fixed || 0));
    const netAmount = roundMoney(total - feeAmount);
    if (netAmount < 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'A taxa configurada para essa forma excede o valor do pedido.' }, { status: 400 });
    }

    await client.query(
      `UPDATE orders
       SET subtotal_amount = $1,
           total = $2,
           payment_method = $3,
           payment_method_id = $4,
           payment_fee_amount = $5,
           payment_net_amount = $6,
           updated_at = NOW()
       WHERE tenant_id = $7
         AND id = $8`,
      [subtotalAmount, total, selectedMethod.name, selectedMethod.id, feeAmount, netAmount, session.tenantId, id],
    );

    if (order.status === 'completed') {
      await client.query(
        `DELETE FROM order_payments
         WHERE tenant_id = $1
           AND order_id = $2`,
        [session.tenantId, id],
      );
      await client.query(
        `INSERT INTO order_payments
         (id, tenant_id, order_id, payment_method_id, method_type, method_name, gross_amount, fee_amount, net_amount, settlement_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          randomUUID(),
          session.tenantId,
          id,
          selectedMethod.id,
          selectedMethod.method_type,
          selectedMethod.name,
          total,
          feeAmount,
          netAmount,
          selectedMethod.settlement_days,
        ],
      );

      await client.query(
        `DELETE FROM cash_movements
         WHERE tenant_id = $1
           AND reference_order_id = $2
           AND movement_type = 'sale'`,
        [session.tenantId, id],
      );
      await client.query(
        `DELETE FROM receivables
         WHERE tenant_id = $1
           AND order_id = $2`,
        [session.tenantId, id],
      );

      if (isCashPaymentType(selectedMethod.method_type)) {
        let cashSessionId = order.cash_session_id;
        if (!cashSessionId) {
          const openCashSession = await client.query<{ id: string }>(
            `SELECT id
             FROM cash_register_sessions
             WHERE tenant_id = $1
               AND status = 'open'
             ORDER BY opened_at DESC
             LIMIT 1`,
            [session.tenantId],
          );
          cashSessionId = openCashSession.rows[0]?.id || null;
        }
        if (!cashSessionId) {
          await client.query('ROLLBACK');
          return NextResponse.json({ error: 'Abra um caixa para registrar este ajuste em dinheiro.' }, { status: 409 });
        }

        const movementUser = await client.query<{ id: string }>(
          `SELECT id
           FROM tenant_users
           WHERE id = $1 AND tenant_id = $2
           LIMIT 1`,
          [session.userId, session.tenantId],
        );
        await client.query(
          `INSERT INTO cash_movements
           (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
           VALUES ($1, $2, $3, 'sale', $4, $5, $6, $7)`,
          [
            randomUUID(),
            session.tenantId,
            cashSessionId,
            netAmount,
            `Ajuste pedido ${id.slice(0, 8)} (${selectedMethod.name})`,
            id,
            movementUser.rowCount ? session.userId : null,
          ],
        );
        await client.query(
          `UPDATE orders
           SET cash_session_id = $3
           WHERE tenant_id = $1
             AND id = $2`,
          [session.tenantId, id, cashSessionId],
        );
      } else {
        await client.query(
          `INSERT INTO receivables
           (id, tenant_id, order_id, payment_method_id, gross_amount, fee_amount, net_amount, due_date, status, received_at)
           VALUES (
             $1, $2, $3, $4, $5, $6, $7, (NOW()::date + $8::int),
             CASE WHEN $8::int <= 0 THEN 'received' ELSE 'pending' END,
             CASE WHEN $8::int <= 0 THEN NOW() ELSE NULL END
           )`,
          [randomUUID(), session.tenantId, id, selectedMethod.id, total, feeAmount, netAmount, selectedMethod.settlement_days],
        );
      }
    }

    const serializedOrder = await serializeOrder(client, session.tenantId, id);
    await client.query('COMMIT');

    after(() => notifyOrderEvent(session.tenantId, 'updated', id).then(() => undefined));
    return NextResponse.json({ ok: true, order: serializedOrder });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('PATCH /api/orders/[id]/adjust failed', error);
    return NextResponse.json({ error: 'Falha ao ajustar pedido.' }, { status: 500 });
  } finally {
    client.release();
  }
}
