import { NextResponse } from 'next/server';
import { query } from '@/lib/db';

type AgentRow = {
  tenant_id: string;
  enabled: boolean;
};

type JobRow = {
  id: string;
  attempt_count: number;
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
  const jobId = String(body.jobId || '').trim();
  const success = Boolean(body.success);
  const errorMessage = String(body.error || '').trim();

  if (!jobId) {
    return NextResponse.json({ error: 'Missing job id.' }, { status: 400 });
  }

  const agentResult = await query<AgentRow>(
    `SELECT tenant_id, enabled
     FROM whatsapp_agents
     WHERE agent_key = $1
     LIMIT 1`,
    [agentKey],
  );
  if (!agentResult.rowCount) {
    return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
  }

  const agent = agentResult.rows[0];
  if (!agent.enabled) {
    return NextResponse.json({ error: 'Agent disabled.' }, { status: 403 });
  }

  const jobResult = await query<JobRow>(
    `SELECT id, attempt_count
     FROM whatsapp_jobs
     WHERE id = $1
       AND tenant_id = $2
     LIMIT 1`,
    [jobId, agent.tenant_id],
  );
  if (!jobResult.rowCount) {
    return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
  }

  const job = jobResult.rows[0];
  if (success) {
    await query(
      `UPDATE whatsapp_jobs
       SET status = 'sent',
           lease_until = NULL,
           last_error = NULL,
           updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $2`,
      [jobId, agent.tenant_id],
    );
  } else {
    const shouldFail = job.attempt_count >= 5;
    await query(
      `UPDATE whatsapp_jobs
       SET status = $3,
           lease_until = NULL,
           last_error = NULLIF($4, ''),
           next_retry_at = CASE WHEN $3 = 'queued' THEN NOW() + INTERVAL '30 seconds' ELSE NULL END,
           updated_at = NOW()
       WHERE id = $1
         AND tenant_id = $2`,
      [jobId, agent.tenant_id, shouldFail ? 'failed' : 'queued', errorMessage || 'Falha ao enviar whatsapp'],
    );
  }

  await query(
    `UPDATE whatsapp_agents
     SET last_seen_at = NOW(),
         updated_at = NOW()
     WHERE agent_key = $1
       AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '30 seconds')`,
    [agentKey],
  );

  return NextResponse.json({ ok: true });
}
