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

const HUB_HEARTBEAT_GRACE_MS = 2 * 60 * 1000;

function buildAgentKey() {
  return `wa_${randomBytes(24).toString('hex')}`;
}

function isHubConfigured(row: ConfigRow | undefined) {
  if (!row) return false;
  if (!row.agent_key) return false;
  if (row.session_status !== 'ready') return false;
  if (!row.last_seen_at) return false;

  const lastSeenAt = Date.parse(row.last_seen_at);
  if (Number.isNaN(lastSeenAt)) return false;
  if (Date.now() - lastSeenAt > HUB_HEARTBEAT_GRACE_MS) return false;
  return true;
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
  let effectiveEnabled = Boolean(row?.enabled);
  if (row && effectiveEnabled && !isHubConfigured(row)) {
    await query(
      `UPDATE whatsapp_agents
       SET enabled = FALSE,
           updated_at = NOW()
       WHERE tenant_id = $1`,
      [session.tenantId],
    );
    effectiveEnabled = false;
  }

  return NextResponse.json({
    enabled: effectiveEnabled,
    hasAgentKey: Boolean(row?.agent_key),
    agentKey: row?.agent_key || '',
    sessionStatus: row?.session_status || 'disconnected',
    qrCode: row?.qr_code || '',
    phoneNumber: row?.phone_number || '',
    deviceName: row?.device_name || '',
    appVersion: row?.app_version || '',
    lastError: row?.last_error || '',
    lastSeenAt: row?.last_seen_at || null,
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
  const currentWithNextKey: ConfigRow | undefined = current
    ? {
        ...current,
        agent_key: nextKey,
      }
    : undefined;
  const canEnable = !rotateKey && isHubConfigured(currentWithNextKey);
  const enabled = desiredEnabled && canEnable;

  await query(
    `INSERT INTO whatsapp_agents
      (tenant_id, enabled, agent_key, session_status, qr_code, phone_number, updated_at)
     VALUES
      ($1, $2, $3, COALESCE($4, 'disconnected'), $5, $6, NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       agent_key = EXCLUDED.agent_key,
       updated_at = NOW()`,
    [session.tenantId, enabled, nextKey, current?.session_status || 'disconnected', current?.qr_code || null, current?.phone_number || null],
  );

  const requiresHubSetup = desiredEnabled && !enabled;
  const message = requiresHubSetup
    ? 'WhatsApp permaneceu OFF porque o Hub nao esta configurado/conectado. Configure o Hub no PC e conecte a sessao antes de ativar.'
    : enabled
      ? 'WhatsApp automatico ativado.'
      : 'WhatsApp automatico desativado.';

  return NextResponse.json({
    ok: true,
    enabled,
    agentKey: nextKey,
    requiresHubSetup,
    message,
  });
}
