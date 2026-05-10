'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { AlertTriangle, Banknote, Clock, CreditCard, Hash, MapPin, MessageCircle, Search, Settings, ShoppingBag, Printer, RefreshCw, Menu, ChevronDown, Eye, Ban, X, Bike, Plus, Minus, Trash2, Volume2, VolumeX } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';
import {
  DEFAULT_ORDER_NOTIFICATION_SOUND,
  ORDER_NOTIFICATION_SOUND_OPTIONS,
  getOrderNotificationSoundLabel,
  normalizeOrderNotificationSound,
  type OrderNotificationSound,
  scheduleOrderNotificationSound,
} from '@/lib/order-notification-sounds';

type OrderStatus = 'pending' | 'processing' | 'delivering' | 'completed' | 'cancelled';

type Order = {
  id: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  itemsSummary: string;
  orderSequenceNumber?: number | null;
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
  orderSequenceNumber?: number | null;
  subtotalAmount?: number;
  discountAmount?: number;
  surchargeAmount?: number;
  deliveryFeeAmount?: number;
  total: number;
  status: OrderStatus;
  cancelReason?: string;
  type: 'delivery' | 'pickup' | 'table';
  paymentMethod: string;
  changeFor: number;
  createdAt: string;
  updatedAt: string;
  itemsSummary?: string;
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

type EditableOrderItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  isNew?: boolean;
  removed?: boolean;
};

type OrderEditProduct = {
  id: string;
  name: string;
  price: number;
};

type CardapioSettingsResponse = {
  storeOpen?: boolean;
  effectiveStoreOpen?: boolean;
  menuOpenMode?: 'manual' | 'schedule';
  prepTimeMinutes?: number;
  orderNotificationSound?: string;
  orderSequenceStart?: number | null;
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
  printerName?: string;
  autoAcceptOrders?: boolean;
  lastError?: string;
  lastSeenAt?: string | null;
  error?: string;
};

