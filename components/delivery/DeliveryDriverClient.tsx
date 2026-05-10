'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Bike,
  CalendarDays,
  CheckCircle2,
  Clock,
  Loader2,
  LockKeyhole,
  LogOut,
  MapPin,
  Navigation,
  Phone,
  ReceiptText,
  Search,
  ShieldAlert,
  TrendingUp,
  WalletCards,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type DriverStatus = 'active' | 'inactive' | 'dismissed';

type DeliverySession = {
  tenant: {
    id: string;
    name: string;
    slug: string;
    originAddress?: string;
  };
  driver: {
    id: string;
    name: string;
    status: DriverStatus;
  };
  deviceId: string;
  token: string;
};

type DeliveryStats = {
  today: {
    count: number;
    total: number;
  };
  month: {
    count: number;
    total: number;
  };
  lifetime: {
    count: number;
    total: number;
  };
};

type DeliveryOrder = {
  id: string;
  code: string;
  trackingToken: string;
  trackingUrl: string;
  customerName: string;
  customerPhone: string;
  deliveryAddress: string;
  paymentMethod: string;
  changeFor: number;
  total: number;
  status: string;
  type: string;
  deliveryStartedAt: string | null;
  deliveryFinishedAt: string | null;
  createdAt?: string;
  updatedAt?: string;
  items?: Array<{
    productName: string;
    quantity: number;
    notes: string;
  }>;
};

type AuthResponse = {
  ok?: boolean;
  tenant?: DeliverySession['tenant'];
  driver?: DeliverySession['driver'];
  deviceId?: string;
  token?: string;
  error?: string;
};

type ApiOrderResponse = {
  ok?: boolean;
  order?: Partial<DeliveryOrder> & { id: string };
  error?: string;
};

type StatsResponse = {
  tenant?: DeliverySession['tenant'] | null;
  driver?: DeliverySession['driver'];
  stats?: DeliveryStats;
  error?: string;
};

type DeliveryOrdersResponse = {
  orders?: Array<Pick<DeliveryOrder, 'id' | 'code' | 'status'>>;
  error?: string;
};

type DeliveryHistoryItem = {
  id: string;
  code: string;
  customerName: string;
  deliveryAddress: string;
  total: number;
  deliveryFee: number;
  deliveryStartedAt: string | null;
  deliveryFinishedAt: string | null;
  finishedAt: string;
  durationSeconds: number | null;
};

type DeliveryHistoryResponse = {
  filters?: {
    from: string;
    to: string;
  };
  summary?: {
    count: number;
    totalFees: number;
    averageDurationSeconds: number | null;
  };
  deliveries?: DeliveryHistoryItem[];
  error?: string;
};

type StoredActiveOrder = {
  id: string;
  code: string;
  order?: DeliveryOrder;
  savedAt: number;
};

const DELIVERY_SESSION_KEY = 'faceburg.delivery.session';
const DELIVERY_DEVICE_KEY = 'faceburg.delivery.device';
const DELIVERY_ACTIVE_ORDER_PREFIX = 'faceburg.delivery.activeOrder';

const emptyStats: DeliveryStats = {
  today: { count: 0, total: 0 },
  month: { count: 0, total: 0 },
  lifetime: { count: 0, total: 0 },
};

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function toInputDate(date: Date) {
  const copy = new Date(date);
  copy.setMinutes(copy.getMinutes() - copy.getTimezoneOffset());
  return copy.toISOString().slice(0, 10);
}

function todayInputDate() {
  return toInputDate(new Date());
}

function monthStartInputDate() {
  const now = new Date();
  return toInputDate(new Date(now.getFullYear(), now.getMonth(), 1));
}

