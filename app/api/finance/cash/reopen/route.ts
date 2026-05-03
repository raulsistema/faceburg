import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const sessionId = String(body.sessionId || '').trim();
  if (!sessionId) return NextResponse.json({ error: 'sessionId obrigatorio.' }, { status: 400 });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cash-register:${session.tenantId}`]);

    const openResult = await client.query<{ id: string }>(
      `SELECT id
       FROM cash_register_sessions
       WHERE tenant_id = $1
         AND status = 'open'
       LIMIT 1
       FOR UPDATE`,
      [session.tenantId],
    );
    if (openResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Ja existe caixa aberto. Feche antes de reabrir outro.' }, { status: 409 });
    }

    const targetResult = await client.query<{ id: string; status: string }>(
      `SELECT id, status
       FROM cash_register_sessions
       WHERE tenant_id = $1
         AND id = $2
       LIMIT 1
       FOR UPDATE`,
      [session.tenantId, sessionId],
    );
    if (!targetResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Caixa nao encontrado.' }, { status: 404 });
    }
    if (targetResult.rows[0].status !== 'closed') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Somente caixas fechados podem ser reabertos.' }, { status: 409 });
    }

    const result = await client.query(
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

    await client.query('COMMIT');
    return NextResponse.json({ cashSession: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Falha ao reabrir caixa.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
