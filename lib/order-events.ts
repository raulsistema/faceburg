import { EventEmitter } from 'node:events';
import pool from '@/lib/db';
import type { PoolClient } from 'pg';

const CHANNEL_NAME = 'tenant_orders';
const RECONNECT_DELAY_MS = 3000;

export type OrderEventPayload = {
  tenantId?: string;
  event?: string;
  orderId?: string;
  ts?: number;
};

type OrderEventsState = {
  emitter: EventEmitter;
  listenerClient: PoolClient | null;
  startPromise: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
};

declare global {
  var __faceburgOrderEventsState: OrderEventsState | undefined;
}

function getState(): OrderEventsState {
  if (!globalThis.__faceburgOrderEventsState) {
    const emitter = new EventEmitter();
    emitter.setMaxListeners(200);
    globalThis.__faceburgOrderEventsState = {
      emitter,
      listenerClient: null,
      startPromise: null,
      reconnectTimer: null,
    };
  }
  return globalThis.__faceburgOrderEventsState;
}

function scheduleReconnect() {
  const state = getState();
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    void ensureOrderEventsListener();
  }, RECONNECT_DELAY_MS);
}

export async function ensureOrderEventsListener(): Promise<void> {
  const state = getState();
  if (state.listenerClient) return;
  if (state.startPromise) {
    await state.startPromise;
    return;
  }

  state.startPromise = (async () => {
    const client = await pool.connect();

    const handleDrop = () => {
      try {
        client.removeAllListeners();
        client.release();
      } catch {
        // ignore release errors on reconnect path
      }
      if (state.listenerClient === client) {
        state.listenerClient = null;
      }
      scheduleReconnect();
    };

    client.on('notification', (message) => {
      if (!message.payload) return;
      try {
        const payload = JSON.parse(message.payload) as OrderEventPayload;
        state.emitter.emit('order-event', payload);
      } catch {
        // ignore malformed payload
      }
    });

    client.on('error', handleDrop);
    client.on('end', handleDrop);

    await client.query(`LISTEN ${CHANNEL_NAME}`);
    state.listenerClient = client;
  })();

  try {
    await state.startPromise;
  } finally {
    state.startPromise = null;
  }
}

export function subscribeToOrderEvents(listener: (payload: OrderEventPayload) => void) {
  const state = getState();
  state.emitter.on('order-event', listener);
  return () => {
    state.emitter.off('order-event', listener);
  };
}
