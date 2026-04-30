import { NextResponse } from 'next/server';
import pool from '@/lib/db';

type AgentRow = {
  tenant_id: string;
  enabled: boolean;
};

type JobRow = {
  id: string;
  tenant_id: string;
  order_id: string | null;
  target_phone: string;
  event_type: string;
  payload_text: string;
  attempt_count: number;
};

export async function GET(request: Request) {
  const agentKey = String(request.headers.get('x-agent-key') || '').trim();
  if (!agentKey) {
    return NextResponse.json({ error: 'Missing agent key.' }, { status: 401 });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const agentResult = await client.query<AgentRow>(
      `SELECT tenant_id, enabled
       FROM whatsapp_agents
       WHERE agent_key = $1
       LIMIT 1`,
      [agentKey],
    );
    if (!agentResult.rowCount) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Invalid agent key.' }, { status: 401 });
    }

    const agent = agentResult.rows[0];
    if (!agent.enabled) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Agent disabled.' }, { status: 403 });
    }

    await client.query(
      `UPDATE whatsapp_agents
       SET last_seen_at = NOW(),
           updated_at = NOW()
       WHERE agent_key = $1
         AND (last_seen_at IS NULL OR last_seen_at < NOW() - INTERVAL '30 seconds')`,
      [agentKey],
    );

    await client.query(
      `UPDATE whatsapp_jobs
       SET status = 'queued',
           lease_until = NULL,
           updated_at = NOW()
       WHERE tenant_id = $1
         AND status = 'processing'
         AND lease_until IS NOT NULL
         AND lease_until < NOW()`,
      [agent.tenant_id],
    );

    const jobResult = await client.query<JobRow>(
      `WITH next_job AS (
         SELECT id
         FROM whatsapp_jobs
         WHERE tenant_id = $1
           AND status = 'queued'
           AND (next_retry_at IS NULL OR next_retry_at <= NOW())
         ORDER BY created_at ASC
         LIMIT 1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE whatsapp_jobs wj
       SET status = 'processing',
           attempt_count = attempt_count + 1,
           lease_until = NOW() + INTERVAL '60 seconds',
           updated_at = NOW()
       FROM next_job
       WHERE wj.id = next_job.id
       RETURNING wj.id, wj.tenant_id, wj.order_id, wj.target_phone, wj.event_type, wj.payload_text, wj.attempt_count`,
      [agent.tenant_id],
    );

    await client.query('COMMIT');

    if (!jobResult.rowCount) {
      return NextResponse.json({ ok: true, job: null });
    }

    const job = jobResult.rows[0];
    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        orderId: job.order_id,
        targetPhone: job.target_phone,
        eventType: job.event_type,
        payloadText: job.payload_text,
        attemptCount: job.attempt_count,
      },
    });
  } catch {
    await client.query('ROLLBACK');
    return NextResponse.json({ error: 'Failed to poll whatsapp jobs.' }, { status: 500 });
  } finally {
    client.release();
  }
}
