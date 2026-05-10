import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getCashSessionFinanceSummary } from '@/lib/cash-summary';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { ensureStoreHoursSchema, isMenuOpenNow } from '@/lib/store-hours';
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

type TenantStoreStatusRow = {
  store_open: boolean;
  menu_open_mode: string | null;
  menu_hours: unknown;
};

function serializeStoreStatus(row: TenantStoreStatusRow | undefined) {
  const storeOpen = Boolean(row?.store_open);
  return {
    storeOpen,
    effectiveStoreOpen: isMenuOpenNow({
      manualOpen: storeOpen,
      mode: row?.menu_open_mode,
      hours: row?.menu_hours,
    }),
  };
}

export async function GET() {
  await ensureFinanceSchema();
  await ensureStoreHoursSchema();
  const session = await getValidatedTenantSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const tenantStatusResult = await query<TenantStoreStatusRow>(
    `SELECT store_open, menu_open_mode, menu_hours
     FROM tenants
     WHERE id = $1
     LIMIT 1`,
    [session.tenantId],
  );
  const storeStatus = serializeStoreStatus(tenantStatusResult.rows[0]);

  const currentResult = await query<SessionRow>(
    `SELECT id, opened_at, opening_amount::text, status
     FROM cash_register_sessions
     WHERE tenant_id = $1 AND status = 'open'
     ORDER BY opened_at DESC
     LIMIT 1`,
    [session.tenantId],
  );

  if (!currentResult.rowCount) {
    return NextResponse.json({ current: null, movements: [], expectedAmount: 0, ...storeStatus });
  }

  const current = currentResult.rows[0];
  const [movementsResult, summary] = await Promise.all([
    query<MovementRow>(
      `SELECT id, movement_type, amount::text, description, created_at
       FROM (
         SELECT
           cm.id,
           cm.movement_type,
           cm.amount,
           cm.description,
           cm.created_at,
           COALESCE(
             pm.method_type,
             matched_payment.method_type,
             NULLIF(o.payment_method, ''),
             ''
           ) AS payment_type
         FROM cash_movements cm
         LEFT JOIN orders o
           ON o.id = cm.reference_order_id
          AND o.tenant_id = cm.tenant_id
         LEFT JOIN payment_methods pm
           ON pm.id = o.payment_method_id
          AND pm.tenant_id = o.tenant_id
         LEFT JOIN LATERAL (
           SELECT op.method_type
           FROM order_payments op
           WHERE op.tenant_id = cm.tenant_id
             AND op.order_id = cm.reference_order_id
           ORDER BY
             CASE WHEN ABS(op.net_amount - ABS(cm.amount)) <= 0.02 THEN 0 ELSE 1 END,
             CASE WHEN lower(op.method_type) IN ('cash', 'money', 'dinheiro') THEN 0 ELSE 1 END,
             op.created_at ASC
           LIMIT 1
         ) matched_payment ON TRUE
         WHERE cm.tenant_id = $1
           AND cm.session_id = $2
       ) movements
       WHERE movement_type <> 'sale'
          OR lower(COALESCE(payment_type, '')) IN ('', 'cash', 'money', 'dinheiro')
       ORDER BY created_at DESC
       LIMIT 200`,
      [session.tenantId, current.id],
    ),
    getCashSessionFinanceSummary({
      tenantId: session.tenantId,
      sessionId: current.id,
      openedAt: current.opened_at,
      openingAmount: Number(current.opening_amount || 0),
      executor: { query },
    }),
  ]);

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
    expectedAmount: summary.expectedDrawer,
    summary,
    ...storeStatus,
  });
}
