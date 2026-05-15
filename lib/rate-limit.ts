import { query, type DbExecutor } from '@/lib/db';

type RateLimitOptions = {
  key: string;
  limit: number;
  windowSeconds: number;
  executor?: DbExecutor;
};

type RateLimitRow = {
  count: number | string;
  reset_at: string;
};

let rateLimitSchemaPromise: Promise<void> | null = null;

async function ensureRateLimitSchema(executor: DbExecutor = { query }) {
  if (!rateLimitSchemaPromise) {
    rateLimitSchemaPromise = executor.query(`
      CREATE TABLE IF NOT EXISTS public_rate_limits (
        key TEXT PRIMARY KEY,
        window_start TIMESTAMPTZ NOT NULL,
        count INTEGER NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((error) => {
      rateLimitSchemaPromise = null;
      throw error;
    });
  }

  await rateLimitSchemaPromise;
}

export async function checkRateLimit({
  key,
  limit,
  windowSeconds,
  executor = { query },
}: RateLimitOptions) {
  await ensureRateLimitSchema(executor);
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const normalizedWindow = Math.max(1, Math.floor(windowSeconds));
  const result = await executor.query<RateLimitRow>(
    `INSERT INTO public_rate_limits (key, window_start, count, updated_at)
     VALUES ($1, NOW(), 1, NOW())
     ON CONFLICT (key) DO UPDATE
       SET window_start = CASE
             WHEN public_rate_limits.window_start <= NOW() - ($2::int * INTERVAL '1 second')
             THEN NOW()
             ELSE public_rate_limits.window_start
           END,
           count = CASE
             WHEN public_rate_limits.window_start <= NOW() - ($2::int * INTERVAL '1 second')
             THEN 1
             ELSE public_rate_limits.count + 1
           END,
           updated_at = NOW()
     RETURNING count,
               window_start + ($2::int * INTERVAL '1 second') AS reset_at`,
    [key, normalizedWindow],
  );

  const row = result.rows[0];
  const count = Number(row?.count || 0);
  const resetAt = row?.reset_at ? new Date(row.reset_at) : new Date(Date.now() + normalizedWindow * 1000);

  return {
    allowed: count <= normalizedLimit,
    remaining: Math.max(0, normalizedLimit - count),
    resetAt,
    retryAfterSeconds: Math.max(1, Math.ceil((resetAt.getTime() - Date.now()) / 1000)),
  };
}
