import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TransactionRow = {
  id: string;
  source: 'cash_movement' | 'receivable';
  kind: string;
  amount: string;
  description: string | null;
  status: string;
  order_id: string | null;
  created_at: string;
  due_date: string | null;
};

export async function GET(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, Number(searchParams.get('page') || 1));
  const limit = Math.min(100, Math.max(1, Number(searchParams.get('limit') || 20)));
  const offset = (page - 1) * limit;

  const result = await query<TransactionRow>(
    `SELECT *
     FROM (
       SELECT
         cm.id,
         'cash_movement'::text AS source,
         cm.movement_type AS kind,
         cm.amount::text AS amount,
         cm.description,
         'posted'::text AS status,
         cm.reference_order_id AS order_id,
         cm.created_at,
         NULL::date AS due_date
       FROM cash_movements cm
       WHERE cm.tenant_id = $1

       UNION ALL

       SELECT
         r.id,
         'receivable'::text AS source,
         'card_fee_settlement'::text AS kind,
         r.net_amount::text AS amount,
         ('Recebivel pedido #' || substring(r.order_id from 1 for 8))::text AS description,
         r.status,
         r.order_id,
         r.created_at,
         r.due_date
       FROM receivables r
       WHERE r.tenant_id = $1
     ) t
     ORDER BY t.created_at DESC
     LIMIT $2
     OFFSET $3`,
    [session.tenantId, limit + 1, offset],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;

  return NextResponse.json({
    transactions: rows.map((row) => ({
      id: row.id,
      source: row.source,
      kind: row.kind,
      amount: Number(row.amount || 0),
      description: row.description,
      status: row.status,
      orderId: row.order_id,
      createdAt: row.created_at,
      dueDate: row.due_date,
    })),
    page,
    limit,
    hasMore,
  });
}
