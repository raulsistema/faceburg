import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { normalizeDeliveryFeeMode, normalizeDeliveryOriginUseIssuer } from '@/lib/delivery-fee';
import { parseMoneyInput } from '@/lib/finance-utils';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type TenantSettingsRow = {
  prep_time_minutes: number;
  delivery_fee_base: string;
  delivery_fee_mode: string;
  delivery_fee_per_km: string;
  store_open: boolean;
  logo_url: string | null;
  menu_cover_image_url: string | null;
  whatsapp_phone: string | null;
  issuer_name: string | null;
  issuer_trade_name: string | null;
  issuer_document: string | null;
  issuer_state_registration: string | null;
  issuer_email: string | null;
  issuer_phone: string | null;
  issuer_zip_code: string | null;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_complement: string | null;
  issuer_neighborhood: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
  delivery_origin_use_issuer: boolean;
  delivery_origin_zip_code: string | null;
  delivery_origin_street: string | null;
  delivery_origin_number: string | null;
  delivery_origin_complement: string | null;
  delivery_origin_neighborhood: string | null;
  delivery_origin_city: string | null;
  delivery_origin_state: string | null;
};

type CardapioSettingsResponse = {
  prepTimeMinutes: number;
  deliveryFeeBase: number;
  deliveryFeeMode: 'fixed' | 'per_km';
  deliveryFeePerKm: number;
  storeOpen: boolean;
  logoUrl: string;
  coverImageUrl: string;
  whatsappPhone: string;
  issuerName: string;
  issuerTradeName: string;
  issuerDocument: string;
  issuerStateRegistration: string;
  issuerEmail: string;
  issuerPhone: string;
  issuerZipCode: string;
  issuerStreet: string;
  issuerNumber: string;
  issuerComplement: string;
  issuerNeighborhood: string;
  issuerCity: string;
  issuerState: string;
  deliveryOriginUseIssuer: boolean;
  deliveryOriginZipCode: string;
  deliveryOriginStreet: string;
  deliveryOriginNumber: string;
  deliveryOriginComplement: string;
  deliveryOriginNeighborhood: string;
  deliveryOriginCity: string;
  deliveryOriginState: string;
};

