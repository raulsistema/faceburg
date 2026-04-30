import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type AgentRow = {
  tenant_id: string;
};

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
  const sessionStatus = String(body.sessionStatus || 'disconnected').trim().toLowerCase();
  const qrCode = String(body.qrCode || '').trim();
  const phoneNumber = String(body.phoneNumber || '').trim();
  const deviceName = String(body.deviceName || '').trim();
  const appVersion = String(body.appVersion || '').trim();
  const lastError = String(body.lastError || '').trim();
  const allowedStatus = new Set(['disconnected', 'qr', 'ready', 'auth_failure', 'connecting']);

  const status = allowedStatus.has(sessionStatus) ? sessionStatus : 'disconnected';

  const result = await query<AgentRow>(
    `UPDATE whatsapp_agents
     SET session_status = $2,
         qr_code = CASE WHEN $2 = 'qr' THEN NULLIF($3, '') ELSE NULL END,
         phone_number = NULLIF($4, ''),
         device_name = NULLIF($5, ''),
         app_version = NULLIF($6, ''),
         last_error = CASE WHEN $2 IN ('auth_failure', 'disconnected') THEN NULLIF($7, '') ELSE NULL END,
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE agent_key = $1
     RETURNING tenant_id`,
    [agentKey, status, qrCode, phoneNumber, deviceName, appVersion, lastError],
  );

  if (!result.rowCount) {
    return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
