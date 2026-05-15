import { randomBytes } from 'node:crypto';
import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';

export type DeliveryTrackingStepKey = 'received' | 'preparing' | 'delivering' | 'completed';

export type PublicDeliveryTracking = {
  token: string;
  orderId: string;
  orderCode: string;
  tenantName: string;
  customerName: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  deliveryStartedAt: string | null;
  deliveryFinishedAt: string | null;
  locationUpdatedAt: string | null;
  currentLocation: {
    latitude: number;
    longitude: number;
  } | null;
  steps: Array<{
    key: DeliveryTrackingStepKey;
    label: string;
    active: boolean;
    done: boolean;
  }>;
};

type TrackingRow = {
  id: string;
  tenant_name: string | null;
  customer_name: string | null;
  status: string;
  type: string | null;
  created_at: string;
  updated_at: string;
  delivery_tracking_token: string | null;
  delivery_started_at: string | null;
  delivery_finished_at: string | null;
  delivery_last_latitude: string | null;
  delivery_last_longitude: string | null;
  delivery_location_updated_at: string | null;
};

function text(value: unknown) {
  return String(value ?? '').trim();
}

function firstName(value: string | null) {
  return text(value).split(/\s+/)[0] || 'Cliente';
}

export function normalizeDeliveryCode(value: unknown) {
  return text(value).replace(/^#/, '').toUpperCase();
}

export function buildDeliveryTrackingToken() {
  return randomBytes(24).toString('hex');
}

export function buildDeliveryDriverCode(orderId: string) {
  const clean = text(orderId).replace(/[^a-z0-9]/gi, '').toUpperCase();
  if (clean.length >= 8) return clean.slice(0, 8);
  return randomBytes(4).toString('hex').toUpperCase();
}

export function getAppBaseUrl() {
  return (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '');
}

export function buildTrackingUrl(token: string) {
  return `${getAppBaseUrl()}/acompanhar/${encodeURIComponent(token)}`;
}

function statusRank(status: string) {
  if (status === 'completed') return 4;
  if (status === 'delivering') return 3;
  if (status === 'processing') return 2;
  if (status === 'pending') return 1;
  return 0;
}

function buildSteps(status: string) {
  const rank = statusRank(status);
  return [
    { key: 'received' as const, label: 'Pedido recebido', active: rank === 1, done: rank > 1 },
    { key: 'preparing' as const, label: 'Em preparo', active: rank === 2, done: rank > 2 },
    { key: 'delivering' as const, label: 'Saiu para entrega', active: rank === 3, done: rank > 3 },
    { key: 'completed' as const, label: 'Entregue', active: rank === 4, done: rank >= 4 },
  ];
}

export async function ensureOrderDeliveryIdentifiers(
  tenantId: string,
  orderId: string,
  executor: DbExecutor = { query },
) {
  const token = buildDeliveryTrackingToken();
  const code = buildDeliveryDriverCode(orderId);
  const result = await executor.query<{
    delivery_tracking_token: string | null;
    delivery_driver_code: string | null;
  }>(
    `UPDATE orders
     SET delivery_tracking_token = COALESCE(delivery_tracking_token, $3),
         delivery_driver_code = COALESCE(delivery_driver_code, $4),
         updated_at = NOW()
     WHERE tenant_id = $1
       AND id = $2
     RETURNING delivery_tracking_token, delivery_driver_code`,
    [tenantId, orderId, token, code],
  );

  return {
    token: result.rows[0]?.delivery_tracking_token || token,
    code: result.rows[0]?.delivery_driver_code || code,
  };
}

export async function getPublicDeliveryTracking(token: string, executor: DbExecutor = { query }) {
  const normalizedToken = text(token);
  if (!normalizedToken || normalizedToken.length < 16) return null;

  const result = await executor.query<TrackingRow>(
    `SELECT o.id,
            t.name AS tenant_name,
            o.customer_name,
            o.status,
            o.type,
            o.created_at,
            o.updated_at,
            o.delivery_tracking_token,
            o.delivery_started_at,
            o.delivery_finished_at,
            o.delivery_last_latitude::text,
            o.delivery_last_longitude::text,
            o.delivery_location_updated_at
     FROM orders o
     JOIN tenants t
       ON t.id = o.tenant_id
     WHERE o.delivery_tracking_token = $1
       AND o.type = 'delivery'
     LIMIT 1`,
    [normalizedToken],
  );

  if (!result.rowCount) return null;
  const row = result.rows[0];
  const latitude = Number(row.delivery_last_latitude);
  const longitude = Number(row.delivery_last_longitude);
  const hasLocation = Number.isFinite(latitude) && Number.isFinite(longitude);

  return {
    token: row.delivery_tracking_token || normalizedToken,
    orderId: row.id,
    orderCode: row.id.slice(0, 8).toUpperCase(),
    tenantName: row.tenant_name || 'Loja',
    customerName: firstName(row.customer_name),
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deliveryStartedAt: row.delivery_started_at,
    deliveryFinishedAt: row.delivery_finished_at,
    locationUpdatedAt: row.delivery_location_updated_at,
    currentLocation: hasLocation ? { latitude, longitude } : null,
    steps: buildSteps(row.status),
  } satisfies PublicDeliveryTracking;
}
