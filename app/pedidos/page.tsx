'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { MapPin, ShoppingBag, Printer, RefreshCw, Menu, ChevronDown, Eye, Ban, X, Bike } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';

type OrderStatus = 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';

type Order = {
  id: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  itemsSummary: string;
  total: number;
  status: OrderStatus;
  paymentMethod: string;
  cancelReason?: string;
  createdAt: string;
  updatedAt: string;
  type: 'delivery' | 'pickup' | 'table';
};

type OrderDetail = {
  id: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  total: number;
  status: OrderStatus;
  cancelReason?: string;
  type: 'delivery' | 'pickup' | 'table';
  paymentMethod: string;
  changeFor: number;
  createdAt: string;
  updatedAt: string;
  items: Array<{
    id: string;
    productId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    notesRaw: string | null;
    notesParsed: unknown;
  }>;
};

type CardapioSettingsResponse = {
  storeOpen?: boolean;
  prepTimeMinutes?: number;
  error?: string;
};

type WhatsappConfigResponse = {
  enabled?: boolean;
  hasAgentKey?: boolean;
  agentKey?: string;
  sessionStatus?: string;
  qrCode?: string;
  phoneNumber?: string;
  lastSeenAt?: string | null;
  activationPending?: boolean;
  message?: string;
  error?: string;
};

type PrintConfigResponse = {
  enabled?: boolean;
  hasAgentKey?: boolean;
  connectionStatus?: string;
  lastError?: string;
  lastSeenAt?: string | null;
  error?: string;
};

type DesktopWhatsappState = {
  status?: string;
  qrCode?: string;
  phoneNumber?: string;
  lastError?: string;
};

type DesktopPrintState = {
  status?: string;
  lastError?: string;
  lastJobAt?: string;
  realtimeConnected?: boolean;
};

type DesktopBridgeState = {
  isDesktopApp?: boolean;
  whatsRunning?: boolean;
  printRunning?: boolean;
  whatsapp?: DesktopWhatsappState | null;
  print?: DesktopPrintState | null;
};

type DesktopSessionSyncResponse = {
  authenticated?: boolean;
  error?: string;
  settings?: {
    whatsAgentKey?: string;
    printAgentKey?: string;
  };
};

type FaceburgDesktopBridge = {
  isDesktopApp: boolean;
  getState: () => Promise<DesktopBridgeState>;
  syncSession: () => Promise<DesktopSessionSyncResponse>;
  startWhatsApp: () => Promise<{ ok: boolean }>;
  stopWhatsApp: () => Promise<{ ok: boolean }>;
  restartWhatsApp: () => Promise<{ ok: boolean }>;
  startPrint?: () => Promise<{ ok: boolean }>;
  stopPrint?: () => Promise<{ ok: boolean }>;
  restartPrint?: () => Promise<{ ok: boolean }>;
  onWhatsAppState: (callback: (state: DesktopWhatsappState) => void) => void | (() => void);
  onPrintState?: (callback: (state: DesktopPrintState) => void) => void | (() => void);
};

type PaymentMethodType = 'pix' | 'card' | 'cash' | 'bank_slip' | 'wallet' | 'other';

type PaymentOption = {
  id: string;
  value: string;
  label: string;
  description: string;
  methodType: PaymentMethodType;
  active: boolean;
  feePercent: number;
  feeFixed: number;
  settlementDays: number;
};

const columns: Array<{ key: string; title: string; statuses: OrderStatus[]; dropStatus: OrderStatus }> = [
  { key: 'pending', title: 'Novos', statuses: ['pending'], dropStatus: 'pending' },
  { key: 'processing', title: 'Cozinha', statuses: ['processing'], dropStatus: 'processing' },
  { key: 'delivering', title: 'Entrega', statuses: ['delivering'], dropStatus: 'delivering' },
  { key: 'finished', title: 'Finalizados', statuses: ['completed', 'cancelled'], dropStatus: 'completed' },
];

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function isTerminalOrderStatus(status: OrderStatus) {
  return status === 'completed' || status === 'cancelled';
}

function canMoveOrder(order: Pick<Order, 'status' | 'type'>, nextStatus: OrderStatus) {
  if (order.status === nextStatus) return false;
  if (order.status === 'cancelled') return false;
  if (order.status === 'completed') return nextStatus === 'cancelled';
  if (nextStatus === 'delivering' && order.type !== 'delivery') return false;
  if (order.status === 'pending') return nextStatus === 'processing' || nextStatus === 'cancelled';
  if (order.status === 'processing') return nextStatus === 'completed' || nextStatus === 'cancelled' || nextStatus === 'delivering';
  if (order.status === 'delivering') return nextStatus === 'completed' || nextStatus === 'cancelled';
  return false;
}

function sanitizePrepTimeMinutes(value: number | undefined) {
  if (!Number.isFinite(value)) return 40;
  return Math.max(5, Math.round(Number(value)));
}

function getCountdownReferenceMs(order: Pick<Order, 'status' | 'updatedAt'>, nowMs: number) {
  if (isTerminalOrderStatus(order.status)) {
    const updatedAtMs = Date.parse(order.updatedAt);
    if (!Number.isNaN(updatedAtMs)) {
      return updatedAtMs;
    }
  }

  return nowMs;
}

function getOrderRemainingMs(order: Pick<Order, 'createdAt' | 'updatedAt' | 'status'>, prepTimeMinutes: number, nowMs: number) {
  const createdAtMs = Date.parse(order.createdAt);
  if (Number.isNaN(createdAtMs)) return Number.NaN;

  const deadlineMs = createdAtMs + sanitizePrepTimeMinutes(prepTimeMinutes) * 60 * 1000;
  return deadlineMs - getCountdownReferenceMs(order, nowMs);
}

