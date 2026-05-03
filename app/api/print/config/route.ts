import { randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import {
  normalizePrintCopies,
  normalizePrintEvents,
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
  print_copies: number | null;
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
            print_copies,
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
    printCopies: normalizePrintCopies(row?.print_copies),
    printEvents: normalizePrintEvents(row?.print_events),
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
  const enabled = Boolean(body.enabled);
  const rotateKey = Boolean(body.rotateKey);
  const printerName = String(body.printerName || '').trim();

  const currentResult = await query<ConfigRow>(
    `SELECT tenant_id,
            enabled,
            agent_key,
            connection_status,
            printer_name,
            receipt_width,
            print_copies,
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
  const hasBodyField = (field: string) => Object.prototype.hasOwnProperty.call(body, field);
  const receiptWidth = normalizeReceiptWidth(hasBodyField('receiptWidth') ? body.receiptWidth : current?.receipt_width);
  const printCopies = normalizePrintCopies(hasBodyField('printCopies') ? body.printCopies : current?.print_copies);
  const printEvents = normalizePrintEvents(hasBodyField('printEvents') ? body.printEvents : current?.print_events);
  const receiptOptions = normalizeReceiptOptions(hasBodyField('receiptOptions') ? body.receiptOptions : current?.receipt_options);
  const receiptHeader = normalizeReceiptText(hasBodyField('receiptHeader') ? body.receiptHeader : current?.receipt_header);
  const receiptFooter = normalizeReceiptText(hasBodyField('receiptFooter') ? body.receiptFooter : current?.receipt_footer);

  await query(
    `INSERT INTO printer_agents
       (tenant_id, enabled, agent_key, printer_name, receipt_width, print_copies, print_events, receipt_options, receipt_header, receipt_footer, updated_at)
     VALUES
       ($1, $2, $3, NULLIF($4, ''), $5, $6, $7::jsonb, $8::jsonb, NULLIF($9, ''), NULLIF($10, ''), NOW())
     ON CONFLICT (tenant_id)
     DO UPDATE SET
       enabled = EXCLUDED.enabled,
       agent_key = EXCLUDED.agent_key,
       printer_name = EXCLUDED.printer_name,
       receipt_width = EXCLUDED.receipt_width,
       print_copies = EXCLUDED.print_copies,
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
      printCopies,
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
    printCopies,
    printEvents,
    receiptOptions,
    receiptHeader,
    receiptFooter,
    lastError: current?.last_error || '',
    lastSeenAt: current?.last_seen_at || null,
  });
}
