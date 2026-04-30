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
};

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const email = String(body.email || '').trim();
  const isCompany = Boolean(body.isCompany);
  const companyName = String(body.companyName || '').trim();
  const documentNumber = String(body.documentNumber || '').trim();
  const tags = String(body.tags || '').trim();
  const notes = String(body.notes || '').trim();
  const status = String(body.status || 'active').trim();

  if (!name || !phone) {
    return NextResponse.json({ error: 'Nome e telefone são obrigatórios.' }, { status: 400 });
  }

  try {
    const result = await query<CustomerRow>(
      `UPDATE customers
       SET name = $3,
           phone = $4,
           email = NULLIF($5, ''),
           is_company = $6,
           company_name = NULLIF($7, ''),
           document_number = NULLIF($8, ''),
           tags = NULLIF($9, ''),
           notes = NULLIF($10, ''),
           status = $11
       WHERE id = $1 AND tenant_id = $2
       RETURNING id, name, phone, email, is_company, company_name, document_number, tags, notes, status, created_at`,
      [id, session.tenantId, name, phone, email, isCompany, companyName, documentNumber, tags, notes, status],
    );

    if (!result.rowCount) {
      return NextResponse.json({ error: 'Cliente não encontrado.' }, { status: 404 });
    }

    const row = result.rows[0];
    return NextResponse.json({
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
      },
    });
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'Já existe cliente com este telefone.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao atualizar cliente.' }, { status: 500 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  try {
    const result = await query('DELETE FROM customers WHERE id = $1 AND tenant_id = $2', [id, session.tenantId]);

    if (!result.rowCount) {
      return NextResponse.json({ error: 'Cliente nao encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Falha ao excluir cliente.' }, { status: 500 });
  }
}
