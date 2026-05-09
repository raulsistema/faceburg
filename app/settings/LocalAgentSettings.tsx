'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  MessageCircle,
  Power,
  Printer,
  RefreshCw,
  Save,
  Scissors,
  Server,
  Smartphone,
  TestTube2,
} from 'lucide-react';
import AppImage from '@/components/ui/AppImage';
import {
  DEFAULT_PRINT_EVENTS,
  DEFAULT_RECEIPT_OPTIONS,
  PRINT_PAPER_WIDTH_OPTIONS,
  MAX_PRINT_TEXT_SIZE,
  MIN_PRINT_TEXT_SIZE,
  PRINT_TEXT_SIZE_STEP,
  getEffectiveReceiptWidth,
  getPrintTextSizeProfile,
  getReceiptPaperWidthLabel,
  normalizeAutoAcceptOrders,
  normalizePrintCopies,
  normalizePrintEventsForAutomation,
  normalizePrintTextSize,
  normalizeReceiptOptions,
  normalizeReceiptText,
  normalizeReceiptWidth,
  type PrintEventKey,
  type PrintEvents,
  type PrintTextSize,
  type ReceiptOptions,
} from '@/lib/print-settings';

type PrintConfig = {
  enabled: boolean;
  hasAgentKey: boolean;
  agentKey: string;
  printerName: string;
  receiptWidth: number;
  printTextSize: PrintTextSize;
  printCopies: number;
  autoAcceptOrders: boolean;
  printEvents: PrintEvents;
  receiptOptions: ReceiptOptions;
  receiptHeader: string;
  receiptFooter: string;
  lastSeenAt: string | null;
};

type WhatsAppConfig = {
  enabled: boolean;
  hasAgentKey: boolean;
  agentKey: string;
  sessionStatus: string;
  qrCode: string;
  phoneNumber: string;
  lastSeenAt: string | null;
};

type LocalAgentConfig = {
  product?: string;
  port?: number;
  serverUrl?: string;
  tenantId?: string;
  tenantSlug?: string;
  terminalId?: string;
  printAgentKey?: string;
  whatsAppAgentKey?: string;
  realtimeGatewayPort?: number;
  realtimeGatewayPath?: string;
  defaultPrinter?: string;
  printEngine?: string;
  columns?: number;
  printTextSize?: string;
  codePage?: string;
  cutPaper?: boolean;
  pulseDrawer?: boolean;
  startWithWindows?: boolean;
  requireLocalToken?: boolean;
  localToken?: string;
  whatsAppEnabled?: boolean;
  whatsAppHeadless?: boolean;
  whatsAppChromePath?: string;
  allowedOrigins?: string[];
  updatedAt?: string;
};

type LocalAgentHealth = {
  online?: boolean;
  product?: string;
  version?: string;
  port?: number;
  tenantId?: string;
  tenantSlug?: string;
  terminalId?: string;
  printerName?: string;
  realtimeGatewayPort?: number;
  realtimeGatewayPath?: string;
  hasPrintAgentKey?: boolean;
  hasWhatsAppAgentKey?: boolean;
  startWithWindows?: boolean;
  startupRegistered?: boolean;
  configUpdatedAt?: string;
  whatsapp?: LocalWhatsAppStatus;
};

type LocalWhatsAppStatus = {
  status?: string;
  phoneNumber?: string;
  qrCode?: string;
  lastError?: string;
  updatedAt?: string;
};

type PrinterInfo = {
  name?: string;
  isDefault?: boolean;
  serverName?: string | null;
  attributes?: string | null;
};

type MessageTone = 'success' | 'warning';

type SaveOptions = {
  quiet?: boolean;
};

const LOCAL_AGENT_URL = 'http://127.0.0.1:9787';
const DEFAULT_CODE_PAGE = 'CP860';
const LOCAL_ORIGINS = [
  'https://faceburg.vercel.app',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:3002',
];

const EVENT_OPTIONS: Array<{ key: PrintEventKey; label: string; detail: string }> = [
  { key: 'new_order', label: 'Pedido novo', detail: 'Imprime assim que o pedido chega' },
  { key: 'status_processing', label: 'Iniciar preparo', detail: 'Imprime a via da cozinha' },
  { key: 'manual_receipt', label: 'Recibo manual', detail: 'Botao imprimir em pedidos' },
];

const RECEIPT_OPTION_LABELS: Array<{ key: keyof ReceiptOptions; label: string }> = [
  { key: 'showStoreInfo', label: 'Loja' },
  { key: 'showCustomerPhone', label: 'Telefone' },
  { key: 'showDeliveryAddress', label: 'Endereco' },
  { key: 'showPayment', label: 'Pagamento' },
  { key: 'showItemDescription', label: 'Descricao do produto' },
  { key: 'showItemNotes', label: 'Adicionais' },
  { key: 'showTotals', label: 'Totais' },
];

function currentServerUrl() {
  if (typeof window === 'undefined') return 'https://faceburg.vercel.app/';
  return `${window.location.origin.replace(/\/$/, '')}/`;
}

