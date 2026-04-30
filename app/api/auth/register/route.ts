import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import pool, { query } from '@/lib/db';
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from '@/lib/auth-constants';
import { buildSession, ensureSessionSecretConfigured, serializeSession } from '@/lib/session';
import { hashPassword } from '@/lib/password';

function toSlug(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function POST(request: Request) {
  try {
    ensureSessionSecretConfigured();

    const body = await request.json();
    const companyName = String(body.companyName || '').trim();
    const desiredSlug = String(body.slug || '').trim();
    const name = String(body.name || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');

    if (!companyName || !name || !email || !password) {
      return NextResponse.json({ error: 'Preencha todos os campos obrigatorios.' }, { status: 400 });
    }

    if (password.length < 8) {
      return NextResponse.json({ error: 'A senha deve ter no minimo 8 caracteres.' }, { status: 400 });
    }

    const slug = toSlug(desiredSlug || companyName);
    if (!slug || slug.length < 3) {
      return NextResponse.json({ error: 'Slug invalido. Use pelo menos 3 caracteres.' }, { status: 400 });
    }

    const existing = await query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1 LIMIT 1', [slug]);
    if (existing.rowCount) {
      return NextResponse.json({ error: 'Este slug ja esta em uso por outra empresa.' }, { status: 409 });
    }

    const tenantId = randomUUID();
    const userId = randomUUID();
    const passwordHash = hashPassword(password);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO tenants (id, name, slug, plan, status)
         VALUES ($1, $2, $3, 'starter', 'active')`,
        [tenantId, companyName, slug],
      );
      await client.query(
        `INSERT INTO tenant_users (id, tenant_id, name, email, password_hash, role)
         VALUES ($1, $2, $3, $4, $5, 'admin')`,
        [userId, tenantId, name, email, passwordHash],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    const session = buildSession({ userId, tenantId, email, name, role: 'admin' });
    const token = serializeSession(session);

    const response = NextResponse.json({
      ok: true,
      tenant: { id: tenantId, name: companyName, slug, plan: 'starter' },
    });

    response.cookies.set(SESSION_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: Math.floor(SESSION_DURATION_MS / 1000),
    });

    return response;
  } catch (error) {
    console.error('register error', error);
    if (error instanceof Error && error.message.includes('AUTH_SECRET')) {
      return NextResponse.json({ error: 'Configuracao de autenticacao ausente no servidor.' }, { status: 500 });
    }
    return NextResponse.json({ error: 'Nao foi possivel criar sua conta agora.' }, { status: 500 });
  }
}
