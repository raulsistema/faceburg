import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  product_type: string;
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

type MenuStoryRow = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  active: boolean;
  display_order: number;
  expires_at: string | null;
};

type TenantRow = {
  name: string;
  slug: string;
  status: string;
  prep_time_minutes: number;
  delivery_fee_base: string;
  delivery_fee_mode: string;
  delivery_fee_per_km: string;
  delivery_origin_use_issuer: boolean;
  delivery_origin_zip_code: string | null;
  delivery_origin_street: string | null;
  delivery_origin_number: string | null;
  delivery_origin_complement: string | null;
  delivery_origin_neighborhood: string | null;
  delivery_origin_city: string | null;
  delivery_origin_state: string | null;
  store_open: boolean;
  menu_cover_image_url: string | null;
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

  const [tenantResult, categoriesResult, productsResult, storiesResult] = await Promise.all([
    query<TenantRow>(
      `SELECT name,
              slug,
              status,
              prep_time_minutes,
              delivery_fee_base::text,
              delivery_fee_mode,
              delivery_fee_per_km::text,
              delivery_origin_use_issuer,
              delivery_origin_zip_code,
              delivery_origin_street,
              delivery_origin_number,
              delivery_origin_complement,
              delivery_origin_neighborhood,
              delivery_origin_city,
              delivery_origin_state,
              store_open,
              menu_cover_image_url,
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
    ),
    query<ProductRow>(
      `SELECT p.id,
              p.category_id,
              c.name AS category_name,
              p.name,
              p.description,
              p.price::text,
              p.image_url,
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
    query<MenuStoryRow>(
      `SELECT id,
              title,
              subtitle,
              image_url,
              active,
              display_order,
              expires_at
         FROM menu_stories
        WHERE tenant_id = $1
        ORDER BY display_order ASC, created_at ASC`,
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
      deliveryFeeMode: String(tenant.delivery_fee_mode || '').trim().toLowerCase() === 'per_km' ? 'per_km' : 'fixed',
      deliveryFeePerKm: Number(tenant.delivery_fee_per_km || 0),
      deliveryOriginUseIssuer: Boolean(tenant.delivery_origin_use_issuer),
      deliveryOriginZipCode: tenant.delivery_origin_zip_code || '',
      deliveryOriginStreet: tenant.delivery_origin_street || '',
      deliveryOriginNumber: tenant.delivery_origin_number || '',
      deliveryOriginComplement: tenant.delivery_origin_complement || '',
      deliveryOriginNeighborhood: tenant.delivery_origin_neighborhood || '',
      deliveryOriginCity: tenant.delivery_origin_city || '',
      deliveryOriginState: tenant.delivery_origin_state || '',
      storeOpen: Boolean(tenant.store_open),
      coverImageUrl: tenant.menu_cover_image_url || '',
      whatsappPhone: tenant.whatsapp_phone || '',
    },
    stories: storiesResult.rows.map((story) => ({
      id: story.id,
      title: story.title,
      subtitle: story.subtitle || '',
      imageUrl: story.image_url,
      active: Boolean(story.active),
      displayOrder: Number(story.display_order || 0),
      expiresAt: story.expires_at,
    })),
  });
}
