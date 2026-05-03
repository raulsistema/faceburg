import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { parseMoneyInput } from '@/lib/finance-utils';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const closingAmountReported = parseMoneyInput(body.closingAmountReported);
  const notes = String(body.notes || '').trim();

  if (!Number.isFinite(closingAmountReported) || closingAmountReported < 0) {
    return NextResponse.json({ error: 'Valor de fechamento invalido.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cash-register:${session.tenantId}`]);

    const currentResult = await client.query<{ id: string; opening_amount: string }>(
      `SELECT id, opening_amount::text
       FROM cash_register_sessions
       WHERE tenant_id = $1
         AND status = 'open'
       ORDER BY opened_at DESC
       LIMIT 1
       FOR UPDATE`,
      [session.tenantId],
    );

    if (!currentResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Nenhum caixa aberto.' }, { status: 409 });
    }

    const current = currentResult.rows[0];
    const expectedResult = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS total
       FROM cash_movements
       WHERE tenant_id = $1 AND session_id = $2`,
      [session.tenantId, current.id],
    );

    const userResult = await client.query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId],
    );
    const safeUserId = userResult.rowCount ? session.userId : null;

    const openingAmount = Number(current.opening_amount || 0);
    const movementsTotal = Number(expectedResult.rows[0]?.total || 0);
    const expected = Number((openingAmount + movementsTotal).toFixed(2));
    const difference = Number((closingAmountReported - expected).toFixed(2));

    const result = await client.query(
      `UPDATE cash_register_sessions
       SET closed_by_user_id = $3,
           closed_at = NOW(),
           closing_amount_reported = $4,
           closing_amount_expected = $5,
           difference_amount = $6,
           notes = COALESCE(NULLIF($7, ''), notes),
           status = 'closed'
       WHERE id = $1 AND tenant_id = $2 AND status = 'open'
       RETURNING id, closed_at, closing_amount_reported::text, closing_amount_expected::text, difference_amount::text, status`,
      [current.id, session.tenantId, safeUserId, closingAmountReported, expected, difference, notes],
    );

    await client.query('COMMIT');
    return NextResponse.json({ cashSession: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    const message = error instanceof Error ? error.message : 'Falha ao fechar caixa.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
