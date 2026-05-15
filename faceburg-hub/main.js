/* eslint-disable no-console */
const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, safeStorage, shell, session } = require('electron');
const { fork, execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const QRCode = require('qrcode');
const { autoUpdater } = require('electron-updater');
const electronLocalshortcut = require('electron-localshortcut');
const numeroPorExtenso = require('numero-por-extenso');
const { printTextWindows, sendCutCommandWindows } = require('./agents/native-printer');

/* ─── constants ──────────────────────────────────────────────── */

const DEFAULT_SETTINGS = {
  serverUrl: 'https://faceburg.vercel.app',
  slug: '',
  email: '',
  password: '',
  printAgentKey: '',
  whatsAgentKey: '',
  printerName: '',
  tenantName: '',
  userName: '',
  autoStartWithWindows: true,
  autoStartWhatsApp: false,
  autoStartPrint: false,
  lastSystemUrl: '',
};

const LOG_MAX = 200;
const WORKER_RESTART_DELAY_MS = 5000;
const WHATSAPP_STOP_GRACE_MS = 5000;
const PRINT_STOP_GRACE_MS = 3000;
const SYSTEM_PARTITION = 'persist:faceburg-system';
const SESSION_COOKIE_NAME = 'faceburg_session';

/* ─── state ──────────────────────────────────────────────────── */

let mainWindow = null;
let tray = null;
let trayIcon = null;
let forceQuit = false;
let trayHintShown = false;
let isSystemShutdown = false;

let whatsWorker = null;
let printWorker = null;
let whatsWorkerRestartTimer = null;
let printWorkerRestartTimer = null;
let whatsStopRequested = false;
let printStopRequested = false;
let whatsRestartRequested = false;
let printRestartRequested = false;
let whatsRestartDelayMs = 1500;
let printRestartDelayMs = 1500;
let whatsRestartReason = 'reinicio solicitado pelo hub';
let printRestartReason = 'reinicio solicitado pelo hub';

let whatsState = { status: 'stopped', qrCode: '', phoneNumber: '', lastError: '' };
let printState = { status: 'stopped', lastError: '', lastJobAt: '' };
let logs = [];
let systemSessionSyncPromise = null;
let workerRequestSeq = 0;
const pendingWorkerRequests = new Map();
let settingsCache = null;

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) app.quit();

const APP_USER_MODEL_ID = 'com.faceburg.app';
const WINDOW_ICON_FILE = 'logorbs.ico';
const TRAY_ICON_FILE = 'logorbs-32.png';

/* ─── settings ───────────────────────────────────────────────── */

function settingsFilePath() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function assetPath(fileName) {
  return path.join(__dirname, 'assets', fileName);
}

function loadImageFromAssets(fileName, resizeOptions = null) {
  try {
    const image = nativeImage.createFromPath(assetPath(fileName));
    if (!image.isEmpty()) {
      return resizeOptions ? image.resize(resizeOptions) : image;
    }
  } catch {}
  return nativeImage.createEmpty();
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

function migrateDefaultServerUrl(settings) {
  const serverUrl = String(settings.serverUrl || '').replace(/\/$/, '');

  if (serverUrl === 'http://localhost:3000' || serverUrl === 'http://127.0.0.1:3000') {
    return {
      ...settings,
      serverUrl: DEFAULT_SETTINGS.serverUrl,
      lastSystemUrl: '',
    };
  }

  return settings;
}

function readSettings() {
  if (settingsCache) return { ...settingsCache };
  try {
    const f = settingsFilePath();
    if (!fs.existsSync(f)) return { ...DEFAULT_SETTINGS };
    const raw = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    const password =
      raw.passwordEncrypted
        ? decryptPassword(String(raw.passwordEncrypted))
        : String(raw.password || '');
    const result = migrateDefaultServerUrl({
      ...raw,
      password,
    });
    settingsCache = result;
    return { ...result };
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
  settingsCache = { ...s };
}

function persistLastSystemUrl(url) {
  if (!url) return;
  const current = readSettings();
  const serverUrl = current.serverUrl ? normalizeServerUrl(current.serverUrl) : '';
  const safeUrl = getSafeSystemUrl(url, serverUrl || getConfiguredSystemUrl());
  if (current.lastSystemUrl === safeUrl) return;
  saveSettings({ ...current, lastSystemUrl: safeUrl });
}

/* ─── helpers ────────────────────────────────────────────────── */

function emit(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function getConfiguredSystemUrl() {
  const settings = readSettings();
  if (!settings.serverUrl) throw new Error('Configure a URL do servidor antes de abrir o sistema.');
  return normalizeServerUrl(settings.serverUrl);
}

function getSafeSystemUrl(candidate, serverUrl) {
  const fallbackUrl = `${serverUrl}/`;
  const raw = String(candidate || '').trim();
  if (!raw) return fallbackUrl;
  try {
    const parsed = new URL(raw);
    if (parsed.origin !== serverUrl) return fallbackUrl;
    return parsed.toString();
  } catch {
    return fallbackUrl;
  }
}

function getPreferredSystemUrl(preferredUrl = '') {
  const settings = readSettings();
  const serverUrl = getConfiguredSystemUrl();
  return getSafeSystemUrl(preferredUrl || settings.lastSystemUrl, serverUrl);
}

function isAllowedSystemUrl(url, allowedOrigin) {
  if (!url) return false;
  if (url === 'about:blank') return true;
  try {
    return new URL(url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

function bindMainWindowNavigation(targetUrl) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const allowedOrigin = new URL(targetUrl).origin;

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isAllowedSystemUrl(url, allowedOrigin)) {
      void mainWindow.loadURL(url);
      return { action: 'deny' };
    }
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isAllowedSystemUrl(url, allowedOrigin)) return;
    event.preventDefault();
    void shell.openExternal(url);
  });

  mainWindow.webContents.on('did-navigate', (_event, url) => {
    persistLastSystemUrl(url);
  });

  mainWindow.webContents.on('did-navigate-in-page', (_event, url) => {
    persistLastSystemUrl(url);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (!currentUrl || currentUrl === 'about:blank') return;
    persistLastSystemUrl(currentUrl);
  });
}

async function openSystemWindow(preferredUrl = '') {
  const targetUrl = getPreferredSystemUrl(preferredUrl);

  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow(targetUrl);
    return;
  }

  const currentUrl = mainWindow.webContents.getURL();
  if (currentUrl !== targetUrl) {
    await mainWindow.loadURL(targetUrl);
  }
  showMainWindow();
}

