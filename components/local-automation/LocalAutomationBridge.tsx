'use client';

import { useEffect, useRef, useState } from 'react';

type OrderStatus = 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';

type OrderDetailResponse = {
  order?: {
    id: string;
    status: OrderStatus;
  };
  error?: string;
};

type OrdersResponse = {
  orders?: Array<{
    id: string;
    status: OrderStatus;
    createdAt?: string;
  }>;
};

type PrintConfigResponse = {
  enabled?: boolean;
  connectionStatus?: string;
  lastSeenAt?: string | null;
};

type WhatsappConfigResponse = {
  enabled?: boolean;
  sessionStatus?: string;
  lastSeenAt?: string | null;
};

type LocalAgentHealth = {
  online?: boolean;
  whatsapp?: {
    status?: string;
  };
};

type LocalPrintJob = {
  id: string;
  orderId?: string;
  eventType?: string;
  payloadText: string;
  columns?: number;
  printTextSize?: string;
  printerName?: string;
  copyIndex?: number;
  copies?: number;
};

type LocalWhatsappJob = {
  id: string;
  orderId?: string;
  eventType?: string;
  targetPhone: string;
  payloadText: string;
};

type LocalDispatchPayload = {
  printJobs?: LocalPrintJob[];
  whatsappJobs?: LocalWhatsappJob[];
  errors?: string[];
};

type DispatchFallbackResponse = {
  ok?: boolean;
  printQueued?: boolean;
  whatsappQueued?: boolean;
  error?: string;
};

type OrderEventPayload = {
  event?: string;
  orderId?: string;
  ts?: number;
};

type NavigatorWithLocks = Navigator & {
  locks?: {
    request: (
      name: string,
      options: { mode?: 'exclusive'; signal?: AbortSignal },
      callback: () => Promise<void>,
    ) => Promise<void>;
  };
};

const LOCAL_AGENT_URL = 'http://127.0.0.1:9787';
const LOCK_NAME = 'faceburg-local-automation';
const LEADER_STORAGE_KEY = 'faceburg:localAutomation:leader:v1';
const PROCESSED_STORAGE_KEY = 'faceburg:localAutomation:processed:v1';
const PROCESSED_TTL_MS = 20 * 60 * 1000;
const NEW_ORDER_SCAN_WINDOW_MS = 20 * 60 * 1000;
const FALLBACK_SCAN_INITIAL_MS = 30_000;
const FALLBACK_SCAN_MAX_MS = 5 * 60 * 1000;
const LEADER_HEARTBEAT_MS = 2500;
const LEADER_EXPIRES_MS = 9000;
const PRINT_HUB_ACTIVE_MS = 5 * 60 * 1000;
const WHATSAPP_HUB_ACTIVE_MS = 2 * 60 * 1000;

function makeTabId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Falha desconhecida.');
}

function readJsonRecord(key: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function claimProcessed(key: string) {
  const now = Date.now();
  const processed = readJsonRecord(PROCESSED_STORAGE_KEY);
  const compacted: Record<string, number> = {};
  for (const [entryKey, expiresAt] of Object.entries(processed)) {
    if (Number(expiresAt) > now) {
      compacted[entryKey] = Number(expiresAt);
    }
  }

  if (compacted[key] && compacted[key] > now) {
    window.localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(compacted));
    return false;
  }

  compacted[key] = now + PROCESSED_TTL_MS;
  window.localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(compacted));
  return true;
}

