import { NextResponse } from 'next/server';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { subscribeTenantOrderEvents, type OrderEventPayload } from '@/lib/order-events-bus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const MAX_SSE_LIFETIME_MS = 30 * 60 * 1000;

type OrderNotificationPayload = {
  tenantId: string;
  event?: string;
  orderId?: string;
  ts?: number;
};

export async function GET(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
  let unsubscribe: (() => void) | null = null;
  let abortHandler: (() => void) | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const cleanup = async () => {
        if (closed) return;
        closed = true;
        if (heartbeatTimer) {
          clearInterval(heartbeatTimer);
          heartbeatTimer = null;
        }
        if (lifetimeTimer) {
          clearTimeout(lifetimeTimer);
          lifetimeTimer = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        if (abortHandler) {
          request.signal.removeEventListener('abort', abortHandler);
          abortHandler = null;
        }
        try {
          controller.close();
        } catch {
          // Stream ja pode ter sido encerrada.
        }
      };

      const onAbort = () => {
        void cleanup();
      };
      abortHandler = onAbort;

      const onNotification = (payload: OrderEventPayload) => {
        if (payload.tenantId !== session.tenantId) return;
        const normalizedPayload: OrderNotificationPayload = {
          tenantId: payload.tenantId,
          event: payload.event,
          orderId: payload.orderId,
          ts: payload.ts ?? Date.now(),
        };
        controller.enqueue(
          encoder.encode(`event: order-updated\ndata: ${JSON.stringify(normalizedPayload)}\n\n`),
        );
      };

      request.signal.addEventListener('abort', onAbort);

      try {
        unsubscribe = await subscribeTenantOrderEvents(session.tenantId, onNotification);
        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ tenantId: session.tenantId, ts: Date.now() })}\n\n`,
          ),
        );
      } catch {
        if (abortHandler) {
          request.signal.removeEventListener('abort', abortHandler);
          abortHandler = null;
        }
        controller.error(new Error('Falha ao iniciar eventos de pedidos.'));
        return;
      }

      heartbeatTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
        } catch {
          void cleanup();
        }
      }, 25000);

      lifetimeTimer = setTimeout(() => {
        void cleanup();
      }, MAX_SSE_LIFETIME_MS);
    },
    async cancel() {
      if (closed) return;
      closed = true;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      if (lifetimeTimer) {
        clearTimeout(lifetimeTimer);
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
      if (abortHandler) {
        request.signal.removeEventListener('abort', abortHandler);
        abortHandler = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
