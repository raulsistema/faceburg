import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

const allowedTypes = new Set(['sale', 'withdrawal', 'supply', 'adjustment', 'refund']);

export async function POST(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const movementType = String(body.movementType || '').trim();
  const amount = Number(body.amount || 0);
  const description = String(body.description || '').trim();
  const referenceOrderId = String(body.referenceOrderId || '').trim();

  if (!allowedTypes.has(movementType)) {
    return NextResponse.json({ error: 'Tipo de movimento invalido.' }, { status: 400 });
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: 'Valor do movimento invalido.' }, { status: 400 });
  }

  try {
    const sessionResult = await query<{ id: string }>(
      `SELECT id FROM cash_register_sessions WHERE tenant_id = $1 AND status = 'open' ORDER BY opened_at DESC LIMIT 1`,
      [session.tenantId],
    );

    if (!sessionResult.rowCount) {
      return NextResponse.json({ error: 'Nenhum caixa aberto.' }, { status: 409 });
    }

    const userResult = await query<{ id: string }>(
      `SELECT id FROM tenant_users WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
      [session.userId, session.tenantId],
    );
    const safeUserId = userResult.rowCount ? session.userId : null;

    const signal = movementType === 'withdrawal' || movementType === 'refund' ? -1 : 1;
    const signedAmount = Number((amount * signal).toFixed(2));

    const result = await query(
      `INSERT INTO cash_movements (id, tenant_id, session_id, movement_type, amount, description, reference_order_id, created_by_user_id)
       VALUES ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), $8)
       RETURNING id, session_id, movement_type, amount::text, description, created_at`,
      [randomUUID(), session.tenantId, sessionResult.rows[0].id, movementType, signedAmount, description, referenceOrderId, safeUserId],
    );

    return NextResponse.json({ movement: result.rows[0] }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Falha ao registrar movimento.';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
