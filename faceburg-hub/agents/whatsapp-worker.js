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

const SERVER_URL = String(process.env.HUB_SERVER_URL || process.env.WHATS_SERVER_URL || 'https://faceburg.vercel.app').replace(/\/$/, '');
const AGENT_KEY = String(process.env.HUB_AGENT_KEY || process.env.WHATS_AGENT_KEY || '');
const SLUG = String(process.env.HUB_SLUG || process.env.WHATS_SLUG || '').trim().toLowerCase();
const ENABLE_REALTIME = ['1', 'true', 'yes', 'y', 'on'].includes(
  String(process.env.HUB_ENABLE_REALTIME || process.env.WHATS_ENABLE_REALTIME || '').trim().toLowerCase(),
);

const WS_RECONNECT_BASE_MS = Number(process.env.HUB_WHATS_WS_RECONNECT_MS || process.env.WHATS_WS_RECONNECT_MS || 3000);
const WS_RECONNECT_MAX_MS = Number(process.env.HUB_WHATS_WS_RECONNECT_MAX_MS || process.env.WHATS_WS_RECONNECT_MAX_MS || 60000);
const WS_LOG_COOLDOWN_MS = Number(process.env.HUB_WHATS_WS_LOG_COOLDOWN_MS || process.env.WHATS_WS_LOG_COOLDOWN_MS || 60000);
const HEARTBEAT_MS = Number(process.env.HUB_WHATS_HEARTBEAT_MS || process.env.WHATS_HEARTBEAT_MS || 60000);
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
let ws = null;
let wsConnected = false;
let wsReconnectTimer = null;
let heartbeatTimer = null;
let lastErrorMessage = '';
let lockServer = null;
let watchdogTimer = null;
let wsReconnectAttempt = 0;
let wsLastLogAt = 0;
let wsLastErrorReason = '';
let wsFallbackActive = false;
let wsConnectedOnce = false;
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
    realtimeConnected: wsConnected,
    ...patch,
  });
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

function parseBooleanEnv(primary, fallback) {
  const value = String(primary ?? '').trim().toLowerCase();
  if (!value) return fallback;
  if (['1', 'true', 'yes', 'y', 'on'].includes(value)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(value)) return false;
  return fallback;
}

