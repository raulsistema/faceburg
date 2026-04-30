'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';
import { useZipCodeAutofill } from '@/hooks/use-zip-code-autofill';

type Customer = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  isCompany: boolean;
  companyName: string | null;
  documentNumber: string | null;
  tags: string | null;
  notes: string | null;
  status: string;
  created_at: string;
  addressCount: number;
};

type Address = {
  id: string;
  customerId: string;
  label: string | null;
  street: string;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  reference: string | null;
  active: boolean;
  isDefault: boolean;
  created_at: string;
};

type CustomerForm = {
  name: string;
  phone: string;
  email: string;
  isCompany: boolean;
  companyName: string;
  documentNumber: string;
  tags: string;
  notes: string;
  status: string;
};

type AddressForm = {
  label: string;
  street: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  reference: string;
  isDefault: boolean;
};

const emptyCustomerForm: CustomerForm = {
  name: '',
  phone: '',
  email: '',
  isCompany: false,
  companyName: '',
  documentNumber: '',
  tags: '',
  notes: '',
  status: 'active',
};

const emptyAddressForm: AddressForm = {
  label: '',
  street: '',
  number: '',
  complement: '',
  neighborhood: '',
  city: '',
  state: '',
  zipCode: '',
  reference: '',
  isDefault: false,
};

