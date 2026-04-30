'use client';

import { FormEvent, useMemo, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
  admin_name: string | null;
  admin_email: string | null;
};

type Props = {
  initialTenants: Tenant[];
  baseUrl: string;
};

type EditingState = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
} | null;

export default function EmpresasCrud({ initialTenants, baseUrl }: Props) {
  const [tenants, setTenants] = useState<Tenant[]>(initialTenants);
  const [editing, setEditing] = useState<EditingState>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [newName, setNewName] = useState('');
  const [newSlug, setNewSlug] = useState('');
  const [newPlan, setNewPlan] = useState('starter');
  const [newStatus, setNewStatus] = useState('active');
  const [newAdminName, setNewAdminName] = useState('');
  const [newAdminEmail, setNewAdminEmail] = useState('');
  const [newAdminPassword, setNewAdminPassword] = useState('');
  const [showNewAdminPassword, setShowNewAdminPassword] = useState(false);
  const [showEditAdminPassword, setShowEditAdminPassword] = useState(false);

  const sortedTenants = useMemo(
    () => [...tenants].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at)),
    [tenants],
  );

  function startEdit(tenant: Tenant) {
    setEditing({
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      status: tenant.status,
      adminName: tenant.admin_name || '',
      adminEmail: tenant.admin_email || '',
      adminPassword: '',
    });
    setError(null);
    setMessage(null);
  }

  function stopEdit() {
    setEditing(null);
  }

  async function createTenant(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const response = await fetch('/api/master/tenants', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: newName,
        slug: newSlug,
        plan: newPlan,
        status: newStatus,
        adminName: newAdminName,
        adminEmail: newAdminEmail,
        adminPassword: newAdminPassword,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao criar empresa.');
      return;
    }

    setTenants((prev) => [data.tenant, ...prev]);
    setNewName('');
    setNewSlug('');
    setNewPlan('starter');
    setNewStatus('active');
    setNewAdminName('');
    setNewAdminEmail('');
    setNewAdminPassword('');
    setMessage('Empresa criada com login admin pronto para uso.');
  }

  async function saveEdit(event: FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setLoadingId(editing.id);
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/master/tenants/${editing.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: editing.name,
        slug: editing.slug,
        plan: editing.plan,
        status: editing.status,
        adminName: editing.adminName,
        adminEmail: editing.adminEmail,
        adminPassword: editing.adminPassword,
      }),
    });
    const data = await response.json();
    setLoadingId(null);
    if (!response.ok) {
      setError(data.error || 'Falha ao editar empresa.');
      return;
    }

    setTenants((prev) => prev.map((item) => (item.id === editing.id ? data.tenant : item)));
    setEditing(null);
    setMessage(
      editing.adminPassword
        ? 'Empresa e login atualizados. Senha do admin redefinida.'
        : 'Empresa e login atualizados com sucesso.',
    );
  }

  async function deleteTenant(id: string, name: string) {
    const confirmed = window.confirm(
      `Excluir a empresa "${name}"? Isso vai apagar TODOS os dados dela no banco.`,
    );
    if (!confirmed) return;

    setLoadingId(id);
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/master/tenants/${id}`, {
      method: 'DELETE',
    });
    const data = await response.json();
    setLoadingId(null);
    if (!response.ok) {
      setError(data.error || 'Falha ao excluir empresa.');
      return;
    }

    setTenants((prev) => prev.filter((item) => item.id !== id));
    if (editing?.id === id) setEditing(null);
    setMessage('Empresa excluida com todos os dados relacionados.');
  }

  return (
    <div className="space-y-6">
      <form onSubmit={createTenant} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 mb-3">Nova Empresa SaaS</h2>
        <div className="grid md:grid-cols-4 gap-3 mb-3">
          <input
            required
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Nome da empresa"
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            required
            value={newSlug}
            onChange={(e) => setNewSlug(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
            placeholder="slug-da-empresa"
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={newPlan}
            onChange={(e) => setNewPlan(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="starter">starter</option>
            <option value="pro">pro</option>
            <option value="enterprise">enterprise</option>
          </select>
          <select
            value={newStatus}
            onChange={(e) => setNewStatus(e.target.value)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          >
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        <div className="grid md:grid-cols-3 gap-3">
          <input
            required
            value={newAdminName}
            onChange={(e) => setNewAdminName(e.target.value)}
            placeholder="Nome do admin"
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          <input
            required
            type="email"
            value={newAdminEmail}
            onChange={(e) => setNewAdminEmail(e.target.value.toLowerCase())}
            placeholder="E-mail do admin"
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
          />
          <div className="relative">
            <input
              required
              type={showNewAdminPassword ? 'text' : 'password'}
              minLength={8}
              value={newAdminPassword}
              onChange={(e) => setNewAdminPassword(e.target.value)}
              placeholder="Senha do admin (min 8)"
              className="border border-slate-200 rounded-lg px-3 py-2 pr-10 text-sm w-full"
            />
            <button
              type="button"
              onClick={() => setShowNewAdminPassword((prev) => !prev)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
              aria-label={showNewAdminPassword ? 'Ocultar senha' : 'Mostrar senha'}
            >
              {showNewAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
        <button className="mt-3 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold" type="submit">
          Criar Empresa e Login
        </button>
      </form>

      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left px-4 py-3">Empresa</th>
              <th className="text-left px-4 py-3">Login Admin</th>
              <th className="text-left px-4 py-3">Plano</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Cadastro</th>
              <th className="text-left px-4 py-3">Acesso</th>
              <th className="text-left px-4 py-3">Acoes</th>
            </tr>
          </thead>
          <tbody>
            {sortedTenants.map((tenant) => {
              const isEditing = editing?.id === tenant.id;
              const isLoading = loadingId === tenant.id;
              return (
                <tr key={tenant.id} className="border-t border-slate-100 align-top">
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={editing.name}
                          onChange={(e) =>
                            setEditing((prev) => (prev ? { ...prev, name: e.target.value } : prev))
                          }
                          className="border border-slate-200 rounded px-2 py-1 text-sm w-full"
                        />
                        <input
                          value={editing.slug}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev ? { ...prev, slug: e.target.value.toLowerCase().replace(/\s+/g, '-') } : prev,
                            )
                          }
                          className="border border-slate-200 rounded px-2 py-1 text-sm w-full"
                        />
                      </div>
                    ) : (
                      <div>
                        <p className="font-semibold text-slate-900">{tenant.name}</p>
                        <p className="text-xs text-slate-500">{tenant.slug}</p>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <div className="space-y-2">
                        <input
                          value={editing.adminName}
                          onChange={(e) =>
                            setEditing((prev) => (prev ? { ...prev, adminName: e.target.value } : prev))
                          }
                          placeholder="Nome admin"
                          className="border border-slate-200 rounded px-2 py-1 text-sm w-full"
                        />
                        <input
                          type="email"
                          value={editing.adminEmail}
                          onChange={(e) =>
                            setEditing((prev) =>
                              prev ? { ...prev, adminEmail: e.target.value.toLowerCase() } : prev,
                            )
                          }
                          placeholder="E-mail admin"
                          className="border border-slate-200 rounded px-2 py-1 text-sm w-full"
                        />
                        <div className="relative">
                          <input
                            type={showEditAdminPassword ? 'text' : 'password'}
                            minLength={8}
                            value={editing.adminPassword}
                            onChange={(e) =>
                              setEditing((prev) => (prev ? { ...prev, adminPassword: e.target.value } : prev))
                            }
                            placeholder="Nova senha (opcional)"
                            className="border border-slate-200 rounded px-2 py-1 pr-8 text-sm w-full"
                          />
                          <button
                            type="button"
                            onClick={() => setShowEditAdminPassword((prev) => !prev)}
                            className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700"
                            aria-label={showEditAdminPassword ? 'Ocultar senha' : 'Mostrar senha'}
                          >
                            {showEditAdminPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="font-medium text-slate-800">{tenant.admin_name || '-'}</p>
                        <p className="text-xs text-slate-500">{tenant.admin_email || '-'}</p>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {isEditing ? (
                      <select
                        value={editing.plan}
                        onChange={(e) =>
                          setEditing((prev) => (prev ? { ...prev, plan: e.target.value } : prev))
                        }
                        className="border border-slate-200 rounded px-2 py-1 text-sm"
                      >
                        <option value="starter">starter</option>
                        <option value="pro">pro</option>
                        <option value="enterprise">enterprise</option>
                      </select>
                    ) : (
                      tenant.plan
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {isEditing ? (
                      <select
                        value={editing.status}
                        onChange={(e) =>
                          setEditing((prev) => (prev ? { ...prev, status: e.target.value } : prev))
                        }
                        className="border border-slate-200 rounded px-2 py-1 text-sm"
                      >
                        <option value="active">active</option>
                        <option value="inactive">inactive</option>
                      </select>
                    ) : (
                      tenant.status
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{new Date(tenant.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <a
                      className="text-cyan-700 font-semibold hover:underline"
                      href={`${baseUrl || ''}/cardapio/${tenant.slug}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Ver cardapio
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    {isEditing ? (
                      <form onSubmit={saveEdit} className="flex gap-2">
                        <button
                          type="submit"
                          className="px-3 py-1.5 rounded bg-emerald-600 text-white text-xs font-semibold disabled:opacity-60"
                          disabled={isLoading}
                        >
                          Salvar
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded bg-slate-200 text-slate-700 text-xs font-semibold"
                          onClick={stopEdit}
                        >
                          Cancelar
                        </button>
                      </form>
                    ) : (
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded bg-blue-600 text-white text-xs font-semibold"
                          onClick={() => startEdit(tenant)}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold disabled:opacity-60"
                          onClick={() => void deleteTenant(tenant.id, tenant.name)}
                          disabled={isLoading}
                        >
                          Excluir
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {sortedTenants.length === 0 ? (
              <tr>
                <td className="px-4 py-8 text-slate-500" colSpan={7}>
                  Nenhuma empresa cadastrada.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}
