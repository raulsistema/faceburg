import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { claimLocalAutomationDispatch } from '@/lib/local-automation';
import { requireTenantSession } from '@/lib/tenant-auth';
import { enqueueOrderPrintJob, prepareOrderPrintJobs } from '@/lib/printing';
import { enqueueOrderWhatsappJob, prepareOrderWhatsappJob } from '@/lib/whatsapp';
import type { PrintJobEventType } from '@/lib/print-settings';

type OrderRow = {
  id: string;
};

const allowedPrintEvents = new Set<PrintJobEventType>(['new_order', 'status_update', 'manual_receipt']);
const allowedWhatsappEvents = new Set(['new_order', 'status_update']);

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, response } = await requireTenantSession(['admin', 'staff']);
  if (response) return response;

  const { id } = await params;
  const body = await request.json().catch(() => ({})) as {
    printEventType?: string;
    printEventTypes?: string[];
    whatsappEventType?: string;
    preferLocalAgent?: boolean;
    ackLocalDispatch?: boolean;
    localAutomationOwnerId?: string;
    localAutomationOwnerLabel?: string;
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

  if (body.ackLocalDispatch) {
    const [printAcked, whatsappAcked] = await Promise.all([
      shouldQueuePrint
        ? query(
            `UPDATE print_jobs
             SET status = 'completed',
                 last_error = NULL,
                 lease_until = NULL,
                 updated_at = NOW()
             WHERE tenant_id = $1
               AND order_id = $2
               AND event_type = ANY($3::text[])
               AND status IN ('queued', 'processing')
             RETURNING id`,
            [session.tenantId, id, printEventTypes],
          ).then((result) => result.rowCount || 0)
        : Promise.resolve(0),
      shouldQueueWhatsapp
        ? query(
            `UPDATE whatsapp_jobs
             SET status = 'completed',
                 last_error = NULL,
                 lease_until = NULL,
                 updated_at = NOW()
             WHERE tenant_id = $1
               AND order_id = $2
               AND event_type = $3
               AND status IN ('queued', 'processing')
             RETURNING id`,
            [session.tenantId, id, whatsappEventType],
          ).then((result) => result.rowCount || 0)
        : Promise.resolve(0),
    ]);

    return NextResponse.json({
      ok: true,
      delivery: 'local_ack',
      printAcked,
      whatsappAcked,
    });
  }

  if (body.preferLocalAgent) {
    const localDispatch: {
      printJobs?: Awaited<ReturnType<typeof prepareOrderPrintJobs>>;
      whatsappJobs?: Array<NonNullable<Awaited<ReturnType<typeof prepareOrderWhatsappJob>>>>;
      errors?: string[];
      skipped?: string[];
    } = {};
    const errors: string[] = [];
    const skipped: string[] = [];
    const localAutomationOwnerId = String(body.localAutomationOwnerId || '').trim();
    const localAutomationOwnerLabel = String(body.localAutomationOwnerLabel || '').trim();

    if (shouldQueuePrint) {
      try {
        const preparedPrintJobs: Awaited<ReturnType<typeof prepareOrderPrintJobs>> = [];
        for (const eventType of printEventTypes) {
          if (localAutomationOwnerId) {
            const claimed = await claimLocalAutomationDispatch({
              tenantId: session.tenantId,
              orderId: id,
              channel: 'print',
              eventType,
              ownerId: localAutomationOwnerId,
              ownerLabel: localAutomationOwnerLabel,
            });
            if (!claimed) {
              skipped.push(`print:${eventType}`);
              continue;
            }
          }

          const printJobs = await prepareOrderPrintJobs(session.tenantId, id, eventType, undefined, {
            ignoreAgentEnabled: true,
          });
          preparedPrintJobs.push(...printJobs);
        }
        localDispatch.printJobs = preparedPrintJobs;
      } catch (error) {
        console.error('prepare local print dispatch failed', error);
        errors.push('print');
        localDispatch.printJobs = [];
      }
    }

    if (shouldQueueWhatsapp) {
      try {
        if (localAutomationOwnerId) {
          const claimed = await claimLocalAutomationDispatch({
            tenantId: session.tenantId,
            orderId: id,
            channel: 'whatsapp',
            eventType: whatsappEventType,
            ownerId: localAutomationOwnerId,
            ownerLabel: localAutomationOwnerLabel,
          });
          if (!claimed) {
            skipped.push(`whatsapp:${whatsappEventType}`);
            localDispatch.whatsappJobs = [];
          } else {
            const whatsappJob = await prepareOrderWhatsappJob(
              session.tenantId,
              id,
              whatsappEventType as 'new_order' | 'status_update',
              undefined,
              { requireActiveHub: false },
            );
            localDispatch.whatsappJobs = whatsappJob ? [whatsappJob] : [];
          }
        } else {
          const whatsappJob = await prepareOrderWhatsappJob(
            session.tenantId,
            id,
            whatsappEventType as 'new_order' | 'status_update',
            undefined,
            { requireActiveHub: false },
          );
          localDispatch.whatsappJobs = whatsappJob ? [whatsappJob] : [];
        }
      } catch (error) {
        console.error('prepare local whatsapp dispatch failed', error);
        errors.push('whatsapp');
        localDispatch.whatsappJobs = [];
      }
    }

    if (errors.length) {
      localDispatch.errors = errors;
    }
    if (skipped.length) {
      localDispatch.skipped = skipped;
    }

    return NextResponse.json({ ok: true, delivery: 'local', localDispatch });
  }

  const [printQueued, whatsappQueued] = await Promise.all([
    shouldQueuePrint
      ? Promise.all(printEventTypes.map((eventType) =>
        enqueueOrderPrintJob(session.tenantId, id, eventType).catch((error) => {
          console.error('print dispatch failed', error);
          return false;
        })
      )).then((results) => results.some(Boolean))
      : Promise.resolve(false),
    shouldQueueWhatsapp
      ? enqueueOrderWhatsappJob(session.tenantId, id, whatsappEventType as 'new_order' | 'status_update').catch((error) => {
        console.error('whatsapp dispatch failed', error);
        return false;
      })
      : Promise.resolve(false),
  ]);

  return NextResponse.json({ ok: true, printQueued, whatsappQueued });
}
