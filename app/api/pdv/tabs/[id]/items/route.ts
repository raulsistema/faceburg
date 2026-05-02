import { randomUUID } from 'node:crypto';
import pool from '@/lib/db';
import { NextResponse } from 'next/server';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type TabStatusRow = {
  id: string;
  status: 'open' | 'closed' | 'cancelled';
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
};

type ProductRow = {
  id: string;
  price: string;
  available: boolean;
};

type InputItem = {
  productId: string;
  quantity: number;
};

function clampDiscount(subtotal: number, discount: number) {
  if (!(subtotal > 0)) return 0;
  return Number(Math.min(subtotal, Math.max(0, discount)).toFixed(2));
}

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json();
  const rawItems = Array.isArray(body.items) ? (body.items as InputItem[]) : [];
  const normalizedItems = rawItems
    .map((item) => ({
      productId: String(item.productId || '').trim(),
      quantity: Number(item.quantity || 0),
    }))
    .filter((item) => item.productId && item.quantity > 0);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const tabStatus = await client.query<TabStatusRow>(
      `SELECT id, status, discount_amount::text
              , surcharge_amount::text
              , delivery_fee_amount::text
       FROM pdv_tabs
       WHERE id = $1
         AND tenant_id = $2
       FOR UPDATE`,
      [id, session.tenantId],
    );
    if (!tabStatus.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda nao encontrada.' }, { status: 404 });
    }
    if (tabStatus.rows[0].status !== 'open') {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Comanda ja encerrada.' }, { status: 400 });
    }

    const productIds = Array.from(new Set(normalizedItems.map((item) => item.productId)));
    let productMap = new Map<string, ProductRow>();
    if (productIds.length) {
      const productsResult = await client.query<ProductRow>(
        `SELECT id, price::text, available
         FROM products
         WHERE tenant_id = $1
           AND id = ANY($2::text[])`,
        [session.tenantId, productIds],
      );
      productMap = new Map(productsResult.rows.map((row) => [row.id, row]));
    }

    let subtotal = 0;
    const resolvedItems = normalizedItems.map((item) => {
      const product = productMap.get(item.productId);
      if (!product || !product.available) {
        throw new Error(`Produto indisponivel: ${item.productId}`);
      }
      const unitPrice = Number(product.price || 0);
      const lineTotal = Number((unitPrice * item.quantity).toFixed(2));
      subtotal += lineTotal;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice,
        lineTotal,
      };
    });

    subtotal = Number(subtotal.toFixed(2));
    const currentDiscount = Number(tabStatus.rows[0].discount_amount || 0);
    const currentSurcharge = subtotal > 0 ? Number(tabStatus.rows[0].surcharge_amount || 0) : 0;
    const currentDeliveryFee = subtotal > 0 ? Number(tabStatus.rows[0].delivery_fee_amount || 0) : 0;
    const nextDiscount = clampDiscount(subtotal, currentDiscount);
    const total = Number((subtotal - nextDiscount + currentSurcharge + currentDeliveryFee).toFixed(2));

    await client.query(
      `DELETE FROM pdv_tab_items
       WHERE tab_id = $1
         AND tenant_id = $2`,
      [id, session.tenantId],
    );

    for (const item of resolvedItems) {
      await client.query(
        `INSERT INTO pdv_tab_items
           (id, tab_id, tenant_id, product_id, quantity, unit_price, line_total, updated_at)
         VALUES
           ($1, $2, $3, $4, $5, $6, $7, NOW())`,
        [randomUUID(), id, session.tenantId, item.productId, item.quantity, item.unitPrice, item.lineTotal],
      );
    }

    await client.query(
      `UPDATE pdv_tabs
       SET subtotal_amount = $3,
           discount_amount = $4,
           surcharge_amount = $5,
           delivery_fee_amount = $6,
           total_amount = $7,
           updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $2`,
      [id, session.tenantId, subtotal, nextDiscount, currentSurcharge, currentDeliveryFee, total],
    );

    await client.query('COMMIT');

    return NextResponse.json({
      ok: true,
      subtotal,
      discountAmount: nextDiscount,
      surchargeAmount: currentSurcharge,
      deliveryFeeAmount: currentDeliveryFee,
      total,
      itemsCount: resolvedItems.length,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    const message = error instanceof Error ? error.message : 'Falha ao salvar itens da comanda.';
    if (message.startsWith('Produto indisponivel:')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return NextResponse.json({ error: 'Falha ao salvar itens da comanda.' }, { status: 500 });
  } finally {
    client.release();
  }
}
