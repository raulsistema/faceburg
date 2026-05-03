import { ensureDbInitialized } from '@/lib/db';

declare global {
  var __faceburgFinanceSchemaReady: boolean | undefined;
  var __faceburgFinanceSchemaPromise: Promise<void> | null | undefined;
}

let initialized = globalThis.__faceburgFinanceSchemaReady ?? false;
let ensurePromise = globalThis.__faceburgFinanceSchemaPromise ?? null;

export async function ensureFinanceSchema() {
  if (initialized) return;
  if (ensurePromise) return ensurePromise;

  ensurePromise = (async () => {
    await ensureDbInitialized();
    initialized = true;
    globalThis.__faceburgFinanceSchemaReady = true;
  })()
    .catch((error) => {
      initialized = false;
      globalThis.__faceburgFinanceSchemaReady = false;
      throw error;
    })
    .finally(() => {
      ensurePromise = null;
      globalThis.__faceburgFinanceSchemaPromise = null;
    });

  globalThis.__faceburgFinanceSchemaPromise = ensurePromise;
  return ensurePromise;
}
