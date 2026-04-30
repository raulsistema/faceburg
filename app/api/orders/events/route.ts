import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const CHANNEL_NAME = 'tenant_orders';
const MAX_SSE_LIFETIME_MS = 30 * 60 * 1000;

type OrderNotificationPayload = {
  tenantId?: string;
  event?: string;
  orderId?: string;
  ts?: number;
};

export async function GET(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const client = await pool.connect();
  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  let lifetimeTimer: ReturnType<typeof setTimeout> | null = null;
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
        client.removeListener('notification', onNotification);
        client.removeListener('error', onClientError);
        client.removeListener('end', onClientError);
        request.signal.removeEventListener('abort', onAbort);
        try {
          await client.query(`UNLISTEN ${CHANNEL_NAME}`);
        } catch {
          // Ignora falha no unlisten durante o encerramento.
        }
        client.release();
        try {
          controller.close();
        } catch {
          // Stream ja pode ter sido encerrada.
        }
      };

      const onAbort = () => {
        void cleanup();
      };

      const onClientError = () => {
        void cleanup();
      };

      const onNotification = (message: { payload?: string | undefined }) => {
        if (!message.payload) return;
        try {
          const payload = JSON.parse(message.payload) as OrderNotificationPayload;
          if (payload.tenantId !== session.tenantId) return;
          controller.enqueue(
            encoder.encode(`event: order-updated\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          void cleanup();
        }
      };

      request.signal.addEventListener('abort', onAbort);
      client.on('notification', onNotification);
      client.on('error', onClientError);
      client.on('end', onClientError);

      try {
        await client.query(`LISTEN ${CHANNEL_NAME}`);
        controller.enqueue(
          encoder.encode(
            `event: connected\ndata: ${JSON.stringify({ tenantId: session.tenantId, ts: Date.now() })}\n\n`,
          ),
        );
      } catch {
        request.signal.removeEventListener('abort', onAbort);
        client.removeListener('notification', onNotification);
        client.removeListener('error', onClientError);
        client.removeListener('end', onClientError);
        client.release();
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
      client.removeAllListeners('notification');
      client.removeAllListeners('error');
      client.removeAllListeners('end');
      try {
        await client.query(`UNLISTEN ${CHANNEL_NAME}`);
      } catch {
        // Ignora falha ao cancelar stream.
      }
      client.release();
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
