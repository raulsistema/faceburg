import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TenantRow = {
  name: string;
  slug: string;
  status: string;
};

type CountRow = {
  count: string;
};

function getBaseUrl(request: Request) {
  if (process.env.APP_URL) {
    return process.env.APP_URL.replace(/\/+$/, '');
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}`;
}

export async function GET(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const tenantResult = await query<TenantRow>(
    `SELECT name, slug, status
     FROM tenants
     WHERE id = $1
     LIMIT 1`,
    [session.tenantId],
  );

  if (!tenantResult.rowCount) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const tenant = tenantResult.rows[0];
  if (tenant.status !== 'active') {
    return NextResponse.json({ error: 'Tenant inactive' }, { status: 403 });
  }

  const publishedCountResult = await query<CountRow>(
    `SELECT COUNT(*)::text AS count
     FROM products
     WHERE tenant_id = $1
       AND status = 'published'
       AND available = TRUE`,
    [session.tenantId],
  );

  const baseUrl = getBaseUrl(request);
  const publicMenuUrl = `${baseUrl}/cardapio/${tenant.slug}`;

  return NextResponse.json({
    tenant: { name: tenant.name, slug: tenant.slug },
    publicMenuUrl,
    publishedProducts: Number(publishedCountResult.rows[0]?.count || 0),
  });
}
