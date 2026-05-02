import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
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
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<OrderRow>(
    `SELECT
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
      o.updated_at,
      COALESCE(
        STRING_AGG(
          (oi.quantity::text || 'x ' || COALESCE(p.name, 'Produto removido')),
          ', '
          ORDER BY COALESCE(p.name, 'Produto removido')
        ),
        ''
      ) AS items_summary
    FROM orders o
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p
      ON p.id = oi.product_id
     AND p.tenant_id = o.tenant_id
    WHERE o.tenant_id = $1
      AND o.created_at >= NOW() - INTERVAL '7 days'
    GROUP BY o.id
    ORDER BY o.created_at DESC
    LIMIT 200`,
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
