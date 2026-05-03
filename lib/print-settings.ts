export const PRINT_WIDTH_OPTIONS = [32, 40, 48] as const;
export const DEFAULT_PRINT_WIDTH = 32;
export const DEFAULT_PRINT_COPIES = 1;

export const PRINT_EVENT_KEYS = [
  'new_order',
  'status_processing',
  'status_delivering',
  'status_completed',
  'status_cancelled',
  'manual_receipt',
] as const;

export type PrintEventKey = (typeof PRINT_EVENT_KEYS)[number];
export type PrintEvents = Record<PrintEventKey, boolean>;

export type ReceiptOptions = {
  showStoreInfo: boolean;
  showCustomerPhone: boolean;
  showDeliveryAddress: boolean;
  showPayment: boolean;
  showItemNotes: boolean;
  showTotals: boolean;
};

export type PrintJobEventType = 'new_order' | 'status_update' | 'manual_receipt';

export const DEFAULT_PRINT_EVENTS: PrintEvents = {
  new_order: true,
  status_processing: true,
  status_delivering: false,
  status_completed: false,
  status_cancelled: true,
  manual_receipt: true,
};

export const DEFAULT_RECEIPT_OPTIONS: ReceiptOptions = {
  showStoreInfo: true,
  showCustomerPhone: true,
  showDeliveryAddress: true,
  showPayment: true,
  showItemNotes: true,
  showTotals: true,
};

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizePrintEvents(value: unknown): PrintEvents {
  const source = parseObject(value);
  const events: PrintEvents = { ...DEFAULT_PRINT_EVENTS };
  for (const key of PRINT_EVENT_KEYS) {
    events[key] = typeof source[key] === 'boolean' ? Boolean(source[key]) : DEFAULT_PRINT_EVENTS[key];
  }
  return events;
}

export function normalizeReceiptOptions(value: unknown): ReceiptOptions {
  const source = parseObject(value);
  const options: ReceiptOptions = { ...DEFAULT_RECEIPT_OPTIONS };
  for (const key of Object.keys(DEFAULT_RECEIPT_OPTIONS) as Array<keyof ReceiptOptions>) {
    options[key] = typeof source[key] === 'boolean' ? Boolean(source[key]) : DEFAULT_RECEIPT_OPTIONS[key];
  }
  return options;
}

export function normalizeReceiptWidth(value: unknown) {
  const parsed = Number(value);
  return PRINT_WIDTH_OPTIONS.includes(parsed as (typeof PRINT_WIDTH_OPTIONS)[number]) ? parsed : DEFAULT_PRINT_WIDTH;
}

export function normalizePrintCopies(value: unknown) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_PRINT_COPIES;
  return Math.min(3, Math.max(1, parsed));
}

export function normalizeReceiptText(value: unknown, maxLength = 320) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .trim()
    .slice(0, maxLength);
}

export function printEventKeyFor(eventType: PrintJobEventType, orderStatus?: string | null): PrintEventKey | null {
  if (eventType === 'new_order') return 'new_order';
  if (eventType === 'manual_receipt') return 'manual_receipt';

  const status = String(orderStatus || '').trim().toLowerCase();
  if (status === 'processing') return 'status_processing';
  if (status === 'delivering') return 'status_delivering';
  if (status === 'completed') return 'status_completed';
  if (status === 'cancelled') return 'status_cancelled';
  return null;
}
