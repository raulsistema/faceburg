'use client';

import { useEffect, useState } from 'react';
import { Pencil, Plus } from 'lucide-react';

type PaymentMethod = {
  id: string;
  name: string;
  methodType: string;
  feePercent: number;
  feeFixed: number;
  settlementDays: number;
  active: boolean;
};

type PaymentMethodForm = {
  id: string;
  name: string;
  feePercent: string;
  feeFixed: string;
  settlementDays: string;
  active: boolean;
};

const emptyForm: PaymentMethodForm = {
  id: '',
  name: '',
  feePercent: '0',
  feeFixed: '0',
  settlementDays: '0',
  active: true,
};

function inferMethodTypeByName(name: string) {
  const normalized = name.toLowerCase();
  if (normalized.includes('pix')) return 'pix';
  if (normalized.includes('dinheiro')) return 'cash';
  if (normalized.includes('debito') || normalized.includes('credito') || normalized.includes('cartao')) return 'card';
  return 'other';
}

export default function PaymentMethodsSettings() {
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<PaymentMethodForm>(emptyForm);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/finance/payment-methods', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar formas de pagamento.');
        return;
      }
      setItems(Array.isArray(data.paymentMethods) ? data.paymentMethods : []);
    } catch {
      setError('Falha ao carregar formas de pagamento.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openNewModal() {
    setForm(emptyForm);
    setModalOpen(true);
  }

  function openEditModal(item: PaymentMethod) {
    setForm({
      id: item.id,
      name: item.name,
      feePercent: String(item.feePercent),
      feeFixed: String(item.feeFixed),
      settlementDays: String(item.settlementDays),
      active: item.active,
    });
    setModalOpen(true);
  }

  async function save() {
    if (!form.name.trim()) {
      setError('Informe o nome da forma de pagamento.');
      return;
    }

    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/finance/payment-methods', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: form.id || undefined,
          name: form.name.trim(),
          methodType: inferMethodTypeByName(form.name),
          feePercent: Number(form.feePercent || 0),
          feeFixed: Number(form.feeFixed || 0),
          settlementDays: Number(form.settlementDays || 0),
          active: form.active,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar forma de pagamento.');
        return;
      }
      setMessage(form.id ? 'Forma de pagamento atualizada.' : 'Forma de pagamento cadastrada.');
      setModalOpen(false);
      setForm(emptyForm);
      await load();
    } catch {
      setError('Falha ao salvar forma de pagamento.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm uppercase tracking-widest text-slate-500 font-bold">Formas de Pagamento</h3>
          <p className="text-xs text-slate-500 mt-1">Cadastre taxa e prazo de recebimento (D+N). Ex.: Debito Maquina X, taxa 1%, dias 1.</p>
        </div>
        <button type="button" className="btn-primary" onClick={openNewModal}>
          <Plus className="w-4 h-4" />
          Novo
        </button>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-slate-500">Nenhuma forma cadastrada.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Nome</th>
                <th className="px-4 py-3 text-left font-semibold">Taxa (%)</th>
                <th className="px-4 py-3 text-left font-semibold">Taxa fixa</th>
                <th className="px-4 py-3 text-left font-semibold">Dias recebimento</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 font-medium text-slate-900">{item.name}</td>
                  <td className="px-4 py-3 text-slate-700">{item.feePercent.toFixed(2)}%</td>
                  <td className="px-4 py-3 text-slate-700">R$ {item.feeFixed.toFixed(2)}</td>
                  <td className="px-4 py-3 text-slate-700">{item.settlementDays === 0 ? 'Na hora' : `D+${item.settlementDays}`}</td>
                  <td className="px-4 py-3">{item.active ? <span className="text-emerald-600 font-semibold">Ativa</span> : <span className="text-slate-400 font-semibold">Inativa</span>}</td>
                  <td className="px-4 py-3 text-right">
                    <button type="button" className="btn-secondary" onClick={() => openEditModal(item)}>
                      <Pencil className="w-4 h-4" />
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button type="button" aria-label="Fechar modal" className="absolute inset-0 bg-slate-900/55" onClick={() => setModalOpen(false)} />
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-2xl space-y-5 relative z-10">
            <h4 className="text-2xl font-bold text-slate-900">{form.id ? 'Editar Forma de Pagamento' : 'Nova Forma de Pagamento'}</h4>

            <div className="grid md:grid-cols-2 gap-3">
              <label className="md:col-span-2 text-sm font-medium text-slate-700">
                Nome da Forma
                <input className="mt-1 w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" placeholder="Ex: Cartao de Credito Visa" value={form.name} onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Taxa (%)
                <input type="number" min="0" step="0.01" className="mt-1 w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" placeholder="0" value={form.feePercent} onChange={(e) => setForm((p) => ({ ...p, feePercent: e.target.value }))} />
              </label>
              <label className="text-sm font-medium text-slate-700">
                Dias p/ Receber
                <input type="number" min="0" step="1" className="mt-1 w-full px-4 py-2 rounded-lg border border-slate-200 focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none" placeholder="0" value={form.settlementDays} onChange={(e) => setForm((p) => ({ ...p, settlementDays: e.target.value }))} />
              </label>
              <label className="md:col-span-2 flex items-center gap-2 pt-2 text-sm font-medium text-slate-700">
                <input type="checkbox" className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500" checked={form.active} onChange={(e) => setForm((p) => ({ ...p, active: e.target.checked }))} /> Forma de pagamento ativa
              </label>
            </div>

            <div className="flex gap-3 pt-2">
              <button type="button" className="flex-1 px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50 transition-colors" onClick={() => setModalOpen(false)} disabled={saving}>Cancelar</button>
              <button type="button" className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200" onClick={() => void save()} disabled={saving}>{saving ? 'Salvando...' : 'Salvar'}</button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
