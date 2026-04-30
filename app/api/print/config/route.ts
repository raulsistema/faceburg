import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type ConfigRow = {
  tenant_id: string;
  enabled: boolean;
  agent_key: string | null;
  printer_name: string | null;
  last_seen_at: string | null;
};

function buildAgentKey() {
  return `pa_${randomBytes(24).toString('hex')}`;
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<ConfigRow>(
    `SELECT tenant_id, enabled, agent_key, printer_name, last_seen_at
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );

  const row = result.rows[0] || null;
  return NextResponse.json({
    enabled: row?.enabled || false,
    hasAgentKey: Boolean(row?.agent_key),
    agentKey: row?.agent_key || '',
    printerName: row?.printer_name || '',
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
  const enabled = Boolean(body.enabled);
  const rotateKey = Boolean(body.rotateKey);
  const printerName = String(body.printerName || '').trim();

  const currentResult = await query<ConfigRow>(
    `SELECT tenant_id, enabled, agent_key, printer_name, last_seen_at
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );
  const current = currentResult.rows[0];
  const nextKey = rotateKey || !current?.agent_key ? buildAgentKey() : current.agent_key;

  await query(
    `INSERT INTO printer_agents (tenant_id, enabled, agent_key, printer_name, updated_at)
     VALUES ($1, $2, $3, NULLIF($4, ''), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       agent_key = EXCLUDED.agent_key,
       printer_name = EXCLUDED.printer_name,
       updated_at = NOW()`,
    [session.tenantId, enabled, nextKey, printerName],
  );

  return NextResponse.json({
    ok: true,
    enabled,
    agentKey: nextKey,
    printerName,
  });
}
