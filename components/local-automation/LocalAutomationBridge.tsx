'use client';

import { useEffect, useRef, useState } from 'react';

type OrderStatus = 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';
type PrintEventType = 'new_order' | 'status_update' | 'manual_receipt';
type WhatsappEventType = 'new_order' | 'status_update';

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

type LocalAgentHealth = {
  online?: boolean;
  terminalId?: string;
  printerName?: string;
  whatsapp?: {
    status?: string;
  };
};

type DesktopBridgeState = {
  isDesktopApp?: boolean;
  whatsRunning?: boolean;
  printRunning?: boolean;
  whatsapp?: {
    status?: string;
    phoneNumber?: string;
    qrCode?: string;
    lastError?: string;
  } | null;
  print?: {
    status?: string;
    lastError?: string;
    lastJobAt?: string;
    realtimeConnected?: boolean;
  } | null;
};

type FaceburgDesktopBridge = {
  isDesktopApp: boolean;
  getState: () => Promise<DesktopBridgeState>;
  syncSession?: () => Promise<unknown>;
  printDirect?: (payload: LocalPrintJob) => Promise<unknown>;
  sendWhatsAppDirect?: (payload: LocalWhatsappJob) => Promise<unknown>;
};

type LocalAgentProbe = {
  available: boolean;
  printAvailable: boolean;
  whatsappReady: boolean;
  whatsappStatus: string;
  printerName: string;
  terminalId: string;
  desktopBridge?: FaceburgDesktopBridge | null;
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
  skipped?: string[];
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
const LEADER_STORAGE_KEY = 'faceburg:localAutomation:leader:v2';
const PROCESSED_STORAGE_KEY = 'faceburg:localAutomation:processed:v2';
const PROCESSED_TTL_MS = 20 * 60 * 1000;
const NEW_ORDER_SCAN_WINDOW_MS = 20 * 60 * 1000;
const FALLBACK_SCAN_INITIAL_MS = 10 * 60 * 1000;
const FALLBACK_SCAN_MAX_MS = 10 * 60 * 1000;
const LEADER_HEARTBEAT_MS = 2500;
const LEADER_EXPIRES_MS = 9000;
const LOCAL_AGENT_PROBE_MS = 5000;

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

function getDesktopBridge() {
  if (typeof window === 'undefined') return null;
  return (window as Window & { faceburgDesktop?: FaceburgDesktopBridge }).faceburgDesktop ?? null;
}

function readJsonRecord(key: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '{}') as Record<string, number>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function compactProcessedRecords() {
  const now = Date.now();
  const processed = readJsonRecord(PROCESSED_STORAGE_KEY);
  const compacted: Record<string, number> = {};
  for (const [entryKey, expiresAt] of Object.entries(processed)) {
    if (Number(expiresAt) > now) {
      compacted[entryKey] = Number(expiresAt);
    }
  }
  window.localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(compacted));
  return { now, compacted };
}

function isProcessed(key: string) {
  const { now, compacted } = compactProcessedRecords();
  if (compacted[key] && compacted[key] > now) {
    return true;
  }
  return false;
}

