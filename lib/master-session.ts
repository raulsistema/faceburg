import { createHmac, timingSafeEqual } from 'node:crypto';
import { MASTER_SESSION_COOKIE_NAME, SESSION_DURATION_MS } from '@/lib/auth-constants';
import { getSessionSecret } from '@/lib/session';

export type MasterSession = {
  email: string;
  exp: number;
};

function getSecret() {
  return getSessionSecret();
}

function sign(payload: string) {
  return createHmac('sha256', getSecret()).update(payload).digest('hex');
}

export function createMasterSession(email: string) {
  const session: MasterSession = {
    email,
    exp: Date.now() + SESSION_DURATION_MS,
  };
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

export function parseMasterSession(token?: string | null) {
  if (!token) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload);
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const signatureBuffer = Buffer.from(signature, 'utf8');
  if (
    expectedBuffer.length !== signatureBuffer.length
    || !timingSafeEqual(expectedBuffer, signatureBuffer)
  ) {
    return null;
  }

  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as MasterSession;
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function getMasterCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    maxAge: Math.floor(SESSION_DURATION_MS / 1000),
  };
}

export { MASTER_SESSION_COOKIE_NAME };
