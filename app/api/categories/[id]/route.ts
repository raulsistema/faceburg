import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  active: boolean;
  display_order: number;
  product_count: string;
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const name = String(body.name || '').trim();
  const icon = String(body.icon || '').trim();
  const active = Boolean(body.active ?? true);

  if (!name) {
    return NextResponse.json({ error: 'Nome da categoria e obrigatorio.' }, { status: 400 });
  }

  const result = await query<CategoryRow>(
    `UPDATE categories
     SET name = $3,
         icon = NULLIF($4, ''),
         active = $5
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, name, icon, active, display_order, '0'::text AS product_count`,
    [id, session.tenantId, name, icon, active],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Categoria nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ category: result.rows[0] });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  const productCount = await query<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM products
     WHERE tenant_id = $1 AND category_id = $2`,
    [session.tenantId, id],
  );

  if (Number(productCount.rows[0]?.count || 0) > 0) {
    return NextResponse.json(
      { error: 'Remova ou mova os produtos desta categoria antes de excluir.' },
      { status: 409 },
    );
  }

  const result = await query(
    `DELETE FROM categories
     WHERE id = $1 AND tenant_id = $2`,
    [id, session.tenantId],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Categoria nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
