'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { Clock, RefreshCw, ShoppingBag, TrendingUp } from 'lucide-react';
import { useRealtimeRefresh } from '@/hooks/use-realtime-refresh';

type DashboardResponse = {
  stats: {
    salesToday: number;
    ordersToday: number;
    pendingOrders: number;
    avgTicketToday: number;
    avgDeliveryMinutes: number | null;
  };
  recentSales: Array<{
    id: string;
    customerName: string;
    total: number;
    status: string;
    type: string;
    createdAt: string;
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

function statusLabel(status: string) {
  if (status === 'pending') return 'Novo';
  if (status === 'processing') return 'Cozinha';
  if (status === 'delivering') return 'Entrega';
  if (status === 'completed') return 'Concluido';
  if (status === 'cancelled') return 'Cancelado';
  return status;
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);

  const loadDashboard = useCallback(async (showLoader = false) => {
    if (requestInFlightRef.current) {
      pendingRefreshRef.current = true;
      return false;
    }
    requestInFlightRef.current = true;
    if (showLoader) setLoading(true);
    let succeeded = false;
    try {
      const response = await fetch('/api/dashboard/summary', {
        cache: 'no-store',
        headers: {
          'cache-control': 'no-cache',
        },
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao carregar dashboard.');
        return false;
      }
      setData(json as DashboardResponse);
      setError(null);
      succeeded = true;
    } catch {
      setError('Falha ao carregar dashboard.');
    } finally {
      requestInFlightRef.current = false;
      if (showLoader) setLoading(false);
      if (pendingRefreshRef.current) {
        pendingRefreshRef.current = false;
        void loadDashboard(false);
      }
    }
    return succeeded;
  }, []);

  const { refreshNow } = useRealtimeRefresh({ load: loadDashboard, fallbackRefreshMs: 0 });

  const stats = useMemo(
    () => [
      {
        name: 'Vendas Hoje',
        value: data ? brl(data.stats.salesToday) : '--',
        icon: ShoppingBag,
        helper: data ? `${data.stats.ordersToday} pedidos hoje` : 'Carregando...',
      },
      {
        name: 'Novos Pedidos',
        value: data ? String(data.stats.pendingOrders) : '--',
        icon: ShoppingBag,
        helper: 'Pedidos aguardando atendimento',
      },
      {
        name: 'Ticket Medio',
        value: data ? brl(data.stats.avgTicketToday) : '--',
        icon: TrendingUp,
        helper: 'Media por pedido do dia',
      },
      {
        name: 'Tempo Medio Entrega',
        value: data?.stats.avgDeliveryMinutes != null ? `${data.stats.avgDeliveryMinutes} min` : '--',
        icon: Clock,
        helper: 'Baseado em pedidos em entrega/concluidos',
      },
    ],
    [data],
  );

  return (
    <DashboardShell>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Dashboard</h2>
          <p className="text-sm text-slate-500">Resumo da operacao em tempo real.</p>
        </div>
        <button className="btn-secondary flex items-center gap-2" type="button" onClick={() => refreshNow(true, true)}>
          <RefreshCw className="w-4 h-4" />
          Atualizar
        </button>
      </div>

      {error ? <p className="text-sm text-red-500 mb-4">{error}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.name} className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm relative overflow-hidden group">
            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 -mr-8 -mt-8 rounded-full transition-all group-hover:scale-110" />
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm font-medium text-slate-500 mb-1">{stat.name}</p>
                <h3 className="text-2xl font-bold text-slate-900">{loading && !data ? '--' : stat.value}</h3>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg text-slate-600">
                <stat.icon className="w-5 h-5" />
              </div>
            </div>
            <div className="mt-4">
              <span className="text-[10px] text-slate-400 font-semibold uppercase tracking-wider">{stat.helper}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Vendas Recentes</h3>
          </div>
          {loading && !data ? (
            <div className="p-10 text-center text-slate-500 text-sm">Carregando vendas...</div>
          ) : data && data.recentSales.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {data.recentSales.map((sale) => (
                <div key={sale.id} className="px-6 py-4 flex items-center justify-between gap-4">
                  <div>
                    <p className="font-semibold text-slate-900">{sale.customerName}</p>
                    <p className="text-xs text-slate-500">
                      #{sale.id.slice(0, 8)} - {statusLabel(sale.status)} - {sale.type === 'delivery' ? 'Delivery' : sale.type === 'pickup' ? 'Balcao' : 'Mesa'}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-slate-900">{brl(sale.total)}</p>
                    <p className="text-xs text-slate-500">
                      {new Date(sale.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-10 text-center text-slate-500 text-sm">Nenhuma venda registrada ainda.</div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
          <div className="p-6 border-b border-slate-100">
            <h3 className="font-bold text-slate-900">Produtos Mais Vendidos Hoje</h3>
          </div>
          {loading && !data ? (
            <div className="flex-1 p-10 text-center text-slate-500 text-sm">Carregando ranking...</div>
          ) : data && data.topProducts.length > 0 ? (
            <div className="divide-y divide-slate-100">
              {data.topProducts.map((product, index) => (
                <div key={product.productId} className="px-6 py-3 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      {index + 1}. {product.productName}
                    </p>
                    <p className="text-xs text-slate-500">{product.quantity} unidade(s)</p>
                  </div>
                  <p className="text-sm font-bold text-slate-900">{brl(product.revenue)}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex-1 p-10 text-center text-slate-500 text-sm">Sem produtos vendidos hoje.</div>
          )}
          <div className="p-6 bg-slate-50 mt-auto border-t border-slate-100">
            <p className="text-xs text-slate-500 italic text-center">Atualizacao automatica por evento, com sincronizacao de seguranca.</p>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}

