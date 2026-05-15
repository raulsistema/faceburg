import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';

declare global {
  var __faceburgOrderSequenceSchemaReady: boolean | undefined;
  var __faceburgOrderSequenceSchemaPromise: Promise<void> | null | undefined;
}

type TenantSequenceRow = {
  order_sequence_start: number | string | null;
};

type OrderSequenceRow = {
  order_sequence_number: number | string | null;
};

type CounterRow = {
  order_sequence_number: number | string;
};

const defaultExecutor: DbExecutor = { query };
let schemaReady = globalThis.__faceburgOrderSequenceSchemaReady ?? false;
let schemaPromise = globalThis.__faceburgOrderSequenceSchemaPromise ?? null;

async function runOrderSequenceSchema(executor: DbExecutor) {
  await executor.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'tenants' AND column_name = 'order_sequence_start'
      ) THEN
        ALTER TABLE tenants ADD COLUMN order_sequence_start INTEGER;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'order_sequence_number'
      ) THEN
        ALTER TABLE orders ADD COLUMN order_sequence_number INTEGER;
      END IF;
    END $$;
  `);

  await executor.query(`
    CREATE TABLE IF NOT EXISTS order_sequence_counters (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      cash_session_id TEXT NOT NULL REFERENCES cash_register_sessions(id) ON DELETE CASCADE,
      next_number INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, cash_session_id)
    );
  `);

  await executor.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_tenant_cash_sequence_number
      ON orders(tenant_id, cash_session_id, order_sequence_number)
      WHERE order_sequence_number IS NOT NULL
        AND cash_session_id IS NOT NULL;
  `);
}

export async function ensureOrderSequenceSchema(executor: DbExecutor = defaultExecutor) {
  if (schemaReady) return;

  if (executor.query !== query) {
    await runOrderSequenceSchema(executor);
    return;
  }

  if (!schemaPromise) {
    schemaPromise = runOrderSequenceSchema(executor)
      .then(() => {
        schemaReady = true;
        globalThis.__faceburgOrderSequenceSchemaReady = true;
      })
      .catch((error) => {
        schemaReady = false;
        globalThis.__faceburgOrderSequenceSchemaReady = false;
        throw error;
      })
      .finally(() => {
        schemaPromise = null;
        globalThis.__faceburgOrderSequenceSchemaPromise = null;
      });
    globalThis.__faceburgOrderSequenceSchemaPromise = schemaPromise;
  }

  await schemaPromise;
}

function normalizeSequenceStart(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed) || parsed < 1) return null;
  return parsed;
}

export async function assignOrderSequenceNumber(
  tenantId: string,
  orderId: string,
  cashSessionId: string | null | undefined,
  executor: DbExecutor = defaultExecutor,
) {
  const normalizedTenantId = String(tenantId || '').trim();
  const normalizedOrderId = String(orderId || '').trim();
  const normalizedCashSessionId = String(cashSessionId || '').trim();
  if (!normalizedTenantId || !normalizedOrderId || !normalizedCashSessionId) {
    return null;
  }

  await ensureOrderSequenceSchema(executor);

  const tenantResult = await executor.query<TenantSequenceRow>(
    `SELECT order_sequence_start
     FROM tenants
     WHERE id = $1
     LIMIT 1`,
    [normalizedTenantId],
  );
  const sequenceStart = normalizeSequenceStart(tenantResult.rows[0]?.order_sequence_start);
  if (sequenceStart === null) {
    return null;
  }

  const currentOrderResult = await executor.query<OrderSequenceRow>(
    `SELECT order_sequence_number
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1
     FOR UPDATE`,
    [normalizedTenantId, normalizedOrderId],
  );
  if (!currentOrderResult.rowCount) {
    return null;
  }

  const currentNumber = currentOrderResult.rows[0]?.order_sequence_number;
  if (currentNumber !== null && currentNumber !== undefined) {
    const parsedCurrentNumber = Number(currentNumber);
    return Number.isFinite(parsedCurrentNumber) ? parsedCurrentNumber : null;
  }

  await executor.query(
    `INSERT INTO order_sequence_counters
       (tenant_id, cash_session_id, next_number)
     VALUES
       ($1, $2, $3)
     ON CONFLICT (tenant_id, cash_session_id) DO NOTHING`,
    [normalizedTenantId, normalizedCashSessionId, sequenceStart],
  );

  const counterResult = await executor.query<CounterRow>(
    `WITH locked_counter AS (
       SELECT next_number
       FROM order_sequence_counters
       WHERE tenant_id = $1
         AND cash_session_id = $2
       FOR UPDATE
     ),
     next_value AS (
       SELECT GREATEST(
         COALESCE((SELECT next_number FROM locked_counter), $3::integer),
         $3::integer,
         COALESCE((
           SELECT MAX(order_sequence_number) + 1
           FROM orders
           WHERE tenant_id = $1
             AND cash_session_id = $2
             AND order_sequence_number IS NOT NULL
         ), $3::integer)
       ) AS order_sequence_number
     )
     UPDATE order_sequence_counters
     SET next_number = (SELECT order_sequence_number + 1 FROM next_value),
         updated_at = NOW()
     WHERE tenant_id = $1
       AND cash_session_id = $2
     RETURNING (SELECT order_sequence_number FROM next_value) AS order_sequence_number`,
    [normalizedTenantId, normalizedCashSessionId, sequenceStart],
  );
  const nextNumber = Number(counterResult.rows[0]?.order_sequence_number);
  if (!Number.isFinite(nextNumber)) {
    return null;
  }

  await executor.query(
    `UPDATE orders
     SET order_sequence_number = $3,
         cash_session_id = COALESCE(cash_session_id, $4)
     WHERE tenant_id = $1
       AND id = $2
       AND order_sequence_number IS NULL`,
    [normalizedTenantId, normalizedOrderId, nextNumber, normalizedCashSessionId],
  );

  return nextNumber;
}
