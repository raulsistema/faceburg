import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SESSION_COOKIE_NAME, SESSION_DURATION_MS } from '@/lib/auth-constants';

export type AppSession = {
  userId: string;
  tenantId: string;
  email: string;
  name: string;
  role: 'admin' | 'staff' | 'kitchen';
  exp: number;
};

export function getSessionSecret() {
  const configuredSecret = process.env.AUTH_SECRET?.trim();
  if (configuredSecret) {
    return configuredSecret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('AUTH_SECRET must be configured in production.');
  }

  return 'dev-only-auth-secret-change-me';
}

export function ensureSessionSecretConfigured() {
  getSessionSecret();
}

function sign(data: string) {
  return createHmac('sha256', getSessionSecret()).update(data).digest('hex');
}

function encodeSession(session: AppSession) {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url');
  const signature = sign(payload);
  return `${payload}.${signature}`;
}

function decodeSession(value?: string | null): AppSession | null {
  if (!value) return null;

  const [payload, signature] = value.split('.');
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
    const json = Buffer.from(payload, 'base64url').toString('utf8');
    const session = JSON.parse(json) as AppSession;
    if (!session.exp || session.exp < Date.now()) return null;
    return session;
  } catch {
    return null;
  }
}

export function buildSession(input: Omit<AppSession, 'exp'>): AppSession {
  return {
    ...input,
    exp: Date.now() + SESSION_DURATION_MS,
  };
}

export function serializeSession(session: AppSession) {
  return encodeSession(session);
}

export function parseSession(token?: string | null) {
  return decodeSession(token);
}

export async function getCurrentSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  return parseSession(token);
}
