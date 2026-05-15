/* eslint-disable no-console */
/* WhatsApp Worker — forked from Faceburg Hub main process
 * Connects to Realtime Gateway using direct-v1 protocol.
 * Jobs are pushed by the gateway — no polling required. */
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const WebSocket = require('ws');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { processMessage } = require('./nlp-manager');

const SERVER_URL = String(process.env.HUB_SERVER_URL || process.env.WHATS_SERVER_URL || 'https://faceburg.vercel.app').replace(/\/$/, '');
const AGENT_KEY = String(process.env.HUB_AGENT_KEY || process.env.WHATS_AGENT_KEY || '');
const SLUG = String(process.env.HUB_SLUG || process.env.WHATS_SLUG || '').trim().toLowerCase();
const ENABLE_REALTIME = ['1', 'true', 'yes', 'y', 'on'].includes(
  String(process.env.HUB_ENABLE_REALTIME || process.env.WHATS_ENABLE_REALTIME || '').trim().toLowerCase(),
);

const INIT_TIMEOUT_MS = 120000;
const RESTART_DELAY_MS = 5000;
const WATCHDOG_INTERVAL_MS = 30000;
const TAKEOVER_TIMEOUT_MS = Number(process.env.HUB_WHATS_TAKEOVER_TIMEOUT_MS || process.env.WHATS_TAKEOVER_TIMEOUT_MS || 0);
const LOCK_PORT = Number(process.env.WHATS_AGENT_LOCK_PORT || 49331);
const WHATS_WEB_URL = 'https://web.whatsapp.com';
const DIRECT_PROTOCOL = 'direct-v1';

let ready = false;
let client = null;
let restartTimer = null;
let startingClient = false;
let shuttingDown = false;
let lastQrAt = 0;
let lastErrorMessage = '';
let lockServer = null;
let watchdogTimer = null;
let lastAuthenticatedLogAt = 0;
let lastStateLabel = '';

/* ─── IPC to main ────────────────────────────────────────────────── */

function sendState(data) {
  if (process.send) process.send({ type: 'state', data });
}

function sendLog(text) {
  if (process.send) process.send({ type: 'log', text });
}

function updateState(patch = {}) {
  sendState({
    realtimeConnected: false, // Legacy format
    ...patch,
  });
}

function sendWsAgentState() {
  // Cloud websocket bridge is disabled in this build; state is synced by the hub.
}

async function acquireSingleInstanceLock() {
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', (error) => reject(error));
    server.listen(LOCK_PORT, '127.0.0.1', () => {
      lockServer = server;
      resolve(null);
    });
  }).catch((error) => {
    if (error && typeof error === 'object' && error.code === 'EADDRINUSE') {
      throw new Error(`Ja existe outro agente WhatsApp em execucao (porta ${LOCK_PORT}).`);
    }
    throw error;
  });
}

/* ─── helpers ────────────────────────────────────────────────────── */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function normalizeTarget(target) {
  if (!target) return '';
  if (target.endsWith('@c.us')) return target;
  const digits = String(target).replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? `${digits}@c.us` : `55${digits}@c.us`;
}

function getMenuLink() {
  if (!SLUG) return `${SERVER_URL}/cardapio`;
  return `${SERVER_URL}/cardapio/${encodeURIComponent(SLUG)}`;
}

function personalizeAutoReply(text) {
  return String(text || '').replace(/@LINK/g, getMenuLink());
}

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p; }

function getRuntimeDir() {
  const la = String(process.env.LOCALAPPDATA || '').trim();
  if (la) return ensureDir(path.join(la, 'Faceburg', 'whatsapp-agent'));
  return ensureDir(path.join(os.homedir(), '.faceburg', 'whatsapp-agent'));
}

const AUTH_PATH = ensureDir(path.join(getRuntimeDir(), 'auth'));

function getClientId() { return SLUG || `tenant-${AGENT_KEY.slice(3, 11)}`; }

