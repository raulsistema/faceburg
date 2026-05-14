import { query } from '@/lib/db';
import type { DbExecutor } from '@/lib/db';
import { BUSINESS_TIME_ZONE } from '@/lib/business-time';

export type MenuOpenMode = 'manual' | 'schedule';

export type MenuHoursDay = {
  enabled: boolean;
  open: string;
  close: string;
};

export type MenuHoursConfig = {
  days: Record<string, MenuHoursDay>;
};

const DEFAULT_OPEN_TIME = '18:00';
const DEFAULT_CLOSE_TIME = '00:00';
const DAY_KEYS = ['0', '1', '2', '3', '4', '5', '6'];
const WEEKDAY_TO_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

let storeHoursSchemaPromise: Promise<void> | null = null;

export function defaultMenuHours(): MenuHoursConfig {
  return {
    days: DAY_KEYS.reduce<Record<string, MenuHoursDay>>((acc, key) => {
      acc[key] = {
        enabled: true,
        open: DEFAULT_OPEN_TIME,
        close: DEFAULT_CLOSE_TIME,
      };
      return acc;
    }, {}),
  };
}

export function normalizeMenuOpenMode(value: unknown): MenuOpenMode {
  return value === 'schedule' ? 'schedule' : 'manual';
}

function normalizeTime(value: unknown, fallback: string) {
  const raw = String(value ?? '').trim();
  if (!/^\d{2}:\d{2}$/.test(raw)) return fallback;
  const [hour, minute] = raw.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return fallback;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return fallback;
  return raw;
}

export function normalizeMenuHours(value: unknown): MenuHoursConfig {
  const fallback = defaultMenuHours();
  if (!value || typeof value !== 'object') return fallback;

  const source = value as { days?: Record<string, Partial<MenuHoursDay>> };
  const sourceDays = source.days && typeof source.days === 'object' ? source.days : {};

  return {
    days: DAY_KEYS.reduce<Record<string, MenuHoursDay>>((acc, key) => {
      const day = sourceDays[key] || {};
      acc[key] = {
        enabled: typeof day.enabled === 'boolean' ? day.enabled : fallback.days[key].enabled,
        open: normalizeTime(day.open, fallback.days[key].open),
        close: normalizeTime(day.close, fallback.days[key].close),
      };
      return acc;
    }, {}),
  };
}

function timeToMinutes(value: string) {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function getSaoPauloNowParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === 'weekday')?.value || 'Sun';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);

  return {
    dayIndex: WEEKDAY_TO_INDEX[weekday] ?? 0,
    minuteOfDay: hour * 60 + minute,
  };
}

function isSameDayIntervalOpen(day: MenuHoursDay, minuteOfDay: number) {
  if (!day.enabled) return false;
  const open = timeToMinutes(day.open);
  const close = timeToMinutes(day.close);
  if (open === close) return false;
  if (close > open) return minuteOfDay >= open && minuteOfDay < close;
  return minuteOfDay >= open;
}

function isPreviousDayOvernightOpen(day: MenuHoursDay, minuteOfDay: number) {
  if (!day.enabled) return false;
  const open = timeToMinutes(day.open);
  const close = timeToMinutes(day.close);
  if (open === close || close > open) return false;
  return minuteOfDay < close;
}

export function isMenuOpenNow(input: {
  manualOpen: boolean;
  mode: unknown;
  hours: unknown;
  now?: Date;
}) {
  if (!input.manualOpen) return false;

  const mode = normalizeMenuOpenMode(input.mode);
  if (mode === 'manual') return true;

  const hours = normalizeMenuHours(input.hours);
  const nowParts = getSaoPauloNowParts(input.now);
  const today = hours.days[String(nowParts.dayIndex)];
  const previousDay = hours.days[String((nowParts.dayIndex + 6) % 7)];

  return (
    isSameDayIntervalOpen(today, nowParts.minuteOfDay) ||
    isPreviousDayOvernightOpen(previousDay, nowParts.minuteOfDay)
  );
}

export async function ensureStoreHoursSchema(executor: DbExecutor = { query }) {
  if (!storeHoursSchemaPromise) {
    storeHoursSchemaPromise = (async () => {
      await executor.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'menu_open_mode'
          ) THEN
            ALTER TABLE tenants ADD COLUMN menu_open_mode TEXT NOT NULL DEFAULT 'manual';
          END IF;

          IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_name = 'tenants' AND column_name = 'menu_hours'
          ) THEN
            ALTER TABLE tenants ADD COLUMN menu_hours JSONB NOT NULL DEFAULT '${JSON.stringify(defaultMenuHours())}'::jsonb;
          END IF;
        END $$;
      `);
    })().catch((error) => {
      storeHoursSchemaPromise = null;
      throw error;
    });
  }

  await storeHoursSchemaPromise;
}
