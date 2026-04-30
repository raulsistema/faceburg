'use client';

import { FormEvent, useEffect, useState } from 'react';

type IssuerForm = {
  issuerName: string;
  issuerTradeName: string;
  issuerDocument: string;
  issuerStateRegistration: string;
  issuerEmail: string;
  issuerPhone: string;
  issuerZipCode: string;
  issuerStreet: string;
  issuerNumber: string;
  issuerComplement: string;
  issuerNeighborhood: string;
  issuerCity: string;
  issuerState: string;
};

type SettingsResponse = {
  prepTimeMinutes: number;
  deliveryFeeBase: number;
  storeOpen: boolean;
  whatsappPhone: string;
  issuerName: string;
  issuerTradeName: string;
  issuerDocument: string;
  issuerStateRegistration: string;
  issuerEmail: string;
  issuerPhone: string;
  issuerZipCode: string;
  issuerStreet: string;
  issuerNumber: string;
  issuerComplement: string;
  issuerNeighborhood: string;
  issuerCity: string;
  issuerState: string;
};

function buildIssuerForm(data?: Partial<SettingsResponse> | null): IssuerForm {
  return {
    issuerName: data?.issuerName || '',
    issuerTradeName: data?.issuerTradeName || '',
    issuerDocument: data?.issuerDocument || '',
    issuerStateRegistration: data?.issuerStateRegistration || '',
    issuerEmail: data?.issuerEmail || '',
    issuerPhone: data?.issuerPhone || '',
    issuerZipCode: data?.issuerZipCode || '',
    issuerStreet: data?.issuerStreet || '',
    issuerNumber: data?.issuerNumber || '',
    issuerComplement: data?.issuerComplement || '',
    issuerNeighborhood: data?.issuerNeighborhood || '',
    issuerCity: data?.issuerCity || '',
    issuerState: data?.issuerState || '',
  };
}

function mergeLookupData(current: IssuerForm, incoming: Partial<IssuerForm>) {
  return {
    ...current,
    issuerName: incoming.issuerName || current.issuerName,
    issuerTradeName: incoming.issuerTradeName || current.issuerTradeName,
    issuerStateRegistration: incoming.issuerStateRegistration || current.issuerStateRegistration,
    issuerEmail: incoming.issuerEmail || current.issuerEmail,
    issuerPhone: incoming.issuerPhone || current.issuerPhone,
    issuerZipCode: incoming.issuerZipCode || current.issuerZipCode,
    issuerStreet: incoming.issuerStreet || current.issuerStreet,
    issuerNumber: incoming.issuerNumber || current.issuerNumber,
    issuerComplement: incoming.issuerComplement || current.issuerComplement,
    issuerNeighborhood: incoming.issuerNeighborhood || current.issuerNeighborhood,
    issuerCity: incoming.issuerCity || current.issuerCity,
    issuerState: incoming.issuerState || current.issuerState,
  };
}

export default function EmitenteSettings({ initialData }: { initialData?: Partial<SettingsResponse> | null }) {
  const [form, setForm] = useState<IssuerForm>(() => buildIssuerForm(initialData));
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [searchingCnpj, setSearchingCnpj] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!initialData) return;
    setForm(buildIssuerForm(initialData));
    setLoading(false);
  }, [initialData]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const response = await fetch('/api/cardapio/settings', { cache: 'no-store' });
      const data = (await response.json()) as SettingsResponse & { error?: string };
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar dados da empresa.');
        return;
      }
      setForm(buildIssuerForm(data));
    } catch {
      setError('Falha ao carregar dados da empresa.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (initialData) return;
    void load();
  }, [initialData]);

  async function lookupCnpj() {
    const digits = form.issuerDocument.replace(/\D/g, '');
    if (digits.length !== 14) {
      setError('Informe um CNPJ com 14 digitos para buscar.');
      return;
    }

    setSearchingCnpj(true);
    setError('');
    setMessage('');
    try {
      const response = await fetch(`/api/settings/cnpj/${digits}`, { cache: 'no-store' });
      const data = (await response.json()) as Partial<IssuerForm> & { error?: string };
      if (!response.ok) {
        setError(data.error || 'Nao foi possivel consultar o CNPJ.');
        return;
      }

      setForm((current) => mergeLookupData(current, data));

      const missingFields = [data.issuerStreet, data.issuerNumber, data.issuerEmail].filter((value) => !String(value || '').trim()).length;
      setMessage(
        missingFields > 0
          ? 'CNPJ encontrado. Alguns campos nao vieram da base consultada e podem precisar de ajuste manual.'
          : 'Dados do CNPJ carregados com sucesso.',
      );
    } catch {
      setError('Nao foi possivel consultar o CNPJ.');
    } finally {
      setSearchingCnpj(false);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/cardapio/settings', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar dados da empresa.');
        return;
      }
      setMessage('Dados da empresa atualizados com sucesso.');
    } catch {
      setError('Falha ao salvar dados da empresa.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
      <h3 className="text-sm uppercase tracking-widest text-slate-500 font-bold mb-4">Dados da Empresa</h3>
      {loading ? (
        <p className="text-sm text-slate-500">Carregando...</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="grid md:grid-cols-2 gap-3">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nome da empresa" value={form.issuerName} onChange={(e) => setForm((c) => ({ ...c, issuerName: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nome fantasia" value={form.issuerTradeName} onChange={(e) => setForm((c) => ({ ...c, issuerTradeName: e.target.value }))} />
            <div className="md:col-span-2 grid md:grid-cols-[1fr_auto] gap-3">
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="CNPJ" value={form.issuerDocument} onChange={(e) => setForm((c) => ({ ...c, issuerDocument: e.target.value }))} />
              <button type="button" className="btn-secondary justify-center" onClick={() => void lookupCnpj()} disabled={searchingCnpj}>
                {searchingCnpj ? 'Buscando...' : 'Buscar CNPJ'}
              </button>
            </div>
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Inscricao estadual" value={form.issuerStateRegistration} onChange={(e) => setForm((c) => ({ ...c, issuerStateRegistration: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Telefone" value={form.issuerPhone} onChange={(e) => setForm((c) => ({ ...c, issuerPhone: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="E-mail" value={form.issuerEmail} onChange={(e) => setForm((c) => ({ ...c, issuerEmail: e.target.value }))} />
          </div>

          <div className="grid md:grid-cols-4 gap-3">
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="CEP" value={form.issuerZipCode} onChange={(e) => setForm((c) => ({ ...c, issuerZipCode: e.target.value }))} />
            <input className="md:col-span-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Logradouro" value={form.issuerStreet} onChange={(e) => setForm((c) => ({ ...c, issuerStreet: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Numero" value={form.issuerNumber} onChange={(e) => setForm((c) => ({ ...c, issuerNumber: e.target.value }))} />
            <input className="md:col-span-2 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Complemento" value={form.issuerComplement} onChange={(e) => setForm((c) => ({ ...c, issuerComplement: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Bairro" value={form.issuerNeighborhood} onChange={(e) => setForm((c) => ({ ...c, issuerNeighborhood: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Cidade" value={form.issuerCity} onChange={(e) => setForm((c) => ({ ...c, issuerCity: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="UF" value={form.issuerState} onChange={(e) => setForm((c) => ({ ...c, issuerState: e.target.value.toUpperCase() }))} maxLength={2} />
          </div>

          <button disabled={saving} className="btn-primary">
            {saving ? 'Salvando...' : 'Salvar dados da empresa'}
          </button>
          {message ? <p className="text-sm text-emerald-600">{message}</p> : null}
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </form>
      )}
    </div>
  );
}
