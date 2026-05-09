'use client';

import { FormEvent, useEffect, useState } from 'react';

type OrderSequenceSettingsData = {
  orderSequenceStart: number | null;
};

type SettingsResponse = OrderSequenceSettingsData & {
  error?: string;
};

function buildInitialValue(data?: Partial<OrderSequenceSettingsData> | null) {
  return data?.orderSequenceStart === null || data?.orderSequenceStart === undefined
    ? ''
    : String(data.orderSequenceStart);
}

export default function OrderSequenceSettings({ initialData }: { initialData?: Partial<OrderSequenceSettingsData> | null }) {
  const [value, setValue] = useState(() => buildInitialValue(initialData));
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialData) return;
    setValue(buildInitialValue(initialData));
    setLoading(false);
  }, [initialData]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/cardapio/settings', { cache: 'no-store' });
      const data = (await response.json()) as SettingsResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar configuracao da sequencia.');
        return;
      }
      setValue(buildInitialValue(data));
    } catch {
      setError('Falha ao carregar configuracao da sequencia.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialData) return;
    void load();
  }, [initialData]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    const trimmedValue = value.trim();
    const parsedSequenceStart = trimmedValue ? Number(trimmedValue) : null;
    if (parsedSequenceStart !== null && (!Number.isInteger(parsedSequenceStart) || parsedSequenceStart < 1)) {
      setSaving(false);
      setError('Informe um numero inteiro maior que zero ou deixe vazio para desativar.');
      return;
    }
    const orderSequenceStart = parsedSequenceStart;

    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderSequenceStart }),
      });
      const data = (await response.json()) as SettingsResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar configuracao da sequencia.');
        return;
      }
      setValue(buildInitialValue(data));
      setMessage(orderSequenceStart === null ? 'Sequencia por caixa desativada.' : 'Sequencia por caixa salva.');
    } catch {
      setError('Falha ao salvar configuracao da sequencia.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-2 text-sm font-bold uppercase tracking-widest text-slate-500">Sequencia dos pedidos</h3>
      <p className="mb-4 text-sm text-slate-500">
        Quando preenchido, cada caixa aberto ganha uma contagem propria para organizar a tela e o recibo.
      </p>
      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="block">
            <span className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Comecar sequencia em</span>
            <input
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value.replace(/[^\d]/g, ''))}
              placeholder="Vazio para desativar"
              className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              disabled={saving}
            />
          </label>
          <p className="text-xs text-slate-500">
            Exemplo: 1 gera 1, 2, 3... em cada caixa novo. Vazio mantem o sistema como esta.
          </p>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Salvando...' : 'Salvar sequencia'}
          </button>
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
