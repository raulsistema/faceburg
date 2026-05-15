'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  MessageCircle,
  MonitorCheck,
  Play,
  Printer,
  RefreshCw,
  Save,
  Square,
} from 'lucide-react';
import { cn } from '@/lib/utils';

type PrintConfigResponse = {
  enabled?: boolean;
  hasAgentKey?: boolean;
  connectionStatus?: string;
  printerName?: string;
  autoAcceptOrders?: boolean;
  lastError?: string;
  lastSeenAt?: string | null;
  error?: string;
};

type WhatsappConfigResponse = {
  enabled?: boolean;
  hasAgentKey?: boolean;
  sessionStatus?: string;
  qrCode?: string;
  phoneNumber?: string;
  lastError?: string;
  lastSeenAt?: string | null;
  activationPending?: boolean;
  message?: string;
  error?: string;
};

type DesktopPrintState = {
  status?: string;
  lastError?: string;
  lastJobAt?: string;
};

type DesktopWhatsappState = {
  status?: string;
  qrCode?: string;
  phoneNumber?: string;
  lastError?: string;
};

type DesktopBridgeState = {
  printRunning?: boolean;
  whatsRunning?: boolean;
  print?: DesktopPrintState | null;
  whatsapp?: DesktopWhatsappState | null;
};

type DesktopSessionSyncResponse = {
  authenticated?: boolean;
  error?: string;
  settings?: {
    printAgentKey?: string;
    whatsAgentKey?: string;
  };
};

type FaceburgDesktopBridge = {
  isDesktopApp: boolean;
  getState: () => Promise<DesktopBridgeState>;
  syncSession: () => Promise<DesktopSessionSyncResponse>;
  listPrinters?: () => Promise<string[]>;
  updatePrintConfig?: (payload: { printerName?: string; enabled?: boolean }) => Promise<unknown>;
  updateWhatsAppConfig?: (payload: { enabled?: boolean }) => Promise<unknown>;
  printDirect?: (payload: unknown) => Promise<unknown>;
  sendWhatsAppDirect?: (payload: unknown) => Promise<unknown>;
  startPrint?: () => Promise<{ ok: boolean }>;
  stopPrint?: () => Promise<{ ok: boolean }>;
  restartPrint?: () => Promise<{ ok: boolean }>;
  startWhatsApp?: () => Promise<{ ok: boolean }>;
  stopWhatsApp?: () => Promise<{ ok: boolean }>;
  restartWhatsApp?: () => Promise<{ ok: boolean }>;
  onPrintState?: (callback: (state: DesktopPrintState) => void) => void | (() => void);
  onWhatsAppState?: (callback: (state: DesktopWhatsappState) => void) => void | (() => void);
};

function getDesktopBridge() {
  if (typeof window === 'undefined') return null;
  return (window as Window & { faceburgDesktop?: FaceburgDesktopBridge }).faceburgDesktop ?? null;
}

function statusLabel(status: string, kind: 'print' | 'whatsapp') {
  const normalized = status.toLowerCase();
  if (normalized === 'ready') return 'Pronto';
  if (normalized === 'qr') return 'QR aguardando';
  if (normalized === 'connecting') return 'Conectando';
  if (normalized === 'error' || normalized === 'auth_failure') return 'Erro';
  if (normalized === 'stopped') return 'Parado';
  if (normalized === 'disconnected') return kind === 'print' ? 'Sem impressora ativa' : 'Desconectado';
  return status || 'Desconectado';
}

function statusTone(status: string) {
  const normalized = status.toLowerCase();
  if (normalized === 'ready') return 'success';
  if (normalized === 'connecting' || normalized === 'qr') return 'warning';
  if (normalized === 'error' || normalized === 'auth_failure') return 'error';
  return 'muted';
}

function formatLastSeen(value?: string | null) {
  if (!value) return 'Sem sinal recente';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem sinal recente';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function ToggleButton({
  checked,
  disabled,
  onClick,
  label,
}: {
  checked: boolean;
  disabled?: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-w-32 items-center justify-between gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
    >
      <span>{label}</span>
      <span
        className={cn(
          'relative h-6 w-11 rounded-full transition',
          checked ? 'bg-emerald-500' : 'bg-slate-300',
        )}
      >
        <span
          className={cn(
            'absolute top-1 h-4 w-4 rounded-full bg-white shadow transition',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </button>
  );
}

function StatusPill({ status, kind }: { status: string; kind: 'print' | 'whatsapp' }) {
  const tone = statusTone(status);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-bold',
        tone === 'success' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-700',
        tone === 'error' && 'border-rose-200 bg-rose-50 text-rose-700',
        tone === 'muted' && 'border-slate-200 bg-slate-50 text-slate-500',
      )}
    >
      {tone === 'success' ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
      {tone === 'error' ? <AlertTriangle className="h-3.5 w-3.5" /> : null}
      {statusLabel(status, kind)}
    </span>
  );
}