function pushLog(source, message) {
  const entry = { ts: new Date().toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }), source, message };
  logs.push(entry);
  if (logs.length > LOG_MAX) logs = logs.slice(-LOG_MAX);
  emit('agent:log', entry);
}

function handleWorkerResponse(msg) {
  if (!msg || msg.type !== 'local-response' || !msg.requestId) return false;
  const pending = pendingWorkerRequests.get(msg.requestId);
  if (!pending) return true;
  clearTimeout(pending.timer);
  pendingWorkerRequests.delete(msg.requestId);
  if (msg.ok) {
    pending.resolve(msg.data || {});
    return true;
  }
  pending.reject(new Error(String(msg.error || 'Falha no agente local.')));
  return true;
}

function rejectWorkerRequestsFor(worker, error) {
  for (const [requestId, pending] of pendingWorkerRequests.entries()) {
    if (pending.worker !== worker) continue;
    clearTimeout(pending.timer);
    pendingWorkerRequests.delete(requestId);
    pending.reject(error);
  }
}

function sendWorkerRequest(worker, type, payload = {}, timeoutMs = 30000) {
  if (!worker || worker.killed) {
    return Promise.reject(new Error('Agente local nao esta em execucao.'));
  }

  const requestId = `local-${Date.now()}-${++workerRequestSeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingWorkerRequests.delete(requestId);
      reject(new Error('Tempo esgotado aguardando o agente local.'));
    }, timeoutMs);

    pendingWorkerRequests.set(requestId, { worker, resolve, reject, timer });
    try {
      worker.send({ type, requestId, payload });
    } catch (error) {
      clearTimeout(timer);
      pendingWorkerRequests.delete(requestId);
      reject(error);
    }
  });
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

async function fetchJsonWithStatus(url, options = {}) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    status: response.status,
    data,
  };
}

function getSystemSession() {
  return session.fromPartition(SYSTEM_PARTITION);
}

async function getSystemSessionCookieHeader(serverUrl) {
  const cookies = await getSystemSession().cookies.get({ url: serverUrl, name: SESSION_COOKIE_NAME });
  const activeCookie = cookies.find((item) => Boolean(item.value));
  if (!activeCookie?.value) return '';
  return `${SESSION_COOKIE_NAME}=${activeCookie.value}`;
}

async function getSystemSessionProfile(serverUrl, cookieHeader) {
  const profileResult = await fetchJsonWithStatus(`${serverUrl}/api/auth/me`, {
    method: 'GET',
    headers: {
      cookie: cookieHeader,
      'cache-control': 'no-cache',
    },
  });
  if (!profileResult.ok || !profileResult.data?.authenticated) {
    throw new Error('Entre no sistema nesta janela antes de ativar os agentes.');
  }
  return profileResult.data;
}

async function refreshAgentCredentialsFromSystemSession(options = {}) {
  const current = readSettings();
  if (!current.serverUrl) {
    throw new Error('Configure a URL do servidor antes de ativar os agentes.');
  }

  const cookieHeader = await getSystemSessionCookieHeader(current.serverUrl);
  if (!cookieHeader) {
    throw new Error('Entre no sistema nesta janela antes de ativar os agentes.');
  }

  const profile = await getSystemSessionProfile(current.serverUrl, cookieHeader);
  const shouldSyncWhats = options.syncWhats !== false;
  const shouldSyncPrint = options.syncPrint !== false;

  const [whatsLogin, printLogin] = await Promise.all([
    shouldSyncWhats
      ? fetchJson(`${current.serverUrl}/api/whatsapp/agent/session-login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
        },
        body: '{}',
      })
      : Promise.resolve(null),
    shouldSyncPrint
      ? fetchJson(`${current.serverUrl}/api/print/agent/session-login`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          cookie: cookieHeader,
        },
        body: '{}',
      })
      : Promise.resolve(null),
  ]);

  const next = {
    ...current,
    slug: String(profile?.tenant?.slug || current.slug || ''),
    email: String(profile?.user?.email || current.email || ''),
    whatsAgentKey: String(whatsLogin?.agentKey || current.whatsAgentKey || ''),
    printAgentKey: String(printLogin?.agentKey || current.printAgentKey || ''),
    printerName: String(printLogin?.printerName || current.printerName || ''),
    tenantName: String(profile?.tenant?.name || current.tenantName || ''),
    userName: String(profile?.user?.name || current.userName || ''),
  };
  saveSettings(next);

  if (!options.silent) {
    pushLog('system', 'Sessao do sistema reconhecida. App local sincronizado com o login web.');
  }

  return {
    authenticated: true,
    profile,
    settings: next,
  };
}

