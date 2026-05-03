'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ShoppingBag, Monitor, UtensilsCrossed, Users, Settings, LogOut, Landmark, X, BarChart3, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

type NavLinkItem = {
  name: string;
  icon: typeof LayoutDashboard;
  href: string;
};

type NavGroupItem = {
  name: string;
  icon: typeof Landmark;
  children: Array<{ name: string; href: string }>;
};

const navItems: Array<NavLinkItem | NavGroupItem> = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { name: 'Pedidos', icon: ShoppingBag, href: '/pedidos' },
  { name: 'PDV / Caixa', icon: Monitor, href: '/pdv' },
  { name: 'Relatorios', icon: BarChart3, href: '/relatorios' },
  {
    name: 'Financeiro',
    icon: Landmark,
    children: [
      { name: 'Caixas', href: '/financeiro/caixas' },
      { name: 'Movimentacoes', href: '/financeiro/movimentacoes' },
      { name: 'Formas Pagamento', href: '/financeiro/formas-pagamento' },
    ],
  },
  { name: 'Clientes', icon: Users, href: '/clientes' },
  { name: 'Cardapio Admin', icon: UtensilsCrossed, href: '/cardapio-admin' },
  { name: 'Configuracoes', icon: Settings, href: '/settings' },
];

type SidebarProps = {
  mobileOpen?: boolean;
  overlayMode?: boolean;
  onCloseMobile?: () => void;
};

export default function Sidebar({ mobileOpen = false, overlayMode = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const financeActive = pathname.startsWith('/financeiro') || pathname.startsWith('/formas-pagamento');
  const [financeOpen, setFinanceOpen] = useState(financeActive);

  useEffect(() => {
    if (financeActive) {
      setFinanceOpen(true);
    }
  }, [financeActive]);

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.dispatchEvent(new Event('faceburg-auth-changed'));
    onCloseMobile?.();
    router.push('/login');
  }

  return (
    <aside
      className={cn(
        'w-[220px] bg-brand-sidebar flex flex-col h-screen border-r border-slate-800',
        'fixed top-0 left-0 z-50 -translate-x-full transition-transform duration-200 ease-out',
        mobileOpen ? 'translate-x-0' : '',
        overlayMode ? '' : 'lg:sticky lg:translate-x-0',
      )}
    >
      <div className="p-6">
        <div className="flex items-center justify-between gap-3">
          <div className="text-brand-primary text-xl font-extrabold tracking-tighter">
            CHEFSYNC <span className="text-white opacity-50 font-normal ml-1">SaaS</span>
          </div>
          <button
            type="button"
            aria-label="Fechar menu lateral"
            className={cn(
              'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-200',
              overlayMode ? '' : 'lg:hidden',
            )}
            onClick={() => onCloseMobile?.()}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="mt-4 flex-1">
        <div className="px-6 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Operacao</div>
        {navItems.map((item) => {
          if ('children' in item) {
            return (
              <div key={item.name} className="px-2">
                <button
                  type="button"
                  onClick={() => setFinanceOpen((current) => !current)}
                  className={cn(
                    'sidebar-link w-full justify-between',
                    financeActive ? 'sidebar-link-active' : 'sidebar-link-inactive',
                  )}
                >
                  <span className="flex items-center gap-3">
                    <item.icon className={cn('w-4 h-4', financeActive ? 'text-brand-primary' : 'text-slate-500')} />
                    <span className="font-medium">{item.name}</span>
                  </span>
                  <ChevronDown className={cn('h-4 w-4 transition-transform', financeOpen ? 'rotate-180' : '', financeActive ? 'text-brand-primary' : 'text-slate-500')} />
                </button>

                {financeOpen ? (
                  <div className="mt-1 ml-4 border-l border-slate-800/80 pl-3 space-y-1">
                    {item.children.map((child) => {
                      const isChildActive = pathname === child.href;
                      return (
                        <Link
                          key={child.href}
                          href={child.href}
                          prefetch={false}
                          onClick={() => onCloseMobile?.()}
                          className={cn(
                            'flex items-center rounded-lg px-3 py-2 text-sm transition-colors',
                            isChildActive
                              ? 'bg-brand-primary/10 text-brand-primary font-semibold'
                              : 'text-slate-400 hover:bg-slate-800/40 hover:text-slate-100',
                          )}
                        >
                          {child.name}
                        </Link>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            );
          }

          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              onClick={() => onCloseMobile?.()}
              className={cn('sidebar-link', isActive ? 'sidebar-link-active' : 'sidebar-link-inactive')}
            >
              <item.icon className={cn('w-4 h-4', isActive ? 'text-brand-primary' : 'text-slate-500')} />
              <span className="font-medium">{item.name}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-100">
        <button
          onClick={handleLogout}
          className="flex items-center gap-3 w-full px-3 py-2 text-sm font-medium text-slate-600 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
        >
          <LogOut className="w-5 h-5" />
          Sair do Sistema
        </button>
      </div>
    </aside>
  );
}
