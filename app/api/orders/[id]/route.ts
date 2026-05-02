import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type OrderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  total: string;
  status: 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';
  cancellation_reason: string | null;
  type: 'delivery' | 'pickup' | 'table';
  payment_method: string | null;
  change_for: string | null;
  created_at: string;
  updated_at: string;
};

type OrderItemRow = {
  id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  unit_price: string;
  notes: string | null;
};

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const orderResult = await query<OrderRow>(
    `SELECT id, customer_name, customer_phone, delivery_address, total::text, status, cancellation_reason, type, payment_method, change_for::text, created_at, updated_at
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [session.tenantId, id],
  );

  if (!orderResult.rowCount) {
    return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
  }

  const itemsResult = await query<OrderItemRow>(
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
     ORDER BY COALESCE(p.name, 'Produto removido') ASC`,
    [session.tenantId, id],
  );

  const order = orderResult.rows[0];
  return NextResponse.json({
    order: {
      id: order.id,
      customerName: order.customer_name || 'Sem nome',
      customerPhone: order.customer_phone || '',
      deliveryAddress: order.delivery_address || '',
      total: Number(order.total || 0),
      status: order.status,
      cancelReason: order.cancellation_reason || '',
      type: order.type,
      paymentMethod: order.payment_method || 'pix',
      changeFor: Number(order.change_for || 0),
      createdAt: order.created_at,
      updatedAt: order.updated_at,
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
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const deliveryAddress = String(body.deliveryAddress ?? '').trim();
  if (deliveryAddress.length < 5) {
    return NextResponse.json({ error: 'Informe um endereco valido para o pedido.' }, { status: 400 });
  }

  const orderResult = await query<OrderRow>(
    `SELECT id, customer_name, customer_phone, delivery_address, total::text, status, cancellation_reason, type, payment_method, change_for::text, created_at, updated_at
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [session.tenantId, id],
  );

  if (!orderResult.rowCount) {
    return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
  }

  const order = orderResult.rows[0];
  if (order.type !== 'delivery') {
    return NextResponse.json({ error: 'Somente pedidos de entrega podem ter o endereco alterado.' }, { status: 400 });
  }

  if (order.status === 'completed' || order.status === 'cancelled') {
    return NextResponse.json({ error: 'Nao e possivel alterar o endereco de um pedido finalizado ou cancelado.' }, { status: 400 });
  }

  const updateResult = await query<{ updated_at: string }>(
    `UPDATE orders
     SET delivery_address = $1,
         updated_at = NOW()
     WHERE tenant_id = $2
       AND id = $3
     RETURNING updated_at`,
    [deliveryAddress, session.tenantId, id],
  );

  return NextResponse.json({
    ok: true,
    deliveryAddress,
    updatedAt: updateResult.rows[0]?.updated_at ?? new Date().toISOString(),
  });
}
