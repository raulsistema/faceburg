import { randomUUID } from 'node:crypto';
import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';
import {
  DEFAULT_PRINT_WIDTH,
  getEffectiveReceiptWidth,
  normalizePrintCopies,
  normalizePrintEvents,
  normalizePrintTextSize,
  normalizeAutoAcceptOrders,
  normalizeReceiptOptions,
  normalizeReceiptText,
  normalizeReceiptWidth,
  printEventKeyFor,
  type PrintJobEventType,
} from '@/lib/print-settings';
import { notifyAgentJobAvailable } from '@/lib/realtime';

type OrderHeaderRow = {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  delivery_address: string | null;
  order_sequence_number: number | null;
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
  product_description: string | null;
  print_description: boolean | null;
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
  printer_name: string | null;
  connection_status?: string | null;
  last_seen_at?: string | null;
  receipt_width: number | null;
  print_text_size: string | null;
  print_copies: number | null;
  auto_accept_orders: boolean | null;
  print_events: unknown | null;
  receipt_options: unknown | null;
  receipt_header: string | null;
  receipt_footer: string | null;
};

type PrepareOrderPrintJobsOptions = {
  ignoreAgentEnabled?: boolean;
  requireActiveHub?: boolean;
};

type OrderStatusRow = {
  status: string;
};

const RECEIPT_WIDTH = DEFAULT_PRINT_WIDTH;
const PRINT_HUB_HEARTBEAT_GRACE_MS = 5 * 60 * 1000;

let communicationJobSchemaPromise: Promise<void> | null = null;

export type PreparedOrderPrintJob = {
  id: string;
  orderId: string;
  eventType: PrintJobEventType;
  payloadText: string;
  printerName?: string;
  columns: number;
  printTextSize: string;
  copyIndex: number;
  copies: number;
};

function formatBrl(value: number) {
  return value
    .toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
    .replace(/\u00a0/g, ' ');
}

function text(value: unknown) {
  return String(value ?? '').trim();
}

async function ensureCommunicationJobSchema(executor: DbExecutor = { query }) {
  if (!communicationJobSchemaPromise) {
    communicationJobSchemaPromise = (async () => {
      await executor.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'print_jobs' AND column_name = 'dedupe_key'
          ) THEN
            ALTER TABLE print_jobs ADD COLUMN dedupe_key TEXT;
          END IF;
        END $$;
      `);
      await executor.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_print_jobs_tenant_dedupe_key
          ON print_jobs(tenant_id, dedupe_key)
          WHERE dedupe_key IS NOT NULL;
      `);
    })().catch((error) => {
      communicationJobSchemaPromise = null;
      throw error;
    });
  }

  await communicationJobSchemaPromise;
}

function isPrintHubActive(connectionStatus: string | null | undefined, lastSeenAt: string | null | undefined) {
  if (!['ready', 'connecting'].includes(text(connectionStatus))) return false;
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= PRINT_HUB_HEARTBEAT_GRACE_MS;
}

function divider(width = RECEIPT_WIDTH, char = '-') {
  return char.repeat(width);
}

function receiptWidthForPrintSize(receiptWidth: unknown, printTextSize: unknown) {
  return getEffectiveReceiptWidth(receiptWidth, printTextSize);
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
  const labelText = label.endsWith(' ') ? label : `${label.trimEnd()} `;
  const contentWidth = Math.max(8, width - labelText.length);
  const wrapped = wrapText(value, contentWidth);
  if (!wrapped.length) return [];
  return wrapped.map((line, index) => (index === 0 ? `${labelText}${line}` : ` ${line}`));
}

