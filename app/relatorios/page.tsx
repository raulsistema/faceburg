'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { RefreshCw } from 'lucide-react';

type ReportsResponse = {
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
  totals: {
    grossSales: number;
    feeTotal: number;
    deliveryFeeTotal: number;
    netSales: number;
    completedOrders: number;
    cancelledOrders: number;
    avgTicket: number;
  };
  salesByDay: Array<{
    date: string;
    grossSales: number;
    orders: number;
    cancelledOrders: number;
  }>;
  paymentBreakdown: Array<{
    methodName: string;
    orders: number;
    grossSales: number;
    feeTotal: number;
    netSales: number;
  }>;
  typeBreakdown: Array<{
    type: string;
    typeLabel: string;
    orders: number;
    grossSales: number;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    quantity: number;
    revenue: number;
  }>;
};

function brl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function todayInSaoPaulo() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === 'year')?.value || '1970';
  const month = parts.find((part) => part.type === 'month')?.value || '01';
  const day = parts.find((part) => part.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

function shiftDate(dateInput: string, days: number) {
  const date = new Date(`${dateInput}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function formatDate(dateIso: string) {
  return new Date(`${dateIso}T00:00:00`).toLocaleDateString('pt-BR');
}

export default function RelatoriosPage() {
  const today = useMemo(() => todayInSaoPaulo(), []);
  const initialStartDate = useMemo(() => shiftDate(today, -29), [today]);
  const [startDate, setStartDate] = useState(() => initialStartDate);
  const [endDate, setEndDate] = useState(() => today);
  const [appliedStartDate, setAppliedStartDate] = useState(() => initialStartDate);
  const [appliedEndDate, setAppliedEndDate] = useState(() => today);
  const [data, setData] = useState<ReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async (nextStart: string, nextEnd: string, showLoading = false) => {
    if (showLoading) setLoading(true);
    setRefreshing(!showLoading);
    setError(null);
    try {
      const response = await fetch(`/api/reports/summary?startDate=${encodeURIComponent(nextStart)}&endDate=${encodeURIComponent(nextEnd)}`, {
        cache: 'no-store',
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao carregar relatorios.');
        return;
      }
      setData(json as ReportsResponse);
    } catch {
      setError('Falha ao carregar relatorios.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadReports(appliedStartDate, appliedEndDate, true);
  }, [appliedEndDate, appliedStartDate, loadReports]);

  function applyQuickRange(kind: 'today' | '7d' | '30d' | 'month') {
    const end = today;
    let start = end;
    if (kind === '7d') start = shiftDate(end, -6);
    if (kind === '30d') start = shiftDate(end, -29);
    if (kind === 'month') start = `${end.slice(0, 8)}01`;
    setStartDate(start);
    setEndDate(end);
    setAppliedStartDate(start);
    setAppliedEndDate(end);
  }

  async function applyCustomRange() {
    if (!startDate || !endDate) {
      setError('Informe o periodo inicial e final.');
      return;
    }
    if (startDate > endDate) {
      setError('A data inicial nao pode ser maior que a final.');
      return;
    }
    setAppliedStartDate(startDate);
    setAppliedEndDate(endDate);
  }

  const totalOrders = (data?.totals.completedOrders || 0) + (data?.totals.cancelledOrders || 0);

  return (
    <DashboardShell>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Relatorios</h2>
          <p className="text-sm text-slate-500">Analise de vendas, taxas, tipos de pedido e produtos mais vendidos.</p>
        </div>
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          onClick={() => void loadReports(appliedStartDate, appliedEndDate, false)}
          disabled={refreshing}
        >
          <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          Atualizar
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 mb-6">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Data inicial</label>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Data final</label>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            className="rounded-lg bg-brand-primary px-4 py-2 text-sm font-semibold text-white hover:bg-brand-primary/90"
            onClick={() => void applyCustomRange()}
          >
            Aplicar periodo
          </button>
          <div className="flex flex-wrap gap-2 ml-auto">
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => applyQuickRange('today')}>Hoje</button>
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => applyQuickRange('7d')}>7 dias</button>
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => applyQuickRange('30d')}>30 dias</button>
            <button type="button" className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50" onClick={() => applyQuickRange('month')}>Mes atual</button>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-500 mb-4">{error}</p> : null}

      {data ? (
        <p className="text-xs text-slate-500 mb-4">
          Periodo analisado: <strong>{formatDate(data.period.startDate)}</strong> ate <strong>{formatDate(data.period.endDate)}</strong> ({data.period.days} dias)
        </p>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Faturamento bruto</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{loading ? '--' : brl(data?.totals.grossSales || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Taxas</p>
          <p className="text-2xl font-black text-rose-600 mt-1">{loading ? '--' : brl(data?.totals.feeTotal || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Taxa de entrega</p>
          <p className="text-2xl font-black text-sky-600 mt-1">{loading ? '--' : brl(data?.totals.deliveryFeeTotal || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Liquido previsto</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">{loading ? '--' : brl(data?.totals.netSales || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Pedidos validos</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{loading ? '--' : String(data?.totals.completedOrders || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Cancelados</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{loading ? '--' : String(data?.totals.cancelledOrders || 0)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-2xl p-4">
          <p className="text-xs font-semibold text-slate-500 uppercase">Ticket medio</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{loading ? '--' : brl(data?.totals.avgTicket || 0)}</p>
          <p className="text-xs text-slate-500 mt-1">Base: {totalOrders} pedidos no periodo</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <div className="xl:col-span-2 bg-white border border-slate-200 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-bold text-slate-900">Vendas por dia</h3>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2">Dia</th>
                  <th className="text-right px-4 py-2">Pedidos</th>
                  <th className="text-right px-4 py-2">Cancel.</th>
                  <th className="text-right px-4 py-2">Bruto</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">Carregando...</td></tr>
                ) : data && data.salesByDay.length > 0 ? (
                  data.salesByDay.map((day) => (
                    <tr key={day.date} className="border-t border-slate-100">
                      <td className="px-4 py-2">{formatDate(day.date)}</td>
                      <td className="px-4 py-2 text-right">{day.orders}</td>
                      <td className="px-4 py-2 text-right">{day.cancelledOrders}</td>
                      <td className="px-4 py-2 text-right font-semibold">{brl(day.grossSales)}</td>
                    </tr>
                  ))
                ) : (
                  <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">Sem dados no periodo.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Por forma de pagamento</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {loading ? (
                <p className="px-4 py-4 text-sm text-slate-500">Carregando...</p>
              ) : data && data.paymentBreakdown.length > 0 ? (
                data.paymentBreakdown.map((item) => (
                  <div key={item.methodName} className="px-4 py-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold text-slate-900">{item.methodName}</p>
                      <p className="text-xs text-slate-500">{item.orders} pedidos</p>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{brl(item.grossSales)}</p>
                    <p className="text-xs text-slate-500">Taxa: {brl(item.feeTotal)} - Liquido: {brl(item.netSales)}</p>
                  </div>
                ))
              ) : (
                <p className="px-4 py-4 text-sm text-slate-500">Sem dados de pagamentos.</p>
              )}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900">Por tipo de pedido</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {loading ? (
                <p className="px-4 py-4 text-sm text-slate-500">Carregando...</p>
              ) : data && data.typeBreakdown.length > 0 ? (
                data.typeBreakdown.map((item) => (
                  <div key={item.type} className="px-4 py-3 flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{item.typeLabel}</p>
                      <p className="text-xs text-slate-500">{item.orders} pedidos</p>
                    </div>
                    <p className="text-sm font-bold text-slate-900">{brl(item.grossSales)}</p>
                  </div>
                ))
              ) : (
                <p className="px-4 py-4 text-sm text-slate-500">Sem dados por tipo.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-6 bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-bold text-slate-900">Top 10 produtos</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr>
                <th className="text-left px-4 py-2">Produto</th>
                <th className="text-right px-4 py-2">Qtd</th>
                <th className="text-right px-4 py-2">Faturamento</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">Carregando...</td></tr>
              ) : data && data.topProducts.length > 0 ? (
                data.topProducts.map((item) => (
                  <tr key={item.productId} className="border-t border-slate-100">
                    <td className="px-4 py-2 font-medium text-slate-900">{item.productName}</td>
                    <td className="px-4 py-2 text-right">{item.quantity}</td>
                    <td className="px-4 py-2 text-right font-semibold">{brl(item.revenue)}</td>
                  </tr>
                ))
              ) : (
                <tr><td colSpan={3} className="px-4 py-6 text-center text-slate-500">Sem produtos no periodo.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </DashboardShell>
  );
}
