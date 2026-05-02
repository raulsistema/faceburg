import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TabListRow = {
  id: string;
  table_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
  subtotal_amount: string;
  total_amount: string;
  status: 'open' | 'closed' | 'cancelled';
  opened_at: string;
  updated_at: string;
  items_count: number;
};

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<TabListRow>(
    `SELECT
       t.id,
       t.table_number,
       t.customer_name,
       t.customer_phone,
       t.discount_amount::text,
       t.surcharge_amount::text,
       t.delivery_fee_amount::text,
       t.subtotal_amount::text,
       t.total_amount::text,
       t.status,
       t.opened_at,
       t.updated_at,
       COALESCE(SUM(i.quantity), 0)::int AS items_count
     FROM pdv_tabs t
     LEFT JOIN pdv_tab_items i
       ON i.tab_id = t.id
     WHERE t.tenant_id = $1
       AND t.status = 'open'
     GROUP BY t.id
     ORDER BY t.opened_at DESC
     LIMIT 150`,
    [session.tenantId],
  );

  return NextResponse.json({
    tabs: result.rows.map((row) => ({
      id: row.id,
      tableNumber: row.table_number,
      customerName: row.customer_name || '',
      customerPhone: row.customer_phone || '',
      discountAmount: Number(row.discount_amount || 0),
      surchargeAmount: Number(row.surcharge_amount || 0),
      deliveryFeeAmount: Number(row.delivery_fee_amount || 0),
      subtotalAmount: Number(row.subtotal_amount || 0),
      totalAmount: Number(row.total_amount || 0),
      status: row.status,
      openedAt: row.opened_at,
      updatedAt: row.updated_at,
      itemsCount: Number(row.items_count || 0),
    })),
  });
}

export async function POST(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await request.json();
  const tableNumber = String(body.tableNumber || '').trim();
  const customerName = String(body.customerName || '').trim();
  const customerPhone = String(body.customerPhone || '').trim();
  const customerId = String(body.customerId || '').trim();

  if (!tableNumber) {
    return NextResponse.json({ error: 'Informe o numero/nome da mesa.' }, { status: 400 });
  }

  const duplicated = await query<{ id: string }>(
    `SELECT id
     FROM pdv_tabs
     WHERE tenant_id = $1
       AND status = 'open'
       AND lower(trim(table_number)) = lower(trim($2))
     LIMIT 1`,
    [session.tenantId, tableNumber],
  );

  if (duplicated.rowCount) {
    return NextResponse.json({ error: 'Ja existe comanda aberta para essa mesa.' }, { status: 409 });
  }

  const id = randomUUID();
  const created = await query<TabListRow>(
    `INSERT INTO pdv_tabs
       (id, tenant_id, table_number, customer_name, customer_phone, customer_id, status, opened_by_user_id, opened_at, updated_at)
     VALUES
       ($1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), 'open', $7, NOW(), NOW())
     RETURNING
       id,
       table_number,
       customer_name,
       customer_phone,
       discount_amount::text,
       surcharge_amount::text,
       delivery_fee_amount::text,
       subtotal_amount::text,
       total_amount::text,
       status,
       opened_at,
       updated_at,
       0::int AS items_count`,
    [id, session.tenantId, tableNumber, customerName, customerPhone, customerId, session.userId],
  );

  return NextResponse.json(
    {
      tab: {
        id: created.rows[0].id,
        tableNumber: created.rows[0].table_number,
        customerName: created.rows[0].customer_name || '',
        customerPhone: created.rows[0].customer_phone || '',
        discountAmount: Number(created.rows[0].discount_amount || 0),
        surchargeAmount: Number(created.rows[0].surcharge_amount || 0),
        deliveryFeeAmount: Number(created.rows[0].delivery_fee_amount || 0),
        subtotalAmount: Number(created.rows[0].subtotal_amount || 0),
        totalAmount: Number(created.rows[0].total_amount || 0),
        status: created.rows[0].status,
        openedAt: created.rows[0].opened_at,
        updatedAt: created.rows[0].updated_at,
        itemsCount: 0,
      },
    },
    { status: 201 },
  );
}
