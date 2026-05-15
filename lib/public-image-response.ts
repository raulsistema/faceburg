import { NextResponse } from 'next/server';
import {
  isAllowedDataImageMimeType,
  parseDataUrl,
  resolvePublicImageRedirectUrl,
} from '@/lib/image-safety';

export const PUBLIC_IMAGE_CACHE_HEADERS = {
  'Cache-Control': 'public, max-age=300, stale-while-revalidate=3600',
};

export function createPublicImageResponse(source: string, requestUrl: string | URL) {
  const dataUrl = parseDataUrl(source);
  if (dataUrl) {
    if (!isAllowedDataImageMimeType(dataUrl.mimeType)) {
      return NextResponse.json({ error: 'Imagem invalida.' }, { status: 415 });
    }

    return new NextResponse(new Uint8Array(dataUrl.bytes), {
      headers: {
        ...PUBLIC_IMAGE_CACHE_HEADERS,
        'Content-Type': dataUrl.mimeType,
        'Content-Length': String(dataUrl.bytes.byteLength),
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  const redirectUrl = resolvePublicImageRedirectUrl(source, requestUrl);
  if (!redirectUrl) {
    return NextResponse.json({ error: 'Imagem invalida.' }, { status: 415 });
  }

  return NextResponse.redirect(redirectUrl, {
    headers: PUBLIC_IMAGE_CACHE_HEADERS,
  });
}
