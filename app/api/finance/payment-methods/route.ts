import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { normalizePaymentMethodType, parseIntegerInput, parseMoneyInput } from '@/lib/finance-utils';
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

async function hasDuplicatePaymentMethodName(tenantId: string, name: string, id?: string) {
  const result = await query<{ id: string }>(
    `SELECT id
     FROM payment_methods
     WHERE tenant_id = $1
       AND lower(trim(name)) = lower(trim($2))
       AND ($3::text IS NULL OR id <> $3)
     LIMIT 1`,
    [tenantId, name, id || null],
  );
  return Boolean(result.rowCount);
}

function readPaymentMethodInput(body: Record<string, unknown>) {
  return {
    id: String(body.id || '').trim(),
    name: String(body.name || '').trim(),
    methodType: normalizePaymentMethodType(body.methodType),
    feePercent: parseMoneyInput(body.feePercent),
    feeFixed: parseMoneyInput(body.feeFixed),
    settlementDays: parseIntegerInput(body.settlementDays),
    active: body.active !== false,
  };
}

function validatePaymentMethodInput(input: ReturnType<typeof readPaymentMethodInput>, requireId = false) {
  if (requireId && !input.id) return 'ID obrigatorio.';
  if (!input.name) return 'Nome da forma de pagamento e obrigatorio.';
  if (!input.methodType) return 'Tipo de pagamento invalido.';
  if (!Number.isFinite(input.feePercent) || input.feePercent < 0 || input.feePercent > 100) return 'Taxa percentual invalida.';
  if (!Number.isFinite(input.feeFixed) || input.feeFixed < 0) return 'Taxa fixa invalida.';
  if (!Number.isFinite(input.settlementDays) || input.settlementDays < 0 || input.settlementDays > 365) return 'Dias de recebimento invalidos.';
  return '';
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

  const body = (await request.json()) as Record<string, unknown>;
  const input = readPaymentMethodInput(body);
  const validationError = validatePaymentMethodInput(input);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (await hasDuplicatePaymentMethodName(session.tenantId, input.name)) {
    return NextResponse.json({ error: 'Ja existe uma forma de pagamento com esse nome.' }, { status: 409 });
  }

  const id = randomUUID();
  const result = await query<PaymentMethodRow>(
    `INSERT INTO payment_methods (id, tenant_id, name, method_type, fee_percent, fee_fixed, settlement_days, active, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
     RETURNING id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days, active, created_at, updated_at`,
    [id, session.tenantId, input.name, input.methodType, input.feePercent, input.feeFixed, input.settlementDays, input.active],
  );

  return NextResponse.json({ paymentMethod: mapRow(result.rows[0]) }, { status: 201 });
}

export async function PATCH(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const input = readPaymentMethodInput(body);
  const validationError = validatePaymentMethodInput(input, true);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }

  if (await hasDuplicatePaymentMethodName(session.tenantId, input.name, input.id)) {
    return NextResponse.json({ error: 'Ja existe uma forma de pagamento com esse nome.' }, { status: 409 });
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
    [input.id, session.tenantId, input.name, input.methodType, input.feePercent, input.feeFixed, input.settlementDays, input.active],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Forma de pagamento nao encontrada.' }, { status: 404 });
  }

  return NextResponse.json({ paymentMethod: mapRow(result.rows[0]) });
}
