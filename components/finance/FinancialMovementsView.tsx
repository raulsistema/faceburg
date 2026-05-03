'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, CalendarDays, Filter, RotateCcw } from 'lucide-react';

type Summary = {
  totalFees: number;
  grossAmount: number;
  netAmount: number;
  cashImpact: number;
  receivablePending: number;
  totalDiscount: number;
  totalSurcharge: number;
  totalDeliveryFee: number;
};

type Movement = {
  id: string;
  source: 'sale' | 'cash_movement' | 'receivable';
  title: string;
  description: string | null;
  status: string;
  amount: number;
  grossAmount: number;
  discountAmount: number;
  surchargeAmount: number;
  deliveryFeeAmount: number;
  feeAmount: number;
  paymentMethod: string;
  orderId: string | null;
  createdAt: string;
  dueDate: string | null;
};

type Filters = {
  source: string;
  status: string;
  from: string;
  to: string;
};

type MovementsResponse = {
  summary?: Partial<Summary>;
  movements?: Movement[];
  page?: number;
  hasMore?: boolean;
  error?: string;
};

const defaultSummary: Summary = {
  totalFees: 0,
  grossAmount: 0,
  netAmount: 0,
  cashImpact: 0,
  receivablePending: 0,
  totalDiscount: 0,
  totalSurcharge: 0,
  totalDeliveryFee: 0,
};

const defaultFilters: Filters = {
  source: 'all',
  status: 'all',
  from: '',
  to: '',
};

function sourceLabel(source: Movement['source']) {
  if (source === 'sale') return 'Venda';
  if (source === 'cash_movement') return 'Caixa';
  return 'Recebivel';
}

function statusLabel(status: string) {
  if (status === 'completed') return 'Concluida';
  if (status === 'pending') return 'Pendente';
  if (status === 'paid') return 'Pago';
  if (status === 'received') return 'Recebido';
  if (status === 'posted') return 'Lancado';
  return status;
}

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function moneyClass(value: number, positiveClass = 'text-emerald-600') {
  if (value > 0) return positiveClass;
  if (value < 0) return 'text-rose-600';
  return 'text-slate-900';
}

function buildQuery(page: number, filters: Filters) {
  const params = new URLSearchParams({
    page: String(page),
    limit: '30',
  });
  if (filters.source !== 'all') params.set('source', filters.source);
  if (filters.status !== 'all') params.set('status', filters.status);
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  return params.toString();
}

