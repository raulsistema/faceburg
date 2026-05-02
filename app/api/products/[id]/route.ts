import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { fetchProductOptionGroups, normalizeProductOptionGroups, syncProductOptionGroups } from '@/lib/product-options';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_TYPES = ['prepared', 'packaged', 'size_based', 'ingredient', 'special'] as const;

type ProductType = (typeof PRODUCT_TYPES)[number];

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
  product_type: ProductType;
  product_meta: Record<string, unknown>;
  status: 'draft' | 'published';
  display_order: number;
};

const PRODUCT_SELECT_SQL = `SELECT p.id,
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
 WHERE p.id = $1
   AND p.tenant_id = $2
 LIMIT 1`;

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
}

function estimateDataUrlBytes(value: string) {
  const commaIndex = value.indexOf(',');
  if (commaIndex === -1) return 0;
  const base64 = value.slice(commaIndex + 1);
  return Math.floor((base64.length * 3) / 4);
}

function validateImagePayload(imageUrl: string) {
  if (!imageUrl) return null;
  if (!imageUrl.startsWith('data:image/')) return null;
  const bytes = estimateDataUrlBytes(imageUrl);
  if (!bytes || bytes > MAX_IMAGE_BYTES) {
    return 'Imagem deve ter no maximo 5 MB.';
  }
  return null;
}

function normalizeProductType(value: unknown, fallback: ProductType): ProductType {
  const productType = String(value || '').trim();
  return PRODUCT_TYPES.includes(productType as ProductType) ? (productType as ProductType) : fallback;
}

function normalizeProductPatch(body: Record<string, unknown>, current: ProductRow) {
  const categoryId = hasOwn(body, 'categoryId') ? String(body.categoryId ?? '').trim() : current.category_id;
  const name = hasOwn(body, 'name') ? String(body.name ?? '').trim() : current.name;
  const description = hasOwn(body, 'description') ? String(body.description ?? '').trim() : String(current.description || '');
  const price = hasOwn(body, 'price') ? Number(body.price || 0) : Number(current.price || 0);
  const imageUrl = hasOwn(body, 'imageUrl') ? String(body.imageUrl ?? '').trim() : String(current.image_url || '');
  const sku = hasOwn(body, 'sku') ? String(body.sku ?? '').trim() : String(current.sku || '');
  const status = hasOwn(body, 'status')
    ? String(body.status || 'draft').trim() === 'published'
      ? 'published'
      : 'draft'
    : current.status;
  const available = hasOwn(body, 'available') ? Boolean(body.available) : Boolean(current.available);
  const productType = hasOwn(body, 'productType')
    ? normalizeProductType(body.productType, current.product_type)
    : current.product_type;
  const productMeta = hasOwn(body, 'productMeta')
    ? body.productMeta && typeof body.productMeta === 'object' && !Array.isArray(body.productMeta)
      ? body.productMeta
      : {}
    : current.product_meta || {};
  const optionGroups = hasOwn(body, 'optionGroups') ? normalizeProductOptionGroups(body.optionGroups) : null;

  return {
    categoryId,
    name,
    description,
    price,
    imageUrl,
    sku,
    status,
    available,
    productType,
    productMeta,
    optionGroups,
  };
}

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const result = await query<ProductRow>(PRODUCT_SELECT_SQL, [id, session.tenantId]);

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Produto nao encontrado.' }, { status: 404 });
  }

  const optionGroups = await fetchProductOptionGroups(session.tenantId, id);

  return NextResponse.json({
    product: {
      ...result.rows[0],
      optionGroups,
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const currentResult = await query<ProductRow>(PRODUCT_SELECT_SQL, [id, session.tenantId]);
  if (!currentResult.rowCount) {
    return NextResponse.json({ error: 'Produto nao encontrado.' }, { status: 404 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const payload = normalizeProductPatch(body, currentResult.rows[0]);

  if (!payload.categoryId || !payload.name || !(payload.price > 0)) {
    return NextResponse.json({ error: 'Categoria, nome e preco valido sao obrigatorios.' }, { status: 400 });
  }

  const imageValidationError = validateImagePayload(payload.imageUrl);
  if (imageValidationError) {
    return NextResponse.json({ error: imageValidationError }, { status: 400 });
  }

  const categoryCheck = await query<{ id: string; product_type: string }>(
    'SELECT id, product_type FROM categories WHERE id = $1 AND tenant_id = $2 LIMIT 1',
    [payload.categoryId, session.tenantId],
  );
  if (!categoryCheck.rowCount) {
    return NextResponse.json({ error: 'Categoria invalida para esta empresa.' }, { status: 400 });
  }
  if (categoryCheck.rows[0].product_type !== payload.productType) {
    return NextResponse.json(
      { error: 'A categoria selecionada nao pertence a este tipo de cadastro.' },
      { status: 400 },
    );
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const result = await client.query<ProductRow>(
        `UPDATE products
            SET category_id = $3,
                name = $4,
                description = NULLIF($5, ''),
                price = $6,
                image_url = NULLIF($7, ''),
                available = $8,
                sku = NULLIF($9, ''),
                product_type = $10,
                product_meta = $11::jsonb,
                status = $12
          WHERE id = $1
            AND tenant_id = $2
        RETURNING id,
                  category_id,
                  ''::text AS category_name,
                  name,
                  description,
                  price::text,
                  image_url,
                  available,
                  sku,
                  product_type,
                  product_meta,
                  status,
                  display_order`,
        [
          id,
          session.tenantId,
          payload.categoryId,
          payload.name,
          payload.description,
          payload.price,
          payload.imageUrl,
          payload.available,
          payload.sku,
          payload.productType,
          JSON.stringify(payload.productMeta),
          payload.status,
        ],
      );

      const optionGroups =
        payload.productType === 'ingredient'
          ? await syncProductOptionGroups(session.tenantId, id, [], client)
          : payload.optionGroups
            ? await syncProductOptionGroups(session.tenantId, id, payload.optionGroups, client)
            : await fetchProductOptionGroups(session.tenantId, id, client);

      await client.query('COMMIT');

      return NextResponse.json({
        product: {
          ...result.rows[0],
          optionGroups,
        },
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'SKU ja existe para esta empresa.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao atualizar produto.' }, { status: 500 });
  }
}
