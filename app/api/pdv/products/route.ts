import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CategoryRow = {
  id: string;
  name: string;
  product_count: string;
};

type ProductRow = {
  id: string;
  name: string;
  price: string;
  category_id: string;
  image_url: string | null;
  available: boolean;
  product_type: string;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [categoriesResult, productsResult] = await Promise.all([
    query<CategoryRow>(
      `SELECT
         c.id,
         c.name,
         COUNT(p.id)::text AS product_count
       FROM categories c
       INNER JOIN products p
         ON p.category_id = c.id
        AND p.tenant_id = c.tenant_id
        AND p.available = TRUE
        AND p.product_type <> 'ingredient'
       WHERE c.tenant_id = $1
         AND c.active = TRUE
       GROUP BY c.id, c.name, c.display_order
       ORDER BY c.display_order ASC, c.name ASC`,
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
         p.product_type
       FROM products p
       INNER JOIN categories c ON c.id = p.category_id
       WHERE p.tenant_id = $1
         AND p.available = TRUE
         AND p.product_type <> 'ingredient'
         AND c.active = TRUE
       ORDER BY c.display_order ASC, p.display_order ASC, p.name ASC`,
      [session.tenantId],
    ),
  ]);

  return NextResponse.json({
    categories: categoriesResult.rows.map((category) => ({
      id: category.id,
      name: category.name,
      productCount: Number(category.product_count || 0),
    })),
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
