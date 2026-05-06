'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatBrl } from '@/lib/finance-utils';

type CashSession = {
  id: string;
  openedAt: string;
  openingAmount: number;
  status: string;
};

type CashSummary = {
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

type CashMovement = {
  id: string;
  movementType: string;
  amount: number;
  description: string | null;
  createdAt: string;
};

type CashSessionHistory = {
  id: string;
  status: string;
  openedAt: string;
  closedAt: string | null;
  openingAmount: number;
  closingAmountReported: number | null;
  closingAmountExpected: number | null;
  differenceAmount: number | null;
  notes: string | null;
};

const emptyCashSummary: CashSummary = {
  openingAmount: 0,
  cashSales: 0,
  supplies: 0,
  withdrawals: 0,
  refunds: 0,
  adjustments: 0,
  expectedDrawer: 0,
  accountGross: 0,
  accountFees: 0,
  expectedAccount: 0,
  accountToday: 0,
  accountFuture: 0,
  accountPix: 0,
  accountCard: 0,
  accountOther: 0,
  salesCount: 0,
  accountByMethod: {},
  receivables: [],
};

function movementTypeLabel(value: string) {
  if (value === 'sale') return 'Venda';
  if (value === 'supply') return 'Suprimento';
  if (value === 'withdrawal') return 'Sangria';
  if (value === 'refund') return 'Estorno';
  return 'Ajuste';
}

function parseMoneyField(value: string) {
  const raw = String(value || '').trim();
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
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function CashRegistersView() {
  const [current, setCurrent] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [expectedAmount, setExpectedAmount] = useState(0);
  const [summary, setSummary] = useState<CashSummary>(emptyCashSummary);
  const [sessions, setSessions] = useState<CashSessionHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [openingAmount, setOpeningAmount] = useState('0');
  const [closingAmount, setClosingAmount] = useState('0');
  const [notes, setNotes] = useState('');

  const [movementType, setMovementType] = useState('supply');
  const [movementAmount, setMovementAmount] = useState('0');
  const [movementDescription, setMovementDescription] = useState('');

  const loadCurrent = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/finance/cash/current', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao carregar caixa.');
        return;
      }
      setCurrent(data.current || null);
      setMovements(Array.isArray(data.movements) ? data.movements : []);
      setExpectedAmount(Number(data.expectedAmount || 0));
      setSummary({ ...emptyCashSummary, ...(data.summary || {}) });
      if (data.current) {
        setClosingAmount(String(Number(data.expectedAmount || 0).toFixed(2)));
      }
    } catch {
      setError('Falha ao carregar caixa.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetch('/api/finance/cash/sessions', { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) return;
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => {
    void loadCurrent();
    void loadSessions();
  }, [loadCurrent, loadSessions]);

  async function openCash() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/finance/cash/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ openingAmount, notes }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao abrir caixa.');
        return;
      }
      setMessage('Caixa aberto com sucesso.');
      await loadCurrent();
      await loadSessions();
    } catch {
      setError('Falha ao abrir caixa.');
    } finally {
      setSaving(false);
    }
  }

  async function closeCash() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/finance/cash/close', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ closingAmountReported: closingAmount, notes }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao fechar caixa.');
        return;
      }
      setMessage('Caixa fechado com sucesso.');
      await loadCurrent();
      await loadSessions();
    } catch {
      setError('Falha ao fechar caixa.');
    } finally {
      setSaving(false);
    }
  }

  async function addMovement() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/finance/cash/movements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          movementType,
          amount: movementAmount,
          description: movementDescription,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao lancar movimento.');
        return;
      }
      setMessage('Movimento registrado.');
      setMovementAmount('0');
      setMovementDescription('');
      await loadCurrent();
      await loadSessions();
    } catch {
      setError('Falha ao lancar movimento.');
    } finally {
      setSaving(false);
    }
  }

  async function reopenSession(sessionId: string) {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/finance/cash/reopen', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao reabrir caixa.');
        return;
      }
      setMessage('Caixa reaberto com sucesso.');
      await loadCurrent();
      await loadSessions();
    } catch {
      setError('Falha ao reabrir caixa.');
    } finally {
      setSaving(false);
    }
  }

  const difference = useMemo(() => Number((parseMoneyField(closingAmount) - expectedAmount).toFixed(2)), [closingAmount, expectedAmount]);

  return (
    <div className="max-w-6xl space-y-6">
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Caixas</h2>
            <p className="text-sm text-slate-500">Abertura, suprimento, sangria e fechamento do caixa atual.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link href="/financeiro/movimentacoes" className="btn-secondary">
              Ver movimentacoes
            </Link>
            <Link href="/financeiro/formas-pagamento" className="btn-secondary">
              Formas de pagamento
            </Link>
          </div>
        </div>
      </div>

      {error ? <p className="text-sm text-red-500">{error}</p> : null}
      {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

      {loading ? (
        <p className="text-sm text-slate-500">Carregando caixa...</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Status</p>
              <p className={`mt-3 text-lg font-bold ${current ? 'text-emerald-600' : 'text-rose-600'}`}>
                {current ? 'Caixa aberto' : 'Caixa fechado'}
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {current
                  ? `Aberto em ${new Date(current.openedAt).toLocaleString('pt-BR')}`
                  : 'Sem caixa aberto no momento. O sistema nao deve concluir vendas enquanto o caixa estiver fechado.'}
              </p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Valor inicial</p>
              <p className="mt-3 text-2xl font-black text-slate-900">{formatBrl(Number(current?.openingAmount || 0))}</p>
              <p className="mt-2 text-sm text-slate-500">Valor informado na abertura do caixa atual.</p>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Dinheiro na gaveta</p>
              <p className="mt-3 text-2xl font-black text-slate-900">{formatBrl(expectedAmount)}</p>
              <p className="mt-2 text-sm text-slate-500">Valor fisico esperado para contar no fechamento.</p>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Gaveta</p>
                  <h3 className="mt-2 text-lg font-black text-slate-900">{formatBrl(summary.expectedDrawer)}</h3>
                </div>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">dinheiro fisico</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Vendas dinheiro</p>
                  <p className="font-bold text-slate-900">{formatBrl(summary.cashSales)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Suprimentos</p>
                  <p className="font-bold text-emerald-700">{formatBrl(summary.supplies)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Sangrias</p>
                  <p className="font-bold text-rose-700">{formatBrl(summary.withdrawals)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Ajustes/estornos</p>
                  <p className="font-bold text-slate-900">{formatBrl(summary.adjustments - summary.refunds)}</p>
                </div>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-400">Conta e recebiveis</p>
                  <h3 className="mt-2 text-lg font-black text-slate-900">{formatBrl(summary.expectedAccount)}</h3>
                </div>
                <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">nao entra na gaveta</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Pix</p>
                  <p className="font-bold text-slate-900">{formatBrl(summary.accountPix)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Cartao</p>
                  <p className="font-bold text-slate-900">{formatBrl(summary.accountCard)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Recebe hoje</p>
                  <p className="font-bold text-emerald-700">{formatBrl(summary.accountToday)}</p>
                </div>
                <div className="rounded-lg bg-slate-50 p-3">
                  <p className="text-slate-500">Recebe depois</p>
                  <p className="font-bold text-amber-700">{formatBrl(summary.accountFuture)}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-slate-500">
                Bruto {formatBrl(summary.accountGross)} - taxas {formatBrl(summary.accountFees)}.
              </p>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900">{current ? 'Operacoes do caixa atual' : 'Abrir novo caixa'}</h3>

            {!current ? (
              <div className="grid gap-3 md:grid-cols-3">
                <input
                  inputMode="decimal"
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                  placeholder="Valor de abertura"
                  value={openingAmount}
                  onChange={(e) => setOpeningAmount(e.target.value)}
                />
                <input
                  className="border border-slate-200 rounded-lg px-3 py-2 text-sm md:col-span-2"
                  placeholder="Observacoes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
                <button type="button" className="btn-primary md:col-span-3" disabled={saving} onClick={() => void openCash()}>
                  {saving ? 'Abrindo...' : 'Abrir caixa'}
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 md:grid-cols-4">
                  <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                    <option value="supply">Suprimento</option>
                    <option value="withdrawal">Sangria</option>
                    <option value="adjustment">Ajuste</option>
                    <option value="refund">Estorno</option>
                  </select>
                  <input
                    inputMode="decimal"
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={movementAmount}
                    onChange={(e) => setMovementAmount(e.target.value)}
                    placeholder={movementType === 'adjustment' ? 'Valor (+/-)' : 'Valor'}
                  />
                  <input
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm md:col-span-2"
                    value={movementDescription}
                    onChange={(e) => setMovementDescription(e.target.value)}
                    placeholder="Descricao do movimento"
                  />
                  <button type="button" className="btn-secondary md:col-span-4" disabled={saving} onClick={() => void addMovement()}>
                    {saving ? 'Lancando...' : 'Lancar movimento'}
                  </button>
                  {movementType === 'adjustment' ? (
                    <p className="text-xs text-slate-500 md:col-span-4">Use valor positivo para sobra e negativo para quebra de caixa.</p>
                  ) : null}
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <input
                    inputMode="decimal"
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={closingAmount}
                    onChange={(e) => setClosingAmount(e.target.value)}
                    placeholder="Valor contado"
                  />
                  <input
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Observacoes do fechamento"
                  />
                  <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm">
                    Diferenca:{' '}
                    <strong className={difference === 0 ? 'text-emerald-600' : 'text-rose-600'}>
                      {formatBrl(difference)}
                    </strong>
                  </div>
                  <button type="button" className="btn-primary md:col-span-3" disabled={saving} onClick={() => void closeCash()}>
                    {saving ? 'Fechando...' : 'Fechar caixa'}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3">Movimentos do caixa atual</h3>
            {movements.length === 0 ? (
              <p className="text-sm text-slate-500">Sem movimentos no caixa atual.</p>
            ) : (
              <div className="space-y-2">
                {movements.map((movement) => (
                  <div key={movement.id} className="border border-slate-200 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold text-slate-900">{movementTypeLabel(movement.movementType)}</p>
                      <p className="text-slate-500">{movement.description || 'Sem descricao'}</p>
                    </div>
                    <div className="text-right">
                      <p className={movement.amount >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                        {formatBrl(movement.amount)}
                      </p>
                      <p className="text-slate-500">{new Date(movement.createdAt).toLocaleString('pt-BR')}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
            <h3 className="font-bold text-slate-900 mb-3">Historico de caixas</h3>
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum caixa registrado.</p>
            ) : (
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div key={session.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                    <div className="text-sm">
                      <p className="font-semibold text-slate-900">
                        {session.status === 'open' ? 'Aberto' : 'Fechado'} - {session.id.slice(0, 8)}
                      </p>
                      <p className="text-slate-500">
                        Abertura: {new Date(session.openedAt).toLocaleString('pt-BR')} - Inicial: {formatBrl(session.openingAmount)}
                      </p>
                      {session.closedAt ? (
                        <p className="text-slate-500">
                          Fechamento: {new Date(session.closedAt).toLocaleString('pt-BR')} - Esperado: {formatBrl(session.closingAmountExpected || 0)} - Informado: {formatBrl(session.closingAmountReported || 0)}
                        </p>
                      ) : null}
                    </div>
                    {session.status === 'closed' ? (
                      <button type="button" className="btn-secondary" disabled={saving || Boolean(current)} onClick={() => void reopenSession(session.id)}>
                        Reabrir
                      </button>
                    ) : (
                      <span className="text-xs font-semibold text-emerald-600">Caixa atual</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {current ? <p className="text-xs text-slate-500 mt-3">Para reabrir um caixa fechado, feche o caixa atual primeiro.</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
