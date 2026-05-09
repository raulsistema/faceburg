import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  normalizeDeliveryFeeMode,
  normalizeDeliveryFeeTable,
  normalizeDeliveryMaxDistanceMeters,
  normalizeDeliveryOriginUseIssuer,
} from '@/lib/delivery-fee';
import { parseMoneyInput } from '@/lib/finance-utils';
import { normalizeOrderNotificationSound } from '@/lib/order-notification-sounds';
import { ensureOrderSequenceSchema } from '@/lib/order-sequence';
import {
  ensureStoreHoursSchema,
  isMenuOpenNow,
  normalizeMenuHours,
  normalizeMenuOpenMode,
  type MenuHoursConfig,
  type MenuOpenMode,
} from '@/lib/store-hours';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type TenantSettingsRow = {
  prep_time_minutes: number;
  delivery_fee_base: string;
  delivery_fee_mode: string;
  delivery_fee_per_km: string;
  delivery_fee_table: unknown;
  delivery_max_distance_meters: number | string | null;
  delivery_min_order_amount: string | null;
  store_open: boolean;
  menu_open_mode: string | null;
  menu_hours: unknown;
  order_notification_sound: string | null;
  order_sequence_start: number | null;
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
  deliveryFeeMode: 'fixed' | 'per_km' | 'distance_table';
  deliveryFeePerKm: number;
  deliveryFeeTable: Array<{ upToMeters: number; fee: number }>;
  deliveryMaxDistanceKm: number;
  deliveryMinOrderAmount: number;
  storeOpen: boolean;
  effectiveStoreOpen: boolean;
  menuOpenMode: MenuOpenMode;
  menuHours: MenuHoursConfig;
  orderNotificationSound: string;
  orderSequenceStart: number | null;
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
  delivery_fee_table,
  delivery_max_distance_meters,
  delivery_min_order_amount::text,
  store_open,
  menu_open_mode,
  menu_hours,
  order_notification_sound,
  order_sequence_start,
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

function metersToKm(value: unknown) {
  const meters = normalizeDeliveryMaxDistanceMeters(value);
  return Number((meters / 1000).toFixed(2));
}

function parseDeliveryMaxDistanceMeters(value: unknown) {
  const parsed = parseMoneyInput(value);
  if (!Number.isFinite(parsed)) return Number.NaN;
  if (parsed <= 0) return 0;
  return Math.round(parsed * 1000);
}

function normalizeOrderSequenceStart(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const parsed = Math.round(Number(raw));
  if (!Number.isFinite(parsed)) return Number.NaN;
  return parsed;
}

function serializeTenantSettings(row: TenantSettingsRow): CardapioSettingsResponse {
  return {
    prepTimeMinutes: Number(row.prep_time_minutes || 40),
    deliveryFeeBase: Number(row.delivery_fee_base || 5),
    deliveryFeeMode: normalizeDeliveryFeeMode(row.delivery_fee_mode),
    deliveryFeePerKm: Number(row.delivery_fee_per_km || 0),
    deliveryFeeTable: normalizeDeliveryFeeTable(row.delivery_fee_table),
    deliveryMaxDistanceKm: metersToKm(row.delivery_max_distance_meters),
    deliveryMinOrderAmount: Number(row.delivery_min_order_amount || 0),
    storeOpen: Boolean(row.store_open),
    effectiveStoreOpen: isMenuOpenNow({
      manualOpen: Boolean(row.store_open),
      mode: row.menu_open_mode,
      hours: row.menu_hours,
    }),
    menuOpenMode: normalizeMenuOpenMode(row.menu_open_mode),
    menuHours: normalizeMenuHours(row.menu_hours),
    orderNotificationSound: normalizeOrderNotificationSound(row.order_notification_sound),
    orderSequenceStart: row.order_sequence_start ?? null,
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
  await ensureOrderSequenceSchema();
  await ensureStoreHoursSchema();
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
  await ensureOrderSequenceSchema();
  await ensureStoreHoursSchema();
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
  const deliveryFeeTable = hasOwn(body, 'deliveryFeeTable')
    ? normalizeDeliveryFeeTable(body.deliveryFeeTable)
    : normalizeDeliveryFeeTable(current.delivery_fee_table);
  const deliveryMaxDistanceMeters = hasOwn(body, 'deliveryMaxDistanceKm')
    ? parseDeliveryMaxDistanceMeters(body.deliveryMaxDistanceKm)
    : normalizeDeliveryMaxDistanceMeters(current.delivery_max_distance_meters);
  const deliveryMinOrderAmount = hasOwn(body, 'deliveryMinOrderAmount')
    ? parseMoneyInput(body.deliveryMinOrderAmount)
    : Number(current.delivery_min_order_amount || 0);
  const storeOpen = hasOwn(body, 'storeOpen')
    ? Boolean(body.storeOpen)
    : Boolean(current.store_open);
  const menuOpenMode = hasOwn(body, 'menuOpenMode')
    ? normalizeMenuOpenMode(body.menuOpenMode)
    : normalizeMenuOpenMode(current.menu_open_mode);
  const menuHours = hasOwn(body, 'menuHours')
    ? normalizeMenuHours(body.menuHours)
    : normalizeMenuHours(current.menu_hours);
  const orderNotificationSound = hasOwn(body, 'orderNotificationSound')
    ? normalizeOrderNotificationSound(body.orderNotificationSound)
    : normalizeOrderNotificationSound(current.order_notification_sound);
  const orderSequenceStart = hasOwn(body, 'orderSequenceStart')
    ? normalizeOrderSequenceStart(body.orderSequenceStart)
    : current.order_sequence_start;
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
  if (deliveryFeeMode === 'distance_table' && deliveryFeeTable.length === 0) {
    return NextResponse.json({ error: 'Cadastre pelo menos uma faixa de entrega.' }, { status: 400 });
  }
  if (!Number.isFinite(deliveryMaxDistanceMeters) || deliveryMaxDistanceMeters < 0 || deliveryMaxDistanceMeters > 200_000) {
    return NextResponse.json({ error: 'Raio maximo de entrega deve ficar entre 0 e 200 km.' }, { status: 400 });
  }
  if (!Number.isFinite(deliveryMinOrderAmount) || deliveryMinOrderAmount < 0 || deliveryMinOrderAmount > 999_999) {
    return NextResponse.json({ error: 'Pedido minimo para entrega invalido.' }, { status: 400 });
  }
  if (orderSequenceStart !== null && (!Number.isFinite(orderSequenceStart) || orderSequenceStart < 1 || orderSequenceStart > 999_999)) {
    return NextResponse.json({ error: 'Sequencia de pedidos deve comecar entre 1 e 999999.' }, { status: 400 });
  }
  if (
    (deliveryFeeMode !== 'fixed' || deliveryMaxDistanceMeters > 0) &&
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
         delivery_fee_table = $5::jsonb,
         delivery_max_distance_meters = $6,
         delivery_min_order_amount = $7,
         store_open = $8,
         menu_open_mode = $9,
         menu_hours = $10::jsonb,
         order_notification_sound = $11,
         order_sequence_start = $12,
         logo_url = NULLIF($13, ''),
         menu_cover_image_url = NULLIF($14, ''),
         whatsapp_phone = NULLIF($15, ''),
         issuer_name = NULLIF($16, ''),
         issuer_trade_name = NULLIF($17, ''),
         issuer_document = NULLIF($18, ''),
         issuer_state_registration = NULLIF($19, ''),
         issuer_email = NULLIF($20, ''),
         issuer_phone = NULLIF($21, ''),
         issuer_zip_code = NULLIF($22, ''),
         issuer_street = NULLIF($23, ''),
         issuer_number = NULLIF($24, ''),
         issuer_complement = NULLIF($25, ''),
         issuer_neighborhood = NULLIF($26, ''),
         issuer_city = NULLIF($27, ''),
         issuer_state = NULLIF($28, ''),
         delivery_origin_use_issuer = $29,
         delivery_origin_zip_code = NULLIF($30, ''),
         delivery_origin_street = NULLIF($31, ''),
         delivery_origin_number = NULLIF($32, ''),
         delivery_origin_complement = NULLIF($33, ''),
         delivery_origin_neighborhood = NULLIF($34, ''),
         delivery_origin_city = NULLIF($35, ''),
         delivery_origin_state = NULLIF($36, '')
     WHERE id = $37`,
    [
      Math.round(prepTimeMinutes),
      deliveryFeeBase,
      deliveryFeeMode,
      deliveryFeePerKm,
      JSON.stringify(deliveryFeeTable),
      deliveryMaxDistanceMeters,
      deliveryMinOrderAmount,
      storeOpen,
      menuOpenMode,
      JSON.stringify(menuHours),
      orderNotificationSound,
      orderSequenceStart,
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
    deliveryFeeTable,
    deliveryMaxDistanceKm: metersToKm(deliveryMaxDistanceMeters),
    deliveryMinOrderAmount,
    storeOpen,
    effectiveStoreOpen: isMenuOpenNow({
      manualOpen: storeOpen,
      mode: menuOpenMode,
      hours: menuHours,
    }),
    menuOpenMode,
    menuHours,
    orderNotificationSound,
    orderSequenceStart,
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
