import { NextResponse } from 'next/server';

export const PUBLIC_IMAGE_CACHE_HEADERS = {
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

export function createPublicImageResponse(source: string, requestUrl: string | URL) {
  const dataUrl = parseDataUrl(source);
  if (dataUrl) {
    return new NextResponse(new Uint8Array(dataUrl.bytes), {
      headers: {
        ...PUBLIC_IMAGE_CACHE_HEADERS,
        'Content-Type': dataUrl.mimeType,
        'Content-Length': String(dataUrl.bytes.byteLength),
      },
    });
  }

  return NextResponse.redirect(new URL(source, requestUrl), {
    headers: PUBLIC_IMAGE_CACHE_HEADERS,
  });
}
