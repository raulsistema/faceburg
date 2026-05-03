'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Copy, FileText, KeyRound, ListChecks, Play, Power, Printer, RefreshCw, Save, Settings2 } from 'lucide-react';
import {
  DEFAULT_PRINT_EVENTS,
  DEFAULT_RECEIPT_OPTIONS,
  PRINT_WIDTH_OPTIONS,
  normalizePrintCopies,
  normalizePrintEvents,
  normalizeReceiptOptions,
  normalizeReceiptText,
  normalizeReceiptWidth,
  type PrintEventKey,
  type PrintEvents,
  type ReceiptOptions,
} from '@/lib/print-settings';

type PrintConfig = {
  enabled: boolean;
  hasAgentKey: boolean;
  agentKey: string;
  printerName: string;
  receiptWidth: number;
  printCopies: number;
  printEvents: PrintEvents;
  receiptOptions: ReceiptOptions;
  receiptHeader: string;
  receiptFooter: string;
  lastSeenAt: string | null;
};

type PrintState = {
  status?: string;
  lastError?: string;
  lastJobAt?: string;
  realtimeConnected?: boolean;
};

type FaceburgDesktopBridge = {
  isDesktopApp?: boolean;
  getState?: () => Promise<{ printRunning?: boolean; print?: PrintState | null }>;
  listPrinters?: () => Promise<string[]>;
  updatePrinter?: (payload: { printerName: string }) => Promise<unknown>;
  startPrint?: () => Promise<unknown>;
  stopPrint?: () => Promise<unknown>;
  syncSession?: () => Promise<unknown>;
  onPrintState?: (callback: (state: PrintState) => void) => (() => void) | void;
};

type SaveOptions = {
  quiet?: boolean;
};

const EVENT_OPTIONS: Array<{ key: PrintEventKey; label: string; detail: string }> = [
  { key: 'new_order', label: 'Pedido novo', detail: 'Entrada do site e PDV' },
  { key: 'status_processing', label: 'Em preparo', detail: 'Via da cozinha' },
  { key: 'status_delivering', label: 'Saiu entrega', detail: 'Controle do entregador' },
  { key: 'status_completed', label: 'Concluido', detail: 'Comprovante final' },
  { key: 'status_cancelled', label: 'Cancelado', detail: 'Com motivo' },
  { key: 'manual_receipt', label: 'Recibo manual', detail: 'Botao imprimir' },
];

const RECEIPT_OPTION_LABELS: Array<{ key: keyof ReceiptOptions; label: string }> = [
  { key: 'showStoreInfo', label: 'Dados da loja' },
  { key: 'showCustomerPhone', label: 'Telefone' },
  { key: 'showDeliveryAddress', label: 'Endereco' },
  { key: 'showPayment', label: 'Pagamento' },
  { key: 'showItemNotes', label: 'Adicionais e obs.' },
  { key: 'showTotals', label: 'Totais' },
];

function getDesktopBridge() {
  if (typeof window === 'undefined') return null;
  return (window as Window & { faceburgDesktop?: FaceburgDesktopBridge }).faceburgDesktop ?? null;
}

function buildPrintState(data?: PrintConfig | null) {
  return {
    data: data ?? null,
    enabled: Boolean(data?.enabled),
    printerName: String(data?.printerName || ''),
    receiptWidth: normalizeReceiptWidth(data?.receiptWidth),
    printCopies: normalizePrintCopies(data?.printCopies),
    printEvents: normalizePrintEvents(data?.printEvents || DEFAULT_PRINT_EVENTS),
    receiptOptions: normalizeReceiptOptions(data?.receiptOptions || DEFAULT_RECEIPT_OPTIONS),
    receiptHeader: normalizeReceiptText(data?.receiptHeader),
    receiptFooter: normalizeReceiptText(data?.receiptFooter),
  };
}

