import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const KEY_LENGTH = 64;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, storedHash: string) {
  const [salt, originalHash] = storedHash.split(':');
  if (!salt || !originalHash) {
    return false;
  }

  const currentHash = scryptSync(password, salt, KEY_LENGTH).toString('hex');
  const original = Buffer.from(originalHash, 'hex');
  const current = Buffer.from(currentHash, 'hex');

  if (original.length !== current.length) {
    return false;
  }

  return timingSafeEqual(original, current);
}
