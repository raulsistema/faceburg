import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob, prepareOrderPrintJobs } from '@/lib/printing';
import { enqueueOrderWhatsappJob, prepareOrderWhatsappJob } from '@/lib/whatsapp';
import type { PrintJobEventType } from '@/lib/print-settings';

type OrderRow = {
  id: string;
};

const allowedPrintEvents = new Set<PrintJobEventType>(['new_order', 'status_update', 'manual_receipt']);
const allowedWhatsappEvents = new Set(['new_order', 'status_update']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getValidatedTenantSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    printEventType?: string;
    printEventTypes?: string[];
    whatsappEventType?: string;
    preferLocalAgent?: boolean;
  };

  const printEventTypes = (Array.isArray(body.printEventTypes) ? body.printEventTypes : [body.printEventType])
    .map((eventType) => String(eventType || '').trim() as PrintJobEventType)
    .filter((eventType) => allowedPrintEvents.has(eventType));
  const whatsappEventType = String(body.whatsappEventType || '').trim();
  const shouldQueuePrint = printEventTypes.length > 0;
  const shouldQueueWhatsapp = allowedWhatsappEvents.has(whatsappEventType);

  if (!shouldQueuePrint && !shouldQueueWhatsapp) {
    return NextResponse.json({ error: 'Informe o tipo de envio para fila.' }, { status: 400 });
  }

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

  if (body.preferLocalAgent) {
    const localDispatch: {
      printJobs?: Awaited<ReturnType<typeof prepareOrderPrintJobs>>;
      whatsappJobs?: Array<NonNullable<Awaited<ReturnType<typeof prepareOrderWhatsappJob>>>>;
      errors?: string[];
    } = {};
    const errors: string[] = [];

    if (shouldQueuePrint) {
      try {
        const printJobs = await Promise.all(printEventTypes.map((eventType) =>
          prepareOrderPrintJobs(session.tenantId, id, eventType, undefined, {
            ignoreAgentEnabled: true,
          })
        ));
        localDispatch.printJobs = printJobs.flat();
      } catch (error) {
        console.error('prepare local print dispatch failed', error);
        errors.push('print');
        localDispatch.printJobs = [];
      }
    }

    if (shouldQueueWhatsapp) {
      try {
        const whatsappJob = await prepareOrderWhatsappJob(
          session.tenantId,
          id,
          whatsappEventType as 'new_order' | 'status_update',
          undefined,
          { requireActiveHub: false },
        );
        localDispatch.whatsappJobs = whatsappJob ? [whatsappJob] : [];
      } catch (error) {
        console.error('prepare local whatsapp dispatch failed', error);
        errors.push('whatsapp');
        localDispatch.whatsappJobs = [];
      }
    }

    if (errors.length) {
      localDispatch.errors = errors;
    }

    return NextResponse.json({ ok: true, delivery: 'local', localDispatch });
  }

  const [printQueued, whatsappQueued] = await Promise.all([
    shouldQueuePrint
      ? Promise.all(printEventTypes.map((eventType) =>
        enqueueOrderPrintJob(session.tenantId, id, eventType).catch((error) => {
          console.error('fallback print dispatch failed', error);
          return false;
        })
      )).then((results) => results.some(Boolean))
      : Promise.resolve(false),
    shouldQueueWhatsapp
      ? enqueueOrderWhatsappJob(session.tenantId, id, whatsappEventType as 'new_order' | 'status_update').catch((error) => {
        console.error('fallback whatsapp dispatch failed', error);
        return false;
      })
      : Promise.resolve(false),
  ]);

  return NextResponse.json({ ok: true, printQueued, whatsappQueued });
}
