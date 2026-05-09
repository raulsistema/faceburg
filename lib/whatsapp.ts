import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';
import { buildTrackingUrl } from '@/lib/delivery-tracking';
import { notifyAgentJobAvailable } from '@/lib/realtime';

type OrderHeaderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  payment_method: string | null;
  payment_method_names: string | null;
  subtotal_amount: string;
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
  change_for: string | null;
  total: string;
  status: string;
  type: string;
  cancellation_reason: string | null;
  delivery_tracking_token: string | null;
  created_at: string;
  prep_time_minutes: number | null;
  tenant_name: string;
  issuer_trade_name: string | null;
};

type OrderItemRow = {
  quantity: number;
  product_name: string;
  unit_price: string;
  notes: string | null;
};

type AgentConfigRow = {
  tenant_id: string;
  enabled: boolean;
  agent_key: string | null;
  session_status: string;
  last_seen_at: string | null;
};

export type PreparedOrderWhatsappJob = {
  id: string;
  orderId: string;
  eventType: 'new_order' | 'status_update';
  targetPhone: string;
  payloadText: string;
};

const HUB_HEARTBEAT_GRACE_MS = 2 * 60 * 1000;

let whatsappJobSchemaPromise: Promise<void> | null = null;

function isHubActive(sessionStatus: string, lastSeenAt: string | null) {
  if (sessionStatus !== 'ready') return false;
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= HUB_HEARTBEAT_GRACE_MS;
}

function formatAmount(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

async function ensureWhatsappJobSchema(executor: DbExecutor = { query }) {
  if (!whatsappJobSchemaPromise) {
    whatsappJobSchemaPromise = (async () => {
      await executor.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'whatsapp_jobs' AND column_name = 'dedupe_key'
          ) THEN
            ALTER TABLE whatsapp_jobs ADD COLUMN dedupe_key TEXT;
          END IF;
        END $$;
      `);
      await executor.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_jobs_tenant_dedupe_key
          ON whatsapp_jobs(tenant_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;
      `);
    })().catch((error) => {
      whatsappJobSchemaPromise = null;
      throw error;
    });
  }

  await whatsappJobSchemaPromise;
}

function normalizeBrazilianPhoneDigits(raw: string | null) {
  let digits = String(raw || '').replace(/\D/g, '');
  if (digits.startsWith('00')) {
    digits = digits.slice(2);
  }
  if (digits.startsWith('55') && digits.length >= 12) {
    digits = digits.slice(2);
  }
  return digits.replace(/^0+/, '');
}

function typeToHeading(type: string) {
  if (type === 'delivery') return 'DELIVERY';
  if (type === 'pickup') return 'RETIRADA NA LOJA';
  if (type === 'table') return 'CONSUMIR NO LOCAL';
  return type;
}

function typeToPaymentPrefix(type: string) {
  if (type === 'pickup') return 'Pagar na retirada';
  if (type === 'table') return 'Pagar no local';
  return 'Pagar na entrega';
}

function typeToForecastLabel(type: string) {
  if (type === 'pickup') return 'Previsao retirada';
  if (type === 'delivery') return 'Previsao entrega';
  return 'Previsao';
}

function paymentToLabel(paymentMethod: string | null, paymentMethodNames: string | null) {
  const explicitName = text(paymentMethodNames);
  if (explicitName) return explicitName;

  const normalized = text(paymentMethod).toLowerCase();
  if (normalized === 'cash') return 'Dinheiro';
  if (normalized === 'card') return 'Cartao';
  if (normalized === 'pix') return 'Pix';
  if (normalized === 'split') return 'Multiplos';
  return text(paymentMethod) || 'Nao informado';
}

function paymentSentence(orderType: string, paymentMethod: string | null, paymentMethodNames: string | null) {
  const paymentLabel = paymentToLabel(paymentMethod, paymentMethodNames);
  if (paymentLabel.toLowerCase().startsWith('pagar ')) return paymentLabel;
  return `${typeToPaymentPrefix(orderType)} (${paymentLabel})`;
}

function isCashPayment(paymentMethod: string | null, paymentMethodNames: string | null) {
  const normalizedMethod = text(paymentMethod).toLowerCase();
  const normalizedNames = text(paymentMethodNames).toLowerCase();
  return normalizedMethod === 'cash' || normalizedNames.includes('dinheiro');
}

function normalizeWhatsappTarget(phone: string | null) {
  const digits = normalizeBrazilianPhoneDigits(phone);
  if (!digits) return '';
  return `55${digits}@c.us`;
}

