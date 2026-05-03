'use client';

import { useRouter } from 'next/navigation';

export default function MasterLogoutButton() {
  const router = useRouter();

  async function onLogout() {
    await fetch('/api/master/auth/logout', { method: 'POST' });
    router.push('/master/login');
  }

  return (
    <button
      onClick={onLogout}
      className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold hover:bg-slate-700 transition-colors"
    >
      Sair
    </button>
  );
}