function getBrowserPath() {
  const configuredPath = String(
    process.env.HUB_WHATS_CHROME_PATH
    || process.env.WHATS_CHROME_PATH
    || process.env.PUPPETEER_EXECUTABLE_PATH
    || '',
  ).trim();
  if (configuredPath && fs.existsSync(configuredPath)) return configuredPath;

  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  for (const c of candidates) { if (fs.existsSync(c)) return c; }
  return '';
}



function getCurrentPhoneNumber() {
  return String(client?.info?.wid?.user || '');
}

function sendLocalResponse(requestId, ok, dataOrError) {
  if (!process.send || !requestId) return;
  if (ok) {
    process.send({ type: 'local-response', requestId, ok: true, data: dataOrError || {} });
    return;
  }
  process.send({ type: 'local-response', requestId, ok: false, error: String(dataOrError?.message || dataOrError || 'Falha no agente local.') });
}

/* ─── send whatsapp message ──────────────────────────────────────── */

async function sendDirectWhatsappMessage(job) {
  if (!ready || !client) throw new Error('WhatsApp nao esta conectado neste computador.');
  const target = normalizeTarget(String(job?.targetPhone || ''));
  if (!target) throw new Error('Numero invalido.');
  const payloadText = String(job?.payloadText || '');
  if (!payloadText.trim()) throw new Error('Mensagem vazia.');
  await client.sendMessage(target, payloadText);
  sendLog(`Mensagem enviada para ${target}${job?.id ? ` (job ${job.id})` : ''}.`);
  return { targetPhone: target, local: true };
}

function isVisibleWhatsAppMode() {
  return true;
}

function buildPuppeteerArgs() {
  const args = [
    '--disable-accelerated-2d-canvas',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-cache',
    '--disable-component-extensions-with-background-pages',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-ipc-flooding-protection',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-prompt-on-repost',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--ignore-certificate-errors',
    '--no-default-browser-check',
    '--no-first-run',
  ];

  if (process.platform !== 'win32') {
    args.push('--no-sandbox', '--no-zygote');
  }

  if (isVisibleWhatsAppMode()) {
    args.push(`--app=${WHATS_WEB_URL}`, '--start-maximized');
  }

  return args;
}

async function focusClientPage(nextClient) {
  if (!isVisibleWhatsAppMode()) return;
  const page = nextClient?.pupPage;
  if (!page) return;
  try {
    await page.bringToFront();
  } catch {}
}

async function markReadyFromConnectedPage(nextClient, source = 'fallback') {
  if (ready || !nextClient?.pupPage || nextClient.pupPage.isClosed?.()) return false;
  let pageState = '';
  let hasBridge = false;
  try {
    const result = await nextClient.pupPage.evaluate(() => ({
      appState: String(window.AuthStore?.AppState?.state || ''),
      hasWWebJS: Boolean(window.WWebJS),
      bodyHasContent: Boolean(document.body?.innerText?.trim()),
    }));
    pageState = String(result?.appState || '').toUpperCase();
    hasBridge = Boolean(result?.hasWWebJS && result?.bodyHasContent);
  } catch {
    return false;
  }

  if (pageState !== 'CONNECTED' || !hasBridge) return false;

  ready = true;
  lastErrorMessage = '';
  const phone = String(nextClient.info?.wid?.user || getCurrentPhoneNumber() || '');
  bindBrowserDiagnostics(nextClient);
  updateState({ status: 'ready', qrCode: '', phoneNumber: phone, lastError: '' });
  void focusClientPage(nextClient);
  sendLog(`WhatsApp Web conectado (${source}). Agente marcado como pronto${phone ? ` (${phone})` : ''}.`);
  sendWsAgentState({ sessionStatus: 'ready', qrCode: '', phoneNumber: phone, lastError: '' });
  return true;
}

