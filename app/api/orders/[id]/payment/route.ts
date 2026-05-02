import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type OrderRow = {
  id: string;
  status: 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';
  total: string;
};

type PaymentMethodRow = {
  id: string;
  name: string;
  method_type: string;
  fee_percent: string;
  fee_fixed: string;
};

function normalizePaymentMethodType(value: unknown) {
  const paymentMethod = String(value || '').trim().toLowerCase();
  if (paymentMethod === 'pix') return 'pix';
  if (paymentMethod === 'cash' || paymentMethod === 'money' || paymentMethod === 'dinheiro') return 'cash';
  if (paymentMethod === 'card' || paymentMethod === 'cartao' || paymentMethod === 'credito' || paymentMethod === 'debito') return 'card';
  if (paymentMethod === 'bank_slip' || paymentMethod === 'boleto') return 'bank_slip';
  if (paymentMethod === 'wallet' || paymentMethod === 'carteira') return 'wallet';
  if (paymentMethod === 'other') return 'other';
  return '';
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const paymentMethodId = String(body.paymentMethodId || '').trim();
  const paymentMethodRaw = String(body.paymentMethod || '').trim();
  const normalizedPaymentMethodType = normalizePaymentMethodType(paymentMethodRaw);

  const orderResult = await query<OrderRow>(
    `SELECT id, status, total::text
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [session.tenantId, id],
  );

  if (!orderResult.rowCount) {
    return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
  }

  const order = orderResult.rows[0];
  if (order.status === 'completed' || order.status === 'cancelled') {
    return NextResponse.json({ error: 'Nao e possivel alterar o pagamento de um pedido finalizado ou cancelado.' }, { status: 400 });
  }

  let selectedMethod: PaymentMethodRow | null = null;

  if (paymentMethodId) {
    const byId = await query<PaymentMethodRow>(
      `SELECT id, name, method_type, fee_percent::text, fee_fixed::text
       FROM payment_methods
       WHERE tenant_id = $1
         AND id = $2
         AND active = TRUE
       LIMIT 1`,
      [session.tenantId, paymentMethodId],
    );
    selectedMethod = byId.rows[0] || null;
  } else if (paymentMethodRaw) {
    const byName = await query<PaymentMethodRow>(
      `SELECT id, name, method_type, fee_percent::text, fee_fixed::text
       FROM payment_methods
       WHERE tenant_id = $1
         AND lower(name) = lower($2)
         AND active = TRUE
       LIMIT 1`,
      [session.tenantId, paymentMethodRaw],
    );
    selectedMethod = byName.rows[0] || null;

    if (!selectedMethod && normalizedPaymentMethodType) {
      const byType = await query<PaymentMethodRow>(
        `SELECT id, name, method_type, fee_percent::text, fee_fixed::text
         FROM payment_methods
         WHERE tenant_id = $1
           AND method_type = $2
           AND active = TRUE
         ORDER BY created_at ASC
         LIMIT 1`,
        [session.tenantId, normalizedPaymentMethodType],
      );
      selectedMethod = byType.rows[0] || null;
    }
  }

  if (!selectedMethod) {
    return NextResponse.json({ error: 'Forma de pagamento invalida ou inativa.' }, { status: 400 });
  }

  const total = Number(order.total || 0);
  const feePercent = Number(selectedMethod.fee_percent || 0);
  const feeFixed = Number(selectedMethod.fee_fixed || 0);
  const feeAmount = roundMoney(total * (feePercent / 100) + feeFixed);
  const netAmount = roundMoney(total - feeAmount);

  if (netAmount < 0) {
    return NextResponse.json({ error: 'A taxa configurada para essa forma excede o valor do pedido.' }, { status: 400 });
  }

  const updateResult = await query<{ updated_at: string }>(
    `UPDATE orders
     SET payment_method = $1,
         payment_method_id = $2,
         payment_fee_amount = $3,
         payment_net_amount = $4,
         updated_at = NOW()
     WHERE tenant_id = $5
       AND id = $6
     RETURNING updated_at`,
    [selectedMethod.name, selectedMethod.id, feeAmount, netAmount, session.tenantId, id],
  );

  return NextResponse.json({
    ok: true,
    paymentMethod: selectedMethod.name,
    paymentMethodId: selectedMethod.id,
    paymentMethodType: selectedMethod.method_type,
    paymentFeeAmount: feeAmount,
    paymentNetAmount: netAmount,
    updatedAt: updateResult.rows[0]?.updated_at ?? new Date().toISOString(),
  });
}
