'use client';

import { useMemo, useState } from 'react';
import { Bike, CheckCircle2, Loader2, MapPin, Navigation, Phone, Search, WalletCards } from 'lucide-react';
import { cn } from '@/lib/utils';

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

type ApiOrderResponse = {
  ok?: boolean;
  order?: Partial<DeliveryOrder> & { id: string };
  error?: string;
};

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function statusLabel(status: string) {
  if (status === 'pending') return 'Novo';
  if (status === 'processing') return 'Cozinha';
  if (status === 'delivering') return 'Em entrega';
  if (status === 'completed') return 'Entregue';
  if (status === 'cancelled') return 'Cancelado';
  return status || 'Pedido';
}

function mapsUrl(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export default function DeliveryDriverClient() {
  const [code, setCode] = useState('');
  const [order, setOrder] = useState<DeliveryOrder | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<'start' | 'finish' | null>(null);
  const [message, setMessage] = useState<{ tone: 'success' | 'error' | 'info'; text: string } | null>(null);

  const canStart = order && order.status !== 'delivering' && order.status !== 'completed' && order.status !== 'cancelled';
  const canFinish = order?.status === 'delivering';
  const currentTrackingUrl = useMemo(() => {
    if (!order?.trackingUrl && order?.trackingToken && typeof window !== 'undefined') {
      return `${window.location.origin}/acompanhar/${order.trackingToken}`;
    }
    return order?.trackingUrl || '';
  }, [order?.trackingToken, order?.trackingUrl]);

  async function lookupOrder(event?: React.FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const normalizedCode = code.trim();
    if (!normalizedCode || loading) return;

    setLoading(true);
    setMessage(null);
    try {
      const response = await fetch('/api/delivery/lookup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: normalizedCode }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiOrderResponse;
      if (!response.ok || !data.order) {
        setOrder(null);
        setMessage({ tone: 'error', text: data.error || 'Pedido nao encontrado.' });
        return;
      }
      setOrder(data.order as DeliveryOrder);
      setMessage({ tone: 'success', text: `Pedido #${data.order.code || data.order.id.slice(0, 8).toUpperCase()} localizado.` });
    } catch {
      setMessage({ tone: 'error', text: 'Falha ao consultar o pedido.' });
    } finally {
      setLoading(false);
    }
  }

  async function runDeliveryAction(action: 'start' | 'finish') {
    if (!order || actionLoading) return;

    setActionLoading(action);
    setMessage(null);
    try {
      const response = await fetch(`/api/delivery/orders/${order.id}/${action === 'start' ? 'start' : 'finish'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      const data = (await response.json().catch(() => ({}))) as ApiOrderResponse;
      if (!response.ok || !data.order) {
        setMessage({ tone: 'error', text: data.error || 'Falha ao atualizar entrega.' });
        return;
      }
      setOrder((current) => ({
        ...(current || order),
        ...data.order,
      }) as DeliveryOrder);
      setMessage({
        tone: 'success',
        text: action === 'start' ? 'Entrega iniciada. Cliente avisado.' : 'Entrega finalizada.',
      });
    } catch {
      setMessage({ tone: 'error', text: 'Falha ao atualizar entrega.' });
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
      <section className="grid gap-4 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
              <Bike className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-950">Entregador</h2>
              <p className="text-sm text-slate-500">Operacao rapida por codigo</p>
            </div>
          </div>

          <form className="flex gap-2" onSubmit={lookupOrder}>
            <input
              value={code}
              onChange={(event) => setCode(event.target.value)}
              className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold uppercase outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              placeholder="Codigo do pedido"
              autoCapitalize="characters"
            />
            <button
              type="submit"
              disabled={loading || !code.trim()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-slate-950 text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Buscar pedido"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </button>
          </form>

          {message ? (
            <div
              className={cn(
                'mt-4 rounded-lg border px-3 py-2 text-sm font-medium',
                message.tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-800',
                message.tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-800',
                message.tone === 'info' && 'border-sky-200 bg-sky-50 text-sky-800',
              )}
            >
              {message.text}
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
          {order ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-bold text-slate-400">#{order.code}</p>
                  <h3 className="text-2xl font-bold text-slate-950">{order.customerName}</h3>
                </div>
                <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
                  {statusLabel(order.status)}
                </span>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <Phone className="mt-0.5 h-4 w-4 text-slate-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-400">Telefone</p>
                    <p className="truncate text-sm font-semibold text-slate-900">{order.customerPhone || 'Nao informado'}</p>
                  </div>
                </div>
                <div className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                  <WalletCards className="mt-0.5 h-4 w-4 text-slate-500" />
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-slate-400">Pagamento</p>
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {order.paymentMethod} {order.changeFor > 0 ? `- troco para ${formatCurrency(order.changeFor)}` : ''}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-slate-400">Endereco</p>
                  <p className="text-sm font-semibold text-slate-900">{order.deliveryAddress || 'Nao informado'}</p>
                </div>
              </div>

              {order.items?.length ? (
                <div className="rounded-lg border border-slate-100">
                  {order.items.map((item, index) => (
                    <div key={`${item.productName}-${index}`} className="flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2 last:border-b-0">
                      <div>
                        <p className="text-sm font-bold text-slate-900">{item.quantity}x {item.productName}</p>
                        {item.notes ? <p className="text-xs text-slate-500">{item.notes}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  disabled={!canStart || actionLoading !== null}
                  onClick={() => runDeliveryAction('start')}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-bold text-white transition hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'start' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Navigation className="h-4 w-4" />}
                  Iniciar entrega
                </button>
                <a
                  href={order.deliveryAddress ? mapsUrl(order.deliveryAddress) : undefined}
                  target="_blank"
                  rel="noreferrer"
                  aria-disabled={!order.deliveryAddress}
                  className={cn(
                    'inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 text-sm font-bold text-slate-800 transition hover:bg-slate-50',
                    !order.deliveryAddress && 'pointer-events-none opacity-50',
                  )}
                >
                  <MapPin className="h-4 w-4" />
                  Abrir Maps
                </a>
                <button
                  type="button"
                  disabled={!canFinish || actionLoading !== null}
                  onClick={() => runDeliveryAction('finish')}
                  className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-bold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {actionLoading === 'finish' ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Finalizar
                </button>
              </div>

              {currentTrackingUrl ? (
                <div className="rounded-lg border border-sky-100 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-800">
                  Link do cliente: {currentTrackingUrl}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-6 text-center">
              <div>
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
                  <Search className="h-5 w-5" />
                </div>
                <p className="font-bold text-slate-900">Nenhum pedido selecionado</p>
                <p className="mt-1 text-sm text-slate-500">Busque pelo codigo impresso ou pelo inicio do pedido.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
