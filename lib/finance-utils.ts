export function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

export function parseMoneyInput(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? roundMoney(value) : Number.NaN;
  }

  const raw = String(value ?? '').trim();
  if (!raw) return 0;

  let clean = raw.replace(/[^\d,.-]/g, '');
  const lastComma = clean.lastIndexOf(',');
  const lastDot = clean.lastIndexOf('.');

  if (lastComma > lastDot) {
    clean = clean.replace(/\./g, '').replace(',', '.');
  } else {
    clean = clean.replace(/,/g, '');
  }

  const parsed = Number(clean);
  return Number.isFinite(parsed) ? roundMoney(parsed) : Number.NaN;
}

export function parseIntegerInput(value: unknown) {
  const parsed = Number(String(value ?? '').replace(/[^\d-]/g, ''));
  return Number.isFinite(parsed) ? Math.round(parsed) : Number.NaN;
}

export function normalizePaymentMethodType(value: unknown) {
  const methodType = String(value || '').trim().toLowerCase();
  if (['pix', 'cash', 'card', 'bank_slip', 'wallet', 'other'].includes(methodType)) {
    return methodType;
  }
  return '';
}

export function formatBrl(value: number) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}
