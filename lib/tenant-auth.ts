import { query } from '@/lib/db';
import type { AppSession } from '@/lib/session';
import { getCurrentSession } from '@/lib/session';

type TenantRow = {
  id: string;
  status: string;
};

type TenantUserRow = {
  id: string;
  tenant_id: string;
  name: string;
  email: string;
  role: AppSession['role'];
};

export async function getValidatedTenantSession() {
  const session = await getCurrentSession();
  if (!session) {
    return null;
  }

  const [tenantResult, tenantUserResult] = await Promise.all([
    query<TenantRow>('SELECT id, status FROM tenants WHERE id = $1 LIMIT 1', [session.tenantId]),
    query<TenantUserRow>(
      `SELECT id, tenant_id, name, email, role
       FROM tenant_users
       WHERE id = $1
         AND tenant_id = $2
       LIMIT 1`,
      [session.userId, session.tenantId],
    ),
  ]);

  if (!tenantResult.rowCount || !tenantUserResult.rowCount) {
    return null;
  }

  if (tenantResult.rows[0].status !== 'active') {
    return null;
  }

  const user = tenantUserResult.rows[0];
  return {
    ...session,
    tenantId: user.tenant_id,
    userId: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };
}
