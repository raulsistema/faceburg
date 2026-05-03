import { randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { notifyAgentJobAvailable } from '@/lib/realtime';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type AgentRow = {
  enabled: boolean;
  agent_key: string | null;
};

export async function POST(request: Request) {
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

  const payloadText = String(body.payloadText || '').trim().slice(0, 4000);
  if (!payloadText) {
    return NextResponse.json({ error: 'Previa de impressao vazia.' }, { status: 400 });
  }

  const agentResult = await query<AgentRow>(
    `SELECT enabled, agent_key
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );
  const agent = agentResult.rows[0];
  if (!agent || !agent.enabled || !agent.agent_key) {
    return NextResponse.json({ error: 'Ative o agente de impressao antes do teste.' }, { status: 409 });
  }

  await query(
    `INSERT INTO print_jobs
      (id, tenant_id, order_id, event_type, payload_text, status, attempt_count, created_at, updated_at)
     VALUES
      ($1, $2, NULL, 'test_receipt', $3, 'queued', 0, NOW(), NOW())`,
    [randomUUID(), session.tenantId, payloadText],
  );
  await notifyAgentJobAvailable(session.tenantId, 'print');

  return NextResponse.json({ ok: true });
}
