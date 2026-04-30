import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireMasterSession } from '@/lib/master-auth';
import { hashPassword } from '@/lib/password';

type TenantUserRow = {
  id: string;
  tenant_id: string;
  tenant_name: string;
  name: string;
  email: string;
  role: 'admin' | 'staff' | 'kitchen';
  created_at: string;
};

export async function GET(request: Request) {
  const session = await requireMasterSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const tenantId = String(searchParams.get('tenantId') || '').trim();
  if (!tenantId) {
    return NextResponse.json({ error: 'tenantId é obrigatório.' }, { status: 400 });
  }

  const result = await query<TenantUserRow>(
    `SELECT
      u.id,
      u.tenant_id,
      t.name AS tenant_name,
      u.name,
      u.email,
      u.role,
      u.created_at
    FROM tenant_users u
    JOIN tenants t ON t.id = u.tenant_id
    WHERE u.tenant_id = $1
    ORDER BY u.created_at ASC`,
    [tenantId],
  );

  return NextResponse.json({ users: result.rows });
}

export async function POST(request: Request) {
  const session = await requireMasterSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json();
  const tenantId = String(body.tenantId || '').trim();
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const role = String(body.role || 'staff').trim() as 'admin' | 'staff' | 'kitchen';
  const password = String(body.password || '');

  if (!tenantId || !name || !email || !password) {
    return NextResponse.json({ error: 'tenantId, nome, e-mail e senha são obrigatórios.' }, { status: 400 });
  }
  if (!['admin', 'staff', 'kitchen'].includes(role)) {
    return NextResponse.json({ error: 'Role inválida.' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: 'Senha deve ter no mínimo 8 caracteres.' }, { status: 400 });
  }

  try {
    const result = await query<TenantUserRow>(
      `INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, role)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tenant_id, ''::text AS tenant_name, name, email, role, created_at`,
      [randomUUID(), tenantId, name, email, hashPassword(password), role],
    );
    return NextResponse.json({ user: result.rows[0] }, { status: 201 });
  } catch (error: unknown) {
    if (typeof error === 'object' && error && 'code' in error && error.code === '23505') {
      return NextResponse.json({ error: 'E-mail já existe nessa empresa.' }, { status: 409 });
    }
    return NextResponse.json({ error: 'Falha ao criar usuário.' }, { status: 500 });
  }
}