function ensureTrailingSlash(value: string) {
  const clean = String(value || '').trim();
  if (!clean) return currentServerUrl();
  return clean.endsWith('/') ? clean : `${clean}/`;
}

function mergeAllowedOrigins(value: unknown) {
  const currentOrigin = typeof window === 'undefined' ? '' : window.location.origin;
  const source = Array.isArray(value) ? value.map((item) => String(item || '').trim()) : [];
  return Array.from(new Set([...LOCAL_ORIGINS, currentOrigin, ...source].filter(Boolean)));
}

function normalizePrintState(data?: PrintConfig | null) {
  return {
    enabled: Boolean(data?.enabled),
    printerName: String(data?.printerName || ''),
    receiptWidth: normalizeReceiptWidth(data?.receiptWidth),
    printTextSize: normalizePrintTextSize(data?.printTextSize),
    printCopies: normalizePrintCopies(data?.printCopies),
    autoAcceptOrders: normalizeAutoAcceptOrders(data?.autoAcceptOrders),
    printEvents: normalizePrintEventsForAutomation(data?.printEvents || DEFAULT_PRINT_EVENTS, data?.autoAcceptOrders),
    receiptOptions: normalizeReceiptOptions(data?.receiptOptions || DEFAULT_RECEIPT_OPTIONS),
    receiptHeader: normalizeReceiptText(data?.receiptHeader),
    receiptFooter: normalizeReceiptText(data?.receiptFooter),
  };
}

function normalizePrinterList(value: unknown) {
  if (Array.isArray(value)) return value as PrinterInfo[];
  if (value && typeof value === 'object' && Array.isArray((value as { value?: unknown }).value)) {
    return (value as { value: PrinterInfo[] }).value;
  }
  return [];
}

async function localAgentJson<T>(path: string, options: RequestInit = {}, localToken = '', timeoutMs = 5000) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
  const headers = new Headers(options.headers);
  if (localToken) headers.set('x-faceburg-local-token', localToken);

  try {
    const response = await fetch(`${LOCAL_AGENT_URL}${path}`, {
      ...options,
      headers,
      cache: 'no-store',
      signal: controller.signal,
    });
    const data = (await response.json().catch(() => ({}))) as T & { error?: string; detail?: string; title?: string };
    if (!response.ok) {
      throw new Error(data.error || data.detail || data.title || `HTTP ${response.status}`);
    }
    return data as T;
  } finally {
    window.clearTimeout(timeoutId);
  }
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

function buildPreviewText(config: {
  receiptWidth: number;
  printTextSize: PrintTextSize;
  receiptOptions: ReceiptOptions;
  receiptHeader: string;
  receiptFooter: string;
  printCopies: number;
  cutPaper: boolean;
}) {
  const width = getEffectiveReceiptWidth(config.receiptWidth, config.printTextSize);
  const lines: string[] = [];
  const divider = '-'.repeat(width);
  const detailWidth = Math.max(8, width - 2);

  if (config.receiptHeader) {
    for (const line of wrapPreviewText(config.receiptHeader, width)) lines.push(centerPreviewLine(line, width));
    lines.push(divider);
  }

  lines.push(centerPreviewLine('DELIVERY', width));
  lines.push('');
  lines.push('Venda:TESTE-001');
  lines.push('Data: 06/05/2026 14:20');
  lines.push('Entrega Prevista: 15:00');
  lines.push('Cliente: Maria Souza');
  if (config.receiptOptions.showCustomerPhone) lines.push('Tel.: (11) 98222-3966');
  if (config.receiptOptions.showDeliveryAddress) {
    lines.push(...wrapPreviewText('End.: Rua das Palmeiras, 120 - Centro', width));
  }
  lines.push(divider);
  lines.push(centerPreviewLine('DOCUMENTO DE VENDA', width));
  lines.push(divider);
  lines.push('1un Face Burg Classico x R$ 29,90');
  if (config.receiptOptions.showItemDescription) {
    lines.push(...wrapPreviewText('Hamburguer artesanal, queijo, alface, tomate e molho da casa.', detailWidth).map((line) => `  ${line}`));
  }
  if (config.receiptOptions.showItemNotes) {
    lines.push('  + Bacon');
    lines.push('Obs.: sem cebola');
  }
  lines.push(divider);
  lines.push('1un Batata Cheddar x R$ 16,00');
  if (config.receiptOptions.showItemDescription) {
    lines.push(...wrapPreviewText('Batata crocante com cheddar cremoso e bacon.', detailWidth).map((line) => `  ${line}`));
  }
  lines.push(divider);
  if (config.receiptOptions.showTotals) {
    lines.push('Itens Comanda 2 Itens');
    lines.push('');
    lines.push('Sub Total: R$ 45,90');
    lines.push('Entrega: R$ 6,00');
    lines.push('Total: R$ 51,90');
  }
  if (config.receiptOptions.showPayment) {
    lines.push('');
    lines.push('Pagar na entrega (Pix)');
  }
  if (config.receiptOptions.showStoreInfo) {
    lines.push('');
    lines.push(centerPreviewLine('Face Burg', width));
  }
  if (config.receiptFooter) {
    lines.push('');
    for (const line of wrapPreviewText(config.receiptFooter, width)) lines.push(centerPreviewLine(line, width));
  }
  if (config.printCopies > 1) {
    lines.push('');
    lines.push(centerPreviewLine(`VIA 1/${config.printCopies}`, width));
  }
  if (config.cutPaper) {
    lines.push('');
    lines.push(centerPreviewLine('[ corte automatico ]', width));
  }

  return lines.filter((line, index, source) => line || (index > 0 && source[index - 1] !== '')).join('\n');
}

