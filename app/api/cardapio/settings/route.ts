import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TenantSettingsRow = {
  prep_time_minutes: number;
  delivery_fee_base: string;
  store_open: boolean;
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
};

const SETTINGS_SELECT_SQL = `SELECT
  prep_time_minutes,
  delivery_fee_base::text,
  store_open,
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
  issuer_state
 FROM tenants
 WHERE id = $1
 LIMIT 1`;

function hasOwn(body: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(body, key);
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
  return NextResponse.json({
    prepTimeMinutes: Number(row.prep_time_minutes || 40),
    deliveryFeeBase: Number(row.delivery_fee_base || 5),
    storeOpen: Boolean(row.store_open),
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
  });
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
    ? Number(body.deliveryFeeBase)
    : Number(current.delivery_fee_base || 0);
  const storeOpen = hasOwn(body, 'storeOpen')
    ? Boolean(body.storeOpen)
    : Boolean(current.store_open);
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

  if (!Number.isFinite(prepTimeMinutes) || prepTimeMinutes < 5 || prepTimeMinutes > 180) {
    return NextResponse.json({ error: 'Tempo de preparo deve ficar entre 5 e 180 minutos.' }, { status: 400 });
  }
  if (!Number.isFinite(deliveryFeeBase) || deliveryFeeBase < 0) {
    return NextResponse.json({ error: 'Taxa de entrega invalida.' }, { status: 400 });
  }

  await query(
    `UPDATE tenants
     SET prep_time_minutes = $1,
         delivery_fee_base = $2,
         store_open = $3,
         whatsapp_phone = NULLIF($4, ''),
         issuer_name = NULLIF($5, ''),
         issuer_trade_name = NULLIF($6, ''),
         issuer_document = NULLIF($7, ''),
         issuer_state_registration = NULLIF($8, ''),
         issuer_email = NULLIF($9, ''),
         issuer_phone = NULLIF($10, ''),
         issuer_zip_code = NULLIF($11, ''),
         issuer_street = NULLIF($12, ''),
         issuer_number = NULLIF($13, ''),
         issuer_complement = NULLIF($14, ''),
         issuer_neighborhood = NULLIF($15, ''),
         issuer_city = NULLIF($16, ''),
         issuer_state = NULLIF($17, '')
     WHERE id = $18`,
    [
      Math.round(prepTimeMinutes),
      deliveryFeeBase,
      storeOpen,
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
      session.tenantId,
    ],
  );

  return NextResponse.json({ ok: true });
}
