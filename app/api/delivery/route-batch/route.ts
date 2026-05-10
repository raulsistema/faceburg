import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getValidatedDeliveryAccess, isActiveDeliveryAccess } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';

type RoutePointPayload = {
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

function validCoordinate(latitude: number, longitude: number) {
  return (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    longitude >= -180 &&
    longitude <= 180
  );
}

export async function POST(request: Request) {
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

  const body = await request.json().catch(() => ({})) as {
    orderId?: unknown;
    driverId?: unknown;
    deviceId?: unknown;
    platform?: unknown;
    points?: RoutePointPayload[];
  };
  const orderId = text(body.orderId);
  const driverId = session.driverId || text(body.driverId) || null;
  const deviceId = session.deviceId || text(body.deviceId) || null;
  const points = Array.isArray(body.points) ? body.points.slice(0, 500) : [];

  if (!orderId || !points.length) {
    return NextResponse.json({ error: 'Informe pedido e pontos de rota.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const order = await client.query<{ id: string; status: string; delivery_driver_id: string | null }>(
      `SELECT id, status, delivery_driver_id
       FROM orders
       WHERE tenant_id = $1
         AND id = $2
         AND type = 'delivery'
       LIMIT 1
       FOR UPDATE`,
      [session.tenantId, orderId],
    );
    if (!order.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Pedido de entrega nao encontrado.' }, { status: 404 });
    }
    if (session.source === 'driver' && order.rows[0].delivery_driver_id && order.rows[0].delivery_driver_id !== session.driverId) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Este pedido esta com outro entregador.' }, { status: 403 });
    }
    if (order.rows[0].status !== 'delivering' && order.rows[0].status !== 'completed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'A rota so pode ser sincronizada durante ou apos a entrega.' }, { status: 409 });
    }

    if (deviceId) {
      await client.query(
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

    let inserted = 0;
    let lastLatitude: number | null = null;
    let lastLongitude: number | null = null;
    for (const point of points) {
      const latitude = Number(point.latitude);
      const longitude = Number(point.longitude);
      if (!validCoordinate(latitude, longitude)) continue;
      const recordedAt = Number.isNaN(Date.parse(text(point.recordedAt))) ? new Date().toISOString() : text(point.recordedAt);
      await client.query(
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
          numberOrNull(point.accuracyMeters),
          numberOrNull(point.speedMetersPerSecond),
          numberOrNull(point.headingDegrees),
          recordedAt,
        ],
      );
      inserted += 1;
      lastLatitude = latitude;
      lastLongitude = longitude;
    }

    if (lastLatitude !== null && lastLongitude !== null) {
      await client.query(
        `UPDATE orders
         SET delivery_last_latitude = $3,
             delivery_last_longitude = $4,
             delivery_driver_id = COALESCE(delivery_driver_id, $5),
             delivery_location_updated_at = NOW(),
             delivery_route_synced_at = NOW(),
             updated_at = NOW()
         WHERE tenant_id = $1
           AND id = $2`,
        [session.tenantId, orderId, lastLatitude, lastLongitude, driverId],
      );
    }

    await client.query('COMMIT');
    return NextResponse.json({ ok: true, inserted });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('delivery route batch failed', error);
    return NextResponse.json({ error: 'Falha ao sincronizar rota.' }, { status: 500 });
  } finally {
    client.release();
  }
}
