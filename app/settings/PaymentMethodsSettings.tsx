'use client';

import { useEffect, useMemo, useState } from 'react';
import { BadgePercent, CalendarClock, CreditCard, Pencil, Plus, ReceiptText, Save, Wallet, X } from 'lucide-react';

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
  methodType: string;
  feePercent: string;
  feeFixed: string;
  settlementDays: string;
  active: boolean;
};

const methodTypeOptions = [
  { value: 'pix', label: 'Pix' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'card', label: 'Cartao' },
  { value: 'bank_slip', label: 'Boleto' },
  { value: 'wallet', label: 'Carteira digital' },
  { value: 'other', label: 'Outro' },
];

const emptyForm: PaymentMethodForm = {
  id: '',
  name: '',
  methodType: 'pix',
  feePercent: '0',
  feeFixed: '0',
  settlementDays: '0',
  active: true,
};

function formatCurrency(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

function formatPercent(value: number) {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}%`;
}

function parseDecimal(value: string) {
  let normalized = String(value || '0').replace(/[^\d,.-]/g, '');
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');

  if (lastComma > lastDot) {
    normalized = normalized.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = normalized.replace(/,/g, '');
  }

  const parsed = Number(normalized || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseInteger(value: string) {
  const parsed = Number(String(value || '0').replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function methodTypeLabel(value: string) {
  return methodTypeOptions.find((option) => option.value === value)?.label || 'Outro';
}

function settlementLabel(days: number) {
  if (days <= 0) return 'Na hora';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

function methodIcon(value: string) {
  if (value === 'cash' || value === 'pix') return Wallet;
  if (value === 'bank_slip') return ReceiptText;
  return CreditCard;
}

export default function PaymentMethodsSettings() {
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [form, setForm] = useState<PaymentMethodForm>(emptyForm);
  const [modalOpen, setModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/finance/payment-methods', { cache: 'no-store' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar formas de pagamento.');
        return;
      }
      setPaymentMethods(Array.isArray(data.paymentMethods) ? data.paymentMethods : []);
    } catch {
      setError('Falha ao carregar formas de pagamento.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const summary = useMemo(() => {
    const active = paymentMethods.filter((method) => method.active);
    const instant = active.filter((method) => Number(method.settlementDays || 0) === 0);
    const mostExpensive = [...active].sort((a, b) => {
      const aFee = Number(a.feePercent || 0) + Number(a.feeFixed || 0);
      const bFee = Number(b.feePercent || 0) + Number(b.feeFixed || 0);
      return bFee - aFee;
    })[0];

    return {
      activeCount: active.length,
      instantCount: instant.length,
      mostExpensive,
    };
  }, [paymentMethods]);

  const preview = useMemo(() => {
    const gross = 100;
    const percentFee = (gross * parseDecimal(form.feePercent)) / 100;
    const fixedFee = parseDecimal(form.feeFixed);
    const totalFee = Math.max(0, percentFee + fixedFee);
    const net = Math.max(0, gross - totalFee);
    return { gross, totalFee, net };
  }, [form.feeFixed, form.feePercent]);

  function openCreate() {
    setForm(emptyForm);
    setError(null);
    setMessage(null);
    setModalOpen(true);
  }

  function openEdit(method: PaymentMethod) {
    setForm({
      id: method.id,
      name: method.name,
      methodType: method.methodType || 'other',
      feePercent: String(Number(method.feePercent || 0)),
      feeFixed: String(Number(method.feeFixed || 0)),
      settlementDays: String(Number(method.settlementDays || 0)),
      active: Boolean(method.active),
    });
    setError(null);
    setMessage(null);
    setModalOpen(true);
  }

  function closeModal() {
    if (saving) return;
    setModalOpen(false);
    setForm(emptyForm);
  }

  async function save() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const payload = {
        id: form.id,
        name: form.name.trim(),
        methodType: form.methodType,
        feePercent: form.feePercent,
        feeFixed: form.feeFixed,
        settlementDays: parseInteger(form.settlementDays),
        active: form.active,
      };

      const response = await fetch('/api/finance/payment-methods', {
        method: form.id ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar forma de pagamento.');
        return;
      }
      setMessage(form.id ? 'Forma de pagamento atualizada.' : 'Forma de pagamento criada.');
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
    <div className="space-y-6">
      {error ? <p className="text-sm font-medium text-red-500">{error}</p> : null}
      {message ? <p className="text-sm font-medium text-emerald-600">{message}</p> : null}

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <Wallet className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Ativas</p>
              <p className="text-2xl font-black text-slate-900">{summary.activeCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <CalendarClock className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Recebe na hora</p>
              <p className="text-2xl font-black text-slate-900">{summary.instantCount}</p>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
              <BadgePercent className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-slate-400">Maior custo</p>
              <p className="text-sm font-bold text-slate-900">
                {summary.mostExpensive
                  ? `${summary.mostExpensive.name}: ${formatPercent(summary.mostExpensive.feePercent)} + ${formatCurrency(summary.mostExpensive.feeFixed)}`
                  : '-'}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">Tabela financeira de recebimento</h3>
            <p className="text-sm text-slate-500">Taxas e prazos usados nas vendas, caixas e recebiveis.</p>
          </div>
          <button type="button" className="btn-primary inline-flex items-center gap-2" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nova forma
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500">Carregando formas de pagamento...</p>
        ) : paymentMethods.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center">
            <p className="font-semibold text-slate-900">Nenhuma forma cadastrada.</p>
            <p className="mt-1 text-sm text-slate-500">Crie Pix, dinheiro, cartao e outros recebimentos antes de operar o financeiro.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-sm">
              <thead>
                <tr className="text-xs font-bold uppercase tracking-[0.14em] text-slate-400">
                  <th className="px-3 py-3">Forma</th>
                  <th className="px-3 py-3">Tipo</th>
                  <th className="px-3 py-3">Taxa</th>
                  <th className="px-3 py-3">Recebimento</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="px-3 py-3 text-right">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paymentMethods.map((method) => {
                  const Icon = methodIcon(method.methodType);
                  return (
                    <tr key={method.id} className="align-middle">
                      <td className="px-3 py-4">
                        <div className="flex items-center gap-3">
                          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-100 text-slate-600">
                            <Icon className="h-4 w-4" aria-hidden="true" />
                          </span>
                          <span className="font-semibold text-slate-900">{method.name}</span>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-slate-600">{methodTypeLabel(method.methodType)}</td>
                      <td className="px-3 py-4 text-slate-600">
                        {formatPercent(method.feePercent)} + {formatCurrency(method.feeFixed)}
                      </td>
                      <td className="px-3 py-4 text-slate-600">{settlementLabel(method.settlementDays)}</td>
                      <td className="px-3 py-4">
                        <span
                          className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                            method.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                          }`}
                        >
                          {method.active ? 'Ativa' : 'Inativa'}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <button type="button" className="btn-secondary inline-flex items-center gap-2" onClick={() => openEdit(method)}>
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                          Editar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="font-bold text-slate-900">{form.id ? 'Editar forma de pagamento' : 'Nova forma de pagamento'}</h3>
                <p className="text-sm text-slate-500">Ajuste as regras que impactam taxas, caixa e recebimento.</p>
              </div>
              <button type="button" className="btn-secondary inline-flex h-10 w-10 items-center justify-center p-0" onClick={closeModal} aria-label="Fechar">
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>

            <div className="grid gap-5 p-6 md:grid-cols-[1fr_220px]">
              <div className="space-y-4">
                <label className="block text-sm font-semibold text-slate-700">
                  Nome
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.name}
                    onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                    placeholder="Ex: Pix, Debito, Credito"
                  />
                </label>

                <label className="block text-sm font-semibold text-slate-700">
                  Tipo
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={form.methodType}
                    onChange={(event) => setForm((current) => ({ ...current, methodType: event.target.value }))}
                  >
                    {methodTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="block text-sm font-semibold text-slate-700">
                    Taxa %
                    <input
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      value={form.feePercent}
                      onChange={(event) => setForm((current) => ({ ...current, feePercent: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Taxa fixa
                    <input
                      inputMode="decimal"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      value={form.feeFixed}
                      onChange={(event) => setForm((current) => ({ ...current, feeFixed: event.target.value }))}
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-700">
                    Dias p/ receber
                    <input
                      inputMode="numeric"
                      className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                      value={form.settlementDays}
                      onChange={(event) => setForm((current) => ({ ...current, settlementDays: event.target.value }))}
                    />
                  </label>
                </div>

                <label className="flex items-center gap-3 rounded-xl border border-slate-200 px-3 py-3 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))}
                  />
                  Forma disponivel para novas vendas
                </label>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-slate-400">Simulacao</p>
                <div className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Venda</span>
                    <strong className="text-slate-900">{formatCurrency(preview.gross)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-slate-500">Taxas</span>
                    <strong className="text-rose-600">{formatCurrency(preview.totalFee)}</strong>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                    <span className="text-slate-500">Liquido</span>
                    <strong className="text-emerald-700">{formatCurrency(preview.net)}</strong>
                  </div>
                </div>
                <p className="mt-4 text-xs text-slate-500">Recebimento: {settlementLabel(parseInteger(form.settlementDays))}.</p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-6 py-4">
              <button type="button" className="btn-secondary" disabled={saving} onClick={closeModal}>
                Cancelar
              </button>
              <button type="button" className="btn-primary inline-flex items-center gap-2" disabled={saving} onClick={() => void save()}>
                <Save className="h-4 w-4" aria-hidden="true" />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