function formatDateTime(value: string | null) {
  if (!value) return 'Sem horario';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'Sem horario';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function formatDuration(seconds: number | null) {
  if (seconds === null || !Number.isFinite(seconds)) return 'Sem tempo';
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}min`;
  return `${Math.max(1, minutes)}min`;
}

function statusLabel(status: string) {
  if (status === 'pending') return 'Novo';
  if (status === 'processing') return 'Cozinha';
  if (status === 'delivering') return 'Em entrega';
  if (status === 'completed') return 'Entregue';
  if (status === 'cancelled') return 'Cancelado';
  return status || 'Pedido';
}

function driverStatusLabel(status: DriverStatus) {
  if (status === 'active') return 'Ativo';
  if (status === 'inactive') return 'Desativado';
  return 'Demitido';
}

function cleanMapsDestination(address: string) {
  const raw = address
    .replace(/\s+/g, ' ')
    .replace(/[()]/g, ' ')
    .trim();
  if (!raw) return '';

  const parts = raw
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean);
  const street = parts[0] || raw;
  const area = parts[1] || '';

  if (area) {
    const areaParts = area
      .split(/\s+-\s+/)
      .map((part) => part.trim())
      .filter(Boolean);
    const state = areaParts.at(-1)?.toUpperCase();
    const city = areaParts.at(-2);
    if (city && state && /^[A-Z]{2}$/.test(state)) {
      return `${street}, ${city}, ${state}, Brasil`;
    }
  }

  return raw
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s+-\s*/g, ', ')
    .replace(/,+/g, ',')
    .replace(/\s+,/g, ',')
    .trim();
}

function mapsUrl(address: string, originAddress?: string) {
  const destination = cleanMapsDestination(address);
  const origin = cleanMapsDestination(originAddress || '');
  const params = new URLSearchParams({
    api: '1',
    travelmode: 'driving',
    destination,
  });
  if (origin) {
    params.set('origin', origin);
  }
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function createDeviceId() {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(DELIVERY_DEVICE_KEY);
  if (existing) return existing;
  const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DELIVERY_DEVICE_KEY, next);
  return next;
}

function loadStoredSession() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DELIVERY_SESSION_KEY);
    return raw ? JSON.parse(raw) as DeliverySession : null;
  } catch {
    return null;
  }
}

function storeSession(session: DeliverySession | null) {
  if (typeof window === 'undefined') return;
  if (session) {
    window.localStorage.setItem(DELIVERY_SESSION_KEY, JSON.stringify(session));
  } else {
    window.localStorage.removeItem(DELIVERY_SESSION_KEY);
  }
}

function buildAuthHeaders(currentSession: DeliverySession | null): Record<string, string> {
  return currentSession?.token ? { authorization: `Bearer ${currentSession.token}` } : {};
}

function activeOrderStorageKey(session: DeliverySession) {
  return `${DELIVERY_ACTIVE_ORDER_PREFIX}.${session.tenant.id}.${session.driver.id}`;
}

function isOpenDeliveryOrder(order: Pick<DeliveryOrder, 'status'> | null | undefined) {
  return Boolean(order && order.status !== 'completed' && order.status !== 'cancelled');
}

function loadStoredActiveOrder(session: DeliverySession) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(activeOrderStorageKey(session));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredActiveOrder>;
    if (!parsed.id || !parsed.code) return null;
    return parsed as StoredActiveOrder;
  } catch {
    return null;
  }
}

function storeActiveOrder(session: DeliverySession, order: DeliveryOrder | null) {
  if (typeof window === 'undefined') return;
  const key = activeOrderStorageKey(session);
  if (!order || !isOpenDeliveryOrder(order)) {
    window.localStorage.removeItem(key);
    return;
  }
  const payload: StoredActiveOrder = {
    id: order.id,
    code: order.code,
    order,
    savedAt: Date.now(),
  };
  window.localStorage.setItem(key, JSON.stringify(payload));
}

export default function DeliveryDriverClient() {
  const [session, setSession] = useState<DeliverySession | null>(null);
  const [tenantSlug, setTenantSlug] = useState('');
  const [pin, setPin] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);
  const [stats, setStats] = useState<DeliveryStats>(emptyStats);
  const [statsLoading, setStatsLoading] = useState(false);
  const [historyFrom, setHistoryFrom] = useState(monthStartInputDate);
  const [historyTo, setHistoryTo] = useState(todayInputDate);
  const [history, setHistory] = useState<DeliveryHistoryItem[]>([]);
  const [historySummary, setHistorySummary] = useState<DeliveryHistoryResponse['summary'] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [restoringOrder, setRestoringOrder] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'finish' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const canStart = session?.driver.status === 'active' && order && order.status !== 'delivering' && order.status !== 'completed' && order.status !== 'cancelled';
  const canFinish = session?.driver.status === 'active' && order?.status === 'delivering';
  const inactiveDriver = session?.driver.status === 'inactive';

  const loadStats = useCallback(async (currentSession: DeliverySession | null) => {
    if (!currentSession?.token) return;
    setStatsLoading(true);
    try {
      const response = await fetch('/api/delivery/stats', {
        headers: buildAuthHeaders(currentSession),
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as StatsResponse;
      if (response.status === 401) {
        storeSession(null);
        setSession(null);
        setStats(emptyStats);
        return;
      }
      if (response.ok && data.stats) {
        setStats(data.stats);
        if (data.driver || data.tenant) {
          const nextSession = {
            ...currentSession,
            tenant: {
              ...currentSession.tenant,
              ...(data.tenant || {}),
            },
            driver: {
              ...currentSession.driver,
              ...(data.driver || {}),
            },
          };
          setSession(nextSession);
          storeSession(nextSession);
        }
      }
    } finally {
      setStatsLoading(false);
    }
  }, []);

  const fetchOrderByCode = useCallback(async (currentSession: DeliverySession, lookupCode: string) => {
    const response = await fetch('/api/delivery/lookup', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...buildAuthHeaders(currentSession),
      },
      body: JSON.stringify({ code: lookupCode }),
    });
    const data = (await response.json().catch(() => ({}))) as ApiOrderResponse;
    if (!response.ok || !data.order) {
      return {
        order: null,
        error: data.error || 'Pedido nao encontrado.',
        status: response.status,
      };
    }
    return {
      order: data.order as DeliveryOrder,
      error: '',
      status: response.status,
    };
  }, []);

  const loadHistory = useCallback(async (currentSession: DeliverySession | null, from: string, to: string) => {
    if (!currentSession?.token) return;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const response = await fetch(`/api/delivery/history?${params.toString()}`, {
        headers: buildAuthHeaders(currentSession),
        cache: 'no-store',
      });
      const data = (await response.json().catch(() => ({}))) as DeliveryHistoryResponse;
      if (response.status === 401) {
        storeSession(null);
        setSession(null);
        setHistory([]);
        setHistorySummary(null);
        return;
      }
      if (!response.ok) {
        setHistoryError(data.error || 'Falha ao carregar historico.');
        return;
      }
      setHistory(data.deliveries || []);
      setHistorySummary(data.summary || null);
    } catch {
      setHistoryError('Falha ao carregar historico.');
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  const restoreActiveOrder = useCallback(async (currentSession: DeliverySession) => {
    if (currentSession.driver.status !== 'active') return;

    const stored = loadStoredActiveOrder(currentSession);
    if (stored?.order && isOpenDeliveryOrder(stored.order)) {
      setOrder(stored.order);
      setCode(stored.order.code);
    }

    setRestoringOrder(true);
    try {
      const preferredCode = stored?.code || stored?.order?.code || '';
      let codeToRestore = preferredCode;

      if (!codeToRestore) {
        const response = await fetch('/api/delivery/orders', {
          headers: buildAuthHeaders(currentSession),
          cache: 'no-store',
        });
        const data = (await response.json().catch(() => ({}))) as DeliveryOrdersResponse;
        const active = data.orders?.find((candidate) => candidate.status === 'delivering') || null;
        codeToRestore = active?.code || '';
      }

      if (!codeToRestore) return;

      const result = await fetchOrderByCode(currentSession, codeToRestore);
      if (result.status === 401) {
        storeSession(null);
        storeActiveOrder(currentSession, null);
        setSession(null);
        setOrder(null);
        return;
      }
      if (!result.order || !isOpenDeliveryOrder(result.order)) {
        storeActiveOrder(currentSession, null);
        setOrder(null);
        return;
      }

      setOrder(result.order);
      setCode(result.order.code);
      storeActiveOrder(currentSession, result.order);
      if (result.order.status === 'delivering') {
        setMessage({ tone: 'info', text: `Entrega ${result.order.code} reaberta.` });
      }
    } finally {
      setRestoringOrder(false);
    }
  }, [fetchOrderByCode]);

  useEffect(() => {
    const stored = loadStoredSession();
    if (stored?.token) {
      setSession(stored);
      setTenantSlug(stored.tenant.slug);
      void loadStats(stored);
      void loadHistory(stored, historyFrom, historyTo);
      void restoreActiveOrder(stored);
    } else if (typeof window !== 'undefined') {
      setTenantSlug(window.localStorage.getItem('faceburg.delivery.tenantSlug') || '');
    }
  }, [historyFrom, historyTo, loadHistory, loadStats, restoreActiveOrder]);

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = tenantSlug.trim().toLowerCase();
    const cleanPin = pin.trim();
    if (!slug || cleanPin.length < 4 || loginLoading) return;

    setLoginLoading(true);
    setLoginError(null);
    try {
      const response = await fetch('/api/delivery/auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          tenantSlug: slug,
          pin: cleanPin,
          deviceId: createDeviceId(),
          platform: 'web',
        }),
      });
      const data = (await response.json().catch(() => ({}))) as AuthResponse;
      if (!response.ok || !data.tenant || !data.driver || !data.deviceId || !data.token) {
        setLoginError(data.error || 'Loja ou PIN invalido.');
        return;
      }
      const nextSession: DeliverySession = {
        tenant: data.tenant,
        driver: data.driver,
        deviceId: data.deviceId,
        token: data.token,
      };
      setPin('');
      setSession(nextSession);
      storeSession(nextSession);
      window.localStorage.setItem('faceburg.delivery.tenantSlug', data.tenant.slug);
      await loadStats(nextSession);
      await loadHistory(nextSession, historyFrom, historyTo);
      await restoreActiveOrder(nextSession);
    } catch {
      setLoginError('Falha ao entrar. Confira a conexao e tente de novo.');
    } finally {
      setLoginLoading(false);
    }
  }

  function logout() {
    if (session) {
      storeActiveOrder(session, null);
    }
    storeSession(null);
    setSession(null);
    setOrder(null);
    setStats(emptyStats);
    setHistory([]);
    setHistorySummary(null);
    setHistoryError(null);
    setMessage(null);
  }

  async function lookupOrder(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedCode = code.trim();
    if (!session || !normalizedCode || loading || inactiveDriver) return;

    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchOrderByCode(session, normalizedCode);
      if (!data.order) {
        setOrder(null);
        setMessage({ tone: 'error', text: data.error || 'Pedido nao encontrado.' });
        return;
      }
      setOrder(data.order);
      setCode(data.order.code);
      storeActiveOrder(session, data.order);
      setMessage({ tone: 'success', text: `Pedido ${data.order.code || data.order.id.slice(0, 8).toUpperCase()} localizado.` });
    } catch {
      setMessage({ tone: 'error', text: 'Falha ao consultar o pedido.' });
    } finally {
      setLoading(false);
    }
  }

  async function runDeliveryAction(action: 'start' | 'finish') {
    if (!session || !order || actionLoading || inactiveDriver) return;

    setActionLoading(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/delivery/orders/${order.id}/${action === 'start' ? 'start' : 'finish'}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...buildAuthHeaders(session),
        },
      });
      const data = (await response.json().catch(() => ({}))) as ApiOrderResponse;
      if (!response.ok || !data.order) {
        setMessage({ tone: 'error', text: data.error || 'Falha ao atualizar entrega.' });
        return;
      }
      const nextOrder = ({
        ...order,
        ...data.order,
      }) as DeliveryOrder;
      setOrder(nextOrder);
      if (action === 'finish') {
        storeActiveOrder(session, null);
      } else {
        storeActiveOrder(session, nextOrder);
      }
      setMessage({
        tone: 'success',
        text: action === 'start' ? 'Entrega iniciada. O pedido mudou para saiu para entrega.' : 'Entrega finalizada.',
      });
      await loadStats(session);
      if (action === 'finish') {
        await loadHistory(session, historyFrom, historyTo);
      }
    } catch {
      setMessage({ tone: 'error', text: 'Falha ao atualizar entrega.' });
    } finally {
      setActionLoading(null);
    }
  }

  async function applyHistoryFilter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!session) return;
    await loadHistory(session, historyFrom, historyTo);
  }

  if (!session) {
    return (
      <main className="min-h-dvh bg-slate-950 px-4 py-8 text-slate-950">
        <div className="mx-auto flex min-h-[calc(100dvh-4rem)] w-full max-w-md items-center">
          <form onSubmit={handleLogin} className="w-full rounded-2xl border border-white/10 bg-white p-5 shadow-2xl">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Bike className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-600">Portal do entregador</p>
                <h1 className="text-2xl font-black text-slate-950">Entrar na entrega</h1>
              </div>
            </div>

            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">Loja</label>
            <input
              value={tenantSlug}
              onChange={(event) => setTenantSlug(event.target.value)}
              className="mb-4 h-12 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              placeholder="faceburguer"
              autoCapitalize="none"
              autoComplete="organization"
            />

            <label className="mb-1 block text-xs font-bold uppercase tracking-wide text-slate-500">PIN do entregador</label>
            <input
              value={pin}
              onChange={(event) => setPin(event.target.value)}
              className="h-12 w-full rounded-xl border border-slate-200 px-3 text-lg font-black tracking-[0.32em] outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              placeholder="0000"
              inputMode="numeric"
              type="password"
              autoComplete="one-time-code"
            />

            {loginError ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-700">
                {loginError}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loginLoading || !tenantSlug.trim() || pin.trim().length < 4}
              className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loginLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <LockKeyhole className="h-4 w-4" />}
              Entrar
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-5 text-slate-950 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4">
        <header className="rounded-2xl border border-white/10 bg-white p-4 shadow-2xl sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
                <Bike className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.24em] text-emerald-600">{session.tenant.name}</p>
                <h1 className="truncate text-2xl font-black text-slate-950">{session.driver.name}</h1>
                <p className="mt-0.5 text-sm font-semibold text-slate-500">Portal isolado do entregador</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-black uppercase',
                  session.driver.status === 'active' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
                  session.driver.status === 'inactive' && 'border-amber-200 bg-amber-50 text-amber-700',
                  session.driver.status === 'dismissed' && 'border-rose-200 bg-rose-50 text-rose-700',
                )}
              >
                {driverStatusLabel(session.driver.status)}
              </span>
              <button
                type="button"
                onClick={logout}
                className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Sair
              </button>
            </div>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-3">
          <StatCard icon={CalendarDays} label="Taxas hoje" count={stats.today.count} total={stats.today.total} loading={statsLoading} />
          <StatCard icon={TrendingUp} label="Taxas do mes" count={stats.month.count} total={stats.month.total} loading={statsLoading} />
          <StatCard icon={CheckCircle2} label="Taxas totais" count={stats.lifetime.count} total={stats.lifetime.total} loading={statsLoading} />
        </section>

        {inactiveDriver ? (
          <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-sm">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
              <div>
                <h2 className="text-lg font-black">Acesso desativado</h2>
                <p className="mt-1 text-sm font-semibold">
                  Seu login ainda mostra os totais do periodo trabalhado, mas nao permite pegar pedido, iniciar entrega ou finalizar.
                </p>
              </div>
            </div>
          </section>
        ) : null}

        {!inactiveDriver ? (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,0.78fr)_minmax(0,1.22fr)]">
            <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-2xl">
              <div className="mb-5 flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                  <Search className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-black text-slate-950">Buscar pedido</h2>
                  <p className="text-sm font-semibold text-slate-500">Digite o codigo da entrega</p>
                </div>
              </div>

              <form className="flex gap-2" onSubmit={lookupOrder}>
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  className="h-12 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-sm font-black uppercase outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
                  placeholder="Codigo do pedido"
                  autoCapitalize="characters"
                />
                <button
                  type="submit"
                  disabled={loading || !code.trim()}
                  className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                  aria-label="Buscar pedido"
                >
                  {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                </button>
              </form>

              {message ? (
                <div
                  className={cn(
                    'mt-4 rounded-xl border px-3 py-2 text-sm font-bold',
                    message.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
                    message.tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-800',
                    message.tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-800',
                  )}
                >
                  {message.text}
                </div>
              ) : null}
            </div>

            <OrderPanel
              order={order}
              storeOriginAddress={session.tenant.originAddress || ''}
              canStart={Boolean(canStart)}
              canFinish={Boolean(canFinish)}
              actionLoading={actionLoading}
              restoring={restoringOrder}
              onStart={() => void runDeliveryAction('start')}
              onFinish={() => void runDeliveryAction('finish')}
            />
          </section>
        ) : null}

        <DeliveryHistoryPanel
          dateFrom={historyFrom}
          dateTo={historyTo}
          deliveries={history}
          summary={historySummary}
          loading={historyLoading}
          error={historyError}
          onDateFromChange={setHistoryFrom}
          onDateToChange={setHistoryTo}
          onSubmit={applyHistoryFilter}
        />
      </div>
    </main>
  );
}

function StatCard({
  icon: Icon,
  label,
  count,
  total,
  loading,
}: {
  icon: LucideIcon;
  label: string;
  count: number;
  total: number;
  loading: boolean;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700">
          <Icon className="h-5 w-5" />
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : null}
      </div>
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-black text-slate-950">{count}</p>
      <p className="text-sm font-bold text-emerald-700">{formatCurrency(total)}</p>
    </div>
  );
}

function DeliveryHistoryPanel({
  dateFrom,
  dateTo,
  deliveries,
  summary,
  loading,
  error,
  onDateFromChange,
  onDateToChange,
  onSubmit,
}: {
  dateFrom: string;
  dateTo: string;
  deliveries: DeliveryHistoryItem[];
  summary: DeliveryHistoryResponse['summary'] | null;
  loading: boolean;
  error: string | null;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <section className="rounded-2xl border border-white/10 bg-white p-5 shadow-2xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              <ReceiptText className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-950">Historico de entregas</h2>
              <p className="text-sm font-semibold text-slate-500">Taxas recebidas e tempo gasto por entrega.</p>
            </div>
          </div>
        </div>

        <form className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]" onSubmit={onSubmit}>
          <label className="min-w-0">
            <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-400">Inicio</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(event) => onDateFromChange(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <label className="min-w-0">
            <span className="mb-1 block text-[11px] font-black uppercase tracking-wide text-slate-400">Fim</span>
            <input
              type="date"
              value={dateTo}
              onChange={(event) => onDateToChange(event.target.value)}
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
            />
          </label>
          <button
            type="submit"
            disabled={loading}
            className="mt-auto inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            Filtrar
          </button>
        </form>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <HistorySummaryCard label="Entregas" value={String(summary?.count || 0)} />
        <HistorySummaryCard label="Taxas no periodo" value={formatCurrency(summary?.totalFees || 0)} />
        <HistorySummaryCard label="Tempo medio" value={formatDuration(summary?.averageDurationSeconds ?? null)} />
      </div>

      {error ? (
        <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-100">
        {loading ? (
          <div className="flex min-h-32 items-center justify-center text-sm font-bold text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Carregando historico...
          </div>
        ) : deliveries.length === 0 ? (
          <div className="flex min-h-32 items-center justify-center px-4 text-center">
            <div>
              <Clock className="mx-auto mb-2 h-7 w-7 text-slate-400" />
              <p className="font-black text-slate-900">Nenhuma entrega nesse periodo</p>
              <p className="text-sm font-semibold text-slate-500">Mude as datas para consultar outro intervalo.</p>
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {deliveries.map((delivery) => (
              <article key={delivery.id} className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-black text-slate-400">{delivery.code}</span>
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] font-black text-emerald-700">
                      {formatCurrency(delivery.deliveryFee)}
                    </span>
                  </div>
                  <h3 className="mt-1 truncate text-base font-black text-slate-950">{delivery.customerName}</h3>
                  {delivery.deliveryAddress ? (
                    <p className="mt-0.5 line-clamp-2 text-xs font-semibold text-slate-500">{delivery.deliveryAddress}</p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs font-bold text-slate-500">
                    <span>Inicio: {formatDateTime(delivery.deliveryStartedAt)}</span>
                    <span>Fim: {formatDateTime(delivery.deliveryFinishedAt || delivery.finishedAt)}</span>
                    <span>Pedido: {formatCurrency(delivery.total)}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 lg:min-w-36 lg:flex-col lg:items-end">
                  <span className="text-[11px] font-black uppercase tracking-wide text-slate-400">Tempo</span>
                  <span className="inline-flex items-center gap-1.5 text-lg font-black text-slate-950">
                    <Clock className="h-4 w-4 text-slate-500" />
                    {formatDuration(delivery.durationSeconds)}
                  </span>
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function HistorySummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-slate-50 p-3">
      <p className="text-[11px] font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-lg font-black text-slate-950">{value}</p>
    </div>
  );
}

function OrderPanel({
  order,
  storeOriginAddress,
  canStart,
  canFinish,
  actionLoading,
  restoring,
  onStart,
  onFinish,
}: {
  order: DeliveryOrder | null;
  storeOriginAddress: string;
  canStart: boolean;
  canFinish: boolean;
  actionLoading: 'start' | 'finish' | null;
  restoring: boolean;
  onStart: () => void;
  onFinish: () => void;
}) {
  if (!order) {
    return (
      <div className="flex min-h-[380px] items-center justify-center rounded-2xl border border-white/10 bg-white p-6 text-center shadow-2xl">
        <div>
          <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
            {restoring ? <Loader2 className="h-6 w-6 animate-spin" /> : <Search className="h-6 w-6" />}
          </div>
          <p className="font-black text-slate-950">{restoring ? 'Reabrindo entrega...' : 'Nenhum pedido selecionado'}</p>
          <p className="mt-1 text-sm font-semibold text-slate-500">
            {restoring ? 'Conferindo o pedido ativo do entregador.' : 'Busque pelo codigo impresso ou pelo inicio do pedido.'}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white p-5 shadow-2xl">
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-mono text-sm font-black text-slate-400">{order.code}</p>
            <h3 className="truncate text-2xl font-black text-slate-950">{order.customerName}</h3>
          </div>
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700">
            {statusLabel(order.status)}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <InfoBox icon={Phone} label="Telefone" value={order.customerPhone || 'Nao informado'} />
          <InfoBox
            icon={WalletCards}
            label="Pagamento"
            value={`${order.paymentMethod || 'Nao informado'}${order.changeFor > 0 ? ` - troco para ${formatCurrency(order.changeFor)}` : ''}`}
          />
        </div>

        <InfoBox icon={MapPin} label="Endereco" value={order.deliveryAddress || 'Nao informado'} multiline />

        {order.items?.length ? (
          <div className="overflow-hidden rounded-xl border border-slate-100">
            {order.items.map((item, index) => (
              <div key={`${item.productName}-${index}`} className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                <div>
                  <p className="text-sm font-black text-slate-900">
                    {item.quantity}x {item.productName}
                  </p>
                  {item.notes ? <p className="text-xs font-semibold text-slate-500">{item.notes}</p> : null}
                </div>
              </div>
            ))}
          </div>
        ) : null}

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            disabled={!canStart || actionLoading !== null}
            onClick={onStart}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLoading === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
            Iniciar
          </button>
          <a
            href={order.deliveryAddress ? mapsUrl(order.deliveryAddress, storeOriginAddress) : undefined}
            target="_blank"
            rel="noreferrer"
            aria-disabled={!order.deliveryAddress}
            className={cn(
              'inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50',
              !order.deliveryAddress && 'pointer-events-none opacity-50',
            )}
          >
            <MapPin className="h-4 w-4" />
            Maps
          </a>
          <button
            type="button"
            disabled={!canFinish || actionLoading !== null}
            onClick={onFinish}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-950 px-4 text-sm font-black text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionLoading === 'finish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            Finalizar
          </button>
        </div>
      </div>
    </div>
  );
}

function InfoBox({
  icon: Icon,
  label,
  value,
  multiline = false,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  multiline?: boolean;
}) {
  return (
    <div className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
        <p className={cn('text-sm font-bold text-slate-900', multiline ? '' : 'truncate')}>{value}</p>
      </div>
    </div>
  );
}
