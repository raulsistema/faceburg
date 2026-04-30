/* eslint-disable no-console */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, safeStorage } = require('electron');
const { fork, execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* ─── constants ──────────────────────────────────────────────── */

const DEFAULT_SETTINGS = {
  serverUrl: 'http://localhost:3000',
  slug: '',
  email: '',
  password: '',
  printAgentKey: '',
  whatsAgentKey: '',
  printerName: '',
  tenantName: '',
  userName: '',
  autoStartWithWindows: true,
  autoStartWhatsApp: true,
  autoStartPrint: true,
};

const LOG_MAX = 200;

/* ─── state ──────────────────────────────────────────────────── */

let mainWindow = null;
let tray = null;
let trayIcon = null;
let forceQuit = false;
let trayHintShown = false;

let whatsWorker = null;
let printWorker = null;

let whatsState = { status: 'stopped', qrCode: '', phoneNumber: '', lastError: '' };
let printState = { status: 'stopped', lastError: '', lastJobAt: '' };
let logs = [];

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

/* ─── settings ───────────────────────────────────────────────── */

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function encryptPassword(password) {
  if (!password) return '';
  if (!safeStorage?.isEncryptionAvailable?.()) {
    return `plain:${Buffer.from(password, 'utf8').toString('base64')}`;
  }
  const encrypted = safeStorage.encryptString(password);
  return `enc:${encrypted.toString('base64')}`;
}

function decryptPassword(stored) {
  if (!stored) return '';
  if (stored.startsWith('enc:')) {
    const b64 = stored.slice(4);
    const buf = Buffer.from(b64, 'base64');
    if (!safeStorage?.isEncryptionAvailable?.()) return '';
    return safeStorage.decryptString(buf);
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8');
  }
  // Backward compatibility with legacy plain-text setting.
  return stored;
}

function readSettings() {
  try {
    const f = settingsFilePath();
    if (!fs.existsSync(f)) return { ...DEFAULT_SETTINGS };
    const raw = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    const password =
      raw.passwordEncrypted
        ? decryptPassword(String(raw.passwordEncrypted))
        : String(raw.password || '');
    return {
      ...raw,
      password,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(s) {
  const serializable = { ...s };
  const plainPassword = String(serializable.password || '');
  if (plainPassword) {
    serializable.passwordEncrypted = encryptPassword(plainPassword);
  } else {
    delete serializable.passwordEncrypted;
  }
  delete serializable.password;
  fs.writeFileSync(settingsFilePath(), JSON.stringify(serializable, null, 2), 'utf8');
}

/* ─── helpers ────────────────────────────────────────────────── */

function emit(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function pushLog(source, message) {
  const entry = { ts: new Date().toLocaleTimeString('pt-BR'), source, message };
  logs.push(entry);
  if (logs.length > LOG_MAX) logs = logs.slice(-LOG_MAX);
  emit('agent:log', entry);
}

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Informe a URL do servidor.');
  const withProto = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  let parsed;
  try { parsed = new URL(withProto); } catch { throw new Error('URL invalida.'); }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('Use http:// ou https://');
  return parsed.origin;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return data;
}

async function fetchJsonWithTimeout(url, options = {}, timeoutMs = 2500) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchJson(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/* ─── Windows startup ────────────────────────────────────────── */

function applyWindowsStartup(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: 'Faceburg Hub',
    });
  } catch (err) {
    console.error('[hub] Falha ao configurar inicializacao com Windows:', err);
  }
}

/* ─── check server agent configs ──────────────────────────────── */

async function checkServerAgentEnabled(serverUrl, agentKey, kind) {
  if (!agentKey) return false;
  try {
    const endpoint = kind === 'whatsapp'
      ? `${serverUrl}/api/whatsapp/agent/config`
      : `${serverUrl}/api/print/agent/config`;
    const data = await fetchJsonWithTimeout(endpoint, {
      method: 'GET',
      headers: { 'x-agent-key': agentKey, 'cache-control': 'no-cache' },
    }, 2500);
    return data.enabled !== false;
  } catch {
    // If can't reach server, assume enabled (will fail gracefully later)
    return true;
  }
}

async function refreshAgentCredentialsIfPossible() {
  const current = readSettings();
  if (!current.serverUrl || !current.slug || !current.email || !current.password) {
    return current;
  }

  try {
    const printLogin = await fetchJson(`${current.serverUrl}/api/print/agent/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: current.slug,
        email: current.email,
        password: current.password,
        printerName: current.printerName || '',
      }),
    });

    const whatsLogin = await fetchJson(`${current.serverUrl}/api/whatsapp/agent/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slug: current.slug,
        email: current.email,
        password: current.password,
      }),
    });

    const next = {
      ...current,
      printAgentKey: String(printLogin.agentKey || current.printAgentKey || ''),
      whatsAgentKey: String(whatsLogin.agentKey || current.whatsAgentKey || ''),
      tenantName: String(printLogin?.tenant?.name || whatsLogin?.tenant?.name || current.tenantName || ''),
      userName: String(printLogin?.user?.name || whatsLogin?.user?.name || current.userName || ''),
    };
    saveSettings(next);
    pushLog('system', 'Credenciais dos agentes sincronizadas com o servidor.');
    return next;
  } catch (error) {
    pushLog('system', `Falha ao sincronizar credenciais no startup: ${error?.message || error}`);
    return current;
  }
}

