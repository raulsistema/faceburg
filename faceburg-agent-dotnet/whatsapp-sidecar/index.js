/* eslint-disable no-console */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const QRCode = require('qrcode');
const { Client, LocalAuth } = require('whatsapp-web.js');

let client = null;
let ready = false;
let starting = false;
let shuttingDown = false;
let restartTimer = null;
let state = {
  status: 'stopped',
  phoneNumber: '',
  qrCode: '',
  lastError: '',
};

function emit(payload) {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

function log(message) {
  process.stderr.write(`${new Date().toISOString()} ${message}\n`);
}

function setState(patch) {
  state = { ...state, ...patch };
  emit({ type: 'state', ...state });
}

function parseBool(value, fallback) {
  const clean = String(value ?? '').trim().toLowerCase();
  if (!clean) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(clean)) return true;
  if (['0', 'false', 'no', 'off'].includes(clean)) return false;
  return fallback;
}

function ensureDir(value) {
  fs.mkdirSync(value, { recursive: true });
  return value;
}

function dataPath() {
  const configured = String(process.env.FACEBURG_WHATS_DATA || '').trim();
  if (configured) return ensureDir(configured);
  const local = String(process.env.LOCALAPPDATA || '').trim();
  return ensureDir(local
    ? path.join(local, 'Faceburg', 'LocalAgent', 'whatsapp-auth')
    : path.join(os.homedir(), '.faceburg-local-agent', 'whatsapp-auth'));
}

function clientId() {
  return String(process.env.FACEBURG_WHATS_CLIENT_ID || 'faceburg')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .slice(0, 40) || 'faceburg';
}

function browserPath() {
  const configured = String(process.env.FACEBURG_WHATS_CHROME_PATH || '').trim();
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || '';
}

function puppeteerArgs() {
  const args = [
    '--disable-accelerated-2d-canvas',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-breakpad',
    '--disable-cache',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-hang-monitor',
    '--disable-notifications',
    '--disable-popup-blocking',
    '--disable-print-preview',
    '--disable-renderer-backgrounding',
    '--disable-sync',
    '--no-default-browser-check',
    '--no-first-run',
  ];
  if (!parseBool(process.env.FACEBURG_WHATS_HEADLESS, false)) {
    args.push('--app=https://web.whatsapp.com', '--start-maximized');
  }
  if (process.platform !== 'win32') {
    args.push('--no-sandbox', '--no-zygote');
  }
  return args;
}

function normalizeTarget(target) {
  if (!target) return '';
  const raw = String(target);
  if (raw.endsWith('@c.us')) return raw;
  const digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  return digits.startsWith('55') ? `${digits}@c.us` : `55${digits}@c.us`;
}

async function stopClient() {
  const current = client;
  client = null;
  ready = false;
  if (current) {
    try { await current.destroy(); } catch {}
  }
}

function scheduleRestart(reason, delayMs = 3000) {
  if (shuttingDown || restartTimer) return;
  ready = false;
  setState({ status: 'disconnected', lastError: reason });
  log(`restart scheduled: ${reason}`);
  restartTimer = setTimeout(() => {
    restartTimer = null;
    void startClient().catch((error) => scheduleRestart(error.message || String(error), 5000));
  }, delayMs);
}

async function startClient() {
  if (starting || shuttingDown) return;
  starting = true;
  await stopClient();
  setState({ status: 'starting', qrCode: '', lastError: '' });

  const executablePath = browserPath();
  const visible = !parseBool(process.env.FACEBURG_WHATS_HEADLESS, false);
  log(`starting WhatsApp ${visible ? 'visible' : 'headless'}${executablePath ? ` with ${path.basename(executablePath)}` : ''}`);

  const next = new Client({
    authStrategy: new LocalAuth({ clientId: clientId(), dataPath: dataPath() }),
    takeoverOnConflict: true,
    takeoverTimeoutMs: 0,
    deviceName: `Faceburg-${os.hostname()}`.slice(0, 24),
    browserName: 'Chrome',
    puppeteer: {
      executablePath: executablePath || undefined,
      headless: !visible,
      defaultViewport: visible ? null : undefined,
      args: puppeteerArgs(),
      timeout: 120000,
    },
    qrMaxRetries: 10,
  });

  client = next;

  next.on('qr', async (qr) => {
    ready = false;
    const qrCode = await QRCode.toDataURL(qr, { width: 280 }).catch(() => '');
    setState({ status: 'qr', qrCode, phoneNumber: '', lastError: '' });
    log('qr generated');
  });

  next.on('ready', () => {
    ready = true;
    const phoneNumber = String(next.info?.wid?.user || '');
    setState({ status: 'ready', qrCode: '', phoneNumber, lastError: '' });
    log(`ready ${phoneNumber || ''}`);
  });

  next.on('authenticated', () => {
    setState({ status: ready ? 'ready' : 'authenticated', lastError: '' });
    log('authenticated');
  });

  next.on('auth_failure', () => {
    ready = false;
    setState({ status: 'auth_failure', qrCode: '', phoneNumber: '', lastError: 'auth_failure' });
    scheduleRestart('auth_failure', 5000);
  });

  next.on('disconnected', (reason) => {
    ready = false;
    scheduleRestart(`disconnected ${reason || ''}`.trim(), 3000);
  });

  next.on('change_state', (nextState) => {
    const label = String(nextState || '').toLowerCase();
    if (label === 'opening' || label === 'pairing') {
      setState({ status: 'starting', lastError: '' });
    }
  });

  try {
    await next.initialize();
  } finally {
    starting = false;
  }
}

async function sendMessage(command) {
  if (!ready || !client) {
    throw new Error('WhatsApp nao conectado.');
  }
  const target = normalizeTarget(command.targetPhone);
  if (!target) throw new Error('Numero invalido.');
  const payloadText = String(command.payloadText || '').trim();
  if (!payloadText) throw new Error('Mensagem vazia.');
  await client.sendMessage(target, payloadText);
  return { targetPhone: target, jobId: command.jobId || '' };
}

async function shutdown() {
  shuttingDown = true;
  if (restartTimer) clearTimeout(restartTimer);
  setState({ status: 'stopped', qrCode: '', lastError: '' });
  await stopClient();
  process.exit(0);
}

const rl = readline.createInterface({ input: process.stdin });
rl.on('line', (line) => {
  void (async () => {
    let command;
    try {
      command = JSON.parse(line);
    } catch (error) {
      emit({ type: 'response', id: '', ok: false, error: 'JSON invalido.' });
      return;
    }

    const id = String(command.id || '');
    try {
      if (command.type === 'send') {
        const data = await sendMessage(command);
        emit({ type: 'response', id, ok: true, ...data });
        return;
      }
      if (command.type === 'status') {
        emit({ type: 'response', id, ok: true, ...state });
        return;
      }
      if (command.type === 'restart') {
        await startClient();
        emit({ type: 'response', id, ok: true, ...state });
        return;
      }
      if (command.type === 'shutdown') {
        emit({ type: 'response', id, ok: true });
        await shutdown();
        return;
      }
      emit({ type: 'response', id, ok: false, error: 'Comando desconhecido.' });
    } catch (error) {
      emit({ type: 'response', id, ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  })();
});

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
process.on('uncaughtException', (error) => {
  log(`uncaughtException: ${error instanceof Error ? error.message : error}`);
  scheduleRestart('uncaughtException', 5000);
});
process.on('unhandledRejection', (reason) => {
  log(`unhandledRejection: ${String(reason)}`);
});

void startClient().catch((error) => scheduleRestart(error.message || String(error), 5000));
