import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type AgentRow = {
  tenant_id: string;
  enabled: boolean;
  session_status: string;
  phone_number: string | null;
  last_seen_at: string | null;
};

export async function GET(request: Request) {
  const agentKey = String(request.headers.get('x-agent-key') || '').trim();
  if (!agentKey) {
    return NextResponse.json({ error: 'Missing agent key.' }, { status: 401 });
  }

  const result = await query<AgentRow>(
    `SELECT tenant_id, enabled, session_status, phone_number, last_seen_at
     FROM whatsapp_agents
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
    sessionStatus: row.session_status,
    phoneNumber: row.phone_number || '',
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
  const enabled = body.enabled === undefined ? null : Boolean(body.enabled);

  const result = await query<{ tenant_id: string }>(
    `UPDATE whatsapp_agents
     SET enabled = COALESCE($2, enabled),
         last_seen_at = NOW(),
         updated_at = NOW()
     WHERE agent_key = $1
     RETURNING tenant_id`,
    [agentKey, enabled],
  );
  if (!result.rowCount) {
    return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
  }

  return NextResponse.json({ ok: true });
}