function formatRemainingTime(order: Pick<Order, 'createdAt' | 'updatedAt' | 'status'>, prepTimeMinutes: number, nowMs: number) {
  if (order.status === 'completed') return 'Finalizado';
  if (order.status === 'cancelled') return 'Cancelado';

  const remainingMs = getOrderRemainingMs(order, prepTimeMinutes, nowMs);
  if (Number.isNaN(remainingMs)) return '--:--';

  if (remainingMs <= 0) {
    return 'Atrasada';
  }

  const totalSeconds = Math.ceil(remainingMs / 1000);
  if (totalSeconds === 0) return '00:00';

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function getRemainingTimeClass(order: Pick<Order, 'createdAt' | 'updatedAt' | 'status'>, prepTimeMinutes: number, nowMs: number) {
  if (order.status === 'completed') return 'bg-emerald-50 text-emerald-700';
  if (order.status === 'cancelled') return 'bg-rose-50 text-rose-700';

  const remainingMs = getOrderRemainingMs(order, prepTimeMinutes, nowMs);
  if (Number.isNaN(remainingMs)) return 'bg-slate-200 text-slate-500';
  if (remainingMs <= 0) return 'bg-rose-500 text-white';
  return 'bg-white text-emerald-600';
}

function buildDeliveryMapQuery(order: Pick<Order, 'customerName' | 'deliveryAddress'>) {
  const address = order.deliveryAddress.trim();
  if (!address) return '';
  return `${address}, Brasil`;
}

function buildDeliveryMapEmbedUrl(order: Pick<Order, 'customerName' | 'deliveryAddress'>) {
  const query = buildDeliveryMapQuery(order);
  if (!query) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(query)}&z=17&output=embed`;
}

function buildDeliveryMapExternalUrl(order: Pick<Order, 'customerName' | 'deliveryAddress'>) {
  const query = buildDeliveryMapQuery(order);
  if (!query) return '';
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function formatOrderStatusLabel(status: OrderStatus) {
  switch (status) {
    case 'pending':
      return 'novo';
    case 'processing':
      return 'em preparo';
    case 'delivering':
      return 'saiu para entrega';
    case 'completed':
      return 'finalizado';
    case 'cancelled':
      return 'cancelado';
    default:
      return status;
  }
}

function statusBadgeClass(status: OrderStatus) {
  switch (status) {
    case 'pending':
      return 'bg-blue-50 text-blue-700 border-blue-200';
    case 'processing':
      return 'bg-orange-50 text-orange-700 border-orange-200';
    case 'delivering':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';
    case 'completed':
      return 'bg-slate-100 text-slate-700 border-slate-200';
    case 'cancelled':
      return 'bg-rose-50 text-rose-700 border-rose-200';
    default:
      return 'bg-slate-100 text-slate-700 border-slate-200';
  }
}

function _formatPaymentMethodLabel(method: string | null | undefined) {
  const value = method?.trim().toLowerCase() ?? '';
  if (!value) return '-';
  if (value === 'pix') return 'pix';
  if (value === 'cash' || value === 'money' || value === 'dinheiro') return 'dinheiro';
  if (value === 'card' || value === 'cartao' || value === 'cartão' || value === 'credito' || value === 'debito') return 'cartao';
  return value;
}

function _formatPaymentMethodCardLabel(method: string | null | undefined) {
  const value = _formatPaymentMethodLabel(method);
  if (value === '-') return 'Nao informado';
  if (value === 'pix') return 'Pix';
  if (value === 'dinheiro') return 'Dinheiro';
  if (value === 'cartao') return 'Cartao';
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function _paymentMethodCardClass(method: string | null | undefined) {
  const value = _formatPaymentMethodLabel(method);
  if (value === 'pix') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value === 'dinheiro') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (value === 'cartao') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function _normalizeEditablePaymentMethod(method: string | null | undefined): string {
  const value = _formatPaymentMethodLabel(method);
  if (value === 'cartao') return 'card';
  if (value === 'dinheiro') return 'cash';
  return 'pix';
}

function getPaymentDisplayLabel(method: string | null | undefined) {
  const originalValue = method?.trim() ?? '';
  const value = originalValue.toLowerCase();
  if (!value) return 'Nao informado';
  if (value === 'pix') return 'Pix';
  if (value === 'cash' || value === 'money' || value === 'dinheiro') return 'Dinheiro';
  if (value === 'card' || value === 'cartao' || value === 'cartão' || value === 'credito' || value === 'debito') return 'Cartao';
  return originalValue;
}

function detectPaymentMethodType(method: string | null | undefined) {
  const value = method?.trim().toLowerCase() ?? '';
  if (!value) return '';
  if (value === 'pix') return 'pix';
  if (value === 'cash' || value === 'money' || value === 'dinheiro') return 'cash';
  if (value === 'card' || value === 'cartao' || value === 'cartão' || value === 'credito' || value === 'debito') return 'card';
  if (value === 'bank_slip' || value === 'boleto') return 'bank_slip';
  if (value === 'wallet' || value === 'carteira') return 'wallet';
  return '';
}

function resolvePaymentMethodTypeFromOptions(method: string | null | undefined, paymentOptions: PaymentOption[]) {
  const normalizedLabel = method?.trim().toLowerCase() ?? '';
  if (normalizedLabel) {
    const exactMatch = paymentOptions.find((option) => option.label.trim().toLowerCase() === normalizedLabel);
    if (exactMatch) {
      return exactMatch.methodType;
    }
  }
  return detectPaymentMethodType(method);
}

function getPaymentMethodBadgeClass(method: string | null | undefined, paymentOptions: PaymentOption[]) {
  const value = resolvePaymentMethodTypeFromOptions(method, paymentOptions);
  if (value === 'pix') return 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (value === 'cash') return 'bg-amber-50 text-amber-700 border-amber-200';
  if (value === 'card') return 'bg-violet-50 text-violet-700 border-violet-200';
  return 'bg-slate-50 text-slate-600 border-slate-200';
}

function buildPaymentOptionDescription(option: PaymentOption) {
  const parts: string[] = [];
  if (option.methodType === 'pix') parts.push('Pagamento instantaneo');
  else if (option.methodType === 'cash') parts.push('Recebimento em especie');
  else if (option.methodType === 'card') parts.push('Maquina de cartao');
  else if (option.methodType === 'bank_slip') parts.push('Boleto');
  else if (option.methodType === 'wallet') parts.push('Carteira digital');
  else parts.push('Forma personalizada');

  if (option.feePercent > 0 || option.feeFixed > 0) {
    const feeParts: string[] = [];
    if (option.feePercent > 0) feeParts.push(`${option.feePercent.toFixed(2)}%`);
    if (option.feeFixed > 0) feeParts.push(formatCurrency(option.feeFixed));
    parts.push(`Taxa ${feeParts.join(' + ')}`);
  }

  if (option.settlementDays > 0) {
    parts.push(`Recebe em D+${option.settlementDays}`);
  } else {
    parts.push('Recebimento imediato');
  }

  return parts.join(' - ');
}

function formatItemNotes(notesParsed: unknown): string[] {
  if (!notesParsed || notesParsed === 'null') return [];

  if (typeof notesParsed === 'string') {
    const value = notesParsed.trim();
    if (!value || value === '{}' || value === '[]' || value === 'null') return [];
    return [value];
  }

  if (Array.isArray(notesParsed)) {
    const values = notesParsed
      .map((item) => (typeof item === 'string' ? item.trim() : String(item)))
      .filter((item) => item.length > 0);
    if (values.length === 0) return [];
    return [`Opcoes: ${values.join(', ')}`];
  }

  if (typeof notesParsed === 'object') {
    const payload = notesParsed as Record<string, unknown>;
    const lines: string[] = [];

    const notes =
      typeof payload.notes === 'string'
        ? payload.notes.trim()
        : typeof payload.observacao === 'string'
          ? payload.observacao.trim()
          : '';
    if (notes) {
      lines.push(`Observacao: ${notes}`);
    }

    const pizza =
      typeof payload.pizza === 'string'
        ? payload.pizza.trim()
        : typeof payload.sabor === 'string'
          ? payload.sabor.trim()
          : '';
    if (pizza) {
      lines.push(`Sabor: ${pizza}`);
    }

    const optionsRaw = Array.isArray(payload.options)
      ? payload.options
      : Array.isArray(payload.opcoes)
        ? payload.opcoes
        : [];
    const options = optionsRaw
      .map((option) => (typeof option === 'string' ? option.trim() : String(option)))
      .filter((option) => option.length > 0);
    if (options.length > 0) {
      lines.push(`Opcoes: ${options.join(', ')}`);
    }

    return lines;
  }

  return [];
}

function getFaceburgDesktopBridge() {
  if (typeof window === 'undefined') return null;
  return (window as Window & { faceburgDesktop?: FaceburgDesktopBridge }).faceburgDesktop ?? null;
}

function isWhatsappDesktopOnline(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= 2 * 60 * 1000;
}

function isPrintDesktopOnline(lastSeenAt: string | null) {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= 5 * 60 * 1000;
}

function isLocalWhatsappSessionActive(sessionStatus: string, lastSeenAt: string | null) {
  if (!['ready', 'qr', 'connecting'].includes(sessionStatus)) return false;
  return isWhatsappDesktopOnline(lastSeenAt);
}

function isLocalPrintAgentActive(status: string, lastSeenAt: string | null) {
  if (!['ready', 'connecting'].includes(status)) return false;
  return isPrintDesktopOnline(lastSeenAt);
}

function getWhatsappStatusLabel(
  sessionStatus: string,
  lastSeenAt: string | null,
  enabled: boolean,
  desktopAppAvailable: boolean,
) {
  if (!enabled) return 'Desligado';
  if (sessionStatus === 'ready' && isWhatsappDesktopOnline(lastSeenAt)) return 'Conectado';
  if (sessionStatus === 'qr') return 'Escaneie o QR';
  if (sessionStatus === 'connecting') return desktopAppAvailable ? 'Abrindo no computador' : 'Aguardando o app';
  if (sessionStatus === 'auth_failure') return 'Reconecte o WhatsApp';
  return desktopAppAvailable ? 'Preparando conexao' : 'Abra o Faceburg App';
}

function getPrintStatusLabel(status: string, lastSeenAt: string | null, enabled: boolean, desktopAppAvailable: boolean) {
  if (!enabled) return 'Desligado';
  if (isLocalPrintAgentActive(status, lastSeenAt)) return status === 'connecting' ? 'Abrindo no computador' : 'Conectado';
  if (status === 'error') return 'Erro no agente';
  return desktopAppAvailable ? 'Preparando impressao' : 'Abra o Faceburg App';
}

export default function PedidosPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [operationalMessage, setOperationalMessage] = useState<{
    tone: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [draggingOrderId, setDraggingOrderId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<OrderStatus | null>(null);
  const [menuOrderId, setMenuOrderId] = useState<string | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [selectedOrderDetail, setSelectedOrderDetail] = useState<OrderDetail | null>(null);
  const [cancelModalOpen, setCancelModalOpen] = useState(false);
  const [cancelReasonInput, setCancelReasonInput] = useState('');
  const [cancelOrderId, setCancelOrderId] = useState<string | null>(null);
  const [editAddressOrder, setEditAddressOrder] = useState<Order | null>(null);
  const [editAddressValue, setEditAddressValue] = useState('');
  const [savingAddress, setSavingAddress] = useState(false);
  const [editPaymentOrder, setEditPaymentOrder] = useState<Order | null>(null);
  const [editPaymentValue, setEditPaymentValue] = useState('');
  const [savingPayment, setSavingPayment] = useState(false);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [paymentOptionsLoading, setPaymentOptionsLoading] = useState(false);
  const [mapModalOrder, setMapModalOrder] = useState<Order | null>(null);
  const [sirenEnabled, setSirenEnabled] = useState(true);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [deliveryUpdating, setDeliveryUpdating] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappUpdating, setWhatsappUpdating] = useState(false);
  const [whatsappHasAgentKey, setWhatsappHasAgentKey] = useState(false);
  const [whatsappSessionStatus, setWhatsappSessionStatus] = useState('disconnected');
  const [whatsappLastSeenAt, setWhatsappLastSeenAt] = useState<string | null>(null);
  const [printEnabled, setPrintEnabled] = useState(false);
  const [printHasAgentKey, setPrintHasAgentKey] = useState(false);
  const [printConnectionStatus, setPrintConnectionStatus] = useState('disconnected');
  const [printLastSeenAt, setPrintLastSeenAt] = useState<string | null>(null);
  const [desktopPrintRunning, setDesktopPrintRunning] = useState(false);
  const [desktopPrintLastError, setDesktopPrintLastError] = useState('');
  const [desktopAppAvailable, setDesktopAppAvailable] = useState(false);
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(40);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const didBootstrapRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const requestInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const desktopSessionSyncRef = useRef<Promise<DesktopSessionSyncResponse | null> | null>(null);
  const desktopStartRef = useRef<Promise<boolean> | null>(null);
  const desktopPrintStartRef = useRef<Promise<boolean> | null>(null);
  const lastDesktopAutoStartAtRef = useRef(0);
  const lastDesktopPrintAutoStartAtRef = useRef(0);

  const applyDesktopWhatsappState = useCallback((state?: DesktopWhatsappState | null) => {
    if (!state) return;
    const nextStatus = String(state.status || 'disconnected');
    setWhatsappSessionStatus(nextStatus);
    setWhatsappLastSeenAt(
      nextStatus === 'ready' || nextStatus === 'qr' || nextStatus === 'connecting'
        ? new Date().toISOString()
      : null,
    );
  }, []);

  const applyDesktopPrintState = useCallback((state?: DesktopPrintState | null, running?: boolean) => {
    if (!state) return;
    const nextStatus = String(state.status || 'disconnected');
    setPrintConnectionStatus(nextStatus);
    setPrintLastSeenAt(
      ['ready', 'connecting', 'error'].includes(nextStatus)
        ? new Date().toISOString()
        : null,
    );
    setDesktopPrintLastError(String(state.lastError || ''));
    if (typeof running === 'boolean') {
      setDesktopPrintRunning(running);
    } else {
      setDesktopPrintRunning(['ready', 'connecting', 'error'].includes(nextStatus));
    }
  }, []);

  const syncDesktopSession = useCallback((desktopBridge: FaceburgDesktopBridge) => {
    if (!desktopSessionSyncRef.current) {
      desktopSessionSyncRef.current = desktopBridge.syncSession()
        .catch(() => null)
        .finally(() => {
          desktopSessionSyncRef.current = null;
        });
    }
    return desktopSessionSyncRef.current;
  }, []);

  const ensureDesktopWhatsappStarted = useCallback(async (options?: { forceRestart?: boolean }) => {
    const desktopBridge = getFaceburgDesktopBridge();
    if (!desktopBridge?.isDesktopApp) return false;
    if (desktopStartRef.current) return desktopStartRef.current;

    desktopStartRef.current = (async () => {
      setDesktopAppAvailable(true);

      const desktopState = await desktopBridge.getState().catch(() => null);
      if (desktopState?.whatsapp) {
        applyDesktopWhatsappState(desktopState.whatsapp);
      }

      const currentStatus = String(desktopState?.whatsapp?.status || 'disconnected');
      const currentLastSeen = ['ready', 'qr', 'connecting'].includes(currentStatus) ? new Date().toISOString() : null;
      const alreadyActive = Boolean(desktopState?.whatsRunning) && isLocalWhatsappSessionActive(currentStatus, currentLastSeen);

      if (alreadyActive && !options?.forceRestart) {
        return true;
      }

      const syncResult = await syncDesktopSession(desktopBridge);
      if (syncResult?.settings?.whatsAgentKey) {
        setWhatsappHasAgentKey(true);
      }

      const result = desktopState?.whatsRunning || options?.forceRestart
        ? await desktopBridge.restartWhatsApp().catch((error) => ({ error }))
        : await desktopBridge.startWhatsApp().catch((error) => ({ error }));

      if ('error' in result) return false;

      setWhatsappSessionStatus('connecting');
      setWhatsappLastSeenAt(new Date().toISOString());
      return true;
    })().finally(() => {
      desktopStartRef.current = null;
    });

    return desktopStartRef.current;
  }, [applyDesktopWhatsappState, syncDesktopSession]);

  const ensureDesktopPrintStarted = useCallback(async (options?: { forceRestart?: boolean }) => {
    const desktopBridge = getFaceburgDesktopBridge();
    if (!desktopBridge?.isDesktopApp) return false;
    if (desktopPrintStartRef.current) return desktopPrintStartRef.current;

    desktopPrintStartRef.current = (async () => {
      setDesktopAppAvailable(true);

      const desktopState = await desktopBridge.getState().catch(() => null);
      if (desktopState?.print) {
        applyDesktopPrintState(desktopState.print, Boolean(desktopState.printRunning));
      }

      const currentStatus = String(desktopState?.print?.status || 'disconnected');
      const currentLastSeen = ['ready', 'connecting'].includes(currentStatus) ? new Date().toISOString() : null;
      const alreadyActive = Boolean(desktopState?.printRunning) && isLocalPrintAgentActive(currentStatus, currentLastSeen);

      if (alreadyActive && !options?.forceRestart) {
        return true;
      }

      const syncResult = await syncDesktopSession(desktopBridge);
      if (syncResult?.settings?.printAgentKey) {
        setPrintHasAgentKey(true);
      }

      if (!desktopBridge.startPrint) return false;

      const shouldRestart = Boolean(desktopState?.printRunning || options?.forceRestart);
      let result: { ok?: boolean } | { error: unknown } | undefined;
      if (shouldRestart && desktopBridge.restartPrint) {
        result = await desktopBridge.restartPrint().catch((error) => ({ error }));
      } else {
        if (shouldRestart && desktopBridge.stopPrint) {
          await desktopBridge.stopPrint().catch(() => null);
        }
        result = await desktopBridge.startPrint().catch((error) => ({ error }));
      }

      if (!result || 'error' in result) return false;

      setDesktopPrintRunning(true);
      setPrintConnectionStatus('connecting');
      setPrintLastSeenAt(new Date().toISOString());
      setDesktopPrintLastError('');
      return true;
    })().finally(() => {
      desktopPrintStartRef.current = null;
    });

    return desktopPrintStartRef.current;
  }, [applyDesktopPrintState, syncDesktopSession]);

  useEffect(() => {
    if (!operationalMessage || operationalMessage.tone !== 'success') return;
    const timeoutId = window.setTimeout(() => {
      setOperationalMessage((currentMessage) => (currentMessage === operationalMessage ? null : currentMessage));
    }, 4000);
    return () => window.clearTimeout(timeoutId);
  }, [operationalMessage]);

  const activePaymentOptions = useMemo(
    () =>
      paymentOptions
        .filter((option) => option.active)
        .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR')),
    [paymentOptions],
  );

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setCountdownNowMs(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Element | null;
      if (!target) return;
      if (target.closest('[data-order-menu="true"]')) return;
      setMenuOrderId(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOrderId(null);
      }
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function getAudioContext() {
    if (typeof window === 'undefined') return null;
    if (!audioContextRef.current) {
      const Ctx = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      audioContextRef.current = new Ctx();
    }
    return audioContextRef.current;
  }

  const playNewDeliverySiren = useCallback(async () => {
    if (!sirenEnabled) return;
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {
        return;
      }
    }

    const startAt = ctx.currentTime + 0.02;
    const bursts = 6;
    for (let i = 0; i < bursts; i += 1) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'square';
      osc.frequency.value = i % 2 === 0 ? 880 : 660;
      gain.gain.value = 0.07;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const from = startAt + i * 0.22;
      const to = from + 0.14;
      osc.start(from);
      osc.stop(to);
    }
  }, [sirenEnabled]);

  const loadOrders = useCallback(async (showLoader = false) => {
    if (requestInFlightRef.current) {
      pendingRefreshRef.current = true;
      return false;
    }
    requestInFlightRef.current = true;
    if (showLoader) setLoading(true);
    let succeeded = false;
    try {
      const response = await fetch('/api/orders', {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar pedidos.');
        return false;
      }
      const incomingOrders = (data.orders || []) as Order[];
      const incomingIds = new Set(incomingOrders.map((order) => order.id));
      const newDeliveryOrders = incomingOrders.filter(
        (order) =>
          !seenOrderIdsRef.current.has(order.id) &&
          order.type === 'delivery' &&
          order.status === 'pending',
      );

      setOrders(incomingOrders);
      setError(null);
      succeeded = true;

      if (didBootstrapRef.current && newDeliveryOrders.length > 0) {
        await playNewDeliverySiren();
      }
      seenOrderIdsRef.current = incomingIds;
      didBootstrapRef.current = true;
    } catch {
      setError('Falha ao carregar pedidos.');
    } finally {
      requestInFlightRef.current = false;
      if (showLoader) setLoading(false);
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void loadOrders(false);
      }
    }
    return succeeded;
  }, [playNewDeliverySiren]);

  const loadOperationalStatus = useCallback(async () => {
    try {
      const desktopBridge = getFaceburgDesktopBridge();
      const [settingsResponse, whatsappResponse, printResponse, desktopState] = await Promise.all([
        fetch('/api/cardapio/settings', {
          cache: 'no-store',
          headers: {
            'cache-control': 'no-cache',
          },
        }),
        fetch('/api/whatsapp/config', {
          cache: 'no-store',
          headers: {
            'cache-control': 'no-cache',
          },
        }),
        fetch('/api/print/config', {
          cache: 'no-store',
          headers: {
            'cache-control': 'no-cache',
          },
        }),
        desktopBridge?.isDesktopApp
          ? desktopBridge.getState().catch(() => null)
          : Promise.resolve(null),
      ]);

      const settingsData = (await settingsResponse.json().catch(() => ({}))) as CardapioSettingsResponse;
      if (settingsResponse.ok) {
        setDeliveryEnabled(Boolean(settingsData.storeOpen));
        setPrepTimeMinutes(sanitizePrepTimeMinutes(settingsData.prepTimeMinutes));
      }

      const whatsappData = (await whatsappResponse.json().catch(() => ({}))) as WhatsappConfigResponse;
      if (whatsappResponse.ok) {
        setWhatsappEnabled(Boolean(whatsappData.enabled));
        setWhatsappHasAgentKey(Boolean(whatsappData.hasAgentKey));
        setWhatsappSessionStatus(String(whatsappData.sessionStatus || 'disconnected'));
        setWhatsappLastSeenAt(whatsappData.lastSeenAt || null);
      }

      const printData = (await printResponse.json().catch(() => ({}))) as PrintConfigResponse;
      if (printResponse.ok) {
        setPrintEnabled(Boolean(printData.enabled));
        setPrintHasAgentKey(Boolean(printData.hasAgentKey));
        setPrintConnectionStatus(String(printData.connectionStatus || 'disconnected'));
        setPrintLastSeenAt(printData.lastSeenAt || null);
        setDesktopPrintLastError(String(printData.lastError || ''));
      }

      if (desktopState?.isDesktopApp) {
        setDesktopAppAvailable(true);
        applyDesktopWhatsappState(desktopState.whatsapp);
        applyDesktopPrintState(desktopState.print, Boolean(desktopState.printRunning));
        const desktopStatus = String(desktopState.whatsapp?.status || 'disconnected');
        const desktopLooksActive = Boolean(desktopState.whatsRunning)
          && ['ready', 'qr', 'connecting'].includes(desktopStatus);
        const shouldAutoStart =
          Boolean(whatsappData.enabled)
          && !desktopLooksActive
          && Date.now() - lastDesktopAutoStartAtRef.current > 15000;

        if (shouldAutoStart) {
          lastDesktopAutoStartAtRef.current = Date.now();
          void ensureDesktopWhatsappStarted({
            forceRestart: Boolean(desktopState.whatsRunning),
          });
        }

        const desktopPrintStatus = String(desktopState.print?.status || 'disconnected');
        const desktopPrintLooksActive = Boolean(desktopState.printRunning)
          && ['ready', 'connecting'].includes(desktopPrintStatus);
        const shouldAutoStartPrint =
          Boolean(printData.enabled)
          && !desktopPrintLooksActive
          && Date.now() - lastDesktopPrintAutoStartAtRef.current > 15000;

        if (shouldAutoStartPrint) {
          lastDesktopPrintAutoStartAtRef.current = Date.now();
          void ensureDesktopPrintStarted({
            forceRestart: Boolean(desktopState.printRunning),
          });
        }
      } else if (!desktopBridge?.isDesktopApp) {
        setDesktopAppAvailable(false);
      }
    } catch {
      // No-op: the screen can keep running with orders even if status probes fail.
    }
  }, [applyDesktopPrintState, applyDesktopWhatsappState, ensureDesktopPrintStarted, ensureDesktopWhatsappStarted]);

  const loadPaymentOptions = useCallback(async () => {
    setPaymentOptionsLoading(true);
    try {
      const response = await fetch('/api/finance/payment-methods', {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });
      const data = (await response.json().catch(() => ({}))) as {
        paymentMethods?: Array<{
          id?: string;
          name?: string;
          methodType?: string;
          feePercent?: number;
          feeFixed?: number;
          settlementDays?: number;
          active?: boolean;
        }>;
      };
      if (!response.ok) {
        return;
      }

      const nextOptions = Array.isArray(data.paymentMethods)
        ? data.paymentMethods
            .map((option) => ({
              id: String(option.id || '').trim(),
              value: String(option.id || '').trim(),
              label: String(option.name || '').trim(),
              description: '',
              methodType: (String(option.methodType || 'other').trim().toLowerCase() || 'other') as PaymentMethodType,
              active: option.active !== false,
              feePercent: Number(option.feePercent || 0),
              feeFixed: Number(option.feeFixed || 0),
              settlementDays: Number(option.settlementDays || 0),
            }))
            .filter((option) => option.id && option.label)
            .map((option) => ({
              ...option,
              description: buildPaymentOptionDescription(option),
            }))
        : [];

      setPaymentOptions(nextOptions);
    } catch {
      // Mantem o fluxo de pedidos funcionando mesmo se o financeiro nao responder.
    } finally {
      setPaymentOptionsLoading(false);
    }
  }, []);

  const { refreshNow } = useRealtimeRefresh({ load: loadOrders, fallbackRefreshMs: 0 });

  useEffect(() => {
    const desktopBridge = getFaceburgDesktopBridge();
    if (desktopBridge?.isDesktopApp) {
      setDesktopAppAvailable(true);
      return;
    }
    void loadOperationalStatus();
  }, [loadOperationalStatus]);

  useEffect(() => {
    const desktopBridge = getFaceburgDesktopBridge();
    if (!desktopBridge?.isDesktopApp) return;

    let active = true;
    void syncDesktopSession(desktopBridge)
      .then((result) => {
        if (!active) return;
        if (result?.settings?.whatsAgentKey) {
          setWhatsappHasAgentKey(true);
        }
        if (result?.settings?.printAgentKey) {
          setPrintHasAgentKey(true);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (active) {
          void loadOperationalStatus();
        }
      });

    const unsubscribeWhatsApp = desktopBridge.onWhatsAppState((state) => {
      if (!active) return;
      applyDesktopWhatsappState(state);
    });

    const unsubscribePrint = desktopBridge.onPrintState?.((state) => {
      if (!active) return;
      applyDesktopPrintState(state);
    });

    void desktopBridge.getState()
      .then((state) => {
        if (!active || !state?.isDesktopApp) return;
        setDesktopAppAvailable(true);
        applyDesktopWhatsappState(state.whatsapp);
        applyDesktopPrintState(state.print, Boolean(state.printRunning));
      })
      .catch(() => {});

    return () => {
      active = false;
      if (typeof unsubscribeWhatsApp === 'function') {
        unsubscribeWhatsApp();
      }
      if (typeof unsubscribePrint === 'function') {
        unsubscribePrint();
      }
    };
  }, [applyDesktopPrintState, applyDesktopWhatsappState, loadOperationalStatus, syncDesktopSession]);

  useEffect(() => {
    void loadPaymentOptions();
  }, [loadPaymentOptions]);

  async function toggleDeliveryStatus() {
    if (deliveryUpdating) return;
    const nextValue = !deliveryEnabled;
    setDeliveryUpdating(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storeOpen: nextValue }),
      });
      const data = (await response.json().catch(() => ({}))) as CardapioSettingsResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao atualizar status do delivery.',
        });
        return;
      }

      const effectiveStoreOpen = typeof data.storeOpen === 'boolean' ? data.storeOpen : nextValue;
      setDeliveryEnabled(effectiveStoreOpen);
      if (typeof data.prepTimeMinutes === 'number') {
        setPrepTimeMinutes(sanitizePrepTimeMinutes(data.prepTimeMinutes));
      }
      setOperationalMessage({
        tone: 'success',
        text: effectiveStoreOpen
          ? 'Delivery ON. O cardapio publico voltou a aceitar novos pedidos.'
          : 'Delivery OFF. Novos pedidos do cardapio foram bloqueados.',
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao atualizar status do delivery.',
      });
    } finally {
      setDeliveryUpdating(false);
    }
  }

  async function toggleWhatsappStatus() {
    if (whatsappUpdating) return;
    const desktopBridge = getFaceburgDesktopBridge();
    const usingDesktopApp = Boolean(desktopBridge?.isDesktopApp);
    const shouldReconnectLocalAgent =
      whatsappEnabled &&
      usingDesktopApp &&
      !isLocalWhatsappSessionActive(whatsappSessionStatus, whatsappLastSeenAt);
    setWhatsappUpdating(true);
    setOperationalMessage(null);
    try {
      if (shouldReconnectLocalAgent) {
        const started = await ensureDesktopWhatsappStarted({
          forceRestart: ['auth_failure', 'error', 'disconnected', 'stopped'].includes(whatsappSessionStatus),
        });
        setOperationalMessage({
          tone: started ? 'warning' : 'error',
          text: started
            ? 'WhatsApp automatico ja estava ON. Reabrindo o agente neste computador.'
            : 'Nao foi possivel reabrir o agente WhatsApp neste computador.',
        });
        return;
      }

      const nextValue = !whatsappEnabled;

      if (nextValue && usingDesktopApp) {
        const syncResult = await syncDesktopSession(desktopBridge!);
        if (syncResult?.settings?.whatsAgentKey) {
          setWhatsappHasAgentKey(true);
        }
      }

      const response = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue }),
      });
      const patchData = (await response.json().catch(() => ({}))) as WhatsappConfigResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: patchData.error || 'Falha ao atualizar status do WhatsApp.',
        });
        return;
      }

      const activationPending = Boolean(patchData.activationPending);
      const patchMessage = String(patchData.message || '').trim();
      const enabled = Boolean(patchData.enabled);
      const hasAgentKey = Boolean(patchData.hasAgentKey);
      const sessionStatus = String(patchData.sessionStatus || 'disconnected');
      const lastSeenAt = patchData.lastSeenAt || null;
      const desktopOnline = isWhatsappDesktopOnline(lastSeenAt);

      setWhatsappEnabled(enabled);
      setWhatsappHasAgentKey(hasAgentKey);
      setWhatsappSessionStatus(sessionStatus);
      setWhatsappLastSeenAt(lastSeenAt);

      if (!enabled) {
        if (usingDesktopApp) {
          await desktopBridge!.stopWhatsApp().catch(() => null);
          setWhatsappSessionStatus('disconnected');
          setWhatsappLastSeenAt(null);
        }
        setOperationalMessage({
          tone: 'success',
          text: patchMessage || 'WhatsApp automatico OFF.',
        });
        return;
      }

      if (usingDesktopApp) {
        const startResult = await ensureDesktopWhatsappStarted();
        if (!startResult) {
          setOperationalMessage({
            tone: 'warning',
            text:
              patchMessage ||
              'WhatsApp ativado. Se necessario, recarregue a tela e abra novamente o WhatsApp neste computador.',
          });
          return;
        }
        setWhatsappSessionStatus('connecting');
        setWhatsappLastSeenAt(new Date().toISOString());
      }

      if (!hasAgentKey || sessionStatus !== 'ready' || !desktopOnline || activationPending) {
        setOperationalMessage({
          tone: 'warning',
          text:
            patchMessage ||
            (usingDesktopApp
              ? 'WhatsApp ativado. Se o WhatsApp Web abrir neste computador, conecte a conta da empresa para concluir.'
              : 'WhatsApp ativado. Abra o Faceburg App neste computador para concluir a conexao.'),
        });
        return;
      }

      setOperationalMessage({
        tone: 'success',
        text: patchMessage || 'WhatsApp conectado. Mensagens automaticas ativas.',
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao atualizar status do WhatsApp.',
      });
    } finally {
      setWhatsappUpdating(false);
    }
  }

  async function moveOrder(id: string, nextStatus: OrderStatus, cancelReason = '') {
    if (updatingId) return;
    const previousOrder = orders.find((order) => order.id === id);
    if (!previousOrder) return;

    const optimisticUpdatedAt = new Date().toISOString();
    setOrders((current) =>
      current.map((order) =>
        order.id === id
          ? {
              ...order,
              status: nextStatus,
              cancelReason: nextStatus === 'cancelled' ? cancelReason : undefined,
              updatedAt: optimisticUpdatedAt,
            }
          : order,
      ),
    );

    setSelectedOrderDetail((current) =>
      current && current.id === id
        ? {
            ...current,
            status: nextStatus,
            cancelReason: nextStatus === 'cancelled' ? cancelReason : undefined,
            updatedAt: optimisticUpdatedAt,
          }
        : current,
    );

    setUpdatingId(id);
    try {
      const response = await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, cancelReason }),
      });
      const data = await response.json();
      if (!response.ok) {
        setOrders((current) =>
          current.map((order) =>
            order.id === id
              ? {
                  ...order,
                  status: previousOrder.status,
                  cancelReason: previousOrder.cancelReason,
                  updatedAt: previousOrder.updatedAt,
                }
              : order,
          ),
        );
        setSelectedOrderDetail((current) =>
          current && current.id === id
            ? {
                ...current,
                status: previousOrder.status,
                cancelReason: previousOrder.cancelReason,
                updatedAt: previousOrder.updatedAt,
              }
            : current,
        );
        setError(data.error || 'Falha ao atualizar pedido.');
        return;
      }

      const updatedAt = new Date().toISOString();
      setOrders((current) =>
        current.map((order) =>
          order.id === id
            ? {
                ...order,
                status: nextStatus,
                cancelReason: nextStatus === 'cancelled' ? cancelReason : undefined,
                updatedAt,
              }
            : order,
        ),
      );
      setSelectedOrderDetail((current) =>
        current && current.id === id
          ? {
              ...current,
              status: nextStatus,
              cancelReason: nextStatus === 'cancelled' ? cancelReason : undefined,
              updatedAt,
            }
          : current,
      );
      setError(null);
    } catch {
      setOrders((current) =>
        current.map((order) =>
          order.id === id
            ? {
                ...order,
                status: previousOrder.status,
                cancelReason: previousOrder.cancelReason,
                updatedAt: previousOrder.updatedAt,
              }
            : order,
        ),
      );
      setSelectedOrderDetail((current) =>
        current && current.id === id
          ? {
              ...current,
              status: previousOrder.status,
              cancelReason: previousOrder.cancelReason,
              updatedAt: previousOrder.updatedAt,
            }
          : current,
      );
      setError('Falha ao atualizar pedido.');
    } finally {
      setUpdatingId(null);
    }
  }

  async function cancelOrder(id: string) {
    setCancelOrderId(id);
    setCancelReasonInput('');
    setCancelModalOpen(true);
    setMenuOrderId(null);
  }

  async function confirmCancelOrder() {
    if (!cancelOrderId) return;
    if (cancelReasonInput.trim().length < 3) {
      setError('Informe um motivo de cancelamento com pelo menos 3 caracteres.');
      return;
    }
    setCancelModalOpen(false);
    await moveOrder(cancelOrderId, 'cancelled', cancelReasonInput.trim());
    setCancelOrderId(null);
    setCancelReasonInput('');
  }

  function openEditAddress(order: Order) {
    if (order.type !== 'delivery') return;
    setEditAddressOrder(order);
    setEditAddressValue(order.deliveryAddress || '');
    setMenuOrderId(null);
  }

  function openEditPayment(order: Order) {
    if (order.status === 'completed' || order.status === 'cancelled') return;
    const normalizedLabel = order.paymentMethod.trim().toLowerCase();
    const exactMatch = activePaymentOptions.find((option) => option.label.trim().toLowerCase() === normalizedLabel);
    const detectedType = resolvePaymentMethodTypeFromOptions(order.paymentMethod, activePaymentOptions);
    const fallbackMatch = exactMatch || activePaymentOptions.find((option) => option.methodType === detectedType) || activePaymentOptions[0];
    setEditPaymentOrder(order);
    setEditPaymentValue(fallbackMatch?.id || '');
    setMenuOrderId(null);
    setError(null);
  }

  async function saveEditedAddress() {
    if (!editAddressOrder) return;
    const nextAddress = editAddressValue.trim();

    if (nextAddress.length < 5) {
      setError('Informe um endereco valido para o pedido.');
      return;
    }

    setSavingAddress(true);
    try {
      const response = await fetch(`/api/orders/${editAddressOrder.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ deliveryAddress: nextAddress }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        deliveryAddress?: string;
        updatedAt?: string;
      };

      if (!response.ok) {
        setError(data.error || 'Falha ao atualizar endereco do pedido.');
        return;
      }

      const updatedAddress = data.deliveryAddress || nextAddress;
      const updatedAt = data.updatedAt || new Date().toISOString();

      setOrders((current) =>
        current.map((order) =>
          order.id === editAddressOrder.id
            ? {
                ...order,
                deliveryAddress: updatedAddress,
                updatedAt,
              }
            : order,
        ),
      );

      setSelectedOrderDetail((current) =>
        current && current.id === editAddressOrder.id
          ? {
              ...current,
              deliveryAddress: updatedAddress,
              updatedAt,
            }
          : current,
      );

      setMapModalOrder((current) =>
        current && current.id === editAddressOrder.id
          ? {
              ...current,
              deliveryAddress: updatedAddress,
              updatedAt,
            }
          : current,
      );

      setError(null);
      setEditAddressOrder(null);
      setEditAddressValue('');
    } catch {
      setError('Falha ao atualizar endereco do pedido.');
    } finally {
      setSavingAddress(false);
    }
  }

  async function saveEditedPayment() {
    if (!editPaymentOrder) return;
    if (!editPaymentValue) {
      setError('Selecione uma forma de pagamento cadastrada no sistema.');
      return;
    }

    setSavingPayment(true);
    try {
      const response = await fetch(`/api/orders/${editPaymentOrder.id}/payment`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paymentMethodId: editPaymentValue }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        paymentMethod?: string;
        paymentMethodId?: string;
        updatedAt?: string;
      };

      if (!response.ok) {
        setError(data.error || 'Falha ao atualizar forma de pagamento do pedido.');
        return;
      }

      const updatedPaymentMethod = data.paymentMethod || editPaymentValue;
      const updatedAt = data.updatedAt || new Date().toISOString();

      setOrders((current) =>
        current.map((order) =>
          order.id === editPaymentOrder.id
            ? {
                ...order,
                paymentMethod: updatedPaymentMethod,
                updatedAt,
              }
            : order,
        ),
      );

      setSelectedOrderDetail((current) =>
        current && current.id === editPaymentOrder.id
          ? {
              ...current,
              paymentMethod: updatedPaymentMethod,
              updatedAt,
            }
          : current,
      );

      setError(null);
      setEditPaymentOrder(null);
      setEditPaymentValue('');
    } catch {
      setError('Falha ao atualizar forma de pagamento do pedido.');
    } finally {
      setSavingPayment(false);
    }
  }

  async function openOrderDetail(id: string) {
    setDetailLoading(true);
    setDetailModalOpen(true);
    setMenuOrderId(null);
    try {
      const response = await fetch(`/api/orders/${id}`, {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar detalhes do pedido.');
        setDetailModalOpen(false);
        return;
      }
      setSelectedOrderDetail(data.order as OrderDetail);
    } catch {
      setError('Falha ao carregar detalhes do pedido.');
      setDetailModalOpen(false);
    } finally {
      setDetailLoading(false);
    }
  }

  async function printOrder(order: Order) {
    setMenuOrderId(null);
    setOperationalMessage(null);
    try {
      const desktopBridge = getFaceburgDesktopBridge();
      const usingDesktopApp = Boolean(desktopBridge?.isDesktopApp);

      if (usingDesktopApp && printEnabled) {
        const localPrintActive = isLocalPrintAgentActive(printConnectionStatus, printLastSeenAt);
        await ensureDesktopPrintStarted({
          forceRestart: desktopPrintRunning && !localPrintActive,
        });
      }

      const sendPrintRequest = async () => {
        const response = await fetch(`/api/orders/${order.id}/print`, {
          method: 'POST',
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        return { response, data };
      };

      let { response, data } = await sendPrintRequest();

      if (!response.ok && usingDesktopApp && /hub de impressao offline/i.test(String(data.error || ''))) {
        const restarted = await ensureDesktopPrintStarted({ forceRestart: true });
        if (restarted) {
          await new Promise((resolve) => window.setTimeout(resolve, 1200));
          ({ response, data } = await sendPrintRequest());
        }
      }

      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Nao foi possivel enviar o recibo para a impressora.',
        });
        return;
      }

      setOperationalMessage({
        tone: 'success',
        text: `Recibo do pedido #${order.id.slice(0, 8)} enviado para impressao.`,
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao comunicar com o agente de impressao.',
      });
    }
  }

  async function handleDropInColumn(targetStatus: OrderStatus) {
    if (!draggingOrderId) return;
    const draggedOrder = orders.find((order) => order.id === draggingOrderId);
    setDragOverStatus(null);
    setDraggingOrderId(null);
    if (!draggedOrder) return;
    if (draggedOrder.status === targetStatus) return;
    if (targetStatus === 'cancelled') return;
    if (!canMoveOrder(draggedOrder, targetStatus)) return;
    await moveOrder(draggingOrderId, targetStatus);
  }

  function openDeliveryMap(order: Order) {
    if (order.type !== 'delivery' || !order.deliveryAddress.trim()) return;
    setMapModalOrder(order);
  }

  const ordersForColumn = useMemo(() => {
    return (statuses: OrderStatus[]) =>
      orders.filter((order) => statuses.includes(order.status));
  }, [orders]);

  const whatsappLocalActive = isLocalWhatsappSessionActive(whatsappSessionStatus, whatsappLastSeenAt);
  const whatsappNeedsLocalStart = whatsappEnabled && desktopAppAvailable && !whatsappLocalActive;
  const printLocalActive = isLocalPrintAgentActive(printConnectionStatus, printLastSeenAt);

  return (
    <DashboardShell overlaySidebar>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gerenciador de Pedidos</h2>
          <p className="text-sm text-slate-500">Pedidos do cardapio e PDV em tempo real.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className={cn(
              'btn-secondary',
              sirenEnabled ? 'border-emerald-300 text-emerald-700' : 'border-slate-300 text-slate-600',
            )}
            type="button"
            onClick={() => setSirenEnabled((current) => !current)}
          >
            Sirene: {sirenEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            className={cn(
              'btn-secondary',
              deliveryEnabled ? 'border-emerald-300 text-emerald-700' : 'border-rose-300 text-rose-700',
              deliveryUpdating ? 'opacity-60 cursor-not-allowed' : '',
            )}
            type="button"
            onClick={() => void toggleDeliveryStatus()}
            disabled={deliveryUpdating}
          >
            Delivery: {deliveryEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            className={cn(
              'btn-secondary',
              whatsappEnabled
                ? whatsappLocalActive && whatsappSessionStatus === 'ready'
                  ? 'border-emerald-300 text-emerald-700'
                  : 'border-amber-300 text-amber-700'
                : 'border-slate-300 text-slate-600',
              whatsappUpdating ? 'opacity-60 cursor-not-allowed' : '',
            )}
            type="button"
            onClick={() => void toggleWhatsappStatus()}
            disabled={whatsappUpdating}
          >
            WhatsApp: {whatsappNeedsLocalStart ? 'Abrir' : whatsappEnabled ? 'ON' : 'OFF'}
          </button>
          <button
            className="btn-secondary flex items-center gap-2"
            type="button"
            onClick={() => {
              refreshNow(true, true);
              void loadOperationalStatus();
            }}
          >
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>
      </div>

      <div className="mb-3">
        <p className="text-xs text-slate-500">
          Status do WhatsApp:{' '}
          <span className="font-semibold text-slate-700">
            {getWhatsappStatusLabel(whatsappSessionStatus, whatsappLastSeenAt, whatsappEnabled, desktopAppAvailable)}
          </span>
          {whatsappHasAgentKey ? '' : desktopAppAvailable ? ' (primeira conexao deste computador)' : ' (abra o Faceburg App neste computador)'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Status da impressao:{' '}
          <span className="font-semibold text-slate-700">
            {getPrintStatusLabel(printConnectionStatus, printLastSeenAt, printEnabled, desktopAppAvailable)}
          </span>
          {printHasAgentKey ? '' : desktopAppAvailable ? ' (primeira conexao deste computador)' : ' (abra o Faceburg App neste computador)'}
          {desktopPrintLastError ? <span className="text-red-500"> - {desktopPrintLastError}</span> : null}
          {printEnabled && desktopAppAvailable && !printLocalActive ? <span className="text-amber-600"> - vou tentar abrir ao imprimir</span> : null}
        </p>
      </div>

      {operationalMessage ? (
        <p
          className={cn(
            'text-sm mb-3',
            operationalMessage.tone === 'success'
              ? 'text-emerald-700'
              : operationalMessage.tone === 'warning'
                ? 'text-amber-700'
                : 'text-red-600',
          )}
        >
          {operationalMessage.text}
        </p>
      ) : null}

      {error ? <p className="text-sm text-red-500 mb-4">{error}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {columns.map((column) => (
          <div key={column.key} className="flex flex-col gap-3">
            <div className="column-header">
              <span>{column.title}</span>
              <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px] font-bold text-white">
                {ordersForColumn(column.statuses)
                  .length.toString()
                  .padStart(2, '0')}
              </span>
            </div>

            <div
              className={cn(
                'kanban-column transition-colors',
                dragOverStatus === column.dropStatus ? 'bg-blue-50/80 ring-1 ring-blue-200' : '',
              )}
              onDragOver={(event) => {
                event.preventDefault();
                if (!draggingOrderId) return;
                if (dragOverStatus !== column.dropStatus) {
                  setDragOverStatus(column.dropStatus);
                }
              }}
              onDragLeave={() => {
                if (dragOverStatus === column.dropStatus) {
                  setDragOverStatus(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                void handleDropInColumn(column.dropStatus);
              }}
            >
              {loading ? <p className="text-xs text-slate-500 px-2">Carregando...</p> : null}
              {ordersForColumn(column.statuses)
                .map((order) => (
                  <div
                    key={order.id}
                    draggable={updatingId !== order.id && !isTerminalOrderStatus(order.status)}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingOrderId(order.id);
                    }}
                    onDragEnd={() => {
                      setDraggingOrderId(null);
                      setDragOverStatus(null);
                    }}
                    className={cn(
                      'card-order group relative',
                      isTerminalOrderStatus(order.status) ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
                      draggingOrderId === order.id ? 'opacity-60' : '',
                    )}
                  >
                    <div
                      className={cn(
                        '-mx-4 -mt-4 mb-3 flex justify-between items-center px-4 py-1.5 shadow-sm',
                        order.status === 'cancelled'
                          ? 'bg-rose-400'
                          : order.status === 'completed'
                            ? 'bg-slate-400'
                            : order.type === 'delivery'
                              ? 'bg-emerald-400'
                              : 'bg-sky-500',
                      )}
                    >
                      <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white flex items-center gap-1.5">
                        {order.type === 'delivery' ? <Bike className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                        {order.type === 'delivery' ? 'Entrega' : order.type === 'pickup' ? 'Balcao' : 'Mesa'}
                      </span>
                      <span
                        className={cn(
                          'rounded-md px-2 py-0.5 text-[13px] font-mono font-extrabold tracking-tight shadow-sm',
                          getRemainingTimeClass(order, prepTimeMinutes, countdownNowMs),
                        )}
                      >
                        {formatRemainingTime(order, prepTimeMinutes, countdownNowMs)}
                      </span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm mb-1">{order.customerName}</h4>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400 mb-1">Pedido #{order.id.slice(0, 8)}</p>
                    <p className="text-xs text-slate-500 mb-1">{order.itemsSummary || 'Sem itens'}</p>
                    {order.status === 'cancelled' ? (
                      <p className="text-[11px] text-rose-600 mb-1">
                        <strong>Cancelado:</strong> {order.cancelReason || 'Sem motivo informado'}
                      </p>
                    ) : null}
                    {order.type === 'delivery' && order.deliveryAddress ? (
                      <p className="text-[11px] text-slate-500 line-clamp-2 mb-2">{order.deliveryAddress}</p>
                    ) : null}

                    <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
                      <div className="flex items-center gap-2">
                        <span className="text-lg leading-none font-black text-slate-900">{formatCurrency(order.total)}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        {order.status !== 'completed' && order.status !== 'cancelled' ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openEditPayment(order);
                            }}
                            className={cn(
                              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide transition-colors hover:brightness-95',
                              getPaymentMethodBadgeClass(order.paymentMethod, activePaymentOptions),
                            )}
                            title="Trocar forma de pagamento"
                            aria-label={`Trocar forma de pagamento do pedido ${order.id.slice(0, 8)}`}
                          >
                            {getPaymentDisplayLabel(order.paymentMethod)}
                          </button>
                        ) : (
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                              getPaymentMethodBadgeClass(order.paymentMethod, activePaymentOptions),
                            )}
                          >
                            {getPaymentDisplayLabel(order.paymentMethod)}
                          </span>
                        )}
                        {order.type === 'delivery' ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              openDeliveryMap(order);
                            }}
                            className="inline-flex items-center justify-center rounded-full border border-slate-200 bg-slate-50 p-1.5 text-slate-600 transition-colors hover:bg-slate-100"
                            title="Abrir mapa da entrega"
                            aria-label={`Abrir mapa da entrega de ${order.customerName}`}
                          >
                            <MapPin className="w-3 h-3" />
                          </button>
                        ) : (
                          <ShoppingBag className="w-3 h-3 text-blue-500" />
                        )}
                      </div>
                    </div>

                    <div className="mt-4 flex gap-2">
                      {order.status === 'pending' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'processing')}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-sky-500 text-white py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Iniciar Preparo
                        </button>
                      ) : null}
                      {order.status === 'processing' && order.type === 'delivery' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'delivering')}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-sky-500 text-white py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Saiu p/ Entrega
                        </button>
                      ) : null}
                      {order.status === 'processing' && order.type !== 'delivery' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'completed')}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-sky-500 text-white py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Finalizar
                        </button>
                      ) : null}
                      {order.status === 'delivering' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'completed')}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-sky-500 text-white py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          Finalizar
                        </button>
                      ) : null}
                      {order.status === 'completed' ? (
                        <span className="flex-1 bg-emerald-50 text-emerald-600 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-center">
                          Pedido finalizado
                        </span>
                      ) : null}
                      {order.status === 'cancelled' ? (
                        <span className="flex-1 bg-rose-50 text-rose-600 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-center">
                          Cancelado
                        </span>
                      ) : null}
                      <div className="relative ml-auto" data-order-menu="true">
                        <button
                          onClick={() => setMenuOrderId((current) => (current === order.id ? null : order.id))}
                          data-order-menu="true"
                          className="p-1.5 rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 transition-colors flex items-center gap-1"
                        >
                          <Menu className="w-4 h-4" />
                          <ChevronDown className="w-3 h-3" />
                        </button>
                        {menuOrderId === order.id ? (
                          <div
                            className="absolute right-0 bottom-full mb-2 w-52 rounded-xl border border-slate-200 bg-white shadow-lg z-20 overflow-hidden"
                            data-order-menu="true"
                          >
                            <button
                              onClick={() => void openOrderDetail(order.id)}
                              className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Eye className="w-3.5 h-3.5" />
                              Visualizar pedido
                            </button>
                            <button
                              onClick={() => void printOrder(order)}
                              className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              Imprimir recibo
                            </button>
                            {order.type === 'delivery' && order.status !== 'completed' && order.status !== 'cancelled' ? (
                              <button
                                onClick={() => openEditAddress(order)}
                                className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                              >
                                <MapPin className="w-3.5 h-3.5" />
                                Trocar endereco
                              </button>
                            ) : null}
                            {order.status !== 'completed' && order.status !== 'cancelled' ? (
                              <button
                                onClick={() => void cancelOrder(order.id)}
                                disabled={updatingId === order.id}
                                className="w-full px-3 py-2 text-left text-xs font-semibold text-rose-600 hover:bg-rose-50 flex items-center gap-2 disabled:opacity-50"
                              >
                                <Ban className="w-3.5 h-3.5" />
                                Cancelar pedido
                              </button>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                ))}

              {!loading && ordersForColumn(column.statuses).length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 opacity-30 select-none">
                  <ShoppingBag className="w-8 h-8 mb-2" />
                  <p className="text-[10px] font-bold uppercase tracking-widest text-center leading-tight">
                    Nenhum pedido
                    <br />
                    nesta etapa
                  </p>
                </div>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {detailModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-3 overflow-y-auto">
          <div className="max-w-2xl mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">
                  {selectedOrderDetail ? `Pedido #${selectedOrderDetail.id.slice(0, 8)}` : 'Pedido'}
                </p>
                <p className="text-xs text-slate-500">Visualizacao completa do pedido</p>
              </div>
              <button
                onClick={() => {
                  setDetailModalOpen(false);
                  setSelectedOrderDetail(null);
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {detailLoading || !selectedOrderDetail ? (
              <div className="p-6 text-sm text-slate-500">Carregando pedido...</div>
            ) : (
              <div className="p-4 space-y-4 text-sm">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 grid md:grid-cols-2 gap-2">
                  <p><strong>Cliente:</strong> {selectedOrderDetail.customerName}</p>
                  <p><strong>Telefone:</strong> {selectedOrderDetail.customerPhone || '-'}</p>
                  <p>
                    <strong>Tipo:</strong>{' '}
                    {selectedOrderDetail.type === 'delivery' ? 'Delivery' : selectedOrderDetail.type === 'pickup' ? 'Balcao' : 'Mesa'}
                  </p>
                  <p className="flex items-center gap-2">
                    <strong>Status:</strong>
                    <span
                      className={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold uppercase tracking-wide',
                        statusBadgeClass(selectedOrderDetail.status),
                      )}
                    >
                      {formatOrderStatusLabel(selectedOrderDetail.status)}
                    </span>
                  </p>
                  {selectedOrderDetail.status === 'cancelled' ? (
                    <p className="md:col-span-2"><strong>Motivo cancelamento:</strong> {selectedOrderDetail.cancelReason || 'Sem motivo informado'}</p>
                  ) : null}
                  <p><strong>Pagamento:</strong> {getPaymentDisplayLabel(selectedOrderDetail.paymentMethod)}</p>
                  <p><strong>Data:</strong> {new Date(selectedOrderDetail.createdAt).toLocaleString('pt-BR')}</p>
                  {selectedOrderDetail.type === 'delivery' ? (
                    <p className="md:col-span-2">
                      <strong>Endereco:</strong> {selectedOrderDetail.deliveryAddress || '-'}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">Itens do pedido</p>
                  {selectedOrderDetail.items.map((item) => {
                    const notesLines = formatItemNotes(item.notesParsed);
                    return (
                      <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                        <p className="font-semibold text-slate-900">
                          {item.quantity}x {item.productName}
                        </p>
                        <p className="text-xs text-slate-500">
                          Unitario: {formatCurrency(item.unitPrice)} - Subtotal: {formatCurrency(item.quantity * item.unitPrice)}
                        </p>
                        {notesLines.length > 0 ? (
                          <div className="text-xs text-slate-500 mt-1 space-y-0.5">
                            {notesLines.map((line, index) => (
                              <p key={`${item.id}-note-${index}`}>{line}</p>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>

                <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
                  <p className="font-bold text-slate-900">Total do pedido</p>
                  <p className="font-black text-lg text-brand-primary">{formatCurrency(selectedOrderDetail.total)}</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {mapModalOrder ? (
        <div className="fixed inset-0 z-50 bg-black/55 p-3 overflow-y-auto">
          <div className="max-w-5xl mx-auto bg-white rounded-[28px] border border-slate-200 shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-orange-600 border border-orange-100">
                  <MapPin className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-lg font-bold text-slate-900 truncate">Mapa da Entrega</p>
                  <p className="text-sm text-slate-500 truncate">
                    {mapModalOrder.customerName} - Pedido #{mapModalOrder.id.slice(0, 8)}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setMapModalOrder(null)}
                className="p-2 rounded-xl hover:bg-slate-100 transition-colors"
                aria-label="Fechar mapa da entrega"
              >
                <X className="w-5 h-5 text-slate-500" />
              </button>
            </div>

            <div className="p-4 md:p-5 space-y-4 bg-slate-50/70">
              <div className="rounded-[24px] border border-slate-200 bg-white p-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="space-y-2 min-w-0">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-slate-400">Endereco da entrega</p>
                  <p className="text-base font-semibold text-slate-900 leading-6">{mapModalOrder.deliveryAddress}</p>
                  <p className="text-sm text-slate-500">
                    Use o mapa para localizar rapidamente o destino desse pedido.
                  </p>
                </div>
                <a
                  href={buildDeliveryMapExternalUrl(mapModalOrder)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex shrink-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-slate-800"
                >
                  Abrir no Google Maps
                </a>
              </div>

              {buildDeliveryMapEmbedUrl(mapModalOrder) ? (
                <div className="overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-sm">
                  <iframe
                    title={`Mapa da entrega do pedido ${mapModalOrder.id.slice(0, 8)}`}
                    src={buildDeliveryMapEmbedUrl(mapModalOrder)}
                    className="h-[55vh] min-h-[360px] w-full"
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                  />
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-300 bg-white px-6 py-16 text-center text-sm text-slate-500">
                  Esse pedido ainda nao tem um endereco valido para abrir no mapa.
                </div>
              )}
            </div>

            <div className="px-5 py-4 border-t border-slate-200 bg-white flex justify-end">
              <button onClick={() => setMapModalOrder(null)} className="btn-secondary">
                Fechar
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {cancelModalOpen ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-3 overflow-y-auto">
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Cancelar pedido</p>
                <p className="text-xs text-slate-500">Informe o motivo para registrar no historico.</p>
              </div>
              <button
                onClick={() => {
                  setCancelModalOpen(false);
                  setCancelOrderId(null);
                  setCancelReasonInput('');
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <textarea
                value={cancelReasonInput}
                onChange={(event) => setCancelReasonInput(event.target.value)}
                rows={4}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Ex.: cliente solicitou cancelamento, falta de item, endereco fora de area..."
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    setCancelModalOpen(false);
                    setCancelOrderId(null);
                    setCancelReasonInput('');
                  }}
                  className="btn-secondary flex-1 justify-center"
                >
                  Voltar
                </button>
                <button onClick={() => void confirmCancelOrder()} className="btn-primary flex-1 justify-center">
                  Confirmar Cancelamento
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editAddressOrder ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-3 overflow-y-auto">
          <div className="max-w-lg mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Trocar endereco do pedido</p>
                <p className="text-xs text-slate-500">Pedido #{editAddressOrder.id.slice(0, 8)} - {editAddressOrder.customerName}</p>
              </div>
              <button
                onClick={() => {
                  if (savingAddress) return;
                  setEditAddressOrder(null);
                  setEditAddressValue('');
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <label className="block text-xs font-bold uppercase tracking-[0.18em] text-slate-400">
                Novo endereco
              </label>
              <textarea
                value={editAddressValue}
                onChange={(event) => setEditAddressValue(event.target.value)}
                rows={4}
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                placeholder="Rua, numero, bairro, cidade..."
              />
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (savingAddress) return;
                    setEditAddressOrder(null);
                    setEditAddressValue('');
                  }}
                  className="btn-secondary flex-1 justify-center"
                  disabled={savingAddress}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void saveEditedAddress()}
                  className="btn-primary flex-1 justify-center"
                  disabled={savingAddress}
                >
                  {savingAddress ? 'Salvando...' : 'Salvar endereco'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {editPaymentOrder ? (
        <div className="fixed inset-0 z-50 bg-black/50 p-3 overflow-y-auto">
          <div className="max-w-md mx-auto bg-white rounded-2xl border border-slate-200 shadow-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <p className="text-sm font-bold text-slate-900">Trocar forma de pagamento</p>
                <p className="text-xs text-slate-500">Pedido #{editPaymentOrder.id.slice(0, 8)} - {editPaymentOrder.customerName}</p>
              </div>
              <button
                onClick={() => {
                  if (savingPayment) return;
                  setEditPaymentOrder(null);
                  setEditPaymentValue('');
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Escolha a forma de pagamento</p>
              {paymentOptionsLoading ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-500">
                  Carregando formas cadastradas...
                </div>
              ) : activePaymentOptions.length === 0 ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-4 text-sm text-amber-700">
                  Nenhuma forma de pagamento ativa foi encontrada no sistema.
                </div>
              ) : (
                <div className="space-y-2">
                  {activePaymentOptions.map((option) => (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setEditPaymentValue(option.id)}
                      className={cn(
                        'w-full rounded-xl border px-3 py-3 text-left transition-colors',
                        editPaymentValue === option.id
                          ? 'border-sky-400 bg-sky-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50',
                      )}
                      disabled={savingPayment}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{option.label}</p>
                          <p className="text-xs text-slate-500 mt-1">{option.description}</p>
                        </div>
                        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide', getPaymentMethodBadgeClass(option.label, activePaymentOptions))}>
                          {option.methodType === 'pix'
                            ? 'Pix'
                            : option.methodType === 'cash'
                              ? 'Dinheiro'
                              : option.methodType === 'card'
                                ? 'Cartao'
                                : option.methodType === 'bank_slip'
                                  ? 'Boleto'
                                  : option.methodType === 'wallet'
                                    ? 'Carteira'
                                    : 'Outro'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => {
                    if (savingPayment) return;
                    setEditPaymentOrder(null);
                    setEditPaymentValue('');
                  }}
                  className="btn-secondary flex-1 justify-center"
                  disabled={savingPayment}
                >
                  Cancelar
                </button>
                <button
                  onClick={() => void saveEditedPayment()}
                  className="btn-primary flex-1 justify-center"
                  disabled={savingPayment || paymentOptionsLoading || activePaymentOptions.length === 0}
                >
                  {savingPayment ? 'Salvando...' : 'Salvar pagamento'}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
