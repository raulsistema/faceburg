import { NextResponse } from 'next/server';
import { MASTER_SESSION_COOKIE_NAME, createMasterSession, getMasterCookieOptions } from '@/lib/master-session';

export async function POST(request: Request) {
  const body = await request.json();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  const masterEmail = String(process.env.MASTER_ADMIN_EMAIL || '').trim().toLowerCase();
  const masterPassword = String(process.env.MASTER_ADMIN_PASSWORD || '');

  if (!masterEmail || !masterPassword) {
    return NextResponse.json({ error: 'Login master não configurado no .env.' }, { status: 500 });
  }

  if (email !== masterEmail || password !== masterPassword) {
    return NextResponse.json({ error: 'Credenciais inválidas.' }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(MASTER_SESSION_COOKIE_NAME, createMasterSession(masterEmail), getMasterCookieOptions());
  return response;
}
