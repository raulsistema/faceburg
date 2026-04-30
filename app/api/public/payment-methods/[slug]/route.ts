import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
  fee_percent: string;
  fee_fixed: string;
  settlement_days: number;
};

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const tenantResult = await query<{ id: string }>(
    `SELECT id
     FROM tenants
     WHERE slug = $1 AND status = 'active'
     LIMIT 1`,
    [slug],
  );

  if (!tenantResult.rowCount) {
    return NextResponse.json({ error: 'Empresa nao encontrada.' }, { status: 404 });
  }

  const tenantId = tenantResult.rows[0].id;
  const result = await query<PaymentMethodRow>(
    `SELECT id, name, method_type, fee_percent::text, fee_fixed::text, settlement_days
     FROM payment_methods
     WHERE tenant_id = $1 AND active = TRUE
     ORDER BY name ASC`,
    [tenantId],
  );

  return NextResponse.json({
    paymentMethods: result.rows.map((row) => ({
      id: row.id,
      name: row.name,
      methodType: row.method_type,
      feePercent: Number(row.fee_percent || 0),
      feeFixed: Number(row.fee_fixed || 0),
      settlementDays: Number(row.settlement_days || 0),
    })),
  });
}