function normalizeTarget(target) {
  if (!target) return '';
  if (target.endsWith('@c.us')) return target;
  const digits = String(target).replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? `${digits}@c.us` : `55${digits}@c.us`;
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

function formatRetryDelay(ms) {
  return `${Math.max(1, Math.round(ms / 1000))}s`;
}

function getWsReconnectDelay() {
  const attempt = Math.max(0, wsReconnectAttempt - 1);
  return Math.min(WS_RECONNECT_MAX_MS, WS_RECONNECT_BASE_MS * (2 ** attempt));
}

function shouldLogWsFallback() {
  return !wsLastLogAt || Date.now() - wsLastLogAt >= WS_LOG_COOLDOWN_MS;
}

function announceWsDisconnect(reason, delayMs) {
  const safeReason = String(reason || 'gateway indisponivel').trim();
  if (!wsFallbackActive) {
    wsFallbackActive = true;
    wsLastLogAt = Date.now();
    sendLog(`Realtime indisponivel (${safeReason}). Nova tentativa em ${formatRetryDelay(delayMs)}.`);
    return;
  }

  if (shouldLogWsFallback()) {
    wsLastLogAt = Date.now();
    sendLog(`Realtime ainda indisponivel (${safeReason}). Tentando novamente em ${formatRetryDelay(delayMs)}.`);
  }
}

function markWsConnected() {
  const recoveredFromFallback = wsFallbackActive || !wsConnectedOnce;
  wsConnected = true;
  wsReconnectAttempt = 0;
  wsLastErrorReason = '';
  wsFallbackActive = false;
  updateState();
  if (recoveredFromFallback) {
    sendLog('Realtime conectado (direct-v1).');
  }
  wsConnectedOnce = true;
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
  return !parseBooleanEnv(process.env.HUB_WHATS_HEADLESS || process.env.WHATS_HEADLESS, false);
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

/* ─── realtime websocket (direct-v1) ─────────────────────────────── */

function sendWsJson(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function sendWsAgentState(state) {
  sendWsJson({
    type: 'agent_state',
    state: {
      sessionStatus: state.sessionStatus || 'disconnected',
      qrCode: state.qrCode || '',
      phoneNumber: state.phoneNumber || '',
      deviceName: os.hostname(),
      appVersion: '1.0.0',
      lastError: state.lastError || '',
    },
  });
}

function sendWsJobAck(jobId, success, errorMessage) {
  sendWsJson({
    type: 'job_ack',
    jobId,
    success,
    error: errorMessage || '',
  });
}

async function handleDirectJob(job) {
  if (!job?.id) return;
  const jobId = String(job.id);
  try {
    await sendDirectWhatsappMessage(job);
    sendWsJobAck(jobId, true, '');
    sendLog(`Job ${jobId} enviado com sucesso.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha';
    sendWsJobAck(jobId, false, msg);
    sendLog(`Falha job ${jobId}: ${msg}`);
  }
}

function buildWsUrl() {
  const parsed = new URL(SERVER_URL);
  const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = String(process.env.REALTIME_WS_PORT || process.env.REALTIME_GATEWAY_PORT || '3001').trim();
  const host = `${parsed.hostname}:${port}`;
  return `${proto}//${host}/ws/agents`;
}

function scheduleWsReconnect(reason = '') {
  if (wsReconnectTimer || shuttingDown) return;
  wsReconnectAttempt += 1;
  const delayMs = getWsReconnectDelay();
  announceWsDisconnect(reason, delayMs);
  wsReconnectTimer = setTimeout(() => { wsReconnectTimer = null; connectRealtime(); }, delayMs);
}

function connectRealtime() {
  if (!AGENT_KEY || shuttingDown) return;
  const url = `${buildWsUrl()}?kind=whatsapp&protocol=${DIRECT_PROTOCOL}`;
  let opened = false;
  try {
    ws = new WebSocket(url, {
      headers: {
        'x-agent-key': AGENT_KEY,
        'x-agent-protocol': DIRECT_PROTOCOL,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'falha ao iniciar websocket');
    wsConnected = false;
    updateState();
    scheduleWsReconnect(message);
    return;
  }

  ws.on('open', () => {
    opened = true;
    markWsConnected();
    // Report current state so gateway knows if we're ready to receive jobs
    const currentStatus = ready ? 'ready' : startingClient ? 'connecting' : 'disconnected';
    sendWsAgentState({
      sessionStatus: currentStatus,
      qrCode: '',
      phoneNumber: getCurrentPhoneNumber(),
      lastError: lastErrorMessage,
    });
  });

  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw));
      if (payload?.type === 'pong') return;

      // direct-v1: gateway pushes jobs directly
      if (payload?.type === 'job' && payload?.job) {
        if (!ready || !client) {
          // Not ready — nack the job so it goes back to the queue
          sendWsJobAck(String(payload.job.id || ''), false, 'WhatsApp nao esta conectado.');
          return;
        }
        void handleDirectJob(payload.job);
        return;
      }

      if (payload?.type === 'connected') {
        sendLog(`Gateway: protocolo ${payload.protocol || 'unknown'}, tenant ${payload.tenantId || '?'}.`);
      }
    } catch {}
  });

  ws.on('close', (code, reasonBuffer) => {
    const closeReason = String(reasonBuffer || '').trim();
    const failureReason =
      wsLastErrorReason ||
      closeReason ||
      (opened ? `conexao encerrada (${code || 0})` : `nao foi possivel conectar (${code || 0})`);
    wsLastErrorReason = '';
    wsConnected = false;
    updateState();
    if (shuttingDown) return;
    scheduleWsReconnect(failureReason);
  });

  ws.on('error', (error) => {
    wsLastErrorReason = error instanceof Error ? error.message : String(error || 'erro websocket');
    wsConnected = false;
    updateState();
  });
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
  sendLog(
    visibleWindow
      ? `Abrindo WhatsApp Web em janela dedicada${browserPath ? ` com ${path.basename(browserPath)}` : ''}.`
      : 'Iniciando WhatsApp em modo oculto.',
  );
  const nextClient = new Client({
    authStrategy: new LocalAuth({ clientId: getClientId(), dataPath: AUTH_PATH }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: TAKEOVER_TIMEOUT_MS,
    deviceName: `Faceburg-${os.hostname()}`.slice(0, 24),
    browserName: 'Chrome',
    puppeteer: {
      executablePath: browserPath || undefined,
      headless: !visibleWindow,
      defaultViewport: visibleWindow ? null : undefined,
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
    updateState({ status: 'qr', qrCode: qrDataUrl, phoneNumber: '', lastError: '' });
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

  try {
    await Promise.race([
      nextClient.initialize(),
      sleep(INIT_TIMEOUT_MS).then(() => { throw new Error('Timeout ao inicializar WhatsApp.'); }),
    ]);
    bindBrowserDiagnostics(nextClient);
    void focusClientPage(nextClient);
  } finally { startingClient = false; }
}

/* ─── main ───────────────────────────────────────────────────────── */

async function main() {
  await acquireSingleInstanceLock();
  sendLog(`Iniciado. Server: ${SERVER_URL}`);
  if (ENABLE_REALTIME) {
    connectRealtime();

  // heartbeat — report state periodically via WebSocket
  heartbeatTimer = setInterval(() => {
    if (shuttingDown) return;
    const s = ready ? 'ready' : startingClient ? 'connecting' : 'disconnected';
    sendWsAgentState({
      sessionStatus: s,
      qrCode: '',
      phoneNumber: String(client?.info?.wid?.user || ''),
      lastError: lastErrorMessage,
    });
  }, HEARTBEAT_MS);
  } else {
    sendLog('Modo local ativo: aguardando comandos da tela aberta no hub.');
  }

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
  if (wsReconnectTimer) { clearTimeout(wsReconnectTimer); wsReconnectTimer = null; }
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  if (watchdogTimer) { clearInterval(watchdogTimer); watchdogTimer = null; }
  if (ws) try { ws.close(); } catch {} 
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
