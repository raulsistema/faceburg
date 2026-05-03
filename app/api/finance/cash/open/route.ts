import { randomUUID } from 'node:crypto';
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
  const openingAmount = parseMoneyInput(body.openingAmount);
  const notes = String(body.notes || '').trim();

  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    return NextResponse.json({ error: 'Valor de abertura invalido.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`cash-register:${session.tenantId}`]);

    const openResult = await client.query<{ id: string }>(
      `SELECT id FROM cash_register_sessions WHERE tenant_id = $1 AND status = 'open' LIMIT 1`,
      [session.tenantId],
    );
    if (openResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Ja existe caixa aberto.' }, { status: 409 });
    }

    const userResult = await client.query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId],
    );
    const safeUserId = userResult.rowCount ? session.userId : null;

    const id = randomUUID();
    const result = await client.query(
      `INSERT INTO cash_register_sessions (id, tenant_id, opened_by_user_id, opening_amount, notes, status)
       VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'open')
       RETURNING id, opened_at, opening_amount::text, status`,
      [id, session.tenantId, safeUserId, openingAmount, notes],
    );

    await client.query('COMMIT');
    return NextResponse.json({ cashSession: result.rows[0] }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'Ja existe caixa aberto.' }, { status: 409 });
    }
    const message = error instanceof Error ? error.message : 'Falha ao abrir caixa.';
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    client.release();
  }
}
