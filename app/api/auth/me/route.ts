import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const tenantResult = await query<TenantRow>(
    'SELECT id, name, slug, plan, status FROM tenants WHERE id = $1 LIMIT 1',
    [session.tenantId],
  );

  if (!tenantResult.rowCount) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.userId,
      name: session.name,
      email: session.email,
      role: session.role,
    },
    tenant: tenantResult.rows[0],
  });
}
