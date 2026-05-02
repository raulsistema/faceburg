import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const BUSINESS_TZ = 'America/Sao_Paulo';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 180;

type TotalsRow = {
  gross_sales: string;
  fee_total: string;
  net_sales: string;
  completed_orders: string;
  cancelled_orders: string;
  avg_ticket: string;
};

type SalesByDayRow = {
  day: string;
  gross_sales: string;
  orders: string;
  cancelled_orders: string;
};

type PaymentBreakdownRow = {
  method_name: string;
  orders: string;
  gross_sales: string;
  fee_total: string;
  net_sales: string;
};

type TypeBreakdownRow = {
  order_type: string;
  orders: string;
  gross_sales: string;
};

type TopProductRow = {
  product_id: string;
  product_name: string;
  quantity: string;
  revenue: string;
};

function formatDateInTimezone(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

function toUtcDate(input: string) {
  return new Date(`${input}T00:00:00Z`);
}

function addDays(dateInput: string, days: number) {
  const date = toUtcDate(dateInput);
  date.setUTCDate(date.getUTCDate() + days);
  return formatDateInTimezone(date, 'UTC');
}

function isValidIsoDate(value: string | null) {
  if (!value) return false;
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function normalizeRange(startRaw: string | null, endRaw: string | null) {
  const today = formatDateInTimezone(new Date(), BUSINESS_TZ);
  const defaultEnd = today;
  const defaultStart = addDays(defaultEnd, -29);

  let startDate = isValidIsoDate(startRaw) ? String(startRaw) : defaultStart;
  let endDate = isValidIsoDate(endRaw) ? String(endRaw) : defaultEnd;

  if (toUtcDate(startDate).getTime() > toUtcDate(endDate).getTime()) {
    const temp = startDate;
    startDate = endDate;
    endDate = temp;
  }

  const days = Math.floor((toUtcDate(endDate).getTime() - toUtcDate(startDate).getTime()) / MS_PER_DAY) + 1;
  if (days > MAX_RANGE_DAYS) {
    startDate = addDays(endDate, -(MAX_RANGE_DAYS - 1));
    return { startDate, endDate, days: MAX_RANGE_DAYS };
  }

  return { startDate, endDate, days };
}

function paymentFallbackLabel(method: string | null) {
  const key = String(method || '').trim().toLowerCase();
  if (key === 'cash' || key === 'dinheiro') return 'Dinheiro';
  if (key === 'card' || key === 'cartao' || key === 'cartão') return 'Cartao';
  if (key === 'pix') return 'Pix';
  if (!key) return 'Nao informado';
  return key;
}

function orderTypeLabel(type: string) {
  if (type === 'delivery') return 'Delivery';
  if (type === 'pickup') return 'Balcao';
  if (type === 'table') return 'Mesa';
  return type;
}

export async function GET(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const { startDate, endDate, days } = normalizeRange(searchParams.get('startDate'), searchParams.get('endDate'));

  const [totalsResult, salesByDayResult, paymentBreakdownResult, typeBreakdownResult, topProductsResult] = await Promise.all([
    query<TotalsRow>(
      `WITH filtered_orders AS (
         SELECT
           id,
           status,
           total,
           payment_fee_amount,
           payment_net_amount
         FROM orders
         WHERE tenant_id = $1
           AND timezone('${BUSINESS_TZ}', created_at)::date BETWEEN $2::date AND $3::date
       )
       SELECT
         COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total ELSE 0 END), 0)::text AS gross_sales,
         COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(payment_fee_amount, 0) ELSE 0 END), 0)::text AS fee_total,
         COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN COALESCE(payment_net_amount, total) ELSE 0 END), 0)::text AS net_sales,
         COUNT(CASE WHEN status <> 'cancelled' THEN 1 END)::text AS completed_orders,
         COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::text AS cancelled_orders,
         COALESCE(AVG(CASE WHEN status <> 'cancelled' THEN total END), 0)::text AS avg_ticket
       FROM filtered_orders`,
      [session.tenantId, startDate, endDate],
    ),
    query<SalesByDayRow>(
      `WITH days AS (
         SELECT generate_series($2::date, $3::date, '1 day'::interval)::date AS day
       ),
       filtered_orders AS (
         SELECT
           timezone('${BUSINESS_TZ}', created_at)::date AS created_day,
           status,
           total
         FROM orders
         WHERE tenant_id = $1
           AND timezone('${BUSINESS_TZ}', created_at)::date BETWEEN $2::date AND $3::date
       )
       SELECT
         to_char(d.day, 'YYYY-MM-DD') AS day,
         COALESCE(SUM(CASE WHEN fo.status <> 'cancelled' THEN fo.total ELSE 0 END), 0)::text AS gross_sales,
         COUNT(CASE WHEN fo.status <> 'cancelled' THEN 1 END)::text AS orders,
         COUNT(CASE WHEN fo.status = 'cancelled' THEN 1 END)::text AS cancelled_orders
       FROM days d
       LEFT JOIN filtered_orders fo
         ON fo.created_day = d.day
       GROUP BY d.day
       ORDER BY d.day ASC`,
      [session.tenantId, startDate, endDate],
    ),
    query<PaymentBreakdownRow>(
      `WITH filtered_orders AS (
         SELECT
           id,
           payment_method,
           total,
           payment_fee_amount,
           payment_net_amount
         FROM orders
         WHERE tenant_id = $1
           AND status <> 'cancelled'
           AND timezone('${BUSINESS_TZ}', created_at)::date BETWEEN $2::date AND $3::date
       ),
       payment_lines AS (
         SELECT
           op.order_id,
           COALESCE(pm.name, op.method_name, op.method_type, 'Nao informado') AS method_name,
           op.gross_amount,
           op.fee_amount,
           op.net_amount
         FROM order_payments op
         JOIN filtered_orders fo
           ON fo.id = op.order_id
         LEFT JOIN payment_methods pm
           ON pm.id = op.payment_method_id
          AND pm.tenant_id = $1
       ),
       fallback_lines AS (
         SELECT
           fo.id AS order_id,
           fo.payment_method,
           fo.total AS gross_amount,
           COALESCE(fo.payment_fee_amount, 0) AS fee_amount,
           COALESCE(fo.payment_net_amount, fo.total) AS net_amount
         FROM filtered_orders fo
         WHERE NOT EXISTS (
           SELECT 1
           FROM payment_lines pl
           WHERE pl.order_id = fo.id
         )
       )
       SELECT
         base.method_name,
         COUNT(DISTINCT base.order_id)::text AS orders,
         COALESCE(SUM(base.gross_amount), 0)::text AS gross_sales,
         COALESCE(SUM(base.fee_amount), 0)::text AS fee_total,
         COALESCE(SUM(base.net_amount), 0)::text AS net_sales
       FROM (
         SELECT
           order_id,
           method_name,
           gross_amount,
           fee_amount,
           net_amount
         FROM payment_lines
         UNION ALL
         SELECT
           fl.order_id,
           CASE
             WHEN lower(trim(COALESCE(fl.payment_method, ''))) = 'cash' THEN 'Dinheiro'
             WHEN lower(trim(COALESCE(fl.payment_method, ''))) = 'card' THEN 'Cartao'
             WHEN lower(trim(COALESCE(fl.payment_method, ''))) = 'pix' THEN 'Pix'
             WHEN trim(COALESCE(fl.payment_method, '')) = '' THEN 'Nao informado'
             ELSE fl.payment_method
           END AS method_name,
           fl.gross_amount,
           fl.fee_amount,
           fl.net_amount
         FROM fallback_lines fl
       ) base
       GROUP BY base.method_name
       ORDER BY SUM(base.gross_amount) DESC, base.method_name ASC`,
      [session.tenantId, startDate, endDate],
    ),
    query<TypeBreakdownRow>(
      `SELECT
         type AS order_type,
         COUNT(*)::text AS orders,
         COALESCE(SUM(total), 0)::text AS gross_sales
       FROM orders
       WHERE tenant_id = $1
         AND status <> 'cancelled'
         AND timezone('${BUSINESS_TZ}', created_at)::date BETWEEN $2::date AND $3::date
       GROUP BY type
       ORDER BY SUM(total) DESC`,
      [session.tenantId, startDate, endDate],
    ),
    query<TopProductRow>(
      `SELECT
         oi.product_id,
         COALESCE(p.name, 'Produto removido') AS product_name,
         COALESCE(SUM(oi.quantity), 0)::text AS quantity,
         COALESCE(SUM(oi.quantity * oi.unit_price), 0)::text AS revenue
       FROM order_items oi
       JOIN orders o
         ON o.id = oi.order_id
        AND o.tenant_id = $1
       LEFT JOIN products p
         ON p.id = oi.product_id
        AND p.tenant_id = o.tenant_id
       WHERE o.status <> 'cancelled'
         AND timezone('${BUSINESS_TZ}', o.created_at)::date BETWEEN $2::date AND $3::date
       GROUP BY oi.product_id, COALESCE(p.name, 'Produto removido')
       ORDER BY SUM(oi.quantity) DESC, COALESCE(p.name, 'Produto removido') ASC
       LIMIT 10`,
      [session.tenantId, startDate, endDate],
    ),
  ]);

  const totals = totalsResult.rows[0] || {
    gross_sales: '0',
    fee_total: '0',
    net_sales: '0',
    completed_orders: '0',
    cancelled_orders: '0',
    avg_ticket: '0',
  };

  return NextResponse.json(
    {
      period: { startDate, endDate, days },
      totals: {
        grossSales: Number(totals.gross_sales || 0),
        feeTotal: Number(totals.fee_total || 0),
        netSales: Number(totals.net_sales || 0),
        completedOrders: Number(totals.completed_orders || 0),
        cancelledOrders: Number(totals.cancelled_orders || 0),
        avgTicket: Number(totals.avg_ticket || 0),
      },
      salesByDay: salesByDayResult.rows.map((row) => ({
        date: row.day,
        grossSales: Number(row.gross_sales || 0),
        orders: Number(row.orders || 0),
        cancelledOrders: Number(row.cancelled_orders || 0),
      })),
      paymentBreakdown: paymentBreakdownResult.rows.map((row) => ({
        methodName: row.method_name || paymentFallbackLabel(null),
        orders: Number(row.orders || 0),
        grossSales: Number(row.gross_sales || 0),
        feeTotal: Number(row.fee_total || 0),
        netSales: Number(row.net_sales || 0),
      })),
      typeBreakdown: typeBreakdownResult.rows.map((row) => ({
        type: row.order_type,
        typeLabel: orderTypeLabel(row.order_type),
        orders: Number(row.orders || 0),
        grossSales: Number(row.gross_sales || 0),
      })),
      topProducts: topProductsResult.rows.map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        quantity: Number(row.quantity || 0),
        revenue: Number(row.revenue || 0),
      })),
    },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  );
}

