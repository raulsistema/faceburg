import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const openingAmount = Number(body.openingAmount || 0);
  const notes = String(body.notes || '').trim();

  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    return NextResponse.json({ error: 'Valor de abertura invalido.' }, { status: 400 });
  }

  try {
    const openResult = await query<{ id: string }>(
      `SELECT id FROM cash_register_sessions WHERE tenant_id = $1 AND status = 'open' LIMIT 1`,
      [session.tenantId],
    );
    if (openResult.rowCount) {
      return NextResponse.json({ error: 'Ja existe caixa aberto.' }, { status: 409 });
    }

    const userResult = await query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId],
    );
    const safeUserId = userResult.rowCount ? session.userId : null;

    const id = randomUUID();
    const result = await query(
      `INSERT INTO cash_register_sessions (id, tenant_id, opened_by_user_id, opening_amount, notes, status)
       VALUES ($1, $2, $3, $4, NULLIF($5, ''), 'open')
       RETURNING id, opened_at, opening_amount::text, status`,
      [id, session.tenantId, safeUserId, openingAmount, notes],
    );

    return NextResponse.json({ cashSession: result.rows[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao abrir caixa.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
