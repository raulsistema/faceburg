import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type SessionRow = {
  id: string;
  status: string;
  opened_at: string;
  closed_at: string | null;
  opening_amount: string;
  closing_amount_reported: string | null;
  closing_amount_expected: string | null;
  difference_amount: string | null;
  notes: string | null;
};

export async function GET() {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const result = await query<SessionRow>(
    `SELECT id, status, opened_at, closed_at,
            opening_amount::text,
            closing_amount_reported::text,
            closing_amount_expected::text,
            difference_amount::text,
            notes
     FROM cash_register_sessions
     WHERE tenant_id = $1
     ORDER BY opened_at DESC
     LIMIT 100`,
    [session.tenantId],
  );

  return NextResponse.json({
    sessions: result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      openingAmount: Number(row.opening_amount || 0),
      closingAmountReported: row.closing_amount_reported == null ? null : Number(row.closing_amount_reported),
      closingAmountExpected: row.closing_amount_expected == null ? null : Number(row.closing_amount_expected),
      differenceAmount: row.difference_amount == null ? null : Number(row.difference_amount),
      notes: row.notes,
    })),
  });
}
