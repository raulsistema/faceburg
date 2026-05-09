import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedDeliveryAccess } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';

type LocationPayload = {
  orderId?: unknown;
  driverId?: unknown;
  deviceId?: unknown;
  platform?: unknown;
  latitude?: unknown;
  longitude?: unknown;
  accuracyMeters?: unknown;
  speedMetersPerSecond?: unknown;
  headingDegrees?: unknown;
  recordedAt?: unknown;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function numberOrNull(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

export async function POST(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as LocationPayload;
  const orderId = text(body.orderId);
  const driverId = session.driverId || text(body.driverId) || null;
  const deviceId = session.deviceId || text(body.deviceId) || null;
  const latitude = Number(body.latitude);
  const longitude = Number(body.longitude);

  if (!orderId || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return NextResponse.json({ error: 'Informe pedido, latitude e longitude validos.' }, { status: 400 });
  }
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return NextResponse.json({ error: 'Coordenadas fora do intervalo valido.' }, { status: 400 });
  }

  const order = await query<{ id: string; status: string }>(
    `SELECT id, status
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
       AND type = 'delivery'
     LIMIT 1`,
    [session.tenantId, orderId],
  );
  if (!order.rowCount) {
    return NextResponse.json({ error: 'Pedido de entrega nao encontrado.' }, { status: 404 });
  }

  if (deviceId) {
    await query(
      `INSERT INTO delivery_driver_devices
        (id, tenant_id, driver_id, platform, last_seen_at, updated_at)
       VALUES
        ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id)
       DO UPDATE SET
         driver_id = COALESCE(EXCLUDED.driver_id, delivery_driver_devices.driver_id),
         platform = EXCLUDED.platform,
         last_seen_at = NOW(),
         updated_at = NOW()`,
      [deviceId, session.tenantId, driverId, text(body.platform) || 'android'],
    );
  }

  const recordedAt = Number.isNaN(Date.parse(text(body.recordedAt))) ? new Date().toISOString() : text(body.recordedAt);
  await query(
    `INSERT INTO delivery_route_points
      (id, tenant_id, order_id, driver_id, device_id, latitude, longitude, accuracy_meters, speed_meters_per_second, heading_degrees, recorded_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      randomUUID(),
      session.tenantId,
      orderId,
      driverId,
      deviceId,
      latitude,
      longitude,
      numberOrNull(body.accuracyMeters),
      numberOrNull(body.speedMetersPerSecond),
      numberOrNull(body.headingDegrees),
      recordedAt,
    ],
  );

  await query(
    `UPDATE orders
     SET delivery_last_latitude = $3,
         delivery_last_longitude = $4,
         delivery_location_updated_at = NOW(),
         updated_at = NOW()
     WHERE tenant_id = $1
       AND id = $2`,
    [session.tenantId, orderId, latitude, longitude],
  );

  return NextResponse.json({ ok: true });
}
