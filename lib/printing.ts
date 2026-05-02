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
  payment_method_id: string | null;
  payment_method_names: string | null;
  subtotal_amount: string;
  discount_amount: string;
  surcharge_amount: string;
  delivery_fee_amount: string;
  change_for: string | null;
  total: string;
  status: string;
  type: string;
  table_number: string | null;
  cancellation_reason: string | null;
  created_at: string;
  tenant_name: string;
  issuer_name: string | null;
  issuer_trade_name: string | null;
  issuer_document: string | null;
  issuer_phone: string | null;
  issuer_zip_code: string | null;
  issuer_street: string | null;
  issuer_number: string | null;
  issuer_complement: string | null;
  issuer_neighborhood: string | null;
  issuer_city: string | null;
  issuer_state: string | null;
  prep_time_minutes: number | null;
};

type OrderItemRow = {
  quantity: number;
  product_name: string;
  unit_price: string;
  notes: string | null;
};

type OrderItemNotesPayload = {
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

type AgentConfigRow = {
  tenant_id: string;
  enabled: boolean;
  agent_key: string | null;
};

const RECEIPT_WIDTH = 32;

function formatBrl(value: number) {
  return value
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\u00a0/g, ' ');
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

function divider(char = '-') {
  return char.repeat(RECEIPT_WIDTH);
}

function wrapText(value: string, width = RECEIPT_WIDTH) {
  const clean = text(value).replace(/\s+/g, ' ');
  if (!clean) return [];

  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }

    if (current) {
      lines.push(current);
      current = '';
    }

    if (word.length <= width) {
      current = word;
      continue;
    }

    let remaining = word;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    current = remaining;
  }

  if (current) {
    lines.push(current);
  }

  return lines;
}

function wrapLabeled(label: string, value: string, width = RECEIPT_WIDTH) {
  const trimmedLabel = label.trimEnd();
  const contentWidth = Math.max(8, width - trimmedLabel.length);
  const wrapped = wrapText(value, contentWidth);
  if (!wrapped.length) return [];
  return wrapped.map((line, index) => (index === 0 ? `${trimmedLabel}${line}` : `${' '.repeat(trimmedLabel.length)}${line}`));
}

function alignLine(left: string, right: string, width = RECEIPT_WIDTH) {
  const safeLeft = text(left);
  const safeRight = text(right);
  if (!safeRight) return safeLeft;
  const spacing = width - safeLeft.length - safeRight.length;
  if (spacing >= 1) {
    return `${safeLeft}${' '.repeat(spacing)}${safeRight}`;
  }
  return `${safeLeft}\n${safeRight}`;
}

function centerLine(value: string, width = RECEIPT_WIDTH) {
  const clean = text(value);
  if (!clean) return '';
  if (clean.length >= width) return clean;
  const leftPadding = Math.floor((width - clean.length) / 2);
  return `${' '.repeat(leftPadding)}${clean}`;
}

