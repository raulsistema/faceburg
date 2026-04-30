/* eslint-disable no-console */
/* Print Worker — forked from Faceburg Hub main process */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const WebSocket = require('ws');

const SERVER_URL = String(process.env.HUB_SERVER_URL || process.env.PRINT_SERVER_URL || 'http://localhost:3000').replace(/\/$/, '');
const AGENT_KEY = String(process.env.HUB_AGENT_KEY || process.env.PRINT_AGENT_KEY || '');
const PRINTER_NAME = String(process.env.HUB_PRINTER_NAME || process.env.PRINTER_NAME || '');

const POLL_FALLBACK_MS = Number(process.env.HUB_PRINT_POLL_FALLBACK_MS || process.env.PRINT_POLL_FALLBACK_MS || 15000);
const WS_RECONNECT_MS = 3000;
const HEARTBEAT_MS = Number(process.env.HUB_PRINT_HEARTBEAT_MS || process.env.PRINT_HEARTBEAT_MS || 180000);
const AUTH_BACKOFF_MS = Number(process.env.HUB_PRINT_AUTH_BACKOFF_MS || process.env.PRINT_AUTH_BACKOFF_MS || 600000);

let draining = false;
let ws = null;
let wsConnected = false;
let reconnectTimer = null;
let heartbeatTimer = null;
let lastConnectedSyncAt = 0;
let lastErrorMessage = '';
let shuttingDown = false;
let authBlockedUntil = 0;
let currentStatus = 'connecting';

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

/* ─── printing ───────────────────────────────────────────────────── */

function printTextWindows(text) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(os.tmpdir(), `faceburg-print-${Date.now()}.txt`);
    fs.writeFileSync(filePath, text, 'utf8');
    const safe = filePath.replace(/'/g, "''");
    const safePrinter = PRINTER_NAME.replace(/'/g, "''");
    const cmd = PRINTER_NAME
      ? `Get-Content -Raw '${safe}' | Out-Printer -Name '${safePrinter}'`
      : `Get-Content -Raw '${safe}' | Out-Printer`;

    execFile('powershell', ['-NoProfile', '-Command', cmd], (err) => {
      try { fs.unlinkSync(filePath); } catch {}
      if (err) reject(err); else resolve();
    });
  });
}

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
      await printTextWindows(String(job.payloadText || ''));
    } else {
      sendLog(`[simulacao] ${job.payloadText}`);
    }
    await fetchJson(`${SERVER_URL}/api/print/ack`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-agent-key': AGENT_KEY },
      body: JSON.stringify({ jobId: job.id, success: true }),
    });
    sendLog(`Job ${job.id} impresso com sucesso.`);
    updateState({ status: 'ready', lastError: '', lastJobAt: new Date().toLocaleString('pt-BR') });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Falha impressao';
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
  if (reason === 'connected-sync') lastConnectedSyncAt = Date.now();
}

/* ─── realtime websocket ─────────────────────────────────────────── */

function buildWsUrl() {
  const parsed = new URL(SERVER_URL);
  const proto = parsed.protocol === 'https:' ? 'wss:' : 'ws:';
  const port = String(process.env.REALTIME_WS_PORT || process.env.REALTIME_GATEWAY_PORT || '3001').trim();
  return `${proto}//${parsed.hostname}:${port}/ws/agents`;
}

function scheduleReconnect() {
  if (reconnectTimer || shuttingDown) return;
  reconnectTimer = setTimeout(() => { reconnectTimer = null; connectRealtime(); }, WS_RECONNECT_MS);
}

function connectRealtime() {
  if (!AGENT_KEY || shuttingDown) return;
  const url = `${buildWsUrl()}?kind=print`;
  try {
    ws = new WebSocket(url, { headers: { 'x-agent-key': AGENT_KEY } });
  } catch { scheduleReconnect(); return; }

  ws.on('open', () => {
    wsConnected = true;
    lastErrorMessage = '';
    authBlockedUntil = 0;
    updateState({ status: currentStatus === 'error' ? 'ready' : currentStatus, lastError: '' });
    sendLog('Realtime conectado.');
    void postAgentState('ready');
    void drainJobs('ws-open');
  });
  ws.on('message', (raw) => {
    try { if (JSON.parse(String(raw))?.type === 'job_available') void drainJobs('ws-event'); } catch {}
  });
  ws.on('close', () => {
    wsConnected = false;
    updateState({ lastError: currentStatus === 'error' ? lastErrorMessage : '' });
    sendLog('Realtime desconectado. Entrando em modo fallback.');
    scheduleReconnect();
  });
  ws.on('error', () => {
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

  heartbeatTimer = setInterval(() => {
    if (shuttingDown) return;
    void postAgentState(wsConnected ? 'ready' : 'connecting');
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

void main();
