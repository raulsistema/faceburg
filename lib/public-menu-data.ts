import { query } from '@/lib/db';
import { normalizeDeliveryFeeMode, normalizeDeliveryFeeTable, normalizeDeliveryMaxDistanceMeters } from '@/lib/delivery-fee';
import { sanitizePublicImageSource } from '@/lib/image-safety';
import { ensureStoreHoursSchema, isMenuOpenNow } from '@/lib/store-hours';

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
  delivery_fee_table: unknown;
  delivery_max_distance_meters: number | string | null;
  delivery_min_order_amount: string | null;
  store_open: boolean;
  menu_open_mode: string | null;
  menu_hours: unknown;
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
  product_type: 'prepared' | 'packaged' | 'size_based' | 'ingredient' | 'special';
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

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
};

export const PUBLIC_MENU_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
};

export const PUBLIC_MENU_PRODUCT_PAGE_SIZE = 30;
const PUBLIC_MENU_MAX_PRODUCT_PAGE_SIZE = 60;

export type PublicMenuProductPage = {
  offset: number;
  limit: number;
  total: number;
  hasMore: boolean;
  search: string;
  categoryId: string;
};

export type PublicMenuProduct = Omit<ProductRow, 'option_group_count'> & {
  optionGroupCount: number;
  optionGroups: [];
};

export type PublicMenuData = {
  tenant: {
    name: string;
    slug: string;
    logoUrl: string | null;
    coverImageUrl: string | null;
    issuerStreet: string | null;
    issuerNumber: string | null;
    issuerCity: string | null;
    issuerState: string | null;
    whatsappPhone: string | null;
    prepTimeMinutes: number;
    deliveryFeeBase: number;
    deliveryFeeMode: 'fixed' | 'per_km' | 'distance_table';
    deliveryFeePerKm: number;
    deliveryFeeTable: Array<{ upToMeters: number; fee: number }>;
    deliveryMaxDistanceKm: number;
    deliveryMinOrderAmount: number;
    storeOpen: boolean;
    primaryColor: string;
  };
  stories: Array<{
    id: string;
    title: string;
    subtitle: string;
    imageUrl: string;
    displayOrder: number;
    expiresAt: string | null;
  }>;
  categories: CategoryRow[];
  products: PublicMenuProduct[];
  productPage: PublicMenuProductPage;
  paymentMethods: Array<{
    id: string;
    name: string;
    methodType: string;
  }>;
};

export type PublicMenuLoadResult =
  | { ok: true; data: PublicMenuData }
  | { ok: false; status: number; error: string };

export type PublicMenuProductsLoadResult =
  | { ok: true; data: { products: PublicMenuProduct[]; productPage: PublicMenuProductPage } }
  | { ok: false; status: number; error: string };

export type PublicMenuProductQuery = {
  limit?: number;
  offset?: number;
  search?: string;
  categoryId?: string;
};

function publicTenantImageUrl(slug: string, kind: 'logo' | 'cover', value: string | null) {
  if (!sanitizePublicImageSource(value)) return null;
  return `/api/public/tenant-image/${encodeURIComponent(slug)}/${kind}`;
}

function publicProductImageUrl(slug: string, productId: string, value: string | null) {
  const safeValue = sanitizePublicImageSource(value);
  if (!safeValue) return null;
  if (!safeValue.startsWith('data:')) return safeValue;
  return `/api/public/product-image/${encodeURIComponent(slug)}/${encodeURIComponent(productId)}`;
}

function normalizeProductLimit(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return PUBLIC_MENU_PRODUCT_PAGE_SIZE;
  return Math.min(PUBLIC_MENU_MAX_PRODUCT_PAGE_SIZE, Math.max(1, Math.trunc(parsed)));
}

function normalizeProductOffset(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

function buildProductFilterSql(tenantId: string, options: PublicMenuProductQuery = {}) {
  const params: Array<string | number> = [tenantId];
  const clauses = [
    'p.tenant_id = $1',
    'p.available = TRUE',
    "p.status = 'published'",
    "p.product_type <> 'ingredient'",
  ];
  const categoryId = String(options.categoryId || '').trim();
  const search = String(options.search || '').trim();

  if (categoryId && categoryId !== 'all') {
    params.push(categoryId);
    clauses.push(`p.category_id = $${params.length}`);
  }

  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    clauses.push(`(LOWER(p.name) LIKE $${params.length} OR LOWER(COALESCE(p.description, '')) LIKE $${params.length})`);
  }

  return {
    whereSql: clauses.join('\n          AND '),
    params,
    categoryId: categoryId === 'all' ? '' : categoryId,
    search,
  };
}

function mapPublicProducts(slug: string, rows: ProductRow[]): PublicMenuProduct[] {
  return rows.map(({ option_group_count: optionGroupCount, ...product }) => ({
    ...product,
    image_url: publicProductImageUrl(slug, product.id, product.image_url),
    optionGroupCount,
    optionGroups: [],
  }));
}

