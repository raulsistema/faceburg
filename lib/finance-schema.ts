import { query } from '@/lib/db';

let initialized = false;

export async function ensureFinanceSchema() {
  if (initialized) return;

  await query(`
    CREATE TABLE IF NOT EXISTS payment_methods (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      method_type TEXT NOT NULL,
      fee_percent NUMERIC(8,4) NOT NULL DEFAULT 0,
      fee_fixed NUMERIC(10,2) NOT NULL DEFAULT 0,
      settlement_days INTEGER NOT NULL DEFAULT 0,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS cash_register_sessions (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      opened_by_user_id TEXT REFERENCES tenant_users(id) ON DELETE SET NULL,
      closed_by_user_id TEXT REFERENCES tenant_users(id) ON DELETE SET NULL,
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      opening_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      closing_amount_reported NUMERIC(10,2),
      closing_amount_expected NUMERIC(10,2),
      difference_amount NUMERIC(10,2),
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'open'
    );

    CREATE TABLE IF NOT EXISTS cash_movements (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES cash_register_sessions(id) ON DELETE CASCADE,
      movement_type TEXT NOT NULL,
      amount NUMERIC(10,2) NOT NULL,
      description TEXT,
      reference_order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
      created_by_user_id TEXT REFERENCES tenant_users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS receivables (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
      payment_method_id TEXT REFERENCES payment_methods(id) ON DELETE SET NULL,
      gross_amount NUMERIC(10,2) NOT NULL,
      fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
      net_amount NUMERIC(10,2) NOT NULL,
      due_date DATE NOT NULL,
      received_at TIMESTAMPTZ,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'payment_method_id'
      ) THEN
        ALTER TABLE orders ADD COLUMN payment_method_id TEXT;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'payment_fee_amount'
      ) THEN
        ALTER TABLE orders ADD COLUMN payment_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'payment_net_amount'
      ) THEN
        ALTER TABLE orders ADD COLUMN payment_net_amount NUMERIC(10,2);
        UPDATE orders SET payment_net_amount = total WHERE payment_net_amount IS NULL;
        ALTER TABLE orders ALTER COLUMN payment_net_amount SET NOT NULL;
      END IF;
    END $$;
  `);

  initialized = true;
}
