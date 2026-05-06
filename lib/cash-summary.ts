import type { DbExecutor } from '@/lib/db';

type MovementSummaryRow = {
  movement_type: string;
  amount: string;
  payment_type: string | null;
};

type ReceivableSummaryRow = {
  method_type: string | null;
  method_name: string | null;
  gross_amount: string;
  fee_amount: string;
  net_amount: string;
  due_date: string;
  status: string;
};

export type CashSessionFinanceSummary = {
  openingAmount: number;
  cashSales: number;
  supplies: number;
  withdrawals: number;
  refunds: number;
  adjustments: number;
  expectedDrawer: number;
  accountGross: number;
  accountFees: number;
  expectedAccount: number;
  accountToday: number;
  accountFuture: number;
  accountPix: number;
  accountCard: number;
  accountOther: number;
  salesCount: number;
  accountByMethod: Record<string, number>;
  receivables: Array<{
    dueDate: string;
    status: 'overdue' | 'today' | 'future';
    methodType: string;
    methodName: string;
    grossAmount: number;
    feeAmount: number;
    netAmount: number;
  }>;
};

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function normalizePaymentType(value: string | null | undefined) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'cash' || normalized === 'money' || normalized === 'dinheiro') return 'cash';
  if (normalized === 'pix') return 'pix';
  if (
    normalized === 'card' ||
    normalized === 'cartao' ||
    normalized === 'cartao_credito' ||
    normalized === 'cartao_debito' ||
    normalized === 'credito' ||
    normalized === 'debito'
  ) {
    return 'card';
  }
  if (normalized === 'bank_slip' || normalized === 'boleto') return 'bank_slip';
  if (normalized === 'wallet' || normalized === 'carteira') return 'wallet';
  if (normalized === 'split') return 'split';
  if (normalized === 'other') return 'other';
  return '';
}