function markProcessed(key: string) {
  const { now, compacted } = compactProcessedRecords();
  compacted[key] = now + PROCESSED_TTL_MS;
  window.localStorage.setItem(PROCESSED_STORAGE_KEY, JSON.stringify(compacted));
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
    const response = await fetch(`${LOCAL_AGENT_URL}${path}`, {
      ...init,
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string };
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    return data;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function probeLocalAgent(): Promise<LocalAgentProbe> {
  const desktopBridge = getDesktopBridge();
  if (desktopBridge?.isDesktopApp) {
    const state = await desktopBridge.getState().catch(() => null);
    const whatsappStatus = String(state?.whatsapp?.status || 'disconnected');
    const printAvailable = Boolean(desktopBridge.printDirect);
    const whatsappReady = Boolean(desktopBridge.sendWhatsAppDirect) && whatsappStatus === 'ready';
    return {
      available: printAvailable || whatsappReady,
      printAvailable,
      whatsappReady,
      whatsappStatus,
      printerName: '',
      terminalId: 'Faceburg Hub',
      desktopBridge,
    };
  }

  try {
    const health = await requestLocalAgent<LocalAgentHealth>('/api/health', {}, 900);
    const whatsappStatus = String(health.whatsapp?.status || 'disconnected');
    const printAvailable = Boolean(health.online);
    return {
      available: printAvailable || whatsappStatus === 'ready',
      printAvailable,
      whatsappReady: whatsappStatus === 'ready',
      whatsappStatus,
      printerName: String(health.printerName || ''),
      terminalId: String(health.terminalId || ''),
    };
  } catch {
    return {
      available: false,
      printAvailable: false,
      whatsappReady: false,
      whatsappStatus: 'disconnected',
      printerName: '',
      terminalId: '',
    };
  }
}

function buildOwnerLabel(localAgent: LocalAgentProbe) {
  const terminal = localAgent.terminalId.trim();
  const printer = localAgent.printerName.trim();
  if (terminal && printer) return `${terminal} - ${printer}`;
  if (terminal) return terminal;
  if (printer) return printer;
  return 'Computador da loja';
}

async function queueOrderDispatchFallback(
  orderId: string,
  payload: {
    printEventType?: PrintEventType;
    printEventTypes?: PrintEventType[];
    whatsappEventType?: WhatsappEventType;
  },
) {
  return fetchJson<DispatchFallbackResponse>(`/api/orders/${orderId}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

async function ackOrderDispatchLocal(
  orderId: string,
  payload: {
    printEventType?: PrintEventType;
    printEventTypes?: PrintEventType[];
    whatsappEventType?: WhatsappEventType;
  },
) {
  return fetchJson<{ ok?: boolean }>(`/api/orders/${orderId}/dispatch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      ackLocalDispatch: true,
      ...payload,
    }),
  });
}

async function runLocalPrintJobs(printJobs: LocalPrintJob[]) {
  const desktopBridge = getDesktopBridge();
  if (desktopBridge?.isDesktopApp && desktopBridge.printDirect) {
    for (const job of printJobs) {
      await desktopBridge.printDirect(job);
    }
    return;
  }

  for (const job of printJobs) {
    await requestLocalAgent('/api/print', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(job),
    }, 12000);
  }
}

async function runLocalWhatsappJobs(whatsappJobs: LocalWhatsappJob[]) {
  const desktopBridge = getDesktopBridge();
  if (desktopBridge?.isDesktopApp && desktopBridge.sendWhatsAppDirect) {
    for (const job of whatsappJobs) {
      await desktopBridge.sendWhatsAppDirect(job);
    }
    return;
  }

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
  expected: { printEvents?: PrintEventType[]; whatsapp?: boolean },
  markCompleted: {
    print?: (eventType: PrintEventType) => void;
    whatsapp?: () => void;
    ackPrint?: (eventType: PrintEventType) => Promise<void>;
    ackWhatsapp?: () => Promise<void>;
  } = {},
) {
  const failures: string[] = [];
  const printJobs = Array.isArray(localDispatch?.printJobs) ? localDispatch.printJobs : [];
  const whatsappJobs = Array.isArray(localDispatch?.whatsappJobs) ? localDispatch.whatsappJobs : [];
  const dispatchErrors = Array.isArray(localDispatch?.errors) ? localDispatch.errors : [];
  const dispatchSkipped = Array.isArray(localDispatch?.skipped) ? localDispatch.skipped : [];
  const failedPrintEvents: PrintEventType[] = [];
  let whatsappFailed = false;

  for (const eventType of expected.printEvents || []) {
    const eventPrintJobs = printJobs.filter((job) => job.eventType === eventType);
    if (!eventPrintJobs.length) {
      if (dispatchErrors.includes('print')) {
        failedPrintEvents.push(eventType);
        failures.push(`impressao ${eventType}`);
      } else if (dispatchSkipped.includes(`print:${eventType}`)) {
        markCompleted.print?.(eventType);
      } else {
        markCompleted.print?.(eventType);
      }
    } else {
      try {
        await runLocalPrintJobs(eventPrintJobs);
        await markCompleted.ackPrint?.(eventType).catch((error) => {
          console.warn('Faceburg local print ack failed', error);
        });
        markCompleted.print?.(eventType);
      } catch (error) {
        failedPrintEvents.push(eventType);
        failures.push(`impressao ${eventType} (${errorMessage(error)})`);
      }
    }
  }

  if (expected.whatsapp) {
    if (!whatsappJobs.length) {
      if (dispatchErrors.includes('whatsapp')) {
        whatsappFailed = true;
        failures.push('WhatsApp');
      } else if (dispatchSkipped.some((entry) => entry.startsWith('whatsapp:'))) {
        whatsappFailed = false;
      } else {
        whatsappFailed = true;
        failures.push('WhatsApp (nenhuma mensagem preparada)');
      }
    } else {
      try {
        await runLocalWhatsappJobs(whatsappJobs);
        await markCompleted.ackWhatsapp?.().catch((error) => {
          console.warn('Faceburg local whatsapp ack failed', error);
        });
        markCompleted.whatsapp?.();
      } catch (error) {
        whatsappFailed = true;
        failures.push(`WhatsApp (${errorMessage(error)})`);
      }
    }
  }

  if (!failures.length) return;

  await queueOrderDispatchFallback(orderId, {
    printEventType: failedPrintEvents.length === 1 ? failedPrintEvents[0] : undefined,
    printEventTypes: failedPrintEvents.length > 1 ? failedPrintEvents : undefined,
    whatsappEventType: whatsappFailed ? 'new_order' : undefined,
  });

  for (const eventType of failedPrintEvents) {
    markCompleted.print?.(eventType);
  }
  if (whatsappFailed) {
    markCompleted.whatsapp?.();
  }
}