function bindBrowserDiagnostics(nextClient) {
  if (!nextClient || nextClient.__faceburgDiagnosticsBound) return;
  nextClient.__faceburgDiagnosticsBound = true;

  const restartFromBrowser = (reason, detail) => {
    if (client !== nextClient || shuttingDown) return;
    ready = false;
    lastErrorMessage = detail || reason;
    updateState({
      status: 'disconnected',
      qrCode: '',
      phoneNumber: getCurrentPhoneNumber(),
      lastError: lastErrorMessage,
    });
    sendWsAgentState({ sessionStatus: 'disconnected', qrCode: '', phoneNumber: getCurrentPhoneNumber(), lastError: lastErrorMessage });
    sendLog(`WhatsApp Chromium: ${reason}. Reiniciando sessao.`);
    scheduleRestart(`chromium ${reason}`, { wipeSession: false, delayMs: 3000 });
  };

  if (nextClient.pupBrowser?.on) {
    nextClient.pupBrowser.on('disconnected', () => {
      restartFromBrowser('browser disconnected', 'browser_disconnected');
    });
  }

  if (nextClient.pupPage?.on) {
    nextClient.pupPage.on('error', (err) => {
      restartFromBrowser('page error', err instanceof Error ? err.message : String(err || 'page_error'));
    });
    nextClient.pupPage.on('pageerror', (err) => {
      restartFromBrowser('page runtime error', err instanceof Error ? err.message : String(err || 'page_runtime_error'));
    });
    nextClient.pupPage.on('close', () => {
      restartFromBrowser('page closed', 'page_closed');
    });
  }
}



/* ─── whatsapp client ────────────────────────────────────────────── */

function scheduleRestart(reason, opts = {}) {
  if (shuttingDown || restartTimer) return;
  ready = false;
  sendLog(`Reinicio em ${opts.delayMs || RESTART_DELAY_MS}ms: ${reason}`);
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    try { await startClient(opts); } catch {
      scheduleRestart('erro restart', { wipeSession: false });
    }
  }, opts.delayMs || RESTART_DELAY_MS);
}

async function stopClient() {
  const c = client; client = null; ready = false;
  if (c) try { await c.destroy(); } catch {}
}

