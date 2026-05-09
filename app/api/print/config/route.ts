import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  normalizePrintCopies,
  normalizeAutoAcceptOrders,
  normalizePrintEventsForAutomation,
  normalizePrintTextSize,
  normalizeReceiptOptions,
  normalizeReceiptText,
  normalizeReceiptWidth,
} from '@/lib/print-settings';
import { getValidatedTenantSession } from '@/lib/tenant-auth';

type ConfigRow = {
  tenant_id: string;
  enabled: boolean;
  agent_key: string | null;
  connection_status: string | null;
  printer_name: string | null;
  receipt_width: number | null;
  print_text_size: string | null;
  print_copies: number | null;
  auto_accept_orders: boolean | null;
  print_events: unknown | null;
  receipt_options: unknown | null;
  receipt_header: string | null;
  receipt_footer: string | null;
  last_error: string | null;
  last_seen_at: string | null;
};

function buildAgentKey() {
  return `pa_${randomBytes(24).toString('hex')}`;
}

export async function GET() {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await query<ConfigRow>(
    `SELECT tenant_id,
            enabled,
            agent_key,
            connection_status,
            printer_name,
            receipt_width,
            print_text_size,
            print_copies,
            auto_accept_orders,
            print_events,
            receipt_options,
            receipt_header,
            receipt_footer,
            last_error,
            last_seen_at
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );

  const row = result.rows[0] || null;
  return NextResponse.json({
    enabled: row?.enabled || false,
    hasAgentKey: Boolean(row?.agent_key),
    agentKey: row?.agent_key || '',
    connectionStatus: row?.connection_status || 'disconnected',
    printerName: row?.printer_name || '',
    receiptWidth: normalizeReceiptWidth(row?.receipt_width),
    printTextSize: normalizePrintTextSize(row?.print_text_size),
    printCopies: normalizePrintCopies(row?.print_copies),
    autoAcceptOrders: normalizeAutoAcceptOrders(row?.auto_accept_orders),
    printEvents: normalizePrintEventsForAutomation(row?.print_events, row?.auto_accept_orders),
    receiptOptions: normalizeReceiptOptions(row?.receipt_options),
    receiptHeader: normalizeReceiptText(row?.receipt_header),
    receiptFooter: normalizeReceiptText(row?.receipt_footer),
    lastError: row?.last_error || '',
    lastSeenAt: row?.last_seen_at || null,
  });
}

export async function PATCH(request: Request) {
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
  const rotateKey = Boolean(body.rotateKey);
  const hasBodyField = (field: string) => Object.prototype.hasOwnProperty.call(body, field);

  const currentResult = await query<ConfigRow>(
    `SELECT tenant_id,
            enabled,
            agent_key,
            connection_status,
            printer_name,
            receipt_width,
            print_text_size,
            print_copies,
            auto_accept_orders,
            print_events,
            receipt_options,
            receipt_header,
            receipt_footer,
            last_error,
            last_seen_at
     FROM printer_agents
     WHERE tenant_id = $1
     LIMIT 1`,
    [session.tenantId],
  );
  const current = currentResult.rows[0];
  const nextKey = rotateKey || !current?.agent_key ? buildAgentKey() : current.agent_key;
  const enabled = hasBodyField('enabled') ? Boolean(body.enabled) : Boolean(current?.enabled);
  const printerName = hasBodyField('printerName')
    ? String(body.printerName || '').trim()
    : String(current?.printer_name || '').trim();
  const receiptWidth = normalizeReceiptWidth(hasBodyField('receiptWidth') ? body.receiptWidth : current?.receipt_width);
  const printTextSize = normalizePrintTextSize(hasBodyField('printTextSize') ? body.printTextSize : current?.print_text_size);
  const printCopies = normalizePrintCopies(hasBodyField('printCopies') ? body.printCopies : current?.print_copies);
  const autoAcceptOrders = normalizeAutoAcceptOrders(hasBodyField('autoAcceptOrders') ? body.autoAcceptOrders : current?.auto_accept_orders);
  const printEvents = normalizePrintEventsForAutomation(hasBodyField('printEvents') ? body.printEvents : current?.print_events, autoAcceptOrders);
  const receiptOptions = normalizeReceiptOptions(hasBodyField('receiptOptions') ? body.receiptOptions : current?.receipt_options);
  const receiptHeader = normalizeReceiptText(hasBodyField('receiptHeader') ? body.receiptHeader : current?.receipt_header);
  const receiptFooter = normalizeReceiptText(hasBodyField('receiptFooter') ? body.receiptFooter : current?.receipt_footer);

  await query(
    `INSERT INTO printer_agents
       (tenant_id, enabled, agent_key, printer_name, receipt_width, print_text_size, print_copies, auto_accept_orders, print_events, receipt_options, receipt_header, receipt_footer, updated_at)
     VALUES
       ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9::jsonb, $10::jsonb, NULLIF($11, ''), NULLIF($12, ''), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       agent_key = EXCLUDED.agent_key,
       printer_name = EXCLUDED.printer_name,
       receipt_width = EXCLUDED.receipt_width,
       print_text_size = EXCLUDED.print_text_size,
       print_copies = EXCLUDED.print_copies,
       auto_accept_orders = EXCLUDED.auto_accept_orders,
       print_events = EXCLUDED.print_events,
       receipt_options = EXCLUDED.receipt_options,
       receipt_header = EXCLUDED.receipt_header,
       receipt_footer = EXCLUDED.receipt_footer,
       updated_at = NOW()`,
    [
      session.tenantId,
      enabled,
      nextKey,
      printerName,
      receiptWidth,
      printTextSize,
      printCopies,
      autoAcceptOrders,
      JSON.stringify(printEvents),
      JSON.stringify(receiptOptions),
      receiptHeader,
      receiptFooter,
    ],
  );

  return NextResponse.json({
    ok: true,
    enabled,
    hasAgentKey: true,
    agentKey: nextKey,
    connectionStatus: current?.connection_status || 'disconnected',
    printerName,
    receiptWidth,
    printTextSize,
    printCopies,
    autoAcceptOrders,
    printEvents,
    receiptOptions,
    receiptHeader,
    receiptFooter,
    lastError: current?.last_error || '',
    lastSeenAt: current?.last_seen_at || null,
  });
}
