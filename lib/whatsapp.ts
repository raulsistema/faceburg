import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';
import { notifyAgentJobAvailable } from '@/lib/realtime';

type OrderHeaderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  payment_method: string | null;
  delivery_fee_amount: string;
  total: string;
  status: string;
  type: string;
  cancellation_reason: string | null;
  created_at: string;
};

type OrderItemRow = {
  quantity: number;
  product_name: string;
  unit_price: string;
};

type AgentConfigRow = {
  tenant_id: string;
  enabled: boolean;
  agent_key: string | null;
  session_status: string;
  last_seen_at: string | null;
};

const HUB_HEARTBEAT_GRACE_MS = 2 * 60 * 1000;

function isHubActive(sessionStatus: string, lastSeenAt: string | null) {
  if (sessionStatus !== 'ready') return false;
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= HUB_HEARTBEAT_GRACE_MS;
}

function formatBrl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function statusToLabel(status: string) {
  if (status === 'pending') return 'Novo';
  if (status === 'processing') return 'Em preparo';
  if (status === 'delivering') return 'Saiu para entrega';
  if (status === 'completed') return 'Concluido';
  if (status === 'cancelled') return 'Cancelado';
  return status;
}

function typeToLabel(type: string) {
  if (type === 'delivery') return 'Delivery';
  if (type === 'pickup') return 'Retirada';
  if (type === 'table') return 'Mesa';
  return type;
}

function normalizeWhatsappTarget(phone: string | null) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('55')) return `${digits}@c.us`;
  return `55${digits}@c.us`;
}

export async function buildOrderWhatsappText(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
) {
  const orderResult = await executor.query<OrderHeaderRow>(
    `SELECT id, customer_name, customer_phone, delivery_address, payment_method, delivery_fee_amount::text, total::text, status, type, cancellation_reason, created_at
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [tenantId, orderId],
  );

  if (!orderResult.rowCount) return null;
  const order = orderResult.rows[0];

  if (eventType === 'status_update' && order.status !== 'delivering') {
    return null;
  }

  const targetPhone = normalizeWhatsappTarget(order.customer_phone);
  if (!targetPhone) return null;

  const itemsResult = await executor.query<OrderItemRow>(
    `SELECT oi.quantity,
            COALESCE(p.name, 'Produto removido') AS product_name,
            oi.unit_price::text
     FROM order_items oi
     JOIN orders o
       ON o.id = oi.order_id
      AND o.tenant_id = $1
     LEFT JOIN products p
       ON p.id = oi.product_id
      AND p.tenant_id = o.tenant_id
     WHERE oi.order_id = $2
     ORDER BY COALESCE(p.name, 'Produto removido') ASC`,
    [tenantId, orderId],
  );

  const itemLines = itemsResult.rows.map((item) => {
    const subtotal = item.quantity * Number(item.unit_price || 0);
    return `- ${item.quantity}x ${item.product_name} (${formatBrl(subtotal)})`;
  });

  const createdAt = new Date(order.created_at);
  const paymentLabel =
    order.payment_method === 'cash' ? 'Dinheiro' : order.payment_method === 'card' ? 'Cartao' : 'Pix';
  const deliveryFee = Number(order.delivery_fee_amount || 0);

  const lines = [
    eventType === 'new_order' ? 'Pedido recebido com sucesso!' : 'Atualizacao do seu pedido',
    '',
    `Pedido #${order.id.slice(0, 8).toUpperCase()}`,
    `Status: ${statusToLabel(order.status)}`,
    `Tipo: ${typeToLabel(order.type)}`,
    `Pagamento: ${paymentLabel}`,
    `Data: ${createdAt.toLocaleDateString('pt-BR')} ${createdAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    order.delivery_address ? `Endereco: ${order.delivery_address}` : '',
    '',
    'Itens:',
    ...itemLines,
    '',
    order.type === 'delivery' ? `Frete: ${formatBrl(deliveryFee)}` : '',
    `Total: ${formatBrl(Number(order.total || 0))}`,
    order.status === 'cancelled' ? `Motivo: ${order.cancellation_reason || 'Nao informado'}` : '',
  ].filter(Boolean);

  return {
    targetPhone,
    payloadText: lines.join('\n'),
  };
}

export async function enqueueOrderWhatsappJob(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
) {
  const configResult = await executor.query<AgentConfigRow>(
    `SELECT tenant_id, enabled, agent_key, session_status, last_seen_at
     FROM whatsapp_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [tenantId],
  );

  const config = configResult.rows[0];
  if (!config || !config.enabled || !config.agent_key) {
    return false;
  }
  if (!isHubActive(String(config.session_status || ''), config.last_seen_at || null)) {
    await executor.query(
      `UPDATE whatsapp_agents
       SET enabled = FALSE,
           updated_at = NOW()
       WHERE tenant_id = $1
         AND enabled = TRUE`,
      [tenantId],
    );
    return false;
  }

  const payload = await buildOrderWhatsappText(tenantId, orderId, eventType, executor);
  if (!payload) return false;

  await executor.query(
    `INSERT INTO whatsapp_jobs
      (id, tenant_id, order_id, target_phone, event_type, payload_text, status, attempt_count, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, 'queued', 0, NOW(), NOW())`,
    [randomUUID(), tenantId, orderId, payload.targetPhone, eventType, payload.payloadText],
  );
  await notifyAgentJobAvailable(tenantId, 'whatsapp', executor);

  return true;
}
