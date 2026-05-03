'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function SignupPage() {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ companyName, slug, name, email, password }),
    });

    const data = await response.json();
    if (!response.ok) {
      setError(data.error || 'Falha ao criar conta.');
      setLoading(false);
      return;
    }

    router.push('/');
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-xl bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">
        <p className="text-xs uppercase tracking-widest text-emerald-400 font-bold mb-2">Onboarding SaaS</p>
        <h1 className="text-2xl font-black mb-1">Criar Nova Empresa</h1>
        <p className="text-sm text-slate-400 mb-6">
          Cadastre sua empresa e o primeiro administrador do sistema.
        </p>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <input
            className="md:col-span-2 w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Nome da empresa"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            required
          />
          <input
            className="md:col-span-2 w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Slug da empresa (ex: burger-centro)"
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
          />
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Seu nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <input
            className="w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Seu e-mail"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="md:col-span-2 w-full rounded-lg bg-slate-800 border border-slate-700 p-3 text-sm"
            placeholder="Senha (mínimo 8 caracteres)"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
          />

          {error ? <p className="md:col-span-2 text-sm text-red-400">{error}</p> : null}

          <button
            disabled={loading}
            className="md:col-span-2 w-full rounded-lg bg-emerald-500 text-slate-950 font-bold p-3 disabled:opacity-60"
          >
            {loading ? 'Criando empresa...' : 'Criar Empresa e Entrar'}
          </button>
        </form>

        <p className="text-xs text-slate-400 mt-6">
          Já tem conta?{' '}
          <Link href="/login" className="text-emerald-400 font-semibold">
            Entrar no painel
          </Link>
        </p>
      </div>
    </main>
  );
}