async function syncAutoStartAgents() {
  let saved = await refreshAgentCredentialsIfPossible();
  saved = readSettings();
  if (!saved.serverUrl) return;

  if (saved.autoStartWhatsApp && saved.whatsAgentKey) {
    const enabled = await checkServerAgentEnabled(saved.serverUrl, saved.whatsAgentKey, 'whatsapp');
    if (enabled) {
      try {
        startWhatsAppWorker();
      } catch (err) {
        pushLog('system', `Falha auto-start WhatsApp: ${err.message || err}`);
      }
    } else {
      pushLog('system', 'WhatsApp desativado no sistema. Mantendo agente parado.');
      stopWhatsAppWorker();
    }
  } else {
    stopWhatsAppWorker();
  }

  if (saved.autoStartPrint && saved.printAgentKey) {
    const enabled = await checkServerAgentEnabled(saved.serverUrl, saved.printAgentKey, 'print');
    if (enabled) {
      try {
        startPrintWorker();
      } catch (err) {
        pushLog('system', `Falha auto-start impressao: ${err.message || err}`);
      }
    } else {
      pushLog('system', 'Impressao desativada no sistema. Mantendo agente parado.');
      stopPrintWorker();
    }
  } else {
    stopPrintWorker();
  }
}

/* ─── printers ───────────────────────────────────────────────── */

function listPrintersWindows() {
  return new Promise((resolve) => {
    const cmd = "Get-Printer | Where-Object { $_.Type -eq 'Local' -or $_.Type -eq 'Connection' } | Select-Object -ExpandProperty Name";
    execFile('powershell', ['-NoProfile', '-Command', cmd], (err, stdout) => {
      if (err) return resolve([]);
      resolve(stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean));
    });
  });
}

/* ─── WhatsApp worker ────────────────────────────────────────── */

function startWhatsAppWorker() {
  if (whatsWorker) return;
  const settings = readSettings();
  if (!settings.whatsAgentKey || !settings.serverUrl) throw new Error('Faca login antes.');

  const workerPath = path.join(__dirname, 'agents', 'whatsapp-worker.js');
  whatsWorker = fork(workerPath, [], {
    env: {
      ...process.env,
      HUB_SERVER_URL: settings.serverUrl,
      HUB_AGENT_KEY: settings.whatsAgentKey,
      HUB_SLUG: settings.slug,
    },
    silent: true,
  });

  whatsWorker.stdout?.on('data', (d) => pushLog('whatsapp', d.toString().trim()));
  whatsWorker.stderr?.on('data', (d) => pushLog('whatsapp', `[ERR] ${d.toString().trim()}`));

  whatsWorker.on('message', (msg) => {
    if (msg.type === 'state') {
      whatsState = { ...whatsState, ...msg.data };
      emit('whatsapp:state', whatsState);
    } else if (msg.type === 'log') {
      pushLog('whatsapp', msg.text);
    }
  });

  whatsWorker.on('exit', (code) => {
    pushLog('whatsapp', `Worker encerrado (code ${code}).`);
    whatsWorker = null;
    whatsState.status = 'stopped';
    emit('whatsapp:state', whatsState);
  });

  whatsState.status = 'connecting';
  emit('whatsapp:state', whatsState);
  pushLog('whatsapp', 'Agente WhatsApp iniciado.');
}

function stopWhatsAppWorker() {
  if (!whatsWorker) return;
  whatsWorker.send({ type: 'shutdown' });
  const ref = whatsWorker;
  setTimeout(() => {
    if (ref && !ref.killed) {
      try { ref.kill('SIGTERM'); } catch {}
    }
  }, 5000);
  whatsWorker = null;
  whatsState = { status: 'stopped', qrCode: '', phoneNumber: '', lastError: '' };
  emit('whatsapp:state', whatsState);
  pushLog('whatsapp', 'Agente WhatsApp parado.');
}

