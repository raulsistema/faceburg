import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type SummaryRow = {
  total_fees: string;
  gross_amount: string;
  net_amount: string;
  cash_impact: string;
  receivable_pending: string;
  account_amount: string;
  account_today: string;
  account_future: string;
  total_discount: string;
  total_surcharge: string;
  total_delivery_fee: string;
  sales_count: string;
  sales_without_items_count: string;
  sales_without_items_amount: string;
  sales_without_items_fees: string;
};

type MovementRow = {
  id: string;
  source: 'sale' | 'cash_movement' | 'receivable';
  title: string;
  description: string | null;
  status: string;
  amount: string;
  gross_amount: string;
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
  fee_amount: string;
  payment_method: string | null;
  order_id: string | null;
  created_at: string;
  due_date: string | null;
};

const allowedSources = new Set(['sale', 'cash_movement', 'receivable']);
const allowedStatuses = new Set(['completed', 'posted', 'pending', 'paid', 'received']);

function normalizeOptionalFilter(value: string | null, allowed: Set<string>) {
  const normalized = String(value || '').trim();
  if (!normalized || normalized === 'all') return null;
  return allowed.has(normalized) ? normalized : '';
}

function normalizeDate(value: string | null) {
  const normalized = String(value || '').trim();
  if (!normalized) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : '';
}

function positiveInteger(value: string | null, fallback: number, max?: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.max(1, Math.round(parsed));
  return max ? Math.min(max, rounded) : rounded;
}

const ledgerCte = `
  WITH ledger AS (
    SELECT
      o.id,
      'sale'::text AS source,
      ('Venda #' || substring(o.id from 1 for 8))::text AS title,
      CASE
        WHEN NULLIF(trim(COALESCE(o.customer_name, '')), '') IS NOT NULL THEN
          (COALESCE(o.customer_name, 'Sem nome') || ' - ' || COALESCE(o.type, 'pedido'))::text
        ELSE COALESCE(o.type, 'pedido')::text
      END AS description,
      o.status,
      o.total AS amount,
      o.subtotal_amount AS gross_amount,
      o.discount_amount AS discount_amount,
      o.surcharge_amount AS surcharge_amount,
      o.delivery_fee_amount AS delivery_fee_amount,
      COALESCE(o.payment_fee_amount, 0) AS fee_amount,
      o.payment_method,
      o.id AS order_id,
      o.created_at,
      NULL::date AS due_date,
      COALESCE(order_items.item_count, 0)::int AS item_count
    FROM orders o
    LEFT JOIN LATERAL (
      SELECT COUNT(*) AS item_count
      FROM order_items oi
      WHERE oi.order_id = o.id
    ) order_items ON TRUE
    WHERE o.tenant_id = $1
      AND o.status = 'completed'

    UNION ALL

    SELECT
      cm.id,
      'cash_movement'::text AS source,
      CASE cm.movement_type
        WHEN 'sale' THEN 'Lancamento de venda'
        WHEN 'supply' THEN 'Suprimento'
        WHEN 'withdrawal' THEN 'Sangria'
        WHEN 'refund' THEN 'Estorno'
        ELSE 'Ajuste de caixa'
      END AS title,
      COALESCE(cm.description, 'Movimento manual de caixa') AS description,
      'posted'::text AS status,
      cm.amount AS amount,
      0::numeric AS gross_amount,
      0::numeric AS discount_amount,
      0::numeric AS surcharge_amount,
      0::numeric AS delivery_fee_amount,
      0::numeric AS fee_amount,
      NULL::text AS payment_method,
      cm.reference_order_id AS order_id,
      cm.created_at,
      NULL::date AS due_date,
      0::int AS item_count
    FROM cash_movements cm
    WHERE cm.tenant_id = $1
      AND cm.movement_type <> 'sale'

    UNION ALL

    SELECT
      r.id,
      'receivable'::text AS source,
      ('Recebivel #' || substring(r.order_id from 1 for 8))::text AS title,
      COALESCE(pm.name, 'Recebimento futuro')::text AS description,
      r.status,
      r.net_amount AS amount,
      r.gross_amount AS gross_amount,
      0::numeric AS discount_amount,
      0::numeric AS surcharge_amount,
      0::numeric AS delivery_fee_amount,
      r.fee_amount AS fee_amount,
      pm.name AS payment_method,
      r.order_id,
      r.created_at,
      r.due_date,
      0::int AS item_count
    FROM receivables r
    LEFT JOIN payment_methods pm
      ON pm.id = r.payment_method_id
     AND pm.tenant_id = r.tenant_id
    WHERE r.tenant_id = $1
  ),
  filtered AS (
    SELECT *
    FROM ledger
    WHERE ($2::text IS NULL OR source = $2)
      AND ($3::text IS NULL OR status = $3)
      AND ($4::date IS NULL OR created_at >= $4::date)
      AND ($5::date IS NULL OR created_at < ($5::date + INTERVAL '1 day'))
  ),
  cash_scope AS (
    SELECT
      cm.id,
      cm.movement_type,
      CASE WHEN cm.movement_type = 'sale' THEN 'sale'::text ELSE 'cash_movement'::text END AS source,
      CASE WHEN cm.movement_type = 'sale' THEN 'completed'::text ELSE 'posted'::text END AS status,
      cm.amount AS amount,
      cm.created_at,
      lower(COALESCE(
        pm.method_type,
        matched_payment.method_type,
        NULLIF(o.payment_method, ''),
        ''
      )) AS payment_type
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
  ),
  cash_filtered AS (
    SELECT *
    FROM cash_scope
    WHERE ($2::text IS NULL OR source = $2)
      AND ($3::text IS NULL OR status = $3)
      AND ($4::date IS NULL OR created_at >= $4::date)
      AND ($5::date IS NULL OR created_at < ($5::date + INTERVAL '1 day'))
  )
`;

