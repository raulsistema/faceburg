import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { createPublicImageResponse } from '@/lib/public-image-response';

type TenantImageRow = {
  logo_url: string | null;
  menu_cover_image_url: string | null;
};

export async function GET(request: Request, { params }: { params: Promise<{ slug: string; kind: string }> }) {
  try {
    const { slug, kind } = await params;
    if (kind !== 'logo' && kind !== 'cover') {
      return NextResponse.json({ error: 'Imagem invalida.' }, { status: 404 });
    }

    const tenantResult = await query<TenantImageRow>(
      `SELECT logo_url,
              menu_cover_image_url
         FROM tenants
        WHERE slug = $1
          AND status = 'active'
        LIMIT 1`,
      [slug],
    );

    const tenant = tenantResult.rows[0];
    const source = kind === 'logo' ? tenant?.logo_url : tenant?.menu_cover_image_url;
    if (!source) {
      return NextResponse.json({ error: 'Imagem nao encontrada.' }, { status: 404 });
    }

    return createPublicImageResponse(source, request.url);
  } catch (error) {
    console.error('[public-tenant-image] failed to load image', error);
    return NextResponse.json({ error: 'Falha ao carregar imagem.' }, { status: 500 });
  }
}