/* ─── Print worker ───────────────────────────────────────────── */

function startPrintWorker() {
  if (printWorker) return;
  const settings = readSettings();
  if (!settings.printAgentKey || !settings.serverUrl) throw new Error('Faca login antes.');

  const workerPath = path.join(__dirname, 'agents', 'print-worker.js');
  printWorker = fork(workerPath, [], {
    env: {
      ...process.env,
      HUB_SERVER_URL: settings.serverUrl,
      HUB_AGENT_KEY: settings.printAgentKey,
      HUB_PRINTER_NAME: settings.printerName || '',
    },
    silent: true,
  });

  printWorker.stdout?.on('data', (d) => pushLog('print', d.toString().trim()));
  printWorker.stderr?.on('data', (d) => pushLog('print', `[ERR] ${d.toString().trim()}`));

  printWorker.on('message', (msg) => {
    if (msg.type === 'state') {
      printState = { ...printState, ...msg.data };
      emit('print:state', printState);
    } else if (msg.type === 'log') {
      pushLog('print', msg.text);
    }
  });

  printWorker.on('exit', (code) => {
    pushLog('print', `Worker encerrado (code ${code}).`);
    printWorker = null;
    printState.status = 'stopped';
    emit('print:state', printState);
  });

  printState.status = 'connecting';
  emit('print:state', printState);
  pushLog('print', 'Agente de impressao iniciado.');
}

function stopPrintWorker() {
  if (!printWorker) return;
  printWorker.send({ type: 'shutdown' });
  const ref = printWorker;
  setTimeout(() => {
    if (ref && !ref.killed) {
      try { ref.kill('SIGTERM'); } catch {}
    }
  }, 3000);
  printWorker = null;
  printState = { status: 'stopped', lastError: '', lastJobAt: '' };
  emit('print:state', printState);
  pushLog('print', 'Agente de impressao parado.');
}

function stopAllAgents() {
  stopWhatsAppWorker();
  stopPrintWorker();
}

/* ─── system tray ────────────────────────────────────────────── */

