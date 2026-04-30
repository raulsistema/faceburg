import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type AgentRow = {
  tenant_id: string;
  enabled: boolean;
  connection_status: string;
  printer_name: string | null;
  device_name: string | null;
  app_version: string | null;
  last_error: string | null;
  last_seen_at: string | null;
};

export async function GET(request: Request) {
  const agentKey = String(request.headers.get('x-agent-key') || '').trim();
  if (!agentKey) {
    return NextResponse.json({ error: 'Missing agent key.' }, { status: 401 });
  }

  const result = await query<AgentRow>(
    `SELECT tenant_id, enabled, connection_status, printer_name, device_name, app_version, last_error, last_seen_at
     FROM printer_agents
     WHERE agent_key = $1
     LIMIT 1`,
    [agentKey],
  );
  if (!result.rowCount) {
    return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
  }

  const row = result.rows[0];
  return NextResponse.json({
    ok: true,
    tenantId: row.tenant_id,
    enabled: row.enabled,
    connectionStatus: row.connection_status || 'disconnected',
    printerName: row.printer_name || '',
    deviceName: row.device_name || '',
    appVersion: row.app_version || '',
    lastError: row.last_error || '',
    lastSeenAt: row.last_seen_at,
  });
}

export async function PATCH(request: Request) {
  const agentKey = String(request.headers.get('x-agent-key') || '').trim();
  if (!agentKey) {
    return NextResponse.json({ error: 'Missing agent key.' }, { status: 401 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  const printerName = String(body.printerName || '').trim();
  const enabled = body.enabled === undefined ? null : Boolean(body.enabled);

  const result = await query<{ tenant_id: string }>(
    `UPDATE printer_agents
     SET printer_name = NULLIF($2, ''),
         enabled = COALESCE($3, enabled),
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE agent_key = $1
     RETURNING tenant_id`,
    [agentKey, printerName, enabled],
  );
  if (!result.rowCount) {
    return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
