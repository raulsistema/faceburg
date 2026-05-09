import { createHmac, randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/password';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type DeliveryTokenPayload = {
  tenantId: string;
  driverId: string;
  deviceId: string;
  exp: number;
};

export type DeliveryAccess = {
  tenantId: string;
  userId: string | null;
  driverId: string | null;
  deviceId: string | null;
  source: 'dashboard' | 'driver';
};

type TenantRow = {
  id: string;
  name: string;
};

type DriverRow = {
  id: string;
  name: string;
  pin_hash: string | null;
};

function secret() {
  return process.env.AUTH_SECRET || process.env.DB_PASSWORD || 'faceburg-dev-secret';
}

function encode(value: unknown) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function decodePayload(value: string) {
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<DeliveryTokenPayload>;
  } catch {
    return null;
  }
}

function sign(data: string) {
  return createHmac('sha256', secret()).update(data).digest('base64url');
}

export function createDeliveryToken(payload: Omit<DeliveryTokenPayload, 'exp'>) {
  const body = encode({
    ...payload,
    exp: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  });
  return `${body}.${sign(body)}`;
}

function verifyDeliveryToken(token: string) {
  const [body, signature] = token.split('.');
  if (!body || !signature || sign(body) !== signature) return null;
  const payload = decodePayload(body);
  if (!payload?.tenantId || !payload.driverId || !payload.deviceId || !payload.exp) return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload as DeliveryTokenPayload;
}

function bearerToken(request: Request) {
  const header = request.headers.get('authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

export async function getValidatedDeliveryAccess(request: Request): Promise<DeliveryAccess | null> {
  const dashboardSession = await getValidatedTenantSession().catch(() => null);
  if (dashboardSession) {
    return {
      tenantId: dashboardSession.tenantId,
      userId: dashboardSession.userId,
      driverId: null,
      deviceId: null,
      source: 'dashboard',
    };
  }

  const token = bearerToken(request);
  if (!token) return null;
  const payload = verifyDeliveryToken(token);
  if (!payload) return null;

  const result = await query<{ tenant_id: string; driver_id: string; active: boolean }>(
    `SELECT d.tenant_id, d.id AS driver_id, d.active
     FROM delivery_drivers d
     JOIN tenants t
       ON t.id = d.tenant_id
      AND t.status = 'active'
     WHERE d.tenant_id = $1
       AND d.id = $2
     LIMIT 1`,
    [payload.tenantId, payload.driverId],
  );
  const driver = result.rows[0];
  if (!driver?.active) return null;

  await query(
    `UPDATE delivery_driver_devices
     SET last_seen_at = NOW(),
         updated_at = NOW()
     WHERE tenant_id = $1
       AND id = $2`,
    [payload.tenantId, payload.deviceId],
  ).catch(() => undefined);

  return {
    tenantId: payload.tenantId,
    userId: null,
    driverId: payload.driverId,
    deviceId: payload.deviceId,
    source: 'driver',
  };
}

export async function authenticateDeliveryDriver(input: {
  tenantSlug: string;
  pin: string;
  driverName?: string;
  deviceId?: string;
  platform?: string;
}) {
  const tenantResult = await query<TenantRow>(
    `SELECT id, name
     FROM tenants
     WHERE slug = $1
       AND status = 'active'
     LIMIT 1`,
    [input.tenantSlug],
  );
  const tenant = tenantResult.rows[0];
  if (!tenant) {
    return null;
  }

  const pin = String(input.pin || '').trim();
  if (pin.length < 4) {
    return null;
  }

  const drivers = await query<DriverRow>(
    `SELECT id, name, pin_hash
     FROM delivery_drivers
     WHERE tenant_id = $1
       AND active = TRUE
     ORDER BY created_at ASC`,
    [tenant.id],
  );

  let driver = drivers.rows.find((row) => row.pin_hash && verifyPassword(pin, row.pin_hash));

  if (!driver && drivers.rowCount === 0) {
    const name = String(input.driverName || 'Motoboy').trim() || 'Motoboy';
    const created = await query<DriverRow>(
      `INSERT INTO delivery_drivers
        (id, tenant_id, name, pin_hash)
       VALUES
        ($1, $2, $3, $4)
       RETURNING id, name, pin_hash`,
      [randomUUID(), tenant.id, name, hashPassword(pin)],
    );
    driver = created.rows[0];
  }

  if (!driver) {
    return null;
  }

  const deviceId = String(input.deviceId || randomUUID()).trim();
  await query(
    `INSERT INTO delivery_driver_devices
      (id, tenant_id, driver_id, platform, last_seen_at, updated_at)
     VALUES
      ($1, $2, $3, $4, NOW(), NOW())
     ON CONFLICT (id)
     DO UPDATE SET
       driver_id = EXCLUDED.driver_id,
       platform = EXCLUDED.platform,
       last_seen_at = NOW(),
       updated_at = NOW()`,
    [deviceId, tenant.id, driver.id, String(input.platform || 'android').trim() || 'android'],
  );

  return {
    tenant,
    driver: {
      id: driver.id,
      name: driver.name,
    },
    deviceId,
    token: createDeliveryToken({
      tenantId: tenant.id,
      driverId: driver.id,
      deviceId,
    }),
  };
}
