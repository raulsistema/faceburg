import { notFound } from 'next/navigation';
import { Bike, CheckCircle2, Clock3, CookingPot, MapPin, PackageCheck } from 'lucide-react';
import { formatBusinessDateTime } from '@/lib/business-time';
import { getPublicDeliveryTracking } from '@/lib/delivery-tracking';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

function formatDateTime(value: string | null) {
  if (!value) return '';
  return formatBusinessDateTime(value, {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function statusText(status: string) {
  if (status === 'pending') return 'Recebido';
  if (status === 'processing') return 'Em preparo';
  if (status === 'delivering') return 'Saiu para entrega';
  if (status === 'completed') return 'Entregue';
  if (status === 'cancelled') return 'Cancelado';
  return 'Pedido';
}

const stepIcons = {
  received: PackageCheck,
  preparing: CookingPot,
  delivering: Bike,
  completed: CheckCircle2,
};

export default async function TrackingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const tracking = await getPublicDeliveryTracking(token);
  if (!tracking) {
    notFound();
  }

  return (
    <main className="min-h-dvh bg-slate-950 text-white">
      <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-6 sm:px-8">
        <header className="flex items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <p className="text-sm font-semibold text-emerald-300">{tracking.tenantName}</p>
            <h1 className="mt-1 text-2xl font-bold">Pedido #{tracking.orderCode}</h1>
          </div>
          <span className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-sm font-bold text-emerald-200">
            {statusText(tracking.status)}
          </span>
        </header>

        <section className="grid flex-1 gap-4 py-6">
          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
            <p className="text-sm text-slate-300">Ola, {tracking.customerName}</p>
            <h2 className="mt-2 text-3xl font-bold leading-tight">
              {tracking.status === 'completed' ? 'Entrega concluida' : 'Acompanhe sua entrega'}
            </h2>
            <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-300">
              <span className="inline-flex items-center gap-2">
                <Clock3 className="h-4 w-4 text-emerald-300" />
                Atualizado {formatDateTime(tracking.updatedAt)}
              </span>
              {tracking.deliveryStartedAt ? (
                <span className="inline-flex items-center gap-2">
                  <Bike className="h-4 w-4 text-emerald-300" />
                  Saiu {formatDateTime(tracking.deliveryStartedAt)}
                </span>
              ) : null}
            </div>
          </div>

          <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
            <div className="space-y-1">
              {tracking.steps.map((step, index) => {
                const Icon = stepIcons[step.key];
                return (
                  <div key={step.key} className="grid grid-cols-[36px_minmax(0,1fr)] gap-3">
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'flex h-9 w-9 items-center justify-center rounded-full border',
                          step.done && 'border-emerald-300 bg-emerald-300 text-slate-950',
                          step.active && 'border-emerald-300 bg-emerald-300/15 text-emerald-200',
                          !step.done && !step.active && 'border-white/15 bg-white/5 text-slate-500',
                        )}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                      {index < tracking.steps.length - 1 ? (
                        <span className={cn('h-9 w-px', step.done ? 'bg-emerald-300' : 'bg-white/10')} />
                      ) : null}
                    </div>
                    <div className="pb-7 pt-1">
                      <p className={cn('font-bold', step.done || step.active ? 'text-white' : 'text-slate-500')}>
                        {step.label}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {tracking.currentLocation ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.06] p-5">
              <div className="flex items-start gap-3">
                <MapPin className="mt-1 h-5 w-5 text-emerald-300" />
                <div>
                  <p className="font-bold">Localizacao atual</p>
                  <p className="mt-1 font-mono text-sm text-slate-300">
                    {tracking.currentLocation.latitude.toFixed(5)}, {tracking.currentLocation.longitude.toFixed(5)}
                  </p>
                  {tracking.locationUpdatedAt ? (
                    <p className="mt-1 text-sm text-slate-400">Atualizada {formatDateTime(tracking.locationUpdatedAt)}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
