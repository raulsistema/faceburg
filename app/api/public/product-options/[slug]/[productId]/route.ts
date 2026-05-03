import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type ProductRow = {
  id: string;
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
  image_url: string | null;
  price_addition: string;
  active: boolean;
  display_order: number;
};

const PUBLIC_PRODUCT_OPTIONS_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=15, stale-while-revalidate=60',
};

export async function GET(_: Request, { params }: { params: Promise<{ slug: string; productId: string }> }) {
  try {
    const { slug, productId } = await params;

    const productResult = await query<ProductRow>(
      `SELECT p.id
         FROM products p
         INNER JOIN tenants t ON t.id = p.tenant_id
        WHERE t.slug = $1
          AND t.status = 'active'
          AND p.id = $2
          AND p.available = TRUE
          AND p.status = 'published'
          AND p.product_type <> 'ingredient'
        LIMIT 1`,
      [slug, productId],
    );

    if (!productResult.rowCount) {
      return NextResponse.json({ error: 'Produto nao encontrado.' }, { status: 404 });
    }

    const [groupsResult, optionsResult] = await Promise.all([
      query<OptionGroupRow>(
        `SELECT pog.id,
                pog.product_id,
                pog.name,
                pog.min_select,
                pog.max_select,
                pog.required,
                pog.display_order
           FROM product_option_groups pog
           INNER JOIN products p ON p.id = pog.product_id
             AND p.tenant_id = pog.tenant_id
           INNER JOIN tenants t ON t.id = p.tenant_id
          WHERE t.slug = $1
            AND t.status = 'active'
            AND p.id = $2
            AND p.available = TRUE
            AND p.status = 'published'
            AND p.product_type <> 'ingredient'
          ORDER BY pog.display_order ASC, pog.name ASC`,
        [slug, productId],
      ),
      query<OptionRow>(
        `SELECT po.id,
                po.group_id,
                po.name,
                po.image_url,
                po.price_addition::text,
                po.active,
                po.display_order
           FROM product_options po
           INNER JOIN product_option_groups pog ON pog.id = po.group_id
             AND pog.tenant_id = po.tenant_id
           INNER JOIN products p ON p.id = pog.product_id
             AND p.tenant_id = pog.tenant_id
           INNER JOIN tenants t ON t.id = p.tenant_id
          WHERE t.slug = $1
            AND t.status = 'active'
            AND p.id = $2
            AND p.available = TRUE
            AND p.status = 'published'
            AND p.product_type <> 'ingredient'
            AND po.active = TRUE
          ORDER BY po.display_order ASC, po.name ASC`,
        [slug, productId],
      ),
    ]);

    const optionsByGroup = new Map<string, OptionRow[]>();
    for (const option of optionsResult.rows) {
      const current = optionsByGroup.get(option.group_id) || [];
      current.push(option);
      optionsByGroup.set(option.group_id, current);
    }

    const optionGroups = groupsResult.rows.map((group) => ({
      id: group.id,
      name: group.name,
      minSelect: Number(group.min_select || 0),
      maxSelect: Number(group.max_select || 0),
      required: Boolean(group.required),
      options: (optionsByGroup.get(group.id) || []).map((option) => ({
        id: option.id,
        name: option.name,
        imageUrl: option.image_url,
        priceAddition: Number(option.price_addition || 0),
      })),
    }));

    return NextResponse.json({ optionGroups }, { headers: PUBLIC_PRODUCT_OPTIONS_CACHE_HEADERS });
  } catch (error) {
    console.error('[public-product-options] failed to load options', error);
    return NextResponse.json({ error: 'Falha ao carregar complementos.' }, { status: 500 });
  }
}
