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
         p.product_type
       FROM products p
       WHERE p.tenant_id = $1
         AND p.available = TRUE
         AND p.product_type <> 'ingredient'
       ORDER BY p.display_order ASC, p.name ASC
       LIMIT 200`,
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
