import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type AgentRow = {
  tenant_id: string;
};

const allowedStatus = new Set(['disconnected', 'connecting', 'ready', 'error']);

export async function POST(request: Request) {
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

  const incomingStatus = String(body.connectionStatus || 'disconnected').trim().toLowerCase();
  const connectionStatus = allowedStatus.has(incomingStatus) ? incomingStatus : 'disconnected';
  const printerName = String(body.printerName || '').trim();
  const deviceName = String(body.deviceName || '').trim();
  const appVersion = String(body.appVersion || '').trim();
  const lastError = String(body.lastError || '').trim();

  const result = await query<AgentRow>(
    `UPDATE printer_agents
     SET connection_status = $2,
         printer_name = CASE WHEN NULLIF($3, '') IS NOT NULL THEN NULLIF($3, '') ELSE printer_name END,
         device_name = NULLIF($4, ''),
         app_version = NULLIF($5, ''),
         last_error = CASE WHEN $2 = 'error' THEN NULLIF($6, '') ELSE NULL END,
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE agent_key = $1
     RETURNING tenant_id`,
    [agentKey, connectionStatus, printerName, deviceName, appVersion, lastError],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
