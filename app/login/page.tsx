'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const router = useRouter();

  const [slug, setSlug] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug, email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao entrar.');
      setLoading(false);
      return;
    }

    router.push('/');
    router.refresh();
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <p className="text-xs uppercase tracking-widest text-cyan-400 font-bold mb-2">Faceburg SaaS</p>
        <h1 className="text-2xl font-black mb-1">Entrar no Painel</h1>
        <p className="text-sm text-slate-400 mb-6">Acesse sua empresa com slug, e-mail e senha.</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Slug da empresa (ex: pizza-burger)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="E-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Senha"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          {error ? <p className="text-sm text-red-400">{error}</p> : null}
          <button disabled={loading} className="w-full rounded-lg bg-cyan-500 text-slate-950 font-bold p-3 disabled:opacity-60">
            {loading ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-6">
          Ainda nao tem empresa?{' '}
          <Link href="/signup" className="text-cyan-400 font-semibold">
            Criar conta SaaS
          </Link>
        </p>
        <p className="text-xs text-slate-500 mt-2">
          Login master?{' '}
          <Link href="/master/login" className="text-emerald-400 font-semibold">
            Gerenciar empresas
          </Link>
        </p>
      </div>
    </main>
  );
}
