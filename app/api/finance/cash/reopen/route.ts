import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const sessionId = String(body.sessionId || '').trim();
  if (!sessionId) return NextResponse.json({ error: 'sessionId obrigatorio.' }, { status: 400 });

  const openResult = await query<{ id: string }>(
    `SELECT id FROM cash_register_sessions WHERE tenant_id = $1 AND status = 'open' LIMIT 1`,
    [session.tenantId],
  );
  if (openResult.rowCount) {
    return NextResponse.json({ error: 'Ja existe caixa aberto. Feche antes de reabrir outro.' }, { status: 409 });
  }

  const targetResult = await query<{ id: string; status: string }>(
    `SELECT id, status FROM cash_register_sessions WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [session.tenantId, sessionId],
  );
  if (!targetResult.rowCount) {
    return NextResponse.json({ error: 'Caixa nao encontrado.' }, { status: 404 });
  }
  if (targetResult.rows[0].status !== 'closed') {
    return NextResponse.json({ error: 'Somente caixas fechados podem ser reabertos.' }, { status: 409 });
  }

  const result = await query(
    `UPDATE cash_register_sessions
     SET status = 'open',
         closed_at = NULL,
         closed_by_user_id = NULL,
         closing_amount_reported = NULL,
         closing_amount_expected = NULL,
         difference_amount = NULL
     WHERE tenant_id = $1 AND id = $2
     RETURNING id, status, opened_at`,
    [session.tenantId, sessionId],
  );

  return NextResponse.json({ cashSession: result.rows[0] });
}
