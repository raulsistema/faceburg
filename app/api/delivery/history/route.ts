import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { getValidatedDeliveryAccess } from '@/lib/delivery-auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type DeliveryHistoryRow = {
  id: string;
  code: string | null;
  customer_name: string | null;
  delivery_address: string | null;
  total: string;
  delivery_fee_amount: string;
  delivery_started_at: string | null;
  delivery_finished_at: string | null;
  finished_at: string;
  duration_seconds: number | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeDate(value: string, fallback: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : fallback;
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function firstDayOfCurrentMonth() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
}

function numberFrom(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

export async function GET(request: Request) {
  const session = await getValidatedDeliveryAccess(request);
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const driverId = session.source === 'driver' ? session.driverId : text(url.searchParams.get('driverId'));
  if (!driverId) {
    return NextResponse.json({ error: 'Informe o entregador.' }, { status: 400 });
  }

  const fallbackFrom = firstDayOfCurrentMonth();
  const fallbackTo = todayIsoDate();
  let dateFrom = normalizeDate(text(url.searchParams.get('from')), fallbackFrom);
  let dateTo = normalizeDate(text(url.searchParams.get('to')), fallbackTo);
  if (dateFrom > dateTo) {
    [dateFrom, dateTo] = [dateTo, dateFrom];
  }

  const result = await query<DeliveryHistoryRow>(
    `SELECT o.id,
            o.delivery_driver_code AS code,
            o.customer_name,
            o.delivery_address,
            o.total::text,
            o.delivery_fee_amount::text,
            o.delivery_started_at,
            o.delivery_finished_at,
            COALESCE(o.delivery_finished_at, o.updated_at) AS finished_at,
            CASE
              WHEN o.delivery_started_at IS NOT NULL AND o.delivery_finished_at IS NOT NULL
                THEN GREATEST(0, EXTRACT(EPOCH FROM (o.delivery_finished_at - o.delivery_started_at)))::int
              ELSE NULL
            END AS duration_seconds
     FROM orders o
     WHERE o.tenant_id = $1
       AND o.delivery_driver_id = $2
       AND o.type = 'delivery'
       AND o.status = 'completed'
       AND COALESCE(o.delivery_finished_at, o.updated_at)::date >= $3::date
       AND COALESCE(o.delivery_finished_at, o.updated_at)::date <= $4::date
     ORDER BY COALESCE(o.delivery_finished_at, o.updated_at) DESC
     LIMIT 300`,
    [session.tenantId, driverId, dateFrom, dateTo],
  );

  let totalFees = 0;
  let durationSum = 0;
  let durationCount = 0;
  const deliveries = result.rows.map((row) => {
    const fee = numberFrom(row.delivery_fee_amount);
    const durationSeconds = row.duration_seconds === null ? null : numberFrom(row.duration_seconds);
    totalFees += fee;
    if (durationSeconds !== null) {
      durationSum += durationSeconds;
      durationCount += 1;
    }

    return {
      id: row.id,
      code: row.code || row.id.slice(0, 8).toUpperCase(),
      customerName: row.customer_name || 'Sem nome',
      deliveryAddress: row.delivery_address || '',
      total: numberFrom(row.total),
      deliveryFee: fee,
      deliveryStartedAt: row.delivery_started_at,
      deliveryFinishedAt: row.delivery_finished_at,
      finishedAt: row.finished_at,
      durationSeconds,
    };
  });

  return NextResponse.json({
    filters: {
      from: dateFrom,
      to: dateTo,
    },
    summary: {
      count: deliveries.length,
      totalFees,
      averageDurationSeconds: durationCount > 0 ? Math.round(durationSum / durationCount) : null,
    },
    deliveries,
  });
}