function isRecentOpenOrder(order: { status: OrderStatus; createdAt?: string }) {
  if (order.status !== 'pending' && order.status !== 'processing') return false;
  const createdAt = Date.parse(order.createdAt || '');
  if (!Number.isFinite(createdAt)) return false;
  return Date.now() - createdAt <= NEW_ORDER_SCAN_WINDOW_MS;
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

function useAutomationLeadership(enabled: boolean, tenantId: string, tabId: string) {
  const [leader, setLeader] = useState(false);

  useEffect(() => {
    if (!enabled || !tenantId) {
      setLeader(false);
      return;
    }

    let disposed = false;
    let releaseLock: (() => void) | null = null;
    const navigatorWithLocks = navigator as NavigatorWithLocks;

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
  }, [enabled, tabId, tenantId]);

  return leader;
}

function useLocalAutomationProbe({
  enabled,
  tenantId,
  localLeader,
  printEnabled,
  whatsappEnabled,
}: {
  enabled: boolean;
  tenantId: string;
  localLeader: boolean;
  printEnabled: boolean;
  whatsappEnabled: boolean;
}) {
  const [localAgent, setLocalAgent] = useState<LocalAgentProbe | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !tenantId || !localLeader) {
      setLocalAgent(null);
      setChecking(false);
      return;
    }

    let disposed = false;
    let intervalId: number | null = null;

    async function renew() {
      if (disposed) return;
      setChecking(true);
      try {
        const probedAgent = await probeLocalAgent();
        if (disposed) return;
        setLocalAgent(probedAgent);

        const capabilities = {
          print: Boolean(printEnabled && probedAgent.printAvailable),
          whatsapp: Boolean(whatsappEnabled && probedAgent.whatsappReady),
        };

        if (!capabilities.print && !capabilities.whatsapp) {
          setError(probedAgent.available ? 'Automacao local aguardando recurso' : 'Agente local offline');
          return;
        }

        setError('');
      } catch (probeError) {
        if (disposed) return;
        setLocalAgent(null);
        setError(errorMessage(probeError));
      } finally {
        if (!disposed) setChecking(false);
      }
    }

    void renew();
    intervalId = window.setInterval(() => {
      void renew();
    }, LOCAL_AGENT_PROBE_MS);

    return () => {
      disposed = true;
      if (intervalId) window.clearInterval(intervalId);
      setLocalAgent(null);
    };
  }, [enabled, localLeader, printEnabled, tenantId, whatsappEnabled]);

  return {
    localAgent,
    checking,
    error,
    isAutomationLeader: Boolean(localLeader),
  };
}

