import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
  fee_percent: string;
  fee_fixed: string;
  settlement_days: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

function mapRow(row: PaymentMethodRow) {
  return {
    id: row.id,
    name: row.name,
    methodType: row.method_type,
    feePercent: Number(row.fee_percent || 0),
    feeFixed: Number(row.fee_fixed || 0),
    settlementDays: Number(row.settlement_days || 0),
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<PaymentMethodRow>(
    `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days, active, created_at, updated_at
     FROM payment_methods
     WHERE tenant_id = $1
     ORDER BY active DESC, name ASC`,
    [session.tenantId],
  );

  return NextResponse.json({ paymentMethods: result.rows.map(mapRow) });
}

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const name = String(body.name || '').trim();
  const methodType = String(body.methodType || '').trim().toLowerCase();
  const feePercent = Number(body.feePercent || 0);
  const feeFixed = Number(body.feeFixed || 0);
  const settlementDays = Number(body.settlementDays || 0);
  const active = body.active !== false;

  if (!name) {
    return NextResponse.json({ error: 'Nome da forma de pagamento e obrigatorio.' }, { status: 400 });
  }

  if (!['pix', 'cash', 'card', 'bank_slip', 'wallet', 'other'].includes(methodType)) {
    return NextResponse.json({ error: 'Tipo de pagamento invalido.' }, { status: 400 });
  }

  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
    return NextResponse.json({ error: 'Taxa percentual invalida.' }, { status: 400 });
  }

  if (!Number.isFinite(feeFixed) || feeFixed < 0) {
    return NextResponse.json({ error: 'Taxa fixa invalida.' }, { status: 400 });
  }

  if (!Number.isFinite(settlementDays) || settlementDays < 0 || settlementDays > 365) {
    return NextResponse.json({ error: 'Dias de recebimento invalidos.' }, { status: 400 });
  }

  const id = randomUUID();
  const result = await query<PaymentMethodRow>(
    `INSERT INTO payment_methods (id, tenant_id, name, method_type, fee_percent, fee_fixed, settlement_days, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days, active, created_at, updated_at`,
    [id, session.tenantId, name, methodType, feePercent, feeFixed, settlementDays, active],
  );

  return NextResponse.json({ paymentMethod: mapRow(result.rows[0]) }, { status: 201 });
}

export async function PATCH(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const id = String(body.id || '').trim();
  const name = String(body.name || '').trim();
  const methodType = String(body.methodType || '').trim().toLowerCase();
  const feePercent = Number(body.feePercent || 0);
  const feeFixed = Number(body.feeFixed || 0);
  const settlementDays = Number(body.settlementDays || 0);
  const active = body.active !== false;

  if (!id) {
    return NextResponse.json({ error: 'ID obrigatorio.' }, { status: 400 });
  }

  if (!name) {
    return NextResponse.json({ error: 'Nome da forma de pagamento e obrigatorio.' }, { status: 400 });
  }

  if (!['pix', 'cash', 'card', 'bank_slip', 'wallet', 'other'].includes(methodType)) {
    return NextResponse.json({ error: 'Tipo de pagamento invalido.' }, { status: 400 });
  }

  if (!Number.isFinite(feePercent) || feePercent < 0 || feePercent > 100) {
    return NextResponse.json({ error: 'Taxa percentual invalida.' }, { status: 400 });
  }

  if (!Number.isFinite(feeFixed) || feeFixed < 0) {
    return NextResponse.json({ error: 'Taxa fixa invalida.' }, { status: 400 });
  }

  if (!Number.isFinite(settlementDays) || settlementDays < 0 || settlementDays > 365) {
    return NextResponse.json({ error: 'Dias de recebimento invalidos.' }, { status: 400 });
  }

  const result = await query<PaymentMethodRow>(
    `UPDATE payment_methods
     SET name = $3,
         method_type = $4,
         fee_percent = $5,
         fee_fixed = $6,
         settlement_days = $7,
         active = $8,
         updated_at = NOW()
     WHERE id = $1 AND tenant_id = $2
     RETURNING id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days, active, created_at, updated_at`,
    [id, session.tenantId, name, methodType, feePercent, feeFixed, settlementDays, active],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Forma de pagamento nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ paymentMethod: mapRow(result.rows[0]) });
}
