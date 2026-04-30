'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function MasterLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/master/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await response.json();

    if (!response.ok) {
      setError(data.error || 'Falha ao autenticar.');
      setLoading(false);
      return;
    }

    router.push('/empresas');
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-2">Master Admin</p>
        <h1 className="text-2xl font-black mb-1">Entrar para Gerenciar Empresas</h1>
        <p className="text-sm text-slate-400 mb-6">Use as credenciais master definidas no arquivo .env.</p>

        <form onSubmit={onSubmit} className="space-y-4">
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="E-mail master"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Senha master"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button disabled={loading} className="w-full rounded-lg bg-emerald-500 text-slate-950 font-bold p-3 disabled:opacity-60">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </main>
  );
}
