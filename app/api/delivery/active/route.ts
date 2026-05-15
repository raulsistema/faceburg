import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { buildTrackingUrl } from '@/lib/delivery-tracking';
import { getValidatedDeliveryAccess, isActiveDeliveryAccess } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type ActiveDeliveryRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  status: string;
  total: string;
  delivery_tracking_token: string | null;
  delivery_driver_code: string | null;
  delivery_driver_id: string | null;
  delivery_started_at: string | null;
  delivery_last_latitude: string | null;
  delivery_last_longitude: string | null;
  delivery_location_updated_at: string | null;
  updated_at: string;
};

export async function GET(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (!isActiveDeliveryAccess(session)) {
    return NextResponse.json(
      { error: 'Seu acesso esta desativado. Voce pode consultar apenas seus totais.' },
      { status: 403 },
    );
  }

  const result = await query<ActiveDeliveryRow>(
    `SELECT id,
            customer_name,
            customer_phone,
            delivery_address,
            status,
            total::text,
            delivery_tracking_token,
            delivery_driver_code,
            delivery_driver_id,
            delivery_started_at,
            delivery_last_latitude::text,
            delivery_last_longitude::text,
            delivery_location_updated_at,
            updated_at
     FROM orders
     WHERE tenant_id = $1
       AND type = 'delivery'
       AND status IN ('processing', 'delivering')
       AND ($2::text IS NULL OR delivery_driver_id IS NULL OR delivery_driver_id = $2)
     ORDER BY
       CASE WHEN status = 'delivering' THEN 0 ELSE 1 END,
       COALESCE(delivery_started_at, updated_at) DESC
     LIMIT 100`,
    [session.tenantId, session.source === 'driver' ? session.driverId : null],
  );

  return NextResponse.json({
    deliveries: result.rows.map((row) => {
      const latitude = Number(row.delivery_last_latitude);
      const longitude = Number(row.delivery_last_longitude);
      const token = row.delivery_tracking_token || '';
      return {
        id: row.id,
        code: row.delivery_driver_code || row.id.slice(0, 8).toUpperCase(),
        customerName: row.customer_name || 'Sem nome',
        customerPhone: row.customer_phone || '',
        deliveryAddress: row.delivery_address || '',
        status: row.status,
        total: Number(row.total || 0),
        trackingUrl: token ? buildTrackingUrl(token) : '',
        deliveryStartedAt: row.delivery_started_at,
        updatedAt: row.updated_at,
        locationUpdatedAt: row.delivery_location_updated_at,
        currentLocation: Number.isFinite(latitude) && Number.isFinite(longitude)
          ? { latitude, longitude }
          : null,
      };
    }),
  });
}
