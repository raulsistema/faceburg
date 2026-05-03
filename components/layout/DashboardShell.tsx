'use client';

import React, { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import Sidebar from './Sidebar';

type MeResponse = {
  authenticated: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  tenant?: {
    id: string;
    name: string;
    slug: string;
    plan: string;
  };
};

const ME_CACHE_TTL_MS = 60_000;

type MeCacheEntry = {
  data: MeResponse | null;
  loadedAt: number;
};

let sharedMeCache: MeCacheEntry | undefined;
let sharedMePromise: Promise<MeResponse | null> | null = null;

function getCachedMe() {
  if (!sharedMeCache) return undefined;
  if (Date.now() - sharedMeCache.loadedAt > ME_CACHE_TTL_MS) {
    sharedMeCache = undefined;
    return undefined;
  }
  return sharedMeCache.data;
}

async function loadMeOnce(forceRefresh = false) {
  if (!forceRefresh) {
    const cached = getCachedMe();
    if (cached !== undefined) {
      return cached;
    }
  }

  if (!sharedMePromise) {
    sharedMePromise = (async () => {
      const response = await fetch('/api/auth/me', { cache: 'no-store' });
      if (!response.ok) {
        sharedMeCache = { data: null, loadedAt: Date.now() };
        return null;
      }

      const json = (await response.json()) as MeResponse;
      sharedMeCache = { data: json, loadedAt: Date.now() };
      return json;
    })().finally(() => {
      sharedMePromise = null;
    });
  }

  return sharedMePromise;
}

export default function DashboardShell({
  children,
  initialData,
  overlaySidebar = false,
}: {
  children: React.ReactNode;
  initialData?: MeResponse | null;
  overlaySidebar?: boolean;
}) {
  const [data, setData] = useState<MeResponse | null>(initialData ?? null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    if (initialData) {
      sharedMeCache = { data: initialData, loadedAt: Date.now() };
      setData(initialData);
      return;
    }

    const cached = getCachedMe();
    if (cached !== undefined) {
      setData(cached);
    }

    let mounted = true;
    async function load(forceRefresh = false) {
      try {
        const json = await loadMeOnce(forceRefresh);
        if (mounted) {
          setData(json);
        }
      } catch {
        // Keep shell functional even if auth endpoint is temporarily unavailable.
      }
    }
    if (cached === undefined) {
      void load();
    }

    function handleAuthChange() {
      sharedMeCache = undefined;
      sharedMePromise = null;
      setData(null);
      void load(true);
    }

    window.addEventListener('faceburg-auth-changed', handleAuthChange);
    return () => {
      mounted = false;
      window.removeEventListener('faceburg-auth-changed', handleAuthChange);
    };
  }, [initialData]);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar mobileOpen={mobileMenuOpen} overlayMode={overlaySidebar} onCloseMobile={() => setMobileMenuOpen(false)} />
      {mobileMenuOpen ? (
        <button
          type="button"
          aria-label="Fechar menu lateral"
          className={overlaySidebar ? 'fixed inset-0 z-40 bg-slate-950/45' : 'fixed inset-0 z-40 bg-slate-950/45 lg:hidden'}
          onClick={() => setMobileMenuOpen(false)}
        />
      ) : null}
      <main className="flex-1 flex flex-col h-screen bg-slate-50">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-6 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={overlaySidebar ? 'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700' : 'inline-flex h-10 w-10 items-center justify-center rounded-xl border border-slate-200 text-slate-700 lg:hidden'}
              aria-label={mobileMenuOpen ? 'Fechar menu lateral' : 'Abrir menu lateral'}
              onClick={() => setMobileMenuOpen((current) => !current)}
            >
              {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
            <div>
            <h1 className="text-lg font-bold text-slate-900 m-0">Painel de Gestao</h1>
            <p className="text-[11px] text-slate-500 m-0">
              {data?.tenant ? `${data.tenant.name} - plano ${data.tenant.plan}` : 'Operacao em tempo real'}
            </p>
            </div>
          </div>
          <div className="flex items-center gap-5">
            <div className="text-right hidden sm:block">
              <div className="text-xs font-bold text-slate-900">{data?.user?.name || 'Usuario'}</div>
              <div className="text-[10px] text-slate-500 font-medium">{data?.user?.email || ''}</div>
            </div>
          </div>
        </header>
        <div className="flex-1 overflow-y-auto p-6">{children}</div>
        <footer className="h-12 bg-white border-t border-slate-200 flex items-center justify-between px-6 text-xs text-slate-400 shrink-0">
          <div>
            Tenant: <strong className="text-slate-700">{data?.tenant?.slug || 'n/a'}</strong>
          </div>
          <div className="flex gap-6">
            <span>Suporte: 0800 123 456</span>
            <span className="font-mono">v1.3.0-SaaS</span>
          </div>
        </footer>
      </main>
    </div>
  );
}
