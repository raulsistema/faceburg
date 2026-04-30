import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  logo_url: string | null;
  whatsapp_phone: string | null;
  prep_time_minutes: number;
  delivery_fee_base: string;
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
};

type OptionGroupRow = {
  id: string;
  product_id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
  display_order: number;
};

type OptionRow = {
  id: string;
  group_id: string;
  name: string;
  price_addition: string;
  active: boolean;
  display_order: number;
};

export async function GET(_: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const tenantResult = await query<TenantRow>(
    `SELECT id, name, slug, logo_url, whatsapp_phone, prep_time_minutes, delivery_fee_base::text, store_open, primary_color, status
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

  const categoriesResult = await query<CategoryRow>(
    `SELECT id, name, icon, display_order
     FROM categories
     WHERE tenant_id = $1 AND active = TRUE
     ORDER BY display_order ASC, name ASC`,
    [tenant.id],
  );

  const productsResult = await query<ProductRow>(
    `SELECT id, category_id, name, description, price::text, image_url, product_type, product_meta
     FROM products
     WHERE tenant_id = $1
       AND available = TRUE
       AND status = 'published'
       AND product_type <> 'ingredient'
     ORDER BY display_order ASC, name ASC`,
    [tenant.id],
  );

  const optionGroupsResult = await query<OptionGroupRow>(
    `SELECT id, product_id, name, min_select, max_select, required, display_order
     FROM product_option_groups
     WHERE tenant_id = $1
     ORDER BY display_order ASC, name ASC`,
    [tenant.id],
  );

  const optionsResult = await query<OptionRow>(
    `SELECT id, group_id, name, price_addition::text, active, display_order
     FROM product_options
     WHERE tenant_id = $1 AND active = TRUE
     ORDER BY display_order ASC, name ASC`,
    [tenant.id],
  );

  const optionsByGroup = new Map<string, Array<{ id: string; name: string; priceAddition: number }>>();
  for (const option of optionsResult.rows) {
    const current = optionsByGroup.get(option.group_id) || [];
    current.push({
      id: option.id,
      name: option.name,
      priceAddition: Number(option.price_addition),
    });
    optionsByGroup.set(option.group_id, current);
  }

  const groupsByProduct = new Map<
    string,
    Array<{
      id: string;
      name: string;
      minSelect: number;
      maxSelect: number;
      required: boolean;
      options: Array<{ id: string; name: string; priceAddition: number }>;
    }>
  >();

  for (const group of optionGroupsResult.rows) {
    const current = groupsByProduct.get(group.product_id) || [];
    current.push({
      id: group.id,
      name: group.name,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      required: group.required,
      options: optionsByGroup.get(group.id) || [],
    });
    groupsByProduct.set(group.product_id, current);
  }

  return NextResponse.json({
    tenant: {
      name: tenant.name,
      slug: tenant.slug,
      logoUrl: tenant.logo_url,
      whatsappPhone: tenant.whatsapp_phone,
      prepTimeMinutes: Number(tenant.prep_time_minutes || 40),
      deliveryFeeBase: Number(tenant.delivery_fee_base || 5),
      storeOpen: Boolean(tenant.store_open),
      primaryColor: tenant.primary_color,
    },
    categories: categoriesResult.rows,
    products: productsResult.rows.map((product) => ({
      ...product,
      optionGroups: groupsByProduct.get(product.id) || [],
    })),
  });
}
