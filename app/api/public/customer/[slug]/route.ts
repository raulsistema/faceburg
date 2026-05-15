import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { checkRateLimit } from '@/lib/rate-limit';

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

type AddressDeleteRow = {
  id: string;
  was_default: boolean;
};

const NO_STORE_HEADERS = {
  'cache-control': 'no-store',
};

class PublicCustomerRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super('Muitas tentativas. Aguarde um pouco e tente novamente.');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits.replace(/^0+/, '');
}

function normalizeLookupName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isValidLookupName(value: string) {
  return normalizeLookupName(value).replace(/\s/g, '').length >= 2;
}

function customerNameMatches(storedName: string, inputName: string) {
  const stored = normalizeLookupName(storedName);
  const input = normalizeLookupName(inputName);
  if (!stored || !input || input.replace(/\s/g, '').length < 2) {
    return false;
  }
  if (stored === input) {
    return true;
  }

  const storedTokens = stored.split(' ').filter(Boolean);
  const inputTokens = input.split(' ').filter(Boolean);
  if (!storedTokens.length || !inputTokens.length) {
    return false;
  }

  const storedFirstToken = storedTokens[0];
  const inputFirstToken = inputTokens[0];
  const firstTokenMatches =
    storedFirstToken === inputFirstToken ||
    (inputFirstToken.length >= 3 && storedFirstToken.startsWith(inputFirstToken)) ||
    (storedFirstToken.length >= 3 && inputFirstToken.startsWith(storedFirstToken));

  if (inputTokens.length === 1) {
    return firstTokenMatches;
  }

  if (!firstTokenMatches) {
    return false;
  }

  return true;
}

function emptyLookupResponse() {
  return {
    found: false,
    customer: null,
    addresses: [],
  };
}

function getClientIp(request: Request) {
  return (
    request.headers.get('x-real-ip')
    || request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown'
  );
}

