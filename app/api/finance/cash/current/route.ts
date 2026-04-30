import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type SessionRow = {
  id: string;
  opened_at: string;
  opening_amount: string;
  status: string;
};

type MovementRow = {
  id: string;
  movement_type: string;
  amount: string;
  description: string | null;
  created_at: string;
};

export async function GET() {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const currentResult = await query<SessionRow>(
    `SELECT id, opened_at, opening_amount::text, status
     FROM cash_register_sessions
     WHERE tenant_id = $1 AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [session.tenantId],
  );

  if (!currentResult.rowCount) {
    return NextResponse.json({ current: null, movements: [], expectedAmount: 0 });
  }

  const current = currentResult.rows[0];
  const movementsResult = await query<MovementRow>(
    `SELECT id, movement_type, amount::text, description, created_at
     FROM cash_movements
     WHERE tenant_id = $1 AND session_id = $2
     ORDER BY created_at DESC
     LIMIT 200`,
    [session.tenantId, current.id],
  );

  const sumResult = await query<{ total: string }>(
    `SELECT COALESCE(SUM(amount), 0)::text AS total
     FROM cash_movements
     WHERE tenant_id = $1 AND session_id = $2`,
    [session.tenantId, current.id],
  );

  const expectedAmount = Number(current.opening_amount || 0) + Number(sumResult.rows[0]?.total || 0);

  return NextResponse.json({
    current: {
      id: current.id,
      openedAt: current.opened_at,
      openingAmount: Number(current.opening_amount || 0),
      status: current.status,
    },
    movements: movementsResult.rows.map((row) => ({
      id: row.id,
      movementType: row.movement_type,
      amount: Number(row.amount || 0),
      description: row.description,
      createdAt: row.created_at,
    })),
    expectedAmount: Number(expectedAmount.toFixed(2)),
  });
}
