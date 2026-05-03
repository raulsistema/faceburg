import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';

type OpenCashSessionRow = {
  id: string;
  opened_at: string;
  opening_amount: string;
  status: string;
};

export type OpenCashSession = {
  id: string;
  openedAt: string;
  openingAmount: number;
  status: string;
};

export async function getOpenCashSession(tenantId: string, executor: DbExecutor = { query }): Promise<OpenCashSession | null> {
  await ensureFinanceSchema();

  const result = await executor.query<OpenCashSessionRow>(
    `SELECT id, opened_at, opening_amount::text, status
     FROM cash_register_sessions
     WHERE tenant_id = $1
       AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [tenantId],
  );

  if (!result.rowCount) {
    return null;
  }

  const row = result.rows[0];
  return {
    id: row.id,
    openedAt: row.opened_at,
    openingAmount: Number(row.opening_amount || 0),
    status: row.status,
  };
}