async function getActivePublicTenant(slug: string) {
  await ensureStoreHoursSchema();
  const tenantResult = await query<TenantRow>(
    `SELECT id, name, slug, logo_url, menu_cover_image_url, issuer_street, issuer_number, issuer_city, issuer_state, whatsapp_phone, prep_time_minutes, delivery_fee_base::text, delivery_fee_mode, delivery_fee_per_km::text, delivery_fee_table, delivery_max_distance_meters, delivery_min_order_amount::text, store_open, menu_open_mode, menu_hours, primary_color, status
       FROM tenants
      WHERE slug = $1
      LIMIT 1`,
    [slug],
  );

  if (!tenantResult.rowCount) {
    return { ok: false as const, status: 404, error: 'Tenant not found' };
  }

  const tenant = tenantResult.rows[0];
  if (tenant.status !== 'active') {
    return { ok: false as const, status: 403, error: 'Tenant inactive' };
  }

  return { ok: true as const, tenant };
}

async function getPublicProductPage(tenant: TenantRow, options: PublicMenuProductQuery = {}) {
  const limit = normalizeProductLimit(options.limit);
  const offset = normalizeProductOffset(options.offset);
  const productFilter = buildProductFilterSql(tenant.id, options);
  const paginationParams = [...productFilter.params, limit, offset];
  const limitParam = productFilter.params.length + 1;
  const offsetParam = productFilter.params.length + 2;

  const [productsResult, countResult] = await Promise.all([
    query<ProductRow>(
      `SELECT p.id,
              p.category_id,
              p.name,
              p.description,
              p.price::text,
              p.image_url,
              p.product_type,
              CASE
                WHEN p.product_type = 'size_based' THEN p.product_meta
                ELSE '{}'::jsonb
              END AS product_meta,
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
        WHERE ${productFilter.whereSql}
        ORDER BY p.display_order ASC, p.name ASC
        LIMIT $${limitParam} OFFSET $${offsetParam}`,
      paginationParams,
    ),
    query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
         FROM products p
        WHERE ${productFilter.whereSql}`,
      productFilter.params,
    ),
  ]);

  const total = Number(countResult.rows[0]?.total || 0);
  const products = mapPublicProducts(tenant.slug, productsResult.rows);

  return {
    products,
    productPage: {
      offset,
      limit,
      total,
      hasMore: offset + products.length < total,
      search: productFilter.search,
      categoryId: productFilter.categoryId,
    },
  };
}

export async function getPublicMenuProducts(slug: string, options: PublicMenuProductQuery = {}): Promise<PublicMenuProductsLoadResult> {
  const tenantResult = await getActivePublicTenant(slug);
  if (!tenantResult.ok) {
    return tenantResult;
  }

  return {
    ok: true,
    data: await getPublicProductPage(tenantResult.tenant, options),
  };
}

export async function getPublicMenuData(slug: string, productQuery: PublicMenuProductQuery = {}): Promise<PublicMenuLoadResult> {
  const tenantResult = await getActivePublicTenant(slug);
  if (!tenantResult.ok) {
    return tenantResult;
  }

  const tenant = tenantResult.tenant;
  const [categoriesResult, productPageResult, storiesResult, paymentMethodsResult] = await Promise.all([
    query<CategoryRow>(
      `SELECT id, name, icon, display_order
         FROM categories
        WHERE tenant_id = $1 AND active = TRUE
        ORDER BY display_order ASC, name ASC`,
      [tenant.id],
    ),
    getPublicProductPage(tenant, productQuery),
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
    query<PaymentMethodRow>(
      `SELECT id, name, method_type
         FROM payment_methods
        WHERE tenant_id = $1 AND active = TRUE
        ORDER BY name ASC`,
      [tenant.id],
    ),
  ]);

  return {
    ok: true,
    data: {
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
        deliveryFeeMode: normalizeDeliveryFeeMode(tenant.delivery_fee_mode),
        deliveryFeePerKm: Number(tenant.delivery_fee_per_km || 0),
        deliveryFeeTable: normalizeDeliveryFeeTable(tenant.delivery_fee_table),
        deliveryMaxDistanceKm: Number((normalizeDeliveryMaxDistanceMeters(tenant.delivery_max_distance_meters) / 1000).toFixed(2)),
        deliveryMinOrderAmount: Number(tenant.delivery_min_order_amount || 0),
        storeOpen: isMenuOpenNow({
          manualOpen: Boolean(tenant.store_open),
          mode: tenant.menu_open_mode,
          hours: tenant.menu_hours,
        }),
        primaryColor: tenant.primary_color,
      },
      stories: storiesResult.rows.map((story) => ({
        id: story.id,
        title: story.title,
        subtitle: story.subtitle || '',
        imageUrl: sanitizePublicImageSource(story.image_url) || '',
        displayOrder: Number(story.display_order || 0),
        expiresAt: story.expires_at,
      })),
      categories: categoriesResult.rows,
      products: productPageResult.products,
      productPage: productPageResult.productPage,
      paymentMethods: paymentMethodsResult.rows.map((row) => ({
        id: row.id,
        name: row.name,
        methodType: row.method_type,
      })),
    },
  };
}