function centerLine(value: string, width = RECEIPT_WIDTH) {
  const clean = text(value);
  if (!clean) return '';
  if (clean.length >= width) return clean;
  const leftPadding = Math.floor((width - clean.length) / 2);
  return `${' '.repeat(leftPadding)}${clean}`;
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

function maskPhone(raw: string | null) {
  const digits = normalizeBrazilianPhoneDigits(raw).slice(0, 11);
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

function isCashPayment(paymentMethod: string | null, paymentMethodNames: string | null) {
  const normalizedMethod = text(paymentMethod).toLowerCase();
  const normalizedNames = text(paymentMethodNames).toLowerCase();
  return normalizedMethod === 'cash' || normalizedNames.includes('dinheiro');
}

function typeToHeader(type: string) {
  if (type === 'delivery') return 'DELIVERY';
  if (type === 'pickup') return 'RETIRADA';
  if (type === 'table') return 'MESA';
  return 'PEDIDO';
}

function buildPrintStage(orderType: string, orderStatus: string, eventType: PrintJobEventType) {
  if (eventType === 'status_update' && orderStatus === 'processing') {
    return {
      header: 'COZINHA',
      tags: [typeToHeader(orderType)],
    };
  }

  if (eventType === 'new_order') {
    return {
      header: typeToHeader(orderType),
      tags: [],
    };
  }

  if (eventType === 'manual_receipt') {
    return {
      header: typeToHeader(orderType),
      tags: [],
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

function shouldPrintItemDescription(value: string) {
  const normalized = value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Boolean(normalized) && normalized !== 'sem descricao' && normalized !== 'sem descricao do produto';
}

function buildItemLines(
  item: OrderItemRow,
  width = RECEIPT_WIDTH,
  showDetails = true,
  showDescription = false,
) {
  const lines: string[] = [];
  const quantity = Math.max(1, Number(item.quantity || 1));
  const unitPrice = Number(item.unit_price || 0);
  const itemTotal = unitPrice * quantity;
  const title = `${quantity}un ${text(item.product_name)}`;
  const unitPriceLabel = formatBrl(unitPrice);
  const itemTotalLabel = formatBrl(itemTotal);
  const detailPrefix = ' ';
  const detailWidth = Math.max(8, width - detailPrefix.length);

  const itemLabel = `${title} x ${unitPriceLabel}`;
  if (itemLabel.length <= width) {
    lines.push(itemLabel);
  } else {
    lines.push(...wrapText(title, width));
    lines.push(`${detailPrefix}x ${unitPriceLabel}`);
  }

  const description = text(item.product_description);
  if (showDescription && item.print_description !== false && shouldPrintItemDescription(description)) {
    lines.push(...wrapText(description, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  if (quantity > 1 || Math.abs(itemTotal - unitPrice) > 0.009) {
    lines.push(`${detailPrefix}x ${itemTotalLabel}`);
  }


  if (!showDetails) {
    return lines;
  }

  const parsedNotes = parseItemNotes(item.notes);
  const pizza = parsedNotes?.pizza;
  const options = Array.isArray(parsedNotes?.options) ? parsedNotes?.options : [];
  const observation = text(parsedNotes?.notes);

  if (pizza?.sizeLabel) {
    lines.push(...wrapText(`Tam: ${pizza.sizeLabel}`, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  const flavors = Array.isArray(pizza?.flavors) ? pizza?.flavors.filter((flavor) => text(flavor?.name)) : [];
  if (flavors.length > 1) {
    for (const flavor of flavors) {
      lines.push(...wrapText(`1/${flavors.length} ${text(flavor.name)}`, detailWidth).map((line) => `${detailPrefix}${line}`));
    }
  } else if (flavors.length === 1) {
    lines.push(...wrapText(`Sabor: ${text(flavors[0].name)}`, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  if (pizza?.border?.label) {
    lines.push(...wrapText(`Borda: ${text(pizza.border.label)}`, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  if (pizza?.dough?.label) {
    lines.push(...wrapText(`Massa: ${text(pizza.dough.label)}`, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  if (pizza?.gift?.name) {
    const giftQty = Math.max(1, Number(pizza.gift.quantity || 1));
    lines.push(...wrapText(`Brinde: ${text(pizza.gift.name)} x${giftQty}`, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  for (const option of options) {
    const optionName = text(option?.name);
    if (!optionName) continue;
    const optionPrice = Number(option?.priceAddition || 0);
    const label = optionPrice > 0 ? `+ ${optionName} (+ ${formatBrl(optionPrice)})` : `+ ${optionName}`;
    lines.push(...wrapText(label, detailWidth).map((line) => `${detailPrefix}${line}`));
  }

  if (observation) {
    lines.push(...wrapLabeled('Obs.: ', observation, width));
  }

  return lines;
}

function buildStoreFooter(order: OrderHeaderRow, width = RECEIPT_WIDTH) {
  const lines: string[] = [];
  const storeName = text(order.issuer_trade_name) || text(order.issuer_name) || text(order.tenant_name);
  const storeStreet = [text(order.issuer_street), text(order.issuer_number)].filter(Boolean).join(', ');
  const storeArea = text(order.issuer_neighborhood);
  const storeCity = [text(order.issuer_city), text(order.issuer_state)].filter(Boolean).join('/');
  const storeZip = text(order.issuer_zip_code);
  const storeLocation = [storeCity, storeZip].filter(Boolean).join(' ');

  if (storeName) {
    lines.push(centerLine(storeName, width));
  }
  if (storeStreet) {
    lines.push(...wrapText(storeStreet, width).map((line) => centerLine(line, width)));
  }
  if (storeArea) {
    lines.push(...wrapText(storeArea, width).map((line) => centerLine(line, width)));
  }
  if (storeLocation) {
    lines.push(...wrapText(storeLocation, width).map((line) => centerLine(line, width)));
  }
  if (text(order.issuer_document)) {
    lines.push(centerLine(`CNPJ: ${text(order.issuer_document)}`, width));
  }
  return lines.filter(Boolean);
}

export async function buildOrderPrintText(
  tenantId: string,
  orderId: string,
  eventType: PrintJobEventType,
  executor: DbExecutor = { query },
  config?: Partial<AgentConfigRow> | null,
) {
  const orderResult = await executor.query<OrderHeaderRow>(
    `SELECT o.id,
            o.customer_name,
            o.customer_phone,
            o.delivery_address,
            o.order_sequence_number,
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
  const receiptWidth = receiptWidthForPrintSize(config?.receipt_width, config?.print_text_size);
  const receiptOptions = normalizeReceiptOptions(config?.receipt_options);
  const receiptHeader = normalizeReceiptText(config?.receipt_header);
  const receiptFooter = normalizeReceiptText(config?.receipt_footer);

  const itemsResult = await executor.query<OrderItemRow>(
    `SELECT oi.quantity,
            COALESCE(p.name, 'Produto removido') AS product_name,
            p.description AS product_description,
            p.print_description,
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

  const createdAt = new Date(order.created_at);
  const estimatedAt = new Date(createdAt.getTime() + Math.max(0, Number(order.prep_time_minutes || 0)) * 60_000);
  const paymentLabel = paymentToLabel(order.payment_method, order.payment_method_names);
  const subtotalAmount = Number(order.subtotal_amount || 0);
  const discountAmount = Number(order.discount_amount || 0);
  const surchargeAmount = Number(order.surcharge_amount || 0);
  const deliveryFeeAmount = Number(order.delivery_fee_amount || 0);
  const totalAmount = Number(order.total || 0);
  const changeFor = Number(order.change_for || 0);
  const shouldShowChangeFor = changeFor > 0 && isCashPayment(order.payment_method, order.payment_method_names);
  const itemCount = itemsResult.rows.length;
  const lines: string[] = [];
  const printStage = buildPrintStage(order.type, order.status, eventType);
  const isKitchenPrint = eventType === 'status_update' && order.status === 'processing';
  const typeHeader = typeToHeader(order.type);
  const orderSequenceLabel =
    order.order_sequence_number !== null && order.order_sequence_number !== undefined
      ? String(order.order_sequence_number)
      : '';

  if (receiptHeader) {
    for (const line of wrapText(receiptHeader, receiptWidth)) {
      lines.push(centerLine(line, receiptWidth));
    }
    lines.push(divider(receiptWidth));
  }

  const orderCode = order.id.slice(0, 8).toUpperCase();
  lines.push(centerLine(printStage.header, receiptWidth));
  let sequencePrinted = false;
  if (orderSequenceLabel && printStage.header === typeHeader) {
    lines.push(centerLine(orderSequenceLabel, receiptWidth));
    sequencePrinted = true;
  }
  for (const tag of printStage.tags) {
    lines.push(centerLine(tag, receiptWidth));
    if (orderSequenceLabel && !sequencePrinted && tag === typeHeader) {
      lines.push(centerLine(orderSequenceLabel, receiptWidth));
      sequencePrinted = true;
    }
  }
  lines.push('');
  lines.push(`Venda: ${orderCode}`);
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

  lines.push(...wrapLabeled('Cliente: ', text(order.customer_name) || 'Sem nome', receiptWidth));

  const phone = maskPhone(order.customer_phone);
  if (phone && receiptOptions.showCustomerPhone) {
    lines.push(...wrapLabeled('Tel.: ', phone, receiptWidth));
  }

  if (order.type === 'table' && text(order.table_number)) {
    lines.push(...wrapLabeled('Mesa: ', text(order.table_number), receiptWidth));
  }

  const deliveryAddress = formatAddressText(order.delivery_address);
  if (order.type === 'delivery' && deliveryAddress && receiptOptions.showDeliveryAddress) {
    lines.push(...wrapLabeled('End.: ', deliveryAddress, receiptWidth));
  }

  lines.push(divider(receiptWidth));
  lines.push(centerLine('DOCUMENTO DE VENDA', receiptWidth));
  lines.push(divider(receiptWidth));

  itemsResult.rows.forEach((item, index) => {
    lines.push(...buildItemLines(item, receiptWidth, receiptOptions.showItemNotes, receiptOptions.showItemDescription));
    if (index < itemsResult.rows.length - 1) lines.push(divider(receiptWidth));
  });
  lines.push(divider(receiptWidth));

  if (receiptOptions.showTotals) {
    lines.push(`Itens Comanda ${itemCount} ${itemCount === 1 ? 'Item' : 'Itens'}`);
    lines.push('');
    lines.push(`Sub Total: ${formatBrl(subtotalAmount)}`);
    if (discountAmount > 0) {
      lines.push(`Desconto: - ${formatBrl(discountAmount)}`);
    }
    if (surchargeAmount > 0) {
      lines.push(`Acrescimo: ${formatBrl(surchargeAmount)}`);
    }
    if (order.type === 'delivery' || deliveryFeeAmount > 0) {
      lines.push(`Entrega: ${formatBrl(deliveryFeeAmount)}`);
    }
    lines.push(`Total: ${formatBrl(totalAmount)}`);
    if (shouldShowChangeFor) {
      lines.push(`Troco para: ${formatBrl(changeFor)}`);
    }
  }

  if (receiptOptions.showPayment) {
    lines.push('');
    lines.push(...wrapText(typeToPaymentSentence(order.type, paymentLabel), receiptWidth));
    if (!receiptOptions.showTotals && shouldShowChangeFor) {
      lines.push(`Troco para: ${formatBrl(changeFor)}`);
    }
  }

  if (order.status === 'cancelled' && text(order.cancellation_reason)) {
    lines.push('');
    lines.push(...wrapLabeled('Motivo: ', text(order.cancellation_reason), receiptWidth));
  }

  const storeFooter = !isKitchenPrint && receiptOptions.showStoreInfo ? buildStoreFooter(order, receiptWidth) : [];
  if (storeFooter.length) {
    lines.push('');
    lines.push(...storeFooter);
  }

  if (receiptFooter) {
    lines.push('');
    for (const line of wrapText(receiptFooter, receiptWidth)) {
      lines.push(centerLine(line, receiptWidth));
    }
  }

  lines.push('');
  lines.push('');
  return lines.filter((line, index, source) => line || (index > 0 && source[index - 1] !== '')).join('\n');
}

export async function prepareOrderPrintJobs(
  tenantId: string,
  orderId: string,
  eventType: PrintJobEventType,
  executor: DbExecutor = { query },
  options: PrepareOrderPrintJobsOptions = {},
) {
  const configResult = await executor.query<AgentConfigRow>(
    `SELECT tenant_id,
            enabled,
            agent_key,
            printer_name,
            connection_status,
            last_seen_at,
            receipt_width,
            print_text_size,
            print_copies,
            auto_accept_orders,
            print_events,
            receipt_options,
            receipt_header,
            receipt_footer
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [tenantId],
  );

  const config = configResult.rows[0] ?? (
    options.ignoreAgentEnabled
      ? {
          tenant_id: tenantId,
          enabled: true,
          agent_key: 'local-http-agent',
          printer_name: null,
          connection_status: 'ready',
          last_seen_at: new Date().toISOString(),
          receipt_width: null,
          print_text_size: null,
          print_copies: null,
          auto_accept_orders: null,
          print_events: null,
          receipt_options: null,
          receipt_header: null,
          receipt_footer: null,
        }
      : undefined
  );
  if (!config) {
    return [];
  }
  if (!options.ignoreAgentEnabled && (!config.enabled || !config.agent_key)) {
    return [];
  }
  if (
    !options.ignoreAgentEnabled &&
    options.requireActiveHub &&
    !isPrintHubActive(config.connection_status, config.last_seen_at)
  ) {
    return [];
  }

  const statusResult = await executor.query<OrderStatusRow>(
    `SELECT status
     FROM orders
     WHERE tenant_id = $1
       AND id = $2
     LIMIT 1`,
    [tenantId, orderId],
  );
  const orderStatus = statusResult.rows[0]?.status || '';
  const eventKey = printEventKeyFor(eventType, orderStatus);
  const printEvents = normalizePrintEvents(config.print_events);
  const autoAcceptOrders = normalizeAutoAcceptOrders(config.auto_accept_orders);
  const eventEnabled = eventKey && (
    printEvents[eventKey] ||
    (autoAcceptOrders && (eventKey === 'new_order' || eventKey === 'status_processing'))
  );
  if (!eventEnabled) {
    return [];
  }

  const payloadText = await buildOrderPrintText(tenantId, orderId, eventType, executor, config);
  if (!payloadText) return [];

  const copies = normalizePrintCopies(config.print_copies);
  const printTextSize = normalizePrintTextSize(config.print_text_size);
  const receiptWidth = receiptWidthForPrintSize(config.receipt_width, printTextSize);
  const jobs: PreparedOrderPrintJob[] = [];
  for (let copyIndex = 1; copyIndex <= copies; copyIndex += 1) {
    const copyLabel = copies > 1 ? `\n${centerLine(`VIA ${copyIndex}/${copies}`, receiptWidth)}\n\n` : '';
    jobs.push({
      id: randomUUID(),
      orderId,
      eventType,
      payloadText: `${payloadText}${copyLabel}`,
      printerName: config.printer_name || undefined,
      columns: normalizeReceiptWidth(config.receipt_width),
      printTextSize,
      copyIndex,
      copies: 1,
    });
  }

  return jobs;
}

export async function enqueueOrderPrintJob(
  tenantId: string,
  orderId: string,
  eventType: PrintJobEventType,
  executor: DbExecutor = { query },
  options: PrepareOrderPrintJobsOptions = {},
) {
  await ensureCommunicationJobSchema(executor);
  const jobs = await prepareOrderPrintJobs(tenantId, orderId, eventType, executor, options);
  if (!jobs.length) return false;

  let insertedCount = 0;
  for (const job of jobs) {
    const dedupeKey =
      eventType === 'manual_receipt'
        ? null
        : `${orderId}:${eventType}:${job.copyIndex}`;
    const result = await executor.query(
      `INSERT INTO print_jobs
        (id, tenant_id, order_id, event_type, payload_text, status, attempt_count, dedupe_key, created_at, updated_at)
       VALUES
        ($1, $2, $3, $4, $5, 'queued', 0, $6, NOW(), NOW())
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [job.id, tenantId, orderId, eventType, job.payloadText, dedupeKey],
    );
    insertedCount += result.rowCount || 0;
  }
  if (insertedCount > 0) {
    await notifyAgentJobAvailable(tenantId, 'print', executor);
  }

  return insertedCount > 0;
}