async function enforcePublicCustomerRateLimit(request: Request, tenantId: string, phone: string) {
  const clientIp = getClientIp(request);
  const [ipLimit, phoneLimit] = await Promise.all([
    checkRateLimit({
      key: `public-customer:${tenantId}:ip:${clientIp}`,
      limit: 120,
      windowSeconds: 60,
    }),
    checkRateLimit({
      key: `public-customer:${tenantId}:phone:${phone}`,
      limit: 30,
      windowSeconds: 10 * 60,
    }),
  ]);

  if (!ipLimit.allowed || !phoneLimit.allowed) {
    throw new PublicCustomerRateLimitError(Math.max(ipLimit.retryAfterSeconds, phoneLimit.retryAfterSeconds));
  }
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

async function findCustomerByPhoneAndName(tenantId: string, phone: string, name: string) {
  if (phone.length < 10 || !isValidLookupName(name)) {
    return null;
  }

  const customerRows = await loadCustomersByPhone(tenantId, phone);
  return customerRows.find((customer) => customerNameMatches(customer.name, name)) || null;
}

async function loadCustomersByPhone(tenantId: string, phone: string) {
  const customerResult = await query<CustomerRow>(
    `SELECT id, name, phone, email, is_company, company_name
     FROM customers
     WHERE tenant_id = $1
       AND regexp_replace(phone, '\D', '', 'g') = $2
     ORDER BY created_at ASC
     LIMIT 25`,
    [tenantId, phone],
  );

  return customerResult.rows;
}

async function loadCustomerAndAddresses(tenantId: string, phone: string, name: string) {
  const customer = await findCustomerByPhoneAndName(tenantId, phone, name);
  if (!customer) {
    return emptyLookupResponse();
  }

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

function rateLimitResponse(error: PublicCustomerRateLimitError) {
  return NextResponse.json(
    { error: error.message },
    {
      status: 429,
      headers: {
        ...NO_STORE_HEADERS,
        'retry-after': String(error.retryAfterSeconds),
      },
    },
  );
}

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const phone = normalizePhone(String(searchParams.get('phone') || '').trim());
    const name = String(searchParams.get('name') || '').trim();

    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    if (phone.length >= 10) {
      await enforcePublicCustomerRateLimit(request, tenant.id, phone);
    }
    if (phone.length < 10 || !isValidLookupName(name)) {
      return NextResponse.json(emptyLookupResponse(), { headers: NO_STORE_HEADERS });
    }

    const result = await loadCustomerAndAddresses(tenant.id, phone, name);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof PublicCustomerRateLimitError) {
      return rateLimitResponse(error);
    }
    console.error('[public-customer] failed to load customer', error);
    return NextResponse.json({ error: 'Falha ao carregar cadastro.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    let body: Record<string, unknown> = {};

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Corpo da requisicao invalido.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const name = String(body.name || '').trim();
    const phone = normalizePhone(String(body.phone || '').trim());
    const email = String(body.email || '').trim();

    if (!isValidLookupName(name) || phone.length < 10) {
      return NextResponse.json({ error: 'Nome e celular validos sao obrigatorios.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    await enforcePublicCustomerRateLimit(request, tenant.id, phone);

    const phoneCustomers = await loadCustomersByPhone(tenant.id, phone);
    const matchingCustomer = phoneCustomers.find((customer) => customerNameMatches(customer.name, name)) || null;
    const existingPhoneCustomer = phoneCustomers[0] || null;
    if (matchingCustomer) {
      await query(
        `UPDATE customers
         SET phone = $3,
             email = COALESCE(NULLIF($4, ''), email),
             status = 'active'
         WHERE id = $1
           AND tenant_id = $2`,
        [matchingCustomer.id, tenant.id, phone, email],
      );
    } else if (existingPhoneCustomer) {
      return NextResponse.json(emptyLookupResponse(), { headers: NO_STORE_HEADERS });
    } else {
      await query(
        `INSERT INTO customers (id, tenant_id, name, phone, email, status)
         VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'active')`,
        [randomUUID(), tenant.id, name, phone, email],
      );
    }

    const result = await loadCustomerAndAddresses(tenant.id, phone, name);
    return NextResponse.json(result, { status: matchingCustomer ? 200 : 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof PublicCustomerRateLimitError) {
      return rateLimitResponse(error);
    }
    console.error('[public-customer] failed to save customer', error);
    return NextResponse.json({ error: 'Falha ao salvar cadastro.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    let body: Record<string, unknown> = {};

    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Corpo da requisicao invalido.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const name = String(body.name || '').trim();
    const phone = normalizePhone(String(body.phone || '').trim());
    const addressId = String(body.addressId || '').trim();

    if (phone.length < 10 || !addressId || !isValidLookupName(name)) {
      return NextResponse.json({ error: 'Celular, nome e endereco validos sao obrigatorios.' }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const tenant = await getTenantBySlug(slug);
    if (!tenant) {
      return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404, headers: NO_STORE_HEADERS });
    }
    if (tenant.status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa.' }, { status: 403, headers: NO_STORE_HEADERS });
    }

    await enforcePublicCustomerRateLimit(request, tenant.id, phone);

    const customer = await findCustomerByPhoneAndName(tenant.id, phone, name);
    if (!customer) {
      return NextResponse.json({ error: 'Cliente nao encontrado.' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    const deletedAddressResult = await query<AddressDeleteRow>(
      `WITH target AS (
         SELECT id, is_default
         FROM customer_addresses
         WHERE id = $1
           AND tenant_id = $2
           AND customer_id = $3
           AND active = TRUE
         LIMIT 1
       ),
       updated AS (
         UPDATE customer_addresses address
         SET active = FALSE,
             is_default = FALSE
         FROM target
         WHERE address.id = target.id
         RETURNING address.id, target.is_default AS was_default
       )
       SELECT id, was_default
       FROM updated`,
      [addressId, tenant.id, customer.id],
    );

    if (!deletedAddressResult.rowCount) {
      return NextResponse.json({ error: 'Endereco nao encontrado.' }, { status: 404, headers: NO_STORE_HEADERS });
    }

    if (deletedAddressResult.rows[0].was_default) {
      await query(
        `UPDATE customer_addresses
         SET is_default = TRUE
         WHERE id = (
           SELECT id
           FROM customer_addresses
           WHERE tenant_id = $1
             AND customer_id = $2
             AND active = TRUE
           ORDER BY created_at DESC
           LIMIT 1
         )`,
        [tenant.id, customer.id],
      );
    }

    const result = await loadCustomerAndAddresses(tenant.id, phone, name);
    return NextResponse.json(result, { headers: NO_STORE_HEADERS });
  } catch (error) {
    if (error instanceof PublicCustomerRateLimitError) {
      return rateLimitResponse(error);
    }
    console.error('[public-customer] failed to delete address', error);
    return NextResponse.json({ error: 'Falha ao remover endereco.' }, { status: 500, headers: NO_STORE_HEADERS });
  }
}
