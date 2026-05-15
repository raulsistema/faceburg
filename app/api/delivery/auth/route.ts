import { NextResponse } from 'next/server';
import { authenticateDeliveryDriver } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';

function text(value: unknown) {
  return String(value ?? '').trim();
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    tenantSlug?: unknown;
    pin?: unknown;
    driverName?: unknown;
    deviceId?: unknown;
    platform?: unknown;
  };

  const result = await authenticateDeliveryDriver({
    tenantSlug: text(body.tenantSlug),
    pin: text(body.pin),
    driverName: text(body.driverName),
    deviceId: text(body.deviceId),
    platform: text(body.platform) || 'android',
  });

  if (!result) {
    return NextResponse.json({ error: 'Loja ou PIN invalido.' }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    tenant: result.tenant,
    driver: result.driver,
    deviceId: result.deviceId,
    token: result.token,
  });
}