const SETTINGS_SELECT_SQL = `SELECT
  prep_time_minutes,
  delivery_fee_base::text,
  delivery_fee_mode,
  delivery_fee_per_km::text,
  store_open,
  logo_url,
  menu_cover_image_url,
  whatsapp_phone,
  issuer_name,
  issuer_trade_name,
  issuer_document,
  issuer_state_registration,
  issuer_email,
  issuer_phone,
  issuer_zip_code,
  issuer_street,
  issuer_number,
  issuer_complement,
  issuer_neighborhood,
  issuer_city,
  issuer_state,
  delivery_origin_use_issuer,
  delivery_origin_zip_code,
  delivery_origin_street,
  delivery_origin_number,
  delivery_origin_complement,
  delivery_origin_neighborhood,
  delivery_origin_city,
  delivery_origin_state
 FROM tenants
 WHERE id = $1
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

function serializeTenantSettings(row: TenantSettingsRow): CardapioSettingsResponse {
  return {
    prepTimeMinutes: Number(row.prep_time_minutes || 40),
    deliveryFeeBase: Number(row.delivery_fee_base || 5),
    deliveryFeeMode: normalizeDeliveryFeeMode(row.delivery_fee_mode),
    deliveryFeePerKm: Number(row.delivery_fee_per_km || 0),
    storeOpen: Boolean(row.store_open),
    logoUrl: row.logo_url || '',
    coverImageUrl: row.menu_cover_image_url || '',
    whatsappPhone: row.whatsapp_phone || '',
    issuerName: row.issuer_name || '',
    issuerTradeName: row.issuer_trade_name || '',
    issuerDocument: row.issuer_document || '',
    issuerStateRegistration: row.issuer_state_registration || '',
    issuerEmail: row.issuer_email || '',
    issuerPhone: row.issuer_phone || '',
    issuerZipCode: row.issuer_zip_code || '',
    issuerStreet: row.issuer_street || '',
    issuerNumber: row.issuer_number || '',
    issuerComplement: row.issuer_complement || '',
    issuerNeighborhood: row.issuer_neighborhood || '',
    issuerCity: row.issuer_city || '',
    issuerState: row.issuer_state || '',
    deliveryOriginUseIssuer: Boolean(row.delivery_origin_use_issuer),
    deliveryOriginZipCode: row.delivery_origin_zip_code || '',
    deliveryOriginStreet: row.delivery_origin_street || '',
    deliveryOriginNumber: row.delivery_origin_number || '',
    deliveryOriginComplement: row.delivery_origin_complement || '',
    deliveryOriginNeighborhood: row.delivery_origin_neighborhood || '',
    deliveryOriginCity: row.delivery_origin_city || '',
    deliveryOriginState: row.delivery_origin_state || '',
  };
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<TenantSettingsRow>(SETTINGS_SELECT_SQL, [session.tenantId]);

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const row = result.rows[0];
  return NextResponse.json(serializeTenantSettings(row));
}

export async function PATCH(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const currentResult = await query<TenantSettingsRow>(SETTINGS_SELECT_SQL, [session.tenantId]);
  if (!currentResult.rowCount) {
    return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
  }

  const current = currentResult.rows[0];
  const prepTimeMinutes = hasOwn(body, 'prepTimeMinutes')
    ? Number(body.prepTimeMinutes)
    : Number(current.prep_time_minutes || 40);
  const deliveryFeeBase = hasOwn(body, 'deliveryFeeBase')
    ? parseMoneyInput(body.deliveryFeeBase)
    : Number(current.delivery_fee_base || 0);
  const deliveryFeeMode = hasOwn(body, 'deliveryFeeMode')
    ? normalizeDeliveryFeeMode(body.deliveryFeeMode)
    : normalizeDeliveryFeeMode(current.delivery_fee_mode);
  const deliveryFeePerKm = hasOwn(body, 'deliveryFeePerKm')
    ? parseMoneyInput(body.deliveryFeePerKm)
    : Number(current.delivery_fee_per_km || 0);
  const storeOpen = hasOwn(body, 'storeOpen')
    ? Boolean(body.storeOpen)
    : Boolean(current.store_open);
  const logoUrl = hasOwn(body, 'logoUrl')
    ? String(body.logoUrl ?? '').trim()
    : String(current.logo_url || '').trim();
  const coverImageUrl = hasOwn(body, 'coverImageUrl')
    ? String(body.coverImageUrl ?? '').trim()
    : String(current.menu_cover_image_url || '').trim();
  const whatsappPhone = hasOwn(body, 'whatsappPhone')
    ? String(body.whatsappPhone ?? '').trim()
    : String(current.whatsapp_phone || '').trim();
  const issuerName = hasOwn(body, 'issuerName')
    ? String(body.issuerName ?? '').trim()
    : String(current.issuer_name || '').trim();
  const issuerTradeName = hasOwn(body, 'issuerTradeName')
    ? String(body.issuerTradeName ?? '').trim()
    : String(current.issuer_trade_name || '').trim();
  const issuerDocument = hasOwn(body, 'issuerDocument')
    ? String(body.issuerDocument ?? '').trim()
    : String(current.issuer_document || '').trim();
  const issuerStateRegistration = hasOwn(body, 'issuerStateRegistration')
    ? String(body.issuerStateRegistration ?? '').trim()
    : String(current.issuer_state_registration || '').trim();
  const issuerEmail = hasOwn(body, 'issuerEmail')
    ? String(body.issuerEmail ?? '').trim()
    : String(current.issuer_email || '').trim();
  const issuerPhone = hasOwn(body, 'issuerPhone')
    ? String(body.issuerPhone ?? '').trim()
    : String(current.issuer_phone || '').trim();
  const issuerZipCode = hasOwn(body, 'issuerZipCode')
    ? String(body.issuerZipCode ?? '').trim()
    : String(current.issuer_zip_code || '').trim();
  const issuerStreet = hasOwn(body, 'issuerStreet')
    ? String(body.issuerStreet ?? '').trim()
    : String(current.issuer_street || '').trim();
  const issuerNumber = hasOwn(body, 'issuerNumber')
    ? String(body.issuerNumber ?? '').trim()
    : String(current.issuer_number || '').trim();
  const issuerComplement = hasOwn(body, 'issuerComplement')
    ? String(body.issuerComplement ?? '').trim()
    : String(current.issuer_complement || '').trim();
  const issuerNeighborhood = hasOwn(body, 'issuerNeighborhood')
    ? String(body.issuerNeighborhood ?? '').trim()
    : String(current.issuer_neighborhood || '').trim();
  const issuerCity = hasOwn(body, 'issuerCity')
    ? String(body.issuerCity ?? '').trim()
    : String(current.issuer_city || '').trim();
  const issuerState = (hasOwn(body, 'issuerState')
    ? String(body.issuerState ?? '').trim()
    : String(current.issuer_state || '').trim()
  ).toUpperCase();
  const deliveryOriginUseIssuer = hasOwn(body, 'deliveryOriginUseIssuer')
    ? normalizeDeliveryOriginUseIssuer(body.deliveryOriginUseIssuer)
    : Boolean(current.delivery_origin_use_issuer);
  const deliveryOriginZipCode = hasOwn(body, 'deliveryOriginZipCode')
    ? String(body.deliveryOriginZipCode ?? '').trim()
    : String(current.delivery_origin_zip_code || '').trim();
  const deliveryOriginStreet = hasOwn(body, 'deliveryOriginStreet')
    ? String(body.deliveryOriginStreet ?? '').trim()
    : String(current.delivery_origin_street || '').trim();
  const deliveryOriginNumber = hasOwn(body, 'deliveryOriginNumber')
    ? String(body.deliveryOriginNumber ?? '').trim()
    : String(current.delivery_origin_number || '').trim();
  const deliveryOriginComplement = hasOwn(body, 'deliveryOriginComplement')
    ? String(body.deliveryOriginComplement ?? '').trim()
    : String(current.delivery_origin_complement || '').trim();
  const deliveryOriginNeighborhood = hasOwn(body, 'deliveryOriginNeighborhood')
    ? String(body.deliveryOriginNeighborhood ?? '').trim()
    : String(current.delivery_origin_neighborhood || '').trim();
  const deliveryOriginCity = hasOwn(body, 'deliveryOriginCity')
    ? String(body.deliveryOriginCity ?? '').trim()
    : String(current.delivery_origin_city || '').trim();
  const deliveryOriginState = (hasOwn(body, 'deliveryOriginState')
    ? String(body.deliveryOriginState ?? '').trim()
    : String(current.delivery_origin_state || '').trim()
  ).toUpperCase();

  if (!Number.isFinite(prepTimeMinutes) || prepTimeMinutes < 5 || prepTimeMinutes > 180) {
    return NextResponse.json({ error: 'Tempo de preparo deve ficar entre 5 e 180 minutos.' }, { status: 400 });
  }
  if (!Number.isFinite(deliveryFeeBase) || deliveryFeeBase < 0) {
    return NextResponse.json({ error: 'Taxa de entrega invalida.' }, { status: 400 });
  }
  if (!Number.isFinite(deliveryFeePerKm) || deliveryFeePerKm < 0) {
    return NextResponse.json({ error: 'Valor por km invalido.' }, { status: 400 });
  }
  if (
    deliveryFeeMode === 'per_km' &&
    !deliveryOriginUseIssuer &&
    (!deliveryOriginStreet || !deliveryOriginCity || deliveryOriginState.length !== 2)
  ) {
    return NextResponse.json(
      { error: 'Informe rua, cidade e UF para o endereco base da entrega.' },
      { status: 400 },
    );
  }
  const logoImageValidationError = validateImagePayload(logoUrl);
  if (logoImageValidationError) {
    return NextResponse.json({ error: logoImageValidationError }, { status: 400 });
  }
  const coverImageValidationError = validateImagePayload(coverImageUrl);
  if (coverImageValidationError) {
    return NextResponse.json({ error: coverImageValidationError }, { status: 400 });
  }

  await query(
    `UPDATE tenants
     SET prep_time_minutes = $1,
         delivery_fee_base = $2,
         delivery_fee_mode = $3,
         delivery_fee_per_km = $4,
         store_open = $5,
         logo_url = NULLIF($6, ''),
         menu_cover_image_url = NULLIF($7, ''),
         whatsapp_phone = NULLIF($8, ''),
         issuer_name = NULLIF($9, ''),
         issuer_trade_name = NULLIF($10, ''),
         issuer_document = NULLIF($11, ''),
         issuer_state_registration = NULLIF($12, ''),
         issuer_email = NULLIF($13, ''),
         issuer_phone = NULLIF($14, ''),
         issuer_zip_code = NULLIF($15, ''),
         issuer_street = NULLIF($16, ''),
         issuer_number = NULLIF($17, ''),
         issuer_complement = NULLIF($18, ''),
         issuer_neighborhood = NULLIF($19, ''),
         issuer_city = NULLIF($20, ''),
         issuer_state = NULLIF($21, ''),
         delivery_origin_use_issuer = $22,
         delivery_origin_zip_code = NULLIF($23, ''),
         delivery_origin_street = NULLIF($24, ''),
         delivery_origin_number = NULLIF($25, ''),
         delivery_origin_complement = NULLIF($26, ''),
         delivery_origin_neighborhood = NULLIF($27, ''),
         delivery_origin_city = NULLIF($28, ''),
         delivery_origin_state = NULLIF($29, '')
     WHERE id = $30`,
    [
      Math.round(prepTimeMinutes),
      deliveryFeeBase,
      deliveryFeeMode,
      deliveryFeePerKm,
      storeOpen,
      logoUrl,
      coverImageUrl,
      whatsappPhone,
      issuerName,
      issuerTradeName,
      issuerDocument,
      issuerStateRegistration,
      issuerEmail,
      issuerPhone,
      issuerZipCode,
      issuerStreet,
      issuerNumber,
      issuerComplement,
      issuerNeighborhood,
      issuerCity,
      issuerState,
      deliveryOriginUseIssuer,
      deliveryOriginZipCode,
      deliveryOriginStreet,
      deliveryOriginNumber,
      deliveryOriginComplement,
      deliveryOriginNeighborhood,
      deliveryOriginCity,
      deliveryOriginState,
      session.tenantId,
    ],
  );

  return NextResponse.json({
    ok: true,
    prepTimeMinutes: Math.round(prepTimeMinutes),
    deliveryFeeBase,
    deliveryFeeMode,
    deliveryFeePerKm,
    storeOpen,
    logoUrl,
    coverImageUrl,
    whatsappPhone,
    issuerName,
    issuerTradeName,
    issuerDocument,
    issuerStateRegistration,
    issuerEmail,
    issuerPhone,
    issuerZipCode,
    issuerStreet,
    issuerNumber,
    issuerComplement,
    issuerNeighborhood,
    issuerCity,
    issuerState,
    deliveryOriginUseIssuer,
    deliveryOriginZipCode,
    deliveryOriginStreet,
    deliveryOriginNumber,
    deliveryOriginComplement,
    deliveryOriginNeighborhood,
    deliveryOriginCity,
    deliveryOriginState,
  });
}