function maskPhone(raw: string | null) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 11);
  if (!digits) return '';
  if (digits.length <= 2) return digits;
  if (digits.length <= 6) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  if (digits.length <= 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function statusToLabel(status: string) {
  if (status === 'pending') return 'Novo';
  if (status === 'processing') return 'Em preparo';
  if (status === 'delivering') return 'Saiu para entrega';
  if (status === 'completed') return 'Concluido';
  if (status === 'cancelled') return 'Cancelado';
  return status;
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

function typeToHeader(type: string) {
  if (type === 'delivery') return 'DELIVERY';
  if (type === 'pickup') return 'BALCAO';
  if (type === 'table') return 'MESA';
  return 'PEDIDO';
}

function buildPrintStage(orderType: string, orderStatus: string, eventType: 'new_order' | 'status_update' | 'manual_receipt') {
  if (eventType === 'status_update' && orderStatus === 'processing') {
    return {
      header: 'COZINHA',
      tags: [typeToHeader(orderType), 'VIA COZINHA'],
    };
  }

  if (eventType === 'new_order') {
    return {
      header: typeToHeader(orderType),
      tags: ['VIA BALCAO'],
    };
  }

  if (eventType === 'manual_receipt') {
    return {
      header: typeToHeader(orderType),
      tags: ['RECIBO'],
    };
  }

  if (eventType === 'status_update' && orderStatus === 'delivering') {
    return {
      header: typeToHeader(orderType),
      tags: ['SAIU P/ ENTREGA'],
    };
  }

  if (eventType === 'status_update' && orderStatus === 'completed') {
    return {
      header: typeToHeader(orderType),
      tags: ['PEDIDO CONCLUIDO'],
    };
  }

  if (eventType === 'status_update' && orderStatus === 'cancelled') {
    return {
      header: typeToHeader(orderType),
      tags: ['PEDIDO CANCELADO'],
    };
  }

  return {
    header: typeToHeader(orderType),
    tags: [] as string[],
  };
}

function typeToForecastLabel(type: string) {
  if (type === 'delivery') return 'Entrega prevista:';
  if (type === 'pickup') return 'Retirada prevista:';
  return 'Previsao:';
}

function typeToPaymentSentence(type: string, paymentLabel: string) {
  if (type === 'delivery') return `Pagar na entrega (${paymentLabel})`;
  if (type === 'pickup') return `Pagar na retirada (${paymentLabel})`;
  if (type === 'table') return `Pagamento na mesa (${paymentLabel})`;
  return `Pagamento (${paymentLabel})`;
}

function formatAddressText(value: string | null) {
  return text(value)
    .replace(/\s*\|\s*/g, ', ')
    .replace(/\s+-\s+/g, ' - ')
    .replace(/\s{2,}/g, ' ');
}

function parseItemNotes(raw: string | null) {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as OrderItemNotesPayload;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return {
      notes: raw,
      pizza: null,
      options: [],
    };
  }
}

function buildItemLines(item: OrderItemRow) {
  const lines: string[] = [];
  const itemTotal = Number(item.unit_price || 0) * Number(item.quantity || 0);
  const title = `${item.quantity}un ${text(item.product_name)}`;
  const priceLabel = formatBrl(itemTotal);

  const wrappedTitle = wrapText(title, RECEIPT_WIDTH);
  if (wrappedTitle.length === 1 && wrappedTitle[0].length + priceLabel.length + 1 <= RECEIPT_WIDTH) {
    lines.push(alignLine(wrappedTitle[0], priceLabel));
  } else {
    lines.push(...wrappedTitle);
    lines.push(`x ${priceLabel}`);
  }

  const parsedNotes = parseItemNotes(item.notes);
  const pizza = parsedNotes?.pizza;
  const options = Array.isArray(parsedNotes?.options) ? parsedNotes?.options : [];
  const observation = text(parsedNotes?.notes);

  if (pizza?.sizeLabel) {
    lines.push(...wrapText(`Tamanho: ${pizza.sizeLabel}`, RECEIPT_WIDTH));
  }

  const flavors = Array.isArray(pizza?.flavors) ? pizza?.flavors.filter((flavor) => text(flavor?.name)) : [];
  if (flavors.length > 1) {
    for (const flavor of flavors) {
      lines.push(...wrapText(`1/${flavors.length} ${text(flavor.name)}`, RECEIPT_WIDTH));
    }
  } else if (flavors.length === 1) {
    lines.push(...wrapText(`Sabor: ${text(flavors[0].name)}`, RECEIPT_WIDTH));
  }

  if (pizza?.border?.label) {
    lines.push(...wrapText(`Borda: ${text(pizza.border.label)}`, RECEIPT_WIDTH));
  }

  if (pizza?.dough?.label) {
    lines.push(...wrapText(`Massa: ${text(pizza.dough.label)}`, RECEIPT_WIDTH));
  }

  if (pizza?.gift?.name) {
    const giftQty = Math.max(1, Number(pizza.gift.quantity || 1));
    lines.push(...wrapText(`Brinde: ${text(pizza.gift.name)} x${giftQty}`, RECEIPT_WIDTH));
  }

  for (const option of options) {
    const optionName = text(option?.name);
    if (!optionName) continue;
    const optionPrice = Number(option?.priceAddition || 0);
    const label = optionPrice > 0 ? `+ ${optionName} (+ ${formatBrl(optionPrice)})` : `+ ${optionName}`;
    lines.push(...wrapText(label, RECEIPT_WIDTH));
  }

  if (observation) {
    lines.push(...wrapLabeled('Obs.: ', observation, RECEIPT_WIDTH));
  }

  return lines;
}

function buildStoreFooter(order: OrderHeaderRow) {
  const lines: string[] = [];
  const storeName = text(order.issuer_trade_name) || text(order.issuer_name) || text(order.tenant_name);
  const storeStreet = [text(order.issuer_street), text(order.issuer_number)].filter(Boolean).join(', ');
  const storeArea = text(order.issuer_neighborhood);
  const storeCity = [text(order.issuer_city), text(order.issuer_state)].filter(Boolean).join('/');
  const storeZip = text(order.issuer_zip_code);
  const storeLocation = [storeCity, storeZip].filter(Boolean).join(' ');

  if (storeName) {
    lines.push(centerLine(storeName));
  }
  if (storeStreet) {
    lines.push(...wrapText(storeStreet, RECEIPT_WIDTH).map((line) => centerLine(line)));
  }
  if (storeArea) {
    lines.push(...wrapText(storeArea, RECEIPT_WIDTH).map((line) => centerLine(line)));
  }
  if (storeLocation) {
    lines.push(...wrapText(storeLocation, RECEIPT_WIDTH).map((line) => centerLine(line)));
  }
  if (text(order.issuer_document)) {
    lines.push(centerLine(`CNPJ: ${text(order.issuer_document)}`));
  }
  return lines.filter(Boolean);
}

export async function buildOrderPrintText(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update' | 'manual_receipt',
  executor: DbExecutor = { query },
) {
  const orderResult = await executor.query<OrderHeaderRow>(
    `SELECT o.id,
            o.customer_name,
            o.customer_phone,
            o.delivery_address,
            o.payment_method,
            o.payment_method_id,
            COALESCE(
              NULLIF(string_agg(DISTINCT op.method_name, ' + '), ''),
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
            o.table_number,
            o.cancellation_reason,
            o.created_at,
            t.name AS tenant_name,
            t.issuer_name,
            t.issuer_trade_name,
            t.issuer_document,
            t.issuer_phone,
            t.issuer_zip_code,
            t.issuer_street,
            t.issuer_number,
            t.issuer_complement,
            t.issuer_neighborhood,
            t.issuer_city,
            t.issuer_state,
            t.prep_time_minutes
     FROM orders o
     JOIN tenants t
       ON t.id = o.tenant_id
     LEFT JOIN payment_methods pm
       ON pm.id = o.payment_method_id
      AND pm.tenant_id = o.tenant_id
     LEFT JOIN order_payments op
       ON op.order_id = o.id
      AND op.tenant_id = o.tenant_id
     WHERE o.tenant_id = $1
       AND o.id = $2
     GROUP BY o.id,
              pm.name,
              t.name,
              t.issuer_name,
              t.issuer_trade_name,
              t.issuer_document,
              t.issuer_phone,
              t.issuer_zip_code,
              t.issuer_street,
              t.issuer_number,
              t.issuer_complement,
              t.issuer_neighborhood,
              t.issuer_city,
              t.issuer_state,
              t.prep_time_minutes
     LIMIT 1`,
    [tenantId, orderId],
  );

  if (!orderResult.rowCount) return '';
  const order = orderResult.rows[0];

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
     ORDER BY COALESCE(p.name, 'Produto removido') ASC`,
    [tenantId, orderId],
  );

  const createdAt = new Date(order.created_at);
  const estimatedAt = new Date(createdAt.getTime() + Math.max(0, Number(order.prep_time_minutes || 0)) * 60_000);
  const paymentLabel = paymentToLabel(order.payment_method, order.payment_method_names);
  const subtotalAmount = Number(order.subtotal_amount || 0);
  const discountAmount = Number(order.discount_amount || 0);
  const surchargeAmount = Number(order.surcharge_amount || 0);
  const deliveryFeeAmount = Number(order.delivery_fee_amount || 0);
  const totalAmount = Number(order.total || 0);
  const changeFor = Number(order.change_for || 0);
  const itemCount = itemsResult.rows.length;
  const lines: string[] = [];
  const printStage = buildPrintStage(order.type, order.status, eventType);

  lines.push(printStage.header);
  for (const tag of printStage.tags) {
    lines.push(centerLine(tag));
  }
  lines.push(`Venda: ${order.id.slice(0, 8).toUpperCase()}`);
  lines.push(
    `Data: ${createdAt.toLocaleDateString('pt-BR')} ${createdAt.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
    })}`,
  );

  if (order.type === 'delivery' || order.type === 'pickup') {
    lines.push(
      `${typeToForecastLabel(order.type)} ${estimatedAt.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit',
      })}`,
    );
  }

  if (eventType === 'status_update') {
    lines.push(`Status: ${statusToLabel(order.status)}`);
  }

  lines.push(...wrapLabeled('Cliente: ', text(order.customer_name) || 'Sem nome', RECEIPT_WIDTH));

  const phone = maskPhone(order.customer_phone);
  if (phone) {
    lines.push(...wrapLabeled('Tel.: ', phone, RECEIPT_WIDTH));
  }

  if (order.type === 'table' && text(order.table_number)) {
    lines.push(...wrapLabeled('Mesa: ', text(order.table_number), RECEIPT_WIDTH));
  }

  const deliveryAddress = formatAddressText(order.delivery_address);
  if (deliveryAddress) {
    lines.push(...wrapLabeled('End.: ', deliveryAddress, RECEIPT_WIDTH));
  }

  lines.push(divider());
  lines.push(centerLine('DOCUMENTO DE VENDA'));
  lines.push(divider());

  for (const item of itemsResult.rows) {
    lines.push(...buildItemLines(item));
    lines.push(divider());
  }

  lines.push(alignLine('Itens Comanda', `${itemCount} ${itemCount === 1 ? 'item' : 'itens'}`));
  lines.push('');
  lines.push(alignLine('Sub Total:', formatBrl(subtotalAmount)));
  if (discountAmount > 0) {
    lines.push(alignLine('Desconto:', `- ${formatBrl(discountAmount)}`));
  }
  if (surchargeAmount > 0) {
    lines.push(alignLine('Acrescimo:', formatBrl(surchargeAmount)));
  }
  if (order.type === 'delivery' || deliveryFeeAmount > 0) {
    lines.push(alignLine('Entrega:', formatBrl(deliveryFeeAmount)));
  }
  lines.push(alignLine('Total:', formatBrl(totalAmount)));
  if (changeFor > 0) {
    lines.push(alignLine('Troco para:', formatBrl(changeFor)));
  }
  lines.push('');
  lines.push(...wrapText(typeToPaymentSentence(order.type, paymentLabel), RECEIPT_WIDTH));

  if (order.status === 'cancelled' && text(order.cancellation_reason)) {
    lines.push('');
    lines.push(...wrapLabeled('Motivo: ', text(order.cancellation_reason), RECEIPT_WIDTH));
  }

  const storeFooter = buildStoreFooter(order);
  if (storeFooter.length) {
    lines.push('');
    lines.push(...storeFooter);
  }

  lines.push('');
  lines.push('');
  return lines.filter((line, index, source) => line || (index > 0 && source[index - 1] !== '')).join('\n');
}

export async function enqueueOrderPrintJob(
  tenantId: string,
  orderId: string,
  eventType: 'new_order' | 'status_update' | 'manual_receipt',
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
