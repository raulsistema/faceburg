import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CustomerRow = {
  id: string;
};

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

async function ensureCustomerInTenant(customerId: string, tenantId: string) {
  const result = await query<CustomerRow>(
    `SELECT id FROM customers WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [customerId, tenantId],
  );
  return (result.rowCount || 0) > 0;
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const exists = await ensureCustomerInTenant(id, session.tenantId);
  if (!exists) {
    return NextResponse.json({ error: 'Cliente nao encontrado.' }, { status: 404 });
  }

  const result = await query<AddressRow>(
    `SELECT id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default, created_at
     FROM customer_addresses
     WHERE tenant_id = $1
       AND customer_id = $2
       AND active = TRUE
     ORDER BY is_default DESC, created_at DESC`,
    [session.tenantId, id],
  );

  return NextResponse.json({
    addresses: result.rows.map((row) => ({
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
    })),
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const exists = await ensureCustomerInTenant(id, session.tenantId);
  if (!exists) {
    return NextResponse.json({ error: 'Cliente nao encontrado.' }, { status: 404 });
  }

  const body = await request.json();
  const label = String(body.label || '').trim();
  const street = String(body.street || '').trim();
  const number = String(body.number || '').trim();
  const complement = String(body.complement || '').trim();
  const neighborhood = String(body.neighborhood || '').trim();
  const city = String(body.city || '').trim();
  const state = String(body.state || '').trim();
  const zipCode = String(body.zipCode || '').trim();
  const reference = String(body.reference || '').trim();
  const isDefault = Boolean(body.isDefault);

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
    `INSERT INTO customer_addresses
      (id, tenant_id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default)
     VALUES
      ($1, $2, $3, NULLIF($4, ''), $5, NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), NULLIF($11, ''), NULLIF($12, ''), TRUE, $13)
     RETURNING id, customer_id, label, street, number, complement, neighborhood, city, state, zip_code, reference, active, is_default, created_at`,
    [randomUUID(), session.tenantId, id, label, street, number, complement, neighborhood, city, state, zipCode, reference, isDefault],
  );

  const row = result.rows[0];
  return NextResponse.json(
    {
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
    },
    { status: 201 },
  );
}
