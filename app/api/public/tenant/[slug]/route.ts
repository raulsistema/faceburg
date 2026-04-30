import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  primary_color: string;
  status: string;
};

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const result = await query<TenantRow>(
    `SELECT id, name, slug, primary_color, status
     FROM tenants
     WHERE slug = $1
     LIMIT 1`,
    [slug],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const tenant = result.rows[0];
  if (tenant.status !== 'active') {
    return NextResponse.json({ error: 'Tenant inactive' }, { status: 403 });
  }

  return NextResponse.json({
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      primaryColor: tenant.primary_color,
    },
  });
}
