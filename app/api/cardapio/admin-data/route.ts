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

type ProductRow = {
  id: string;
  category_id: string;
  category_name: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
  available: boolean;
  sku: string | null;
  product_type: string;
  product_meta: Record<string, unknown>;
  status: 'draft' | 'published';
  display_order: number;
};

type TenantRow = {
  name: string;
  slug: string;
  status: string;
  prep_time_minutes: number;
  delivery_fee_base: string;
  store_open: boolean;
  whatsapp_phone: string | null;
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

  const [tenantResult, categoriesResult, productsResult] = await Promise.all([
    query<TenantRow>(
      `SELECT name,
              slug,
              status,
              prep_time_minutes,
              delivery_fee_base::text,
              store_open,
              whatsapp_phone
         FROM tenants
        WHERE id = $1
        LIMIT 1`,
      [session.tenantId],
    ),
    query<CategoryRow>(
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
    ),
    query<ProductRow>(
      `SELECT p.id,
              p.category_id,
              c.name AS category_name,
              p.name,
              p.description,
              p.price::text,
              NULL::text AS image_url,
              p.available,
              p.sku,
              p.product_type,
              p.product_meta,
              p.status,
              p.display_order
         FROM products p
         INNER JOIN categories c ON c.id = p.category_id
        WHERE p.tenant_id = $1
        ORDER BY p.display_order ASC, p.name ASC`,
      [session.tenantId],
    ),
  ]);

  if (!tenantResult.rowCount) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const tenant = tenantResult.rows[0];
  if (tenant.status !== 'active') {
    return NextResponse.json({ error: 'Tenant inactive' }, { status: 403 });
  }

  const publicMenuUrl = `${getBaseUrl(request)}/cardapio/${tenant.slug}`;
  const publishedProducts = productsResult.rows.filter((product) => product.status === 'published' && product.available).length;

  return NextResponse.json({
    categories: categoriesResult.rows,
    products: productsResult.rows,
    linkData: {
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
      },
      publicMenuUrl,
      publishedProducts,
    },
    settings: {
      prepTimeMinutes: Number(tenant.prep_time_minutes || 40),
      deliveryFeeBase: Number(tenant.delivery_fee_base || 0),
      storeOpen: Boolean(tenant.store_open),
      whatsappPhone: tenant.whatsapp_phone || '',
    },
  });
}
