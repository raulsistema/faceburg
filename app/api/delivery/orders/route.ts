import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedDeliveryAccess } from '@/lib/delivery-auth';
import { ensureOrderDeliveryIdentifiers } from '@/lib/delivery-tracking';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DeliveryOrderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  total: string;
  status: string;
  delivery_tracking_token: string | null;
  delivery_driver_code: string | null;
  delivery_started_at: string | null;
  updated_at: string;
};

export async function GET(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<DeliveryOrderRow>(
    `SELECT id,
            customer_name,
            customer_phone,
            delivery_address,
            total::text,
            status,
            delivery_tracking_token,
            delivery_driver_code,
            delivery_started_at,
            updated_at
     FROM orders
     WHERE tenant_id = $1
       AND type = 'delivery'
       AND status IN ('processing', 'delivering')
       AND created_at >= NOW() - INTERVAL '2 days'
     ORDER BY
       CASE WHEN status = 'delivering' THEN 0 ELSE 1 END,
       updated_at DESC
     LIMIT 100`,
    [session.tenantId],
  );

  const orders = [];
  for (const row of result.rows) {
    if (!row.delivery_tracking_token || !row.delivery_driver_code) {
      const identifiers = await ensureOrderDeliveryIdentifiers(session.tenantId, row.id);
      row.delivery_tracking_token = identifiers.token;
      row.delivery_driver_code = identifiers.code;
    }
    orders.push({
      id: row.id,
      code: row.delivery_driver_code || row.id.slice(0, 8).toUpperCase(),
      customerName: row.customer_name || 'Sem nome',
      customerPhone: row.customer_phone || '',
      deliveryAddress: row.delivery_address || '',
      total: Number(row.total || 0),
      status: row.status,
      trackingToken: row.delivery_tracking_token || '',
      deliveryStartedAt: row.delivery_started_at,
      updatedAt: row.updated_at,
    });
  }

  return NextResponse.json({ orders });
}
