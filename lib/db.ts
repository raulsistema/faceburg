import { Pool } from 'pg';
import type { QueryResult, QueryResultRow } from 'pg';

declare global {
  var __faceburgPool: Pool | undefined;
  var __faceburgDbInitPromise: Promise<void> | null | undefined;
}

const pool =
  globalThis.__faceburgPool ??
  new Pool({
    host: process.env.DB_HOST || 'faceburg.postgres.uhserver.com',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'faceburg',
    user: process.env.DB_USER || 'faceburg',
    password: process.env.DB_PASSWORD || process.env.PGPASSWORD || '',
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    query_timeout: 15_000,
    keepAlive: true,
  });

if (!globalThis.__faceburgPool) {
  globalThis.__faceburgPool = pool;
}

let initPromise: Promise<void> | null = globalThis.__faceburgDbInitPromise ?? null;

export type DbExecutor = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) => Promise<QueryResult<T>>;
};

async function initializeDb() {
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS tenants (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          slug TEXT UNIQUE NOT NULL,
          issuer_name TEXT,
          issuer_trade_name TEXT,
          issuer_document TEXT,
          issuer_state_registration TEXT,
          issuer_email TEXT,
          issuer_phone TEXT,
          issuer_zip_code TEXT,
          issuer_street TEXT,
          issuer_number TEXT,
          issuer_complement TEXT,
          issuer_neighborhood TEXT,
          issuer_city TEXT,
          issuer_state TEXT,
          logo_url TEXT,
          menu_cover_image_url TEXT,
          whatsapp_phone TEXT,
          prep_time_minutes INTEGER NOT NULL DEFAULT 40,
          delivery_fee_base NUMERIC(10,2) NOT NULL DEFAULT 5,
          store_open BOOLEAN NOT NULL DEFAULT TRUE,
          primary_color TEXT DEFAULT '#3b82f6',
          plan TEXT NOT NULL DEFAULT 'starter',
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS categories (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          name TEXT NOT NULL,
          icon TEXT,
          product_type TEXT NOT NULL DEFAULT 'prepared',
          active BOOLEAN DEFAULT TRUE,
          display_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS products (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          category_id TEXT NOT NULL REFERENCES categories(id),
          name TEXT NOT NULL,
          description TEXT,
          price NUMERIC(10,2) NOT NULL,
          image_url TEXT,
          available BOOLEAN DEFAULT TRUE,
          sku TEXT,
          product_type TEXT NOT NULL DEFAULT 'prepared',
          product_meta JSONB NOT NULL DEFAULT '{}'::jsonb,
          status TEXT NOT NULL DEFAULT 'draft',
          display_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS product_option_groups (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          product_id TEXT NOT NULL REFERENCES products(id),
          name TEXT NOT NULL,
          min_select INTEGER NOT NULL DEFAULT 0,
          max_select INTEGER NOT NULL DEFAULT 1,
          required BOOLEAN NOT NULL DEFAULT FALSE,
          display_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS product_options (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          group_id TEXT NOT NULL REFERENCES product_option_groups(id),
          name TEXT NOT NULL,
          image_url TEXT,
          price_addition NUMERIC(10,2) NOT NULL DEFAULT 0,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          display_order INTEGER DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS orders (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          customer_name TEXT,
          customer_phone TEXT,
          delivery_address TEXT,
          payment_method TEXT,
          cancellation_reason TEXT,
          change_for NUMERIC(10,2),
          subtotal_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          surcharge_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          delivery_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          total NUMERIC(10,2) NOT NULL,
          status TEXT CHECK(status IN ('pending', 'processing', 'delivering', 'completed', 'cancelled')) DEFAULT 'pending',
          type TEXT CHECK(type IN ('delivery', 'pickup', 'table')) DEFAULT 'delivery',
          table_number TEXT,
          payment_status TEXT DEFAULT 'pending',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS order_items (
          id TEXT PRIMARY KEY,
          order_id TEXT NOT NULL REFERENCES orders(id),
          product_id TEXT NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL,
          unit_price NUMERIC(10,2) NOT NULL,
          notes TEXT
        );

        CREATE TABLE IF NOT EXISTS order_payments (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
          payment_method_id TEXT,
          method_type TEXT NOT NULL,
          method_name TEXT NOT NULL,
          gross_amount NUMERIC(10,2) NOT NULL,
          fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          net_amount NUMERIC(10,2) NOT NULL,
          settlement_days INTEGER NOT NULL DEFAULT 0,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS tenant_users (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          name TEXT NOT NULL,
          email TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          role TEXT CHECK(role IN ('admin', 'staff', 'kitchen')) DEFAULT 'staff',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (tenant_id, email)
        );

        CREATE TABLE IF NOT EXISTS customers (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          name TEXT NOT NULL,
          phone TEXT NOT NULL,
          email TEXT,
          is_company BOOLEAN NOT NULL DEFAULT FALSE,
          company_name TEXT,
          document_number TEXT,
          tags TEXT,
          notes TEXT,
          status TEXT NOT NULL DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          UNIQUE (tenant_id, phone)
        );

        CREATE TABLE IF NOT EXISTS customer_addresses (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id),
          customer_id TEXT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
          label TEXT,
          street TEXT NOT NULL,
          number TEXT,
          complement TEXT,
          neighborhood TEXT,
          city TEXT,
          state TEXT,
          zip_code TEXT,
          reference TEXT,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          is_default BOOLEAN NOT NULL DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS pdv_tabs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          table_number TEXT NOT NULL,
          customer_name TEXT,
          customer_phone TEXT,
          customer_id TEXT,
          notes TEXT,
          discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          surcharge_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          delivery_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          subtotal_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          total_amount NUMERIC(10,2) NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'open',
          opened_by_user_id TEXT REFERENCES tenant_users(id) ON DELETE SET NULL,
          closed_by_user_id TEXT REFERENCES tenant_users(id) ON DELETE SET NULL,
          order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
          opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          closed_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          CONSTRAINT chk_pdv_tabs_status CHECK (status IN ('open', 'closed', 'cancelled'))
        );

        CREATE TABLE IF NOT EXISTS pdv_tab_items (
          id TEXT PRIMARY KEY,
          tab_id TEXT NOT NULL REFERENCES pdv_tabs(id) ON DELETE CASCADE,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          product_id TEXT NOT NULL REFERENCES products(id),
          quantity INTEGER NOT NULL,
          unit_price NUMERIC(10,2) NOT NULL,
          line_total NUMERIC(10,2) NOT NULL,
          notes TEXT,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS printer_agents (
          tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          agent_key TEXT UNIQUE,
          connection_status TEXT NOT NULL DEFAULT 'disconnected',
          printer_name TEXT,
          device_name TEXT,
          app_version TEXT,
          last_error TEXT,
          last_seen_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS print_jobs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
          event_type TEXT NOT NULL,
          payload_text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          next_retry_at TIMESTAMPTZ,
          lease_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS whatsapp_agents (
          tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
          enabled BOOLEAN NOT NULL DEFAULT FALSE,
          agent_key TEXT UNIQUE,
          session_status TEXT NOT NULL DEFAULT 'disconnected',
          qr_code TEXT,
          phone_number TEXT,
          device_name TEXT,
          app_version TEXT,
          last_error TEXT,
          last_seen_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

        CREATE TABLE IF NOT EXISTS whatsapp_jobs (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          order_id TEXT REFERENCES orders(id) ON DELETE SET NULL,
          target_phone TEXT NOT NULL,
          event_type TEXT NOT NULL,
          payload_text TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'queued',
          attempt_count INTEGER NOT NULL DEFAULT 0,
          last_error TEXT,
          next_retry_at TIMESTAMPTZ,
          lease_until TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );

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

        CREATE TABLE IF NOT EXISTS menu_stories (
          id TEXT PRIMARY KEY,
          tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          subtitle TEXT,
          image_url TEXT NOT NULL,
          active BOOLEAN NOT NULL DEFAULT TRUE,
          display_order INTEGER NOT NULL DEFAULT 0,
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

      await client.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'plan'
          ) THEN
            ALTER TABLE tenants ADD COLUMN plan TEXT;
            UPDATE tenants SET plan = 'starter' WHERE plan IS NULL;
            ALTER TABLE tenants ALTER COLUMN plan SET DEFAULT 'starter';
            ALTER TABLE tenants ALTER COLUMN plan SET NOT NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'status'
          ) THEN
            ALTER TABLE tenants ADD COLUMN status TEXT;
            UPDATE tenants SET status = 'active' WHERE status IS NULL;
            ALTER TABLE tenants ALTER COLUMN status SET DEFAULT 'active';
            ALTER TABLE tenants ALTER COLUMN status SET NOT NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'whatsapp_phone'
          ) THEN
            ALTER TABLE tenants ADD COLUMN whatsapp_phone TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'menu_cover_image_url'
          ) THEN
            ALTER TABLE tenants ADD COLUMN menu_cover_image_url TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_name'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_name TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_document'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_document TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_trade_name'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_trade_name TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_state_registration'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_state_registration TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_email'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_email TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_phone'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_phone TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_zip_code'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_zip_code TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_street'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_street TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_number'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_number TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_complement'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_complement TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_neighborhood'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_neighborhood TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_city'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_city TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'issuer_state'
          ) THEN
            ALTER TABLE tenants ADD COLUMN issuer_state TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'prep_time_minutes'
          ) THEN
            ALTER TABLE tenants ADD COLUMN prep_time_minutes INTEGER NOT NULL DEFAULT 40;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'delivery_fee_base'
          ) THEN
            ALTER TABLE tenants ADD COLUMN delivery_fee_base NUMERIC(10,2) NOT NULL DEFAULT 5;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'store_open'
          ) THEN
            ALTER TABLE tenants ADD COLUMN store_open BOOLEAN NOT NULL DEFAULT TRUE;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'categories' AND column_name = 'active'
          ) THEN
            ALTER TABLE categories ADD COLUMN active BOOLEAN DEFAULT TRUE;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'product_options' AND column_name = 'image_url'
          ) THEN
            ALTER TABLE product_options ADD COLUMN image_url TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'categories' AND column_name = 'display_order'
          ) THEN
            ALTER TABLE categories ADD COLUMN display_order INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'products' AND column_name = 'sku'
          ) THEN
            ALTER TABLE products ADD COLUMN sku TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'products' AND column_name = 'product_type'
          ) THEN
            ALTER TABLE products ADD COLUMN product_type TEXT NOT NULL DEFAULT 'prepared';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'categories' AND column_name = 'product_type'
          ) THEN
            ALTER TABLE categories ADD COLUMN product_type TEXT NOT NULL DEFAULT 'prepared';

            UPDATE categories c
               SET product_type = COALESCE(
                 (
                   SELECT p.product_type
                     FROM products p
                    WHERE p.tenant_id = c.tenant_id
                      AND p.category_id = c.id
                    GROUP BY p.product_type
                    ORDER BY COUNT(*) DESC, p.product_type ASC
                    LIMIT 1
                 ),
                 'prepared'
               );
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'products' AND column_name = 'product_meta'
          ) THEN
            ALTER TABLE products ADD COLUMN product_meta JSONB NOT NULL DEFAULT '{}'::jsonb;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'products' AND column_name = 'status'
          ) THEN
            ALTER TABLE products ADD COLUMN status TEXT;
            UPDATE products SET status = 'published' WHERE status IS NULL;
            ALTER TABLE products ALTER COLUMN status SET DEFAULT 'draft';
            ALTER TABLE products ALTER COLUMN status SET NOT NULL;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'products' AND column_name = 'display_order'
          ) THEN
            ALTER TABLE products ADD COLUMN display_order INTEGER DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'delivery_address'
          ) THEN
            ALTER TABLE orders ADD COLUMN delivery_address TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'payment_method'
          ) THEN
            ALTER TABLE orders ADD COLUMN payment_method TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'change_for'
          ) THEN
            ALTER TABLE orders ADD COLUMN change_for NUMERIC(10,2);
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'subtotal_amount'
          ) THEN
            ALTER TABLE orders ADD COLUMN subtotal_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
            UPDATE orders SET subtotal_amount = total WHERE subtotal_amount = 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'discount_amount'
          ) THEN
            ALTER TABLE orders ADD COLUMN discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'surcharge_amount'
          ) THEN
            ALTER TABLE orders ADD COLUMN surcharge_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'delivery_fee_amount'
          ) THEN
            ALTER TABLE orders ADD COLUMN delivery_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'orders' AND column_name = 'cancellation_reason'
          ) THEN
            ALTER TABLE orders ADD COLUMN cancellation_reason TEXT;
          END IF;

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

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'customers' AND column_name = 'is_company'
          ) THEN
            ALTER TABLE customers ADD COLUMN is_company BOOLEAN NOT NULL DEFAULT FALSE;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'pdv_tabs' AND column_name = 'surcharge_amount'
          ) THEN
            ALTER TABLE pdv_tabs ADD COLUMN surcharge_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'pdv_tabs' AND column_name = 'delivery_fee_amount'
          ) THEN
            ALTER TABLE pdv_tabs ADD COLUMN delivery_fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'customers' AND column_name = 'company_name'
          ) THEN
            ALTER TABLE customers ADD COLUMN company_name TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'customers' AND column_name = 'document_number'
          ) THEN
            ALTER TABLE customers ADD COLUMN document_number TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_agents' AND column_name = 'session_status'
          ) THEN
            ALTER TABLE whatsapp_agents ADD COLUMN session_status TEXT NOT NULL DEFAULT 'disconnected';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_agents' AND column_name = 'qr_code'
          ) THEN
            ALTER TABLE whatsapp_agents ADD COLUMN qr_code TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_agents' AND column_name = 'phone_number'
          ) THEN
            ALTER TABLE whatsapp_agents ADD COLUMN phone_number TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_agents' AND column_name = 'device_name'
          ) THEN
            ALTER TABLE whatsapp_agents ADD COLUMN device_name TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_agents' AND column_name = 'app_version'
          ) THEN
            ALTER TABLE whatsapp_agents ADD COLUMN app_version TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_agents' AND column_name = 'last_error'
          ) THEN
            ALTER TABLE whatsapp_agents ADD COLUMN last_error TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'printer_agents' AND column_name = 'connection_status'
          ) THEN
            ALTER TABLE printer_agents ADD COLUMN connection_status TEXT NOT NULL DEFAULT 'disconnected';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'printer_agents' AND column_name = 'device_name'
          ) THEN
            ALTER TABLE printer_agents ADD COLUMN device_name TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'printer_agents' AND column_name = 'app_version'
          ) THEN
            ALTER TABLE printer_agents ADD COLUMN app_version TEXT;
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'printer_agents' AND column_name = 'last_error'
          ) THEN
            ALTER TABLE printer_agents ADD COLUMN last_error TEXT;
          END IF;
        END
        $$;
      `);

      await client.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tenant_sku
          ON products(tenant_id, sku)
          WHERE sku IS NOT NULL;
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_customer_addresses_tenant_customer
          ON customer_addresses(tenant_id, customer_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pdv_tabs_tenant_status_opened_at
          ON pdv_tabs(tenant_id, status, opened_at DESC);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pdv_tab_items_tab_id
          ON pdv_tab_items(tab_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_pdv_tab_items_tenant_tab
          ON pdv_tab_items(tenant_id, tab_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status_created
          ON print_jobs(tenant_id, status, created_at);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_status_retry_created
          ON print_jobs(tenant_id, status, next_retry_at, created_at);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_print_jobs_tenant_processing_lease
          ON print_jobs(tenant_id, status, lease_until);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_whatsapp_jobs_tenant_status_created
          ON whatsapp_jobs(tenant_id, status, created_at);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_whatsapp_jobs_tenant_status_retry_created
          ON whatsapp_jobs(tenant_id, status, next_retry_at, created_at);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_whatsapp_jobs_tenant_processing_lease
          ON whatsapp_jobs(tenant_id, status, lease_until);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_tenant_created_at
          ON orders(tenant_id, created_at DESC);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_orders_tenant_status_created_at
          ON orders(tenant_id, status, created_at DESC);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_order_items_order_id
          ON order_items(order_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_order_payments_tenant_order
          ON order_payments(tenant_id, order_id);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_payment_methods_tenant_active
          ON payment_methods(tenant_id, active);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_menu_stories_tenant_active_order
          ON menu_stories(tenant_id, active, display_order, expires_at);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cash_sessions_tenant_status
          ON cash_register_sessions(tenant_id, status, opened_at DESC);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_cash_movements_tenant_session
          ON cash_movements(tenant_id, session_id, created_at DESC);
      `);

      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_receivables_tenant_status_due
          ON receivables(tenant_id, status, due_date);
      `);

      const tenantSeed = await client.query<{ id: string }>(
        `INSERT INTO tenants (id, name, slug)
         VALUES ($1, $2, $3)
         ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        ['t1', 'Pizza & Burger Master', 'pizza-burger'],
      );

      const tenantId = tenantSeed.rows[0]?.id || 't1';
      const category1Id = `seed-${tenantId}-cat-pizza`;
      const category2Id = `seed-${tenantId}-cat-burger`;
      const seedBurgerId = `seed-${tenantId}-p2`;
      const seedOptionGroupId = `seed-${tenantId}-optgrp-1`;
      const seedOption1Id = `seed-${tenantId}-opt-1`;
      const seedOption2Id = `seed-${tenantId}-opt-2`;
      const seedOption3Id = `seed-${tenantId}-opt-3`;

      await client.query(
        `INSERT INTO categories (id, tenant_id, name, icon, product_type)
         VALUES
          ($1, $3, $4, $5, $8),
          ($2, $3, $6, $7, $9)
         ON CONFLICT (id) DO NOTHING`,
        [category1Id, category2Id, tenantId, 'Pizzas', 'pizza', 'Burgers', 'hamburger', 'size_based', 'prepared'],
      );

      await client.query(
        `INSERT INTO products (id, tenant_id, category_id, name, description, price, image_url)
         VALUES
          ($1, $3, $4, $5, $6, $7, $8),
          ($2, $3, $9, $10, $11, $12, $13)
         ON CONFLICT (id) DO NOTHING`,
        [
          `seed-${tenantId}-p1`,
          seedBurgerId,
          tenantId,
          category1Id,
          'Margherita',
          'Classic tomato, mozzarella, and basil',
          45.0,
          'https://picsum.photos/seed/pizza/400/300',
          category2Id,
          'Bacon Cheeseburger',
          'Bento bun, beef patty, bacon, cheddar',
          32.0,
          'https://picsum.photos/seed/burger/400/300',
        ],
      );

      await client.query(
        `INSERT INTO payment_methods (id, tenant_id, name, method_type, fee_percent, fee_fixed, settlement_days, active)
         VALUES
          ($1, $5, 'Pix', 'pix', 0, 0, 0, TRUE),
          ($2, $5, 'Dinheiro', 'cash', 0, 0, 0, TRUE),
          ($3, $5, 'Cartao Debito', 'card', 1.9900, 0, 1, TRUE),
          ($4, $5, 'Cartao Credito', 'card', 3.4900, 0, 30, TRUE)
         ON CONFLICT (id) DO NOTHING`,
        [
          `seed-${tenantId}-pm-pix`,
          `seed-${tenantId}-pm-cash`,
          `seed-${tenantId}-pm-card-debit`,
          `seed-${tenantId}-pm-card-credit`,
          tenantId,
        ],
      );

      await client.query(
        `INSERT INTO product_option_groups
         (id, tenant_id, product_id, name, min_select, max_select, required, display_order)
         VALUES ($1, $2, $3, $4, 0, 10, FALSE, 0)
         ON CONFLICT (id) DO NOTHING`,
        [seedOptionGroupId, tenantId, seedBurgerId, 'Turbine seu lanche'],
      );

      await client.query(
        `INSERT INTO product_options
         (id, tenant_id, group_id, name, price_addition, active, display_order)
         VALUES
         ($1, $4, $5, $6, $7, TRUE, 0),
         ($2, $4, $5, $8, $9, TRUE, 1),
         ($3, $4, $5, $10, $11, TRUE, 2)
         ON CONFLICT (id) DO NOTHING`,
        [seedOption1Id, seedOption2Id, seedOption3Id, tenantId, seedOptionGroupId, 'Bacon', 3, 'Cheddar', 3, 'Ovo', 2],
      );
    } finally {
      client.release();
    }
  })();
  globalThis.__faceburgDbInitPromise = initPromise;

  return initPromise;
}

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, values?: unknown[]) {
  await initializeDb();
  try {
    return await pool.query<T>(text, values);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('Connection terminated unexpectedly')) {
      return pool.query<T>(text, values);
    }
    throw error;
  }
}

export default pool;