export async function GET(request: Request) {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = positiveInteger(searchParams.get('page'), 1);
  const limit = positiveInteger(searchParams.get('limit'), 30, 100);
  const offset = (page - 1) * limit;
  const source = normalizeOptionalFilter(searchParams.get('source'), allowedSources);
  const status = normalizeOptionalFilter(searchParams.get('status'), allowedStatuses);
  const from = normalizeDate(searchParams.get('from'));
  const to = normalizeDate(searchParams.get('to'));

  if (source === '') return NextResponse.json({ error: 'Origem invalida.' }, { status: 400 });
  if (status === '') return NextResponse.json({ error: 'Status invalido.' }, { status: 400 });
  if (from === '' || to === '') return NextResponse.json({ error: 'Periodo invalido.' }, { status: 400 });

  const params = [session.tenantId, source, status, from, to];
  const [summaryResult, movementsResult] = await Promise.all([
    query<SummaryRow>(
      `${ledgerCte}
       SELECT
         (
           SELECT COALESCE(SUM(CASE
             WHEN source = 'sale' THEN fee_amount
             WHEN $2::text = 'receivable' AND source = 'receivable' THEN fee_amount
             ELSE 0
           END), 0)::text
           FROM filtered
         ) AS total_fees,
         (
           SELECT COALESCE(SUM(CASE
             WHEN $2::text = 'receivable' AND source = 'receivable' THEN gross_amount
             WHEN source = 'sale' THEN gross_amount
             ELSE 0
           END), 0)::text
           FROM filtered
         ) AS gross_amount,
         (
           SELECT COALESCE(SUM(CASE
             WHEN $2::text = 'receivable' AND source = 'receivable' THEN amount
             WHEN $2::text = 'cash_movement' AND source = 'cash_movement' THEN amount
             WHEN source = 'sale' THEN amount - fee_amount
             ELSE 0
           END), 0)::text
           FROM filtered
         ) AS net_amount,
         (
           SELECT COALESCE(SUM(CASE
             WHEN movement_type IN ('sale', 'refund') AND payment_type NOT IN ('', 'cash', 'money', 'dinheiro') THEN 0
             ELSE amount
           END), 0)::text
           FROM cash_filtered
         ) AS cash_impact,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'receivable' AND status = 'pending' THEN amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS receivable_pending,
         (
           SELECT (
             COALESCE(SUM(CASE WHEN source = 'receivable' THEN amount ELSE 0 END), 0)
             +
             COALESCE((
               SELECT SUM(CASE
                 WHEN movement_type IN ('sale', 'refund') AND payment_type NOT IN ('', 'cash', 'money', 'dinheiro') THEN amount
                 ELSE 0
               END)
               FROM cash_filtered
             ), 0)
           )::text
           FROM filtered
         ) AS account_amount,
         (
           SELECT (
             COALESCE(SUM(CASE WHEN source = 'receivable' AND (due_date IS NULL OR due_date <= CURRENT_DATE) THEN amount ELSE 0 END), 0)
             +
             COALESCE((
               SELECT SUM(CASE
                 WHEN movement_type IN ('sale', 'refund') AND payment_type NOT IN ('', 'cash', 'money', 'dinheiro') THEN amount
                 ELSE 0
               END)
               FROM cash_filtered
             ), 0)
           )::text
           FROM filtered
         ) AS account_today,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'receivable' AND due_date > CURRENT_DATE THEN amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS account_future,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'sale' THEN discount_amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS total_discount,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'sale' THEN surcharge_amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS total_surcharge,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'sale' THEN delivery_fee_amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS total_delivery_fee,
         (
           SELECT COALESCE(COUNT(*) FILTER (WHERE source = 'sale'), 0)::text
           FROM filtered
         ) AS sales_count,
         (
           SELECT COALESCE(COUNT(*) FILTER (WHERE source = 'sale' AND item_count = 0), 0)::text
           FROM filtered
         ) AS sales_without_items_count,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'sale' AND item_count = 0 THEN amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS sales_without_items_amount,
         (
           SELECT COALESCE(SUM(CASE WHEN source = 'sale' AND item_count = 0 THEN fee_amount ELSE 0 END), 0)::text
           FROM filtered
         ) AS sales_without_items_fees`,
      params,
    ),
    query<MovementRow>(
      `${ledgerCte}
       SELECT
         id,
         source,
         title,
         description,
         status,
         amount::text,
         gross_amount::text,
         discount_amount::text,
         surcharge_amount::text,
         delivery_fee_amount::text,
         fee_amount::text,
         payment_method,
         order_id,
         created_at,
         due_date
       FROM filtered
       ORDER BY created_at DESC
       LIMIT $6
       OFFSET $7`,
      [...params, limit + 1, offset],
    ),
  ]);

  const hasMore = movementsResult.rows.length > limit;
  const rows = hasMore ? movementsResult.rows.slice(0, limit) : movementsResult.rows;
  const summary = summaryResult.rows[0] || {
    total_fees: '0',
    gross_amount: '0',
    net_amount: '0',
    cash_impact: '0',
    receivable_pending: '0',
    total_discount: '0',
    total_surcharge: '0',
    total_delivery_fee: '0',
    account_amount: '0',
    account_today: '0',
    account_future: '0',
    sales_count: '0',
    sales_without_items_count: '0',
    sales_without_items_amount: '0',
    sales_without_items_fees: '0',
  };

  return NextResponse.json({
    summary: {
      totalFees: Number(summary.total_fees || 0),
      grossAmount: Number(summary.gross_amount || 0),
      netAmount: Number(summary.net_amount || 0),
      cashImpact: Number(summary.cash_impact || 0),
      receivablePending: Number(summary.receivable_pending || 0),
      accountAmount: Number(summary.account_amount || 0),
      accountToday: Number(summary.account_today || 0),
      accountFuture: Number(summary.account_future || 0),
      totalDiscount: Number(summary.total_discount || 0),
      totalSurcharge: Number(summary.total_surcharge || 0),
      totalDeliveryFee: Number(summary.total_delivery_fee || 0),
      salesCount: Number(summary.sales_count || 0),
      salesWithoutItemsCount: Number(summary.sales_without_items_count || 0),
      salesWithoutItemsAmount: Number(summary.sales_without_items_amount || 0),
      salesWithoutItemsFees: Number(summary.sales_without_items_fees || 0),
    },
    movements: rows.map((row) => ({
      id: row.id,
      source: row.source,
      title: row.title,
      description: row.description,
      status: row.status,
      amount: Number(row.amount || 0),
      grossAmount: Number(row.gross_amount || 0),
      discountAmount: Number(row.discount_amount || 0),
      surchargeAmount: Number(row.surcharge_amount || 0),
      deliveryFeeAmount: Number(row.delivery_fee_amount || 0),
      feeAmount: Number(row.fee_amount || 0),
      paymentMethod: row.payment_method || '',
      orderId: row.order_id,
      createdAt: row.created_at,
      dueDate: row.due_date,
    })),
    page,
    limit,
    hasMore,
  });
}
