const ALLOWED_DATA_IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type ParsedDataUrl = {
  bytes: Buffer;
  mimeType: string;
};

export function parseDataUrl(source: string): ParsedDataUrl | null {
  const match = source.match(/^data:([^;,]+)?(;base64)?,(.*)$/);
  if (!match) return null;

  const mimeType = (match[1] || 'application/octet-stream').toLowerCase();
  const isBase64 = Boolean(match[2]);
  const payload = match[3] || '';
  const bytes = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');

  return { bytes, mimeType };
}

export function isAllowedDataImageMimeType(mimeType: string) {
  return ALLOWED_DATA_IMAGE_MIME_TYPES.has(mimeType.toLowerCase());
}

export function validateImageSource(source: string, maxBytes = DEFAULT_MAX_IMAGE_BYTES) {
  const value = source.trim();
  if (!value) return null;

  if (value.startsWith('data:')) {
    const dataUrl = parseDataUrl(value);
    if (!dataUrl || !dataUrl.mimeType.startsWith('image/')) {
      return 'Imagem invalida.';
    }
    if (!isAllowedDataImageMimeType(dataUrl.mimeType)) {
      return 'Use apenas imagens PNG, JPG ou WebP.';
    }
    if (!dataUrl.bytes.byteLength || dataUrl.bytes.byteLength > maxBytes) {
      return `Imagem deve ter no maximo ${Math.floor(maxBytes / 1024 / 1024)} MB.`;
    }
    return null;
  }

  if (value.startsWith('/')) return null;

  try {
    const url = new URL(value);
    if (url.protocol === 'http:' || url.protocol === 'https:') return null;
  } catch {
    if (!value.includes(':') && !value.includes('\\')) return null;
  }

  return 'URL da imagem invalida.';
}

export function sanitizePublicImageSource(source: string | null | undefined) {
  const value = String(source || '').trim();
  return value && !validateImageSource(value) ? value : null;
}

export function resolvePublicImageRedirectUrl(source: string, requestUrl: string | URL) {
  const validationError = validateImageSource(source);
  if (validationError || source.startsWith('data:')) return null;

  const url = new URL(source, requestUrl);
  return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
}
