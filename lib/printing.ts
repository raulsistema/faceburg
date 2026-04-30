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
};

function formatBrl(value: number) {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export async function buildOrderPrintText(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
) {
  const orderResult = await executor.query<OrderHeaderRow>(
    `SELECT id, customer_name, customer_phone, delivery_address, payment_method, total::text, status, type, cancellation_reason, created_at
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [tenantId, orderId],
  );

  if (!orderResult.rowCount) return '';
  const order = orderResult.rows[0];
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

  const headerTitle = eventType === 'new_order' ? 'NOVO PEDIDO' : 'ATUALIZACAO PEDIDO';
  const typeLabel = order.type === 'delivery' ? 'Delivery' : order.type === 'pickup' ? 'Balcao' : 'Mesa';
  const paymentLabel =
    order.payment_method === 'cash' ? 'Dinheiro' : order.payment_method === 'card' ? 'Cartao' : 'Pix';
  const createdAt = new Date(order.created_at);
  const itemLines = itemsResult.rows.map((item) => {
    const subtotal = item.quantity * Number(item.unit_price || 0);
    return `${item.quantity}x ${item.product_name} - ${formatBrl(subtotal)}`;
  });

  const lines = [
    '=======================================',
    `${headerTitle}`,
    `Pedido #${order.id.slice(0, 8)}`,
    '=======================================',
    `Data: ${createdAt.toLocaleDateString('pt-BR')} ${createdAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    `Cliente: ${order.customer_name || 'Sem nome'}`,
    `Telefone: ${order.customer_phone || '-'}`,
    `Tipo: ${typeLabel}`,
    `Status: ${order.status}`,
    order.delivery_address ? `Endereco: ${order.delivery_address}` : '',
    `Pagamento: ${paymentLabel}`,
    '',
    'ITENS',
    ...itemLines,
    '',
    `TOTAL: ${formatBrl(Number(order.total || 0))}`,
    order.status === 'cancelled'
      ? `MOTIVO CANCELAMENTO: ${order.cancellation_reason || 'Nao informado'}`
      : '',
    '',
    `Evento: ${eventType === 'new_order' ? 'Novo pedido' : 'Mudanca de status'}`,
    '=======================================',
    '',
    '',
  ].filter(Boolean);

  return lines.join('\n');
}

export async function enqueueOrderPrintJob(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
) {
  const configResult = await executor.query<AgentConfigRow>(
    `SELECT tenant_id, enabled, agent_key
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [tenantId],
  );

  const config = configResult.rows[0];
  if (!config || !config.enabled || !config.agent_key) {
    return false;
  }

  const payloadText = await buildOrderPrintText(tenantId, orderId, eventType, executor);
  if (!payloadText) return false;

  await executor.query(
    `INSERT INTO print_jobs
      (id, tenant_id, order_id, event_type, payload_text, status, attempt_count, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, 'queued', 0, NOW(), NOW())`,
    [randomUUID(), tenantId, orderId, eventType, payloadText],
  );
  await notifyAgentJobAvailable(tenantId, 'print', executor);

  return true;
}
