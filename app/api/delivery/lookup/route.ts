import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedDeliveryAccess } from '@/lib/delivery-auth';
import { ensureOrderDeliveryIdentifiers, normalizeDeliveryCode, buildTrackingUrl } from '@/lib/delivery-tracking';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DeliveryOrderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  payment_method: string | null;
  payment_method_names: string | null;
  change_for: string | null;
  total: string;
  status: string;
  type: string;
  delivery_tracking_token: string | null;
  delivery_driver_code: string | null;
  delivery_started_at: string | null;
  delivery_finished_at: string | null;
  created_at: string;
  updated_at: string;
};

type DeliveryItemRow = {
  product_name: string;
  quantity: number;
  notes: string | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function paymentLabel(row: Pick<DeliveryOrderRow, 'payment_method' | 'payment_method_names'>) {
  const name = text(row.payment_method_names);
  if (name) return name;
  const method = text(row.payment_method).toLowerCase();
  if (method === 'cash') return 'Dinheiro';
  if (method === 'card') return 'Cartao';
  if (method === 'pix') return 'Pix';
  return text(row.payment_method) || 'Nao informado';
}

function isCashPayment(row: Pick<DeliveryOrderRow, 'payment_method' | 'payment_method_names'>) {
  return text(row.payment_method).toLowerCase() === 'cash' || text(row.payment_method_names).toLowerCase().includes('dinheiro');
}

async function loadItems(tenantId: string, orderId: string) {
  const items = await query<DeliveryItemRow>(
    `SELECT COALESCE(p.name, 'Produto removido') AS product_name,
            oi.quantity,
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
  return items.rows;
}

function serializeOrder(row: DeliveryOrderRow, items: DeliveryItemRow[]) {
  const trackingToken = row.delivery_tracking_token || '';
  const changeFor = Number(row.change_for || 0);
  return {
    id: row.id,
    code: row.delivery_driver_code || row.id.slice(0, 8).toUpperCase(),
    trackingToken,
    trackingUrl: trackingToken ? buildTrackingUrl(trackingToken) : '',
    customerName: row.customer_name || 'Sem nome',
    customerPhone: row.customer_phone || '',
    deliveryAddress: row.delivery_address || '',
    paymentMethod: paymentLabel(row),
    changeFor: isCashPayment(row) && changeFor > 0 ? changeFor : 0,
    total: Number(row.total || 0),
    status: row.status,
    type: row.type,
    deliveryStartedAt: row.delivery_started_at,
    deliveryFinishedAt: row.delivery_finished_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items: items.map((item) => ({
      productName: item.product_name,
      quantity: Number(item.quantity || 0),
      notes: item.notes || '',
    })),
  };
}

export async function POST(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as { code?: unknown };
  const code = normalizeDeliveryCode(body.code);
  if (code.length < 4) {
    return NextResponse.json({ error: 'Informe um codigo de pedido valido.' }, { status: 400 });
  }

  const result = await query<DeliveryOrderRow>(
    `SELECT o.id,
            o.customer_name,
            o.customer_phone,
            o.delivery_address,
            o.payment_method,
            COALESCE(
              NULLIF((
                SELECT string_agg(DISTINCT op.method_name, ' + ')
                FROM order_payments op
                WHERE op.order_id = o.id
                  AND op.tenant_id = o.tenant_id
              ), ''),
              pm.name
            ) AS payment_method_names,
            o.change_for::text,
            o.total::text,
            o.status,
            o.type,
            o.delivery_tracking_token,
            o.delivery_driver_code,
            o.delivery_started_at,
            o.delivery_finished_at,
            o.created_at,
            o.updated_at
     FROM orders o
     LEFT JOIN payment_methods pm
       ON pm.id = o.payment_method_id
      AND pm.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1
       AND o.type = 'delivery'
       AND (
         UPPER(COALESCE(o.delivery_driver_code, '')) = $2
         OR UPPER(REPLACE(o.id, '-', '')) LIKE ($2 || '%')
         OR o.id = $3
       )
     ORDER BY o.created_at DESC
     LIMIT 2`,
    [session.tenantId, code, text(body.code)],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Pedido de entrega nao encontrado para este codigo.' }, { status: 404 });
  }
  if (result.rowCount > 1) {
    return NextResponse.json({ error: 'Codigo encontrou mais de um pedido. Informe mais caracteres do codigo.' }, { status: 409 });
  }

  const row = result.rows[0];
  if (row.status === 'cancelled' || row.status === 'completed') {
    return NextResponse.json({ error: 'Este pedido ja esta finalizado ou cancelado.' }, { status: 409 });
  }

  if (!row.delivery_tracking_token || !row.delivery_driver_code) {
    const identifiers = await ensureOrderDeliveryIdentifiers(session.tenantId, row.id);
    row.delivery_tracking_token = identifiers.token;
    row.delivery_driver_code = identifiers.code;
  }

  const items = await loadItems(session.tenantId, row.id);
  return NextResponse.json({ ok: true, order: serializeOrder(row, items) });
}
