import { NextResponse } from 'next/server';
import { MASTER_SESSION_COOKIE_NAME } from '@/lib/master-session';

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(MASTER_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return response;
}