function wrapPreviewText(value: string, width: number) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const words = clean.split(' ');
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= width) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    if (word.length <= width) {
      current = word;
      continue;
    }
    let remaining = word;
    while (remaining.length > width) {
      lines.push(remaining.slice(0, width));
      remaining = remaining.slice(width);
    }
    current = remaining;
  }

  if (current) lines.push(current);
  return lines;
}

function centerPreviewLine(value: string, width: number) {
  const clean = String(value || '').trim();
  if (!clean || clean.length >= width) return clean;
  return `${' '.repeat(Math.floor((width - clean.length) / 2))}${clean}`;
}

function alignPreviewLine(left: string, right: string, width: number) {
  const spacing = width - left.length - right.length;
  if (spacing < 1) return `${left}\n${right}`;
  return `${left}${' '.repeat(spacing)}${right}`;
}

function buildPreviewText(config: {
  receiptWidth: number;
  receiptOptions: ReceiptOptions;
  receiptHeader: string;
  receiptFooter: string;
  printCopies: number;
}) {
  const width = config.receiptWidth;
  const lines: string[] = [];
  const divider = '-'.repeat(width);

  if (config.receiptHeader) {
    for (const line of wrapPreviewText(config.receiptHeader, width)) {
      lines.push(centerPreviewLine(line, width));
    }
    lines.push(divider);
  }

  lines.push(centerPreviewLine('DELIVERY', width));
  lines.push(centerPreviewLine('VIA BALCAO', width));
  lines.push('Venda: TESTE01');
  lines.push('Data: 03/05/2026 19:42');
  lines.push('Entrega prevista: 20:22');
  lines.push('Cliente: Maria Souza');

  if (config.receiptOptions.showCustomerPhone) {
    lines.push('Tel.: (11) 98222-3966');
  }

  if (config.receiptOptions.showDeliveryAddress) {
    lines.push(...wrapPreviewText('End.: Rua das Palmeiras, 120 - Centro', width));
  }

  lines.push(divider);
  lines.push(centerPreviewLine('DOCUMENTO DE VENDA', width));
  lines.push(divider);
  lines.push(alignPreviewLine('1un Face Burg Classico', 'R$ 29,90', width));
  if (config.receiptOptions.showItemNotes) {
    lines.push('+ Bacon extra (+ R$ 4,00)');
    lines.push('Obs.: sem cebola');
  }
  lines.push(divider);
  lines.push(alignPreviewLine('2un Batata rustica', 'R$ 24,00', width));
  lines.push(divider);

  if (config.receiptOptions.showTotals) {
    lines.push(alignPreviewLine('Itens Comanda', '2 itens', width));
    lines.push('');
    lines.push(alignPreviewLine('Sub Total:', 'R$ 53,90', width));
    lines.push(alignPreviewLine('Entrega:', 'R$ 5,00', width));
    lines.push(alignPreviewLine('Total:', 'R$ 58,90', width));
  }

  if (config.receiptOptions.showPayment) {
    lines.push('');
    lines.push(...wrapPreviewText('Pagar na entrega (Pix)', width));
  }

  if (config.receiptOptions.showStoreInfo) {
    lines.push('');
    lines.push(centerPreviewLine('Face Burg', width));
    lines.push(centerPreviewLine('CNPJ: 00.000.000/0001-00', width));
  }

  if (config.receiptFooter) {
    lines.push('');
    for (const line of wrapPreviewText(config.receiptFooter, width)) {
      lines.push(centerPreviewLine(line, width));
    }
  }

  if (config.printCopies > 1) {
    lines.push('');
    lines.push(centerPreviewLine(`VIA 1/${config.printCopies}`, width));
  }

  return lines.filter((line, index, source) => line || (index > 0 && source[index - 1] !== '')).join('\n');
}

function heartbeatLabel(value: string | null | undefined) {
  if (!value) return 'ainda nao conectado';
  return new Date(value).toLocaleString('pt-BR');
}

function isFreshHeartbeat(value: string | null | undefined) {
  if (!value) return false;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return false;
  return Date.now() - parsed <= 2 * 60 * 1000;
}

