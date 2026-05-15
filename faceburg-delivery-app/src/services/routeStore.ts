import AsyncStorage from '@react-native-async-storage/async-storage';
import type { RoutePoint } from '@/types';

const ACTIVE_ORDER_KEY = 'faceburg-delivery:active-order';
const DEVICE_ID_KEY = 'faceburg-delivery:device-id';
const QUEUE_KEY = 'faceburg-delivery:route-queue';

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function readQueue() {
  try {
    const parsed = JSON.parse(await AsyncStorage.getItem(QUEUE_KEY) || '[]') as RoutePoint[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function getDeviceId() {
  const existing = await AsyncStorage.getItem(DEVICE_ID_KEY);
  if (existing) return existing;
  const next = makeId();
  await AsyncStorage.setItem(DEVICE_ID_KEY, next);
  return next;
}

export async function setActiveOrderId(orderId: string | null) {
  if (!orderId) {
    await AsyncStorage.removeItem(ACTIVE_ORDER_KEY);
    return;
  }
  await AsyncStorage.setItem(ACTIVE_ORDER_KEY, orderId);
}

export async function getActiveOrderId() {
  return AsyncStorage.getItem(ACTIVE_ORDER_KEY);
}

export async function appendRoutePoint(point: RoutePoint) {
  const queue = await readQueue();
  queue.push(point);
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue.slice(-1000)));
}

export async function takeQueuedRoutePoints() {
  const queue = await readQueue();
  await AsyncStorage.removeItem(QUEUE_KEY);
  return queue;
}

export async function restoreRoutePoints(points: RoutePoint[]) {
  if (!points.length) return;
  const current = await readQueue();
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify([...points, ...current].slice(-1000)));
}
