import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type TenantImageRow = {
  logo_url: string | null;
  menu_cover_image_url: string | null;
};

const TENANT_IMAGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
};

function parseDataUrl(source: string) {
  const match = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;

  const mimeType = match[1] || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const bytes = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');

  return { bytes, mimeType };
}

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

    const dataUrl = parseDataUrl(source);
    if (dataUrl) {
      return new NextResponse(new Uint8Array(dataUrl.bytes), {
        headers: {
          ...TENANT_IMAGE_CACHE_HEADERS,
          'Content-Type': dataUrl.mimeType,
          'Content-Length': String(dataUrl.bytes.byteLength),
        },
      });
    }

    return NextResponse.redirect(new URL(source, request.url), {
      headers: TENANT_IMAGE_CACHE_HEADERS,
    });
  } catch (error) {
    console.error('[public-tenant-image] failed to load image', error);
    return NextResponse.json({ error: 'Falha ao carregar imagem.' }, { status: 500 });
  }
}
