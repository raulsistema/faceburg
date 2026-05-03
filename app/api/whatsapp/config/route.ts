import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type ConfigRow = {
  tenant_id: string;
  enabled: boolean;
  agent_key: string | null;
  session_status: string;
  qr_code: string | null;
  phone_number: string | null;
  device_name: string | null;
  app_version: string | null;
  last_error: string | null;
  last_seen_at: string | null;
};

// Keep the connection grace comfortably above the desktop heartbeat so
// navigation/idling does not make an active local app look disconnected.
const APP_HEARTBEAT_GRACE_MS = 4 * 60 * 1000;

type WhatsappConfigResponse = {
  enabled: boolean;
  hasAgentKey: boolean;
  agentKey: string;
  sessionStatus: string;
  qrCode: string;
  phoneNumber: string;
  deviceName: string;
  appVersion: string;
  lastError: string;
  lastSeenAt: string | null;
  activationPending?: boolean;
  requiresHubSetup?: boolean;
  message?: string;
};

function buildAgentKey() {
  return `wa_${randomBytes(24).toString('hex')}`;
}

function isDesktopAppConnected(row: ConfigRow | undefined) {
  if (!row) return false;
  if (!row.agent_key) return false;
  if (row.session_status !== 'ready') return false;
  if (!row.last_seen_at) return false;

  const lastSeenAt = Date.parse(row.last_seen_at);
  if (Number.isNaN(lastSeenAt)) return false;
  if (Date.now() - lastSeenAt > APP_HEARTBEAT_GRACE_MS) return false;
  return true;
}

function serializeConfig(row: ConfigRow | null | undefined, enabledOverride?: boolean, agentKeyOverride?: string | null): WhatsappConfigResponse {
  return {
    enabled: typeof enabledOverride === 'boolean' ? enabledOverride : Boolean(row?.enabled),
    hasAgentKey: Boolean(agentKeyOverride ?? row?.agent_key),
    agentKey: String(agentKeyOverride ?? row?.agent_key ?? ''),
    sessionStatus: row?.session_status || 'disconnected',
    qrCode: row?.qr_code || '',
    phoneNumber: row?.phone_number || '',
    deviceName: row?.device_name || '',
    appVersion: row?.app_version || '',
    lastError: row?.last_error || '',
    lastSeenAt: row?.last_seen_at || null,
  };
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<ConfigRow>(
    `SELECT tenant_id, enabled, agent_key, session_status, qr_code, phone_number, device_name, app_version, last_error, last_seen_at
     FROM whatsapp_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );

  const row = result.rows[0] || null;
  const activationPending = Boolean(row?.enabled) && !isDesktopAppConnected(row || undefined);

  return NextResponse.json({
    ...serializeConfig(row),
    activationPending,
    requiresHubSetup: activationPending,
  });
}

export async function PATCH(request: Request) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const desiredEnabled = Boolean(body.enabled);
  const rotateKey = Boolean(body.rotateKey);

  const currentResult = await query<ConfigRow>(
    `SELECT tenant_id, enabled, agent_key, session_status, qr_code, phone_number, device_name, app_version, last_error, last_seen_at
     FROM whatsapp_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );
  const current = currentResult.rows[0];
  const nextKey = rotateKey || !current?.agent_key ? buildAgentKey() : current.agent_key;
  const enabled = desiredEnabled;
  const nextRowSeed: ConfigRow = {
    tenant_id: session.tenantId,
    enabled,
    agent_key: nextKey,
    session_status: rotateKey ? 'disconnected' : current?.session_status || 'disconnected',
    qr_code: rotateKey ? null : current?.qr_code || null,
    phone_number: rotateKey ? null : current?.phone_number || null,
    device_name: rotateKey ? null : current?.device_name || null,
    app_version: rotateKey ? null : current?.app_version || null,
    last_error: rotateKey ? null : current?.last_error || null,
    last_seen_at: rotateKey ? null : current?.last_seen_at || null,
  };

  const updateResult = await query<ConfigRow>(
    `INSERT INTO whatsapp_agents
      (tenant_id, enabled, agent_key, session_status, qr_code, phone_number, device_name, app_version, last_error, last_seen_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       agent_key = EXCLUDED.agent_key,
       session_status = EXCLUDED.session_status,
       qr_code = EXCLUDED.qr_code,
       phone_number = EXCLUDED.phone_number,
       device_name = EXCLUDED.device_name,
       app_version = EXCLUDED.app_version,
       last_error = EXCLUDED.last_error,
       last_seen_at = EXCLUDED.last_seen_at,
       updated_at = NOW()
     RETURNING tenant_id, enabled, agent_key, session_status, qr_code, phone_number, device_name, app_version, last_error, last_seen_at`,
    [
      session.tenantId,
      nextRowSeed.enabled,
      nextRowSeed.agent_key,
      nextRowSeed.session_status,
      nextRowSeed.qr_code,
      nextRowSeed.phone_number,
      nextRowSeed.device_name,
      nextRowSeed.app_version,
      nextRowSeed.last_error,
      nextRowSeed.last_seen_at,
    ],
  );
  const savedRow = updateResult.rows[0] || nextRowSeed;
  const activationPending = enabled && !isDesktopAppConnected(savedRow);

  const message = !enabled
    ? 'WhatsApp automatico desativado.'
    : activationPending
      ? 'WhatsApp ativado. No Faceburg App deste computador, abra o WhatsApp e conecte a conta da empresa para concluir.'
      : 'WhatsApp ativado e conectado.';

  return NextResponse.json({
    ok: true,
    ...serializeConfig(savedRow, enabled, nextKey),
    activationPending,
    requiresHubSetup: activationPending,
    message,
  });
}