async function fetchJson<T>(url: string, init?: RequestInit) {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {
      'cache-control': 'no-cache',
      ...(init?.headers || {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

async function requestLocalAgent<T>(path: string, init: RequestInit = {}, timeoutMs = 1200) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson<T>(`${LOCAL_AGENT_URL}${path}`, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function probeLocalAgent() {
  try {
    const health = await requestLocalAgent<LocalAgentHealth>('/api/health', {}, 900);
    return {
      available: Boolean(health.online),
      whatsappReady: String(health.whatsapp?.status || '') === 'ready',
    };
  } catch {
    return { available: false, whatsappReady: false };
  }
}

async function queueOrderDispatchFallback(
  orderId: string,
  payload: {
    printEventType?: 'new_order' | 'status_update' | 'manual_receipt';
    printEventTypes?: Array<'new_order' | 'status_update' | 'manual_receipt'>;
    whatsappEventType?: 'new_order' | 'status_update';
  },
) {
  return fetchJson<DispatchFallbackResponse>(`/api/orders/${orderId}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function runLocalPrintJobs(printJobs: LocalPrintJob[]) {
  for (const job of printJobs) {
    await requestLocalAgent('/api/print', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    }, 12000);
  }
}

async function runLocalWhatsappJobs(whatsappJobs: LocalWhatsappJob[]) {
  for (const job of whatsappJobs) {
    await requestLocalAgent('/api/whatsapp/send', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    }, 35000);
  }
}

async function dispatchLocalJobs(
  orderId: string,
  localDispatch: LocalDispatchPayload | undefined,
  expected: { print?: boolean; whatsapp?: boolean },
  fallbackEvents: {
    print?: 'new_order' | 'status_update' | 'manual_receipt' | Array<'new_order' | 'status_update' | 'manual_receipt'>;
    whatsapp?: 'new_order' | 'status_update';
  },
) {
  const failures: string[] = [];
  const printJobs = Array.isArray(localDispatch?.printJobs) ? localDispatch.printJobs : [];
  const whatsappJobs = Array.isArray(localDispatch?.whatsappJobs) ? localDispatch.whatsappJobs : [];
  const dispatchErrors = Array.isArray(localDispatch?.errors) ? localDispatch.errors : [];
  let printFailed = false;
  let whatsappFailed = false;

  if (expected.print) {
    if (!printJobs.length) {
      if (dispatchErrors.includes('print')) {
        printFailed = true;
        failures.push('impressao');
      } else {
        printFailed = true;
        failures.push('impressao (nenhum recibo preparado)');
      }
    } else {
      try {
        await runLocalPrintJobs(printJobs);
      } catch (error) {
        printFailed = true;
        failures.push(`impressao (${errorMessage(error)})`);
      }
    }
  }

  if (expected.whatsapp) {
    if (!whatsappJobs.length) {
      if (dispatchErrors.includes('whatsapp')) {
        whatsappFailed = true;
        failures.push('WhatsApp');
      } else {
        whatsappFailed = true;
        failures.push('WhatsApp (nenhuma mensagem preparada)');
      }
    } else {
      try {
        await runLocalWhatsappJobs(whatsappJobs);
      } catch (error) {
        whatsappFailed = true;
        failures.push(`WhatsApp (${errorMessage(error)})`);
      }
    }
  }

  if (!failures.length) return;

  const fallbackPrintEvents = fallbackEvents.print || 'new_order';
  await queueOrderDispatchFallback(orderId, {
    printEventType: printFailed && !Array.isArray(fallbackPrintEvents) ? fallbackPrintEvents : undefined,
    printEventTypes: printFailed && Array.isArray(fallbackPrintEvents) ? fallbackPrintEvents : undefined,
    whatsappEventType: whatsappFailed ? fallbackEvents.whatsapp || 'new_order' : undefined,
  }).catch(() => undefined);
}

function isRecentOpenOrder(order: { status: OrderStatus; createdAt?: string }) {
  if (order.status !== 'pending' && order.status !== 'processing') return false;
  const createdAt = Date.parse(order.createdAt || '');
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt <= NEW_ORDER_SCAN_WINDOW_MS;
}

function isRecentHeartbeat(lastSeenAt: string | null | undefined, maxAgeMs: number) {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= maxAgeMs;
}

function isServerPrintHubActive(config: PrintConfigResponse) {
  return (
    config.enabled === true &&
    ['ready', 'connecting'].includes(String(config.connectionStatus || '')) &&
    isRecentHeartbeat(config.lastSeenAt, PRINT_HUB_ACTIVE_MS)
  );
}

function isServerWhatsappHubActive(config: WhatsappConfigResponse) {
  return (
    config.enabled === true &&
    String(config.sessionStatus || '') === 'ready' &&
    isRecentHeartbeat(config.lastSeenAt, WHATSAPP_HUB_ACTIVE_MS)
  );
}

function parseLeaderRecord() {
  try {
    return JSON.parse(window.localStorage.getItem(LEADER_STORAGE_KEY) || '{}') as {
      owner?: string;
      expiresAt?: number;
    };
  } catch {
    return {};
  }
}

function useAutomationLeadership(enabled: boolean, tenantId: string) {
  const [leader, setLeader] = useState(false);
  const tabIdRef = useRef(makeTabId());

  useEffect(() => {
    if (!enabled || !tenantId) {
      setLeader(false);
      return;
    }

    let disposed = false;
    let releaseLock: (() => void) | null = null;
    const navigatorWithLocks = navigator as NavigatorWithLocks;
    const tabId = tabIdRef.current;

    if (navigatorWithLocks.locks?.request) {
      const controller = new AbortController();
      void navigatorWithLocks.locks
        .request(LOCK_NAME, { mode: 'exclusive', signal: controller.signal }, async () => {
          if (disposed) return;
          setLeader(true);
          await new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
          setLeader(false);
        })
        .catch(() => {
          if (!disposed) setLeader(false);
        });

      return () => {
        disposed = true;
        controller.abort();
        releaseLock?.();
        setLeader(false);
      };
    }

    function tryClaimFallbackLeadership() {
      if (disposed) return;
      const now = Date.now();
      const current = parseLeaderRecord();
      const canClaim = !current.owner || current.owner === tabId || Number(current.expiresAt || 0) < now;

      if (canClaim) {
        window.localStorage.setItem(
          LEADER_STORAGE_KEY,
          JSON.stringify({
            owner: tabId,
            expiresAt: now + LEADER_EXPIRES_MS,
          }),
        );
        setLeader(true);
        return;
      }

      setLeader(false);
    }

    tryClaimFallbackLeadership();
    const intervalId = window.setInterval(tryClaimFallbackLeadership, LEADER_HEARTBEAT_MS);
    const onStorage = (event: StorageEvent) => {
      if (event.key === LEADER_STORAGE_KEY) {
        tryClaimFallbackLeadership();
      }
    };
    window.addEventListener('storage', onStorage);

    return () => {
      disposed = true;
      window.clearInterval(intervalId);
      window.removeEventListener('storage', onStorage);
      const current = parseLeaderRecord();
      if (current.owner === tabId) {
        window.localStorage.removeItem(LEADER_STORAGE_KEY);
      }
      setLeader(false);
    };
  }, [enabled, tenantId]);

  return leader;
}

export default function LocalAutomationBridge({
  enabled,
  tenantId,
}: {
  enabled: boolean;
  tenantId: string;
}) {
  const isLeader = useAutomationLeadership(enabled, tenantId);
  const knownOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !tenantId || !isLeader) return;

    let disposed = false;
    let eventSource: EventSource | null = null;
    let reconnectTimer: number | null = null;
    let fallbackTimer: number | null = null;
    let fallbackDelayMs = FALLBACK_SCAN_INITIAL_MS;

    function clearReconnectTimer() {
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    }

    function clearFallbackTimer() {
      if (fallbackTimer) {
        window.clearTimeout(fallbackTimer);
        fallbackTimer = null;
      }
    }

    function closeEventSource() {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
    }

    async function dispatchNewOrder(orderId: string) {
      const normalizedOrderId = String(orderId || '').trim();
      if (!normalizedOrderId) return;
      knownOrderIdsRef.current.add(normalizedOrderId);

      const processedKey = `${tenantId}:new-order:${normalizedOrderId}`;
      if (!claimProcessed(processedKey)) return;

      let fallbackPrintEvents: 'new_order' | Array<'new_order' | 'status_update'> = 'new_order';
      let shouldFallbackPrint = false;
      let shouldFallbackWhatsapp = false;

      try {
        const orderData = await fetchJson<OrderDetailResponse>(`/api/orders/${normalizedOrderId}`);
        const status = orderData.order?.status;
        if (status !== 'pending' && status !== 'processing') return;
        const autoAccepted = status === 'processing';
        fallbackPrintEvents = autoAccepted ? ['new_order', 'status_update'] : 'new_order';

        const [printConfig, whatsappConfig, localAgent] = await Promise.all([
          fetchJson<PrintConfigResponse>('/api/print/config').catch(() => ({ enabled: false })),
          fetchJson<WhatsappConfigResponse>('/api/whatsapp/config').catch(() => ({ enabled: false })),
          probeLocalAgent(),
        ]);

        const wantsPrint = Boolean(printConfig.enabled);
        const wantsWhatsapp = Boolean(whatsappConfig.enabled);
        if (!wantsPrint && !wantsWhatsapp) return;

        const serverPrintHubActive = isServerPrintHubActive(printConfig);
        const serverWhatsappHubActive = isServerWhatsappHubActive(whatsappConfig);
        const canUseLocalPrint = Boolean(printConfig.enabled && localAgent.available && !serverPrintHubActive);
        const canUseLocalWhatsapp = Boolean(whatsappConfig.enabled && localAgent.whatsappReady && !serverWhatsappHubActive);
        const shouldQueueFallbackPrint = wantsPrint && !canUseLocalPrint && !serverPrintHubActive;
        const shouldQueueFallbackWhatsapp = wantsWhatsapp && !canUseLocalWhatsapp && !serverWhatsappHubActive;
        shouldFallbackPrint = wantsPrint && !serverPrintHubActive;
        shouldFallbackWhatsapp = wantsWhatsapp && !serverWhatsappHubActive;
        if (shouldQueueFallbackPrint || shouldQueueFallbackWhatsapp) {
          await queueOrderDispatchFallback(normalizedOrderId, {
            printEventType: shouldQueueFallbackPrint && !Array.isArray(fallbackPrintEvents)
              ? fallbackPrintEvents
              : undefined,
            printEventTypes: shouldQueueFallbackPrint && Array.isArray(fallbackPrintEvents)
              ? fallbackPrintEvents
              : undefined,
            whatsappEventType: shouldQueueFallbackWhatsapp ? 'new_order' : undefined,
          }).catch(() => undefined);
        }
        if (!canUseLocalPrint && !canUseLocalWhatsapp) return;

        const printEventTypes: Array<'new_order' | 'status_update'> = canUseLocalPrint
          ? autoAccepted
            ? ['new_order', 'status_update']
            : ['new_order']
          : [];

        const dispatchData = await fetchJson<{ localDispatch?: LocalDispatchPayload }>(`/api/orders/${normalizedOrderId}/dispatch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            preferLocalAgent: true,
            printEventTypes,
            whatsappEventType: canUseLocalWhatsapp ? 'new_order' : undefined,
          }),
        });

        await dispatchLocalJobs(
          normalizedOrderId,
          dispatchData.localDispatch,
          { print: canUseLocalPrint, whatsapp: canUseLocalWhatsapp },
          { print: fallbackPrintEvents, whatsapp: 'new_order' },
        );
      } catch (error) {
        console.warn('Faceburg local automation failed', error);
        if (shouldFallbackPrint || shouldFallbackWhatsapp) {
          await queueOrderDispatchFallback(normalizedOrderId, {
            printEventType: shouldFallbackPrint && !Array.isArray(fallbackPrintEvents) ? fallbackPrintEvents : undefined,
            printEventTypes: shouldFallbackPrint && Array.isArray(fallbackPrintEvents) ? fallbackPrintEvents : undefined,
            whatsappEventType: shouldFallbackWhatsapp ? 'new_order' : undefined,
          }).catch(() => undefined);
        }
      }
    }

    async function primeKnownOrders() {
      try {
        const data = await fetchJson<OrdersResponse>('/api/orders');
        for (const order of data.orders || []) {
          if (isRecentOpenOrder(order)) {
            void dispatchNewOrder(order.id);
            continue;
          }
          knownOrderIdsRef.current.add(order.id);
        }
      } catch {
        // A automacao continua pelo realtime mesmo se a primeira carga falhar.
      }
    }

    async function scanFallbackOrders() {
      if (disposed) return;
      try {
        const data = await fetchJson<OrdersResponse>('/api/orders');
        for (const order of data.orders || []) {
          const alreadyKnown = knownOrderIdsRef.current.has(order.id);
          knownOrderIdsRef.current.add(order.id);
          if (!alreadyKnown && isRecentOpenOrder(order)) {
            void dispatchNewOrder(order.id);
          }
        }
      } catch {
        // Mantem backoff sem transformar a queda do realtime em martelada.
      } finally {
        if (!disposed && !eventSource) {
          fallbackDelayMs = Math.min(fallbackDelayMs * 2, FALLBACK_SCAN_MAX_MS);
          scheduleFallbackScan();
        }
      }
    }

    function scheduleFallbackScan() {
      if (disposed || fallbackTimer) return;
      fallbackTimer = window.setTimeout(() => {
        fallbackTimer = null;
        void scanFallbackOrders();
      }, fallbackDelayMs);
    }

    function scheduleReconnect() {
      if (disposed || reconnectTimer) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connectEvents();
      }, Math.min(fallbackDelayMs, 60_000));
      scheduleFallbackScan();
    }

    function connectEvents() {
      if (disposed || typeof EventSource === 'undefined') return;
      clearReconnectTimer();
      closeEventSource();
      eventSource = new EventSource('/api/orders/events');

      eventSource.addEventListener('connected', () => {
        fallbackDelayMs = FALLBACK_SCAN_INITIAL_MS;
        clearFallbackTimer();
        fallbackTimer = window.setTimeout(() => {
          fallbackTimer = null;
          void scanFallbackOrders();
        }, 1000);
      });

      eventSource.addEventListener('order-updated', (event) => {
        try {
          const payload = JSON.parse((event as MessageEvent).data || '{}') as OrderEventPayload;
          if (payload.orderId) {
            knownOrderIdsRef.current.add(payload.orderId);
          }
          if (payload.event === 'created' && payload.orderId) {
            void dispatchNewOrder(payload.orderId);
          }
        } catch {
          // Evento malformado nao deve derrubar o bridge.
        }
      });

      eventSource.onerror = () => {
        closeEventSource();
        scheduleReconnect();
      };
    }

    void primeKnownOrders().finally(() => {
      if (!disposed) {
        connectEvents();
      }
    });

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearFallbackTimer();
      closeEventSource();
    };
  }, [enabled, isLeader, tenantId]);

  return null;
}
