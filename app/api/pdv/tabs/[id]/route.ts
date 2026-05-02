import pool, { query } from '@/lib/db';
import { NextResponse } from 'next/server';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TabRow = {
  id: string;
  table_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_id: string | null;
  notes: string | null;
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
  subtotal_amount: string;
  total_amount: string;
  status: 'open' | 'closed' | 'cancelled';
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
};

type TabItemRow = {
  id: string;
  product_id: string;
  product_name: string;
  image_url: string | null;
  quantity: number;
  unit_price: string;
  line_total: string;
  notes: string | null;
};

function clampDiscount(subtotal: number, discount: number) {
  if (!(subtotal > 0)) return 0;
  return Number(Math.min(subtotal, Math.max(0, discount)).toFixed(2));
}

function normalizeExtraAmount(value: unknown) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return Number.NaN;
  return Number(Math.max(0, parsed).toFixed(2));
}

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const tabResult = await query<TabRow>(
    `SELECT
       id,
       table_number,
       customer_name,
       customer_phone,
       customer_id,
       notes,
       discount_amount::text,
       surcharge_amount::text,
       delivery_fee_amount::text,
       subtotal_amount::text,
       total_amount::text,
       status,
       opened_at,
       closed_at,
       updated_at
     FROM pdv_tabs
     WHERE id = $1
       AND tenant_id = $2
     LIMIT 1`,
    [id, session.tenantId],
  );

  if (!tabResult.rowCount) {
    return NextResponse.json({ error: 'Comanda nao encontrada.' }, { status: 404 });
  }

  const itemsResult = await query<TabItemRow>(
    `SELECT
       i.id,
       i.product_id,
       COALESCE(p.name, 'Produto removido') AS product_name,
       p.image_url,
       i.quantity,
       i.unit_price::text,
       i.line_total::text,
       i.notes
     FROM pdv_tab_items i
     LEFT JOIN products p
       ON p.id = i.product_id
      AND p.tenant_id = i.tenant_id
     WHERE i.tab_id = $1
       AND i.tenant_id = $2
     ORDER BY COALESCE(p.name, 'Produto removido') ASC`,
    [id, session.tenantId],
  );

  const tab = tabResult.rows[0];
  return NextResponse.json({
    tab: {
      id: tab.id,
      tableNumber: tab.table_number,
      customerName: tab.customer_name || '',
      customerPhone: tab.customer_phone || '',
      customerId: tab.customer_id || '',
      notes: tab.notes || '',
      discountAmount: Number(tab.discount_amount || 0),
      surchargeAmount: Number(tab.surcharge_amount || 0),
      deliveryFeeAmount: Number(tab.delivery_fee_amount || 0),
      subtotalAmount: Number(tab.subtotal_amount || 0),
      totalAmount: Number(tab.total_amount || 0),
      status: tab.status,
      openedAt: tab.opened_at,
      closedAt: tab.closed_at,
      updatedAt: tab.updated_at,
      items: itemsResult.rows.map((item) => ({
        id: item.id,
        productId: item.product_id,
        productName: item.product_name,
        imageUrl: item.image_url,
        quantity: item.quantity,
        unitPrice: Number(item.unit_price || 0),
        lineTotal: Number(item.line_total || 0),
        notes: item.notes || '',
      })),
    },
  });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const tableNumber = body.tableNumber === undefined ? undefined : String(body.tableNumber || '').trim();
  const customerName = body.customerName === undefined ? undefined : String(body.customerName || '').trim();
  const customerPhone = body.customerPhone === undefined ? undefined : String(body.customerPhone || '').trim();
  const customerId = body.customerId === undefined ? undefined : String(body.customerId || '').trim();
  const discountRaw = body.discountAmount;
  const surchargeRaw = body.surchargeAmount;
  const deliveryFeeRaw = body.deliveryFeeAmount;
  const discountProvided = discountRaw !== undefined;
  const surchargeProvided = surchargeRaw !== undefined;
  const deliveryFeeProvided = deliveryFeeRaw !== undefined;
  const discountAmount = Number(discountRaw || 0);
  const surchargeAmount = normalizeExtraAmount(surchargeRaw);
  const deliveryFeeAmount = normalizeExtraAmount(deliveryFeeRaw);

  if (tableNumber !== undefined && !tableNumber) {
    return NextResponse.json({ error: 'Mesa/comanda nao pode ficar vazia.' }, { status: 400 });
  }
  if (discountProvided && (!Number.isFinite(discountAmount) || discountAmount < 0)) {
    return NextResponse.json({ error: 'Desconto invalido.' }, { status: 400 });
  }
  if (surchargeProvided && Number.isNaN(surchargeAmount)) {
    return NextResponse.json({ error: 'Acrescimo invalido.' }, { status: 400 });
  }
  if (deliveryFeeProvided && Number.isNaN(deliveryFeeAmount)) {
    return NextResponse.json({ error: 'Taxa de entrega invalida.' }, { status: 400 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<TabRow>(
      `SELECT
         id,
         table_number,
         customer_name,
         customer_phone,
         customer_id,
         notes,
         discount_amount::text,
         surcharge_amount::text,
         delivery_fee_amount::text,
         subtotal_amount::text,
         total_amount::text,
         status,
         opened_at,
         closed_at,
         updated_at
       FROM pdv_tabs
       WHERE id = $1
         AND tenant_id = $2
       FOR UPDATE`,
      [id, session.tenantId],
    );

    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda nao encontrada.' }, { status: 404 });
    }
    if (current.rows[0].status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda ja encerrada.' }, { status: 400 });
    }

    const nextTableNumber = tableNumber === undefined ? current.rows[0].table_number : tableNumber;
    if (nextTableNumber !== current.rows[0].table_number) {
      const duplicated = await client.query<{ id: string }>(
        `SELECT id
         FROM pdv_tabs
         WHERE tenant_id = $1
           AND status = 'open'
           AND id <> $2
           AND lower(trim(table_number)) = lower(trim($3))
         LIMIT 1`,
        [session.tenantId, id, nextTableNumber],
      );
      if (duplicated.rowCount) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: 'Ja existe comanda aberta para essa mesa.' }, { status: 409 });
      }
    }

    const subtotalResult = await client.query<{ total: string }>(
      `SELECT COALESCE(SUM(line_total), 0)::text AS total
       FROM pdv_tab_items
       WHERE tab_id = $1
         AND tenant_id = $2`,
      [id, session.tenantId],
    );
    const subtotal = Number(subtotalResult.rows[0]?.total || 0);
    const baseDiscount = discountProvided ? discountAmount : Number(current.rows[0].discount_amount || 0);
    const nextDiscount = clampDiscount(subtotal, baseDiscount);
    const nextSurcharge = subtotal > 0
      ? (surchargeProvided ? surchargeAmount : Number(current.rows[0].surcharge_amount || 0))
      : 0;
    const nextDeliveryFee = subtotal > 0
      ? (deliveryFeeProvided ? deliveryFeeAmount : Number(current.rows[0].delivery_fee_amount || 0))
      : 0;
    const total = Number((subtotal - nextDiscount + nextSurcharge + nextDeliveryFee).toFixed(2));

    const updated = await client.query<TabRow>(
      `UPDATE pdv_tabs
       SET
         table_number = $3,
         customer_name = CASE WHEN $4::text IS NULL THEN customer_name ELSE NULLIF($4, '') END,
         customer_phone = CASE WHEN $5::text IS NULL THEN customer_phone ELSE NULLIF($5, '') END,
         customer_id = CASE WHEN $6::text IS NULL THEN customer_id ELSE NULLIF($6, '') END,
         discount_amount = $7,
         surcharge_amount = $8,
         delivery_fee_amount = $9,
         subtotal_amount = $10,
         total_amount = $11,
         updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $2
       RETURNING
         id,
         table_number,
         customer_name,
         customer_phone,
          customer_id,
          notes,
          discount_amount::text,
          surcharge_amount::text,
          delivery_fee_amount::text,
          subtotal_amount::text,
          total_amount::text,
         status,
         opened_at,
         closed_at,
         updated_at`,
      [
        id,
        session.tenantId,
        nextTableNumber,
        customerName === undefined ? null : customerName,
        customerPhone === undefined ? null : customerPhone,
        customerId === undefined ? null : customerId,
        nextDiscount,
        nextSurcharge,
        nextDeliveryFee,
        subtotal,
        total,
      ],
    );

    await client.query('COMMIT');

    const tab = updated.rows[0];
    return NextResponse.json({
      tab: {
        id: tab.id,
        tableNumber: tab.table_number,
        customerName: tab.customer_name || '',
        customerPhone: tab.customer_phone || '',
        customerId: tab.customer_id || '',
        notes: tab.notes || '',
        discountAmount: Number(tab.discount_amount || 0),
        surchargeAmount: Number(tab.surcharge_amount || 0),
        deliveryFeeAmount: Number(tab.delivery_fee_amount || 0),
        subtotalAmount: Number(tab.subtotal_amount || 0),
        totalAmount: Number(tab.total_amount || 0),
        status: tab.status,
        openedAt: tab.opened_at,
        closedAt: tab.closed_at,
        updatedAt: tab.updated_at,
      },
    });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao atualizar comanda.' }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<TabRow>(
      `SELECT
         id,
         table_number,
         customer_name,
         customer_phone,
         customer_id,
         notes,
         discount_amount::text,
         subtotal_amount::text,
         total_amount::text,
         status,
         opened_at,
         closed_at,
         updated_at
       FROM pdv_tabs
       WHERE id = $1
         AND tenant_id = $2
       FOR UPDATE`,
      [id, session.tenantId],
    );

    if (!current.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda nao encontrada.' }, { status: 404 });
    }

    const tab = current.rows[0];
    if (tab.status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Somente comandas abertas podem ser excluidas.' }, { status: 400 });
    }

    await client.query(
      `DELETE FROM pdv_tabs
       WHERE id = $1
         AND tenant_id = $2`,
      [id, session.tenantId],
    );

    await client.query('COMMIT');
    return NextResponse.json({
      ok: true,
      id: tab.id,
      tableNumber: tab.table_number,
    });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Falha ao excluir comanda.' }, { status: 500 });
  } finally {
    client.release();
  }
}
