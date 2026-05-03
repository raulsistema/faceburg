import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  menu_cover_image_url: string | null;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
  whatsapp_phone: string | null;
  prep_time_minutes: number;
  delivery_fee_base: string;
  delivery_fee_mode: string;
  delivery_fee_per_km: string;
  store_open: boolean;
  primary_color: string;
  status: string;
};

type CategoryRow = {
  id: string;
  name: string;
  icon: string | null;
  display_order: number;
};

type ProductRow = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: string;
  image_url: string | null;
  product_type: string;
  product_meta: Record<string, unknown>;
  option_group_count: number;
};

type MenuStoryRow = {
  id: string;
  title: string;
  subtitle: string | null;
  image_url: string;
  display_order: number;
  expires_at: string | null;
};

const PUBLIC_MENU_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
};

function publicTenantImageUrl(slug: string, kind: 'logo' | 'cover', value: string | null) {
  if (!value) return null;
  return `/api/public/tenant-image/${encodeURIComponent(slug)}/${kind}`;
}

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;

    const tenantResult = await query<TenantRow>(
      `SELECT id, name, slug, logo_url, menu_cover_image_url, issuer_street, issuer_number, issuer_city, issuer_state, whatsapp_phone, prep_time_minutes, delivery_fee_base::text, delivery_fee_mode, delivery_fee_per_km::text, store_open, primary_color, status
       FROM tenants
       WHERE slug = $1
       LIMIT 1`,
      [slug],
    );

    if (!tenantResult.rowCount) {
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }

    const tenant = tenantResult.rows[0];
    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Tenant inactive' }, { status: 403 });
    }

    const [categoriesResult, productsResult, storiesResult] = await Promise.all([
      query<CategoryRow>(
        `SELECT id, name, icon, display_order
         FROM categories
         WHERE tenant_id = $1 AND active = TRUE
         ORDER BY display_order ASC, name ASC`,
        [tenant.id],
      ),
      query<ProductRow>(
        `SELECT p.id,
                p.category_id,
                p.name,
                p.description,
                p.price::text,
                p.image_url,
                p.product_type,
                p.product_meta,
                COALESCE(option_counts.option_group_count, 0)::int AS option_group_count
         FROM products p
         LEFT JOIN (
           SELECT product_id,
                  COUNT(*)::int AS option_group_count
           FROM product_option_groups pog
           WHERE pog.tenant_id = $1
           GROUP BY product_id
         ) option_counts ON TRUE
           AND option_counts.product_id = p.id
         WHERE p.tenant_id = $1
           AND p.available = TRUE
           AND p.status = 'published'
           AND p.product_type <> 'ingredient'
         ORDER BY p.display_order ASC, p.name ASC`,
        [tenant.id],
      ),
      query<MenuStoryRow>(
        `SELECT id,
                title,
                subtitle,
                image_url,
                display_order,
                expires_at
           FROM menu_stories
          WHERE tenant_id = $1
            AND active = TRUE
            AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY display_order ASC, created_at ASC`,
        [tenant.id],
      ),
    ]);

    return NextResponse.json({
      tenant: {
        name: tenant.name,
        slug: tenant.slug,
        logoUrl: publicTenantImageUrl(tenant.slug, 'logo', tenant.logo_url),
        coverImageUrl: publicTenantImageUrl(tenant.slug, 'cover', tenant.menu_cover_image_url),
        issuerStreet: tenant.issuer_street,
        issuerNumber: tenant.issuer_number,
        issuerCity: tenant.issuer_city,
        issuerState: tenant.issuer_state,
        whatsappPhone: tenant.whatsapp_phone,
        prepTimeMinutes: Number(tenant.prep_time_minutes || 40),
        deliveryFeeBase: Number(tenant.delivery_fee_base || 5),
        deliveryFeeMode: String(tenant.delivery_fee_mode || '').trim().toLowerCase() === 'per_km' ? 'per_km' : 'fixed',
        deliveryFeePerKm: Number(tenant.delivery_fee_per_km || 0),
        storeOpen: Boolean(tenant.store_open),
        primaryColor: tenant.primary_color,
      },
      stories: storiesResult.rows.map((story) => ({
        id: story.id,
        title: story.title,
        subtitle: story.subtitle || '',
        imageUrl: story.image_url,
        displayOrder: Number(story.display_order || 0),
        expiresAt: story.expires_at,
      })),
      categories: categoriesResult.rows,
      products: productsResult.rows.map(({ option_group_count: optionGroupCount, ...product }) => ({
        ...product,
        optionGroupCount,
        optionGroups: [],
      })),
    }, { headers: PUBLIC_MENU_CACHE_HEADERS });
  } catch (error) {
    console.error('[public-menu] failed to load menu', error);
    return NextResponse.json({ error: 'Falha ao carregar cardapio.' }, { status: 500 });
  }
}
