/* eslint-disable no-console */
/* Print Worker — forked from Faceburg Hub main process
 * Connects to Realtime Gateway using direct-v1 protocol.
 * Jobs are pushed by the gateway — no polling required. */
const os = require('node:os');
const WebSocket = require('ws');
const { printTextWindows } = require('./native-printer');

const SERVER_URL = String(process.env.HUB_SERVER_URL || process.env.PRINT_SERVER_URL || 'https://faceburg.vercel.app').replace(/\/$/, '');
const AGENT_KEY = String(process.env.HUB_AGENT_KEY || process.env.PRINT_AGENT_KEY || '');
const PRINTER_NAME = String(process.env.HUB_PRINTER_NAME || process.env.PRINTER_NAME || '');
const ENABLE_REALTIME = ['1', 'true', 'yes', 'y', 'on'].includes(
  String(process.env.HUB_ENABLE_REALTIME || process.env.PRINT_ENABLE_REALTIME || '').trim().toLowerCase(),
);

const WS_RECONNECT_BASE_MS = Number(process.env.HUB_PRINT_WS_RECONNECT_MS || process.env.PRINT_WS_RECONNECT_MS || 3000);
const WS_RECONNECT_MAX_MS = Number(process.env.HUB_PRINT_WS_RECONNECT_MAX_MS || process.env.PRINT_WS_RECONNECT_MAX_MS || 60000);
const WS_LOG_COOLDOWN_MS = Number(process.env.HUB_PRINT_WS_LOG_COOLDOWN_MS || process.env.PRINT_WS_LOG_COOLDOWN_MS || 60000);
const HEARTBEAT_MS = Number(process.env.HUB_PRINT_HEARTBEAT_MS || process.env.PRINT_HEARTBEAT_MS || 60000);
const DIRECT_PROTOCOL = 'direct-v1';

let ws = null;
let wsConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastErrorMessage = '';
let shuttingDown = false;
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
  updateState({ status: currentStatus === 'error' ? 'ready' : currentStatus, lastError: currentStatus === 'error' ? '' : undefined });
  if (recoveredFromFallback) {
    sendLog('Realtime conectado (direct-v1).');
  }
  wsConnectedOnce = true;
}

/* ─── websocket messaging ────────────────────────────────────────── */

function sendWsJson(payload) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function sendWsAgentState(connectionStatus) {
  sendWsJson({
    type: 'agent_state',
    state: {
      connectionStatus,
      printerName: PRINTER_NAME,
      deviceName: os.hostname(),
      appVersion: '1.0.0',
      lastError: lastErrorMessage,
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

/* ─── printing ───────────────────────────────────────────────────── */

async function printPayload(job, options = {}) {
  const payloadText = String(job?.payloadText || '');
  const printerName = String(job?.printerName || PRINTER_NAME || '');
  const jobId = String(job?.id || job?.jobId || 'local');
  if (!payloadText.trim()) throw new Error('Conteudo de impressao vazio.');

  if (process.platform === 'win32') {
    const printResult = await printTextWindows(payloadText, printerName);
    sendLog(`Job ${jobId} enviado via ${printResult.strategy.toUpperCase()}${printResult.printerName ? ` (${printResult.printerName})` : ''}.`);
    if (printResult.fallbackUsed && printResult.previousFailures?.length) {
      sendLog(`Fallback de impressao acionado no job ${jobId}: ${printResult.previousFailures.join(' | ')}`);
    }
    lastErrorMessage = '';
    updateState({ status: 'ready', lastError: '', lastJobAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) });
    return {
      strategy: printResult.strategy,
      printerName: printResult.printerName || printerName || '',
      fallbackUsed: Boolean(printResult.fallbackUsed),
      local: Boolean(options.local),
    };
  }

  sendLog(`[simulacao] ${payloadText}`);
  lastErrorMessage = '';
  updateState({ status: 'ready', lastError: '', lastJobAt: new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) });
  return { strategy: 'simulation', printerName, local: Boolean(options.local) };
}

function sendLocalResponse(requestId, ok, dataOrError) {
  if (!process.send || !requestId) return;
  if (ok) {
    process.send({ type: 'local-response', requestId, ok: true, data: dataOrError || {} });
    return;
  }
  process.send({ type: 'local-response', requestId, ok: false, error: String(dataOrError?.message || dataOrError || 'Falha no agente local.') });
}

async function handleDirectJob(job) {
  if (!job?.id) return;
  const jobId = String(job.id);
  try {
    await printPayload(job);
    sendWsJobAck(jobId, true, '');
    sendLog(`Job ${jobId} impresso com sucesso.`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha impressao';
    lastErrorMessage = msg;
    sendWsJobAck(jobId, false, msg);
    sendLog(`Job ${jobId} falhou: ${msg}`);
    updateState({ status: 'ready', lastError: msg });
  }
}

/* ─── realtime websocket (direct-v1) ─────────────────────────────── */

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
  announceWsDisconnect(reason, delayMs);
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectRealtime(); }, delayMs);
}

function connectRealtime() {
  if (!AGENT_KEY || shuttingDown) return;
  const url = `${buildWsUrl()}?kind=print&protocol=${DIRECT_PROTOCOL}`;
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
    scheduleReconnect(message);
    return;
  }

  ws.on('open', () => {
    opened = true;
    lastErrorMessage = '';
    markWsConnected();
    // Report ready state so gateway can push jobs immediately
    sendWsAgentState('ready');
  });

  ws.on('message', (raw) => {
    try {
      const payload = JSON.parse(String(raw));
      if (payload?.type === 'pong') return;

      // direct-v1: gateway pushes jobs directly
      if (payload?.type === 'job' && payload?.job) {
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
  updateState({ status: 'ready', lastError: '' });

  if (!ENABLE_REALTIME) {
    sendLog('Modo local ativo: aguardando comandos da tela aberta no hub.');
    return;
  }

  updateState({ status: 'connecting', lastError: '' });
  connectRealtime();

  heartbeatTimer = setInterval(() => {
    if (shuttingDown) return;
    sendWsAgentState(currentStatus === 'error' ? 'error' : 'ready');
  }, HEARTBEAT_MS);
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

process.on('message', (msg) => {
  if (msg?.type === 'shutdown') {
    shutdown();
    return;
  }
  if (msg?.type === 'print-direct') {
    void printPayload(msg.payload, { local: true })
      .then((result) => sendLocalResponse(msg.requestId, true, result))
      .catch((error) => {
        lastErrorMessage = error instanceof Error ? error.message : String(error || 'Falha impressao');
        updateState({ status: 'ready', lastError: lastErrorMessage });
        sendLocalResponse(msg.requestId, false, error);
      });
  }
});
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