type CashCurrentResponse = {
  current?: {
    id: string;
    openedAt: string;
    openingAmount: number;
    status: string;
  } | null;
  expectedAmount?: number;
  storeOpen?: boolean;
  effectiveStoreOpen?: boolean;
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

type LocalHttpAgentProbe = {
  checkedAt: number;
  available: boolean;
  whatsappReady: boolean;
  whatsappStatus: string;
  printerName: string;
};

type LocalWhatsappControlResponse = {
  ok?: boolean;
  status?: {
    status?: string;
    phoneNumber?: string;
    qrCode?: string;
    lastError?: string;
    updatedAt?: string;
  };
  error?: string;
};

type DispatchFallbackResponse = {
  ok?: boolean;
  printQueued?: boolean;
  whatsappQueued?: boolean;
  error?: string;
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
  printDirect?: (payload: LocalPrintJob) => Promise<{ ok: boolean; error?: string }>;
  sendWhatsAppDirect?: (payload: LocalWhatsappJob) => Promise<{ ok: boolean; error?: string }>;
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

const FACEBURG_LOCAL_AGENT_URL = 'http://127.0.0.1:9787';
const ORDER_CARD_ACTION_BUTTON_CLASS =
  'flex-1 bg-sky-500 text-white py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-sky-600 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed';
const ORDER_CARD_STATUS_CLASS =
  'flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-center';
const PAYMENT_BADGE_BASE_CLASS =
  'inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide';

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function roundCurrency(value: number) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseQuickMoney(value: string) {
  let normalized = String(value || '0').replace(/[^\d,.-]/g, '');
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }
  const parsed = Number(normalized || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatCurrencyDelta(value: number) {
  const amount = roundCurrency(value);
  if (amount === 0) return formatCurrency(0);
  return `${amount > 0 ? '+' : '-'} ${formatCurrency(Math.abs(amount))}`;
}

function normalizeSearchText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
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

function getOrderTypeLabel(type: Order['type']) {
  if (type === 'delivery') return 'Entrega';
  if (type === 'pickup') return 'Retirada';
  return 'Balcao';
}

function getOrderHeaderClass(order: Pick<Order, 'status' | 'type'>) {
  if (order.status === 'cancelled') return 'bg-rose-400';
  if (order.status === 'completed') return 'bg-slate-400';
  if (order.type === 'delivery') return 'bg-emerald-400';
  if (order.type === 'pickup') return 'bg-amber-500';
  return 'bg-sky-500';
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

function getPaymentMethodTypeLabel(type: PaymentMethodType) {
  if (type === 'pix') return 'Pix';
  if (type === 'cash') return 'Dinheiro';
  if (type === 'card') return 'Cartao';
  if (type === 'bank_slip') return 'Boleto';
  if (type === 'wallet') return 'Carteira';
  return 'Outro';
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

function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error || 'Falha desconhecida.');
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
  localAgent?: LocalHttpAgentProbe | null,
) {
  if (localAgent?.available) {
    if (localAgent.whatsappStatus === 'ready') return 'Conectado no agente local';
    if (localAgent.whatsappStatus === 'qr') return 'QR aberto no agente local';
    if (localAgent.whatsappStatus === 'connecting') return 'Agente local conectando';
    return enabled ? 'Agente local online' : 'Agente local online';
  }
  if (!enabled) return 'Desligado';
  if (sessionStatus === 'ready' && isWhatsappDesktopOnline(lastSeenAt)) return 'Conectado';
  if (sessionStatus === 'qr') return 'Escaneie o QR';
  if (sessionStatus === 'connecting') return desktopAppAvailable ? 'Abrindo no computador' : 'Aguardando o app';
  if (sessionStatus === 'auth_failure') return 'Reconecte o WhatsApp';
  return desktopAppAvailable ? 'Preparando conexao' : 'Abra o agente local';
}

function getPrintStatusLabel(
  status: string,
  lastSeenAt: string | null,
  enabled: boolean,
  desktopAppAvailable: boolean,
  localAgent?: LocalHttpAgentProbe | null,
) {
  if (localAgent?.available) {
    if (!enabled) return 'Agente local conectado (automacao desligada)';
    return localAgent.printerName
      ? `Agente local conectado (${localAgent.printerName})`
      : 'Agente local conectado';
  }
  if (!enabled) return 'Desligado';
  if (isLocalPrintAgentActive(status, lastSeenAt)) return status === 'connecting' ? 'Abrindo no computador' : 'Conectado';
  if (status === 'error') return 'Erro no agente';
  return desktopAppAvailable ? 'Preparando impressao' : 'Abra o agente local';
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
  const [editingFinalizedOrder, setEditingFinalizedOrder] = useState(false);
  const [orderEditItems, setOrderEditItems] = useState<EditableOrderItem[]>([]);
  const [orderEditPaymentValue, setOrderEditPaymentValue] = useState('');
  const [orderEditProducts, setOrderEditProducts] = useState<OrderEditProduct[]>([]);
  const [orderEditProductId, setOrderEditProductId] = useState('');
  const [orderEditProductSearch, setOrderEditProductSearch] = useState('');
  const [orderEditProductSearchFocused, setOrderEditProductSearchFocused] = useState(false);
  const [orderEditProductQuantity, setOrderEditProductQuantity] = useState(1);
  const [orderEditProductsLoading, setOrderEditProductsLoading] = useState(false);
  const [savingOrderAdjustment, setSavingOrderAdjustment] = useState(false);
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
  const [orderNotificationSound, setOrderNotificationSound] = useState<OrderNotificationSound>(DEFAULT_ORDER_NOTIFICATION_SOUND);
  const [deliveryEnabled, setDeliveryEnabled] = useState(true);
  const [deliveryUpdating, setDeliveryUpdating] = useState(false);
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappUpdating, setWhatsappUpdating] = useState(false);
  const [whatsappHasAgentKey, setWhatsappHasAgentKey] = useState(false);
  const [whatsappSessionStatus, setWhatsappSessionStatus] = useState('disconnected');
  const [whatsappLastSeenAt, setWhatsappLastSeenAt] = useState<string | null>(null);
  const [printEnabled, setPrintEnabled] = useState(false);
  const [printUpdating, setPrintUpdating] = useState(false);
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(false);
  const [autoAcceptUpdating, setAutoAcceptUpdating] = useState(false);
  const [printHasAgentKey, setPrintHasAgentKey] = useState(false);
  const [printConnectionStatus, setPrintConnectionStatus] = useState('disconnected');
  const [printPrinterName, setPrintPrinterName] = useState('');
  const [printLastSeenAt, setPrintLastSeenAt] = useState<string | null>(null);
  const [desktopPrintRunning, setDesktopPrintRunning] = useState(false);
  const [desktopPrintLastError, setDesktopPrintLastError] = useState('');
  const [desktopAppAvailable, setDesktopAppAvailable] = useState(false);
  const [localHttpAgentState, setLocalHttpAgentState] = useState<LocalHttpAgentProbe | null>(null);
  const [prepTimeMinutes, setPrepTimeMinutes] = useState(40);
  const [prepTimeInput, setPrepTimeInput] = useState('40');
  const [prepTimeSaving, setPrepTimeSaving] = useState(false);
  const [quickSettingsOpen, setQuickSettingsOpen] = useState(false);
  const [quickSoundExpanded, setQuickSoundExpanded] = useState(false);
  const [soundSaving, setSoundSaving] = useState(false);
  const [orderSequenceInput, setOrderSequenceInput] = useState('');
  const [orderSequenceSaving, setOrderSequenceSaving] = useState(false);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashOpening, setCashOpening] = useState(false);
  const [cashCurrent, setCashCurrent] = useState<CashCurrentResponse['current']>(null);
  const [cashOpeningAmount, setCashOpeningAmount] = useState('0');
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const didBootstrapRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const requestInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);
  const desktopSessionSyncRef = useRef<Promise<DesktopSessionSyncResponse | null> | null>(null);
  const desktopStartRef = useRef<Promise<boolean> | null>(null);
  const desktopPrintStartRef = useRef<Promise<boolean> | null>(null);
  const localHttpAgentRef = useRef<LocalHttpAgentProbe | null>(null);

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

  const orderEditSubtotal = useMemo(
    () =>
      orderEditItems
        .filter((item) => !item.removed)
        .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0),
    [orderEditItems],
  );

  const activeOrderEditItemCount = useMemo(
    () => orderEditItems.filter((item) => !item.removed).length,
    [orderEditItems],
  );

  const selectedOrderEditProduct = useMemo(
    () => orderEditProducts.find((product) => product.id === orderEditProductId) || null,
    [orderEditProductId, orderEditProducts],
  );

  const filteredOrderEditProducts = useMemo(() => {
    const search = normalizeSearchText(orderEditProductSearch);
    const products = search
      ? orderEditProducts.filter((product) => normalizeSearchText(product.name).includes(search))
      : orderEditProducts;
    return products.slice(0, 8);
  }, [orderEditProductSearch, orderEditProducts]);

  const orderEditAdjustedTotal = useMemo(() => {
    if (!selectedOrderDetail) return orderEditSubtotal;
    return roundCurrency(
      orderEditSubtotal -
        Number(selectedOrderDetail.discountAmount || 0) +
        Number(selectedOrderDetail.surchargeAmount || 0) +
        Number(selectedOrderDetail.deliveryFeeAmount || 0),
    );
  }, [
    orderEditSubtotal,
    selectedOrderDetail,
  ]);

  const orderEditDifference = roundCurrency(orderEditAdjustedTotal - Number(selectedOrderDetail?.total || 0));

  const canSaveOrderAdjustment =
    activeOrderEditItemCount > 0 && Boolean(orderEditPaymentValue) && !savingOrderAdjustment;

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

    scheduleOrderNotificationSound(ctx, orderNotificationSound);
  }, [orderNotificationSound, sirenEnabled]);



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
          (order.status === 'pending' || order.status === 'processing'),
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
      const [settingsResponse, whatsappResponse, printResponse, desktopState, localAgentHealth] = await Promise.all([
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
        !desktopBridge?.isDesktopApp
          ? fetch(`${FACEBURG_LOCAL_AGENT_URL}/api/health`, { cache: 'no-store' })
              .then(async (response) => (response.ok ? response.json() : null))
              .catch(() => null)
          : Promise.resolve(null),
      ]);

      const settingsData = (await settingsResponse.json().catch(() => ({}))) as CardapioSettingsResponse;
      if (settingsResponse.ok) {
        setDeliveryEnabled(Boolean(settingsData.storeOpen));
        const nextPrepTime = sanitizePrepTimeMinutes(settingsData.prepTimeMinutes);
        setPrepTimeMinutes(nextPrepTime);
        setPrepTimeInput(String(nextPrepTime));
        setOrderNotificationSound(normalizeOrderNotificationSound(settingsData.orderNotificationSound));
        const nextSequenceStart = settingsData.orderSequenceStart ?? null;
        setOrderSequenceInput(nextSequenceStart === null ? '' : String(nextSequenceStart));
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
        setAutoAcceptOrders(Boolean(printData.autoAcceptOrders));
        setPrintHasAgentKey(Boolean(printData.hasAgentKey));
        setPrintConnectionStatus(String(printData.connectionStatus || 'disconnected'));
        setPrintPrinterName(String(printData.printerName || ''));
        setPrintLastSeenAt(printData.lastSeenAt || null);
        setDesktopPrintLastError(String(printData.lastError || ''));
      }

      if (!desktopBridge?.isDesktopApp) {
        const localProbe = localAgentHealth && typeof localAgentHealth === 'object'
          ? {
              checkedAt: Date.now(),
              available: Boolean((localAgentHealth as { online?: boolean }).online),
              whatsappReady: String((localAgentHealth as { whatsapp?: { status?: string } }).whatsapp?.status || '') === 'ready',
              whatsappStatus: String((localAgentHealth as { whatsapp?: { status?: string } }).whatsapp?.status || 'disconnected'),
              printerName: String((localAgentHealth as { printerName?: string }).printerName || ''),
            }
          : { checkedAt: Date.now(), available: false, whatsappReady: false, whatsappStatus: 'disconnected', printerName: '' };
        localHttpAgentRef.current = localProbe;
        setLocalHttpAgentState(localProbe);
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

      const manualStoreOpen = typeof data.storeOpen === 'boolean' ? data.storeOpen : nextValue;
      const effectiveStoreOpen = typeof data.effectiveStoreOpen === 'boolean' ? data.effectiveStoreOpen : manualStoreOpen;
      setDeliveryEnabled(manualStoreOpen);
      if (typeof data.prepTimeMinutes === 'number') {
        const nextPrepTime = sanitizePrepTimeMinutes(data.prepTimeMinutes);
        setPrepTimeMinutes(nextPrepTime);
        setPrepTimeInput(String(nextPrepTime));
      }
      setOperationalMessage({
        tone: 'success',
        text: data.menuOpenMode === 'schedule'
          ? !manualStoreOpen
            ? 'Cardapio OFF. Mesmo no modo horario, novos pedidos foram bloqueados.'
            : effectiveStoreOpen
              ? 'Cardapio ON. O horario atual permite receber pedidos.'
              : 'Cardapio ON, mas fechado agora pelo horario configurado.'
          : manualStoreOpen
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
    setWhatsappUpdating(true);
    setOperationalMessage(null);
    try {
      const probedLocalAgent = usingDesktopApp ? null : await probeLocalHttpAgent(true).catch(() => null);
      const localHttpWhatsappActive = Boolean(
        probedLocalAgent?.available &&
        ['ready', 'qr', 'connecting'].includes(probedLocalAgent.whatsappStatus),
      );
      const shouldReconnectLocalAgent =
        whatsappEnabled &&
        !localHttpWhatsappActive &&
        !isLocalWhatsappSessionActive(whatsappSessionStatus, whatsappLastSeenAt);

      if (shouldReconnectLocalAgent) {
        const started = usingDesktopApp
          ? await ensureDesktopWhatsappStarted({
              forceRestart: ['auth_failure', 'error', 'disconnected', 'stopped'].includes(whatsappSessionStatus),
            })
          : probedLocalAgent?.available
            ? await startLocalHttpWhatsapp().then(() => true).catch(() => false)
            : false;
        setOperationalMessage({
          tone: started ? 'warning' : 'error',
          text: started
            ? 'WhatsApp automatico ja estava ON. Iniciei a sessao no agente local.'
            : 'WhatsApp esta ON, mas nao consegui iniciar o agente local neste computador.',
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

      const localAgent = usingDesktopApp ? null : probedLocalAgent || await probeLocalHttpAgent(true);
      if (localAgent?.whatsappReady) {
        setOperationalMessage({
          tone: 'success',
          text: 'WhatsApp conectado no agente local. Mensagens automaticas ativas.',
        });
        return;
      }
      if (localAgent?.available) {
        const localStatus = await startLocalHttpWhatsapp().catch(() => '');
        if (localStatus) {
          setOperationalMessage({
            tone: localStatus === 'ready' ? 'success' : 'warning',
            text: localStatus === 'qr'
              ? 'WhatsApp iniciado no agente local. Escaneie o QR para conectar.'
              : localStatus === 'ready'
                ? 'WhatsApp iniciado no agente local. Mensagens automaticas ativas.'
                : 'WhatsApp iniciando no agente local.',
          });
          return;
        }
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
              : 'WhatsApp ativado. Abra o agente local neste computador para concluir a conexao.'),
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

  async function togglePrintStatus() {
    if (printUpdating) return;
    const nextValue = !printEnabled;
    setPrintUpdating(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue }),
      });
      const data = (await response.json().catch(() => ({}))) as PrintConfigResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao atualizar impressora.',
        });
        return;
      }

      const enabled = Boolean(data.enabled);
      setPrintEnabled(enabled);
      setAutoAcceptOrders(Boolean(data.autoAcceptOrders));
      setPrintHasAgentKey(Boolean(data.hasAgentKey));
      setPrintConnectionStatus(String(data.connectionStatus || 'disconnected'));
      setPrintPrinterName(String(data.printerName || printPrinterName));
      setPrintLastSeenAt(data.lastSeenAt || null);
      setDesktopPrintLastError(String(data.lastError || ''));

      const desktopBridge = getFaceburgDesktopBridge();
      if (!enabled) {
        await desktopBridge?.stopPrint?.().catch(() => null);
      } else {
        void ensureDesktopPrintStarted();
      }

      setOperationalMessage({
        tone: enabled ? 'success' : 'warning',
        text: enabled
          ? 'Impressao automatica ligada.'
          : 'Impressao automatica desligada.',
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao atualizar impressora.',
      });
    } finally {
      setPrintUpdating(false);
    }
  }

  async function toggleAutoAcceptOrders() {
    if (autoAcceptUpdating) return;
    const nextValue = !autoAcceptOrders;
    setAutoAcceptUpdating(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoAcceptOrders: nextValue }),
      });
      const data = (await response.json().catch(() => ({}))) as PrintConfigResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao atualizar envio direto para cozinha.',
        });
        return;
      }

      const enabled = Boolean(data.autoAcceptOrders);
      setAutoAcceptOrders(enabled);
      setPrintEnabled(Boolean(data.enabled));
      setPrintHasAgentKey(Boolean(data.hasAgentKey));
      setPrintConnectionStatus(String(data.connectionStatus || 'disconnected'));
      setPrintPrinterName(String(data.printerName || printPrinterName));
      setPrintLastSeenAt(data.lastSeenAt || null);
      setDesktopPrintLastError(String(data.lastError || ''));

      setOperationalMessage({
        tone: 'success',
        text: enabled
          ? 'Pedido direto na cozinha ligado. Novos pedidos do cardapio ja entram em preparo.'
          : 'Pedido direto na cozinha desligado. Novos pedidos voltam para a coluna Novos.',
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao atualizar envio direto para cozinha.',
      });
    } finally {
      setAutoAcceptUpdating(false);
    }
  }

  async function saveOrderNotificationSound(nextSound: OrderNotificationSound) {
    if (soundSaving) return;
    setSoundSaving(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderNotificationSound: nextSound }),
      });
      const data = (await response.json().catch(() => ({}))) as CardapioSettingsResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao salvar som dos pedidos.',
        });
        return;
      }

      setOrderNotificationSound(normalizeOrderNotificationSound(data.orderNotificationSound || nextSound));
      setOperationalMessage({
        tone: 'success',
        text: 'Som dos pedidos atualizado.',
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao salvar som dos pedidos.',
      });
    } finally {
      setSoundSaving(false);
    }
  }

  async function savePrepTimeMinutes() {
    if (prepTimeSaving) return;
    const parsedPrepTime = Math.round(Number(prepTimeInput));
    if (!Number.isFinite(parsedPrepTime) || parsedPrepTime < 5 || parsedPrepTime > 180) {
      setOperationalMessage({
        tone: 'error',
        text: 'Tempo de entrega deve ficar entre 5 e 180 minutos.',
      });
      return;
    }

    setPrepTimeSaving(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prepTimeMinutes: parsedPrepTime }),
      });
      const data = (await response.json().catch(() => ({}))) as CardapioSettingsResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao salvar tempo de entrega.',
        });
        return;
      }

      const nextPrepTime = sanitizePrepTimeMinutes(data.prepTimeMinutes);
      setPrepTimeMinutes(nextPrepTime);
      setPrepTimeInput(String(nextPrepTime));
      setOperationalMessage({
        tone: 'success',
        text: `Tempo de entrega atualizado para ${nextPrepTime} minutos.`,
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao salvar tempo de entrega.',
      });
    } finally {
      setPrepTimeSaving(false);
    }
  }

  async function saveOrderSequenceStart() {
    if (orderSequenceSaving) return;
    const trimmedValue = orderSequenceInput.trim();
    const parsedSequenceStart = trimmedValue ? Number(trimmedValue) : null;
    if (parsedSequenceStart !== null && (!Number.isInteger(parsedSequenceStart) || parsedSequenceStart < 1)) {
      setOperationalMessage({
        tone: 'error',
        text: 'Informe um numero inteiro maior que zero ou deixe vazio para desativar.',
      });
      return;
    }

    setOrderSequenceSaving(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderSequenceStart: parsedSequenceStart }),
      });
      const data = (await response.json().catch(() => ({}))) as CardapioSettingsResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao salvar sequencia dos pedidos.',
        });
        return;
      }

      const nextValue = data.orderSequenceStart ?? null;
      setOrderSequenceInput(nextValue === null ? '' : String(nextValue));
      setOperationalMessage({
        tone: 'success',
        text: nextValue === null
          ? 'Sequencia por caixa desativada.'
          : `Sequencia por caixa iniciara em ${nextValue}.`,
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao salvar sequencia dos pedidos.',
      });
    } finally {
      setOrderSequenceSaving(false);
    }
  }

  const loadCashStatus = useCallback(async () => {
    setCashLoading(true);
    try {
      const response = await fetch('/api/finance/cash/current', { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as CashCurrentResponse;
      if (response.ok) {
        setCashCurrent(data.current || null);
        if (typeof data.storeOpen === 'boolean') {
          setDeliveryEnabled(data.storeOpen);
        }
      }
    } finally {
      setCashLoading(false);
    }
  }, []);

  async function openCashQuick() {
    if (cashOpening || cashCurrent) return;
    const openingAmount = parseQuickMoney(cashOpeningAmount);
    if (openingAmount < 0) {
      setOperationalMessage({
        tone: 'error',
        text: 'Valor de abertura invalido.',
      });
      return;
    }

    setCashOpening(true);
    setOperationalMessage(null);
    try {
      const response = await fetch('/api/finance/cash/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          openingAmount,
          notes: 'Aberto pela configuracao rapida da tela de pedidos',
        }),
      });
      const data = (await response.json().catch(() => ({}))) as CashCurrentResponse;
      if (!response.ok) {
        setOperationalMessage({
          tone: 'error',
          text: data.error || 'Falha ao abrir caixa.',
        });
        await loadCashStatus();
        return;
      }

      await loadCashStatus();
      setOperationalMessage({
        tone: 'success',
        text: 'Caixa aberto. A sequencia dos pedidos deste caixa esta pronta para uso.',
      });
    } catch {
      setOperationalMessage({
        tone: 'error',
        text: 'Falha ao abrir caixa.',
      });
    } finally {
      setCashOpening(false);
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
    const response = await fetch(`/api/orders/${orderId}/dispatch`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return (await response.json().catch(() => ({}))) as DispatchFallbackResponse;
  }

  async function requestLocalHttpAgent<TResponse>(
    path: string,
    options: RequestInit = {},
    timeoutMs = 1200,
  ) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${FACEBURG_LOCAL_AGENT_URL}${path}`, {
        ...options,
        cache: 'no-store',
        signal: controller.signal,
      });
      const data = (await response.json().catch(() => ({}))) as TResponse & { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `HTTP ${response.status}`);
      }
      return data;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function startLocalHttpWhatsapp() {
    const response = await requestLocalHttpAgent<LocalWhatsappControlResponse>(
      '/api/whatsapp/start',
      { method: 'POST', headers: { 'content-type': 'application/json' } },
      15000,
    );
    const status = String(response.status?.status || 'connecting');
    const currentProbe = localHttpAgentRef.current;
    const nextProbe: LocalHttpAgentProbe = {
      checkedAt: Date.now(),
      available: true,
      whatsappReady: status === 'ready',
      whatsappStatus: status,
      printerName: currentProbe?.printerName || '',
    };
    localHttpAgentRef.current = nextProbe;
    setLocalHttpAgentState(nextProbe);
    setWhatsappSessionStatus(status);
    setWhatsappLastSeenAt(new Date().toISOString());
    return status;
  }

  async function probeLocalHttpAgent(force = false) {
    const cached = localHttpAgentRef.current;
    if (!force && cached && Date.now() - cached.checkedAt < 5000) {
      return cached;
    }

    try {
      const health = await requestLocalHttpAgent<{
        online?: boolean;
        printerName?: string;
        whatsapp?: { status?: string };
      }>('/api/health', {}, 900);
      const next = {
        checkedAt: Date.now(),
        available: Boolean(health.online),
        whatsappReady: String(health.whatsapp?.status || '') === 'ready',
        whatsappStatus: String(health.whatsapp?.status || 'disconnected'),
        printerName: String(health.printerName || ''),
      };
      localHttpAgentRef.current = next;
      setLocalHttpAgentState(next);
      return next;
    } catch {
      const next = {
        checkedAt: Date.now(),
        available: false,
        whatsappReady: false,
        whatsappStatus: 'disconnected',
        printerName: '',
      };
      localHttpAgentRef.current = next;
      setLocalHttpAgentState(next);
      return next;
    }
  }

  async function runLocalPrintJobs(printJobs: LocalPrintJob[]) {
    const desktopBridge = getFaceburgDesktopBridge();
    if (!printJobs.length) throw new Error('Nenhum recibo preparado para impressao.');

    if (desktopBridge?.isDesktopApp && desktopBridge.printDirect) {
      for (const job of printJobs) {
        await desktopBridge.printDirect(job);
      }
      return;
    }

    const localAgent = await probeLocalHttpAgent(true);
    if (!localAgent.available) {
      throw new Error('Agente .NET local nao esta disponivel em 127.0.0.1:9787.');
    }

    for (const job of printJobs) {
      await requestLocalHttpAgent('/api/print', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job),
      }, 12000);
    }
  }

  async function runLocalWhatsappJobs(whatsappJobs: LocalWhatsappJob[]) {
    const desktopBridge = getFaceburgDesktopBridge();
    if (!whatsappJobs.length) throw new Error('Nenhuma mensagem preparada para envio.');

    if (desktopBridge?.isDesktopApp && desktopBridge.sendWhatsAppDirect) {
      for (const job of whatsappJobs) {
        await desktopBridge.sendWhatsAppDirect(job);
      }
      return;
    }

    const localAgent = await probeLocalHttpAgent(true);
    if (!localAgent.available) {
      throw new Error('Agente .NET local nao esta disponivel em 127.0.0.1:9787.');
    }
    if (!localAgent.whatsappReady) {
      throw new Error('WhatsApp do agente .NET ainda nao esta conectado.');
    }

    for (const job of whatsappJobs) {
      await requestLocalHttpAgent('/api/whatsapp/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(job),
      }, 35000);
    }
  }

  async function dispatchLocalOrderJobs(
    orderId: string,
    localDispatch: LocalDispatchPayload | undefined,
    expected: { print?: boolean; whatsapp?: boolean },
    fallbackEvents: {
      print?: 'new_order' | 'status_update' | 'manual_receipt' | Array<'new_order' | 'status_update' | 'manual_receipt'>;
      whatsapp?: 'new_order' | 'status_update';
    } = {},
  ) {
    const printJobs = Array.isArray(localDispatch?.printJobs) ? localDispatch.printJobs : [];
    const whatsappJobs = Array.isArray(localDispatch?.whatsappJobs) ? localDispatch.whatsappJobs : [];
    const dispatchErrors = Array.isArray(localDispatch?.errors) ? localDispatch.errors : [];
    const failures: string[] = [];
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

    const printFallbackEvents = fallbackEvents.print || 'status_update';
    const fallback = await queueOrderDispatchFallback(orderId, {
      printEventType: printFailed && !Array.isArray(printFallbackEvents) ? printFallbackEvents : undefined,
      printEventTypes: printFailed && Array.isArray(printFallbackEvents) ? printFallbackEvents : undefined,
      whatsappEventType: whatsappFailed ? fallbackEvents.whatsapp || 'status_update' : undefined,
    }).catch((error) => ({
      ok: false,
      printQueued: false,
      whatsappQueued: false,
      error: errorMessage(error),
    }) satisfies DispatchFallbackResponse);

    const fallbackOk =
      (!printFailed || Boolean(fallback.printQueued)) &&
      (!whatsappFailed || Boolean(fallback.whatsappQueued));

    setOperationalMessage({
      tone: fallbackOk ? 'warning' : 'error',
      text: fallbackOk
        ? `Envio local falhou em ${failures.join(' e ')}. Deixei na fila do servidor.`
        : `Envio local falhou em ${failures.join(' e ')} e nao consegui deixar na fila.`,
    });
  }

  async function moveOrder(id: string, nextStatus: OrderStatus, cancelReason = '') {
    if (updatingId) return;
    const previousOrder = orders.find((order) => order.id === id);
    if (!previousOrder) return;

    const desktopBridge = getFaceburgDesktopBridge();
    const localHttpAgent = desktopBridge?.isDesktopApp ? null : await probeLocalHttpAgent();
    const canUseLocalPrint =
      nextStatus === 'processing' &&
      printEnabled &&
      Boolean((desktopBridge?.isDesktopApp && desktopBridge.printDirect) || localHttpAgent?.available);
    const canUseLocalWhatsapp =
      nextStatus === 'delivering' &&
      whatsappEnabled &&
      Boolean(
        (
          whatsappSessionStatus === 'ready' &&
          isLocalWhatsappSessionActive(whatsappSessionStatus, whatsappLastSeenAt) &&
          desktopBridge?.isDesktopApp &&
          desktopBridge.sendWhatsAppDirect
        ) ||
        localHttpAgent?.whatsappReady,
      );
    const useLocalPrint = canUseLocalPrint
      ? desktopBridge?.isDesktopApp
        ? await ensureDesktopPrintStarted().catch(() => false)
        : true
      : false;
    const useLocalWhatsapp = canUseLocalWhatsapp;
    const preferLocalDispatch = Boolean(useLocalPrint || useLocalWhatsapp);

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
        body: JSON.stringify({ status: nextStatus, cancelReason, preferLocalDispatch }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        orderSequenceNumber?: number | null;
        localDispatch?: LocalDispatchPayload;
      };
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
                orderSequenceNumber: data.orderSequenceNumber ?? order.orderSequenceNumber,
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
              orderSequenceNumber: data.orderSequenceNumber ?? current.orderSequenceNumber,
              updatedAt,
            }
          : current,
      );
      setError(null);
      if (preferLocalDispatch) {
        await dispatchLocalOrderJobs(id, data.localDispatch, {
          print: Boolean(useLocalPrint),
          whatsapp: Boolean(useLocalWhatsapp),
        });
      }
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

  function resolvePaymentOptionId(paymentMethod: string) {
    const normalizedLabel = paymentMethod.trim().toLowerCase();
    const exactMatch = activePaymentOptions.find((option) => option.label.trim().toLowerCase() === normalizedLabel);
    const detectedType = resolvePaymentMethodTypeFromOptions(paymentMethod, activePaymentOptions);
    return (exactMatch || activePaymentOptions.find((option) => option.methodType === detectedType) || activePaymentOptions[0])?.id || '';
  }

  function beginFinalizedOrderEdit(order: OrderDetail) {
    if (order.status !== 'completed') return;
    setOrderEditItems(
      order.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
    );
    setOrderEditPaymentValue(resolvePaymentOptionId(order.paymentMethod));
    setOrderEditProductQuantity(1);
    setEditingFinalizedOrder(true);
    void loadOrderEditProducts();
  }

  function stopFinalizedOrderEdit() {
    setEditingFinalizedOrder(false);
    setOrderEditItems([]);
    setOrderEditPaymentValue('');
    setOrderEditProductId('');
    setOrderEditProductSearch('');
    setOrderEditProductSearchFocused(false);
    setOrderEditProductQuantity(1);
  }

  async function loadOrderEditProducts() {
    if (orderEditProducts.length || orderEditProductsLoading) return;
    setOrderEditProductsLoading(true);
    try {
      const response = await fetch('/api/pdv/products', { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as {
        products?: Array<{ id: string; name: string; price: number }>;
        error?: string;
      };
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar produtos para edicao.');
        return;
      }
      const products = Array.isArray(data.products)
        ? data.products.map((product) => ({
            id: product.id,
            name: product.name,
            price: Number(product.price || 0),
          }))
        : [];
      setOrderEditProducts(products);
      setOrderEditProductId((current) => current || products[0]?.id || '');
      setOrderEditProductSearch((current) => current || products[0]?.name || '');
    } catch {
      setError('Falha ao carregar produtos para edicao.');
    } finally {
      setOrderEditProductsLoading(false);
    }
  }

  function updateOrderEditQuantity(itemId: string, nextQuantity: number) {
    setOrderEditItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              quantity: Math.min(99, Math.max(1, Math.round(nextQuantity || 1))),
              removed: false,
            }
          : item,
      ),
    );
  }

  function removeOrderEditItem(itemId: string) {
    setOrderEditItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? item.isNew
            ? { ...item, removed: true }
            : { ...item, removed: true }
          : item,
      ),
    );
  }

  function restoreOrderEditItem(itemId: string) {
    setOrderEditItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, removed: false } : item)),
    );
  }

  function addOrderEditProduct() {
    const product = orderEditProducts.find((item) => item.id === orderEditProductId);
    if (!product) {
      setError('Selecione um produto para adicionar.');
      return;
    }
    const quantity = Math.min(99, Math.max(1, Math.round(orderEditProductQuantity || 1)));
    setOrderEditItems((current) => [
      ...current,
      {
        id: `new-${Date.now()}-${product.id}`,
        productId: product.id,
        productName: product.name,
        quantity,
        unitPrice: product.price,
        isNew: true,
      },
    ]);
    setOrderEditProductQuantity(1);
    setError(null);
  }

  function updateOrderEditProductSearch(value: string) {
    setOrderEditProductSearch(value);
    setOrderEditProductSearchFocused(true);
    const normalizedValue = normalizeSearchText(value);
    const exactProduct = orderEditProducts.find((product) => normalizeSearchText(product.name) === normalizedValue);
    setOrderEditProductId(exactProduct?.id || '');
  }

  function selectOrderEditProduct(product: OrderEditProduct) {
    setOrderEditProductId(product.id);
    setOrderEditProductSearch(product.name);
    setOrderEditProductSearchFocused(false);
    setError(null);
  }

  async function saveFinalizedOrderAdjustment() {
    if (!selectedOrderDetail) return;
    if (selectedOrderDetail.status !== 'completed') {
      setError('Somente pedidos finalizados podem usar este ajuste.');
      return;
    }
    if (!orderEditPaymentValue) {
      setError('Selecione a forma de pagamento do pedido ajustado.');
      return;
    }
    const activeItems = orderEditItems.filter((item) => !item.removed);
    if (!activeItems.length) {
      setError('O pedido precisa ter pelo menos um item.');
      return;
    }

    const originalItems = new Map(selectedOrderDetail.items.map((item) => [item.id, item]));
    const updateItems = orderEditItems
      .filter((item) => !item.isNew && !item.removed)
      .map((item) => ({ id: item.id, quantity: item.quantity }));
    const removeItemIds = orderEditItems
      .filter((item) => !item.isNew && item.removed)
      .map((item) => item.id)
      .filter((itemId) => originalItems.has(itemId));
    const addItems = orderEditItems
      .filter((item) => item.isNew && !item.removed)
      .map((item) => ({ productId: item.productId, quantity: item.quantity }));

    setSavingOrderAdjustment(true);
    try {
      const response = await fetch(`/api/orders/${selectedOrderDetail.id}/adjust`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          paymentMethodId: orderEditPaymentValue,
          updateItems,
          removeItemIds,
          addItems,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        order?: OrderDetail & { itemsSummary?: string };
      };
      if (!response.ok || !data.order) {
        setError(data.error || 'Falha ao ajustar pedido finalizado.');
        return;
      }

      const updatedOrder = data.order;
      setSelectedOrderDetail(updatedOrder);
      setOrders((current) =>
        current.map((order) =>
          order.id === updatedOrder.id
            ? {
                ...order,
                total: updatedOrder.total,
                paymentMethod: updatedOrder.paymentMethod,
                itemsSummary: updatedOrder.itemsSummary || order.itemsSummary,
                orderSequenceNumber: updatedOrder.orderSequenceNumber ?? order.orderSequenceNumber,
                status: updatedOrder.status,
                cancelReason: updatedOrder.cancelReason,
                updatedAt: updatedOrder.updatedAt,
              }
            : order,
        ),
      );
      setOperationalMessage({
        tone: 'success',
        text: `Pedido #${updatedOrder.id.slice(0, 8)} ajustado com sucesso.`,
      });
      stopFinalizedOrderEdit();
      setError(null);
    } catch {
      setError('Falha ao ajustar pedido finalizado.');
    } finally {
      setSavingOrderAdjustment(false);
    }
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
    stopFinalizedOrderEdit();
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
      const localHttpAgent = usingDesktopApp ? null : await probeLocalHttpAgent();

      if ((usingDesktopApp && printEnabled && desktopBridge?.printDirect) || localHttpAgent?.available) {
        if (usingDesktopApp) {
          const localPrintActive = isLocalPrintAgentActive(printConnectionStatus, printLastSeenAt);
          await ensureDesktopPrintStarted({
            forceRestart: desktopPrintRunning && !localPrintActive,
          });
        }

        const localResponse = await fetch(`/api/orders/${order.id}/print`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ preferLocalAgent: true }),
        });
        const localData = (await localResponse.json().catch(() => ({}))) as {
          error?: string;
          printJobs?: LocalPrintJob[];
        };

        if (!localResponse.ok) {
          setOperationalMessage({
            tone: 'error',
            text: localData.error || 'Nao foi possivel preparar o recibo local.',
          });
          return;
        }

        try {
          await runLocalPrintJobs(Array.isArray(localData.printJobs) ? localData.printJobs : []);
          setOperationalMessage({
            tone: 'success',
            text: `Recibo do pedido #${order.id.slice(0, 8)} impresso pelo app local.`,
          });
          return;
        } catch (error) {
          const fallback = await queueOrderDispatchFallback(order.id, { printEventType: 'manual_receipt' })
            .catch((fallbackError) => ({
              ok: false,
              printQueued: false,
              whatsappQueued: false,
              error: errorMessage(fallbackError),
            }) satisfies DispatchFallbackResponse);
          setOperationalMessage({
            tone: fallback.printQueued ? 'warning' : 'error',
            text: fallback.printQueued
              ? `Impressao local falhou (${errorMessage(error)}). Recibo ficou na fila do servidor.`
              : `Impressao local falhou (${errorMessage(error)}) e nao consegui deixar na fila.`,
          });
          return;
        }
      }

      const sendPrintRequest = async () => {
        const response = await fetch(`/api/orders/${order.id}/print`, {
          method: 'POST',
        });
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        return { response, data };
      };

      let { response, data } = await sendPrintRequest();

      if (!response.ok && usingDesktopApp && /hub de impressao offline|agente local de impressao offline/i.test(String(data.error || ''))) {
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

  const localHttpAgentAvailable = Boolean(localHttpAgentState?.available);
  const localHttpWhatsappReady = localHttpAgentState?.whatsappStatus === 'ready';
  const whatsappLocalActive =
    localHttpWhatsappReady ||
    isLocalWhatsappSessionActive(whatsappSessionStatus, whatsappLastSeenAt);
  const whatsappNeedsLocalStart = whatsappEnabled && (desktopAppAvailable || localHttpAgentAvailable) && !whatsappLocalActive;
  const whatsappQuickActionLabel = whatsappNeedsLocalStart ? 'Iniciar' : whatsappEnabled ? 'Desligar' : 'Ligar';
  const printLocalActive =
    localHttpAgentAvailable ||
    isLocalPrintAgentActive(printConnectionStatus, printLastSeenAt);

  useEffect(() => {
    if (!quickSettingsOpen) return;
    void loadCashStatus();
  }, [loadCashStatus, quickSettingsOpen]);

  return (
    <DashboardShell overlaySidebar>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gerenciador de Pedidos</h2>
          <p className="text-sm text-slate-500">Pedidos do cardapio e PDV em tempo real.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="btn-secondary flex items-center gap-2"
            type="button"
            onClick={() => {
              setQuickSettingsOpen(true);
              void loadOperationalStatus();
              void loadCashStatus();
            }}
          >
            <Settings className="h-4 w-4" />
            Config rapida
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
            {getWhatsappStatusLabel(whatsappSessionStatus, whatsappLastSeenAt, whatsappEnabled, desktopAppAvailable, localHttpAgentState)}
          </span>
          {localHttpAgentAvailable
            ? ' (127.0.0.1:9787)'
            : whatsappHasAgentKey
              ? ''
              : desktopAppAvailable
                ? ' (primeira conexao deste computador)'
                : ' (abra o agente local neste computador)'}
        </p>
        <p className="mt-1 text-xs text-slate-500">
          Status da impressao:{' '}
          <span className="font-semibold text-slate-700">
            {getPrintStatusLabel(printConnectionStatus, printLastSeenAt, printEnabled, desktopAppAvailable, localHttpAgentState)}
          </span>
          {localHttpAgentAvailable
            ? ' (127.0.0.1:9787)'
            : printHasAgentKey
              ? ''
              : desktopAppAvailable
                ? ' (primeira conexao deste computador)'
                : ' (abra o agente local neste computador)'}
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

      <div
        className={cn(
          'fixed inset-0 z-50 flex justify-end bg-slate-950/35 transition-opacity duration-200 ease-out',
          quickSettingsOpen ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0',
        )}
        aria-hidden={!quickSettingsOpen}
      >
          <button
            type="button"
            className="hidden flex-1 cursor-default md:block"
            aria-label="Fechar configuracao rapida"
            onClick={() => setQuickSettingsOpen(false)}
          />
          <aside
            className={cn(
              'flex h-full w-full max-w-md flex-col border-l border-slate-200 bg-slate-50 shadow-2xl transition-transform duration-200 ease-out',
              quickSettingsOpen ? 'translate-x-0' : 'translate-x-full',
            )}
          >
            <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Painel de pedidos</p>
                <h3 className="mt-1 text-xl font-black text-slate-950">Configuracao rapida</h3>
                <p className="mt-1 text-sm text-slate-500">Ajustes do atendimento sem sair da tela.</p>
              </div>
              <button
                type="button"
                onClick={() => setQuickSettingsOpen(false)}
                className="rounded-xl border border-slate-200 bg-white p-2 text-slate-500 transition hover:bg-slate-100"
                aria-label="Fechar configuracao rapida"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
              <section className="grid grid-cols-2 gap-2 text-xs">
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-400">Som</p>
                  <p className="mt-1 font-black text-slate-900">{sirenEnabled ? getOrderNotificationSoundLabel(orderNotificationSound) : 'OFF'}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-400">WhatsApp</p>
                  <p className={cn('mt-1 font-black', whatsappEnabled ? 'text-emerald-700' : 'text-slate-500')}>
                    {whatsappNeedsLocalStart ? 'Iniciar' : whatsappEnabled ? 'ON' : 'OFF'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-400">Impressora</p>
                  <p className={cn('mt-1 font-black', printEnabled ? 'text-emerald-700' : 'text-slate-500')}>
                    {printEnabled ? 'ON' : 'OFF'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-400">Cozinha</p>
                  <p className={cn('mt-1 font-black', autoAcceptOrders ? 'text-emerald-700' : 'text-slate-500')}>
                    {autoAcceptOrders ? 'Direto' : 'Manual'}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-400">Tempo</p>
                  <p className="mt-1 font-black text-slate-900">{prepTimeMinutes} min</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-3">
                  <p className="text-slate-400">Caixa</p>
                  <p className={cn('mt-1 font-black', cashCurrent ? 'text-emerald-700' : 'text-amber-700')}>
                    {cashCurrent ? 'Aberto' : 'Fechado'}
                  </p>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-700">
                      <ShoppingBag className="h-5 w-5" />
                    </span>
                    <div>
                      <h4 className="font-black text-slate-950">Delivery do cardapio</h4>
                      <p className="text-sm text-slate-500">
                        {deliveryEnabled ? 'Cardapio aceitando pedidos.' : 'Novos pedidos bloqueados.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleDeliveryStatus()}
                    disabled={deliveryUpdating}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-black',
                      deliveryEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
                      deliveryUpdating ? 'cursor-wait opacity-70' : '',
                    )}
                  >
                    {deliveryUpdating ? '...' : deliveryEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setQuickSoundExpanded((current) => !current)}
                    className="flex min-w-0 flex-1 items-start gap-3 text-left"
                    aria-expanded={quickSoundExpanded}
                  >
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-700">
                      {sirenEnabled ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
                    </span>
                    <div className="min-w-0">
                      <h4 className="font-black text-slate-950">Som dos pedidos</h4>
                      <p className="text-sm text-slate-500">
                        {sirenEnabled ? getOrderNotificationSoundLabel(orderNotificationSound) : 'Campainha desligada'}
                      </p>
                    </div>
                    <ChevronDown
                      className={cn(
                        'ml-auto mt-2 h-4 w-4 shrink-0 text-slate-400 transition-transform',
                        quickSoundExpanded ? 'rotate-180' : '',
                      )}
                    />
                  </button>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setQuickSoundExpanded((current) => !current)}
                      className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-black text-slate-500"
                    >
                      {quickSoundExpanded ? 'Recolher' : 'Trocar'}
                    </button>
                    <button
                      type="button"
                      onClick={() => setSirenEnabled((current) => !current)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-black',
                        sirenEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
                      )}
                    >
                      {sirenEnabled ? 'ON' : 'OFF'}
                    </button>
                  </div>
                </div>
                {quickSoundExpanded ? (
                  <div className="mt-4 grid gap-2">
                    {ORDER_NOTIFICATION_SOUND_OPTIONS.map((option) => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={() => void saveOrderNotificationSound(option.id)}
                        disabled={soundSaving}
                        className={cn(
                          'rounded-xl border px-3 py-2 text-left transition',
                          orderNotificationSound === option.id
                            ? 'border-sky-300 bg-sky-50 text-sky-900'
                            : 'border-slate-200 bg-white text-slate-700 hover:border-sky-200',
                          soundSaving ? 'cursor-wait opacity-70' : '',
                        )}
                      >
                        <span className="block text-sm font-black">{option.label}</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                      <MessageCircle className="h-5 w-5" />
                    </span>
                    <div>
                      <h4 className="font-black text-slate-950">WhatsApp automatico</h4>
                      <p className="text-sm text-slate-500">
                        {getWhatsappStatusLabel(whatsappSessionStatus, whatsappLastSeenAt, whatsappEnabled, desktopAppAvailable, localHttpAgentState)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleWhatsappStatus()}
                    disabled={whatsappUpdating}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-black',
                      whatsappEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
                      whatsappUpdating ? 'cursor-wait opacity-70' : '',
                    )}
                  >
                    {whatsappUpdating ? '...' : whatsappQuickActionLabel}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-orange-50 text-orange-700">
                      <Printer className="h-5 w-5" />
                    </span>
                    <div>
                      <h4 className="font-black text-slate-950">Impressora</h4>
                      <p className="text-sm text-slate-500">
                        {printPrinterName || localHttpAgentState?.printerName || getPrintStatusLabel(printConnectionStatus, printLastSeenAt, printEnabled, desktopAppAvailable, localHttpAgentState)}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void togglePrintStatus()}
                    disabled={printUpdating}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-black',
                      printEnabled ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
                      printUpdating ? 'cursor-wait opacity-70' : '',
                    )}
                  >
                    {printUpdating ? '...' : printEnabled ? 'ON' : 'OFF'}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="grid h-10 w-10 place-items-center rounded-xl bg-cyan-50 text-cyan-700">
                      <ShoppingBag className="h-5 w-5" />
                    </span>
                    <div>
                      <h4 className="font-black text-slate-950">Pedido direto na cozinha</h4>
                      <p className="text-sm text-slate-500">
                        {autoAcceptOrders
                          ? 'Cardapio entra direto em preparo.'
                          : 'Cardapio entra primeiro em Novos.'}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void toggleAutoAcceptOrders()}
                    disabled={autoAcceptUpdating}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-black',
                      autoAcceptOrders ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
                      autoAcceptUpdating ? 'cursor-wait opacity-70' : '',
                    )}
                  >
                    {autoAcceptUpdating ? '...' : autoAcceptOrders ? 'ON' : 'OFF'}
                  </button>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                    <Clock className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-black text-slate-950">Tempo de entrega</h4>
                    <p className="text-sm text-slate-500">Usado no contador, cupom e aviso do cliente.</p>
                    <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
                      <label className="relative block">
                        <input
                          value={prepTimeInput}
                          onChange={(event) => setPrepTimeInput(event.target.value.replace(/[^\d]/g, ''))}
                          inputMode="numeric"
                          placeholder="40"
                          className="w-full rounded-xl border border-slate-200 px-3 py-2 pr-12 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-bold text-slate-400">
                          min
                        </span>
                      </label>
                      <button
                        type="button"
                        onClick={() => void savePrepTimeMinutes()}
                        disabled={prepTimeSaving}
                        className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-black text-slate-700 transition hover:border-sky-200 hover:bg-sky-50 disabled:cursor-wait disabled:opacity-70"
                      >
                        {prepTimeSaving ? '...' : 'Salvar'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
                    <Banknote className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-black text-slate-950">Caixa</h4>
                    {cashLoading ? (
                      <p className="text-sm text-slate-500">Consultando caixa...</p>
                    ) : cashCurrent ? (
                      <p className="text-sm text-emerald-700">
                        Aberto desde {new Date(cashCurrent.openedAt).toLocaleString('pt-BR')} com {formatCurrency(cashCurrent.openingAmount)}.
                      </p>
                    ) : (
                      <div className="mt-3 grid gap-3">
                        <label className="block">
                          <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Valor inicial</span>
                          <input
                            value={cashOpeningAmount}
                            onChange={(event) => setCashOpeningAmount(event.target.value)}
                            inputMode="decimal"
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void openCashQuick()}
                          disabled={cashOpening}
                          className="btn-primary"
                        >
                          {cashOpening ? 'Abrindo...' : 'Abrir caixa'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-start gap-3">
                  <span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-50 text-violet-700">
                    <Hash className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h4 className="font-black text-slate-950">Numero inicial dos pedidos</h4>
                    <div className="mt-3 grid gap-3">
                      <input
                        value={orderSequenceInput}
                        onChange={(event) => setOrderSequenceInput(event.target.value.replace(/[^\d]/g, ''))}
                        inputMode="numeric"
                        placeholder="Vazio para desativar"
                        className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100"
                      />
                      <button
                        type="button"
                        onClick={() => void saveOrderSequenceStart()}
                        disabled={orderSequenceSaving}
                        className="btn-secondary"
                      >
                        {orderSequenceSaving ? 'Salvando...' : 'Salvar numero inicial'}
                      </button>
                    </div>
                  </div>
                </div>
              </section>
            </div>

          </aside>
        </div>

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
                        getOrderHeaderClass(order),
                      )}
                    >
                      <span className="text-[11px] font-extrabold uppercase tracking-[0.16em] text-white flex items-center gap-1.5">
                        {order.type === 'delivery' ? <Bike className="w-3.5 h-3.5" /> : <ShoppingBag className="w-3.5 h-3.5" />}
                        {getOrderTypeLabel(order.type)}
                      </span>
                      <div className="flex items-center gap-2">
                        {order.orderSequenceNumber !== null && order.orderSequenceNumber !== undefined ? (
                          <span className="inline-flex min-w-8 items-center justify-center rounded-lg bg-white/95 px-2 py-0.5 text-[13px] font-black text-slate-900 shadow-sm">
                            {order.orderSequenceNumber}
                          </span>
                        ) : null}
                        <span
                          className={cn(
                            'rounded-md px-2 py-0.5 text-[13px] font-mono font-extrabold tracking-tight shadow-sm',
                            getRemainingTimeClass(order, prepTimeMinutes, countdownNowMs),
                          )}
                        >
                          {formatRemainingTime(order, prepTimeMinutes, countdownNowMs)}
                        </span>
                      </div>
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
                              PAYMENT_BADGE_BASE_CLASS,
                              'transition-colors hover:brightness-95',
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
                              PAYMENT_BADGE_BASE_CLASS,
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
                          className={ORDER_CARD_ACTION_BUTTON_CLASS}
                        >
                          Iniciar Preparo
                        </button>
                      ) : null}
                      {order.status === 'processing' && order.type === 'delivery' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'delivering')}
                          disabled={updatingId === order.id}
                          className={ORDER_CARD_ACTION_BUTTON_CLASS}
                        >
                          Saiu p/ Entrega
                        </button>
                      ) : null}
                      {order.status === 'processing' && order.type !== 'delivery' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'completed')}
                          disabled={updatingId === order.id}
                          className={ORDER_CARD_ACTION_BUTTON_CLASS}
                        >
                          Finalizar
                        </button>
                      ) : null}
                      {order.status === 'delivering' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'completed')}
                          disabled={updatingId === order.id}
                          className={ORDER_CARD_ACTION_BUTTON_CLASS}
                        >
                          Finalizar
                        </button>
                      ) : null}
                      {order.status === 'completed' ? (
                        <span className={cn(ORDER_CARD_STATUS_CLASS, 'bg-emerald-50 text-emerald-600')}>
                          Pedido finalizado
                        </span>
                      ) : null}
                      {order.status === 'cancelled' ? (
                        <span className={cn(ORDER_CARD_STATUS_CLASS, 'bg-rose-50 text-rose-600')}>
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
                              {order.status === 'completed' ? 'Ver / editar pedido' : 'Visualizar pedido'}
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
                            {order.status !== 'cancelled' ? (
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
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/50 p-2 sm:p-4">
          <div className="mx-auto my-2 w-full max-w-5xl overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:items-center sm:px-5">
              <div className="min-w-0">
                <p className="truncate text-base font-black text-slate-950">
                  {selectedOrderDetail ? `Pedido #${selectedOrderDetail.id.slice(0, 8)}` : 'Pedido'}
                </p>
                <p className="text-xs text-slate-500">
                  {selectedOrderDetail?.status === 'completed' ? 'Visualizacao e ajuste do pedido finalizado' : 'Visualizacao completa do pedido'}
                </p>
                {selectedOrderDetail?.orderSequenceNumber !== null && selectedOrderDetail?.orderSequenceNumber !== undefined ? (
                  <span className="mt-2 inline-flex min-w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-sm font-black text-slate-900">
                    {selectedOrderDetail.orderSequenceNumber}
                  </span>
                ) : null}
              </div>
              <button
                onClick={() => {
                  setDetailModalOpen(false);
                  setSelectedOrderDetail(null);
                  stopFinalizedOrderEdit();
                }}
                className="p-2 rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>

            {detailLoading || !selectedOrderDetail ? (
              <div className="p-6 text-sm text-slate-500">Carregando pedido...</div>
            ) : (
              <div className="space-y-4 bg-slate-50 p-3 text-sm sm:p-5">
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-lg font-black text-slate-950">
                          {selectedOrderDetail.customerName}
                        </h2>
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide',
                            statusBadgeClass(selectedOrderDetail.status),
                          )}
                        >
                          {formatOrderStatusLabel(selectedOrderDetail.status)}
                        </span>
                      </div>
                      <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                        <p>
                          <strong className="text-slate-700">Telefone:</strong>{' '}
                          {selectedOrderDetail.customerPhone || '-'}
                        </p>
                        <p>
                          <strong className="text-slate-700">Tipo:</strong>{' '}
                          {getOrderTypeLabel(selectedOrderDetail.type)}
                        </p>
                        <p>
                          <strong className="text-slate-700">Data:</strong>{' '}
                          {new Date(selectedOrderDetail.createdAt).toLocaleString('pt-BR')}
                        </p>
                        <p>
                          <strong className="text-slate-700">Pagamento:</strong>{' '}
                          {getPaymentDisplayLabel(selectedOrderDetail.paymentMethod)}
                        </p>
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 lg:min-w-44">
                      <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Total atual</p>
                      <p className="mt-1 text-2xl font-black text-brand-primary">{formatCurrency(selectedOrderDetail.total)}</p>
                    </div>
                  </div>
                  {selectedOrderDetail.status === 'cancelled' ? (
                    <div className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
                      <strong>Motivo cancelamento:</strong> {selectedOrderDetail.cancelReason || 'Sem motivo informado'}
                    </div>
                  ) : null}
                  {selectedOrderDetail.type === 'delivery' ? (
                    <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
                      <strong>Endereco:</strong> {selectedOrderDetail.deliveryAddress || '-'}
                    </div>
                  ) : null}
                </div>

                {selectedOrderDetail.status === 'completed' ? (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="text-sm font-bold text-amber-900">Ajuste de pedido finalizado</p>
                        <p className="text-xs text-amber-700">
                          Troque pagamento, altere quantidades, remova itens ou adicione novos produtos com reflexo no financeiro.
                        </p>
                      </div>
                      {editingFinalizedOrder ? (
                        <button type="button" className="btn-secondary justify-center" onClick={stopFinalizedOrderEdit} disabled={savingOrderAdjustment}>
                          Fechar edicao
                        </button>
                      ) : (
                        <button type="button" className="btn-primary justify-center" onClick={() => beginFinalizedOrderEdit(selectedOrderDetail)}>
                          Editar finalizado
                        </button>
                      )}
                    </div>
                  </div>
                ) : null}

                {editingFinalizedOrder ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                    <section className="space-y-3">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="font-black text-slate-950">Itens do pedido</p>
                            <p className="text-xs text-slate-500">Ajuste quantidades, remova ou restaure itens antes de salvar.</p>
                          </div>
                          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                            {activeOrderEditItemCount} ativo(s)
                          </span>
                        </div>

                        <div className="space-y-2">
                          {orderEditItems.map((item) => (
                            <div
                              key={item.id}
                              className={cn(
                                'rounded-xl border p-3 transition',
                                item.removed ? 'border-rose-200 bg-rose-50/90' : 'border-slate-200 bg-white',
                              )}
                            >
                              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-2">
                                    <p
                                      className={cn(
                                        'min-w-0 font-bold text-slate-950',
                                        item.removed && 'text-rose-700 line-through',
                                      )}
                                    >
                                      {item.productName}
                                    </p>
                                    {item.isNew ? (
                                      <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-emerald-700">
                                        Novo
                                      </span>
                                    ) : null}
                                  </div>
                                  <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                      <p className="text-slate-400">Unitario</p>
                                      <p className="font-bold text-slate-700">{formatCurrency(item.unitPrice)}</p>
                                    </div>
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                      <p className="text-slate-400">Qtd.</p>
                                      <p className="font-bold text-slate-700">{item.quantity}</p>
                                    </div>
                                    <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                                      <p className="text-slate-400">Subtotal</p>
                                      <p className={cn('font-bold text-slate-700', item.removed && 'line-through')}>
                                        {formatCurrency(item.quantity * item.unitPrice)}
                                      </p>
                                    </div>
                                  </div>
                                </div>

                                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                                  {!item.removed ? (
                                    <>
                                      <button
                                        type="button"
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                        onClick={() => updateOrderEditQuantity(item.id, item.quantity - 1)}
                                        disabled={savingOrderAdjustment || item.quantity <= 1}
                                        title="Diminuir quantidade"
                                      >
                                        <Minus className="h-4 w-4" />
                                      </button>
                                      <input
                                        type="number"
                                        min={1}
                                        max={99}
                                        value={item.quantity}
                                        onChange={(event) => updateOrderEditQuantity(item.id, Number(event.target.value))}
                                        className="h-10 w-16 rounded-xl border border-slate-200 text-center text-sm font-black outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                        disabled={savingOrderAdjustment}
                                      />
                                      <button
                                        type="button"
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                                        onClick={() => updateOrderEditQuantity(item.id, item.quantity + 1)}
                                        disabled={savingOrderAdjustment}
                                        title="Aumentar quantidade"
                                      >
                                        <Plus className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                                        onClick={() => removeOrderEditItem(item.id)}
                                        disabled={savingOrderAdjustment}
                                        title="Remover item"
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </>
                                  ) : (
                                    <button
                                      type="button"
                                      className="btn-secondary min-h-10 justify-center"
                                      onClick={() => restoreOrderEditItem(item.id)}
                                      disabled={savingOrderAdjustment}
                                    >
                                      Restaurar
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                          <div>
                            <p className="font-black text-slate-950">Adicionar produto</p>
                            <p className="text-xs text-slate-500">Produto entra como item novo no ajuste.</p>
                          </div>
                          {selectedOrderEditProduct ? (
                            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                              {formatCurrency(selectedOrderEditProduct.price)}
                            </span>
                          ) : null}
                        </div>
                        {orderEditProductsLoading ? (
                          <p className="text-sm text-slate-500">Carregando produtos...</p>
                        ) : orderEditProducts.length ? (
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_96px_auto]">
                            <div className="relative min-w-0">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                              <input
                                type="search"
                                value={orderEditProductSearch}
                                onChange={(event) => updateOrderEditProductSearch(event.target.value)}
                                onFocus={() => setOrderEditProductSearchFocused(true)}
                                onBlur={() => {
                                  window.setTimeout(() => setOrderEditProductSearchFocused(false), 120);
                                }}
                                placeholder="Buscar produto..."
                                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                                disabled={savingOrderAdjustment}
                              />
                              {orderEditProductSearchFocused ? (
                                <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-20 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
                                  {filteredOrderEditProducts.length ? (
                                    filteredOrderEditProducts.map((product) => (
                                      <button
                                        key={product.id}
                                        type="button"
                                        className={cn(
                                          'flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50',
                                          product.id === orderEditProductId && 'bg-sky-50 text-sky-700',
                                        )}
                                        onMouseDown={(event) => {
                                          event.preventDefault();
                                          selectOrderEditProduct(product);
                                        }}
                                      >
                                        <span className="min-w-0 truncate font-semibold">{product.name}</span>
                                        <span className="shrink-0 text-xs font-bold text-slate-500">{formatCurrency(product.price)}</span>
                                      </button>
                                    ))
                                  ) : (
                                    <p className="px-3 py-2 text-sm text-slate-500">Nenhum produto encontrado.</p>
                                  )}
                                </div>
                              ) : null}
                            </div>
                            <input
                              type="number"
                              min={1}
                              max={99}
                              value={orderEditProductQuantity}
                              onChange={(event) => setOrderEditProductQuantity(Math.min(99, Math.max(1, Math.round(Number(event.target.value || 1)))))}
                              className="min-h-11 rounded-xl border border-slate-200 px-3 py-2 text-center text-sm font-black outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
                              disabled={savingOrderAdjustment}
                            />
                            <button type="button" className="btn-secondary min-h-11 justify-center" onClick={addOrderEditProduct} disabled={savingOrderAdjustment || !selectedOrderEditProduct}>
                              <Plus className="h-4 w-4" />
                              Adicionar
                            </button>
                          </div>
                        ) : (
                          <p className="text-sm text-amber-700">Nenhum produto ativo encontrado no PDV.</p>
                        )}
                      </div>
                    </section>

                    <aside className="space-y-3 lg:sticky lg:top-4 lg:self-start">
                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <div className="mb-3 flex items-center gap-2">
                          <CreditCard className="h-4 w-4 text-slate-500" />
                          <p className="font-black text-slate-950">Forma de pagamento</p>
                        </div>
                        {activePaymentOptions.length === 0 ? (
                          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                            Nenhuma forma de pagamento ativa foi encontrada.
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {activePaymentOptions.map((option) => {
                              const selected = orderEditPaymentValue === option.id;
                              return (
                                <button
                                  key={option.id}
                                  type="button"
                                  onClick={() => setOrderEditPaymentValue(option.id)}
                                  disabled={savingOrderAdjustment}
                                  className={cn(
                                    'w-full rounded-xl border p-3 text-left transition disabled:opacity-60',
                                    selected
                                      ? 'border-sky-400 bg-sky-50 ring-2 ring-sky-100'
                                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
                                  )}
                                >
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="font-bold text-slate-950">{option.label}</span>
                                    <span
                                      className={cn(
                                        'shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-black uppercase tracking-wide',
                                        getPaymentMethodBadgeClass(option.label, activePaymentOptions),
                                      )}
                                    >
                                      {getPaymentMethodTypeLabel(option.methodType)}
                                    </span>
                                  </span>
                                  <span className="mt-1 block text-xs text-slate-500">{option.description}</span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>

                      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                        <p className="font-black text-slate-950">Resumo do ajuste</p>
                        <div className="mt-3 space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-500">Total original</span>
                            <strong className="text-slate-900">{formatCurrency(selectedOrderDetail.total)}</strong>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span className="text-slate-500">Novo subtotal</span>
                            <strong className="text-slate-900">{formatCurrency(orderEditSubtotal)}</strong>
                          </div>
                          {Number(selectedOrderDetail.discountAmount || 0) > 0 ? (
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-500">Desconto mantido</span>
                              <strong className="text-rose-600">- {formatCurrency(Number(selectedOrderDetail.discountAmount || 0))}</strong>
                            </div>
                          ) : null}
                          {Number(selectedOrderDetail.surchargeAmount || 0) > 0 ? (
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-500">Acrescimo mantido</span>
                              <strong className="text-slate-700">{formatCurrency(Number(selectedOrderDetail.surchargeAmount || 0))}</strong>
                            </div>
                          ) : null}
                          {Number(selectedOrderDetail.deliveryFeeAmount || 0) > 0 ? (
                            <div className="flex items-center justify-between gap-3 text-xs">
                              <span className="text-slate-500">Entrega mantida</span>
                              <strong className="text-slate-700">{formatCurrency(Number(selectedOrderDetail.deliveryFeeAmount || 0))}</strong>
                            </div>
                          ) : null}
                          <div className="border-t border-slate-200 pt-2">
                            <div className="flex items-center justify-between gap-3">
                              <span className="font-bold text-slate-700">Novo total</span>
                              <strong className="text-xl font-black text-brand-primary">{formatCurrency(orderEditAdjustedTotal)}</strong>
                            </div>
                          </div>
                          <div
                            className={cn(
                              'flex items-center justify-between gap-3 rounded-xl border px-3 py-2',
                              orderEditDifference > 0
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : orderEditDifference < 0
                                  ? 'border-rose-200 bg-rose-50 text-rose-700'
                                  : 'border-slate-200 bg-slate-50 text-slate-600',
                            )}
                          >
                            <span className="font-bold">Diferenca</span>
                            <strong>{formatCurrencyDelta(orderEditDifference)}</strong>
                          </div>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                        <div className="flex gap-2">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <p>Salvar este ajuste altera o financeiro e o caixa deste pedido finalizado.</p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1">
                        <button
                          type="button"
                          className="btn-secondary min-h-11 justify-center"
                          onClick={stopFinalizedOrderEdit}
                          disabled={savingOrderAdjustment}
                        >
                          Cancelar edicao
                        </button>
                        <button
                          type="button"
                          className="btn-primary min-h-11 justify-center"
                          onClick={() => void saveFinalizedOrderAdjustment()}
                          disabled={!canSaveOrderAdjustment}
                        >
                          {savingOrderAdjustment ? 'Salvando ajuste...' : 'Salvar ajuste'}
                        </button>
                      </div>
                      {!canSaveOrderAdjustment && !savingOrderAdjustment ? (
                        <p className="text-xs text-slate-500">
                          Para salvar, mantenha pelo menos um item ativo e selecione uma forma de pagamento.
                        </p>
                      ) : null}
                    </aside>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <p className="font-black text-slate-950">Itens do pedido</p>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">
                          {selectedOrderDetail.items.length} item(ns)
                        </span>
                      </div>
                      <div className="space-y-2">
                        {selectedOrderDetail.items.map((item) => {
                          const notesLines = formatItemNotes(item.notesParsed);
                          return (
                            <div key={item.id} className="rounded-xl border border-slate-200 p-3">
                              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-950">
                                    {item.quantity}x {item.productName}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    Unitario: {formatCurrency(item.unitPrice)} - Subtotal: {formatCurrency(item.quantity * item.unitPrice)}
                                  </p>
                                  {notesLines.length > 0 ? (
                                    <div className="mt-1 space-y-0.5 text-xs text-slate-500">
                                      {notesLines.map((line, index) => (
                                        <p key={`${item.id}-note-${index}`}>{line}</p>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                                <strong className="text-base text-slate-950">{formatCurrency(item.quantity * item.unitPrice)}</strong>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                      <p className="font-bold text-slate-900">Total do pedido</p>
                      <p className="text-xl font-black text-brand-primary">{formatCurrency(selectedOrderDetail.total)}</p>
                    </div>
                  </>
                )}
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
