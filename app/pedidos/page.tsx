'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { MapPin, ShoppingBag, Printer, RefreshCw, Menu, ChevronDown, Eye, Ban, X } from 'lucide-react';
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
  cancelReason?: string;
  createdAt: string;
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

const columns: { title: string; status: OrderStatus }[] = [
  { title: 'Novos', status: 'pending' },
  { title: 'Cozinha', status: 'processing' },
  { title: 'Entrega', status: 'delivering' },
  { title: 'Concluidos', status: 'completed' },
];

function formatTime(value: string) {
  const date = new Date(value);
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export default function PedidosPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  const [sirenEnabled, setSirenEnabled] = useState(true);
  const seenOrderIdsRef = useRef<Set<string>>(new Set());
  const didBootstrapRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const requestInFlightRef = useRef(false);
  const pendingRefreshRef = useRef(false);

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

  const { refreshNow } = useRealtimeRefresh({ load: loadOrders });

  async function moveOrder(id: string, nextStatus: OrderStatus, cancelReason = '') {
    if (updatingId) return;
    setUpdatingId(id);
    try {
      const response = await fetch(`/api/orders/${id}/status`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: nextStatus, cancelReason }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao atualizar pedido.');
        return;
      }
      setOrders((current) =>
        current.map((order) =>
          order.id === id
            ? {
                ...order,
                status: nextStatus,
                cancelReason: nextStatus === 'cancelled' ? cancelReason : undefined,
              }
            : order,
        ),
      );
      setError(null);
    } catch {
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

  function printOrder(order: Order, detail: OrderDetail | null) {
    setMenuOrderId(null);
    const detailsSource = detail && detail.id === order.id ? detail : null;
    const lines = [
      `Pedido #${order.id.slice(0, 8)}`,
      `Cliente: ${order.customerName}`,
      `Telefone: ${order.customerPhone || '-'}`,
      `Tipo: ${order.type === 'delivery' ? 'Delivery' : order.type === 'pickup' ? 'Balcao' : 'Mesa'}`,
      order.deliveryAddress ? `Endereco: ${order.deliveryAddress}` : '',
      `Data: ${new Date(order.createdAt).toLocaleString('pt-BR')}`,
      '',
      'Itens:',
      ...(detailsSource
        ? detailsSource.items.map((item) => {
            const subtotal = item.quantity * item.unitPrice;
            return `${item.quantity}x ${item.productName} - R$ ${subtotal.toFixed(2)}`;
          })
        : [order.itemsSummary || 'Sem itens']),
      '',
      `Total: R$ ${order.total.toFixed(2)}`,
    ].filter(Boolean);

    const popup = window.open('', '_blank', 'width=420,height=640');
    if (!popup) return;
    popup.document.write(
      `<html><head><title>Pedido ${order.id.slice(0, 8)}</title></head><body style="font-family: Arial, sans-serif; padding: 16px; white-space: pre-wrap;">${lines.join('\n')}</body></html>`,
    );
    popup.document.close();
    popup.focus();
    popup.print();
  }

  async function handleDropInColumn(targetStatus: OrderStatus) {
    if (!draggingOrderId) return;
    const draggedOrder = orders.find((order) => order.id === draggingOrderId);
    setDragOverStatus(null);
    setDraggingOrderId(null);
    if (!draggedOrder) return;
    if (draggedOrder.status === targetStatus) return;
    if (targetStatus === 'cancelled') return;
    await moveOrder(draggingOrderId, targetStatus);
  }

  const ordersForColumn = useMemo(() => {
    return (status: OrderStatus) =>
      orders.filter((order) => {
        if (status === 'completed') {
          return order.status === 'completed' || order.status === 'cancelled';
        }
        return order.status === status;
      });
  }, [orders]);

  return (
    <DashboardShell>
      <div className="flex justify-between items-center mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Gerenciador de Pedidos</h2>
          <p className="text-sm text-slate-500">Pedidos do cardapio e PDV em tempo real.</p>
        </div>
        <div className="flex gap-2">
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
          <button className="btn-secondary flex items-center gap-2" type="button">
            <Printer className="w-4 h-4" />
            Imprimir Comandas
          </button>
          <button className="btn-secondary flex items-center gap-2" type="button" onClick={() => refreshNow(true, true)}>
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>
      </div>

      {error ? <p className="text-sm text-red-500 mb-4">{error}</p> : null}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {columns.map((column) => (
          <div key={column.status} className="flex flex-col gap-3">
            <div className="column-header">
              <span>{column.title}</span>
              <span className="bg-slate-300 px-2 py-0.5 rounded-full text-[10px] font-bold text-white">
                {ordersForColumn(column.status)
                  .length.toString()
                  .padStart(2, '0')}
              </span>
            </div>

            <div
              className={cn(
                'kanban-column transition-colors',
                dragOverStatus === column.status ? 'bg-blue-50/80 ring-1 ring-blue-200' : '',
              )}
              onDragOver={(event) => {
                event.preventDefault();
                if (!draggingOrderId) return;
                if (dragOverStatus !== column.status) {
                  setDragOverStatus(column.status);
                }
              }}
              onDragLeave={() => {
                if (dragOverStatus === column.status) {
                  setDragOverStatus(null);
                }
              }}
              onDrop={(event) => {
                event.preventDefault();
                void handleDropInColumn(column.status);
              }}
            >
              {loading ? <p className="text-xs text-slate-500 px-2">Carregando...</p> : null}
              {ordersForColumn(column.status)
                .map((order) => (
                  <div
                    key={order.id}
                    draggable={updatingId !== order.id}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = 'move';
                      setDraggingOrderId(order.id);
                    }}
                    onDragEnd={() => {
                      setDraggingOrderId(null);
                      setDragOverStatus(null);
                    }}
                    className={cn(
                      'card-order group relative cursor-grab active:cursor-grabbing',
                      draggingOrderId === order.id ? 'opacity-60' : '',
                      order.status === 'processing'
                        ? 'border-l-orange-500'
                        : order.status === 'delivering'
                          ? 'border-l-emerald-500'
                          : order.status === 'completed'
                            ? 'border-l-slate-400'
                            : 'border-l-blue-500',
                    )}
                  >
                    <div className="flex justify-between items-center mb-3">
                      <span
                        className={cn(
                          'text-[9px] font-extrabold uppercase px-2 py-0.5 rounded',
                          order.type === 'delivery' ? 'bg-red-600 text-white' : 'bg-blue-600 text-white',
                        )}
                      >
                        {order.type === 'delivery' ? 'Delivery' : order.type === 'pickup' ? 'Balcao' : 'Mesa'} #{order.id.slice(0, 8)}
                      </span>
                      <span className="text-[10px] font-mono font-bold text-red-500">{formatTime(order.createdAt)}</span>
                    </div>

                    <h4 className="font-bold text-slate-900 text-sm mb-1">{order.customerName}</h4>
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
                      <span className="text-xs font-bold text-brand-primary">R$ {order.total.toFixed(2)}</span>
                      <div className="flex items-center gap-2">
                        {order.type === 'delivery' ? (
                          <MapPin className="w-3 h-3 text-orange-500" />
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
                          className="flex-1 bg-blue-50 text-blue-600 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-blue-100 transition-colors disabled:opacity-50"
                        >
                          Iniciar Preparo
                        </button>
                      ) : null}
                      {order.status === 'processing' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'delivering')}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-orange-50 text-orange-600 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-orange-100 transition-colors disabled:opacity-50"
                        >
                          Saiu p/ Entrega
                        </button>
                      ) : null}
                      {order.status === 'delivering' ? (
                        <button
                          onClick={() => void moveOrder(order.id, 'completed')}
                          disabled={updatingId === order.id}
                          className="flex-1 bg-green-50 text-green-600 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider hover:bg-green-100 transition-colors disabled:opacity-50"
                        >
                          Finalizar
                        </button>
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
                            className="absolute right-0 bottom-full mb-2 w-44 rounded-xl border border-slate-200 bg-white shadow-lg z-20 overflow-hidden"
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
                              onClick={() => printOrder(order, selectedOrderDetail)}
                              className="w-full px-3 py-2 text-left text-xs font-semibold text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                            >
                              <Printer className="w-3.5 h-3.5" />
                              Imprimir pedido
                            </button>
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

              {!loading && ordersForColumn(column.status).length === 0 ? (
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
                  <p><strong>Status:</strong> {selectedOrderDetail.status === 'cancelled' ? 'cancelado' : selectedOrderDetail.status}</p>
                  {selectedOrderDetail.status === 'cancelled' ? (
                    <p className="md:col-span-2"><strong>Motivo cancelamento:</strong> {selectedOrderDetail.cancelReason || 'Sem motivo informado'}</p>
                  ) : null}
                  <p><strong>Pagamento:</strong> {selectedOrderDetail.paymentMethod || 'pix'}</p>
                  <p><strong>Data:</strong> {new Date(selectedOrderDetail.createdAt).toLocaleString('pt-BR')}</p>
                  {selectedOrderDetail.type === 'delivery' ? (
                    <p className="md:col-span-2">
                      <strong>Endereco:</strong> {selectedOrderDetail.deliveryAddress || '-'}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <p className="font-semibold text-slate-900">Itens do pedido</p>
                  {selectedOrderDetail.items.map((item) => (
                    <div key={item.id} className="rounded-lg border border-slate-200 p-3">
                      <p className="font-semibold text-slate-900">
                        {item.quantity}x {item.productName}
                      </p>
                      <p className="text-xs text-slate-500">
                        Unitario: R$ {item.unitPrice.toFixed(2)} • Subtotal: R$ {(item.quantity * item.unitPrice).toFixed(2)}
                      </p>
                      {item.notesRaw ? (
                        <p className="text-xs text-slate-500 mt-1">
                          Obs/Config: {typeof item.notesParsed === 'string' ? item.notesParsed : JSON.stringify(item.notesParsed)}
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>

                <div className="border-t border-slate-200 pt-3 flex items-center justify-between">
                  <p className="font-bold text-slate-900">Total do pedido</p>
                  <p className="font-black text-lg text-brand-primary">R$ {selectedOrderDetail.total.toFixed(2)}</p>
                </div>
              </div>
            )}
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
    </DashboardShell>
  );
}
