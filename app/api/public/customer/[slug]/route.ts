import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type TenantRow = {
  id: string;
  status: string;
};

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  is_company: boolean;
  company_name: string | null;
  document_number: string | null;
};

type AddressRow = {
  id: string;
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  reference: string | null;
  is_default: boolean;
};

function normalizePhone(value: string) {
  return value.replace(/\D/g, '');
}

async function getTenantBySlug(slug: string) {
  const tenantResult = await query<TenantRow>(
    `SELECT id, status
     FROM tenants
     WHERE slug = $1
     LIMIT 1`,
    [slug],
  );
  if (!tenantResult.rowCount) {
    return null;
  }
  return tenantResult.rows[0];
}

async function loadCustomerAndAddresses(tenantId: string, phone: string) {
  if (phone.length < 10) {
    return { found: false, customer: null, addresses: [] };
  }
  const customerResult = await query<CustomerRow>(
    `SELECT id, name, phone, email, is_company, company_name, document_number
     FROM customers
     WHERE tenant_id = $1
       AND regexp_replace(phone, '\D', '', 'g') = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenantId, phone],
  );

  if (!customerResult.rowCount) {
    return { found: false, customer: null, addresses: [] };
  }

  const customer = customerResult.rows[0];
  const addressesResult = await query<AddressRow>(
    `SELECT id, label, street, number, complement, neighborhood, city, state, zip_code, reference, is_default
     FROM customer_addresses
     WHERE tenant_id = $1
       AND customer_id = $2
       AND active = TRUE
     ORDER BY is_default DESC, created_at DESC`,
    [tenantId, customer.id],
  );

  return {
    found: true,
    customer: {
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      email: customer.email,
      isCompany: customer.is_company,
      companyName: customer.company_name,
      documentNumber: customer.document_number,
    },
    addresses: addressesResult.rows.map((address) => ({
      id: address.id,
      label: address.label,
      street: address.street,
      number: address.number,
      complement: address.complement,
      neighborhood: address.neighborhood,
      city: address.city,
      state: address.state,
      zipCode: address.zip_code,
      reference: address.reference,
      isDefault: address.is_default,
    })),
  };
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { searchParams } = new URL(request.url);
  const phone = normalizePhone(String(searchParams.get('phone') || '').trim());

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
  }
  if (tenant.status !== 'active') {
    return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
  }

  const result = await loadCustomerAndAddresses(tenant.id, phone);
  return NextResponse.json(result);
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const body = await request.json();
  const name = String(body.name || '').trim();
  const phone = normalizePhone(String(body.phone || '').trim());
  const email = String(body.email || '').trim();

  if (!name || phone.length < 10) {
    return NextResponse.json({ error: 'Nome e celular validos sao obrigatorios.' }, { status: 400 });
  }

  const tenant = await getTenantBySlug(slug);
  if (!tenant) {
    return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
  }
  if (tenant.status !== 'active') {
    return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403 });
  }

  const existingCustomerResult = await query<{ id: string }>(
    `SELECT id
     FROM customers
     WHERE tenant_id = $1
       AND regexp_replace(phone, '\D', '', 'g') = $2
     ORDER BY created_at ASC
     LIMIT 1`,
    [tenant.id, phone],
  );

  if (existingCustomerResult.rowCount) {
    await query(
      `UPDATE customers
       SET name = $3,
           phone = $4,
           email = COALESCE(NULLIF($5, ''), email),
           status = 'active'
       WHERE id = $1
         AND tenant_id = $2`,
      [existingCustomerResult.rows[0].id, tenant.id, name, phone, email],
    );
  } else {
    await query(
      `INSERT INTO customers (id, tenant_id, name, phone, email, status)
       VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'active')`,
      [randomUUID(), tenant.id, name, phone, email],
    );
  }

  const result = await loadCustomerAndAddresses(tenant.id, phone);
  return NextResponse.json(result, { status: 201 });
}
