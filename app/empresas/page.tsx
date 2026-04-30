import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { query } from '@/lib/db';
import { MASTER_SESSION_COOKIE_NAME, parseMasterSession } from '@/lib/master-session';
import MasterLogoutButton from './MasterLogoutButton';
import EmpresasCrud from './EmpresasCrud';
import Link from 'next/link';

type TenantRow = {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  created_at: string;
  admin_name: string | null;
  admin_email: string | null;
};

export default async function EmpresasPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(MASTER_SESSION_COOKIE_NAME)?.value;
  const session = parseMasterSession(token);

  if (!session) {
    redirect('/master/login');
  }

  const tenants = await query<TenantRow>(
    `SELECT
       t.id,
       t.name,
       t.slug,
       t.plan,
       t.status,
       t.created_at,
       tu.name AS admin_name,
       tu.email AS admin_email
     FROM tenants t
     LEFT JOIN LATERAL (
       SELECT name, email
       FROM tenant_users
       WHERE tenant_id = t.id AND role = 'admin'
       ORDER BY created_at ASC
       LIMIT 1
     ) tu ON TRUE
     ORDER BY created_at DESC
     LIMIT 200`,
  );

  const baseUrl = (process.env.APP_URL || '').replace(/\/+$/, '');

  return (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 mb-6 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-emerald-600 font-bold mb-1">Master Admin</p>
            <h1 className="text-2xl font-black text-slate-900">Empresas Cadastradas</h1>
            <p className="text-sm text-slate-500">{session.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/empresas/usuarios"
              className="px-3 py-2 rounded-lg bg-cyan-600 text-white text-sm font-semibold hover:bg-cyan-700"
            >
              Gerenciar Usuários
            </Link>
            <MasterLogoutButton />
          </div>
        </div>
        <EmpresasCrud initialTenants={tenants.rows} baseUrl={baseUrl} />
      </div>
    </main>
  );
}
