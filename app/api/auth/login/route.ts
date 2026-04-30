import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { verifyPassword } from '@/lib/password';
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from '@/lib/auth-constants';
import { buildSession, ensureSessionSecretConfigured, serializeSession } from '@/lib/session';

type LoginRow = {
  user_id: string;
  tenant_id: string;
  tenant_name: string;
  tenant_slug: string;
  user_name: string;
  email: string;
  role: 'admin' | 'staff' | 'kitchen';
  password_hash: string;
  tenant_status: string;
};

export async function POST(request: Request) {
  try {
    ensureSessionSecretConfigured();

    const body = await request.json();
    const slug = String(body.slug || '').trim().toLowerCase();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!slug || !email || !password) {
      return NextResponse.json({ error: 'Informe empresa, e-mail e senha.' }, { status: 400 });
    }

    const result = await query<LoginRow>(
      `SELECT
         tu.id AS user_id,
         tu.tenant_id,
         t.name AS tenant_name,
         t.slug AS tenant_slug,
         t.status AS tenant_status,
         tu.name AS user_name,
         tu.email,
         tu.role,
         tu.password_hash
       FROM tenant_users tu
       JOIN tenants t ON t.id = tu.tenant_id
       WHERE t.slug = $1 AND tu.email = $2
       LIMIT 1`,
      [slug, email],
    );

    if (!result.rowCount) {
      return NextResponse.json({ error: 'Credenciais invalidas.' }, { status: 401 });
    }

    const user = result.rows[0];
    if (user.tenant_status !== 'active') {
      return NextResponse.json({ error: 'Empresa inativa. Fale com o suporte.' }, { status: 403 });
    }

    const validPassword = verifyPassword(password, user.password_hash);
    if (!validPassword) {
      return NextResponse.json({ error: 'Credenciais invalidas.' }, { status: 401 });
    }

    const session = buildSession({
      userId: user.user_id,
      tenantId: user.tenant_id,
      email: user.email,
      name: user.user_name,
      role: user.role,
    });

    const response = NextResponse.json({
      ok: true,
      tenant: {
        id: user.tenant_id,
        name: user.tenant_name,
        slug: user.tenant_slug,
      },
    });

    response.cookies.set(SESSION_COOKIE_NAME, serializeSession(session), {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return response;
  } catch (error) {
    console.error('login error', error);
    if (error instanceof Error && error.message.includes('AUTH_SECRET')) {
      return NextResponse.json({ error: 'Configuracao de autenticacao ausente no servidor.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Falha ao autenticar.' }, { status: 500 });
  }
}
