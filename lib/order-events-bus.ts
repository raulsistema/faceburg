import type { Notification, PoolClient } from 'pg';
import pool from '@/lib/db';

const CHANNEL_NAME = 'tenant_orders';
const RECONNECT_DELAY_MS = 5000;

export type OrderEventPayload = {
  tenantId: string;
  event?: string;
  orderId?: string;
  ts?: number;
};

type TenantSubscriber = (payload: OrderEventPayload) => void;

type OrderEventBusState = {
  client: PoolClient | null;
  startPromise: Promise<void> | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  subscribers: Map<string, Set<TenantSubscriber>>;
};

declare global {
  var __faceburgOrderEventBusState: OrderEventBusState | undefined;
}

function getBusState(): OrderEventBusState {
  if (!globalThis.__faceburgOrderEventBusState) {
    globalThis.__faceburgOrderEventBusState = {
      client: null,
      startPromise: null,
      reconnectTimer: null,
      subscribers: new Map(),
    };
  }
  return globalThis.__faceburgOrderEventBusState;
}

function dispatch(payload: OrderEventPayload) {
  const state = getBusState();
  const listeners = state.subscribers.get(payload.tenantId);
  if (!listeners || listeners.size === 0) return;

  for (const listener of listeners) {
    try {
      listener(payload);
    } catch {
      // Ignora falhas de subscriber isolado para nao quebrar o fan-out.
    }
  }
}

function parsePayload(notification: Notification): OrderEventPayload | null {
  if (!notification.payload) return null;
  try {
    const parsed = JSON.parse(notification.payload) as Partial<OrderEventPayload>;
    const tenantId = String(parsed.tenantId || '').trim();
    if (!tenantId) return null;
    return {
      tenantId,
      event: parsed.event ? String(parsed.event) : undefined,
      orderId: parsed.orderId ? String(parsed.orderId) : undefined,
      ts: typeof parsed.ts === 'number' ? parsed.ts : Date.now(),
    };
  } catch {
    return null;
  }
}

function scheduleReconnect() {
  const state = getBusState();
  if (state.reconnectTimer) return;
  state.reconnectTimer = setTimeout(() => {
    const currentState = getBusState();
    currentState.reconnectTimer = null;
    void ensureOrderEventBusStarted().catch(() => undefined);
  }, RECONNECT_DELAY_MS);
}

function teardownClient(client: PoolClient) {
  const state = getBusState();
  if (state.client !== client) return;
  state.client = null;
  client.removeAllListeners('notification');
  client.removeAllListeners('error');
  client.removeAllListeners('end');
  client.query(`UNLISTEN ${CHANNEL_NAME}`).catch(() => undefined);
  client.release();
}

function hasAnySubscribers(state: OrderEventBusState) {
  for (const listeners of state.subscribers.values()) {
    if (listeners.size > 0) return true;
  }
  return false;
}

function stopOrderEventBusIfIdle() {
  const state = getBusState();
  if (hasAnySubscribers(state)) return;
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.client) {
    teardownClient(state.client);
  }
}

export async function ensureOrderEventBusStarted() {
  const state = getBusState();
  if (state.client) return;
  if (state.startPromise) return state.startPromise;

  state.startPromise = (async () => {
    const client = await pool.connect();

    const onNotification = (notification: Notification) => {
      const payload = parsePayload(notification);
      if (!payload) return;
      dispatch(payload);
    };

    const onError = () => {
      teardownClient(client);
      scheduleReconnect();
    };

    client.on('notification', onNotification);
    client.on('error', onError);
    client.on('end', onError);

    try {
      await client.query(`LISTEN ${CHANNEL_NAME}`);
      state.client = client;
    } catch (error) {
      client.removeListener('notification', onNotification);
      client.removeListener('error', onError);
      client.removeListener('end', onError);
      client.release();
      scheduleReconnect();
      throw error;
    }
  })().finally(() => {
    const currentState = getBusState();
    currentState.startPromise = null;
  });

  return state.startPromise;
}

export async function subscribeTenantOrderEvents(tenantId: string, listener: TenantSubscriber) {
  const state = getBusState();
  const normalizedTenantId = String(tenantId || '').trim();
  if (!normalizedTenantId) {
    return () => undefined;
  }

  let listeners = state.subscribers.get(normalizedTenantId);
  if (!listeners) {
    listeners = new Set();
    state.subscribers.set(normalizedTenantId, listeners);
  }
  listeners.add(listener);

  try {
    await ensureOrderEventBusStarted();
  } catch {
    // Mantem subscriber registrado para ser atendido apos reconexao.
    scheduleReconnect();
  }

  return () => {
    const currentState = getBusState();
    const tenantListeners = currentState.subscribers.get(normalizedTenantId);
    if (!tenantListeners) return;
    tenantListeners.delete(listener);
    if (!tenantListeners.size) {
      currentState.subscribers.delete(normalizedTenantId);
    }
    stopOrderEventBusIfIdle();
  };
}
