import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import {
  buildAutoComplementGroupsForProduct,
  buildAutoComplementPresets,
  buildProductMetaWithAutoBorders,
  isManagedAutoComplementGroupName,
  serializeOptionGroups,
  toProductOptionGroupPayload,
  type AutoComplementProduct,
} from '@/lib/auto-complements';
import {
  syncProductOptionGroups,
  type ProductOptionDetail,
  type ProductOptionGroupDetail,
} from '@/lib/product-options';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type ProductRow = {
  id: string;
  name: string;
  category_name: string;
  product_type: AutoComplementProduct['productType'];
  price: string;
  product_meta: Record<string, unknown>;
};

type ProductOptionGroupRow = {
  id: string;
  product_id: string;
  name: string;
  min_select: number;
  max_select: number;
  required: boolean;
  display_order: number;
};

type ProductOptionRow = {
  id: string;
  group_id: string;
  name: string;
  image_url: string | null;
  price_addition: string;
  active: boolean;
  display_order: number;
};

function buildProductGroupMap(groups: ProductOptionGroupRow[], options: ProductOptionRow[]) {
  const optionsByGroup = new Map<string, ProductOptionDetail[]>();
  for (const option of options) {
    const current = optionsByGroup.get(option.group_id) || [];
    current.push({
      id: option.id,
      name: option.name,
      imageUrl: option.image_url,
      priceAddition: Number(option.price_addition || 0),
      active: option.active,
      displayOrder: option.display_order,
    });
    optionsByGroup.set(option.group_id, current);
  }

  const groupsByProduct = new Map<string, ProductOptionGroupDetail[]>();
  for (const group of groups) {
    const current = groupsByProduct.get(group.product_id) || [];
    current.push({
      id: group.id,
      name: group.name,
      minSelect: group.min_select,
      maxSelect: group.max_select,
      required: group.required,
      displayOrder: group.display_order,
      options: optionsByGroup.get(group.id) || [],
    });
    groupsByProduct.set(group.product_id, current);
  }

  return groupsByProduct;
}

export async function POST() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [productsResult, groupsResult, optionsResult] = await Promise.all([
    query<ProductRow>(
      `SELECT p.id,
              p.name,
              c.name AS category_name,
              p.product_type,
              p.price::text,
              p.product_meta
         FROM products p
         INNER JOIN categories c ON c.id = p.category_id
        WHERE p.tenant_id = $1
        ORDER BY p.display_order ASC, p.name ASC`,
      [session.tenantId],
    ),
    query<ProductOptionGroupRow>(
      `SELECT id, product_id, name, min_select, max_select, required, display_order
         FROM product_option_groups
        WHERE tenant_id = $1
        ORDER BY display_order ASC, name ASC`,
      [session.tenantId],
    ),
    query<ProductOptionRow>(
      `SELECT id, group_id, name, image_url, price_addition::text, active, display_order
         FROM product_options
        WHERE tenant_id = $1
        ORDER BY display_order ASC, name ASC`,
      [session.tenantId],
    ),
  ]);

  const products: AutoComplementProduct[] = productsResult.rows.map((row) => ({
    id: row.id,
    name: row.name,
    categoryName: row.category_name,
    productType: row.product_type,
    price: Number(row.price || 0),
    productMeta: row.product_meta || {},
  }));

  const presets = buildAutoComplementPresets(products);
  const groupsByProduct = buildProductGroupMap(groupsResult.rows, optionsResult.rows);

  const summary = {
    productsTouched: 0,
    groupsApplied: 0,
    optionsApplied: 0,
    pizzaBordersUpdated: 0,
    customGroupsPreserved: 0,
  };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const product of products) {
      if (product.productType === 'ingredient' || product.productType === 'packaged') {
        continue;
      }

      const currentGroups = groupsByProduct.get(product.id) || [];
      const preservedGroups = currentGroups
        .filter((group) => !isManagedAutoComplementGroupName(group.name))
        .map(toProductOptionGroupPayload);
      const generatedGroups = buildAutoComplementGroupsForProduct(product, presets);
      const nextGroups = [...generatedGroups, ...preservedGroups];
      const currentSerializable = serializeOptionGroups(currentGroups.map(toProductOptionGroupPayload));
      const nextSerializable = serializeOptionGroups(nextGroups);

      const nextProductMeta = buildProductMetaWithAutoBorders(product, presets);
      const currentMetaSerialized = JSON.stringify(product.productMeta || {});
      const nextMetaSerialized = JSON.stringify(nextProductMeta || {});
      const metaChanged = currentMetaSerialized !== nextMetaSerialized;
      const groupsChanged = currentSerializable !== nextSerializable;

      if (!metaChanged && !groupsChanged) {
        continue;
      }

      if (metaChanged) {
        await client.query(
          `UPDATE products
              SET product_meta = $3::jsonb
            WHERE id = $1
              AND tenant_id = $2`,
          [product.id, session.tenantId, JSON.stringify(nextProductMeta)],
        );

        if (product.productType === 'size_based') {
          summary.pizzaBordersUpdated += 1;
        }
      }

      if (groupsChanged) {
        await syncProductOptionGroups(session.tenantId, product.id, nextGroups, client);
      }

      summary.productsTouched += 1;
      summary.groupsApplied += generatedGroups.length;
      summary.optionsApplied += generatedGroups.reduce((sum, group) => sum + group.options.length, 0);
      summary.customGroupsPreserved += preservedGroups.length;
    }

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      summary,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('auto-complements', error);
    return NextResponse.json({ error: 'Falha ao aplicar complementos automáticos.' }, { status: 500 });
  } finally {
    client.release();
  }
}