function buildTrayIcon() {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
      <rect width="64" height="64" rx="12" fill="#111827"/>
      <circle cx="22" cy="32" r="12" fill="#25D366"/>
      <circle cx="42" cy="32" r="12" fill="#38bdf8"/>
    </svg>
  `.trim();
  const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
  const image = nativeImage.createFromDataURL(dataUrl).resize({ width: 16, height: 16 });
  if (!image.isEmpty()) {
    return image;
  }
  return nativeImage.createEmpty();
}

function showMainWindow() {
  if (!mainWindow) createMainWindow();
  if (!mainWindow) return;
  mainWindow.show();
  mainWindow.setSkipTaskbar(false);
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  trayIcon = buildTrayIcon();
  tray = new Tray(trayIcon);
  tray.setToolTip('Faceburg Hub');

  const ctxMenu = Menu.buildFromTemplate([
    { label: 'Abrir Faceburg Hub', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Sair', click: () => { forceQuit = true; stopAllAgents(); setTimeout(() => app.quit(), 1000); } },
  ]);

  tray.setContextMenu(ctxMenu);
  tray.on('click', () => {
    if (!mainWindow) return;
    mainWindow.isVisible() ? (mainWindow.hide(), mainWindow.setSkipTaskbar(true)) : showMainWindow();
  });
}

/* ─── main window ────────────────────────────────────────────── */

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 640,
    minWidth: 760,
    minHeight: 560,
    autoHideMenuBar: true,
    title: 'Faceburg Hub',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    if (forceQuit) return;
    event.preventDefault();
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);
    if (tray && !trayHintShown) {
      trayHintShown = true;
      tray.displayBalloon({ iconType: 'info', title: 'Faceburg Hub', content: 'O app continua ativo na bandeja do sistema.' });
    }
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

/* ─── IPC handlers ───────────────────────────────────────────── */

ipcMain.handle('hub:get-settings', () => ({
  settings: readSettings(),
  whatsState,
  printState,
  logs,
  whatsRunning: !!whatsWorker,
  printRunning: !!printWorker,
}));

ipcMain.handle('hub:list-printers', async () => {
  if (process.platform === 'win32') return listPrintersWindows();
  return [];
});

ipcMain.handle('hub:login', async (_ev, payload) => {
  const serverUrl = normalizeServerUrl(payload.serverUrl);
  const slug = String(payload.slug || '').trim().toLowerCase();
  const email = String(payload.email || '').trim().toLowerCase();
  const password = String(payload.password || '');
  const printerName = String(payload.printerName || '').trim();

  if (!slug || !email || !password) throw new Error('Informe empresa, e-mail e senha.');

  // Login no print agent
  const printLogin = await fetchJson(`${serverUrl}/api/print/agent/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug, email, password, printerName }),
  });

  // Login no whatsapp agent
  const whatsLogin = await fetchJson(`${serverUrl}/api/whatsapp/agent/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug, email, password }),
  });

  const next = {
    ...readSettings(),
    serverUrl,
    slug,
    email,
    password,
    printerName,
    printAgentKey: String(printLogin.agentKey || ''),
    whatsAgentKey: String(whatsLogin.agentKey || ''),
    tenantName: String(printLogin?.tenant?.name || whatsLogin?.tenant?.name || ''),
    userName: String(printLogin?.user?.name || whatsLogin?.user?.name || ''),
  };
  saveSettings(next);
  pushLog('system', `Login: ${next.tenantName} (${next.userName})`);
  pushLog('system', `Print key: ${next.printAgentKey ? 'OK' : 'FALHA'}`);
  pushLog('system', `WhatsApp key: ${next.whatsAgentKey ? 'OK' : 'FALHA'}`);
  return next;
});

ipcMain.handle('hub:save-settings', async (_ev, payload) => {
  const current = readSettings();
  const next = { ...current, ...payload };
  if (payload.serverUrl) next.serverUrl = normalizeServerUrl(payload.serverUrl);
  saveSettings(next);
  return next;
});

ipcMain.handle('hub:logout', async () => {
  stopAllAgents();
  saveSettings({ ...DEFAULT_SETTINGS });
  whatsState = { status: 'stopped', qrCode: '', phoneNumber: '', lastError: '' };
  printState = { status: 'stopped', lastError: '', lastJobAt: '' };
  logs = [];
  emit('whatsapp:state', whatsState);
  emit('print:state', printState);
  return { ok: true };
});

ipcMain.handle('hub:update-printer', async (_ev, payload) => {
  const current = readSettings();
  if (!current.printAgentKey) throw new Error('Faca login antes.');
  const printerName = String(payload.printerName || '').trim();
  const next = { ...current, printerName };
  saveSettings(next);
  // If print agent is running, restart it with new printer
  if (printWorker) {
    stopPrintWorker();
    setTimeout(() => startPrintWorker(), 1500);
  }
  return next;
});

// Individual agent controls
ipcMain.handle('hub:start-whatsapp', () => {
  startWhatsAppWorker();
  return { ok: true };
});

ipcMain.handle('hub:stop-whatsapp', () => {
  stopWhatsAppWorker();
  return { ok: true };
});

ipcMain.handle('hub:restart-whatsapp', () => {
  stopWhatsAppWorker();
  setTimeout(() => startWhatsAppWorker(), 2000);
  return { ok: true };
});

ipcMain.handle('hub:start-print', () => {
  startPrintWorker();
  return { ok: true };
});

ipcMain.handle('hub:stop-print', () => {
  stopPrintWorker();
  return { ok: true };
});

ipcMain.handle('hub:toggle-autostart', async (_ev, payload) => {
  const current = readSettings();
  const next = { ...current };
  if (payload.autoStartWithWindows !== undefined) {
    next.autoStartWithWindows = Boolean(payload.autoStartWithWindows);
    applyWindowsStartup(next.autoStartWithWindows);
  }
  if (payload.autoStartWhatsApp !== undefined) {
    next.autoStartWhatsApp = Boolean(payload.autoStartWhatsApp);
  }
  if (payload.autoStartPrint !== undefined) {
    next.autoStartPrint = Boolean(payload.autoStartPrint);
  }
  saveSettings(next);
  return next;
});

/* ─── app lifecycle ──────────────────────────────────────────── */

app.whenReady().then(async () => {
  if (!gotLock) return;
  createMainWindow();
  createTray();

  // Apply Windows startup setting
  const saved = readSettings();
  applyWindowsStartup(saved.autoStartWithWindows);

  // Auto-start agents if logged in
  void syncAutoStartAgents();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
      createTray();
    } else {
      showMainWindow();
    }
  });
});

app.on('second-instance', () => showMainWindow());
app.on('window-all-closed', () => { /* mantém na bandeja */ });

app.on('before-quit', (event) => {
  if (!forceQuit) {
    event.preventDefault();
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
    }
  }
});
