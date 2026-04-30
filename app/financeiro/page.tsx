'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import DashboardShell from '@/components/layout/DashboardShell';

type CashSession = {
  id: string;
  openedAt: string;
  openingAmount: number;
  status: string;
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

type FinanceTransaction = {
  id: string;
  source: 'cash_movement' | 'receivable';
  kind: string;
  amount: number;
  description: string | null;
  status: string;
  orderId: string | null;
  createdAt: string;
  dueDate: string | null;
};

type FinanceSale = {
  id: string;
  customerName: string;
  total: number;
  paymentMethod: string;
  paymentFeeAmount: number;
  paymentNetAmount: number;
  status: string;
  type: string;
  createdAt: string;
  updatedAt: string;
};

export default function FinanceiroPage() {
  const [current, setCurrent] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [expectedAmount, setExpectedAmount] = useState(0);
  const [sessions, setSessions] = useState<CashSessionHistory[]>([]);
  const [transactions, setTransactions] = useState<FinanceTransaction[]>([]);
  const [sales, setSales] = useState<FinanceSale[]>([]);
  const [transactionsPage, setTransactionsPage] = useState(1);
  const [transactionsHasMore, setTransactionsHasMore] = useState(false);
  const [salesPage, setSalesPage] = useState(1);
  const [salesHasMore, setSalesHasMore] = useState(false);
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

  const loadTransactions = useCallback(async (page = 1) => {
    try {
      const response = await fetch(`/api/finance/transactions?page=${page}&limit=20`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) return;
      setTransactions(Array.isArray(data.transactions) ? data.transactions : []);
      setTransactionsHasMore(Boolean(data.hasMore));
      setTransactionsPage(page);
    } catch {
      // silencioso
    }
  }, []);

  const loadSales = useCallback(async (page = 1) => {
    try {
      const response = await fetch(`/api/finance/sales?page=${page}&limit=20`, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) return;
      setSales(Array.isArray(data.sales) ? data.sales : []);
      setSalesHasMore(Boolean(data.hasMore));
      setSalesPage(page);
    } catch {
      // silencioso
    }
  }, []);

  useEffect(() => {
    void loadCurrent();
    void loadSessions();
    void loadTransactions(1);
    void loadSales(1);
  }, [loadCurrent, loadSales, loadSessions, loadTransactions]);

  async function openCash() {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch('/api/finance/cash/open', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ openingAmount: Number(openingAmount || 0), notes }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao abrir caixa.');
        return;
      }
      setMessage('Caixa aberto com sucesso.');
      await loadCurrent();
      await loadSessions();
      await loadTransactions(1);
      await loadSales(1);
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
        body: JSON.stringify({ closingAmountReported: Number(closingAmount || 0), notes }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Falha ao fechar caixa.');
        return;
      }
      setMessage('Caixa fechado com sucesso.');
      await loadCurrent();
      await loadSessions();
      await loadTransactions(1);
      await loadSales(1);
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
          amount: Number(movementAmount || 0),
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
      await loadTransactions(1);
      await loadSales(1);
    } catch {
      setError('Falha ao lancar movimento.');
    } finally {
      setSaving(false);
    }
  }

  const difference = useMemo(() => Number((Number(closingAmount || 0) - expectedAmount).toFixed(2)), [closingAmount, expectedAmount]);

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
      await loadTransactions(1);
      await loadSales(1);
    } catch {
      setError('Falha ao reabrir caixa.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell>
      <div className="max-w-5xl space-y-6">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900">Financeiro - Caixa</h2>
          <p className="text-sm text-slate-500">Abertura, movimentacao e fechamento de caixa.</p>
        </div>

        {error ? <p className="text-sm text-red-500">{error}</p> : null}
        {message ? <p className="text-sm text-emerald-600">{message}</p> : null}

        {loading ? (
          <p className="text-sm text-slate-500">Carregando caixa...</p>
        ) : (
          <>
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-3">
              <h3 className="font-bold text-slate-900">{current ? 'Caixa aberto' : 'Abrir caixa'}</h3>

              {!current ? (
                <div className="grid md:grid-cols-3 gap-2">
                  <input type="number" min="0" step="0.01" className="border border-slate-200 rounded-lg px-3 py-2 text-sm" placeholder="Valor de abertura" value={openingAmount} onChange={(e) => setOpeningAmount(e.target.value)} />
                  <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm md:col-span-2" placeholder="Observacoes" value={notes} onChange={(e) => setNotes(e.target.value)} />
                  <button type="button" className="btn-primary md:col-span-3" disabled={saving} onClick={() => void openCash()}>{saving ? 'Abrindo...' : 'Abrir caixa'}</button>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="grid md:grid-cols-3 gap-2 text-sm">
                    <div className="border border-slate-200 rounded-lg p-3"><p className="text-slate-500">Abertura</p><p className="font-semibold">R$ {Number(current.openingAmount).toFixed(2)}</p></div>
                    <div className="border border-slate-200 rounded-lg p-3"><p className="text-slate-500">Esperado agora</p><p className="font-semibold">R$ {expectedAmount.toFixed(2)}</p></div>
                    <div className="border border-slate-200 rounded-lg p-3"><p className="text-slate-500">Aberto em</p><p className="font-semibold">{new Date(current.openedAt).toLocaleString('pt-BR')}</p></div>
                  </div>

                  <div className="grid md:grid-cols-4 gap-2">
                    <select className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={movementType} onChange={(e) => setMovementType(e.target.value)}>
                      <option value="supply">Suprimento</option>
                      <option value="withdrawal">Sangria</option>
                      <option value="adjustment">Ajuste</option>
                      <option value="refund">Estorno</option>
                    </select>
                    <input type="number" min="0" step="0.01" className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={movementAmount} onChange={(e) => setMovementAmount(e.target.value)} placeholder="Valor" />
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm md:col-span-2" value={movementDescription} onChange={(e) => setMovementDescription(e.target.value)} placeholder="Descricao" />
                    <button type="button" className="btn-secondary md:col-span-4" disabled={saving} onClick={() => void addMovement()}>{saving ? 'Lancando...' : 'Lancar movimento'}</button>
                  </div>

                  <div className="grid md:grid-cols-3 gap-2">
                    <input type="number" min="0" step="0.01" className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={closingAmount} onChange={(e) => setClosingAmount(e.target.value)} placeholder="Valor contado no fechamento" />
                    <input className="border border-slate-200 rounded-lg px-3 py-2 text-sm" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Observacoes fechamento" />
                    <div className="border border-slate-200 rounded-lg px-3 py-2 text-sm">Diferenca: <strong className={difference === 0 ? 'text-emerald-600' : 'text-rose-600'}>R$ {difference.toFixed(2)}</strong></div>
                    <button type="button" className="btn-primary md:col-span-3" disabled={saving} onClick={() => void closeCash()}>{saving ? 'Fechando...' : 'Fechar caixa'}</button>
                  </div>
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-3">Movimentos recentes</h3>
              {movements.length === 0 ? <p className="text-sm text-slate-500">Sem movimentos no caixa atual.</p> : (
                <div className="space-y-2">
                  {movements.map((movement) => (
                    <div key={movement.id} className="border border-slate-200 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">{movement.movementType}</p>
                        <p className="text-slate-500">{movement.description || 'Sem descricao'}</p>
                      </div>
                      <div className="text-right">
                        <p className={movement.amount >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>R$ {movement.amount.toFixed(2)}</p>
                        <p className="text-slate-500">{new Date(movement.createdAt).toLocaleString('pt-BR')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-3">Caixas abertos e fechados</h3>
              {sessions.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhum caixa registrado.</p>
              ) : (
                <div className="space-y-2">
                  {sessions.map((session) => (
                    <div key={session.id} className="border border-slate-200 rounded-lg p-3 flex items-center justify-between gap-3">
                      <div className="text-sm">
                        <p className="font-semibold text-slate-900">
                          {session.status === 'open' ? 'Aberto' : 'Fechado'} • {session.id.slice(0, 8)}
                        </p>
                        <p className="text-slate-500">
                          Abertura: {new Date(session.openedAt).toLocaleString('pt-BR')} • Inicial: R$ {session.openingAmount.toFixed(2)}
                        </p>
                        {session.closedAt ? (
                          <p className="text-slate-500">
                            Fechamento: {new Date(session.closedAt).toLocaleString('pt-BR')} • Esperado: R$ {(session.closingAmountExpected || 0).toFixed(2)} • Informado: R$ {(session.closingAmountReported || 0).toFixed(2)}
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

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-3">Todas as transacoes inseridas</h3>
              {transactions.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma transacao registrada.</p>
              ) : (
                <div className="space-y-2">
                  {transactions.map((tx) => (
                    <div key={`${tx.source}-${tx.id}`} className="border border-slate-200 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {tx.source === 'cash_movement' ? 'Movimento de caixa' : 'Recebivel'}
                          {tx.orderId ? ` • Pedido #${tx.orderId.slice(0, 8)}` : ''}
                        </p>
                        <p className="text-slate-500">
                          {tx.description || tx.kind}
                          {tx.dueDate ? ` • Vencimento: ${new Date(tx.dueDate).toLocaleDateString('pt-BR')}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className={tx.amount >= 0 ? 'font-semibold text-emerald-600' : 'font-semibold text-rose-600'}>
                          R$ {tx.amount.toFixed(2)}
                        </p>
                        <p className="text-slate-500">
                          {new Date(tx.createdAt).toLocaleString('pt-BR')}
                          {tx.source === 'receivable' ? ` • ${tx.status}` : ''}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={transactionsPage <= 1}
                  onClick={() => void loadTransactions(transactionsPage - 1)}
                >
                  Anterior
                </button>
                <span className="text-xs text-slate-500">Pagina {transactionsPage}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!transactionsHasMore}
                  onClick={() => void loadTransactions(transactionsPage + 1)}
                >
                  Proxima
                </button>
              </div>
            </div>

            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h3 className="font-bold text-slate-900 mb-3">Livro financeiro de vendas</h3>
              <p className="text-xs text-slate-500 mb-3">
                Toda venda registrada em pedidos aparece aqui, mesmo com caixa fechado.
              </p>
              {sales.length === 0 ? (
                <p className="text-sm text-slate-500">Nenhuma venda registrada.</p>
              ) : (
                <div className="space-y-2">
                  {sales.map((sale) => (
                    <div key={sale.id} className="border border-slate-200 rounded-lg p-3 text-sm flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          Pedido #{sale.id.slice(0, 8)} • {sale.customerName}
                        </p>
                        <p className="text-slate-500">
                          {sale.type} • {sale.paymentMethod} • status: {sale.status}
                        </p>
                        <p className="text-slate-500">
                          {new Date(sale.createdAt).toLocaleString('pt-BR')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-900">Bruto: R$ {sale.total.toFixed(2)}</p>
                        <p className="text-rose-600">Taxa: R$ {sale.paymentFeeAmount.toFixed(2)}</p>
                        <p className="font-semibold text-emerald-600">Liquido: R$ {sale.paymentNetAmount.toFixed(2)}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 flex items-center justify-end gap-2">
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={salesPage <= 1}
                  onClick={() => void loadSales(salesPage - 1)}
                >
                  Anterior
                </button>
                <span className="text-xs text-slate-500">Pagina {salesPage}</span>
                <button
                  type="button"
                  className="btn-secondary"
                  disabled={!salesHasMore}
                  onClick={() => void loadSales(salesPage + 1)}
                >
                  Proxima
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
