import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob, prepareOrderPrintJobs } from '@/lib/printing';

type OrderRow = {
  id: string;
};

type AgentRow = {
  enabled: boolean;
  agent_key: string | null;
  connection_status: string;
  last_seen_at: string | null;
};

const HUB_HEARTBEAT_GRACE_MS = 5 * 60 * 1000;

function isHubActive(connectionStatus: string, lastSeenAt: string | null) {
  if (!['ready', 'connecting'].includes(connectionStatus)) return false;
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= HUB_HEARTBEAT_GRACE_MS;
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireTenantSession(['admin', 'staff']);
  if (response) return response;

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as { preferLocalAgent?: boolean };
  const preferLocalAgent = Boolean(body.preferLocalAgent);

  const orderResult = await query<OrderRow>(
    `SELECT id
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [session.tenantId, id],
  );

  if (!orderResult.rowCount) {
    return NextResponse.json({ error: 'Pedido nao encontrado.' }, { status: 404 });
  }

  if (preferLocalAgent) {
    const printJobs = await prepareOrderPrintJobs(session.tenantId, id, 'manual_receipt', undefined, {
      ignoreAgentEnabled: true,
    });
    if (!printJobs.length) {
      return NextResponse.json({ error: 'Recibo manual desativado nas configuracoes de impressao.' }, { status: 409 });
    }
    return NextResponse.json({ ok: true, delivery: 'local', printJobs });
  }

  const agentResult = await query<AgentRow>(
    `SELECT enabled, agent_key, connection_status, last_seen_at
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );

  const agent = agentResult.rows[0];
  if (!agent || !agent.enabled || !agent.agent_key) {
    return NextResponse.json({ error: 'Agente de impressao nao configurado ou desativado.' }, { status: 409 });
  }

  if (!isHubActive(String(agent.connection_status || ''), agent.last_seen_at || null)) {
    return NextResponse.json({ error: 'Hub local de impressao offline. Verifique o Hub local antes de imprimir.' }, { status: 409 });
  }

  const queued = await enqueueOrderPrintJob(session.tenantId, id, 'manual_receipt');
  if (!queued) {
    return NextResponse.json({ error: 'Recibo manual desativado nas configuracoes de impressao.' }, { status: 409 });
  }

  return NextResponse.json({ ok: true });
}
