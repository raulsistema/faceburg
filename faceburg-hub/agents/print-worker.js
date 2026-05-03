/* eslint-disable no-console */
/* Print Worker — forked from Faceburg Hub main process */
const os = require('node:os');
const WebSocket = require('ws');
const { printTextWindows } = require('./native-printer');

const SERVER_URL = String(process.env.HUB_SERVER_URL || process.env.PRINT_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const AGENT_KEY = String(process.env.HUB_AGENT_KEY || process.env.PRINT_AGENT_KEY || '');
const PRINTER_NAME = String(process.env.HUB_PRINTER_NAME || process.env.PRINTER_NAME || '');

const POLL_FALLBACK_MS = Number(process.env.HUB_PRINT_POLL_FALLBACK_MS || process.env.PRINT_POLL_FALLBACK_MS || 15000);
const WS_RECONNECT_BASE_MS = Number(process.env.HUB_PRINT_WS_RECONNECT_MS || process.env.PRINT_WS_RECONNECT_MS || 3000);
const WS_RECONNECT_MAX_MS = Number(process.env.HUB_PRINT_WS_RECONNECT_MAX_MS || process.env.PRINT_WS_RECONNECT_MAX_MS || 60000);
const WS_LOG_COOLDOWN_MS = Number(process.env.HUB_PRINT_WS_LOG_COOLDOWN_MS || process.env.PRINT_WS_LOG_COOLDOWN_MS || 60000);
const HEARTBEAT_MS = Number(process.env.HUB_PRINT_HEARTBEAT_MS || process.env.PRINT_HEARTBEAT_MS || 60000);
const AUTH_BACKOFF_MS = Number(process.env.HUB_PRINT_AUTH_BACKOFF_MS || process.env.PRINT_AUTH_BACKOFF_MS || 600000);

let draining = false;
let ws = null;
let wsConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastErrorMessage = '';
let shuttingDown = false;
let authBlockedUntil = 0;
let currentStatus = 'connecting';
let wsReconnectAttempt = 0;
let wsLastLogAt = 0;
let wsLastErrorReason = '';
let wsFallbackActive = false;
let wsConnectedOnce = false;

/* ─── IPC to main ────────────────────────────────────────────────── */

function sendState(data) {
  if (process.send) process.send({ type: 'state', data });
}

function sendLog(text) {
  if (process.send) process.send({ type: 'log', text });
}

function updateState(patch = {}) {
  if (patch.status) currentStatus = patch.status;
  sendState({
    status: currentStatus,
    realtimeConnected: wsConnected,
    ...patch,
  });
}

/* ─── helpers ────────────────────────────────────────────────────── */

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function fetchJson(url, opts = {}) {
  const res = await fetch(url, opts);
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(String(json.error || `HTTP ${res.status}`));
  return json;
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

function announceWsFallback(reason, delayMs) {
  const safeReason = String(reason || 'gateway indisponivel').trim();
  if (!wsFallbackActive) {
    wsFallbackActive = true;
    wsLastLogAt = Date.now();
    sendLog(`Realtime indisponivel (${safeReason}). Usando fallback por polling. Nova tentativa em ${formatRetryDelay(delayMs)}.`);
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
  updateState({ status: currentStatus === 'error' ? 'ready' : currentStatus, lastError: currentStatus === 'error' ? '' : undefined });
  if (recoveredFromFallback) {
    sendLog('Realtime conectado.');
  }
  wsConnectedOnce = true;
}

/* ─── printing ───────────────────────────────────────────────────── */

/* ─── server communication ───────────────────────────────────────── */

async function postAgentState(connectionStatus) {
  try {
    await fetchJson(`${SERVER_URL}/api/print/agent/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': AGENT_KEY },
      body: JSON.stringify({
        connectionStatus,
        printerName: PRINTER_NAME,
        deviceName: os.hostname(),
        appVersion: '1.0.0',
        lastError: lastErrorMessage,
      }),
    });
  } catch {}
}

async function pollOnce() {
  const pollData = await fetchJson(`${SERVER_URL}/api/print/poll`, {
    method: 'GET',
    headers: { 'x-agent-key': AGENT_KEY, 'cache-control': 'no-cache' },
  });
  if (!pollData?.job) return false;

  const job = pollData.job;
  try {
    if (process.platform === 'win32') {
      const printResult = await printTextWindows(String(job.payloadText || ''), PRINTER_NAME);
      sendLog(`Job ${job.id} enviado via ${printResult.strategy.toUpperCase()}${printResult.printerName ? ` (${printResult.printerName})` : ''}.`);
      if (printResult.fallbackUsed && printResult.previousFailures?.length) {
        sendLog(`Fallback de impressao acionado no job ${job.id}: ${printResult.previousFailures.join(' | ')}`);
      }
    } else {
      sendLog(`[simulacao] ${job.payloadText}`);
    }
    await fetchJson(`${SERVER_URL}/api/print/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': AGENT_KEY },
      body: JSON.stringify({ jobId: job.id, success: true }),
    });
    sendLog(`Job ${job.id} impresso com sucesso.`);
    lastErrorMessage = '';
    updateState({ status: 'ready', lastError: '', lastJobAt: new Date().toLocaleString('pt-BR') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha impressao';
    lastErrorMessage = msg;
    await fetchJson(`${SERVER_URL}/api/print/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': AGENT_KEY },
      body: JSON.stringify({ jobId: job.id, success: false, error: msg }),
    }).catch(() => {});
    sendLog(`Job ${job.id} falhou: ${msg}`);
    updateState({ status: 'ready', lastError: msg });
  }
  return true;
}

async function drainJobs(reason) {
  if (Date.now() < authBlockedUntil) return;
  if (draining) return;
  draining = true;
  try {
    while (true) { if (!(await pollOnce())) break; }
  } catch (err) {
    lastErrorMessage = err instanceof Error ? err.message : 'Erro';
    sendLog(`Erro drain: ${lastErrorMessage}`);
    updateState({ status: 'error', lastError: lastErrorMessage });
    if (lastErrorMessage.includes('HTTP 403') || lastErrorMessage.toLowerCase().includes('agent disabled')) {
      authBlockedUntil = Date.now() + AUTH_BACKOFF_MS;
      sendLog(`Sem permissao do print-agent. Nova tentativa em ${Math.round(AUTH_BACKOFF_MS / 1000)}s.`);
    }
    if (!wsConnected) await sleep(3000);
  } finally { draining = false; }
}

/* ─── realtime websocket ─────────────────────────────────────────── */

function buildWsUrl() {
  const parsed = new URL(SERVER_URL);
  const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = String(process.env.REALTIME_WS_PORT || process.env.REALTIME_GATEWAY_PORT || '3001').trim();
  return `${proto}//${parsed.hostname}:${port}/ws/agents`;
}

function scheduleReconnect(reason = '') {
  if (reconnectTimer || shuttingDown) return;
  wsReconnectAttempt += 1;
  const delayMs = getWsReconnectDelay();
  announceWsFallback(reason, delayMs);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectRealtime(); }, delayMs);
}

function connectRealtime() {
  if (!AGENT_KEY || shuttingDown) return;
  const url = `${buildWsUrl()}?kind=print`;
  let opened = false;
  try {
    ws = new WebSocket(url, { headers: { 'x-agent-key': AGENT_KEY } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || 'falha ao iniciar websocket');
    wsConnected = false;
    updateState();
    scheduleReconnect(message);
    return;
  }

  ws.on('open', () => {
    opened = true;
    lastErrorMessage = '';
    authBlockedUntil = 0;
    markWsConnected();
    void postAgentState('ready');
    void drainJobs('ws-open');
  });
  ws.on('message', (raw) => {
    try { if (JSON.parse(String(raw))?.type === 'job_available') void drainJobs('ws-event'); } catch {}
  });
  ws.on('close', (code, reasonBuffer) => {
    const closeReason = String(reasonBuffer || '').trim();
    const failureReason =
      wsLastErrorReason ||
      closeReason ||
      (opened ? `conexao encerrada (${code || 0})` : `nao foi possivel conectar (${code || 0})`);
    wsLastErrorReason = '';
    wsConnected = false;
    updateState({ lastError: currentStatus === 'error' ? lastErrorMessage : '' });
    if (shuttingDown) return;
    scheduleReconnect(failureReason);
  });
  ws.on('error', (error) => {
    wsLastErrorReason = error instanceof Error ? error.message : String(error || 'erro websocket');
    wsConnected = false;
    updateState();
  });
}

/* ─── main ───────────────────────────────────────────────────────── */

async function main() {
  sendLog(`Iniciado. Server: ${SERVER_URL} | Printer: ${PRINTER_NAME || '(padrao)'}`);
  updateState({ status: 'connecting', lastError: '' });
  await postAgentState('connecting');
  connectRealtime();
  await drainJobs('startup');
  if (!shuttingDown && currentStatus === 'connecting') {
    updateState({ status: 'ready', lastError: '' });
    await postAgentState('ready');
  }

  heartbeatTimer = setInterval(() => {
    if (shuttingDown) return;
    void postAgentState(currentStatus === 'error' ? 'error' : 'ready');
  }, HEARTBEAT_MS);

  setInterval(() => {
    if (shuttingDown) return;
    // Normal flow is realtime event-driven. Fallback polling only when websocket is offline.
    if (!wsConnected) {
      void drainJobs('fallback');
    }
  }, POLL_FALLBACK_MS);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  sendLog('Encerrando...');
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (ws) try { ws.close(); } catch {}
  process.exit(0);
}

process.on('message', (msg) => { if (msg?.type === 'shutdown') shutdown(); });
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
process.on('uncaughtException', (err) => {
  lastErrorMessage = err instanceof Error ? err.message : String(err || 'uncaught_exception');
  sendLog(`uncaughtException: ${lastErrorMessage}`);
  updateState({ status: 'error', lastError: lastErrorMessage });
  setTimeout(() => process.exit(1), 50);
});
process.on('unhandledRejection', (reason) => {
  const message = String(reason || 'unhandled_rejection');
  sendLog(`unhandledRejection: ${message}`);
});

void main();
