export const BUSINESS_TIME_ZONE = 'America/Sao_Paulo';
export const BUSINESS_CURRENT_DATE_SQL = `timezone('${BUSINESS_TIME_ZONE}', NOW())::date`;

type DateInput = string | number | Date | null | undefined;

function toValidDate(value: DateInput) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function getBusinessDateKey(value: DateInput = new Date()) {
  const date = toValidDate(value);
  if (!date) return '';

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';
  return year && month && day ? `${year}-${month}-${day}` : '';
}

export function formatBusinessDate(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
) {
  const date = toValidDate(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: BUSINESS_TIME_ZONE,
    ...options,
  }).format(date);
}

export function formatBusinessTime(
  value: DateInput,
  options: Intl.DateTimeFormatOptions = {},
) {
  return formatBusinessDate(value, {
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  });
}

export function formatBusinessDateTime(
  value: DateInput,
  options?: Intl.DateTimeFormatOptions,
) {
  return formatBusinessDate(
    value,
    options || {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  );
}

export function formatBusinessDateKey(value: string | null | undefined) {
  const normalized = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    const [year, month, day] = normalized.split('-');
    return `${day}/${month}/${year}`;
  }
  return formatBusinessDate(normalized, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}
