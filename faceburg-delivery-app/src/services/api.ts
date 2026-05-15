import Constants from 'expo-constants';
import type { DeliveryOrder, RoutePoint } from '@/types';

type ApiResponse<T> = T & {
  error?: string;
};

const runtimeEnv = (globalThis as unknown as {
  process?: {
    env?: Record<string, string | undefined>;
  };
}).process?.env;

export const API_BASE_URL = String(
  Constants.expoConfig?.extra?.apiBaseUrl ||
    runtimeEnv?.EXPO_PUBLIC_API_BASE_URL ||
    'http://localhost:3000',
).replace(/\/+$/, '');

let authToken = '';

export function setDeliveryAuthToken(token: string) {
  authToken = token.trim();
}

async function requestApi<T>(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(authToken ? { authorization: `Bearer ${authToken}` } : {}),
      ...(init.headers || {}),
    },
  });
  const data = (await response.json().catch(() => ({}))) as ApiResponse<T>;
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}`);
  }
  return data;
}

export async function listDeliveryOrders() {
  const data = await requestApi<{ orders: DeliveryOrder[] }>('/api/delivery/orders');
  return data.orders || [];
}

export async function loginDeliveryDriver(input: {
  tenantSlug: string;
  pin: string;
  driverName?: string;
  deviceId: string;
}) {
  const data = await requestApi<{
    token: string;
    deviceId: string;
    driver: { id: string; name: string };
    tenant: { id: string; name: string };
  }>('/api/delivery/auth', {
    method: 'POST',
    body: JSON.stringify({
      ...input,
      platform: 'android',
    }),
  });
  setDeliveryAuthToken(data.token);
  return data;
}

export async function lookupDeliveryOrder(code: string) {
  const data = await requestApi<{ order: DeliveryOrder }>('/api/delivery/lookup', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
  return data.order;
}

export async function startDelivery(orderId: string) {
  const data = await requestApi<{ order: Partial<DeliveryOrder> & { id: string } }>(`/api/delivery/orders/${orderId}/start`, {
    method: 'POST',
  });
  return data.order;
}

export async function finishDelivery(orderId: string) {
  const data = await requestApi<{ order: Partial<DeliveryOrder> & { id: string } }>(`/api/delivery/orders/${orderId}/finish`, {
    method: 'POST',
  });
  return data.order;
}

export async function sendLocation(orderId: string, deviceId: string, point: RoutePoint) {
  await requestApi('/api/delivery/location', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      deviceId,
      platform: 'android',
      ...point,
    }),
  });
}

export async function sendRouteBatch(orderId: string, deviceId: string, points: RoutePoint[]) {
  if (!points.length) return;
  await requestApi('/api/delivery/route-batch', {
    method: 'POST',
    body: JSON.stringify({
      orderId,
      deviceId,
      platform: 'android',
      points,
    }),
  });
}

export async function fetchDeliveryCommands(deviceId: string) {
  const data = await requestApi<{ commands: Array<{ id: string; type: string; orderId?: string | null }> }>(
    `/api/delivery/commands?deviceId=${encodeURIComponent(deviceId)}`,
  );
  return data.commands || [];
}
