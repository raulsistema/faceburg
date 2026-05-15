'use client';

import { FormEvent, useEffect, useState } from 'react';
import { ChevronDown, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';

type MenuOpenMode = 'manual' | 'schedule';

type MenuHoursDay = {
  enabled: boolean;
  open: string;
  close: string;
};

type MenuHoursConfig = {
  days: Record<string, MenuHoursDay>;
};

type MenuHoursSettingsData = {
  storeOpen: boolean;
  effectiveStoreOpen?: boolean;
  menuOpenMode?: MenuOpenMode;
  menuHours?: MenuHoursConfig;
};

const DAYS = [
  { key: '0', label: 'Domingo' },
  { key: '1', label: 'Segunda' },
  { key: '2', label: 'Terca' },
  { key: '3', label: 'Quarta' },
  { key: '4', label: 'Quinta' },
  { key: '5', label: 'Sexta' },
  { key: '6', label: 'Sabado' },
];

function defaultMenuHours(): MenuHoursConfig {
  return {
    days: DAYS.reduce<Record<string, MenuHoursDay>>((acc, day) => {
      acc[day.key] = { enabled: true, open: '18:00', close: '00:00' };
      return acc;
    }, {}),
  };
}

function normalizeMode(value: unknown): MenuOpenMode {
  return value === 'schedule' ? 'schedule' : 'manual';
}

function normalizeTime(value: unknown, fallback: string) {
  const raw = String(value ?? '').trim();
  return /^\d{2}:\d{2}$/.test(raw) ? raw : fallback;
}

function normalizeMenuHours(value?: MenuHoursConfig | null): MenuHoursConfig {
  const fallback = defaultMenuHours();
  const days = value?.days || {};
  return {
    days: DAYS.reduce<Record<string, MenuHoursDay>>((acc, day) => {
      const current = days[day.key] || fallback.days[day.key];
      acc[day.key] = {
        enabled: typeof current.enabled === 'boolean' ? current.enabled : true,
        open: normalizeTime(current.open, fallback.days[day.key].open),
        close: normalizeTime(current.close, fallback.days[day.key].close),
      };
      return acc;
    }, {}),
  };
}

function modeLabel(mode: MenuOpenMode) {
  return mode === 'schedule' ? 'Segue horarios' : 'Manual';
}

export default function MenuHoursSettings({ initialData }: { initialData?: MenuHoursSettingsData | null }) {
  const [storeOpen, setStoreOpen] = useState(Boolean(initialData?.storeOpen));
  const [effectiveStoreOpen, setEffectiveStoreOpen] = useState(Boolean(initialData?.effectiveStoreOpen ?? initialData?.storeOpen));
  const [menuOpenMode, setMenuOpenMode] = useState<MenuOpenMode>(() => normalizeMode(initialData?.menuOpenMode));
  const [menuHours, setMenuHours] = useState<MenuHoursConfig>(() => normalizeMenuHours(initialData?.menuHours));
  const [expanded, setExpanded] = useState(false);
  const [bulkOpen, setBulkOpen] = useState('18:00');
  const [bulkClose, setBulkClose] = useState('00:00');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialData) return;
    setStoreOpen(Boolean(initialData.storeOpen));
    setEffectiveStoreOpen(Boolean(initialData.effectiveStoreOpen ?? initialData.storeOpen));
    setMenuOpenMode(normalizeMode(initialData.menuOpenMode));
    setMenuHours(normalizeMenuHours(initialData.menuHours));
  }, [initialData]);

  function updateDay(dayKey: string, patch: Partial<MenuHoursDay>) {
    setMenuHours((current) => ({
      days: {
        ...current.days,
        [dayKey]: {
          ...current.days[dayKey],
          ...patch,
        },
      },
    }));
  }

  function applyBulkHours() {
    setMenuHours((current) => ({
      days: DAYS.reduce<Record<string, MenuHoursDay>>((acc, day) => {
        acc[day.key] = {
          ...current.days[day.key],
          enabled: true,
          open: bulkOpen,
          close: bulkClose,
        };
        return acc;
      }, {}),
    }));
    setMessage('Horario aplicado em todos os dias.');
    setError('');
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          storeOpen,
          menuOpenMode,
          menuHours,
        }),
      });
      const data = (await response.json().catch(() => ({}))) as MenuHoursSettingsData & { error?: string };
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar funcionamento do cardapio.');
        return;
      }
      setStoreOpen(Boolean(data.storeOpen));
      setEffectiveStoreOpen(Boolean(data.effectiveStoreOpen ?? data.storeOpen));
      setMenuOpenMode(normalizeMode(data.menuOpenMode));
      setMenuHours(normalizeMenuHours(data.menuHours));
      setMessage(
        normalizeMode(data.menuOpenMode) === 'manual'
          ? 'Cardapio salvo em modo manual.'
          : 'Cardapio salvo para seguir os horarios de funcionamento.',
      );
      setExpanded(false);
    } catch {
      setError('Falha ao salvar funcionamento do cardapio.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="p-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0">
            <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Funcionamento do cardapio</h3>
            <p className="mt-2 text-sm text-slate-500">
              Escolha se o cardapio abre manualmente ou se aceita pedidos somente dentro do horario.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
                {modeLabel(menuOpenMode)}
              </span>
              <span className={cn(
                'rounded-full border px-3 py-1 text-xs font-black',
                storeOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-500',
              )}>
                Cardapio {storeOpen ? 'ligado' : 'desligado'}
              </span>
              <span
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-black',
                  effectiveStoreOpen ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-rose-200 bg-rose-50 text-rose-700',
                )}
              >
                {effectiveStoreOpen ? 'Aceitando pedidos agora' : 'Fechado agora'}
              </span>
            </div>
            {message ? <p className="mt-3 text-sm font-semibold text-emerald-700">{message}</p> : null}
            {error ? <p className="mt-3 text-sm font-semibold text-rose-600">{error}</p> : null}
          </div>

          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 text-sm font-black text-slate-800 transition hover:bg-slate-50"
          >
            {expanded ? null : <Pencil className="h-4 w-4" />}
            {expanded ? 'Recolher' : 'Editar funcionamento'}
            <ChevronDown className={cn('h-4 w-4 transition-transform', expanded ? 'rotate-180' : '')} />
          </button>
        </div>
      </div>

      <form onSubmit={save} className={cn('space-y-5 border-t border-slate-100 p-6', expanded ? 'block' : 'hidden')}>
        <div className="grid gap-3 md:grid-cols-2">
          <button
            type="button"
            onClick={() => setMenuOpenMode('manual')}
            className={cn(
              'rounded-xl border p-4 text-left transition',
              menuOpenMode === 'manual' ? 'border-sky-300 bg-sky-50 text-sky-950' : 'border-slate-200 bg-white text-slate-700',
            )}
          >
            <span className="block font-black">Manual</span>
            <span className="mt-1 block text-sm text-slate-500">Usa o botao de ligar/desligar cardapio.</span>
          </button>
          <button
            type="button"
            onClick={() => setMenuOpenMode('schedule')}
            className={cn(
              'rounded-xl border p-4 text-left transition',
              menuOpenMode === 'schedule' ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : 'border-slate-200 bg-white text-slate-700',
            )}
          >
            <span className="block font-black">Seguir horarios</span>
            <span className="mt-1 block text-sm text-slate-500">Bloqueia novos pedidos fora do horario configurado.</span>
          </button>
        </div>

        <label className="flex items-center justify-between gap-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold text-slate-800">
          <span>
            <span className="block">Cardapio ligado</span>
            <span className="block text-xs font-normal text-slate-500">
              Mesmo no modo horario, desligado bloqueia novos pedidos.
            </span>
          </span>
          <input type="checkbox" checked={storeOpen} onChange={(event) => setStoreOpen(event.target.checked)} />
        </label>

        <div className="rounded-xl border border-slate-200 p-4">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h4 className="font-black text-slate-950">Horarios</h4>
              <p className="text-sm text-slate-500">Exemplo: 18:00 ate 00:00 aceita pedidos das 18h ate meia-noite.</p>
            </div>
            <div className="grid gap-2 sm:grid-cols-[120px_120px_auto]">
              <input type="time" value={bulkOpen} onChange={(event) => setBulkOpen(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <input type="time" value={bulkClose} onChange={(event) => setBulkClose(event.target.value)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
              <button type="button" className="btn-secondary justify-center" onClick={applyBulkHours}>
                Aplicar em todos
              </button>
            </div>
          </div>

          <div className="grid gap-2">
            {DAYS.map((day) => {
              const value = menuHours.days[day.key];
              return (
                <div key={day.key} className="grid gap-2 rounded-xl border border-slate-200 p-3 sm:grid-cols-[1fr_110px_110px_auto] sm:items-center">
                  <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <input type="checkbox" checked={value.enabled} onChange={(event) => updateDay(day.key, { enabled: event.target.checked })} />
                    {day.label}
                  </label>
                  <input type="time" value={value.open} onChange={(event) => updateDay(day.key, { open: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <input type="time" value={value.close} onChange={(event) => updateDay(day.key, { close: event.target.value })} className="rounded-lg border border-slate-200 px-3 py-2 text-sm" />
                  <span className={cn('text-xs font-bold', value.enabled ? 'text-emerald-700' : 'text-slate-400')}>
                    {value.enabled ? 'Ativo' : 'Fechado'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar funcionamento'}
          </button>
        </div>
      </form>
    </section>
  );
}