function syncAgentCredentialsFromSystemSessionOnce() {
  if (!systemSessionSyncPromise) {
    systemSessionSyncPromise = refreshAgentCredentialsFromSystemSession({ silent: true })
      .finally(() => {
        systemSessionSyncPromise = null;
      });
  }
  return systemSessionSyncPromise;
}

/* ─── Windows startup ────────────────────────────────────────── */

function applyWindowsStartup(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      name: 'Faceburg App',
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
  if (!current.serverUrl) {
    return current;
  }

  if (!current.slug || !current.email || !current.password) {
    // On cold boot, there's no web session yet; skip if we already have agent keys.
    if (current.whatsAgentKey || current.printAgentKey) {
      pushLog('system', 'Usando credenciais de agentes ja salvas (cold boot).');
      return current;
    }
    try {
      const synced = await refreshAgentCredentialsFromSystemSession({ silent: true });
      return synced.settings;
    } catch {
      return current;
    }
  }

  try {
    const [printLogin, whatsLogin] = await Promise.all([
      fetchJson(`${current.serverUrl}/api/print/agent/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: current.slug,
          email: current.email,
          password: current.password,
          printerName: current.printerName || '',
        }),
      }),
      fetchJson(`${current.serverUrl}/api/whatsapp/agent/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: current.slug,
          email: current.email,
          password: current.password,
        }),
      }),
    ]);

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
  const startedAt = Date.now();
  const STARTUP_WARN_MS = 10000;
  const warnTimer = setTimeout(() => {
    pushLog('system', 'Startup dos agentes ainda em andamento...');
  }, STARTUP_WARN_MS);

  try {
    const saved = await refreshAgentCredentialsIfPossible();
    if (!saved.serverUrl) return;

    if (saved.autoStartWhatsApp && saved.whatsAgentKey) {
      const enabled = await checkServerAgentEnabled(saved.serverUrl, saved.whatsAgentKey, 'whatsapp');
      if (enabled) {
        try {
          await startWhatsAppWorker();
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
          await startPrintWorker();
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
  } finally {
    clearTimeout(warnTimer);
    const elapsed = Date.now() - startedAt;
    pushLog('system', `Startup dos agentes concluido em ${Math.round(elapsed / 1000)}s.`);
  }
}

function clearWhatsAppWorkerRestartTimer() {
  if (!whatsWorkerRestartTimer) return;
  clearTimeout(whatsWorkerRestartTimer);
  whatsWorkerRestartTimer = null;
}

function clearPrintWorkerRestartTimer() {
  if (!printWorkerRestartTimer) return;
  clearTimeout(printWorkerRestartTimer);
  printWorkerRestartTimer = null;
}

function scheduleWhatsAppWorkerRestart(reason, delayMs = WORKER_RESTART_DELAY_MS) {
  if (forceQuit || whatsWorker || whatsWorkerRestartTimer) return;
  whatsWorkerRestartTimer = setTimeout(async () => {
    whatsWorkerRestartTimer = null;
    if (forceQuit || whatsWorker) return;

    const settings = readSettings();
    if (!settings.autoStartWhatsApp || !settings.whatsAgentKey || !settings.serverUrl) {
      pushLog('whatsapp', 'Reinicio cancelado: auto-start do WhatsApp desativado.');
      return;
    }

    const enabled = await checkServerAgentEnabled(settings.serverUrl, settings.whatsAgentKey, 'whatsapp');
    if (!enabled) {
      pushLog('whatsapp', 'Reinicio cancelado: agente WhatsApp desativado no sistema.');
      return;
    }

    try {
      await startWhatsAppWorker();
    } catch (err) {
      pushLog('whatsapp', `Falha ao reiniciar worker: ${err?.message || err}`);
      scheduleWhatsAppWorkerRestart('nova tentativa apos falha', delayMs);
    }
  }, delayMs);
  pushLog('whatsapp', `Worker sera reiniciado em ${Math.max(1, Math.round(delayMs / 1000))}s (${reason}).`);
}

function schedulePrintWorkerRestart(reason, delayMs = WORKER_RESTART_DELAY_MS) {
  if (forceQuit || printWorker || printWorkerRestartTimer) return;
  printWorkerRestartTimer = setTimeout(async () => {
    printWorkerRestartTimer = null;
    if (forceQuit || printWorker) return;

    const settings = readSettings();
    if (!settings.autoStartPrint || !settings.printAgentKey || !settings.serverUrl) {
      pushLog('print', 'Reinicio cancelado: auto-start da impressao desativado.');
      return;
    }

    const enabled = await checkServerAgentEnabled(settings.serverUrl, settings.printAgentKey, 'print');
    if (!enabled) {
      pushLog('print', 'Reinicio cancelado: agente de impressao desativado no sistema.');
      return;
    }

    try {
      await startPrintWorker();
    } catch (err) {
      pushLog('print', `Falha ao reiniciar worker: ${err?.message || err}`);
      schedulePrintWorkerRestart('nova tentativa apos falha', delayMs);
    }
  }, delayMs);
  pushLog('print', `Worker sera reiniciado em ${Math.max(1, Math.round(delayMs / 1000))}s (${reason}).`);
}

function restartWhatsAppWorker(reason = 'reinicio solicitado', delayMs = 1500) {
  whatsRestartRequested = true;
  whatsRestartDelayMs = delayMs;
  whatsRestartReason = reason;
  stopWhatsAppWorker({ restartAfterExit: true, reason, delayMs });
}

function restartPrintWorker(reason = 'reinicio solicitado', delayMs = 1500) {
  printRestartRequested = true;
  printRestartDelayMs = delayMs;
  printRestartReason = reason;
  stopPrintWorker({ restartAfterExit: true, reason, delayMs });
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

async function startWhatsAppWorker() {
  if (whatsWorker) {
    emit('whatsapp:state', whatsState);
    return;
  }
  let settings = readSettings();
  if (!settings.serverUrl) throw new Error('Configure a URL do servidor antes de abrir o WhatsApp.');

  try {
    const synced = await refreshAgentCredentialsFromSystemSession({ syncPrint: false });
    settings = synced.settings;
  } catch (error) {
    if (!settings.whatsAgentKey) throw error;
    pushLog('whatsapp', 'Usando credencial WhatsApp ja salva neste computador.');
  }

  if (!settings.whatsAgentKey) throw new Error('Entre no sistema nesta janela antes de abrir o WhatsApp.');
  clearWhatsAppWorkerRestartTimer();
  whatsStopRequested = false;
  whatsRestartRequested = false;

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
  const workerRef = whatsWorker;

  whatsWorker.stdout?.on('data', (d) => pushLog('whatsapp', d.toString().trim()));
  whatsWorker.stderr?.on('data', (d) => pushLog('whatsapp', `[ERR] ${d.toString().trim()}`));

  whatsWorker.on('message', (msg) => {
    if (handleWorkerResponse(msg)) return;
    if (whatsStopRequested) return;
    if (msg.type === 'state') {
      whatsState = { ...whatsState, ...msg.data };
      emit('whatsapp:state', whatsState);
    } else if (msg.type === 'log') {
      pushLog('whatsapp', msg.text);
    }
  });

  whatsWorker.on('error', (error) => {
    pushLog('whatsapp', `Falha no processo do worker: ${error?.message || error}`);
  });

  whatsWorker.on('exit', (code, signal) => {
    const expectedStop = whatsStopRequested || forceQuit;
    const restartAfterExit = whatsRestartRequested;
    pushLog(
      'whatsapp',
      expectedStop
        ? `Worker encerrado (${signal || code || 0}).`
        : `Worker caiu (${signal || code || 0}). Preparando recuperacao automatica.`,
    );
    if (whatsWorker === workerRef) {
      whatsWorker = null;
    }
    rejectWorkerRequestsFor(workerRef, new Error('Agente WhatsApp encerrou antes de responder.'));
    whatsStopRequested = false;
    whatsRestartRequested = false;
    whatsState.status = 'stopped';
    emit('whatsapp:state', whatsState);

    if (restartAfterExit && !forceQuit) {
      scheduleWhatsAppWorkerRestart(whatsRestartReason, whatsRestartDelayMs);
      return;
    }

    if (!expectedStop && !forceQuit) {
      scheduleWhatsAppWorkerRestart('saida inesperada do worker');
    }
  });

  whatsState.status = 'connecting';
  emit('whatsapp:state', whatsState);
  pushLog('whatsapp', 'Agente WhatsApp iniciado.');
}

function stopWhatsAppWorker(options = {}) {
  clearWhatsAppWorkerRestartTimer();
  whatsStopRequested = true;
  whatsRestartRequested = Boolean(options.restartAfterExit);
  const ref = whatsWorker;
  if (!ref) {
    whatsState = { status: 'stopped', qrCode: '', phoneNumber: '', lastError: '' };
    emit('whatsapp:state', whatsState);
    pushLog('whatsapp', options.restartAfterExit ? 'Reiniciando agente WhatsApp...' : 'Agente WhatsApp parado.');
    whatsStopRequested = false;
    whatsRestartRequested = false;
    if (options.restartAfterExit && !forceQuit) {
      scheduleWhatsAppWorkerRestart(String(options.reason || whatsRestartReason), Number(options.delayMs || whatsRestartDelayMs));
    }
    return;
  }
  try {
    ref.send({ type: 'shutdown' });
  } catch {}
  setTimeout(() => {
    if (ref && whatsWorker === ref && !ref.killed) {
      try { ref.kill('SIGTERM'); } catch {}
    }
  }, Number(options.killDelayMs || WHATSAPP_STOP_GRACE_MS));
  whatsState = { status: 'stopped', qrCode: '', phoneNumber: '', lastError: '' };
  emit('whatsapp:state', whatsState);
  pushLog('whatsapp', options.restartAfterExit ? 'Reiniciando agente WhatsApp...' : 'Agente WhatsApp parado.');
}

/* ─── Print worker ───────────────────────────────────────────── */

async function startPrintWorker() {
  if (printWorker) return;
  let settings = readSettings();
  if (!settings.serverUrl) throw new Error('Configure a URL do servidor antes de ativar a impressao.');

  try {
    const synced = await refreshAgentCredentialsFromSystemSession({ syncWhats: false });
    settings = synced.settings;
  } catch (error) {
    if (!settings.printAgentKey) throw error;
    pushLog('print', 'Usando credencial de impressao ja salva neste computador.');
  }

  if (!settings.printAgentKey) throw new Error('Entre no sistema nesta janela antes de ativar a impressao.');
  clearPrintWorkerRestartTimer();
  printStopRequested = false;
  printRestartRequested = false;

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
  const workerRef = printWorker;

  printWorker.stdout?.on('data', (d) => pushLog('print', d.toString().trim()));
  printWorker.stderr?.on('data', (d) => pushLog('print', `[ERR] ${d.toString().trim()}`));

  printWorker.on('message', (msg) => {
    if (handleWorkerResponse(msg)) return;
    if (printStopRequested) return;
    if (msg.type === 'state') {
      printState = { ...printState, ...msg.data };
      emit('print:state', printState);
    } else if (msg.type === 'log') {
      pushLog('print', msg.text);
    }
  });

  printWorker.on('error', (error) => {
    pushLog('print', `Falha no processo do worker: ${error?.message || error}`);
  });

  printWorker.on('exit', (code, signal) => {
    const expectedStop = printStopRequested || forceQuit;
    const restartAfterExit = printRestartRequested;
    pushLog(
      'print',
      expectedStop
        ? `Worker encerrado (${signal || code || 0}).`
        : `Worker caiu (${signal || code || 0}). Preparando recuperacao automatica.`,
    );
    if (printWorker === workerRef) {
      printWorker = null;
    }
    rejectWorkerRequestsFor(workerRef, new Error('Agente de impressao encerrou antes de responder.'));
    printStopRequested = false;
    printRestartRequested = false;
    printState.status = 'stopped';
    emit('print:state', printState);

    if (restartAfterExit && !forceQuit) {
      schedulePrintWorkerRestart(printRestartReason, printRestartDelayMs);
      return;
    }

    if (!expectedStop && !forceQuit) {
      schedulePrintWorkerRestart('saida inesperada do worker');
    }
  });

  printState.status = 'connecting';
  emit('print:state', printState);
  pushLog('print', 'Agente de impressao iniciado.');
}

function stopPrintWorker(options = {}) {
  clearPrintWorkerRestartTimer();
  printStopRequested = true;
  printRestartRequested = Boolean(options.restartAfterExit);
  const ref = printWorker;
  if (!ref) {
    printState = { status: 'stopped', lastError: '', lastJobAt: '' };
    emit('print:state', printState);
    pushLog('print', options.restartAfterExit ? 'Reiniciando agente de impressao...' : 'Agente de impressao parado.');
    printStopRequested = false;
    printRestartRequested = false;
    if (options.restartAfterExit && !forceQuit) {
      schedulePrintWorkerRestart(String(options.reason || printRestartReason), Number(options.delayMs || printRestartDelayMs));
    }
    return;
  }
  try {
    ref.send({ type: 'shutdown' });
  } catch {}
  setTimeout(() => {
    if (ref && printWorker === ref && !ref.killed) {
      try { ref.kill('SIGTERM'); } catch {}
    }
  }, Number(options.killDelayMs || PRINT_STOP_GRACE_MS));
  printState = { status: 'stopped', lastError: '', lastJobAt: '' };
  emit('print:state', printState);
  pushLog('print', options.restartAfterExit ? 'Reiniciando agente de impressao...' : 'Agente de impressao parado.');
}

function stopAllAgents() {
  stopWhatsAppWorker();
  stopPrintWorker();
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeReceiptPayload(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trimEnd();
}

function normalizePrintFontSize(value) {
  const parsed = Number(String(value || '').replace(',', '.'));
  if (!Number.isFinite(parsed)) return 12.5;
  return Math.min(24, Math.max(8, parsed));
}

function paperWidthMmForColumns(columns) {
  const parsed = Number(columns || 32);
  return parsed >= 48 || parsed === 80 ? 80 : 58;
}

function isDividerLine(value) {
  const clean = String(value || '').trim();
  return clean.length >= 6 && /^[-_=*]+$/.test(clean);
}

function isHeaderLine(value) {
  const upper = String(value || '').trim().toUpperCase();
  return (
    upper === 'DELIVERY' ||
    upper === 'RETIRADA' ||
    upper === 'RETIRADA NA LOJA' ||
    upper === 'BALCAO' ||
    upper === 'MESA' ||
    upper === 'COZINHA' ||
    upper === 'PEDIDO' ||
    upper.startsWith('PEDIDO #')
  );
}

function stripReceiptTags(value) {
  let current = String(value || '').trim();
  const state = {
    align: '',
    bold: false,
    big: false,
  };
  let changed = true;

  while (changed) {
    changed = false;
    for (const tag of ['center', 'right', 'b', 'strong', 'big']) {
      const pattern = new RegExp(`^\\s*<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>\\s*$`, 'i');
      const match = current.match(pattern);
      if (!match) continue;
      if (tag === 'center') state.align = 'center';
      if (tag === 'right') state.align = 'right';
      if (tag === 'b' || tag === 'strong') state.bold = true;
      if (tag === 'big') {
        state.bold = true;
        state.big = true;
      }
      current = String(match[1] || '').trim();
      changed = true;
    }
  }

  return { value: current, ...state };
}

async function renderReceiptHtml(payload) {
  const text = normalizeReceiptPayload(payload?.payloadText);
  if (!text.trim()) throw new Error('Conteudo de impressao vazio.');

  const columns = Number(payload?.columns || 32);
  const paperWidthMm = paperWidthMmForColumns(columns);
  const fontSizePt = normalizePrintFontSize(payload?.printTextSize);
  const qrWidth = paperWidthMm >= 80 ? 210 : 170;
  const rows = [];

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trimEnd();
    const clean = line.trim();
    if (!clean) {
      rows.push('<div class="spacer"></div>');
      continue;
    }

    const qrMatch = line.match(/^\s*(?:<qrcode>|<qr>|\[qrcode\]|\[qr\]|QR:)\s*(.*?)\s*(?:<\/qrcode>|<\/qr>|\[\/qrcode\]|\[\/qr\])?\s*$/i);
    if (qrMatch && qrMatch[1]?.trim()) {
      const qrDataUrl = await QRCode.toDataURL(qrMatch[1].trim(), {
        margin: 1,
        width: qrWidth,
      });
      rows.push(`<div class="qr"><img alt="" src="${qrDataUrl}"></div>`);
      continue;
    }

    if (isDividerLine(clean)) {
      rows.push('<div class="rule"></div>');
      continue;
    }

    const parsed = stripReceiptTags(clean);
    const leadingSpaces = line.length - line.trimStart().length;
    const looksCentered = leadingSpaces >= 2 && clean.length <= Math.max(8, columns - (leadingSpaces * 2));
    const header = isHeaderLine(parsed.value);
    const total = parsed.value.trimStart().toUpperCase().startsWith('TOTAL:');
    const classes = ['line'];
    if (parsed.align === 'center' || looksCentered || header) classes.push('center');
    if (parsed.align === 'right') classes.push('right');
    if (parsed.bold || header || total) classes.push('bold');
    if (parsed.big || header) classes.push('big');

    rows.push(`<div class="${classes.join(' ')}">${escapeHtml(parsed.value)}</div>`);
  }

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    @page { size: ${paperWidthMm}mm auto; margin: 0; }
    html, body { margin: 0; padding: 0; background: #fff; color: #000; }
    body {
      width: ${paperWidthMm}mm;
      box-sizing: border-box;
      padding: ${paperWidthMm >= 80 ? '3mm 4mm' : '2mm 2.5mm'};
      font-family: Consolas, "Courier New", "Lucida Console", monospace;
      font-size: ${fontSizePt}pt;
      line-height: 1.22;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .line { white-space: pre-wrap; overflow-wrap: anywhere; }
    .center { text-align: center; }
    .right { text-align: right; }
    .bold { font-weight: 700; }
    .big { font-size: 1.2em; line-height: 1.18; margin: 1mm 0; }
    .spacer { height: 3.2mm; }
    .rule { border-top: 1px solid #000; margin: 1.4mm 0; height: 0; }
    .qr { text-align: center; margin: 2mm 0; }
    .qr img { width: ${qrWidth}px; height: ${qrWidth}px; }
  </style>
</head>
<body>${rows.join('')}</body>
</html>`;
}

async function printReceiptWithCss(payload) {
  const html = await renderReceiptHtml(payload);
  const settings = readSettings();
  const printerName = String(payload?.printerName || settings.printerName || '').trim();
  const printWindow = new BrowserWindow({
    show: false,
    width: 420,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  try {
    await printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    await new Promise((resolve, reject) => {
      printWindow.webContents.print({
        silent: true,
        printBackground: true,
        deviceName: printerName || undefined,
        margins: { marginType: 'none' },
      }, (success, failureReason) => {
        if (success) {
          resolve();
          return;
        }
        reject(new Error(failureReason || 'Falha ao imprimir pelo Electron.'));
      });
    });
    const cutResult = process.platform === 'win32'
      ? await sendCutCommandWindows(printerName).catch((error) => ({
          strategy: 'raw-command',
          printerName,
          skipped: true,
          reason: error?.message || String(error || 'cut-failed'),
        }))
      : { skipped: true, reason: 'unsupported-platform' };
    return {
      strategy: 'electron-css',
      printerName,
      cut: cutResult,
      local: true,
    };
  } finally {
    if (!printWindow.isDestroyed()) {
      printWindow.close();
    }
  }
}

async function printDirectFromHub(payload) {
  const settings = readSettings();
  const printerName = String(payload?.printerName || settings.printerName || '').trim();
  try {
    const result = await printReceiptWithCss({ ...payload, printerName });
    const cutInfo = result.cut?.command === 'cut'
      ? ' com corte'
      : result.cut?.skipped
        ? ' sem corte RAW'
        : '';
    pushLog('print', `Job local enviado via CSS${printerName ? ` (${printerName})` : ''}${cutInfo}.`);
    return result;
  } catch (error) {
    const reason = error?.message || String(error || 'falha desconhecida');
    pushLog('print', `Impressao CSS falhou, usando fallback nativo: ${reason}`);
    const result = await printTextWindows(String(payload?.payloadText || ''), printerName);
    return {
      ...result,
      local: true,
    };
  }
}

async function sendWhatsAppDirectFromHub(payload) {
  if (!whatsWorker) {
    await startWhatsAppWorker();
  }
  if (!whatsWorker) throw new Error('Agente WhatsApp nao iniciou.');
  if (whatsState.status !== 'ready') {
    throw new Error('WhatsApp ainda nao esta conectado neste computador.');
  }
  return sendWorkerRequest(whatsWorker, 'whatsapp-send-direct', payload, 30000);
}

/* ─── system tray ────────────────────────────────────────────── */

function buildTrayIcon() {
  const assetIcon = loadImageFromAssets(TRAY_ICON_FILE, { width: 16, height: 16 });
  if (!assetIcon.isEmpty()) {
    return assetIcon;
  }

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
  tray.setToolTip('Faceburg App');

  const ctxMenu = Menu.buildFromTemplate([
    { label: 'Abrir Faceburg App', click: () => showMainWindow() },
    { type: 'separator' },
    { label: 'Sair', click: () => { forceQuit = true; stopAllAgents(); setTimeout(() => app.quit(), 1000); } },
  ]);

  tray.setContextMenu(ctxMenu);
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      mainWindow.setSkipTaskbar(true);
      return;
    }
    showMainWindow();
  });
}

/* ─── main window ────────────────────────────────────────────── */

function createMainWindow(preferredUrl = '') {
  const targetUrl = getPreferredSystemUrl(preferredUrl);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1024,
    minHeight: 720,
    autoHideMenuBar: true,
    title: 'Faceburg App',
    icon: assetPath(WINDOW_ICON_FILE),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      partition: SYSTEM_PARTITION,
    },
  });

  bindMainWindowNavigation(targetUrl);
  void mainWindow.loadURL(targetUrl).catch((error) => {
    pushLog('system', `Falha ao carregar o sistema: ${error?.message || error}`);
  });

  mainWindow.on('close', (event) => {
    if (forceQuit) return;
    event.preventDefault();
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);
    if (tray && !trayHintShown) {
      trayHintShown = true;
      tray.displayBalloon({ iconType: 'info', title: 'Faceburg App', content: 'O app continua ativo na bandeja do sistema.' });
    }
  });

  mainWindow.on('closed', () => { mainWindow = null; });

  electronLocalshortcut.register(mainWindow, 'F5', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.reload();
    }
  });
}

function initAutoUpdater() {
  autoUpdater.on('update-available', () => {
    pushLog('system', 'Nova atualizacao disponivel. Baixando...');
    emit('system:update-available', {});
  });
  autoUpdater.on('download-progress', (progress) => {
    emit('system:update-progress', progress);
  });
  autoUpdater.on('update-downloaded', () => {
    pushLog('system', 'Atualizacao baixada. O app sera reiniciado em breve.');
    emit('system:update-downloaded', {});
    setTimeout(() => {
      forceQuit = true;
      stopAllAgents();
      setTimeout(() => autoUpdater.quitAndInstall(false, true), 1000);
    }, 5000);
  });
  
  setTimeout(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 10000);
  setInterval(() => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => {});
  }, 4 * 60 * 60 * 1000);
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
  if (payload.serverUrl) {
    next.serverUrl = normalizeServerUrl(payload.serverUrl);
    if (!payload.lastSystemUrl) {
      next.lastSystemUrl = '';
    }
  }
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
    restartPrintWorker('troca de impressora', 1500);
  }
  return next;
});

// Individual agent controls
ipcMain.handle('hub:start-whatsapp', async () => {
  await startWhatsAppWorker();
  return { ok: true };
});

ipcMain.handle('hub:stop-whatsapp', () => {
  stopWhatsAppWorker();
  return { ok: true };
});

ipcMain.handle('hub:restart-whatsapp', () => {
  restartWhatsAppWorker('reinicio manual do operador', 1500);
  return { ok: true };
});

ipcMain.handle('hub:start-print', async () => {
  await startPrintWorker();
  return { ok: true };
});

ipcMain.handle('hub:restart-print', async () => {
  restartPrintWorker('reconexao solicitada pela tela de pedidos', 700);
  return { ok: true };
});

ipcMain.handle('hub:stop-print', () => {
  stopPrintWorker();
  return { ok: true };
});

ipcMain.handle('hub:print-direct', async (_ev, payload) => {
  const result = await printDirectFromHub(payload);
  return { ok: true, ...result };
});

ipcMain.handle('hub:whatsapp-send-direct', async (_ev, payload) => {
  const result = await sendWhatsAppDirectFromHub(payload);
  return { ok: true, ...result };
});

ipcMain.handle('hub:open-system', async (_ev, payload) => {
  await openSystemWindow(String(payload?.url || ''));
  return { ok: true };
});

ipcMain.handle('hub:numero-por-extenso', (_ev, payload) => {
  try {
    const parsed = Number(String(payload).replace(',', '.'));
    if (!Number.isFinite(parsed)) return String(payload);
    return numeroPorExtenso.porExtenso(parsed);
  } catch {
    return String(payload);
  }
});

ipcMain.handle('hub:sync-system-session', async () => {
  try {
    const synced = await syncAgentCredentialsFromSystemSessionOnce();
    return synced;
  } catch (error) {
    return {
      authenticated: false,
      error: error?.message || String(error || 'Sessao indisponivel.'),
      settings: readSettings(),
    };
  }
});

ipcMain.handle('hub:get-system-url', () => {
  const settings = readSettings();
  return {
    homeUrl: getSafeSystemUrl('', getConfiguredSystemUrl()),
    lastUrl: getPreferredSystemUrl(settings.lastSystemUrl),
  };
});

ipcMain.handle('hub:clear-system-url', async () => {
  const current = readSettings();
  const next = { ...current, lastSystemUrl: '' };
  saveSettings(next);
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
  app.setAppUserModelId(APP_USER_MODEL_ID);
  createMainWindow();
  createTray();

  // Apply Windows startup setting
  const saved = readSettings();
  applyWindowsStartup(saved.autoStartWithWindows);

  // Auto-start agents if logged in
  void syncAutoStartAgents();

  // Initialize auto-updater
  initAutoUpdater();

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
  if (forceQuit) return;

  // Detect system shutdown / logoff: if the window is not visible,
  // the user triggered quit from outside (e.g. system shutdown).
  // Also, Electron sets app.isQuitting internally on some paths.
  const windowHidden = !mainWindow || mainWindow.isDestroyed() || !mainWindow.isVisible();
  if (windowHidden) {
    // System shutdown — do graceful cleanup and let the app exit.
    isSystemShutdown = true;
    forceQuit = true;
    stopAllAgents();
    return;
  }

  // User closed the window — just hide to tray.
  event.preventDefault();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.hide();
    mainWindow.setSkipTaskbar(true);
  }
});
