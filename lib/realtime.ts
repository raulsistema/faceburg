import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';

type AgentJobKind = 'print' | 'whatsapp';
type OrderEventKind = 'created' | 'updated' | 'cancelled';

const AGENT_CHANNEL_NAME = 'agent_jobs';
const ORDER_CHANNEL_NAME = 'tenant_orders';

export async function notifyAgentJobAvailable(tenantId: string, kind: AgentJobKind, executor: DbExecutor = { query }) {
  try {
    const payload = JSON.stringify({
      tenantId,
      kind,
      ts: Date.now(),
    });
    await executor.query(`SELECT pg_notify($1, $2)`, [AGENT_CHANNEL_NAME, payload]);
  } catch {
    // Falha no notify nao pode quebrar o fluxo principal de criacao do pedido.
  }
}

export async function notifyOrderEvent(
  tenantId: string,
  event: OrderEventKind,
  orderId: string,
  executor: DbExecutor = { query },
) {
  try {
    const payload = JSON.stringify({
      tenantId,
      event,
      orderId,
      ts: Date.now(),
    });
    await executor.query(`SELECT pg_notify($1, $2)`, [ORDER_CHANNEL_NAME, payload]);
  } catch {
    // Falha no notify nao pode quebrar o fluxo principal de criacao do pedido.
  }
}