function maskPhone(raw: string) {
  const numbers = raw.replace(/\D/g, '').slice(0, 11);
  if (numbers.length <= 2) return numbers;
  if (numbers.length <= 6) return `(${numbers.slice(0, 2)}) ${numbers.slice(2)}`;
  if (numbers.length <= 10) return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 6)}-${numbers.slice(6)}`;
  return `(${numbers.slice(0, 2)}) ${numbers.slice(2, 7)}-${numbers.slice(7)}`;
}

function formatAddress(address: Address) {
  const main = [address.street, address.number].filter(Boolean).join(', ');
  const area = [address.neighborhood, address.city, address.state].filter(Boolean).join(' - ');
  const extra = [address.complement, address.reference].filter(Boolean).join(' | ');
  return [main, area, extra].filter(Boolean).join(' | ');
}

export default function ClientesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<CustomerForm>(emptyCustomerForm);

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [addressesLoading, setAddressesLoading] = useState(false);
  const [savingAddress, setSavingAddress] = useState(false);
  const [addressForm, setAddressForm] = useState<AddressForm>(emptyAddressForm);
  const [customerToDelete, setCustomerToDelete] = useState<Customer | null>(null);
  const [deletingCustomer, setDeletingCustomer] = useState(false);

  async function loadCustomers(searchValue = '') {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customers?search=${encodeURIComponent(searchValue)}`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar clientes.');
        return;
      }
      setCustomers(data.customers || []);
    } catch {
      setError('Falha ao carregar clientes.');
    } finally {
      setLoading(false);
    }
  }

  async function loadAddresses(customerId: string) {
    setAddressesLoading(true);
    try {
      const response = await fetch(`/api/customers/${customerId}/addresses`);
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar enderecos.');
        return;
      }
      setAddresses(data.addresses || []);
    } finally {
      setAddressesLoading(false);
    }
  }

  useEffect(() => {
    void loadCustomers();
  }, []);

  const applyAddressZipLookup = useCallback((fields: { street?: string; neighborhood?: string; city?: string; state?: string; complement?: string }) => {
    setAddressForm((prev) => ({
      ...prev,
      street: prev.street || String(fields.street || ''),
      neighborhood: prev.neighborhood || String(fields.neighborhood || ''),
      city: prev.city || String(fields.city || ''),
      state: prev.state || String(fields.state || ''),
      complement: prev.complement || String(fields.complement || ''),
    }));
  }, []);

  useZipCodeAutofill({
    zipCode: addressForm.zipCode,
    enabled: Boolean(selectedCustomerId),
    apply: applyAddressZipLookup,
  });

  async function onSubmitCustomer(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      name: form.name,
      phone: form.phone,
      email: form.email,
      isCompany: form.isCompany,
      companyName: form.companyName,
      documentNumber: form.documentNumber,
      tags: form.tags,
      notes: form.notes,
      status: form.status,
    };

    try {
      const response = await fetch(editingId ? `/api/customers/${editingId}` : '/api/customers', {
        method: editingId ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar cliente.');
        return;
      }

      setForm(emptyCustomerForm);
      setEditingId(null);
      await loadCustomers(search);
      const nextSelected = editingId || data.customer?.id;
      if (nextSelected) {
        setSelectedCustomerId(nextSelected);
        await loadAddresses(nextSelected);
      }
    } finally {
      setSaving(false);
    }
  }

  async function onSubmitAddress(event: FormEvent) {
    event.preventDefault();
    if (!selectedCustomerId) return;
    setSavingAddress(true);
    setError(null);

    try {
      const response = await fetch(`/api/customers/${selectedCustomerId}/addresses`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(addressForm),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar endereco.');
        return;
      }
      setAddressForm(emptyAddressForm);
      await loadAddresses(selectedCustomerId);
      await loadCustomers(search);
    } finally {
      setSavingAddress(false);
    }
  }

  async function removeAddress(addressId: string) {
    if (!selectedCustomerId) return;
    setError(null);
    const response = await fetch(`/api/customers/${selectedCustomerId}/addresses/${addressId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao remover endereco.');
      return;
    }
    await loadAddresses(selectedCustomerId);
    await loadCustomers(search);
  }

  async function removeCustomer(customerId: string) {
    setError(null);
    setDeletingCustomer(true);
    const response = await fetch(`/api/customers/${customerId}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    setDeletingCustomer(false);
    if (!response.ok) {
      setError(data.error || 'Falha ao excluir cliente.');
      return;
    }

    if (selectedCustomerId === customerId) {
      setSelectedCustomerId(null);
      setAddresses([]);
      setAddressForm(emptyAddressForm);
    }
    if (editingId === customerId) {
      setEditingId(null);
      setForm(emptyCustomerForm);
    }
    setCustomerToDelete(null);

    await loadCustomers(search);
  }

  const customersCount = useMemo(() => customers.length, [customers.length]);

  return (
    <DashboardShell>
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Clientes</h2>
            <p className="text-sm text-slate-500">Cadastro completo PF/PJ com varios enderecos por cliente e isolamento SaaS.</p>
          </div>
          <div className="text-sm text-slate-500">Total: {customersCount}</div>
        </div>

        <div className="grid xl:grid-cols-3 gap-6">
          <form onSubmit={onSubmitCustomer} className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-3">
            <h3 className="font-bold text-slate-900">{editingId ? 'Editar Cliente' : 'Novo Cliente'}</h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, isCompany: false }))}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${!form.isCompany ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600'}`}
              >
                Pessoa fisica
              </button>
              <button
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, isCompany: true }))}
                className={`rounded-lg border px-3 py-2 text-sm font-semibold ${form.isCompany ? 'border-rose-400 bg-rose-50 text-rose-700' : 'border-slate-200 text-slate-600'}`}
              >
                Empresa
              </button>
            </div>

            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nome do contato" value={form.name} onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))} required />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Telefone" value={form.phone} onChange={(e) => setForm((prev) => ({ ...prev, phone: maskPhone(e.target.value) }))} required />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="E-mail" value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />

            {form.isCompany ? (
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Razao/Nome da empresa" value={form.companyName} onChange={(e) => setForm((prev) => ({ ...prev, companyName: e.target.value }))} />
            ) : null}
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder={form.isCompany ? 'CNPJ' : 'CPF'} value={form.documentNumber} onChange={(e) => setForm((prev) => ({ ...prev, documentNumber: e.target.value }))} />
            <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Tags (vip, recorrente...)" value={form.tags} onChange={(e) => setForm((prev) => ({ ...prev, tags: e.target.value }))} />
            <textarea className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Observacoes" value={form.notes} onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))} rows={3} />

            {editingId ? (
              <select
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm"
                value={form.status}
                onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value }))}
              >
                <option value="active">Ativo</option>
                <option value="inactive">Inativo</option>
              </select>
            ) : null}

            <button disabled={saving} className="btn-primary w-full justify-center">
              {saving ? 'Salvando...' : editingId ? 'Salvar Alteracoes' : 'Cadastrar Cliente'}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(emptyCustomerForm);
                }}
                className="btn-secondary w-full justify-center"
              >
                Cancelar edicao
              </button>
            ) : null}
          </form>

          <div className="xl:col-span-2 bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
            <div className="flex gap-2">
              <input
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm"
                placeholder="Buscar por nome ou telefone"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <button className="btn-secondary" type="button" onClick={() => void loadCustomers(search)}>
                Buscar
              </button>
            </div>

            {error ? <p className="text-sm text-red-500">{error}</p> : null}

            {loading ? (
              <p className="text-sm text-slate-500">Carregando clientes...</p>
            ) : customers.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum cliente cadastrado.</p>
            ) : (
              <div className="space-y-2">
                {customers.map((customer) => (
                  <div key={customer.id} className={`border rounded-xl p-3 ${selectedCustomerId === customer.id ? 'border-rose-300 bg-rose-50/50' : 'border-slate-200'}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{customer.name}</p>
                        <p className="text-xs text-slate-500">
                          {customer.phone}
                          {customer.email ? ` • ${customer.email}` : ''}
                          {customer.documentNumber ? ` • ${customer.documentNumber}` : ''}
                        </p>
                        <p className="text-xs text-slate-500">
                          {customer.isCompany ? `Empresa: ${customer.companyName || 'sem nome'}` : 'Pessoa fisica'} • Enderecos: {customer.addressCount}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={async () => {
                            setSelectedCustomerId(customer.id);
                            await loadAddresses(customer.id);
                          }}
                        >
                          Enderecos
                        </button>
                        <button
                          type="button"
                          className="btn-secondary"
                          onClick={() => {
                            setEditingId(customer.id);
                            setForm({
                              name: customer.name,
                              phone: customer.phone,
                              email: customer.email || '',
                              isCompany: customer.isCompany,
                              companyName: customer.companyName || '',
                              documentNumber: customer.documentNumber || '',
                              tags: customer.tags || '',
                              notes: customer.notes || '',
                              status: customer.status || 'active',
                            });
                          }}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="btn-secondary text-rose-600"
                          onClick={() => setCustomerToDelete(customer)}
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedCustomerId ? (
              <div className="border-t border-slate-200 pt-4 space-y-3">
                <h4 className="font-semibold text-slate-900">Enderecos do cliente selecionado</h4>

                <form onSubmit={onSubmitAddress} className="grid md:grid-cols-2 gap-2">
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Apelido (Casa, Trabalho...)" value={addressForm.label} onChange={(e) => setAddressForm((prev) => ({ ...prev, label: e.target.value }))} />
                  <div className="flex items-center gap-2 px-2">
                    <input id="default-address" type="checkbox" checked={addressForm.isDefault} onChange={(e) => setAddressForm((prev) => ({ ...prev, isDefault: e.target.checked }))} />
                    <label htmlFor="default-address" className="text-sm text-slate-600">Marcar como padrao</label>
                  </div>
                  <input className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Rua" value={addressForm.street} onChange={(e) => setAddressForm((prev) => ({ ...prev, street: e.target.value }))} required />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Numero" value={addressForm.number} onChange={(e) => setAddressForm((prev) => ({ ...prev, number: e.target.value }))} />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Complemento" value={addressForm.complement} onChange={(e) => setAddressForm((prev) => ({ ...prev, complement: e.target.value }))} />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Bairro" value={addressForm.neighborhood} onChange={(e) => setAddressForm((prev) => ({ ...prev, neighborhood: e.target.value }))} />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Cidade" value={addressForm.city} onChange={(e) => setAddressForm((prev) => ({ ...prev, city: e.target.value }))} />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="UF" value={addressForm.state} onChange={(e) => setAddressForm((prev) => ({ ...prev, state: e.target.value }))} />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="CEP" value={addressForm.zipCode} onChange={(e) => setAddressForm((prev) => ({ ...prev, zipCode: e.target.value }))} />
                  <input className="md:col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Referencia" value={addressForm.reference} onChange={(e) => setAddressForm((prev) => ({ ...prev, reference: e.target.value }))} />
                  <button disabled={savingAddress} className="btn-primary md:col-span-2 justify-center">
                    {savingAddress ? 'Salvando endereco...' : 'Adicionar Endereco'}
                  </button>
                </form>

                {addressesLoading ? (
                  <p className="text-sm text-slate-500">Carregando enderecos...</p>
                ) : addresses.length === 0 ? (
                  <p className="text-sm text-slate-500">Nenhum endereco cadastrado.</p>
                ) : (
                  <div className="space-y-2">
                    {addresses.map((address) => (
                      <div key={address.id} className="border border-slate-200 rounded-lg p-3 flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-sm text-slate-900">
                            {address.label || 'Endereco'} {address.isDefault ? <span className="text-emerald-600">(padrao)</span> : null}
                          </p>
                          <p className="text-xs text-slate-500">{formatAddress(address)}</p>
                        </div>
                        <button type="button" className="text-rose-600 text-xs font-semibold" onClick={() => void removeAddress(address.id)}>
                          Excluir
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      </div>

      {customerToDelete ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <h4 className="text-base font-bold text-slate-900">Confirmar exclusao</h4>
            <p className="mt-2 text-sm text-slate-600">
              Voce esta prestes a excluir o cliente <strong className="text-slate-900">{customerToDelete.name}</strong>.
              Esta acao nao pode ser desfeita.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setCustomerToDelete(null)}
                disabled={deletingCustomer}
              >
                Cancelar
              </button>
              <button
                type="button"
                className="btn-primary !bg-rose-600 hover:!bg-rose-700"
                onClick={() => void removeCustomer(customerToDelete.id)}
                disabled={deletingCustomer}
              >
                {deletingCustomer ? 'Excluindo...' : 'Excluir cliente'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </DashboardShell>
  );
}
