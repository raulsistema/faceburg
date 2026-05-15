export const PRINT_WIDTH_OPTIONS = [32, 48] as const;
export const DEFAULT_PRINT_WIDTH = 32;
export const DEFAULT_PRINT_COPIES = 1;
export const MIN_PRINT_TEXT_SIZE = 8;
export const MAX_PRINT_TEXT_SIZE = 24;
export const DEFAULT_PRINT_TEXT_SIZE = '12.5';
export const PRINT_TEXT_SIZE_STEP = 0.25;

type PrintTextSizeProfile = {
  value: string;
  label: string;
  detail: string;
  widthScale: number;
  heightScale: number;
};

export type PrintTextSize = string;

type PrintPaperWidthOption = {
  value: (typeof PRINT_WIDTH_OPTIONS)[number];
  label: string;
  detail: string;
};

export const PRINT_PAPER_WIDTH_OPTIONS: PrintPaperWidthOption[] = [
  {
    value: 32,
    label: '58 mm',
    detail: 'Impressora termica pequena',
  },
  {
    value: 48,
    label: '80 mm',
    detail: 'Impressora termica padrao',
  },
];

function formatPrintTextSize(size: number) {
  const rounded = Math.round(size / PRINT_TEXT_SIZE_STEP) * PRINT_TEXT_SIZE_STEP;
  return rounded.toFixed(2).replace(/\.?0+$/, '');
}

function parsePrintTextSizeNumber(value: unknown) {
  const clean = String(value ?? '').trim().toLowerCase().replace(',', '.');
  if (clean === 'normal') return 10;
  if (clean === 'large') return 12;
  if (clean === 'extra_large') return 14;

  if (!/^\d+(?:\.\d+)?$/.test(clean)) return Number(DEFAULT_PRINT_TEXT_SIZE);
  const parsed = Number(clean);
  if (!Number.isFinite(parsed)) return Number(DEFAULT_PRINT_TEXT_SIZE);
  return Math.min(MAX_PRINT_TEXT_SIZE, Math.max(MIN_PRINT_TEXT_SIZE, parsed));
}

function printTextSizeScales(size: number) {
  if (size >= 18) return { widthScale: 2, heightScale: 2 };
  return { widthScale: 1, heightScale: 1 };
}

function printTextSizeDetail(size: number) {
  if (size >= 18) return 'Texto grande ESC/POS, com menos caracteres por linha.';
  if (size >= 11) return 'Texto equilibrado para cupom de balcao.';
  return 'Compacto para recibos longos.';
}

export const PRINT_TEXT_SIZE_OPTIONS: PrintTextSizeProfile[] = Array.from(
  { length: Math.round((MAX_PRINT_TEXT_SIZE - MIN_PRINT_TEXT_SIZE) / PRINT_TEXT_SIZE_STEP) + 1 },
  (_, index) => {
    const size = MIN_PRINT_TEXT_SIZE + index * PRINT_TEXT_SIZE_STEP;
    return {
      value: formatPrintTextSize(size),
      label: formatPrintTextSize(size),
      detail: printTextSizeDetail(size),
      ...printTextSizeScales(size),
    };
  },
);

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
  showItemDescription: boolean;
  showItemNotes: boolean;
  showTotals: boolean;
};

export type PrintJobEventType = 'new_order' | 'status_update' | 'manual_receipt';

export const DEFAULT_PRINT_EVENTS: PrintEvents = {
  new_order: true,
  status_processing: true,
  status_delivering: false,
  status_completed: false,
  status_cancelled: false,
  manual_receipt: true,
};

export const DEFAULT_RECEIPT_OPTIONS: ReceiptOptions = {
  showStoreInfo: true,
  showCustomerPhone: true,
  showDeliveryAddress: true,
  showPayment: true,
  showItemDescription: false,
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

export function normalizeAutoAcceptOrders(value: unknown) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value === 1;
  const clean = String(value ?? '').trim().toLowerCase();
  return clean === 'true' || clean === '1' || clean === 'yes' || clean === 'sim';
}

export function normalizePrintEventsForAutomation(value: unknown, autoAcceptOrders: unknown): PrintEvents {
  const events = normalizePrintEvents(value);
  if (normalizeAutoAcceptOrders(autoAcceptOrders)) {
    events.new_order = true;
    events.status_processing = true;
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
  if (parsed === 58) return 32;
  if (parsed === 80) return 48;
  if (parsed === 40) return 48;
  return PRINT_WIDTH_OPTIONS.includes(parsed as (typeof PRINT_WIDTH_OPTIONS)[number]) ? parsed : DEFAULT_PRINT_WIDTH;
}

export function getReceiptPaperWidthLabel(value: unknown) {
  const normalized = normalizeReceiptWidth(value);
  return PRINT_PAPER_WIDTH_OPTIONS.find((option) => option.value === normalized)?.label || '58 mm';
}

export function normalizePrintCopies(value: unknown) {
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return DEFAULT_PRINT_COPIES;
  return Math.min(3, Math.max(1, parsed));
}

export function normalizePrintTextSize(value: unknown): PrintTextSize {
  return formatPrintTextSize(parsePrintTextSizeNumber(value));
}

export function getPrintTextSizeProfile(value: unknown) {
  const normalized = normalizePrintTextSize(value);
  return PRINT_TEXT_SIZE_OPTIONS.find((option) => option.value === normalized) ?? PRINT_TEXT_SIZE_OPTIONS[0];
}

export function getEffectiveReceiptWidth(receiptWidth: unknown, printTextSize: unknown) {
  const width = normalizeReceiptWidth(receiptWidth);
  const profile = getPrintTextSizeProfile(printTextSize);
  const printableWidth = width === 48 ? 46 : width;
  return Math.max(16, Math.floor(printableWidth / Math.max(1, profile.widthScale)));
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