function formatPhone(raw: string | null) {
  const digits = normalizeBrazilianPhoneDigits(raw).slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

type WhatsappItemNotesPayload = {
  notes?: string | null;
  pizza?: {
    sizeLabel?: string;
    flavors?: Array<{ id?: string; name?: string }>;
    border?: { label?: string; price?: number } | null;
    dough?: { label?: string; price?: number } | null;
    gift?: { id?: string; name?: string; quantity?: number } | null;
  } | null;
  options?: Array<{ id?: string; name?: string; priceAddition?: number }>;
};

function parseWhatsappItemNotes(raw: string | null): WhatsappItemNotesPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as WhatsappItemNotesPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    const trimmed = text(raw);
    if (!trimmed) return null;
    return { notes: trimmed, pizza: null, options: [] };
  }
}

function formatDeliveryAddress(value: string | null) {
  return text(value)
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ');
}

function buildNewOrderMessage(order: OrderHeaderRow, items: OrderItemRow[]) {
  const createdAt = new Date(order.created_at);
  const subtotalAmount = Number(order.subtotal_amount || 0);
  const discountAmount = Number(order.discount_amount || 0);
  const surchargeAmount = Number(order.surcharge_amount || 0);
  const deliveryFee = Number(order.delivery_fee_amount || 0);
  const changeForAmount = Number(order.change_for || 0);
  const shouldShowChangeFor = changeForAmount > 0 && isCashPayment(order.payment_method, order.payment_method_names);
  const prepTime = Math.max(1, Number(order.prep_time_minutes || 0));
  const divider = '--------------------';
  const storeName = text(order.issuer_trade_name) || text(order.tenant_name) || 'Faceburg';
  const itemLines = items.flatMap((item) => {
    const quantity = Math.max(1, Number(item.quantity || 1));
    const unitPrice = Number(item.unit_price || 0);
    const lines: string[] = [
      text(item.product_name) || 'Produto',
      `    ${quantity}un.    ${formatAmount(unitPrice)}`,
    ];

    const parsedNotes = parseWhatsappItemNotes(item.notes);
    if (parsedNotes) {
      if (parsedNotes.pizza) {
        if (parsedNotes.pizza.sizeLabel) {
          lines.push(`    Tam: ${parsedNotes.pizza.sizeLabel}`);
        }
        const flavors = Array.isArray(parsedNotes.pizza.flavors)
          ? parsedNotes.pizza.flavors.filter((f: { name?: string }) => text(f?.name))
          : [];
        if (flavors.length > 1) {
          for (const flavor of flavors) {
            lines.push(`    1/${flavors.length} ${text(flavor.name)}`);
          }
        } else if (flavors.length === 1) {
          lines.push(`    Sabor: ${text(flavors[0].name)}`);
        }
        if (parsedNotes.pizza.border?.label) {
          lines.push(`    Borda: ${text(parsedNotes.pizza.border.label)}`);
        }
        if (parsedNotes.pizza.dough?.label) {
          lines.push(`    Massa: ${text(parsedNotes.pizza.dough.label)}`);
        }
        if (parsedNotes.pizza.gift?.name) {
          lines.push(`    Brinde: ${text(parsedNotes.pizza.gift.name)}`);
        }
      }
      const options = Array.isArray(parsedNotes.options) ? parsedNotes.options : [];
      for (const opt of options) {
        const name = text(opt?.name);
        if (!name) continue;
        const price = Number(opt?.priceAddition || 0);
        lines.push(price > 0 ? `    + ${name} (+${formatAmount(price)})` : `    + ${name}`);
      }
      const obs = text(parsedNotes.notes);
      if (obs) {
        lines.push(`    Obs: ${obs}`);
      }
    }

    return lines;
  });

  const lines = [
    `*${storeName}*`,
    'Pedido recebido com sucesso.',
    '',
    `*Codigo:* #${order.id.slice(0, 8).toUpperCase()}`,
    `*Data:* ${createdAt.toLocaleDateString('pt-BR')} ${createdAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
    `*Cliente:* ${text(order.customer_name) || 'Sem nome'}`,
    `*Contato:* ${formatPhone(order.customer_phone) || text(order.customer_phone) || 'Nao informado'}`,
    `*Pagamento:* ${paymentSentence(order.type, order.payment_method, order.payment_method_names)}`,
    shouldShowChangeFor ? `*Troco para:* ${formatAmount(changeForAmount)}` : '',
    `*${typeToHeading(order.type)}*`,
    order.type === 'delivery' && text(order.delivery_address) ? `*Endereco:* ${formatDeliveryAddress(order.delivery_address)}` : '',
    '',
    divider,
    '*ITENS:*',
    ...itemLines,
    divider,
    '',
    `*Sub Total:* ${formatAmount(subtotalAmount)}`,
    discountAmount > 0 ? `*Desconto:* ${formatAmount(discountAmount)}` : '',
    surchargeAmount > 0 ? `*Acrescimo:* ${formatAmount(surchargeAmount)}` : '',
    order.type === 'delivery' || deliveryFee > 0 ? `*Entrega:* ${formatAmount(deliveryFee)}` : '',
    '',
    `*TOTAL:* ${formatAmount(Number(order.total || 0))}`,
    '',
    `*${typeToForecastLabel(order.type)}:* ${prepTime} min`,
  ];

  return lines.filter(Boolean).join('\n');
}

function buildDeliveryStatusMessage(order: OrderHeaderRow) {
  const customerName = text(order.customer_name);
  const greeting = customerName ? `Ola, ${customerName}` : 'Ola';
  const trackingUrl = order.delivery_tracking_token ? buildTrackingUrl(order.delivery_tracking_token) : '';
  return [
    `${greeting}, seu pedido saiu para entrega e em breve chegara ate voce.`,
    trackingUrl ? `Acompanhe aqui: ${trackingUrl}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function buildOrderWhatsappText(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
) {
  const orderResult = await executor.query<OrderHeaderRow>(
    `SELECT o.id,
            o.customer_name,
            o.customer_phone,
            o.delivery_address,
            o.payment_method,
            COALESCE(
              NULLIF((
                SELECT string_agg(DISTINCT op.method_name, ' + ')
                FROM order_payments op
                WHERE op.order_id = o.id
                  AND op.tenant_id = o.tenant_id
              ), ''),
              pm.name
            ) AS payment_method_names,
            o.subtotal_amount::text,
            o.discount_amount::text,
            o.surcharge_amount::text,
            o.delivery_fee_amount::text,
            o.change_for::text,
            o.total::text,
            o.status,
            o.type,
            o.cancellation_reason,
            o.delivery_tracking_token,
            o.created_at,
            t.prep_time_minutes,
            t.name AS tenant_name,
            t.issuer_trade_name
     FROM orders o
     JOIN tenants t
       ON t.id = o.tenant_id
     LEFT JOIN payment_methods pm
       ON pm.id = o.payment_method_id
      AND pm.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1
       AND o.id = $2
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
            oi.unit_price::text,
            oi.notes
     FROM order_items oi
     JOIN orders o
       ON o.id = oi.order_id
      AND o.tenant_id = $1
     LEFT JOIN products p
       ON p.id = oi.product_id
      AND p.tenant_id = o.tenant_id
     WHERE oi.order_id = $2
     ORDER BY oi.ctid ASC`,
    [tenantId, orderId],
  );

  return {
    targetPhone,
    payloadText: eventType === 'new_order'
      ? buildNewOrderMessage(order, itemsResult.rows)
      : buildDeliveryStatusMessage(order),
  };
}

export async function enqueueOrderWhatsappJob(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
) {
  await ensureWhatsappJobSchema(executor);
  const prepared = await prepareOrderWhatsappJob(tenantId, orderId, eventType, executor);
  if (!prepared) return false;

  const result = await executor.query(
    `INSERT INTO whatsapp_jobs
      (id, tenant_id, order_id, target_phone, event_type, payload_text, status, attempt_count, dedupe_key, created_at, updated_at)
     VALUES
      ($1, $2, $3, $4, $5, $6, 'queued', 0, $7, NOW(), NOW())
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [prepared.id, tenantId, orderId, prepared.targetPhone, eventType, prepared.payloadText, `${orderId}:${eventType}`],
  );
  if ((result.rowCount || 0) > 0) {
    await notifyAgentJobAvailable(tenantId, 'whatsapp', executor);
  }

  return (result.rowCount || 0) > 0;
}

export async function prepareOrderWhatsappJob(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update',
  executor: DbExecutor = { query },
  options: { requireActiveHub?: boolean; disableWhenOffline?: boolean } = {},
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
    return null;
  }
  if (options.requireActiveHub && !isHubActive(String(config.session_status || ''), config.last_seen_at || null)) {
    if (options.disableWhenOffline) {
      await executor.query(
        `UPDATE whatsapp_agents
         SET enabled = FALSE,
             updated_at = NOW()
         WHERE tenant_id = $1
           AND enabled = TRUE`,
        [tenantId],
      );
    }
    return null;
  }

  const payload = await buildOrderWhatsappText(tenantId, orderId, eventType, executor);
  if (!payload) return null;

  return {
    id: randomUUID(),
    orderId,
    eventType,
    targetPhone: payload.targetPhone,
    payloadText: payload.payloadText,
  } satisfies PreparedOrderWhatsappJob;
}
