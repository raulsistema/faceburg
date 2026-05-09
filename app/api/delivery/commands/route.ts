import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedDeliveryAccess } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';

function text(value: unknown) {
  return String(value ?? '').trim();
}

export async function GET(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const deviceId = session.deviceId || text(url.searchParams.get('deviceId'));
  if (!deviceId) {
    return NextResponse.json({ error: 'Informe o dispositivo.' }, { status: 400 });
  }

  const result = await query<{
    id: string;
    order_id: string | null;
    command_type: string;
    payload: unknown;
    requested_at: string;
    expires_at: string | null;
  }>(
    `SELECT id, order_id, command_type, payload, requested_at, expires_at
     FROM delivery_commands
     WHERE tenant_id = $1
       AND device_id = $2
       AND status = 'pending'
       AND (expires_at IS NULL OR expires_at > NOW())
     ORDER BY requested_at ASC
     LIMIT 20`,
    [session.tenantId, deviceId],
  );

  if (result.rowCount) {
    await query(
      `UPDATE delivery_commands
       SET status = 'delivered',
           delivered_at = NOW()
       WHERE tenant_id = $1
         AND id = ANY($2::text[])`,
      [session.tenantId, result.rows.map((row) => row.id)],
    );
  }

  return NextResponse.json({
    commands: result.rows.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      type: row.command_type,
      payload: row.payload || {},
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
    })),
  });
}

export async function POST(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json().catch(() => ({})) as {
    orderId?: unknown;
    driverId?: unknown;
    deviceId?: unknown;
    commandType?: unknown;
    payload?: unknown;
  };
  const orderId = text(body.orderId) || null;
  const driverId = text(body.driverId) || session.driverId || null;
  const deviceId = text(body.deviceId) || session.deviceId || null;
  const commandType = text(body.commandType) || 'location_request';

  if (!orderId && !driverId && !deviceId) {
    return NextResponse.json({ error: 'Informe pedido, motoboy ou dispositivo.' }, { status: 400 });
  }

  const id = randomUUID();
  await query(
    `INSERT INTO delivery_commands
      (id, tenant_id, driver_id, device_id, order_id, command_type, payload, requested_by_user_id, expires_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, NOW() + INTERVAL '5 minutes')`,
    [
      id,
      session.tenantId,
      driverId,
      deviceId,
      orderId,
      commandType,
      JSON.stringify(body.payload && typeof body.payload === 'object' ? body.payload : {}),
      session.userId,
    ],
  );

  return NextResponse.json({ ok: true, commandId: id });
}
