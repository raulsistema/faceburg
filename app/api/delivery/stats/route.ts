import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { formatTenantIssuerAddress, getValidatedDeliveryAccess } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DriverStatsRow = {
  id: string;
  name: string;
  status: string;
  today_count: number;
  today_total: string;
  month_count: number;
  month_total: string;
  lifetime_count: number;
  lifetime_total: string;
};

type TenantOriginRow = {
  id: string;
  name: string;
  slug: string;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_neighborhood: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
  issuer_zip_code: string | null;
};

function numberFrom(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function GET(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const driverId = session.source === 'driver' ? session.driverId : String(url.searchParams.get('driverId') || '').trim();
  if (!driverId) {
    return NextResponse.json({ error: 'Informe o entregador.' }, { status: 400 });
  }

  const result = await query<DriverStatsRow>(
    `SELECT d.id,
            d.name,
            d.status,
            COUNT(o.id) FILTER (
              WHERE o.status = 'completed'
                AND COALESCE(o.delivery_finished_at, o.updated_at) >= date_trunc('day', NOW())
            )::int AS today_count,
            COALESCE(SUM(o.delivery_fee_amount) FILTER (
              WHERE o.status = 'completed'
                AND COALESCE(o.delivery_finished_at, o.updated_at) >= date_trunc('day', NOW())
            ), 0)::text AS today_total,
            COUNT(o.id) FILTER (
              WHERE o.status = 'completed'
                AND COALESCE(o.delivery_finished_at, o.updated_at) >= date_trunc('month', NOW())
            )::int AS month_count,
            COALESCE(SUM(o.delivery_fee_amount) FILTER (
              WHERE o.status = 'completed'
                AND COALESCE(o.delivery_finished_at, o.updated_at) >= date_trunc('month', NOW())
            ), 0)::text AS month_total,
            COUNT(o.id) FILTER (WHERE o.status = 'completed')::int AS lifetime_count,
            COALESCE(SUM(o.delivery_fee_amount) FILTER (WHERE o.status = 'completed'), 0)::text AS lifetime_total
     FROM delivery_drivers d
     LEFT JOIN orders o
       ON o.tenant_id = d.tenant_id
      AND o.delivery_driver_id = d.id
      AND o.type = 'delivery'
     WHERE d.tenant_id = $1
       AND d.id = $2
     GROUP BY d.id, d.name, d.status
     LIMIT 1`,
    [session.tenantId, driverId],
  );

  const row = result.rows[0];
  if (!row) {
    return NextResponse.json({ error: 'Entregador nao encontrado.' }, { status: 404 });
  }

  const tenantResult = await query<TenantOriginRow>(
    `SELECT id,
            name,
            slug,
            issuer_street,
            issuer_number,
            issuer_neighborhood,
            issuer_city,
            issuer_state,
            issuer_zip_code
     FROM tenants
     WHERE id = $1
     LIMIT 1`,
    [session.tenantId],
  );
  const tenant = tenantResult.rows[0];

  return NextResponse.json({
    tenant: tenant
      ? {
          id: tenant.id,
          name: tenant.name,
          slug: tenant.slug,
          originAddress: formatTenantIssuerAddress(tenant),
        }
      : null,
    driver: {
      id: row.id,
      name: row.name,
      status: row.status,
    },
    stats: {
      today: {
        count: numberFrom(row.today_count),
        total: numberFrom(row.today_total),
      },
      month: {
        count: numberFrom(row.month_count),
        total: numberFrom(row.month_total),
      },
      lifetime: {
        count: numberFrom(row.lifetime_count),
        total: numberFrom(row.lifetime_total),
      },
    },
  });
}
