import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedDeliveryAccess } from '@/lib/delivery-auth';
import { buildTrackingUrl } from '@/lib/delivery-tracking';

export const dynamic = 'force-dynamic';

type DeliveryStateRow = {
  id: string;
  status: string;
  type: string;
  delivery_tracking_token: string | null;
  delivery_driver_code: string | null;
  delivery_started_at: string | null;
  delivery_finished_at: string | null;
};

async function forwardStatusChange(request: Request, orderId: string, status: string) {
  const url = new URL(`/api/orders/${encodeURIComponent(orderId)}/status`, request.url);
  return fetch(url, {
    method: 'PATCH',
    headers: {
      'content-type': 'application/json',
      cookie: request.headers.get('cookie') || '',
      authorization: request.headers.get('authorization') || '',
    },
    body: JSON.stringify({ status }),
  });
}

async function loadDeliveryState(tenantId: string, orderId: string) {
  const result = await query<DeliveryStateRow>(
    `SELECT id,
            status,
            type,
            delivery_tracking_token,
            delivery_driver_code,
            delivery_started_at,
            delivery_finished_at
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [tenantId, orderId],
  );
  return result.rows[0] || null;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const current = await loadDeliveryState(session.tenantId, id);
  if (!current) {
    return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
  }
  if (current.type !== 'delivery') {
    return NextResponse.json({ error: 'Somente pedidos de entrega podem ser finalizados aqui.' }, { status: 400 });
  }
  if (current.status === 'cancelled') {
    return NextResponse.json({ error: 'Pedido cancelado nao pode ser finalizado.' }, { status: 409 });
  }

  const statusResponse = await forwardStatusChange(request, id, 'completed');
  const statusData = (await statusResponse.json().catch(() => ({}))) as { error?: string };
  if (!statusResponse.ok) {
    return NextResponse.json(
      { error: statusData.error || 'Falha ao finalizar entrega.' },
      { status: statusResponse.status },
    );
  }

  const next = await loadDeliveryState(session.tenantId, id);
  const token = next?.delivery_tracking_token || '';
  return NextResponse.json({
    ok: true,
    order: {
      id,
      status: next?.status || 'completed',
      code: next?.delivery_driver_code || id.slice(0, 8).toUpperCase(),
      trackingToken: token,
      trackingUrl: token ? buildTrackingUrl(token) : '',
      deliveryStartedAt: next?.delivery_started_at || null,
      deliveryFinishedAt: next?.delivery_finished_at || null,
    },
  });
}