function dateKey(value: string | Date) {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return normalized;
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function receivableStatus(dueDate: string): 'overdue' | 'today' | 'future' {
  const today = dateKey(new Date());
  if (!dueDate || dueDate === today) return 'today';
  return dueDate < today ? 'overdue' : 'future';
}

export function isCashPaymentType(value: string | null | undefined) {
  return normalizePaymentType(value) === 'cash';
}

export async function getCashSessionFinanceSummary(input: {
  tenantId: string;
  sessionId: string;
  openedAt: string | Date;
  closedAt?: string | Date | null;
  openingAmount: number;
  executor: DbExecutor;
}): Promise<CashSessionFinanceSummary> {
  const openedAtIso = input.openedAt instanceof Date ? input.openedAt.toISOString() : input.openedAt;
  const closedAtIso = input.closedAt ? (input.closedAt instanceof Date ? input.closedAt.toISOString() : input.closedAt) : null;

  const [movementsResult, receivablesResult] = await Promise.all([
    input.executor.query<MovementSummaryRow>(
      `SELECT
         cm.movement_type,
         cm.amount::text,
         COALESCE(
           pm.method_type,
           matched_payment.method_type,
           NULLIF(o.payment_method, ''),
           ''
         ) AS payment_type
       FROM cash_movements cm
       LEFT JOIN orders o
         ON o.id = cm.reference_order_id
        AND o.tenant_id = cm.tenant_id
       LEFT JOIN payment_methods pm
         ON pm.id = o.payment_method_id
        AND pm.tenant_id = o.tenant_id
       LEFT JOIN LATERAL (
         SELECT op.method_type
         FROM order_payments op
         WHERE op.tenant_id = cm.tenant_id
           AND op.order_id = cm.reference_order_id
         ORDER BY
           CASE WHEN ABS(op.net_amount - ABS(cm.amount)) <= 0.02 THEN 0 ELSE 1 END,
           CASE WHEN lower(op.method_type) IN ('cash', 'money', 'dinheiro') THEN 0 ELSE 1 END,
           op.created_at ASC
         LIMIT 1
       ) matched_payment ON TRUE
       WHERE cm.tenant_id = $1
         AND cm.session_id = $2`,
      [input.tenantId, input.sessionId],
    ),
    input.executor.query<ReceivableSummaryRow>(
      `SELECT
         COALESCE(pm.method_type, '') AS method_type,
         COALESCE(pm.name, 'Conta') AS method_name,
         r.gross_amount::text,
         r.fee_amount::text,
         r.net_amount::text,
         r.due_date::text,
         r.status
       FROM receivables r
       LEFT JOIN payment_methods pm
         ON pm.id = r.payment_method_id
        AND pm.tenant_id = r.tenant_id
       LEFT JOIN orders o
         ON o.id = r.order_id
        AND o.tenant_id = r.tenant_id
       WHERE r.tenant_id = $1
         AND r.status <> 'cancelled'
         AND (
           o.cash_session_id = $2
           OR (
             r.created_at >= $3::timestamptz
             AND ($4::timestamptz IS NULL OR r.created_at <= $4::timestamptz)
           )
         )`,
      [input.tenantId, input.sessionId, openedAtIso, closedAtIso],
    ),
  ]);

  let cashSales = 0;
  let supplies = 0;
  let withdrawals = 0;
  let refunds = 0;
  let adjustments = 0;
  let legacyAccountNet = 0;
  let salesCount = 0;

  for (const row of movementsResult.rows) {
    const amount = Number(row.amount || 0);
    const movementType = String(row.movement_type || '').trim().toLowerCase();
    const paymentType = normalizePaymentType(row.payment_type);

    if (movementType === 'sale') {
      salesCount += 1;
      if (!paymentType || paymentType === 'cash') {
        cashSales += amount;
      } else {
        legacyAccountNet += amount;
      }
      continue;
    }

    if (movementType === 'supply') {
      supplies += amount;
      continue;
    }
    if (movementType === 'withdrawal') {
      withdrawals += Math.abs(amount);
      continue;
    }
    if (movementType === 'refund') {
      if (!paymentType || paymentType === 'cash') {
        refunds += Math.abs(amount);
      } else {
        legacyAccountNet += amount;
      }
      continue;
    }
    if (movementType === 'adjustment') {
      adjustments += amount;
    }
  }

  let accountGross = Math.max(0, legacyAccountNet);
  let accountFees = 0;
  let expectedAccount = legacyAccountNet;
  let accountToday = legacyAccountNet;
  let accountFuture = 0;
  let accountPix = 0;
  let accountCard = 0;
  let accountOther = legacyAccountNet;
  const accountByMethod: Record<string, number> = {};
  const receivables: CashSessionFinanceSummary['receivables'] = [];

  for (const row of receivablesResult.rows) {
    const methodType = normalizePaymentType(row.method_type) || 'other';
    const methodName = String(row.method_name || methodType);
    const grossAmount = Number(row.gross_amount || 0);
    const feeAmount = Number(row.fee_amount || 0);
    const netAmount = Number(row.net_amount || 0);
    const dueDate = dateKey(row.due_date);
    const status = receivableStatus(dueDate);

    accountGross += grossAmount;
    accountFees += feeAmount;
    expectedAccount += netAmount;
    if (status === 'future') {
      accountFuture += netAmount;
    } else {
      accountToday += netAmount;
    }

    if (methodType === 'pix') {
      accountPix += netAmount;
    } else if (methodType === 'card') {
      accountCard += netAmount;
    } else {
      accountOther += netAmount;
    }

    accountByMethod[methodName] = roundMoney((accountByMethod[methodName] || 0) + netAmount);
    receivables.push({
      dueDate,
      status,
      methodType,
      methodName,
      grossAmount: roundMoney(grossAmount),
      feeAmount: roundMoney(feeAmount),
      netAmount: roundMoney(netAmount),
    });
  }

  const expectedDrawer = roundMoney(input.openingAmount + cashSales + supplies + adjustments - withdrawals - refunds);

  return {
    openingAmount: roundMoney(input.openingAmount),
    cashSales: roundMoney(cashSales),
    supplies: roundMoney(supplies),
    withdrawals: roundMoney(withdrawals),
    refunds: roundMoney(refunds),
    adjustments: roundMoney(adjustments),
    expectedDrawer,
    accountGross: roundMoney(accountGross),
    accountFees: roundMoney(accountFees),
    expectedAccount: roundMoney(expectedAccount),
    accountToday: roundMoney(accountToday),
    accountFuture: roundMoney(accountFuture),
    accountPix: roundMoney(accountPix),
    accountCard: roundMoney(accountCard),
    accountOther: roundMoney(accountOther),
    salesCount,
    accountByMethod,
    receivables: receivables.sort((left, right) => {
      if (left.dueDate !== right.dueDate) return left.dueDate.localeCompare(right.dueDate);
      return left.methodName.localeCompare(right.methodName);
    }),
  };
}
