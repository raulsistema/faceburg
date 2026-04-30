import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type AddressRow = {
  id: string;
  customer_id: string;
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  reference: string | null;
  active: boolean;
  is_default: boolean;
  created_at: string;
};

async function loadAddress(addressId: string, customerId: string, tenantId: string) {
  const result = await query<AddressRow>(
    `SELECT id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default, created_at
     FROM customer_addresses
     WHERE id = $1
       AND customer_id = $2
       AND tenant_id = $3
     LIMIT 1`,
    [addressId, customerId, tenantId],
  );
  return result.rows[0] || null;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; addressId: string }> },
) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, addressId } = await params;
  const current = await loadAddress(addressId, id, session.tenantId);
  if (!current) {
    return NextResponse.json({ error: 'Endereco nao encontrado.' }, { status: 404 });
  }

  const body = await request.json();
  const label = String(body.label ?? current.label ?? '').trim();
  const street = String(body.street ?? current.street ?? '').trim();
  const number = String(body.number ?? current.number ?? '').trim();
  const complement = String(body.complement ?? current.complement ?? '').trim();
  const neighborhood = String(body.neighborhood ?? current.neighborhood ?? '').trim();
  const city = String(body.city ?? current.city ?? '').trim();
  const state = String(body.state ?? current.state ?? '').trim();
  const zipCode = String(body.zipCode ?? current.zip_code ?? '').trim();
  const reference = String(body.reference ?? current.reference ?? '').trim();
  const active = body.active === undefined ? current.active : Boolean(body.active);
  const isDefault = body.isDefault === undefined ? current.is_default : Boolean(body.isDefault);

  if (!street) {
    return NextResponse.json({ error: 'Rua do endereco e obrigatoria.' }, { status: 400 });
  }

  if (isDefault) {
    await query(
      `UPDATE customer_addresses
       SET is_default = FALSE
       WHERE tenant_id = $1
         AND customer_id = $2`,
      [session.tenantId, id],
    );
  }

  const result = await query<AddressRow>(
    `UPDATE customer_addresses
     SET label = NULLIF($4, ''),
         street = $5,
         number = NULLIF($6, ''),
         complement = NULLIF($7, ''),
         neighborhood = NULLIF($8, ''),
         city = NULLIF($9, ''),
         state = NULLIF($10, ''),
         zip_code = NULLIF($11, ''),
         reference = NULLIF($12, ''),
         active = $13,
         is_default = $14
     WHERE id = $1
       AND customer_id = $2
       AND tenant_id = $3
     RETURNING id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default, created_at`,
    [addressId, id, session.tenantId, label, street, number, complement, neighborhood, city, state, zipCode, reference, active, isDefault],
  );

  const row = result.rows[0];
  return NextResponse.json({
    address: {
      id: row.id,
      customerId: row.customer_id,
      label: row.label,
      street: row.street,
      number: row.number,
      complement: row.complement,
      neighborhood: row.neighborhood,
      city: row.city,
      state: row.state,
      zipCode: row.zip_code,
      reference: row.reference,
      active: row.active,
      isDefault: row.is_default,
      created_at: row.created_at,
    },
  });
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string; addressId: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id, addressId } = await params;
  const result = await query<{ id: string }>(
    `DELETE FROM customer_addresses
     WHERE id = $1
       AND customer_id = $2
       AND tenant_id = $3
     RETURNING id`,
    [addressId, id, session.tenantId],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Endereco nao encontrado.' }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
