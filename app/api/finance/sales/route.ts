import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type SaleRow = {
  id: string;
  customer_name: string | null;
  total: string;
  payment_method: string | null;
  payment_fee_amount: string | null;
  payment_net_amount: string | null;
  status: string;
  type: string;
  created_at: string;
  updated_at: string;
};

function positiveInteger(value: string | null, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.max(1, Math.round(parsed));
  return max ? Math.min(max, rounded) : rounded;
}

export async function GET(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const page = positiveInteger(searchParams.get('page'), 1);
  const limit = positiveInteger(searchParams.get('limit'), 20, 100);
  const offset = (page - 1) * limit;

  const result = await query<SaleRow>(
    `SELECT
       id,
       customer_name,
       total::text,
       payment_method,
       payment_fee_amount::text,
       payment_net_amount::text,
       status,
       type,
       created_at,
       updated_at
     FROM orders
     WHERE tenant_id = $1
       AND status = 'completed'
     ORDER BY created_at DESC
     LIMIT $2
     OFFSET $3`,
    [session.tenantId, limit + 1, offset],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

  return NextResponse.json({
    sales: rows.map((row) => ({
      id: row.id,
      customerName: row.customer_name || 'Sem nome',
      total: Number(row.total || 0),
      paymentMethod: row.payment_method || 'pix',
      paymentFeeAmount: Number(row.payment_fee_amount || 0),
      paymentNetAmount: Number(row.payment_net_amount || row.total || 0),
      status: row.status,
      type: row.type,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })),
    page,
    limit,
    hasMore,
  });
}
