import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { ensureFinanceSchema } from '@/lib/finance-schema';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type OrderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  total: string;
  status: 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';
  type: 'delivery' | 'pickup' | 'table';
  payment_method: string | null;
  cancellation_reason: string | null;
  created_at: string;
  updated_at: string;
  items_summary: string | null;
};

export async function GET() {
  await ensureFinanceSchema();
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<OrderRow>(
    `WITH current_cash AS (
       SELECT id
       FROM cash_register_sessions
       WHERE tenant_id = $1
         AND status = 'open'
       ORDER BY opened_at DESC
       LIMIT 1
     ),
     candidate_orders AS (
       SELECT
         o.id,
         o.customer_name,
         o.customer_phone,
         o.delivery_address,
         o.total::text,
         o.status,
         o.type,
         o.payment_method,
         o.cancellation_reason,
         o.created_at,
         o.updated_at
       FROM orders o
       LEFT JOIN current_cash cc ON TRUE
       WHERE o.tenant_id = $1
         AND o.created_at >= NOW() - INTERVAL '7 days'
         AND (
           o.status <> 'completed'
           OR (
             cc.id IS NOT NULL
             AND o.cash_session_id = cc.id
           )
         )
       ORDER BY o.created_at DESC
       LIMIT 200
     ),
     item_summaries AS (
       SELECT
         oi.order_id,
         STRING_AGG(
           (oi.quantity::text || 'x ' || COALESCE(p.name, 'Produto removido')),
           ', '
           ORDER BY COALESCE(p.name, 'Produto removido')
         ) AS items_summary
       FROM order_items oi
       JOIN candidate_orders co
         ON co.id = oi.order_id
       LEFT JOIN products p
         ON p.id = oi.product_id
        AND p.tenant_id = $1
       GROUP BY oi.order_id
     )
     SELECT
       co.id,
       co.customer_name,
       co.customer_phone,
       co.delivery_address,
       co.total,
       co.status,
       co.type,
       co.payment_method,
       co.cancellation_reason,
       co.created_at,
       co.updated_at,
       COALESCE(items.items_summary, '') AS items_summary
     FROM candidate_orders co
     LEFT JOIN item_summaries items
       ON items.order_id = co.id
     ORDER BY co.created_at DESC`,
    [session.tenantId],
  );

  return NextResponse.json(
    {
      orders: result.rows.map((row) => ({
        id: row.id,
        customerName: row.customer_name || 'Sem nome',
        customerPhone: row.customer_phone || '',
        deliveryAddress: row.delivery_address || '',
        total: Number(row.total),
        status: row.status,
        type: row.type,
        paymentMethod: row.payment_method || 'pix',
        cancelReason: row.cancellation_reason || '',
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        itemsSummary: row.items_summary || '',
      })),
    },
    {
      headers: {
        'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
      },
    },
  );
}
