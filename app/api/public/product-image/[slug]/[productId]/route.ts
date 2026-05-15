import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createPublicImageResponse } from '@/lib/public-image-response';

type ProductImageRow = {
  image_url: string | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; productId: string }> }) {
  try {
    const { slug, productId } = await params;
    const productResult = await query<ProductImageRow>(
      `SELECT p.image_url
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

    const source = productResult.rows[0]?.image_url;
    if (!source) {
      return NextResponse.json({ error: 'Imagem nao encontrada.' }, { status: 404 });
    }

    return createPublicImageResponse(source, request.url);
  } catch (error) {
    console.error('[public-product-image] failed to load image', error);
    return NextResponse.json({ error: 'Falha ao carregar imagem.' }, { status: 500 });
  }
}
