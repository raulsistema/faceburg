import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type StatsRow = {
  sales_today: string;
  orders_today: string;
  pending_orders: string;
  avg_ticket_today: string;
  avg_delivery_minutes: string | null;
};

type RecentSaleRow = {
  id: string;
  customer_name: string | null;
  total: string;
  status: string;
  type: string;
  created_at: string;
};

type TopProductRow = {
  product_id: string;
  product_name: string;
  qty: string;
  revenue: string;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const [statsResult, recentSalesResult, topProductsResult] = await Promise.all([
    query<StatsRow>(
      `SELECT
        COALESCE(SUM(CASE
          WHEN o.status <> 'cancelled'
            AND timezone('America/Sao_Paulo', o.created_at)::date = timezone('America/Sao_Paulo', now())::date
          THEN o.total ELSE 0 END), 0)::text AS sales_today,
        COUNT(CASE
          WHEN o.status <> 'cancelled'
            AND timezone('America/Sao_Paulo', o.created_at)::date = timezone('America/Sao_Paulo', now())::date
          THEN 1 END)::text AS orders_today,
        COUNT(CASE WHEN o.status = 'pending' THEN 1 END)::text AS pending_orders,
        COALESCE(AVG(CASE
          WHEN o.status <> 'cancelled'
            AND timezone('America/Sao_Paulo', o.created_at)::date = timezone('America/Sao_Paulo', now())::date
          THEN o.total END), 0)::text AS avg_ticket_today,
        AVG(CASE
          WHEN o.status IN ('delivering', 'completed')
            AND o.updated_at > o.created_at
          THEN EXTRACT(EPOCH FROM (o.updated_at - o.created_at)) / 60
        END)::text AS avg_delivery_minutes
      FROM orders o
      WHERE o.tenant_id = $1`,
      [session.tenantId],
    ),
    query<RecentSaleRow>(
      `SELECT id, customer_name, total::text, status, type, created_at
       FROM orders
       WHERE tenant_id = $1
         AND status <> 'cancelled'
       ORDER BY created_at DESC
       LIMIT 5`,
      [session.tenantId],
    ),
    query<TopProductRow>(
      `SELECT
        oi.product_id,
        COALESCE(p.name, 'Produto removido') AS product_name,
        SUM(oi.quantity)::text AS qty,
        SUM((oi.quantity * oi.unit_price))::text AS revenue
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      LEFT JOIN products p
        ON p.id = oi.product_id
       AND p.tenant_id = o.tenant_id
      WHERE o.tenant_id = $1
        AND o.status <> 'cancelled'
        AND timezone('America/Sao_Paulo', o.created_at)::date = timezone('America/Sao_Paulo', now())::date
      GROUP BY oi.product_id, COALESCE(p.name, 'Produto removido')
      ORDER BY SUM(oi.quantity) DESC, COALESCE(p.name, 'Produto removido') ASC
      LIMIT 5`,
      [session.tenantId],
    ),
  ]);

  const stats = statsResult.rows[0] || {
    sales_today: '0',
    orders_today: '0',
    pending_orders: '0',
    avg_ticket_today: '0',
    avg_delivery_minutes: null,
  };

  return NextResponse.json(
    {
      stats: {
        salesToday: Number(stats.sales_today || 0),
        ordersToday: Number(stats.orders_today || 0),
        pendingOrders: Number(stats.pending_orders || 0),
        avgTicketToday: Number(stats.avg_ticket_today || 0),
        avgDeliveryMinutes: stats.avg_delivery_minutes ? Math.round(Number(stats.avg_delivery_minutes)) : null,
      },
      recentSales: recentSalesResult.rows.map((row) => ({
        id: row.id,
        customerName: row.customer_name || 'Sem nome',
        total: Number(row.total || 0),
        status: row.status,
        type: row.type,
        createdAt: row.created_at,
      })),
      topProducts: topProductsResult.rows.map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        quantity: Number(row.qty || 0),
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