export default function FinancialMovementsView() {
  const [summary, setSummary] = useState<Summary>(defaultSummary);
  const [movements, setMovements] = useState<Movement[]>([]);
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [draftFilters, setDraftFilters] = useState<Filters>(defaultFilters);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const activeFilters = useMemo(
    () => [filters.source !== 'all', filters.status !== 'all', Boolean(filters.from), Boolean(filters.to)].filter(Boolean).length,
    [filters],
  );

  const load = useCallback(async (nextPage = 1, nextFilters: Filters = defaultFilters) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/finance/movements?${buildQuery(nextPage, nextFilters)}`, { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as MovementsResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar movimentacoes.');
        return;
      }
      setSummary({ ...defaultSummary, ...(data.summary || {}) });
      setMovements(Array.isArray(data.movements) ? data.movements : []);
      setPage(Number(data.page || nextPage));
      setHasMore(Boolean(data.hasMore));
    } catch {
      setError('Falha ao carregar movimentacoes.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(1, defaultFilters);
  }, [load]);

  function applyFilters() {
    setFilters(draftFilters);
    void load(1, draftFilters);
  }

  function clearFilters() {
    setDraftFilters(defaultFilters);
    setFilters(defaultFilters);
    void load(1, defaultFilters);
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Movimentacoes</h2>
            <p className="text-sm text-slate-500">
              Livro financeiro com vendas concluidas, caixa, recebiveis, taxas e prazos de recebimento.
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">
            <Filter className="h-4 w-4" aria-hidden="true" />
            {activeFilters ? `${activeFilters} filtro(s)` : 'Sem filtros'}
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-6">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Bruto vendido</p>
          <p className="mt-3 text-2xl font-black text-slate-900">{formatCurrency(summary.grossAmount)}</p>
          <p className="mt-1 text-xs text-slate-500">Subtotal das vendas filtradas.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Liquido vendido</p>
          <p className="mt-3 text-2xl font-black text-emerald-600">{formatCurrency(summary.netAmount)}</p>
          <p className="mt-1 text-xs text-slate-500">Total menos taxas de pagamento.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Taxas</p>
          <p className="mt-3 text-2xl font-black text-rose-600">{formatCurrency(summary.totalFees)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Recebiveis</p>
          <p className="mt-3 text-2xl font-black text-amber-600">{formatCurrency(summary.receivablePending)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Caixa</p>
          <p className={`mt-3 text-2xl font-black ${moneyClass(summary.cashImpact)}`}>{formatCurrency(summary.cashImpact)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Descontos</p>
          <p className="mt-3 text-2xl font-black text-rose-600">{formatCurrency(summary.totalDiscount)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Acrescimos</p>
          <p className="mt-3 text-2xl font-black text-emerald-600">{formatCurrency(summary.totalSurcharge)}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm xl:col-span-2">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Entrega</p>
          <p className="mt-3 text-2xl font-black text-sky-600">{formatCurrency(summary.totalDeliveryFee)}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-4 grid gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto]">
          <label className="text-sm font-semibold text-slate-700">
            Origem
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={draftFilters.source}
              onChange={(event) => setDraftFilters((current) => ({ ...current, source: event.target.value }))}
            >
              <option value="all">Todas</option>
              <option value="sale">Vendas</option>
              <option value="cash_movement">Caixa</option>
              <option value="receivable">Recebiveis</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Status
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={draftFilters.status}
              onChange={(event) => setDraftFilters((current) => ({ ...current, status: event.target.value }))}
            >
              <option value="all">Todos</option>
              <option value="completed">Concluida</option>
              <option value="posted">Lancado</option>
              <option value="pending">Pendente</option>
              <option value="received">Recebido</option>
              <option value="paid">Pago</option>
            </select>
          </label>
          <label className="text-sm font-semibold text-slate-700">
            De
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={draftFilters.from}
              onChange={(event) => setDraftFilters((current) => ({ ...current, from: event.target.value }))}
            />
          </label>
          <label className="text-sm font-semibold text-slate-700">
            Ate
            <input
              type="date"
              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              value={draftFilters.to}
              onChange={(event) => setDraftFilters((current) => ({ ...current, to: event.target.value }))}
            />
          </label>
          <button type="button" className="btn-primary mt-auto inline-flex items-center justify-center gap-2" onClick={applyFilters}>
            <Filter className="h-4 w-4" aria-hidden="true" />
            Filtrar
          </button>
          <button type="button" className="btn-secondary mt-auto inline-flex items-center justify-center gap-2" onClick={clearFilters}>
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Limpar
          </button>
        </div>

        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-slate-900">Livro de movimentacoes</h3>
            <p className="text-xs text-slate-500">Valores financeiros ja consolidados no tenant atual.</p>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Carregando movimentacoes...</p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma movimentacao encontrada.</p>
        ) : (
          <div className="space-y-3">
            {movements.map((movement) => {
              const details = [movement.description || 'Sem descricao', movement.paymentMethod].filter(Boolean).join(' - ');
              return (
                <div key={`${movement.source}-${movement.id}`} className="rounded-2xl border border-slate-200 p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600">
                          <ArrowDownUp className="h-3 w-3" aria-hidden="true" />
                          {sourceLabel(movement.source)}
                        </span>
                        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase text-slate-500">
                          {statusLabel(movement.status)}
                        </span>
                        {movement.orderId ? (
                          <span className="text-xs font-medium text-slate-400">Pedido #{movement.orderId.slice(0, 8)}</span>
                        ) : null}
                      </div>
                      <p className="mt-3 text-sm font-bold text-slate-900">{movement.title}</p>
                      <p className="mt-1 text-sm text-slate-500">{details}</p>
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-400">
                        <CalendarDays className="h-3 w-3" aria-hidden="true" />
                        {new Date(movement.createdAt).toLocaleString('pt-BR')}
                        {movement.dueDate ? ` - Vencimento ${new Date(movement.dueDate).toLocaleDateString('pt-BR')}` : ''}
                      </p>
                    </div>

                    <div className="grid min-w-[260px] grid-cols-2 gap-3 text-sm">
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Valor</p>
                        <p className={`font-bold ${moneyClass(movement.amount, 'text-slate-900')}`}>{formatCurrency(movement.amount)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Taxa</p>
                        <p className={movement.feeAmount > 0 ? 'font-bold text-rose-600' : 'font-bold text-slate-500'}>
                          {formatCurrency(movement.feeAmount)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Entrega</p>
                        <p className={movement.deliveryFeeAmount > 0 ? 'font-bold text-sky-600' : 'font-bold text-slate-500'}>
                          {formatCurrency(movement.deliveryFeeAmount)}
                        </p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Bruto</p>
                        <p className="font-bold text-slate-900">{formatCurrency(movement.grossAmount)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Desc.</p>
                        <p className="font-bold text-rose-600">{formatCurrency(movement.discountAmount)}</p>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-3 py-2">
                        <p className="text-[11px] uppercase tracking-wide text-slate-400">Acresc.</p>
                        <p className="font-bold text-emerald-600">{formatCurrency(movement.surchargeAmount)}</p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" className="btn-secondary" disabled={page <= 1 || loading} onClick={() => void load(page - 1, filters)}>
            Anterior
          </button>
          <span className="text-xs text-slate-500">Pagina {page}</span>
          <button type="button" className="btn-secondary" disabled={!hasMore || loading} onClick={() => void load(page + 1, filters)}>
            Proxima
          </button>
        </div>
      </div>
    </div>
  );
}
