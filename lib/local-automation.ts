import { query, type DbExecutor } from '@/lib/db';

export type LocalAutomationCapabilities = {
  print?: boolean;
  whatsapp?: boolean;
};

export type LocalAutomationLease = {
  tenantId: string;
  ownerId: string;
  ownerLabel: string;
  capabilities: LocalAutomationCapabilities;
  leaseUntil: string;
  lastSeenAt: string;
  isOwner: boolean;
  active: boolean;
};

type DispatchChannel = 'print' | 'whatsapp';

type LeaseRow = {
  tenant_id: string;
  owner_id: string;
  owner_label: string | null;
  capabilities: LocalAutomationCapabilities | string | null;
  lease_until: string | Date;
  last_seen_at: string | Date;
  is_owner?: boolean;
  active?: boolean;
};

let schemaPromise: Promise<void> | null = null;

function parseCapabilities(value: LeaseRow['capabilities']): LocalAutomationCapabilities {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as LocalAutomationCapabilities;
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value : {};
}

function serializeLease(row: LeaseRow, ownerId: string): LocalAutomationLease {
  const leaseUntil = row.lease_until instanceof Date ? row.lease_until.toISOString() : String(row.lease_until);
  const lastSeenAt = row.last_seen_at instanceof Date ? row.last_seen_at.toISOString() : String(row.last_seen_at);
  const isOwner = typeof row.is_owner === 'boolean' ? row.is_owner : row.owner_id === ownerId;
  const active = typeof row.active === 'boolean' ? row.active : Date.parse(leaseUntil) > Date.now();

  return {
    tenantId: row.tenant_id,
    ownerId: row.owner_id,
    ownerLabel: row.owner_label || 'Computador da loja',
    capabilities: parseCapabilities(row.capabilities),
    leaseUntil,
    lastSeenAt,
    isOwner,
    active,
  };
}

