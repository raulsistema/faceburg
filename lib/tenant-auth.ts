import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import type { AppSession } from '@/lib/session';
import { getCurrentSession } from '@/lib/session';

export type TenantRole = AppSession['role'];
export type ValidatedTenantSession = AppSession;

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

export async function getValidatedTenantSession(): Promise<ValidatedTenantSession | null> {
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

export function tenantSessionHasRole(
  session: { role: TenantRole } | null | undefined,
  allowedRoles: readonly TenantRole[],
) {
  return Boolean(session && allowedRoles.includes(session.role));
}

export async function requireTenantSession(allowedRoles?: readonly TenantRole[]) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  if (allowedRoles?.length && !tenantSessionHasRole(session, allowedRoles)) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Sem permissao para esta acao.' }, { status: 403 }),
    };
  }

  return {
    session,
    response: null,
  };
}