export default function LocalAutomationBridge({
  enabled,
  tenantId,
  printEnabled,
  whatsappEnabled,
}: {
  enabled: boolean;
  tenantId: string;
  printEnabled: boolean;
  whatsappEnabled: boolean;
}) {
  const ownerIdRef = useRef(makeTabId());
  const isLocalTabLeader = useAutomationLeadership(enabled, tenantId, ownerIdRef.current);
  const {
    localAgent,
    checking,
    error: probeError,
    isAutomationLeader,
  } = useLocalAutomationProbe({
    enabled,
    tenantId,
    localLeader: isLocalTabLeader,
    printEnabled,
    whatsappEnabled,
  });
  const inFlightOrderIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled || !tenantId || !isAutomationLeader) return;

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

    function orderProcessedKey(orderId: string) {
      return `${tenantId}:new-order:${orderId}`;
    }

    function printProcessedKey(orderId: string, eventType: PrintEventType) {
      return `${tenantId}:print:${orderId}:${eventType}`;
    }

    function whatsappProcessedKey(orderId: string, eventType: WhatsappEventType) {
      return `${tenantId}:whatsapp:${orderId}:${eventType}`;
    }

    function markPrintProcessed(orderId: string, eventType: PrintEventType) {
      markProcessed(printProcessedKey(orderId, eventType));
    }

    function markWhatsappProcessed(orderId: string, eventType: WhatsappEventType) {
      markProcessed(whatsappProcessedKey(orderId, eventType));
    }

    function markOrderIfComplete(
      orderId: string,
      printEvents: PrintEventType[],
      wantsWhatsapp: boolean,
    ) {
      const hasPendingPrint = printEvents.some((eventType) => !isProcessed(printProcessedKey(orderId, eventType)));
      const hasPendingWhatsapp = wantsWhatsapp && !isProcessed(whatsappProcessedKey(orderId, 'new_order'));
      if (!hasPendingPrint && !hasPendingWhatsapp) {
        markProcessed(orderProcessedKey(orderId));
      }
    }

    async function queueFallbackAndMark(
      orderId: string,
      printEvents: PrintEventType[],
      whatsapp: boolean,
    ) {
      if (!printEvents.length && !whatsapp) return;
      await queueOrderDispatchFallback(orderId, {
        printEventType: printEvents.length === 1 ? printEvents[0] : undefined,
        printEventTypes: printEvents.length > 1 ? printEvents : undefined,
        whatsappEventType: whatsapp ? 'new_order' : undefined,
      });
      for (const eventType of printEvents) {
        markPrintProcessed(orderId, eventType);
      }
      if (whatsapp) {
        markWhatsappProcessed(orderId, 'new_order');
      }
    }

    async function dispatchNewOrder(orderId: string) {
      const normalizedOrderId = String(orderId || '').trim();
      if (!normalizedOrderId) return;

      const processedKey = orderProcessedKey(normalizedOrderId);
      if (isProcessed(processedKey) || inFlightOrderIdsRef.current.has(normalizedOrderId)) return;
      inFlightOrderIdsRef.current.add(normalizedOrderId);

      let allPrintEvents: PrintEventType[] = ['new_order'];
      let wantsPrint = Boolean(printEnabled);
      let wantsWhatsapp = Boolean(whatsappEnabled);

      try {
        const orderData = await fetchJson<OrderDetailResponse>(`/api/orders/${normalizedOrderId}`);
        const status = orderData.order?.status;
        if (status !== 'pending' && status !== 'processing') {
          markProcessed(processedKey);
          return;
        }
        const autoAccepted = status === 'processing';
        allPrintEvents = autoAccepted ? ['new_order', 'status_update'] : ['new_order'];

        const probedAgent = await probeLocalAgent();
        wantsPrint = Boolean(printEnabled);
        wantsWhatsapp = Boolean(whatsappEnabled);
        if (!wantsPrint && !wantsWhatsapp) {
          markProcessed(processedKey);
          return;
        }

        const pendingPrintEvents = wantsPrint
          ? allPrintEvents.filter((eventType) => !isProcessed(printProcessedKey(normalizedOrderId, eventType)))
          : [];
        const pendingWhatsapp = wantsWhatsapp && !isProcessed(whatsappProcessedKey(normalizedOrderId, 'new_order'));
        if (!pendingPrintEvents.length && !pendingWhatsapp) {
          markProcessed(processedKey);
          return;
        }

        const canUseLocalPrint = Boolean(pendingPrintEvents.length && probedAgent.printAvailable);
        const canUseLocalWhatsapp = Boolean(pendingWhatsapp && probedAgent.whatsappReady);
        const fallbackPrintEvents = canUseLocalPrint ? [] : pendingPrintEvents;
        const fallbackWhatsapp = Boolean(pendingWhatsapp && !canUseLocalWhatsapp);

        await queueFallbackAndMark(normalizedOrderId, fallbackPrintEvents, fallbackWhatsapp);

        const printEventTypes = canUseLocalPrint ? pendingPrintEvents : [];
        const shouldSendWhatsappLocal = Boolean(canUseLocalWhatsapp && pendingWhatsapp);
        if (!printEventTypes.length && !shouldSendWhatsappLocal) {
          markOrderIfComplete(normalizedOrderId, allPrintEvents, wantsWhatsapp);
          return;
        }

        const dispatchData = await fetchJson<{ localDispatch?: LocalDispatchPayload }>(`/api/orders/${normalizedOrderId}/dispatch`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            preferLocalAgent: true,
            printEventTypes,
            whatsappEventType: shouldSendWhatsappLocal ? 'new_order' : undefined,
          }),
        });

        await dispatchLocalJobs(
          normalizedOrderId,
          dispatchData.localDispatch,
          { printEvents: printEventTypes, whatsapp: shouldSendWhatsappLocal },
          {
            print: (eventType) => markPrintProcessed(normalizedOrderId, eventType),
            whatsapp: () => markWhatsappProcessed(normalizedOrderId, 'new_order'),
            ackPrint: (eventType) => ackOrderDispatchLocal(normalizedOrderId, { printEventType: eventType }).then(() => undefined),
            ackWhatsapp: () => ackOrderDispatchLocal(normalizedOrderId, { whatsappEventType: 'new_order' }).then(() => undefined),
          },
        );
        markOrderIfComplete(normalizedOrderId, allPrintEvents, wantsWhatsapp);
      } catch (error) {
        console.warn('Faceburg local automation failed', error);
        const retryPrintEvents = wantsPrint
          ? allPrintEvents.filter((eventType) => !isProcessed(printProcessedKey(normalizedOrderId, eventType)))
          : [];
        const retryWhatsapp = wantsWhatsapp && !isProcessed(whatsappProcessedKey(normalizedOrderId, 'new_order'));
        try {
          await queueFallbackAndMark(normalizedOrderId, retryPrintEvents, retryWhatsapp);
          markOrderIfComplete(normalizedOrderId, allPrintEvents, wantsWhatsapp);
        } catch (fallbackError) {
          console.warn('Faceburg local automation fallback failed', fallbackError);
        }
      } finally {
        inFlightOrderIdsRef.current.delete(normalizedOrderId);
      }
    }

    async function scanFallbackOrders() {
      if (disposed) return;
      try {
        const data = await fetchJson<OrdersResponse>('/api/orders');
        for (const order of data.orders || []) {
          if (isRecentOpenOrder(order)) {
            void dispatchNewOrder(order.id);
          }
        }
        fallbackDelayMs = FALLBACK_SCAN_INITIAL_MS;
      } catch {
        // Mantem backoff sem transformar queda do realtime em martelada.
        fallbackDelayMs = Math.min(fallbackDelayMs * 2, FALLBACK_SCAN_MAX_MS);
      } finally {
        if (!disposed) {
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

    connectEvents();
    fallbackTimer = window.setTimeout(() => {
      fallbackTimer = null;
      void scanFallbackOrders();
    }, 1000);

    return () => {
      disposed = true;
      clearReconnectTimer();
      clearFallbackTimer();
      closeEventSource();
    };
  }, [enabled, isAutomationLeader, printEnabled, tenantId, whatsappEnabled]);

  if (!enabled || !tenantId) return null;

  const localAgentAvailable = Boolean(localAgent?.available);
  const statusTone = isAutomationLeader
    ? localAgentAvailable
      ? 'active'
      : 'warning'
    : !isLocalTabLeader
      ? 'standby'
      : 'warning';
  const statusLabel = isAutomationLeader
    ? 'Ponte local ativa'
    : !isLocalTabLeader
        ? 'Ponte local em outra aba'
        : localAgentAvailable
          ? 'Assumindo ponte local'
          : 'Agente local offline';
  const detail = isAutomationLeader
    ? buildOwnerLabel(localAgent || {
        available: false,
        printAvailable: false,
        whatsappReady: false,
        whatsappStatus: 'disconnected',
        printerName: '',
        terminalId: '',
      })
    : probeError || (checking ? 'Conferindo agente' : 'Aguardando');

  return (
    <div
      className={
        statusTone === 'active'
          ? 'hidden min-w-0 max-w-[260px] rounded-md border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs text-emerald-800 sm:block'
          : statusTone === 'standby'
            ? 'hidden min-w-0 max-w-[260px] rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 sm:block'
            : 'hidden min-w-0 max-w-[260px] rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs text-amber-800 sm:block'
      }
      title={`${statusLabel}${detail ? ` - ${detail}` : ''}`}
    >
      <div className="truncate font-bold">{statusLabel}</div>
      <div className="truncate text-[10px] opacity-80">{detail}</div>
    </div>
  );
}
