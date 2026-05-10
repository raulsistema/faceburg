'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { Bike, CheckCircle2, Loader2, LockKeyhole, Power, ShieldOff, UserPlus } from 'lucide-react';
import { cn } from '@/lib/utils';

type DriverStatus = 'active' | 'inactive' | 'dismissed';

type DriverStats = {
  today: { count: number; total: number };
  month: { count: number; total: number };
  lifetime: { count: number; total: number };
};

type Driver = {
  id: string;
  name: string;
  phone: string;
  status: DriverStatus;
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  stats: DriverStats;
};

type DriversResponse = {
  ok?: boolean;
  drivers?: Driver[];
  error?: string;
};

const emptyForm = {
  name: '',
  phone: '',
  pin: '',
  status: 'active' as DriverStatus,
};

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function statusLabel(status: DriverStatus) {
  if (status === 'active') return 'Ativo';
  if (status === 'inactive') return 'Desativado';
  return 'Demitido';
}

function statusClasses(status: DriverStatus) {
  if (status === 'active') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'inactive') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-rose-200 bg-rose-50 text-rose-700';
}

function formatDateTime(value: string | null) {
  if (!value) return 'Nunca';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export default function DeliveryDriversAdminClient() {
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const totals = useMemo(() => {
    return drivers.reduce(
      (acc, driver) => {
        acc.active += driver.status === 'active' ? 1 : 0;
        acc.inactive += driver.status === 'inactive' ? 1 : 0;
        acc.dismissed += driver.status === 'dismissed' ? 1 : 0;
        acc.todayDeliveries += driver.stats.today.count;
        return acc;
      },
      { active: 0, inactive: 0, dismissed: 0, todayDeliveries: 0 },
    );
  }, [drivers]);

  async function loadDrivers() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/delivery/drivers', { cache: 'no-store' });
      const data = (await response.json().catch(() => ({}))) as DriversResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar entregadores.');
        return;
      }
      setDrivers(data.drivers || []);
    } catch {
      setError('Falha ao carregar entregadores.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDrivers();
  }, []);

  async function submitDriver(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);

    const payload: Record<string, string> = {
      name: form.name,
      phone: form.phone,
      status: form.status,
    };
    if (!editingId || form.pin.trim()) {
      payload.pin = form.pin;
    }

    try {
      const response = await fetch(editingId ? `/api/delivery/drivers/${editingId}` : '/api/delivery/drivers', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await response.json().catch(() => ({}))) as DriversResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar entregador.');
        return;
      }
      setForm(emptyForm);
      setEditingId(null);
      setMessage(editingId ? 'Entregador atualizado.' : 'Entregador cadastrado.');
      await loadDrivers();
    } catch {
      setError('Falha ao salvar entregador.');
    } finally {
      setSaving(false);
    }
  }

  async function updateStatus(driver: Driver, status: DriverStatus) {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/delivery/drivers/${driver.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    const data = (await response.json().catch(() => ({}))) as DriversResponse;
    if (!response.ok) {
      setError(data.error || 'Falha ao atualizar status.');
      return;
    }
    setMessage('Status atualizado.');
    await loadDrivers();
  }

  function editDriver(driver: Driver) {
    setEditingId(driver.id);
    setForm({
      name: driver.name,
      phone: driver.phone || '',
      pin: '',
      status: driver.status,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.24em] text-sky-600">Equipe de entrega</p>
          <h2 className="text-2xl font-black text-slate-950">Entregadores</h2>
          <p className="text-sm text-slate-500">Cadastro com acesso separado do painel principal.</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 shadow-sm">
          Portal do motoboy: <span className="font-black text-slate-950">/entregador</span>
        </div>
      </div>

      <section className="grid gap-3 md:grid-cols-4">
        <Summary label="Ativos" value={totals.active} tone="emerald" />
        <Summary label="Desativados" value={totals.inactive} tone="amber" />
        <Summary label="Demitidos" value={totals.dismissed} tone="rose" />
        <Summary label="Entregas hoje" value={totals.todayDeliveries} tone="sky" />
      </section>

      <section className="grid gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
        <form onSubmit={submitDriver} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700">
              {editingId ? <Bike className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
            </div>
            <div>
              <h3 className="font-black text-slate-950">{editingId ? 'Editar entregador' : 'Novo entregador'}</h3>
              <p className="text-sm text-slate-500">PIN exclusivo para login.</p>
            </div>
          </div>

          <div className="space-y-3">
            <input
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              placeholder="Nome do entregador"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
              required
            />
            <input
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              placeholder="Telefone"
              value={form.phone}
              onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
            />
            <div className="relative">
              <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                className="h-11 w-full rounded-xl border border-slate-200 pl-10 pr-3 text-sm font-black tracking-[0.2em] outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                placeholder={editingId ? 'Novo PIN opcional' : 'PIN de acesso'}
                value={form.pin}
                onChange={(event) => setForm((prev) => ({ ...prev, pin: event.target.value }))}
                required={!editingId}
                type="password"
                inputMode="numeric"
              />
            </div>
            <select
              className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-bold outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as DriverStatus }))}
            >
              <option value="active">Ativo</option>
              <option value="inactive">Desativado</option>
              <option value="dismissed">Demitido</option>
            </select>
          </div>

          <button
            disabled={saving}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-black text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            {editingId ? 'Salvar alteracoes' : 'Cadastrar entregador'}
          </button>
          {editingId ? (
            <button
              type="button"
              onClick={cancelEdit}
              className="mt-2 h-11 w-full rounded-xl border border-slate-200 text-sm font-black text-slate-700 transition hover:bg-slate-50"
            >
              Cancelar edicao
            </button>
          ) : null}
        </form>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="font-black text-slate-950">Equipe cadastrada</h3>
              <p className="text-sm text-slate-500">Ativo entrega. Desativado so ve taxas. Demitido nao acessa.</p>
            </div>
            <button type="button" onClick={() => void loadDrivers()} className="btn-secondary">
              Atualizar
            </button>
          </div>

          {error ? <p className="mb-3 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">{error}</p> : null}
          {message ? <p className="mb-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">{message}</p> : null}

          {loading ? (
            <div className="flex min-h-48 items-center justify-center text-sm font-bold text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Carregando entregadores...
            </div>
          ) : drivers.length === 0 ? (
            <div className="flex min-h-48 items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50 text-center">
              <div>
                <Bike className="mx-auto mb-2 h-8 w-8 text-slate-400" />
                <p className="font-black text-slate-900">Nenhum entregador cadastrado</p>
                <p className="text-sm text-slate-500">Cadastre o primeiro motoboy para liberar o login.</p>
              </div>
            </div>
          ) : (
            <div className="grid gap-3">
              {drivers.map((driver) => (
                <DriverCard
                  key={driver.id}
                  driver={driver}
                  onEdit={() => editDriver(driver)}
                  onStatus={(status) => void updateStatus(driver, status)}
                />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function Summary({ label, value, tone }: { label: string; value: number; tone: 'emerald' | 'amber' | 'rose' | 'sky' }) {
  const classes = {
    emerald: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    rose: 'bg-rose-50 text-rose-700 border-rose-100',
    sky: 'bg-sky-50 text-sky-700 border-sky-100',
  }[tone];
  return (
    <div className={cn('rounded-2xl border p-4 shadow-sm', classes)}>
      <p className="text-xs font-black uppercase tracking-wide opacity-70">{label}</p>
      <p className="mt-1 text-3xl font-black">{value}</p>
    </div>
  );
}

function DriverCard({
  driver,
  onEdit,
  onStatus,
}: {
  driver: Driver;
  onEdit: () => void;
  onStatus: (status: DriverStatus) => void;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-lg font-black text-slate-950">{driver.name}</h4>
            <span className={cn('rounded-full border px-2.5 py-1 text-[11px] font-black uppercase', statusClasses(driver.status))}>
              {statusLabel(driver.status)}
            </span>
          </div>
          <p className="mt-1 text-sm font-semibold text-slate-500">{driver.phone || 'Telefone nao informado'}</p>
          <p className="text-xs font-semibold text-slate-400">Ultimo login: {formatDateTime(driver.lastLoginAt)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={onEdit} className="btn-secondary">
            Editar
          </button>
          {driver.status !== 'dismissed' && driver.status !== 'active' ? (
            <button type="button" onClick={() => onStatus('active')} className="btn-secondary text-emerald-700">
              <Power className="h-4 w-4" />
              Ativar
            </button>
          ) : null}
          {driver.status !== 'dismissed' && driver.status !== 'inactive' ? (
            <button type="button" onClick={() => onStatus('inactive')} className="btn-secondary text-amber-700">
              <ShieldOff className="h-4 w-4" />
              Desativar
            </button>
          ) : null}
          {driver.status !== 'dismissed' ? (
            <button type="button" onClick={() => onStatus('dismissed')} className="btn-secondary text-rose-700">
              Demitir
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <Metric label="Taxas hoje" count={driver.stats.today.count} total={driver.stats.today.total} />
        <Metric label="Taxas mes" count={driver.stats.month.count} total={driver.stats.month.total} />
        <Metric label="Taxas total" count={driver.stats.lifetime.count} total={driver.stats.lifetime.total} />
      </div>
    </article>
  );
}

function Metric({ label, count, total }: { label: string; count: number; total: number }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-xs font-black uppercase tracking-wide text-slate-400">{label}</p>
      <p className="text-lg font-black text-slate-950">{count} entregas</p>
      <p className="text-sm font-bold text-emerald-700">{formatCurrency(total)}</p>
    </div>
  );
}