export default function HubAutomationSettings() {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [printers, setPrinters] = useState<string[]>([]);
  const [printerName, setPrinterName] = useState('');
  const [printEnabled, setPrintEnabled] = useState(false);
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(false);
  const [printStatus, setPrintStatus] = useState('disconnected');
  const [printRunning, setPrintRunning] = useState(false);
  const [printDirectAvailable, setPrintDirectAvailable] = useState(false);
  const [printLastSeenAt, setPrintLastSeenAt] = useState<string | null>(null);
  const [printLastError, setPrintLastError] = useState('');
  const [whatsappEnabled, setWhatsappEnabled] = useState(false);
  const [whatsappStatus, setWhatsappStatus] = useState('disconnected');
  const [whatsappRunning, setWhatsappRunning] = useState(false);
  const [whatsappPhoneNumber, setWhatsappPhoneNumber] = useState('');
  const [whatsappLastSeenAt, setWhatsappLastSeenAt] = useState<string | null>(null);
  const [whatsappLastError, setWhatsappLastError] = useState('');

  const canUseLocalHub = desktopAvailable;
  const selectedPrinterLabel = printerName || 'Nenhuma impressora selecionada';
  const effectivePrintStatus = printDirectAvailable && printEnabled ? 'ready' : printStatus;
  const effectivePrintRunning = printDirectAvailable && printEnabled ? true : printRunning;
  const effectiveWhatsappRunning = whatsappRunning || whatsappStatus === 'ready';
  const whatsappConnectionLabel = whatsappPhoneNumber || (whatsappStatus === 'ready' ? 'Sessao conectada neste computador' : 'Numero ainda nao conectado');
  const printLastSeenLabel = printDirectAvailable && printEnabled ? 'Agora (ponte local)' : formatLastSeen(printLastSeenAt);
  const whatsappLastSeenLabel = desktopAvailable && whatsappStatus === 'ready' ? 'Agora (ponte local)' : formatLastSeen(whatsappLastSeenAt);

  const hubSummary = useMemo(() => {
    if (!canUseLocalHub) return 'Abra esta tela pelo Hub local para escolher impressora e iniciar os agentes deste PC.';
    if (effectivePrintRunning || effectiveWhatsappRunning) return 'Hub local detectado neste computador.';
    return 'Hub local aberto, agentes parados.';
  }, [canUseLocalHub, effectivePrintRunning, effectiveWhatsappRunning]);

  const applyDesktopState = useCallback((state?: DesktopBridgeState | null) => {
    if (!state) return;
    if (state.print) {
      setPrintStatus(String(state.print.status || 'disconnected'));
      setPrintLastError(String(state.print.lastError || ''));
    }
    if (typeof state.printRunning === 'boolean') {
      setPrintRunning(state.printRunning);
    }
    if (state.whatsapp) {
      setWhatsappStatus(String(state.whatsapp.status || 'disconnected'));
      setWhatsappPhoneNumber(String(state.whatsapp.phoneNumber || ''));
      setWhatsappLastError(String(state.whatsapp.lastError || ''));
    }
    if (typeof state.whatsRunning === 'boolean') {
      setWhatsappRunning(state.whatsRunning);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const bridge = getDesktopBridge();
      setDesktopAvailable(Boolean(bridge?.isDesktopApp));
      setPrintDirectAvailable(Boolean(bridge?.isDesktopApp && bridge.printDirect));

      const [printResponse, whatsappResponse] = await Promise.all([
        fetch('/api/print/config', { cache: 'no-store' }),
        fetch('/api/whatsapp/config', { cache: 'no-store' }),
      ]);
      const printData = (await printResponse.json().catch(() => ({}))) as PrintConfigResponse;
      const whatsappData = (await whatsappResponse.json().catch(() => ({}))) as WhatsappConfigResponse;

      if (!printResponse.ok) {
        setError(printData.error || 'Falha ao carregar configuracao de impressao.');
      } else {
        setPrintEnabled(Boolean(printData.enabled));
        setAutoAcceptOrders(Boolean(printData.autoAcceptOrders));
        setPrinterName(String(printData.printerName || ''));
        setPrintStatus(String(printData.connectionStatus || 'disconnected'));
        setPrintLastSeenAt(printData.lastSeenAt || null);
        setPrintLastError(String(printData.lastError || ''));
      }

      if (!whatsappResponse.ok) {
        setError(whatsappData.error || 'Falha ao carregar configuracao do WhatsApp.');
      } else {
        setWhatsappEnabled(Boolean(whatsappData.enabled));
        setWhatsappStatus(String(whatsappData.sessionStatus || 'disconnected'));
        setWhatsappPhoneNumber(String(whatsappData.phoneNumber || ''));
        setWhatsappLastSeenAt(whatsappData.lastSeenAt || null);
        setWhatsappLastError(String(whatsappData.lastError || ''));
      }

      if (bridge?.isDesktopApp) {
        const [desktopState, printerList] = await Promise.all([
          bridge.getState().catch(() => null),
          bridge.listPrinters?.().catch(() => []) ?? Promise.resolve([]),
        ]);
        applyDesktopState(desktopState);
        if (bridge.printDirect && printData.enabled) {
          setPrintStatus('ready');
          setPrintRunning(true);
        }
        setPrinters(Array.isArray(printerList) ? printerList : []);
      } else {
        setPrinters([]);
        setPrintDirectAvailable(false);
        setPrintRunning(false);
        setWhatsappRunning(false);
      }
    } catch {
      setError('Falha ao carregar configuracao do Hub.');
    } finally {
      setLoading(false);
    }
  }, [applyDesktopState]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge?.isDesktopApp) return;

    const unsubPrint = bridge.onPrintState?.((state) => {
      setPrintStatus(String(state.status || 'disconnected'));
      setPrintLastError(String(state.lastError || ''));
      setPrintRunning(['ready', 'connecting', 'error'].includes(String(state.status || '')));
    });
    const unsubWhatsapp = bridge.onWhatsAppState?.((state) => {
      setWhatsappStatus(String(state.status || 'disconnected'));
      setWhatsappPhoneNumber(String(state.phoneNumber || ''));
      setWhatsappLastError(String(state.lastError || ''));
      setWhatsappRunning(['ready', 'qr', 'connecting', 'error', 'auth_failure'].includes(String(state.status || '')));
    });

    return () => {
      if (typeof unsubPrint === 'function') unsubPrint();
      if (typeof unsubWhatsapp === 'function') unsubWhatsapp();
    };
  }, []);

  async function syncDesktopSessionIfAvailable() {
    const bridge = getDesktopBridge();
    if (!bridge?.isDesktopApp) return null;
    setDesktopAvailable(true);
    return bridge.syncSession().catch(() => null);
  }

  async function updatePrintEnabled() {
    if (busy) return;
    const nextValue = !printEnabled;
    setBusy('print-enabled');
    setMessage('');
    setError('');
    try {
      const bridge = getDesktopBridge();
      if (nextValue) {
        await syncDesktopSessionIfAvailable();
      }

      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue, printerName }),
      });
      const data = (await response.json().catch(() => ({}))) as PrintConfigResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao atualizar impressao.');
        return;
      }

      setPrintEnabled(Boolean(data.enabled));
      setPrinterName(String(data.printerName || printerName));
      setPrintStatus(String(data.connectionStatus || printStatus));
      setPrintLastSeenAt(data.lastSeenAt || null);
      setPrintLastError(String(data.lastError || ''));

      if (bridge?.isDesktopApp) {
        if (nextValue) {
          await bridge.updatePrintConfig?.({ enabled: true, printerName: printerName || String(data.printerName || '') }).catch((reason) => {
            throw new Error(reason?.message || 'Falha ao atualizar o Hub local.');
          });
          await bridge.startPrint?.().catch((reason) => {
            throw new Error(reason?.message || 'Falha ao ligar impressao no Hub.');
          });
          setPrintRunning(true);
          setPrintStatus('connecting');
        } else {
          await bridge.updatePrintConfig?.({ enabled: false, printerName: printerName || String(data.printerName || '') }).catch(() => null);
          await bridge.stopPrint?.().catch(() => null);
          setPrintRunning(false);
          setPrintStatus('stopped');
        }
      }

      setMessage(nextValue ? 'Impressao do Hub ligada.' : 'Impressao do Hub desligada.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao atualizar impressao.');
    } finally {
      setBusy('');
    }
  }

  async function savePrinter() {
    if (busy) return;
    setBusy('printer');
    setMessage('');
    setError('');
    try {
      const bridge = getDesktopBridge();
      await syncDesktopSessionIfAvailable();
      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ printerName }),
      });
      const data = (await response.json().catch(() => ({}))) as PrintConfigResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar impressora.');
        return;
      }
      setPrinterName(String(data.printerName || printerName));
      if (bridge?.isDesktopApp) {
        await bridge.updatePrintConfig?.({ printerName }).catch((reason) => {
          throw new Error(reason?.message || 'Falha ao salvar impressora no Hub.');
        });
        if (printRunning) {
          await bridge.restartPrint?.().catch(() => null);
        }
      }
      setMessage('Impressora salva no Hub.');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao salvar impressora.');
    } finally {
      setBusy('');
    }
  }

  async function toggleAutoAcceptOrders() {
    if (busy) return;
    const nextValue = !autoAcceptOrders;
    setBusy('auto-accept');
    setMessage('');
    setError('');
    try {
      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ autoAcceptOrders: nextValue }),
      });
      const data = (await response.json().catch(() => ({}))) as PrintConfigResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao salvar pedido direto na cozinha.');
        return;
      }
      setAutoAcceptOrders(Boolean(data.autoAcceptOrders));
      setMessage(nextValue ? 'Pedido direto na cozinha ligado.' : 'Pedido direto na cozinha desligado.');
    } catch {
      setError('Falha ao salvar pedido direto na cozinha.');
    } finally {
      setBusy('');
    }
  }

  async function updateWhatsappEnabled() {
    if (busy) return;
    const nextValue = !whatsappEnabled;
    setBusy('whatsapp-enabled');
    setMessage('');
    setError('');
    try {
      const bridge = getDesktopBridge();
      if (nextValue) {
        await syncDesktopSessionIfAvailable();
      }

      const response = await fetch('/api/whatsapp/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ enabled: nextValue }),
      });
      const data = (await response.json().catch(() => ({}))) as WhatsappConfigResponse;
      if (!response.ok) {
        setError(data.error || 'Falha ao atualizar WhatsApp.');
        return;
      }

      setWhatsappEnabled(Boolean(data.enabled));
      setWhatsappStatus(String(data.sessionStatus || whatsappStatus));
      setWhatsappPhoneNumber(String(data.phoneNumber || ''));
      setWhatsappLastSeenAt(data.lastSeenAt || null);
      setWhatsappLastError(String(data.lastError || ''));

      if (bridge?.isDesktopApp) {
        if (nextValue) {
          await bridge.updateWhatsAppConfig?.({ enabled: true }).catch((reason) => {
            throw new Error(reason?.message || 'Falha ao atualizar WhatsApp no Hub.');
          });
          await bridge.startWhatsApp?.().catch((reason) => {
            throw new Error(reason?.message || 'Falha ao abrir WhatsApp no Hub.');
          });
          setWhatsappRunning(true);
          setWhatsappStatus('connecting');
        } else {
          await bridge.updateWhatsAppConfig?.({ enabled: false }).catch(() => null);
          await bridge.stopWhatsApp?.().catch(() => null);
          setWhatsappRunning(false);
          setWhatsappStatus('stopped');
        }
      }

      setMessage(data.message || (nextValue ? 'WhatsApp do Hub ligado.' : 'WhatsApp do Hub desligado.'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao atualizar WhatsApp.');
    } finally {
      setBusy('');
    }
  }

  async function runPrint(action: 'start' | 'stop') {
    if (busy) return;
    const bridge = getDesktopBridge();
    if (!bridge?.isDesktopApp) {
      setError('Abra esta tela pelo Hub local para controlar a impressao deste PC.');
      return;
    }
    setBusy(`print-${action}`);
    setMessage('');
    setError('');
    try {
      await syncDesktopSessionIfAvailable();
      if (action === 'start') {
        await bridge.startPrint?.();
        setPrintRunning(true);
        setPrintStatus('connecting');
        setMessage('Impressao iniciando no Hub.');
      } else {
        await bridge.stopPrint?.();
        setPrintRunning(false);
        setPrintStatus('stopped');
        setMessage('Impressao parada no Hub.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao controlar impressao.');
    } finally {
      setBusy('');
    }
  }

  async function runWhatsapp(action: 'start' | 'stop') {
    if (busy) return;
    const bridge = getDesktopBridge();
    if (!bridge?.isDesktopApp) {
      setError('Abra esta tela pelo Hub local para controlar o WhatsApp deste PC.');
      return;
    }
    setBusy(`whatsapp-${action}`);
    setMessage('');
    setError('');
    try {
      await syncDesktopSessionIfAvailable();
      if (action === 'start') {
        await bridge.startWhatsApp?.();
        setWhatsappRunning(true);
        setWhatsappStatus('connecting');
        setMessage('WhatsApp abrindo no Hub.');
      } else {
        await bridge.stopWhatsApp?.();
        setWhatsappRunning(false);
        setWhatsappStatus('stopped');
        setMessage('WhatsApp parado no Hub.');
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Falha ao controlar WhatsApp.');
    } finally {
      setBusy('');
    }
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 text-xs font-bold text-sky-700">
            <MonitorCheck className="h-3.5 w-3.5" />
            Ponte local
          </div>
          <h3 className="text-sm font-bold uppercase tracking-widest text-slate-500">Hub: Impressao e WhatsApp</h3>
          <p className="mt-1 text-sm text-slate-500">{hubSummary}</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading || Boolean(busy)}
          className="btn-secondary inline-flex w-fit items-center gap-2"
        >
          <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          Atualizar
        </button>
      </div>

      {loading ? (
        <p className="mt-5 text-sm text-slate-500">Carregando configuracao do Hub...</p>
      ) : (
        <div className="mt-5 grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 lg:border-r lg:border-slate-100 lg:pr-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                  <Printer className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-bold text-slate-900">Impressao</p>
                  <p className="text-xs text-slate-500">{selectedPrinterLabel}</p>
                </div>
              </div>
              <StatusPill status={effectivePrintStatus} kind="print" />
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
              <select
                value={printerName}
                onChange={(event) => setPrinterName(event.target.value)}
                className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
              >
                <option value="">Selecione a impressora</option>
                {printers.map((printer) => (
                  <option key={printer} value={printer}>
                    {printer}
                  </option>
                ))}
                {printerName && !printers.includes(printerName) ? (
                  <option value={printerName}>{printerName}</option>
                ) : null}
              </select>
              <button
                type="button"
                onClick={() => void savePrinter()}
                disabled={Boolean(busy)}
                className="btn-secondary inline-flex items-center justify-center gap-2"
              >
                <Save className="h-4 w-4" />
                Salvar
              </button>
            </div>

            <div className="flex flex-wrap gap-3">
              <ToggleButton
                checked={printEnabled}
                disabled={Boolean(busy)}
                onClick={() => void updatePrintEnabled()}
                label={printEnabled ? 'Ativa' : 'Inativa'}
              />
              <ToggleButton
                checked={autoAcceptOrders}
                disabled={Boolean(busy)}
                onClick={() => void toggleAutoAcceptOrders()}
                label="Aceitar pedido"
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void runPrint('start')}
                disabled={!canUseLocalHub || Boolean(busy)}
                className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                Ligar impressao
              </button>
              <button
                type="button"
                onClick={() => void runPrint('stop')}
                disabled={!canUseLocalHub || Boolean(busy)}
                className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Square className="h-4 w-4" />
                Parar
              </button>
            </div>

            <p className="text-xs text-slate-500">Ultimo sinal: {printLastSeenLabel}</p>
            {printLastError ? <p className="text-xs font-semibold text-rose-600">{printLastError}</p> : null}
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-green-50 text-green-700">
                  <MessageCircle className="h-5 w-5" />
                </span>
                <div>
                  <p className="font-bold text-slate-900">WhatsApp</p>
                  <p className="text-xs text-slate-500">{whatsappConnectionLabel}</p>
                </div>
              </div>
              <StatusPill status={whatsappStatus} kind="whatsapp" />
            </div>

            <div className="flex flex-wrap gap-3">
              <ToggleButton
                checked={whatsappEnabled}
                disabled={Boolean(busy)}
                onClick={() => void updateWhatsappEnabled()}
                label={whatsappEnabled ? 'Ativo' : 'Inativo'}
              />
            </div>

            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void runWhatsapp('start')}
                disabled={!canUseLocalHub || Boolean(busy)}
                className="btn-primary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Play className="h-4 w-4" />
                Abrir WhatsApp
              </button>
              <button
                type="button"
                onClick={() => void runWhatsapp('stop')}
                disabled={!canUseLocalHub || Boolean(busy)}
                className="btn-secondary inline-flex items-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <Square className="h-4 w-4" />
                Parar
              </button>
            </div>

            <p className="text-xs text-slate-500">Ultimo sinal: {whatsappLastSeenLabel}</p>
            {whatsappLastError ? <p className="text-xs font-semibold text-rose-600">{whatsappLastError}</p> : null}
          </div>
        </div>
      )}

      {message ? <p className="mt-5 text-sm font-semibold text-emerald-600">{message}</p> : null}
      {error ? <p className="mt-5 text-sm font-semibold text-rose-600">{error}</p> : null}
    </section>
  );
}
