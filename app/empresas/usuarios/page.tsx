'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';

type Tenant = { id: string; name: string; slug: string };
type TenantUser = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'kitchen';
  created_at: string;
};

export default function EmpresasUsuariosPage() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'staff' | 'kitchen'>('staff');
  const [password, setPassword] = useState('');

  const loadTenants = useCallback(async () => {
    const response = await fetch('/api/master/tenants', { cache: 'no-store' });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao carregar empresas.');
      return;
    }
    const list = (data.tenants || []) as Tenant[];
    setTenants(list);
    setTenantId((current) => current || list[0]?.id || '');
  }, []);

  const loadUsers = useCallback(async (targetTenantId: string) => {
    if (!targetTenantId) return;
    const response = await fetch(`/api/master/tenant-users?tenantId=${encodeURIComponent(targetTenantId)}`, {
      cache: 'no-store',
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao carregar usuarios.');
      return;
    }
    setUsers((data.users || []) as TenantUser[]);
  }, []);

  useEffect(() => {
    void loadTenants();
  }, [loadTenants]);

  useEffect(() => {
    void loadUsers(tenantId);
  }, [loadUsers, tenantId]);

  async function onCreate(event: FormEvent) {
    event.preventDefault();
    setError('');
    const response = await fetch('/api/master/tenant-users', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ tenantId, name, email, role, password }),
    });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao criar usuario.');
      return;
    }
    setName('');
    setEmail('');
    setRole('staff');
    setPassword('');
    await loadUsers(tenantId);
  }

  async function onDelete(id: string) {
    const response = await fetch(`/api/master/tenant-users/${id}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao excluir usuario.');
      return;
    }
    await loadUsers(tenantId);
  }

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
          <h1 className="text-2xl font-black text-slate-900">Usuarios por Empresa</h1>
          <p className="text-sm text-slate-500 mt-1">Gestao de usuarios (admin, staff e kitchen) por tenant.</p>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          <label className="text-sm font-semibold text-slate-700">
            Empresa
            <select
              className="w-full mt-2 border border-slate-200 rounded-lg px-3 py-2 text-sm"
              value={tenantId}
              onChange={(e) => setTenantId(e.target.value)}
            >
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.slug})
                </option>
              ))}
            </select>
          </label>

          <form onSubmit={onCreate} className="grid md:grid-cols-4 gap-3">
            <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Nome" value={name} onChange={(e) => setName(e.target.value)} required />
            <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" type="email" placeholder="E-mail" value={email} onChange={(e) => setEmail(e.target.value.toLowerCase())} required />
            <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'staff' | 'kitchen')}>
              <option value="admin">admin</option>
              <option value="staff">staff</option>
              <option value="kitchen">kitchen</option>
            </select>
            <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" type="password" minLength={8} placeholder="Senha (min 8)" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <button className="md:col-span-4 w-fit px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-semibold" type="submit">
              Criar usuario
            </button>
          </form>
          {error ? <p className="text-sm text-rose-600">{error}</p> : null}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3">Nome</th>
                <th className="text-left px-4 py-3">E-mail</th>
                <th className="text-left px-4 py-3">Role</th>
                <th className="text-left px-4 py-3">Cadastro</th>
                <th className="text-left px-4 py-3">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">{user.name}</td>
                  <td className="px-4 py-3">{user.email}</td>
                  <td className="px-4 py-3">{user.role}</td>
                  <td className="px-4 py-3">{new Date(user.created_at).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3">
                    <button className="px-3 py-1.5 rounded bg-rose-600 text-white text-xs font-semibold" onClick={() => void onDelete(user.id)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
              {users.length === 0 ? (
                <tr>
                  <td className="px-4 py-6 text-slate-500" colSpan={5}>Nenhum usuario cadastrado para esta empresa.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </main>
  );
}
