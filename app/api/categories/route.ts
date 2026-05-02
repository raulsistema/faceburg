import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const PRODUCT_TYPES = ['prepared', 'packaged', 'size_based', 'ingredient', 'special'] as const;
type ProductType = (typeof PRODUCT_TYPES)[number];

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  product_type: ProductType;
  active: boolean;
  display_order: number;
  product_count?: string;
};

function normalizeProductType(value: unknown): ProductType {
  const productType = String(value || '').trim();
  return PRODUCT_TYPES.includes(productType as ProductType) ? (productType as ProductType) : 'prepared';
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<CategoryRow>(
    `SELECT c.id,
            c.name,
            c.icon,
            c.product_type,
            c.active,
            c.display_order,
            COUNT(p.id)::text AS product_count
     FROM categories c
     LEFT JOIN products p
       ON p.category_id = c.id
      AND p.tenant_id = c.tenant_id
     WHERE c.tenant_id = $1
     GROUP BY c.id, c.name, c.icon, c.product_type, c.active, c.display_order
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
  const productType = normalizeProductType(body.productType);

  if (!name) {
    return NextResponse.json({ error: 'Nome da categoria é obrigatório.' }, { status: 400 });
  }

  const result = await query<CategoryRow>(
    `INSERT INTO categories (id, tenant_id, name, icon, product_type, active, display_order)
     VALUES ($1, $2, $3, NULLIF($4, ''), $5, TRUE, 0)
     RETURNING id, name, icon, product_type, active, display_order, '0'::text AS product_count`,
    [randomUUID(), session.tenantId, name, icon, productType],
  );

  return NextResponse.json({ category: result.rows[0] }, { status: 201 });
}
