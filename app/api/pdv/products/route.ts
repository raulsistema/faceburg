import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CategoryRow = {
  id: string;
  name: string;
};

type ProductRow = {
  id: string;
  name: string;
  price: string;
  category_id: string;
  image_url: string | null;
  available: boolean;
  product_type: string;
  sold_qty: string;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [categoriesResult, productsResult] = await Promise.all([
    query<CategoryRow>(
      `SELECT id, name
       FROM categories
       WHERE tenant_id = $1 AND active = TRUE
       ORDER BY display_order ASC, name ASC`,
      [session.tenantId],
    ),
    query<ProductRow>(
      `SELECT
         p.id,
         p.name,
         p.price::text,
         p.category_id,
         p.image_url,
         p.available,
         p.product_type,
         COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0)::text AS sold_qty
       FROM products p
       LEFT JOIN order_items oi
         ON oi.product_id = p.id
       LEFT JOIN orders o
         ON o.id = oi.order_id
        AND o.tenant_id = p.tenant_id
        AND o.status <> 'cancelled'
       WHERE p.tenant_id = $1
         AND p.available = TRUE
         AND p.product_type <> 'ingredient'
       GROUP BY p.id, p.name, p.price, p.category_id, p.image_url, p.available, p.product_type, p.display_order
       ORDER BY COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) DESC, p.display_order ASC, p.name ASC
       LIMIT 20`,
      [session.tenantId],
    ),
  ]);

  return NextResponse.json({
    categories: categoriesResult.rows,
    products: productsResult.rows.map((product) => ({
      id: product.id,
      name: product.name,
      price: Number(product.price),
      categoryId: product.category_id,
      imageUrl: product.image_url,
      available: product.available,
    })),
  });
}
