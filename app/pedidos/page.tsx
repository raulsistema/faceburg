'use client';

import dynamic from 'next/dynamic';

const OrdersClient = dynamic(() => import('@/components/orders/OrdersClient'), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-medium text-slate-600 shadow-sm">
        Carregando pedidos...
      </div>
    </main>
  ),
});

export default function PedidosPage() {
  return <OrdersClient />;
}
