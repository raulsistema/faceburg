'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LayoutDashboard, ShoppingBag, Monitor, UtensilsCrossed, Users, Settings, LogOut, Landmark, CreditCard, X, BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { name: 'Dashboard', icon: LayoutDashboard, href: '/' },
  { name: 'Pedidos', icon: ShoppingBag, href: '/pedidos' },
  { name: 'PDV / Caixa', icon: Monitor, href: '/pdv' },
  { name: 'Relatorios', icon: BarChart3, href: '/relatorios' },
  { name: 'Financeiro', icon: Landmark, href: '/financeiro' },
  { name: 'Formas Pagamento', icon: CreditCard, href: '/formas-pagamento' },
  { name: 'Clientes', icon: Users, href: '/clientes' },
  { name: 'Cardapio Admin', icon: UtensilsCrossed, href: '/cardapio-admin' },
  { name: 'Configuracoes', icon: Settings, href: '/settings' },
];

type SidebarProps = {
  mobileOpen?: boolean;
  onCloseMobile?: () => void;
};

export default function Sidebar({ mobileOpen = false, onCloseMobile }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    onCloseMobile?.();
    router.push('/login');
    router.refresh();
  }

  return (
    <aside
      className={cn(
        'w-[220px] bg-brand-sidebar flex flex-col h-screen border-r border-slate-800',
        'fixed top-0 left-0 z-50 -translate-x-full transition-transform duration-200 ease-out',
        mobileOpen ? 'translate-x-0' : '',
        'lg:sticky lg:translate-x-0',
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
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 text-slate-200 lg:hidden"
            onClick={() => onCloseMobile?.()}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <nav className="mt-4 flex-1">
        <div className="px-6 py-2 text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Operacao</div>
        {navItems.map((item) => {
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
