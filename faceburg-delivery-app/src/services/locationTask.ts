import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { sendLocation, sendRouteBatch } from '@/services/api';
import {
  appendRoutePoint,
  getActiveOrderId,
  getDeviceId,
  restoreRoutePoints,
  setActiveOrderId,
  takeQueuedRoutePoints,
} from '@/services/routeStore';
import type { RoutePoint } from '@/types';

export const DELIVERY_LOCATION_TASK = 'faceburg-delivery-location-task';

type LocationTaskData = {
  locations?: Location.LocationObject[];
};

function toRoutePoint(location: Location.LocationObject): RoutePoint {
  return {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
    accuracyMeters: location.coords.accuracy ?? null,
    speedMetersPerSecond: location.coords.speed ?? null,
    headingDegrees: location.coords.heading ?? null,
    recordedAt: new Date(location.timestamp).toISOString(),
  };
}

async function flushRouteQueue(orderId: string, deviceId: string) {
  const queued = await takeQueuedRoutePoints();
  if (!queued.length) return;
  try {
    await sendRouteBatch(orderId, deviceId, queued);
  } catch {
    await restoreRoutePoints(queued);
  }
}

TaskManager.defineTask(DELIVERY_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const orderId = await getActiveOrderId();
  if (!orderId) return;

  const deviceId = await getDeviceId();
  const locations = ((data as LocationTaskData | undefined)?.locations || []).map(toRoutePoint);
  for (const point of locations) {
    await appendRoutePoint(point);
    try {
      await sendLocation(orderId, deviceId, point);
      await flushRouteQueue(orderId, deviceId);
    } catch {
      // Sem internet: o ponto fica salvo e sai no proximo lote.
    }
  }
});

export async function requestLocationPermissions() {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (foreground.status !== 'granted') {
    throw new Error('Permissao de localizacao negada.');
  }

  const background = await Location.requestBackgroundPermissionsAsync();
  if (background.status !== 'granted') {
    throw new Error('Permissao de segundo plano negada.');
  }

  const notification = await Notifications.requestPermissionsAsync();
  if (notification.status !== 'granted') {
    throw new Error('Permissao de notificacao negada.');
  }
}

export async function startDeliveryTracking(orderId: string) {
  await requestLocationPermissions();
  await setActiveOrderId(orderId);

  const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(DELIVERY_LOCATION_TASK);
  if (alreadyStarted) return;

  await Location.startLocationUpdatesAsync(DELIVERY_LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 20000,
    distanceInterval: 25,
    pausesUpdatesAutomatically: true,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Entrega em andamento',
      notificationBody: 'Faceburg esta acompanhando a rota ativa.',
      notificationColor: '#059669',
    },
  });
}

export async function stopDeliveryTracking() {
  const orderId = await getActiveOrderId();
  const deviceId = await getDeviceId();
  if (orderId) {
    await flushRouteQueue(orderId, deviceId);
  }
  const started = await Location.hasStartedLocationUpdatesAsync(DELIVERY_LOCATION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(DELIVERY_LOCATION_TASK);
  }
  await setActiveOrderId(null);
}
