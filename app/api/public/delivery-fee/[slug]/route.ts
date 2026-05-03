import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { quoteDeliveryFee } from '@/lib/delivery-fee';

type TenantRow = {
  id: string;
  slug: string;
  status: string;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_neighborhood: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
  issuer_zip_code: string | null;
  delivery_origin_use_issuer: boolean;
  delivery_origin_street: string | null;
  delivery_origin_number: string | null;
  delivery_origin_complement: string | null;
  delivery_origin_neighborhood: string | null;
  delivery_origin_city: string | null;
  delivery_origin_state: string | null;
  delivery_origin_zip_code: string | null;
  delivery_fee_base: string;
  delivery_fee_mode: string;
  delivery_fee_per_km: string;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;

    const tenantResult = await query<TenantRow>(
      `SELECT
         id,
         slug,
         status,
         issuer_street,
         issuer_number,
         issuer_neighborhood,
         issuer_city,
         issuer_state,
         issuer_zip_code,
         delivery_origin_use_issuer,
         delivery_origin_street,
         delivery_origin_number,
         delivery_origin_complement,
         delivery_origin_neighborhood,
         delivery_origin_city,
         delivery_origin_state,
         delivery_origin_zip_code,
         delivery_fee_base::text,
         delivery_fee_mode,
         delivery_fee_per_km::text
       FROM tenants
       WHERE slug = $1
       LIMIT 1`,
      [slug],
    );

    if (!tenantResult.rowCount) {
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
    }

    const tenant = tenantResult.rows[0];
    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
    }

    let body: Record<string, unknown> = {};
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }

    const orderType = text(body.orderType).toLowerCase();
    if (orderType && orderType !== 'delivery') {
      return NextResponse.json({
        deliveryFeeAmount: 0,
        distanceKm: null,
        deliveryFeeMode: 'fixed',
        deliveryFeePerKm: 0,
        usedFallback: false,
      });
    }

    const addressInput =
      body.address && typeof body.address === 'object'
        ? {
            street: text((body.address as Record<string, unknown>).street),
            number: text((body.address as Record<string, unknown>).number),
            neighborhood: text((body.address as Record<string, unknown>).neighborhood),
            city: text((body.address as Record<string, unknown>).city),
            state: text((body.address as Record<string, unknown>).state).toUpperCase(),
            zipCode: text((body.address as Record<string, unknown>).zipCode),
            reference: text((body.address as Record<string, unknown>).reference),
            freeform: text(body.deliveryAddress),
          }
        : {
            freeform: text(body.deliveryAddress),
          };

    const quote = await quoteDeliveryFee(
      {
        slug: tenant.slug,
        issuerStreet: tenant.issuer_street,
        issuerNumber: tenant.issuer_number,
        issuerNeighborhood: tenant.issuer_neighborhood,
        issuerCity: tenant.issuer_city,
        issuerState: tenant.issuer_state,
        issuerZipCode: tenant.issuer_zip_code,
        deliveryOriginUseIssuer: tenant.delivery_origin_use_issuer,
        deliveryOriginStreet: tenant.delivery_origin_street,
        deliveryOriginNumber: tenant.delivery_origin_number,
        deliveryOriginComplement: tenant.delivery_origin_complement,
        deliveryOriginNeighborhood: tenant.delivery_origin_neighborhood,
        deliveryOriginCity: tenant.delivery_origin_city,
        deliveryOriginState: tenant.delivery_origin_state,
        deliveryOriginZipCode: tenant.delivery_origin_zip_code,
        deliveryFeeBase: tenant.delivery_fee_base,
        deliveryFeeMode: tenant.delivery_fee_mode,
        deliveryFeePerKm: tenant.delivery_fee_per_km,
      },
      addressInput,
    );

    return NextResponse.json(quote);
  } catch (error) {
    console.error('[public-delivery-fee] failed to quote delivery fee', error);
    return NextResponse.json({ error: 'Falha ao calcular taxa de entrega.' }, { status: 500 });
  }
}