export async function ensureLocalAutomationLeaseSchema(executor: DbExecutor = { query }) {
  if (!schemaPromise) {
    schemaPromise = executor.query(`
      CREATE TABLE IF NOT EXISTS local_automation_leases (
        tenant_id TEXT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
        owner_id TEXT NOT NULL,
        owner_label TEXT,
        capabilities JSONB NOT NULL DEFAULT '{}'::jsonb,
        lease_until TIMESTAMPTZ NOT NULL,
        last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((error) => {
      schemaPromise = null;
      throw error;
    });
  }

  await schemaPromise;
}

export async function ensureLocalAutomationDispatchSchema(executor: DbExecutor = { query }) {
  await ensureLocalAutomationLeaseSchema(executor);
  await executor.query(`
    CREATE TABLE IF NOT EXISTS local_automation_dispatches (
      tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      dedupe_key TEXT NOT NULL,
      order_id TEXT,
      channel TEXT NOT NULL,
      event_type TEXT NOT NULL,
      owner_id TEXT,
      owner_label TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (tenant_id, dedupe_key)
    )
  `);
}

export async function claimLocalAutomationLease({
  tenantId,
  ownerId,
  ownerLabel,
  capabilities,
  leaseSeconds = 20,
  executor = { query },
}: {
  tenantId: string;
  ownerId: string;
  ownerLabel?: string;
  capabilities?: LocalAutomationCapabilities;
  leaseSeconds?: number;
  executor?: DbExecutor;
}) {
  await ensureLocalAutomationLeaseSchema(executor);

  const normalizedLeaseSeconds = Math.min(120, Math.max(10, Math.round(leaseSeconds)));
  const capabilitiesJson = JSON.stringify(capabilities || {});
  const result = await executor.query<LeaseRow>(
    `WITH upserted AS (
       INSERT INTO local_automation_leases
         (tenant_id, owner_id, owner_label, capabilities, lease_until, last_seen_at, updated_at)
       VALUES
         ($1, $2, NULLIF($3, ''), $4::jsonb, NOW() + ($5::int * INTERVAL '1 second'), NOW(), NOW())
       ON CONFLICT (tenant_id) DO UPDATE
       SET owner_id = CASE
             WHEN local_automation_leases.owner_id = EXCLUDED.owner_id
               OR local_automation_leases.lease_until <= NOW()
             THEN EXCLUDED.owner_id
             ELSE local_automation_leases.owner_id
           END,
           owner_label = CASE
             WHEN local_automation_leases.owner_id = EXCLUDED.owner_id
               OR local_automation_leases.lease_until <= NOW()
             THEN EXCLUDED.owner_label
             ELSE local_automation_leases.owner_label
           END,
           capabilities = CASE
             WHEN local_automation_leases.owner_id = EXCLUDED.owner_id
               OR local_automation_leases.lease_until <= NOW()
             THEN EXCLUDED.capabilities
             ELSE local_automation_leases.capabilities
           END,
           lease_until = CASE
             WHEN local_automation_leases.owner_id = EXCLUDED.owner_id
               OR local_automation_leases.lease_until <= NOW()
             THEN EXCLUDED.lease_until
             ELSE local_automation_leases.lease_until
           END,
           last_seen_at = CASE
             WHEN local_automation_leases.owner_id = EXCLUDED.owner_id
               OR local_automation_leases.lease_until <= NOW()
             THEN NOW()
             ELSE local_automation_leases.last_seen_at
           END,
           updated_at = CASE
             WHEN local_automation_leases.owner_id = EXCLUDED.owner_id
               OR local_automation_leases.lease_until <= NOW()
             THEN NOW()
             ELSE local_automation_leases.updated_at
           END
       RETURNING tenant_id, owner_id, owner_label, capabilities, lease_until, last_seen_at
     )
     SELECT *,
            owner_id = $2 AS is_owner,
            lease_until > NOW() AS active
     FROM upserted`,
    [tenantId, ownerId, ownerLabel || '', capabilitiesJson, normalizedLeaseSeconds],
  );

  const row = result.rows[0];
  return row ? serializeLease(row, ownerId) : null;
}

export async function releaseLocalAutomationLease({
  tenantId,
  ownerId,
  executor = { query },
}: {
  tenantId: string;
  ownerId: string;
  executor?: DbExecutor;
}) {
  await ensureLocalAutomationLeaseSchema(executor);
  await executor.query(
    `DELETE FROM local_automation_leases
     WHERE tenant_id = $1
       AND owner_id = $2`,
    [tenantId, ownerId],
  );
}

export async function getActiveLocalAutomationLease(
  tenantId: string,
  executor: DbExecutor = { query },
) {
  await ensureLocalAutomationLeaseSchema(executor);
  const result = await executor.query<LeaseRow>(
    `SELECT tenant_id, owner_id, owner_label, capabilities, lease_until, last_seen_at
     FROM local_automation_leases
     WHERE tenant_id = $1
       AND lease_until > NOW()
     LIMIT 1`,
    [tenantId],
  );

  const row = result.rows[0];
  return row ? serializeLease(row, row.owner_id) : null;
}

export async function hasActiveLocalAutomationLease(
  tenantId: string,
  executor: DbExecutor = { query },
) {
  const lease = await getActiveLocalAutomationLease(tenantId, executor);
  return Boolean(lease?.active);
}

export async function claimLocalAutomationDispatch({
  tenantId,
  orderId,
  channel,
  eventType,
  ownerId,
  ownerLabel,
  executor = { query },
}: {
  tenantId: string;
  orderId: string;
  channel: DispatchChannel;
  eventType: string;
  ownerId?: string;
  ownerLabel?: string;
  executor?: DbExecutor;
}) {
  await ensureLocalAutomationDispatchSchema(executor);
  const dedupeKey = `${orderId}:${channel}:${eventType}`;
  const result = await executor.query(
    `INSERT INTO local_automation_dispatches
       (tenant_id, dedupe_key, order_id, channel, event_type, owner_id, owner_label, created_at, updated_at)
     VALUES
       ($1, $2, $3, $4, $5, NULLIF($6, ''), NULLIF($7, ''), NOW(), NOW())
     ON CONFLICT DO NOTHING
     RETURNING dedupe_key`,
    [tenantId, dedupeKey, orderId, channel, eventType, ownerId || '', ownerLabel || ''],
  );

  return Boolean(result.rowCount);
}
