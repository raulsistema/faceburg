import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type CustomerRow = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  is_company: boolean;
  company_name: string | null;
  document_number: string | null;
  tags: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  address_count: string;
};

export async function GET(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const search = String(searchParams.get('search') || '').trim();

  const result = await query<CustomerRow>(
    `SELECT c.id,
            c.name,
            c.phone,
            c.email,
            c.is_company,
            c.company_name,
            c.document_number,
            c.tags,
            c.notes,
            c.status,
            c.created_at,
            COUNT(ca.id)::text AS address_count
     FROM customers c
     LEFT JOIN customer_addresses ca
       ON ca.customer_id = c.id
      AND ca.tenant_id = c.tenant_id
      AND ca.active = TRUE
     WHERE c.tenant_id = $1
       AND (
         $2 = ''
         OR c.name ILIKE '%' || $2 || '%'
         OR c.phone ILIKE '%' || $2 || '%'
         OR (
           regexp_replace($2, '\\D', '', 'g') <> ''
           AND regexp_replace(c.phone, '\\D', '', 'g') LIKE '%' || regexp_replace($2, '\\D', '', 'g') || '%'
         )
       )
     GROUP BY c.id
     ORDER BY c.created_at DESC
     LIMIT 200`,
    [session.tenantId, search],
  );

  return NextResponse.json({
    customers: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      email: row.email,
      isCompany: row.is_company,
      companyName: row.company_name,
      documentNumber: row.document_number,
      tags: row.tags,
      notes: row.notes,
      status: row.status,
      created_at: row.created_at,
      addressCount: Number(row.address_count || 0),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const isCompany = Boolean(body.isCompany);
  const companyName = String(body.companyName || '').trim();
  const documentNumber = String(body.documentNumber || '').trim();
  const tags = String(body.tags || '').trim();
  const notes = String(body.notes || '').trim();

  if (!name || !phone) {
    return NextResponse.json({ error: 'Nome e telefone são obrigatórios.' }, { status: 400 });
  }

  try {
    const result = await query<CustomerRow>(
      `INSERT INTO customers (
        id, tenant_id, name, phone, email, is_company, company_name, document_number, tags, notes, status
       )
       VALUES (
        $1, $2, $3, $4, NULLIF($5, ''), $6, NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), 'active'
       )
       RETURNING
        id, name, phone, email, is_company, company_name, document_number, tags, notes, status, created_at, '0'::text AS address_count`,
      [randomUUID(), session.tenantId, name, phone, email, isCompany, companyName, documentNumber, tags, notes],
    );
    const row = result.rows[0];
    return NextResponse.json(
      {
        customer: {
          id: row.id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          isCompany: row.is_company,
          companyName: row.company_name,
          documentNumber: row.document_number,
          tags: row.tags,
          notes: row.notes,
          status: row.status,
          created_at: row.created_at,
          addressCount: 0,
        },
      },
      { status: 201 },
    );
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'Já existe cliente com este telefone.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao cadastrar cliente.' }, { status: 500 });
  }
}
