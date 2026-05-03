import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { parseMoneyInput } from '@/lib/finance-utils';
import { normalizeProductOptionGroups, syncProductOptionGroups } from '@/lib/product-options';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

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
  status: string;
  display_order: number;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<ProductRow>(
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
  );

  return NextResponse.json({ products: result.rows });
}

export async function POST(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const categoryId = String(body.categoryId || '').trim();
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const price = parseMoneyInput(body.price);
  const imageUrl = String(body.imageUrl || '').trim();
  const sku = String(body.sku || '').trim();
  const productType = String(body.productType || 'prepared').trim();
  const productMeta =
    body.productMeta && typeof body.productMeta === 'object' && !Array.isArray(body.productMeta)
      ? body.productMeta
      : {};
  const optionGroups = normalizeProductOptionGroups(body.optionGroups);
  const status = String(body.status || 'draft').trim() === 'published' ? 'published' : 'draft';
  const available = Boolean(body.available ?? true);
  const safeProductType = ['prepared', 'packaged', 'size_based', 'ingredient', 'special'].includes(productType)
    ? productType
    : 'prepared';

  if (!categoryId || !name || !(price > 0)) {
    return NextResponse.json({ error: 'Categoria, nome e preco valido sao obrigatorios.' }, { status: 400 });
  }

  const imageValidationError = validateImagePayload(imageUrl);
  if (imageValidationError) {
    return NextResponse.json({ error: imageValidationError }, { status: 400 });
  }

  const categoryCheck = await query<{ id: string; product_type: string }>(
    'SELECT id, product_type FROM categories WHERE id = $1 AND tenant_id = $2 LIMIT 1',
    [categoryId, session.tenantId],
  );
  if (!categoryCheck.rowCount) {
    return NextResponse.json({ error: 'Categoria invalida para esta empresa.' }, { status: 400 });
  }
  if (categoryCheck.rows[0].product_type !== safeProductType) {
    return NextResponse.json(
      { error: 'A categoria selecionada nao pertence a este tipo de cadastro.' },
      { status: 400 },
    );
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const productId = randomUUID();
      const result = await client.query<ProductRow>(
        `INSERT INTO products
         (id, tenant_id, category_id, name, description, price, image_url, available, sku, product_type, product_meta, status, display_order)
         VALUES
         ($1, $2, $3, $4, NULLIF($5, ''), $6, NULLIF($7, ''), $8, NULLIF($9, ''), $10, $11::jsonb, $12, 0)
         RETURNING id, category_id, ''::text AS category_name, name, description, price::text, image_url, available, sku, product_type, product_meta, status, display_order`,
        [
          productId,
          session.tenantId,
          categoryId,
          name,
          description,
          price,
          imageUrl,
          available,
          sku,
          safeProductType,
          JSON.stringify(productMeta),
          status,
        ],
      );

      const savedOptionGroups =
        safeProductType === 'ingredient'
          ? []
          : await syncProductOptionGroups(session.tenantId, productId, optionGroups, client);

      await client.query('COMMIT');

      return NextResponse.json(
        {
          product: {
            ...result.rows[0],
            optionGroups: savedOptionGroups,
          },
        },
        { status: 201 },
      );
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
    return NextResponse.json({ error: 'Falha ao cadastrar produto.' }, { status: 500 });
  }
}