function statusLabel(status?: string) {
  if (status === 'ready') return 'Conectado';
  if (status === 'qr') return 'Aguardando QR';
  if (status === 'connecting') return 'Conectando';
  if (status === 'auth_failure') return 'Falha no login';
  return 'Desconectado';
}

function formatDateTime(value?: string | null) {
  if (!value) return 'nunca';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'nunca';
  return date.toLocaleString('pt-BR');
}

export default function LocalAgentSettings({
  tenantId,
  tenantSlug,
  initialPrintData,
  initialWhatsAppData,
}: {
  tenantId?: string;
  tenantSlug?: string;
  initialPrintData?: PrintConfig | null;
  initialWhatsAppData?: WhatsAppConfig | null;
}) {
  const initialPrint = normalizePrintState(initialPrintData);
  const [printEnabled, setPrintEnabled] = useState(initialPrintData ? initialPrint.enabled : true);
  const [whatsappEnabled, setWhatsAppEnabled] = useState(Boolean(initialWhatsAppData?.enabled));
  const [printerName, setPrinterName] = useState(initialPrint.printerName);
  const [receiptWidth, setReceiptWidth] = useState(initialPrint.receiptWidth);
  const [printTextSize, setPrintTextSize] = useState(initialPrint.printTextSize);
  const [printCopies, setPrintCopies] = useState(initialPrint.printCopies);
  const [autoAcceptOrders, setAutoAcceptOrders] = useState(initialPrint.autoAcceptOrders);
  const [printEvents, setPrintEvents] = useState<PrintEvents>({
    ...initialPrint.printEvents,
    status_delivering: false,
    status_completed: false,
    status_cancelled: false,
  });
  const [receiptOptions, setReceiptOptions] = useState<ReceiptOptions>(initialPrint.receiptOptions);
  const [receiptHeader, setReceiptHeader] = useState(initialPrint.receiptHeader);
  const [receiptFooter, setReceiptFooter] = useState(initialPrint.receiptFooter);
  const [serverUrl, setServerUrl] = useState('https://faceburg.vercel.app/');
  const [terminalId, setTerminalId] = useState('ATENDIMENTO');
  const [codePage, setCodePage] = useState(DEFAULT_CODE_PAGE);
  const [cutPaper, setCutPaper] = useState(true);
  const [pulseDrawer, setPulseDrawer] = useState(false);
  const [startWithWindows, setStartWithWindows] = useState(true);
  const [whatsappHeadless, setWhatsappHeadless] = useState(true);
  const [agentConfig, setAgentConfig] = useState<LocalAgentConfig | null>(null);
  const [agentHealth, setAgentHealth] = useState<LocalAgentHealth | null>(null);
  const [whatsappStatus, setWhatsappStatus] = useState<LocalWhatsAppStatus | null>(null);
  const [printers, setPrinters] = useState<PrinterInfo[]>([]);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [loadingAgent, setLoadingAgent] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [whatsappBusy, setWhatsappBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<MessageTone>('success');
  const printAgentKeyRef = useRef(initialPrintData?.agentKey || '');
  const whatsappAgentKeyRef = useRef(initialWhatsAppData?.agentKey || '');

  const agentOnline = Boolean(agentHealth?.online);
  const whatsappConnected = String(whatsappStatus?.status || agentHealth?.whatsapp?.status || '') === 'ready';
  const selectedPrinter = printerName;
  const displayPrinter = selectedPrinter || agentHealth?.printerName || agentConfig?.defaultPrinter || '';
  const selectedWhatsAppStatus = whatsappStatus || agentHealth?.whatsapp || null;
  const printTextProfile = getPrintTextSizeProfile(printTextSize);
  const selectedPaperWidthLabel = getReceiptPaperWidthLabel(receiptWidth);
  const printTextNumericSize = Number(printTextProfile.value);
  const previewTextClass = printTextNumericSize >= 18
    ? 'text-[15px] leading-8'
    : 'text-[12px] leading-relaxed';

  const previewText = useMemo(
    () =>
      buildPreviewText({
        receiptWidth,
        printTextSize,
        receiptOptions,
        receiptHeader,
        receiptFooter,
        printCopies,
        cutPaper,
      }),
    [cutPaper, printCopies, printTextSize, receiptFooter, receiptHeader, receiptOptions, receiptWidth],
  );

  useEffect(() => {
    setServerUrl(currentServerUrl());
  }, []);

  useEffect(() => {
    if (!initialPrintData) return;
    printAgentKeyRef.current = initialPrintData.agentKey || printAgentKeyRef.current;
    const next = normalizePrintState(initialPrintData);
    setPrintEnabled(next.enabled);
    setPrinterName((current) => current || next.printerName);
    setReceiptWidth(next.receiptWidth);
    setPrintTextSize(next.printTextSize);
    setPrintCopies(next.printCopies);
    setAutoAcceptOrders(next.autoAcceptOrders);
    setPrintEvents({
      ...next.printEvents,
      status_delivering: false,
      status_completed: false,
      status_cancelled: false,
    });
    setReceiptOptions(next.receiptOptions);
    setReceiptHeader(next.receiptHeader);
    setReceiptFooter(next.receiptFooter);
  }, [initialPrintData]);

  useEffect(() => {
    if (!initialWhatsAppData) return;
    whatsappAgentKeyRef.current = initialWhatsAppData.agentKey || whatsappAgentKeyRef.current;
    setWhatsAppEnabled(Boolean(initialWhatsAppData.enabled));
  }, [initialWhatsAppData]);

  const applyAgentConfig = useCallback((config: LocalAgentConfig) => {
    setAgentConfig(config);
    setServerUrl(ensureTrailingSlash(String(config.serverUrl || currentServerUrl())));
    setTerminalId(String(config.terminalId || 'ATENDIMENTO'));
    if (!printAgentKeyRef.current) {
      setPrinterName(String(config.defaultPrinter || ''));
      setReceiptWidth(normalizeReceiptWidth(config.columns));
      setPrintTextSize(normalizePrintTextSize(config.printTextSize));
    }
    setCodePage(String(config.codePage || DEFAULT_CODE_PAGE));
    setCutPaper(config.cutPaper !== false);
    setPulseDrawer(Boolean(config.pulseDrawer));
    setStartWithWindows(config.startWithWindows !== false);
    setWhatsAppEnabled(Boolean(config.whatsAppEnabled));
    setWhatsappHeadless(config.whatsAppHeadless !== false);
  }, []);

  const refreshAgent = useCallback(async () => {
    setLoadingAgent(true);
    setError(null);
    try {
      const [healthResult, configResult, printersResult, whatsappResult] = await Promise.allSettled([
        localAgentJson<LocalAgentHealth>('/api/health', {}, '', 3500),
        localAgentJson<LocalAgentConfig>('/api/config', {}, agentConfig?.localToken || '', 3500),
        localAgentJson<unknown>('/api/printers', {}, agentConfig?.localToken || '', 6000),
        localAgentJson<LocalWhatsAppStatus>('/api/whatsapp/status', {}, '', 3500),
      ]);

      if (healthResult.status === 'fulfilled') setAgentHealth(healthResult.value);
      if (configResult.status === 'fulfilled') applyAgentConfig(configResult.value);
      if (printersResult.status === 'fulfilled') setPrinters(normalizePrinterList(printersResult.value));
      if (whatsappResult.status === 'fulfilled') setWhatsappStatus(whatsappResult.value);

      if (healthResult.status === 'rejected' && configResult.status === 'rejected') {
        setAgentHealth(null);
        setMessageTone('warning');
        setMessage('Agente local nao encontrado em 127.0.0.1:9787.');
      }
    } catch {
      setAgentHealth(null);
      setMessageTone('warning');
      setMessage('Agente local nao encontrado em 127.0.0.1:9787.');
    } finally {
      setLoadingAgent(false);
    }
  }, [agentConfig?.localToken, applyAgentConfig]);

  useEffect(() => {
    void refreshAgent();
  }, [refreshAgent]);

  useEffect(() => {
    let active = true;
    async function buildQr() {
      const qrCode = selectedWhatsAppStatus?.qrCode || '';
      if (!qrCode || selectedWhatsAppStatus?.status !== 'qr') {
        setQrDataUrl('');
        return;
      }
      try {
        const qrModule = await import('qrcode');
        const dataUrl = await qrModule.toDataURL(qrCode, {
          errorCorrectionLevel: 'M',
          margin: 1,
          width: 220,
        });
        if (active) setQrDataUrl(dataUrl);
      } catch {
        if (active) setQrDataUrl('');
      }
    }
    void buildQr();
    return () => {
      active = false;
    };
  }, [selectedWhatsAppStatus?.qrCode, selectedWhatsAppStatus?.status]);

  function buildPrintEvents() {
    const events = {
      ...printEvents,
      status_delivering: false,
      status_completed: false,
      status_cancelled: false,
    };
    if (autoAcceptOrders) {
      events.new_order = true;
      events.status_processing = true;
    }
    return events;
  }

  function updateAutoAcceptOrders(next: boolean) {
    setAutoAcceptOrders(next);
    if (next) {
      setPrintEvents((current) => ({
        ...current,
        new_order: true,
        status_processing: true,
      }));
    }
  }

  function buildLocalAgentPayload(override?: Partial<LocalAgentConfig>): LocalAgentConfig {
    return {
      ...agentConfig,
      product: agentConfig?.product || 'Faceburg Local Agent',
      port: Number(agentConfig?.port || 9787),
      serverUrl: ensureTrailingSlash(serverUrl),
      tenantId: tenantId || agentConfig?.tenantId || '',
      tenantSlug: tenantSlug || agentConfig?.tenantSlug || '',
      terminalId: terminalId.trim() || 'ATENDIMENTO',
      printAgentKey: printAgentKeyRef.current || agentConfig?.printAgentKey || '',
      whatsAppAgentKey: whatsappAgentKeyRef.current || agentConfig?.whatsAppAgentKey || '',
      realtimeGatewayPort: Number(agentConfig?.realtimeGatewayPort || 3001),
      realtimeGatewayPath: agentConfig?.realtimeGatewayPath || '/ws/agents',
      defaultPrinter: selectedPrinter.trim(),
      printEngine: agentConfig?.printEngine || 'windows-driver-visual',
      columns: normalizeReceiptWidth(receiptWidth),
      printTextSize,
      codePage: codePage || DEFAULT_CODE_PAGE,
      cutPaper,
      pulseDrawer,
      startWithWindows,
      requireLocalToken: Boolean(agentConfig?.requireLocalToken),
      localToken: agentConfig?.localToken || '',
      whatsAppEnabled: whatsappEnabled,
      whatsAppHeadless: whatsappHeadless,
      whatsAppChromePath: agentConfig?.whatsAppChromePath || '',
      allowedOrigins: mergeAllowedOrigins(agentConfig?.allowedOrigins),
      ...override,
    };
  }

  async function saveServerPrintConfig(nextPrintEvents = buildPrintEvents()) {
    const response = await fetch('/api/print/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        enabled: printEnabled,
        printerName: selectedPrinter,
        receiptWidth,
        printTextSize,
        printCopies,
        autoAcceptOrders,
        printEvents: nextPrintEvents,
        receiptOptions,
        receiptHeader,
        receiptFooter,
      }),
    });
    const json = (await response.json().catch(() => ({}))) as Partial<PrintConfig> & { error?: string };
    if (!response.ok) throw new Error(json.error || 'Falha ao salvar impressao.');
    if (json.agentKey) printAgentKeyRef.current = json.agentKey;
    const savedAutoAcceptOrders = normalizeAutoAcceptOrders(json.autoAcceptOrders ?? autoAcceptOrders);
    setAutoAcceptOrders(savedAutoAcceptOrders);
    setPrintEvents(normalizePrintEventsForAutomation(json.printEvents || nextPrintEvents, savedAutoAcceptOrders));
    setPrinterName(String(json.printerName ?? selectedPrinter));
    setReceiptWidth(normalizeReceiptWidth(json.receiptWidth ?? receiptWidth));
    setPrintTextSize(normalizePrintTextSize(json.printTextSize ?? printTextSize));
    setPrintCopies(normalizePrintCopies(json.printCopies ?? printCopies));
    setReceiptOptions(normalizeReceiptOptions(json.receiptOptions ?? receiptOptions));
    setReceiptHeader(normalizeReceiptText(json.receiptHeader ?? receiptHeader));
    setReceiptFooter(normalizeReceiptText(json.receiptFooter ?? receiptFooter));
  }

  async function saveServerWhatsAppConfig(nextEnabled = whatsappEnabled) {
    const response = await fetch('/api/whatsapp/config', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: nextEnabled }),
    });
    const json = (await response.json().catch(() => ({}))) as Partial<WhatsAppConfig> & { error?: string };
    if (!response.ok) throw new Error(json.error || 'Falha ao salvar WhatsApp.');
    if (json.agentKey) whatsappAgentKeyRef.current = json.agentKey;
    if (typeof json.enabled === 'boolean') setWhatsAppEnabled(json.enabled);
  }

  async function saveLocalAgentConfig(override?: Partial<LocalAgentConfig>) {
    const payload = buildLocalAgentPayload(override);
    const saved = await localAgentJson<LocalAgentConfig>(
      '/api/config',
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      agentConfig?.localToken || payload.localToken || '',
      8000,
    );
    applyAgentConfig(saved);
    return saved;
  }

  async function saveAll(options?: SaveOptions) {
    setSaving(true);
    setError(null);
    if (!options?.quiet) setMessage(null);
    try {
      const nextPrintEvents = buildPrintEvents();
      await Promise.all([
        saveServerPrintConfig(nextPrintEvents),
        saveServerWhatsAppConfig(whatsappEnabled),
      ]);

      let localSynced = false;
      try {
        await saveLocalAgentConfig({
          whatsAppEnabled: whatsappEnabled,
        });
        localSynced = true;
      } catch {
        // A configuracao do servidor continua salva mesmo se o agente local estiver fechado.
      }

      await refreshAgent();
      if (!options?.quiet) {
        setMessageTone(localSynced ? 'success' : 'warning');
        setMessage(
          localSynced
            ? 'Configuracao salva no sistema e aplicada no agente local.'
            : 'Automacao salva no sistema. O agente local nao respondeu para aplicar impressora/WhatsApp.',
        );
      }
      return localSynced;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Falha ao salvar configuracao.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function printTest() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const saved = await saveLocalAgentConfig();
      await localAgentJson(
        '/api/print/test',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
        },
        saved.localToken || agentConfig?.localToken || '',
        35000,
      );
      setMessageTone('success');
      setMessage('Teste enviado para a impressora pelo agente local.');
      await refreshAgent();
    } catch (testError) {
      setError(testError instanceof Error ? testError.message : 'Falha no teste de impressao.');
    } finally {
      setTesting(false);
    }
  }

  async function controlWhatsApp(nextEnabled: boolean) {
    setWhatsappBusy(true);
    setError(null);
    setMessage(null);
    try {
      setWhatsAppEnabled(nextEnabled);
      await saveServerWhatsAppConfig(nextEnabled);
      const saved = await saveLocalAgentConfig({ whatsAppEnabled: nextEnabled });
      const path = nextEnabled ? '/api/whatsapp/start' : '/api/whatsapp/stop';
      const response = await localAgentJson<{ ok?: boolean; status?: LocalWhatsAppStatus }>(
        path,
        { method: 'POST', headers: { 'content-type': 'application/json' } },
        saved.localToken || agentConfig?.localToken || '',
        15000,
      );
      if (response.status) setWhatsappStatus(response.status);
      setMessageTone('success');
      setMessage(nextEnabled ? 'WhatsApp iniciado no agente local.' : 'WhatsApp parado no agente local.');
      await refreshAgent();
    } catch (controlError) {
      setError(controlError instanceof Error ? controlError.message : 'Falha ao controlar WhatsApp.');
    } finally {
      setWhatsappBusy(false);
    }
  }

  function toggleEvent(key: PrintEventKey) {
    setPrintEvents((current) => ({
      ...current,
      [key]: !current[key],
      status_delivering: false,
      status_completed: false,
      status_cancelled: false,
    }));
  }

  function toggleReceiptOption(key: keyof ReceiptOptions) {
    setReceiptOptions((current) => ({
      ...current,
      [key]: !current[key],
    }));
  }

  return (
    <section className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
      <div className="bg-slate-950 text-white px-6 py-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-cyan-200">Agente local oficial</p>
            <h3 className="mt-2 text-2xl font-bold">Faceburg Local Agent .NET</h3>
            <p className="mt-1 max-w-2xl text-sm text-slate-300">
              Impressao visual pelo driver do Windows e WhatsApp rodam neste computador em tempo real, direto no agente local.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${agentOnline ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-amber-300/60 bg-amber-300/10 text-amber-100'}`}>
              {agentOnline ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
              {agentOnline ? 'Online' : 'Offline'}
            </span>
            <span className="inline-flex items-center gap-2 rounded-full border border-slate-500/70 bg-white/5 px-3 py-1 text-xs font-semibold text-slate-100">
              <Printer className="h-4 w-4" />
              {displayPrinter || 'Sem impressora'}
            </span>
            <span className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${whatsappConnected ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200' : 'border-slate-500/70 bg-white/5 text-slate-100'}`}>
              <MessageCircle className="h-4 w-4" />
              WhatsApp {statusLabel(selectedWhatsAppStatus?.status).toLowerCase()}
            </span>
          </div>
        </div>
      </div>

      <div className="space-y-5 p-6">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="text-sm text-slate-600">
            <p>
              Endpoint local: <strong className="font-mono text-slate-900">{LOCAL_AGENT_URL}</strong>
            </p>
            <p>
              Ultima config: <strong className="text-slate-900">{formatDateTime(agentHealth?.configUpdatedAt || agentConfig?.updatedAt)}</strong>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-secondary" onClick={() => void refreshAgent()} disabled={loadingAgent}>
              <RefreshCw className={`h-4 w-4 ${loadingAgent ? 'animate-spin' : ''}`} />
              Atualizar
            </button>
            <a className="btn-secondary" href={LOCAL_AGENT_URL} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Painel local
            </a>
            <button type="button" className="btn-primary" onClick={() => void saveAll()} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Salvando...' : 'Salvar tudo'}
            </button>
          </div>
        </div>

        {error ? (
          <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
        ) : null}
        {message ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${messageTone === 'warning' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
            {message}
          </div>
        ) : null}

        <div className="grid gap-4 xl:grid-cols-[1.05fr_1fr]">
          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-4 flex items-start gap-3">
                <Server className="mt-0.5 h-5 w-5 text-cyan-600" />
                <div>
                  <h4 className="font-bold text-slate-900">Conexao do agente</h4>
                  <p className="text-sm text-slate-500">Define de qual sistema este computador recebe pedidos e qual terminal esta atendendo.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="md:col-span-2 text-sm font-semibold text-slate-700">
                  URL do sistema
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                    value={serverUrl}
                    onChange={(event) => setServerUrl(event.target.value)}
                    placeholder="https://faceburg.vercel.app/"
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Tenant
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600"
                    value={tenantSlug || agentConfig?.tenantSlug || ''}
                    readOnly
                  />
                </label>
                <label className="text-sm font-semibold text-slate-700">
                  Terminal
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                    value={terminalId}
                    onChange={(event) => setTerminalId(event.target.value)}
                    placeholder="ATENDIMENTO"
                  />
                </label>
                <label className="md:col-span-2 flex items-start justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                  <span>
                    <span className="block">Iniciar agente com o Windows</span>
                    <span className="block text-xs font-normal text-slate-500">
                      Abre o agente em segundo plano quando este computador ligar.
                      {agentHealth?.startupRegistered ? ' Registrado neste Windows.' : ''}
                    </span>
                  </span>
                  <input type="checkbox" checked={startWithWindows} onChange={(event) => setStartWithWindows(event.target.checked)} />
                </label>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-4 flex items-start gap-3">
                <Printer className="mt-0.5 h-5 w-5 text-orange-600" />
                <div>
                  <h4 className="font-bold text-slate-900">Impressora termica</h4>
                  <p className="text-sm text-slate-500">Driver visual do Windows, com fonte suave, corte e largura salvos no agente local.</p>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <label className="md:col-span-2 text-sm font-semibold text-slate-700">
                  Impressora
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    value={selectedPrinter}
                    onChange={(event) => setPrinterName(event.target.value)}
                  >
                    <option value="">Usar padrao do Windows</option>
                    {printers.map((printer) => (
                      <option key={printer.name || 'printer'} value={printer.name || ''}>
                        {printer.name} {printer.isDefault ? '(padrao)' : ''}
                      </option>
                    ))}
                    {selectedPrinter && !printers.some((printer) => printer.name === selectedPrinter) ? (
                      <option value={selectedPrinter}>{selectedPrinter}</option>
                    ) : null}
                  </select>
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Papel da impressora
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    value={receiptWidth}
                    onChange={(event) => setReceiptWidth(normalizeReceiptWidth(event.target.value))}
                  >
                    {PRINT_PAPER_WIDTH_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label} - {option.detail}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  <span className="flex items-center justify-between gap-3">
                    <span>Tamanho da letra</span>
                    <span className="font-mono text-slate-900">{printTextSize}</span>
                  </span>
                  <input
                    className="mt-2 w-full accent-orange-600"
                    type="range"
                    min={MIN_PRINT_TEXT_SIZE}
                    max={MAX_PRINT_TEXT_SIZE}
                    step={PRINT_TEXT_SIZE_STEP}
                    value={printTextSize}
                    onChange={(event) => setPrintTextSize(normalizePrintTextSize(event.target.value))}
                  />
                  <input
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    type="number"
                    min={MIN_PRINT_TEXT_SIZE}
                    max={MAX_PRINT_TEXT_SIZE}
                    step={PRINT_TEXT_SIZE_STEP}
                    value={printTextSize}
                    onChange={(event) => setPrintTextSize(normalizePrintTextSize(event.target.value))}
                  />
                  <span className="mt-1 block text-xs font-normal text-slate-500">
                    {printTextProfile.detail} O valor salvo aqui vai junto em cada job de impressao.
                  </span>
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Code page
                  <select
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    value={codePage}
                    onChange={(event) => setCodePage(event.target.value)}
                  >
                    <option value="CP860">CP860 - Portugues</option>
                    <option value="CP850">CP850 - Latino</option>
                    <option value="CP437">CP437 - Padrao</option>
                  </select>
                </label>

                <label className="text-sm font-semibold text-slate-700">
                  Copias
                  <input
                    className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-orange-500"
                    type="number"
                    min={1}
                    max={3}
                    value={printCopies}
                    onChange={(event) => setPrintCopies(normalizePrintCopies(event.target.value))}
                  />
                </label>

                <div className="grid gap-2">
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={cutPaper} onChange={(event) => setCutPaper(event.target.checked)} />
                    <Scissors className="h-4 w-4 text-slate-500" />
                    Cortar papel
                  </label>
                  <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                    <input type="checkbox" checked={pulseDrawer} onChange={(event) => setPulseDrawer(event.target.checked)} />
                    Acionar gaveta
                  </label>
                </div>
              </div>

              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => void printTest()} disabled={testing || !agentOnline}>
                  <TestTube2 className="h-4 w-4" />
                  {testing ? 'Enviando...' : 'Teste de impressao'}
                </button>
                {!agentOnline ? <span className="self-center text-xs text-amber-700">Abra o agente local para testar.</span> : null}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-4 flex items-start gap-3">
                <Power className="mt-0.5 h-5 w-5 text-emerald-600" />
                <div>
                  <h4 className="font-bold text-slate-900">Automacoes</h4>
                  <p className="text-sm text-slate-500">Por padrao nao imprime ao sair para entrega; so chegada e inicio de preparo.</p>
                </div>
              </div>

              <label className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                <span>Impressao automatica</span>
                <input type="checkbox" checked={printEnabled} onChange={(event) => setPrintEnabled(event.target.checked)} />
              </label>

              <label className="mb-3 flex items-center justify-between gap-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-semibold text-slate-800">
                <span>
                  <span className="block">Aceitar pedido automaticamente</span>
                  <span className="block text-xs font-medium text-emerald-700">Entra em Cozinha e imprime pedido + via cozinha</span>
                </span>
                <input type="checkbox" checked={autoAcceptOrders} onChange={(event) => updateAutoAcceptOrders(event.target.checked)} />
              </label>

              <div className="space-y-2">
                {EVENT_OPTIONS.map((item) => (
                  <label key={item.key} className="flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2">
                    <span>
                      <span className="block text-sm font-semibold text-slate-800">{item.label}</span>
                      <span className="block text-xs text-slate-500">{item.detail}</span>
                    </span>
                    <input
                      type="checkbox"
                      checked={Boolean(printEvents[item.key])}
                      disabled={autoAcceptOrders && (item.key === 'new_order' || item.key === 'status_processing')}
                      onChange={() => toggleEvent(item.key)}
                    />
                  </label>
                ))}
              </div>

              <label className="mt-3 flex items-center justify-between gap-4 rounded-lg border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800">
                <span>WhatsApp automatico</span>
                <input type="checkbox" checked={whatsappEnabled} onChange={(event) => setWhatsAppEnabled(event.target.checked)} />
              </label>
            </div>

            <div className="rounded-lg border border-slate-200 p-4">
              <div className="mb-4 flex items-start gap-3">
                <Smartphone className="mt-0.5 h-5 w-5 text-green-600" />
                <div>
                  <h4 className="font-bold text-slate-900">WhatsApp local</h4>
                  <p className="text-sm text-slate-500">
                    Sessao: <strong>{statusLabel(selectedWhatsAppStatus?.status)}</strong>
                    {selectedWhatsAppStatus?.phoneNumber ? ` - ${selectedWhatsAppStatus.phoneNumber}` : ''}
                  </p>
                </div>
              </div>

              <label className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
                <input type="checkbox" checked={whatsappHeadless} onChange={(event) => setWhatsappHeadless(event.target.checked)} />
                Rodar navegador do WhatsApp oculto
              </label>

              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn-secondary" onClick={() => void controlWhatsApp(true)} disabled={whatsappBusy || !agentOnline}>
                  <MessageCircle className="h-4 w-4" />
                  {whatsappBusy ? 'Aguarde...' : 'Iniciar WhatsApp'}
                </button>
                <button type="button" className="btn-secondary" onClick={() => void controlWhatsApp(false)} disabled={whatsappBusy || !agentOnline}>
                  <Power className="h-4 w-4" />
                  Parar
                </button>
              </div>

              {qrDataUrl ? (
                <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                  <p className="mb-2 text-sm font-semibold text-emerald-700">Escaneie no WhatsApp da empresa</p>
                  <AppImage src={qrDataUrl} alt="QR Code WhatsApp" width={220} height={220} className="h-[220px] w-[220px] rounded-lg border border-emerald-200 bg-white p-2" />
                </div>
              ) : null}

              {selectedWhatsAppStatus?.lastError ? (
                <p className="mt-3 text-sm text-red-600">{selectedWhatsAppStatus.lastError}</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
          <div className="rounded-lg border border-slate-200 p-4">
            <h4 className="font-bold text-slate-900">Campos do recibo</h4>
            <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {RECEIPT_OPTION_LABELS.map((item) => (
                <label key={item.key} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700">
                  <input type="checkbox" checked={Boolean(receiptOptions[item.key])} onChange={() => toggleReceiptOption(item.key)} />
                  {item.label}
                </label>
              ))}
            </div>
            <label className="mt-3 block text-sm font-semibold text-slate-700">
              Cabecalho
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                value={receiptHeader}
                onChange={(event) => setReceiptHeader(normalizeReceiptText(event.target.value))}
                placeholder="Texto opcional no topo da comanda"
              />
            </label>
            <label className="mt-3 block text-sm font-semibold text-slate-700">
              Rodape
              <textarea
                className="mt-1 min-h-20 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-cyan-500"
                value={receiptFooter}
                onChange={(event) => setReceiptFooter(normalizeReceiptText(event.target.value))}
                placeholder="Obrigado pela preferencia"
              />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-950 p-4 text-slate-100">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h4 className="font-bold">Previa termica</h4>
              <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">
                {selectedPaperWidthLabel} · fonte {printTextProfile.label}
              </span>
            </div>
            <pre className={`max-h-[440px] overflow-auto whitespace-pre-wrap rounded-lg bg-black p-4 font-mono text-green-100 ${previewTextClass}`}>
              {previewText}
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}
