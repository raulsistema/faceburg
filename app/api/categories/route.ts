import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
  display_order: number;
  product_count?: string;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<CategoryRow>(
    `SELECT c.id,
            c.name,
            c.icon,
            c.active,
            c.display_order,
            COUNT(p.id)::text AS product_count
     FROM categories c
     LEFT JOIN products p
       ON p.category_id = c.id
      AND p.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1
     GROUP BY c.id, c.name, c.icon, c.active, c.display_order
     ORDER BY c.display_order ASC, c.name ASC`,
    [session.tenantId],
  );

  return NextResponse.json({ categories: result.rows });
}

export async function POST(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name || '').trim();
  const icon = String(body.icon || '').trim();

  if (!name) {
    return NextResponse.json({ error: 'Nome da categoria é obrigatório.' }, { status: 400 });
  }

  const result = await query<CategoryRow>(
    `INSERT INTO categories (id, tenant_id, name, icon, active, display_order)
     VALUES ($1, $2, $3, NULLIF($4, ''), TRUE, 0)
     RETURNING id, name, icon, active, display_order, '0'::text AS product_count`,
    [randomUUID(), session.tenantId, name, icon],
  );

  return NextResponse.json({ category: result.rows[0] }, { status: 201 });
}