export default function PrintAgentSettings({ initialData }: { initialData?: PrintConfig | null }) {
  const initialState = buildPrintState(initialData);
  const [data, setData] = useState<PrintConfig | null>(initialState.data);
  const [enabled, setEnabled] = useState(initialState.enabled);
  const [printerName, setPrinterName] = useState(initialState.printerName);
  const [receiptWidth, setReceiptWidth] = useState(initialState.receiptWidth);
  const [printCopies, setPrintCopies] = useState(initialState.printCopies);
  const [printEvents, setPrintEvents] = useState<PrintEvents>(initialState.printEvents);
  const [receiptOptions, setReceiptOptions] = useState<ReceiptOptions>(initialState.receiptOptions);
  const [receiptHeader, setReceiptHeader] = useState(initialState.receiptHeader);
  const [receiptFooter, setReceiptFooter] = useState(initialState.receiptFooter);
  const [printers, setPrinters] = useState<string[]>([]);
  const [desktopAvailable, setDesktopAvailable] = useState(false);
  const [printRunning, setPrintRunning] = useState(false);
  const [desktopPrintState, setDesktopPrintState] = useState<PrintState | null>(null);
  const [loading, setLoading] = useState(!initialData);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [desktopBusy, setDesktopBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<'success' | 'warning'>('success');
  const requestControllerRef = useRef<AbortController | null>(null);

  const previewText = useMemo(
    () =>
      buildPreviewText({
        receiptWidth,
        receiptOptions,
        receiptHeader,
        receiptFooter,
        printCopies,
      }),
    [printCopies, receiptFooter, receiptHeader, receiptOptions, receiptWidth],
  );

  const agentFresh = isFreshHeartbeat(data?.lastSeenAt);
  const statusLabel = enabled ? (agentFresh || printRunning ? 'Ativo' : 'Aguardando hub') : 'Desativado';
  const statusClass = enabled && (agentFresh || printRunning) ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : enabled ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-50 text-slate-500 border-slate-200';

  const applyConfig = useCallback((next: PrintConfig) => {
    const nextState = buildPrintState(next);
    setData(next);
    setEnabled(nextState.enabled);
    setPrinterName(nextState.printerName);
    setReceiptWidth(nextState.receiptWidth);
    setPrintCopies(nextState.printCopies);
    setPrintEvents(nextState.printEvents);
    setReceiptOptions(nextState.receiptOptions);
    setReceiptHeader(nextState.receiptHeader);
    setReceiptFooter(nextState.receiptFooter);
  }, []);

  useEffect(() => {
    if (!initialData) return;
    applyConfig(initialData);
    setLoading(false);
  }, [applyConfig, initialData]);

  useEffect(() => {
    const bridge = getDesktopBridge();
    if (!bridge) return undefined;
    setDesktopAvailable(true);
    bridge.getState?.()
      .then((state) => {
        setPrintRunning(Boolean(state?.printRunning));
        setDesktopPrintState(state?.print || null);
      })
      .catch(() => undefined);
    bridge.listPrinters?.()
      .then((items) => {
        setPrinters(Array.isArray(items) ? items : []);
      })
      .catch(() => setPrinters([]));

    const unsubscribe = bridge.onPrintState?.((state) => {
      setDesktopPrintState(state);
      setPrintRunning(state.status === 'connecting' || state.status === 'ready' || state.status === 'error');
    });

    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, []);

  const loadConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
      }
      const controller = new AbortController();
      requestControllerRef.current = controller;
      timeout = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('/api/print/config', { cache: 'no-store', signal: controller.signal });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao carregar configuracao da impressora.');
        return;
      }
      applyConfig(json as PrintConfig);
    } catch (loadError) {
      if (loadError instanceof Error && loadError.name === 'AbortError') {
        setError('Tempo esgotado ao carregar impressora. Clique em atualizar.');
      } else {
        setError('Falha ao carregar configuracao da impressora.');
      }
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
      setLoading(false);
    }
  }, [applyConfig]);

  useEffect(() => {
    if (initialData) return undefined;
    void loadConfig();
    return () => {
      if (requestControllerRef.current) {
        requestControllerRef.current.abort();
        requestControllerRef.current = null;
      }
    };
  }, [initialData, loadConfig]);

  async function syncDesktopAfterSave(nextEnabled: boolean, nextPrinterName: string) {
    const bridge = getDesktopBridge();
    if (!bridge) return true;
    try {
      await bridge.syncSession?.();
      await bridge.updatePrinter?.({ printerName: nextPrinterName });
      if (nextEnabled) {
        await bridge.startPrint?.();
        setPrintRunning(true);
      } else {
        await bridge.stopPrint?.();
        setPrintRunning(false);
      }
      return true;
    } catch {
      return false;
    }
  }

  async function saveConfig(rotateKey = false, options?: SaveOptions) {
    setSaving(true);
    setError(null);
    if (!options?.quiet) setMessage(null);
    try {
      const response = await fetch('/api/print/config', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          enabled,
          printerName,
          receiptWidth,
          printCopies,
          printEvents,
          receiptOptions,
          receiptHeader,
          receiptFooter,
          rotateKey,
        }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao salvar configuracao.');
        return false;
      }

      const nextConfig: PrintConfig = {
        enabled: Boolean(json.enabled ?? enabled),
        hasAgentKey: Boolean(json.hasAgentKey ?? true),
        agentKey: String(json.agentKey || data?.agentKey || ''),
        printerName: String(json.printerName ?? printerName),
        receiptWidth: normalizeReceiptWidth(json.receiptWidth ?? receiptWidth),
        printCopies: normalizePrintCopies(json.printCopies ?? printCopies),
        printEvents: normalizePrintEvents(json.printEvents ?? printEvents),
        receiptOptions: normalizeReceiptOptions(json.receiptOptions ?? receiptOptions),
        receiptHeader: normalizeReceiptText(json.receiptHeader ?? receiptHeader),
        receiptFooter: normalizeReceiptText(json.receiptFooter ?? receiptFooter),
        lastSeenAt: json.lastSeenAt ?? data?.lastSeenAt ?? null,
      };

      applyConfig(nextConfig);
      const desktopSynced = await syncDesktopAfterSave(nextConfig.enabled, nextConfig.printerName);
      if (!options?.quiet) {
        setMessageTone(desktopSynced ? 'success' : 'warning');
        setMessage(rotateKey ? 'Nova chave gerada com sucesso.' : desktopSynced ? 'Configuracao salva e hub local atualizado.' : 'Configuracao salva. Abra o Faceburg App para aplicar no hub local.');
      }
      return true;
    } catch {
      setError('Falha ao salvar configuracao.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function copyAgentKey() {
    if (!data?.agentKey) return;
    try {
      await navigator.clipboard.writeText(data.agentKey);
      setMessageTone('success');
      setMessage('Chave copiada para a area de transferencia.');
    } catch {
      setError('Nao foi possivel copiar a chave.');
    }
  }

  async function startLocalPrint() {
    setDesktopBusy(true);
    setError(null);
    setMessage(null);
    try {
      const bridge = getDesktopBridge();
      if (!bridge) {
        setError('Faceburg App nao detectado neste navegador.');
        return;
      }
      await bridge.syncSession?.();
      await bridge.updatePrinter?.({ printerName });
      await bridge.startPrint?.();
      setPrintRunning(true);
      setMessageTone('success');
      setMessage('Hub de impressao iniciado neste computador.');
    } catch {
      setError('Nao foi possivel iniciar o hub de impressao.');
    } finally {
      setDesktopBusy(false);
    }
  }

  async function printTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveConfig(false, { quiet: true });
      if (!saved) return;
      const response = await fetch('/api/print/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ payloadText: previewText }),
      });
      const json = await response.json();
      if (!response.ok) {
        setError(json.error || 'Falha ao enviar teste de impressao.');
        return;
      }
      setMessageTone('success');
      setMessage('Teste enviado para a fila de impressao.');
    } catch {
      setError('Falha ao enviar teste de impressao.');
    } finally {
      setTesting(false);
    }
  }

  function toggleEvent(key: PrintEventKey) {
    setPrintEvents((current) => ({ ...current, [key]: !current[key] }));
  }

  function toggleReceiptOption(key: keyof ReceiptOptions) {
    setReceiptOptions((current) => ({ ...current, [key]: !current[key] }));
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 bg-slate-950 px-6 py-5 text-white">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-3">
            <div className="rounded-xl bg-white/10 p-3">
              <Printer className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-base font-bold">Impressao profissional</h3>
              <p className="mt-1 text-sm text-slate-300">Faceburg App controla impressora, recibo e fila local.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-bold ${statusClass}`}>
              {enabled && (agentFresh || printRunning) ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertCircle className="h-3.5 w-3.5" />}
              {statusLabel}
            </span>
            <button
              onClick={() => void loadConfig()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/10 bg-white/10 text-white transition hover:bg-white/15 disabled:opacity-50"
              type="button"
              disabled={loading}
              title="Atualizar configuracao"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="sr-only">Atualizar</span>
            </button>
          </div>
        </div>
      </div>

      {error ? <div className="border-b border-red-100 bg-red-50 px-6 py-3 text-sm font-medium text-red-600">{error}</div> : null}
      {message ? (
        <div className={`border-b px-6 py-3 text-sm font-medium ${messageTone === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-amber-100 bg-amber-50 text-amber-700'}`}>
          {message}
        </div>
      ) : null}

      {loading ? (
        <div className="px-6 py-8 text-sm text-slate-500">Carregando...</div>
      ) : (
        <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6 p-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Power className="h-4 w-4 text-emerald-600" />
                  Operacao
                </div>
                <label className="flex cursor-pointer items-center justify-between gap-4">
                  <span>
                    <span className="block text-sm font-semibold text-slate-800">Fila automatica</span>
                    <span className="block text-xs text-slate-500">Pedidos entram direto no hub local</span>
                  </span>
                  <input type="checkbox" className="sr-only" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
                  <span className={`relative h-6 w-11 rounded-full transition ${enabled ? 'bg-emerald-500' : 'bg-slate-200'}`}>
                    <span className={`absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow transition ${enabled ? 'translate-x-5' : ''}`} />
                  </span>
                </label>
                <div className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Ultimo heartbeat: <strong className="text-slate-800">{heartbeatLabel(data?.lastSeenAt)}</strong>
                </div>
                <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  Hub local: <strong className="text-slate-800">{desktopAvailable ? (printRunning ? 'rodando' : 'parado') : 'nao detectado'}</strong>
                  {desktopPrintState?.lastError ? <span className="mt-1 block text-red-500">{desktopPrintState.lastError}</span> : null}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Printer className="h-4 w-4 text-sky-600" />
                  Impressora
                </div>
                {printers.length ? (
                  <select
                    value={printerName}
                    onChange={(event) => setPrinterName(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                  >
                    <option value="">Padrao do Windows</option>
                    {printers.map((printer) => (
                      <option key={printer} value={printer}>
                        {printer}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={printerName}
                    onChange={(event) => setPrinterName(event.target.value)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                    placeholder="Nome da impressora"
                  />
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn-secondary" onClick={() => void startLocalPrint()} disabled={!desktopAvailable || desktopBusy}>
                    <Play className="h-4 w-4" />
                    {printRunning ? 'Reiniciar hub' : 'Iniciar hub'}
                  </button>
                  <button type="button" className="btn-secondary" onClick={() => void printTest()} disabled={testing || saving}>
                    <FileText className="h-4 w-4" />
                    {testing ? 'Enviando...' : 'Salvar e testar'}
                  </button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                <ListChecks className="h-4 w-4 text-emerald-600" />
                Quando imprimir
              </div>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {EVENT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => toggleEvent(option.key)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${printEvents[option.key] ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                  >
                    <span className="flex items-center justify-between gap-2 text-sm font-semibold text-slate-800">
                      {option.label}
                      <span className={`h-4 w-4 rounded border ${printEvents[option.key] ? 'border-emerald-500 bg-emerald-500' : 'border-slate-300 bg-white'}`} />
                    </span>
                    <span className="mt-1 block text-xs text-slate-500">{option.detail}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_0.9fr]">
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                  <Settings2 className="h-4 w-4 text-slate-600" />
                  Formato
                </div>
                <div className="space-y-4">
                  <div>
                    <p className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-500">Largura</p>
                    <div className="grid grid-cols-3 gap-2">
                      {PRINT_WIDTH_OPTIONS.map((width) => (
                        <button
                          key={width}
                          type="button"
                          onClick={() => setReceiptWidth(width)}
                          className={`rounded-lg border px-3 py-2 text-sm font-bold transition ${receiptWidth === width ? 'border-slate-950 bg-slate-950 text-white' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
                        >
                          {width} col.
                        </button>
                      ))}
                    </div>
                  </div>
                  <label className="block text-sm font-semibold text-slate-800">
                    Copias por job
                    <input
                      type="number"
                      min={1}
                      max={3}
                      value={printCopies}
                      onChange={(event) => setPrintCopies(normalizePrintCopies(event.target.value))}
                      className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-800">
                    Cabecalho personalizado
                    <textarea
                      value={receiptHeader}
                      onChange={(event) => setReceiptHeader(event.target.value)}
                      rows={2}
                      maxLength={320}
                      className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                      placeholder="Ex.: Obrigado pela preferencia"
                    />
                  </label>
                  <label className="block text-sm font-semibold text-slate-800">
                    Rodape personalizado
                    <textarea
                      value={receiptFooter}
                      onChange={(event) => setReceiptFooter(event.target.value)}
                      rows={2}
                      maxLength={320}
                      className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none transition focus:border-emerald-300 focus:ring-4 focus:ring-emerald-100"
                      placeholder="Ex.: Volte sempre"
                    />
                  </label>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center gap-2 text-sm font-bold text-slate-900">
                  <FileText className="h-4 w-4 text-slate-600" />
                  Conteudo
                </div>
                <div className="space-y-2">
                  {RECEIPT_OPTION_LABELS.map((option) => (
                    <label key={option.key} className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700">
                      {option.label}
                      <input
                        type="checkbox"
                        checked={receiptOptions[option.key]}
                        onChange={() => toggleReceiptOption(option.key)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600"
                      />
                    </label>
                  ))}
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                <KeyRound className="h-4 w-4 text-slate-600" />
                Chave do agente
              </div>
              <p className="rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-800 break-all">{data?.agentKey || 'Nao gerada'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => void saveConfig(true)} disabled={saving}>
                  <RefreshCw className="h-4 w-4" />
                  Gerar nova chave
                </button>
                <button type="button" className="btn-secondary" onClick={() => void copyAgentKey()} disabled={!data?.agentKey}>
                  <Copy className="h-4 w-4" />
                  Copiar
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-3">
              <button type="button" className="btn-primary" onClick={() => void saveConfig(false)} disabled={saving || testing}>
                <Save className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar configuracao'}
              </button>
            </div>
          </div>

          <aside className="border-t border-slate-200 bg-slate-50 p-6 lg:border-l lg:border-t-0">
            <div className="sticky top-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold text-slate-900">Previa do recibo</p>
                  <p className="text-xs text-slate-500">{receiptWidth} colunas</p>
                </div>
                <span className="rounded-full border border-slate-200 bg-white px-2.5 py-1 text-xs font-bold text-slate-600">{printCopies}x</span>
              </div>
              <pre className="max-h-[620px] overflow-auto rounded-xl bg-slate-950 p-4 font-mono text-[12px] leading-5 text-slate-100 shadow-inner" style={{ whiteSpace: 'pre' }}>{previewText}</pre>
            </div>
          </aside>
        </div>
      )}
    </section>
  );
}
