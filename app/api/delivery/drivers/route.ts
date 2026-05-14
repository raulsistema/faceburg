import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { BUSINESS_CURRENT_DATE_SQL, BUSINESS_TIME_ZONE } from '@/lib/business-time';
import { type DeliveryDriverStatus, hashDeliveryPin, verifyDeliveryPin } from '@/lib/delivery-auth';
import { getValidatedTenantSession, requireTenantSession } from '@/lib/tenant-auth';

export const dynamic = 'force-dynamic';

type DriverRow = {
  id: string;
  name: string;
  phone: string | null;
  status: DeliveryDriverStatus;
  active: boolean;
  last_login_at: string | null;
  created_at: string;
  today_count: number;
  today_total: string;
  month_count: number;
  month_total: string;
  lifetime_count: number;
  lifetime_total: string;
};

type PinRow = {
  id: string;
  pin_hash: string | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeStatus(value: unknown): DeliveryDriverStatus {
  const status = text(value).toLowerCase();
  if (status === 'active' || status === 'inactive' || status === 'dismissed') return status;
  return 'active';
}

function serializeDriver(row: DriverRow) {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone || '',
    status: row.status,
    active: row.active,
    lastLoginAt: row.last_login_at,
    createdAt: row.created_at,
    stats: {
      today: {
        count: Number(row.today_count || 0),
        total: Number(row.today_total || 0),
      },
      month: {
        count: Number(row.month_count || 0),
        total: Number(row.month_total || 0),
      },
      lifetime: {
        count: Number(row.lifetime_count || 0),
        total: Number(row.lifetime_total || 0),
      },
    },
  };
}

async function loadDrivers(tenantId: string) {
  const result = await query<DriverRow>(
    `SELECT d.id,
            d.name,
            d.phone,
            d.status,
            d.active,
            d.last_login_at,
            d.created_at,
            COUNT(o.id) FILTER (
              WHERE o.status = 'completed'
                AND timezone('${BUSINESS_TIME_ZONE}', COALESCE(o.delivery_finished_at, o.updated_at))::date = ${BUSINESS_CURRENT_DATE_SQL}
            )::int AS today_count,
            COALESCE(SUM(o.delivery_fee_amount) FILTER (
              WHERE o.status = 'completed'
                AND timezone('${BUSINESS_TIME_ZONE}', COALESCE(o.delivery_finished_at, o.updated_at))::date = ${BUSINESS_CURRENT_DATE_SQL}
            ), 0)::text AS today_total,
            COUNT(o.id) FILTER (
              WHERE o.status = 'completed'
                AND timezone('${BUSINESS_TIME_ZONE}', COALESCE(o.delivery_finished_at, o.updated_at)) >= date_trunc('month', timezone('${BUSINESS_TIME_ZONE}', NOW()))
            )::int AS month_count,
            COALESCE(SUM(o.delivery_fee_amount) FILTER (
              WHERE o.status = 'completed'
                AND timezone('${BUSINESS_TIME_ZONE}', COALESCE(o.delivery_finished_at, o.updated_at)) >= date_trunc('month', timezone('${BUSINESS_TIME_ZONE}', NOW()))
            ), 0)::text AS month_total,
            COUNT(o.id) FILTER (WHERE o.status = 'completed')::int AS lifetime_count,
            COALESCE(SUM(o.delivery_fee_amount) FILTER (WHERE o.status = 'completed'), 0)::text AS lifetime_total
     FROM delivery_drivers d
     LEFT JOIN orders o
       ON o.tenant_id = d.tenant_id
      AND o.delivery_driver_id = d.id
      AND o.type = 'delivery'
     WHERE d.tenant_id = $1
     GROUP BY d.id, d.name, d.phone, d.status, d.active, d.last_login_at, d.created_at
     ORDER BY
       CASE d.status WHEN 'active' THEN 0 WHEN 'inactive' THEN 1 ELSE 2 END,
       d.name ASC`,
    [tenantId],
  );
  return result.rows.map(serializeDriver);
}

async function pinAlreadyInUse(tenantId: string, pin: string, exceptDriverId?: string) {
  const result = await query<PinRow>(
    `SELECT id, pin_hash
     FROM delivery_drivers
     WHERE tenant_id = $1
       AND pin_hash IS NOT NULL
       AND status <> 'dismissed'`,
    [tenantId],
  );
  return result.rows.some((row) => row.id !== exceptDriverId && row.pin_hash && verifyDeliveryPin(pin, row.pin_hash));
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const drivers = await loadDrivers(session.tenantId);
  return NextResponse.json({ drivers });
}

export async function POST(request: Request) {
  const { session, response } = await requireTenantSession(['admin']);
  if (response) return response;

  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown;
    phone?: unknown;
    pin?: unknown;
    status?: unknown;
  };
  const name = text(body.name);
  const phone = text(body.phone) || null;
  const pin = text(body.pin);
  const status = normalizeStatus(body.status);

  if (name.length < 2) {
    return NextResponse.json({ error: 'Informe o nome do entregador.' }, { status: 400 });
  }
  if (pin.length < 4) {
    return NextResponse.json({ error: 'O PIN precisa ter pelo menos 4 digitos.' }, { status: 400 });
  }
  if (await pinAlreadyInUse(session.tenantId, pin)) {
    return NextResponse.json({ error: 'Ja existe entregador ativo ou desativado com esse PIN.' }, { status: 409 });
  }

  const id = randomUUID();
  await query(
    `INSERT INTO delivery_drivers
      (id, tenant_id, name, phone, pin_hash, status, active, dismissed_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $6 = 'dismissed' THEN NOW() ELSE NULL END, NOW())`,
    [id, session.tenantId, name, phone, hashDeliveryPin(pin), status, status === 'active'],
  );

  const drivers = await loadDrivers(session.tenantId);
  return NextResponse.json({ ok: true, drivers, driver: drivers.find((driver) => driver.id === id) || null });
}