async function startClient(opts = {}) {
  if (startingClient) return;
  startingClient = true;
  await stopClient();

  if (opts.wipeSession) {
    const dir = path.join(AUTH_PATH, `session-${getClientId()}`);
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }

  const browserPath = getBrowserPath();
  const visibleWindow = isVisibleWhatsAppMode();
  sendLog(`Abrindo WhatsApp Web em janela dedicada${browserPath ? ` com ${path.basename(browserPath)}` : ''}.`);
  const nextClient = new Client({
    authStrategy: new LocalAuth({ clientId: getClientId(), dataPath: AUTH_PATH }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: TAKEOVER_TIMEOUT_MS,
    deviceName: `Faceburg-${os.hostname()}`.slice(0, 24),
    browserName: 'Chrome',
    puppeteer: {
      executablePath: browserPath || undefined,
      headless: false,
      defaultViewport: null,
      timeout: INIT_TIMEOUT_MS,
      args: buildPuppeteerArgs(),
    },
    qrMaxRetries: 10,
  });

  client = nextClient;

  nextClient.on('qr', async (qr) => {
    lastQrAt = Date.now();
    ready = false;
    const qrDataUrl = await QRCode.toDataURL(qr, { width: 280 }).catch(() => '');
    updateState({ status: 'qr', qrCode: qrDataUrl, rawQrCode: qr, phoneNumber: '', lastError: '' });
    void focusClientPage(nextClient);
    sendLog('QR Code gerado. Escaneie com o WhatsApp.');
    sendWsAgentState({ sessionStatus: 'qr', qrCode: qr, phoneNumber: '', lastError: '' });
  });

  nextClient.on('ready', async () => {
    ready = true;
    const phone = String(nextClient.info?.wid?.user || '');
    lastErrorMessage = '';
    bindBrowserDiagnostics(nextClient);
    updateState({ status: 'ready', qrCode: '', phoneNumber: phone, lastError: '' });
    void focusClientPage(nextClient);

    // Block Blue Ticks (Seen)
    if (nextClient.pupPage) {
      try {
        await nextClient.pupPage.evaluate(() => {
          if (window.WWebJS) {
            window.WWebJS.sendSeen = async () => false;
          }
        });
      } catch (err) {}
    }

    sendLog(`Conectado ao WhatsApp (${phone || 'sem numero'}).`);
    sendWsAgentState({ sessionStatus: 'ready', qrCode: '', phoneNumber: phone, lastError: '' });
  });

  nextClient.on('authenticated', () => {
    lastErrorMessage = '';
    const now = Date.now();
    if (now - lastAuthenticatedLogAt >= 10000) {
      sendLog('Sessao WhatsApp autenticada.');
      lastAuthenticatedLogAt = now;
    }
  });

  nextClient.on('change_state', async (state) => {
    const stateLabel = String(state || '').toUpperCase();
    if (stateLabel && stateLabel !== lastStateLabel) {
      sendLog(`Estado WhatsApp: ${stateLabel}`);
      lastStateLabel = stateLabel;
    }

    if (stateLabel === 'OPENING' || stateLabel === 'PAIRING') {
      updateState({ status: 'connecting', lastError: '' });
      sendWsAgentState({ sessionStatus: 'connecting', lastError: '' });
      return;
    }

    if (stateLabel === 'CONNECTED') {
      await markReadyFromConnectedPage(nextClient, 'estado conectado');
      return;
    }

    if (stateLabel === 'CONFLICT') {
      sendLog('Conflito detectado. Assumindo a sessao local automaticamente.');
      return;
    }

    if (stateLabel === 'TIMEOUT' || stateLabel === 'PROXYBLOCK') {
      ready = false;
      lastErrorMessage = `state_${stateLabel.toLowerCase()}`;
      updateState({ status: 'disconnected', qrCode: '', phoneNumber: getCurrentPhoneNumber(), lastError: lastErrorMessage });
      sendWsAgentState({ sessionStatus: 'disconnected', qrCode: '', phoneNumber: getCurrentPhoneNumber(), lastError: lastErrorMessage });
      scheduleRestart(`state ${stateLabel.toLowerCase()}`, { wipeSession: false, delayMs: 3000 });
      return;
    }

    if (stateLabel === 'DEPRECATED_VERSION') {
      ready = false;
      lastErrorMessage = 'deprecated_version';
      updateState({ status: 'disconnected', qrCode: '', phoneNumber: getCurrentPhoneNumber(), lastError: lastErrorMessage });
      sendWsAgentState({ sessionStatus: 'disconnected', qrCode: '', phoneNumber: getCurrentPhoneNumber(), lastError: lastErrorMessage });
      scheduleRestart('state deprecated_version', { wipeSession: false, delayMs: 3000 });
    }
  });

  nextClient.on('message', async (msg) => {
    try {
      if (msg.from === 'status@broadcast' || msg.isGroupMsg) return;
      if (msg.type !== 'chat') return;
      
      const autoReply = await processMessage(msg.body);
      if (autoReply) {
        const replyText = personalizeAutoReply(autoReply);
        sendLog(`NLP Auto-reply para ${msg.from}`);
        await msg.reply(replyText);
      }
    } catch (err) {}
  });

  nextClient.on('auth_failure', async () => {
    ready = false;
    lastErrorMessage = 'auth_failure';
    updateState({ status: 'auth_failure', qrCode: '', phoneNumber: '', lastError: 'auth_failure' });
    sendLog('Falha de autenticacao no WhatsApp.');
    sendWsAgentState({ sessionStatus: 'auth_failure', qrCode: '', phoneNumber: '', lastError: 'auth_failure' });
    scheduleRestart('auth_failure', { wipeSession: true });
  });

  nextClient.on('disconnected', async () => {
    ready = false;
    lastErrorMessage = 'disconnected';
    updateState({ status: 'disconnected', qrCode: '', phoneNumber: '', lastError: 'disconnected' });
    sendLog('Sessao WhatsApp desconectada.');
    sendWsAgentState({ sessionStatus: 'disconnected', qrCode: '', phoneNumber: '', lastError: 'disconnected' });
    scheduleRestart('disconnected', { wipeSession: false });
  });

  updateState({ status: 'connecting', qrCode: '', phoneNumber: '', lastError: '' });
  sendWsAgentState({ sessionStatus: 'connecting', qrCode: '', phoneNumber: '', lastError: '' });

  let fallbackActive = true;
  const connectedPageFallback = (async () => {
    while (fallbackActive && !ready && client === nextClient && !shuttingDown) {
      await sleep(2000);
      if (await markReadyFromConnectedPage(nextClient, 'fallback inicializacao')) return;
    }
    await new Promise(() => {});
  })();

  try {
    const initialization = nextClient.initialize();
    await Promise.race([
      initialization,
      connectedPageFallback,
      sleep(INIT_TIMEOUT_MS).then(() => { throw new Error('Timeout ao inicializar WhatsApp.'); }),
    ]);
    bindBrowserDiagnostics(nextClient);
    await markReadyFromConnectedPage(nextClient, 'pos-inicializacao');
    void focusClientPage(nextClient);
  } finally {
    fallbackActive = false;
    startingClient = false;
  }
}

/* ─── main ───────────────────────────────────────────────────────── */

async function main() {
  await acquireSingleInstanceLock();
  sendLog(`Iniciado em modo IPC Local (sem cloud-ws): aguardando comandos do hub.`);

  // initial client start with retries
  let ok = false;
  let attempts = 0;
  while (!ok && !shuttingDown) {
    attempts++;
    try { await startClient(); ok = true; } catch (err) {
      sendLog(`Falha inicializacao (tentativa ${attempts}): ${err instanceof Error ? err.message : err}`);
      updateState({ status: 'disconnected', lastError: err instanceof Error ? err.message : 'Erro' });
      await sleep(5000);
    }
  }

  // watchdog
  watchdogTimer = setInterval(() => {
    if (shuttingDown || startingClient || restartTimer) return;
    if (client?.pupBrowser?.isConnected && !client.pupBrowser.isConnected()) {
      scheduleRestart('watchdog browser disconnected', { wipeSession: false, delayMs: 3000 });
      return;
    }
    if (client?.pupPage?.isClosed?.()) {
      scheduleRestart('watchdog page closed', { wipeSession: false, delayMs: 3000 });
      return;
    }
    if (!ready) {
      void markReadyFromConnectedPage(client, 'watchdog');
    }
    if (!ready && lastQrAt > 0 && Date.now() - lastQrAt > 5 * 60 * 1000) {
      scheduleRestart('watchdog qr stale', { wipeSession: false, delayMs: 3000 });
    }
  }, WATCHDOG_INTERVAL_MS);
}

async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  sendLog('Encerrando...');
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (lockServer) {
    try { lockServer.close(); } catch {}
    lockServer = null;
  }
  await stopClient();
  process.exit(0);
}

// Listen for shutdown command from main process
process.on('message', (msg) => {
  if (msg?.type === 'shutdown') {
    void shutdown();
    return;
  }
  if (msg?.type === 'whatsapp-send-direct') {
    void sendDirectWhatsappMessage(msg.payload)
      .then((result) => sendLocalResponse(msg.requestId, true, result))
      .catch((error) => sendLocalResponse(msg.requestId, false, error));
  }
});

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('uncaughtException', (err) => {
  sendLog(`uncaughtException: ${err instanceof Error ? err.message : err}`);
  scheduleRestart('uncaughtException', { wipeSession: false });
});
process.on('unhandledRejection', (reason) => {
  sendLog(`unhandledRejection: ${String(reason)}`);
});

void main();
