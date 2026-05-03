/* eslint-disable no-alert */

const DEFAULT_SERVER_URL = 'http://localhost:3000';

const $ = (selector) => document.querySelector(selector);

let currentSettings = null;
let currentWhatsState = { status: 'stopped' };
let whatsRunning = false;
let sessionAuthenticated = false;
let syncingSession = false;

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Informe a URL do servidor.');
  const withProtocol = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
  const parsed = new URL(withProtocol);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Use http:// ou https://');
  }
  return parsed.origin;
}

function getServerUrl() {
  return currentSettings?.serverUrl || DEFAULT_SERVER_URL;
}

function getSystemHomeUrl() {
  return `${getServerUrl()}/`;
}

function getWebview() {
  return $('#system-webview');
}

function setRuntimeStatus(text) {
  $('#runtime-status').textContent = text;
}

function renderServerLabel() {
  $('#server-label').textContent = getServerUrl();
}

function isSameOrigin(url) {
  try {
    return new URL(String(url || '')).origin === getServerUrl();
  } catch {
    return false;
  }
}

function getCurrentWebviewUrl() {
  const webview = getWebview();
  return webview.getURL?.() || webview.src || getSystemHomeUrl();
}

async function rememberSystemUrl(url) {
  if (!isSameOrigin(url)) return;
  const nextUrl = String(url || '').trim();
  if (!nextUrl || currentSettings?.lastSystemUrl === nextUrl) return;
  currentSettings = { ...(currentSettings || {}), lastSystemUrl: nextUrl };
  await window.hub.saveSettings({ lastSystemUrl: nextUrl });
}

function updateNavigationButtons() {
  const webview = getWebview();
  $('#btn-system-back').disabled = !webview.canGoBack?.();
  $('#btn-system-forward').disabled = !webview.canGoForward?.();
}

function setWhatsButtonState(running) {
  whatsRunning = running;
  const button = $('#btn-whats-toggle');
  button.textContent = running ? 'Fechar WhatsApp' : 'Abrir WhatsApp';
  button.className = running ? 'btn btn-danger' : 'btn btn-whatsapp';
}

function renderWhatsState(state) {
  currentWhatsState = { ...currentWhatsState, ...state };
  const chip = $('#whats-status-chip');

  if (currentWhatsState.status === 'ready') {
    chip.textContent = 'WhatsApp ativo';
    chip.className = 'status-chip status-chip-on';
    setRuntimeStatus('WhatsApp conectado. O sistema segue normal nesta janela e o agente responde em tempo real.');
    setWhatsButtonState(true);
    return;
  }

  if (currentWhatsState.status === 'connecting') {
    chip.textContent = 'Abrindo WhatsApp';
    chip.className = 'status-chip status-chip-warn';
    setRuntimeStatus('Abrindo a janela do WhatsApp Web. Se precisar, escaneie o QR nela.');
    setWhatsButtonState(true);
    return;
  }

  if (currentWhatsState.status === 'qr') {
    chip.textContent = 'Aguardando QR';
    chip.className = 'status-chip status-chip-warn';
    setRuntimeStatus('O QR code esta na janela do WhatsApp Web. Escaneie para concluir a conexao.');
    setWhatsButtonState(true);
    return;
  }

  if (currentWhatsState.status === 'disconnected' || currentWhatsState.status === 'auth_failure' || currentWhatsState.status === 'error') {
    chip.textContent = 'WhatsApp com erro';
    chip.className = 'status-chip status-chip-error';
    setRuntimeStatus(currentWhatsState.lastError || 'Houve uma falha no WhatsApp. Voce pode tentar abrir novamente.');
    setWhatsButtonState(false);
    return;
  }

  chip.textContent = sessionAuthenticated ? 'WhatsApp pronto' : 'WhatsApp desligado';
  chip.className = sessionAuthenticated ? 'status-chip status-chip-on' : 'status-chip status-chip-off';
  setRuntimeStatus(
    sessionAuthenticated
      ? 'Sistema conectado. Quando quiser, clique em Abrir WhatsApp.'
      : 'Entre no sistema normalmente nesta janela. Quando quiser, clique em Abrir WhatsApp.',
  );
  setWhatsButtonState(false);
}

function loadSystem(targetUrl, force = false) {
  const webview = getWebview();
  const nextUrl = String(targetUrl || getSystemHomeUrl());
  if (force || webview.src !== nextUrl) {
    webview.src = nextUrl;
  } else {
    webview.reload();
  }
  renderServerLabel();
}

async function configureServer() {
  const currentUrl = getServerUrl();
  const nextValue = window.prompt('URL do servidor Faceburg', currentUrl);
  if (nextValue === null) return;

  const normalized = normalizeServerUrl(nextValue);
  currentSettings = { ...(currentSettings || {}), serverUrl: normalized, lastSystemUrl: '' };
  await window.hub.saveSettings({ serverUrl: normalized, lastSystemUrl: '' });
  sessionAuthenticated = false;
  renderServerLabel();
  loadSystem(`${normalized}/`, true);
}

async function syncSystemSession() {
  if (syncingSession) return;
  syncingSession = true;

  try {
    const result = await window.hub.syncSystemSession();
    currentSettings = { ...(currentSettings || {}), ...(result.settings || {}) };
    sessionAuthenticated = Boolean(result.authenticated);
    renderServerLabel();

    if (currentWhatsState.status === 'stopped') {
      renderWhatsState({ status: 'stopped', lastError: '' });
    }
  } finally {
    syncingSession = false;
  }
}

function bindWebviewEvents() {
  const webview = getWebview();

  webview.addEventListener('did-start-loading', () => {
    if (currentWhatsState.status === 'stopped') {
      setRuntimeStatus('Carregando o sistema...');
    }
  });

  webview.addEventListener('did-stop-loading', async () => {
    updateNavigationButtons();
    await syncSystemSession();
    if (currentWhatsState.status === 'stopped') {
      setRuntimeStatus(
        sessionAuthenticated
          ? 'Sistema pronto. Clique em Abrir WhatsApp quando quiser.'
          : 'Sistema pronto. Use normalmente e ative o WhatsApp quando quiser.',
      );
    }
  });

  webview.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3) return;
    setRuntimeStatus(`Falha ao carregar o sistema: ${event.errorDescription || 'erro desconhecido'}.`);
  });

  webview.addEventListener('did-navigate', async (event) => {
    updateNavigationButtons();
    await rememberSystemUrl(event.url);
  });

  webview.addEventListener('did-navigate-in-page', async (event) => {
    updateNavigationButtons();
    await rememberSystemUrl(event.url);
  });
}

$('#btn-system-back').addEventListener('click', () => {
  const webview = getWebview();
  if (webview.canGoBack?.()) {
    webview.goBack();
  }
});

$('#btn-system-forward').addEventListener('click', () => {
  const webview = getWebview();
  if (webview.canGoForward?.()) {
    webview.goForward();
  }
});

$('#btn-config-server').addEventListener('click', async () => {
  try {
    await configureServer();
  } catch (error) {
    alert(error.message || 'Erro ao atualizar o servidor.');
  }
});

$('#btn-system-home').addEventListener('click', async () => {
  const homeUrl = getSystemHomeUrl();
  await rememberSystemUrl(homeUrl);
  loadSystem(homeUrl, true);
});

$('#btn-system-reload').addEventListener('click', () => {
  getWebview().reload();
});

$('#btn-open-window').addEventListener('click', async () => {
  try {
    await window.hub.openSystem({ url: getCurrentWebviewUrl() });
  } catch (error) {
    alert(error.message || 'Erro ao abrir o sistema em outra janela.');
  }
});

$('#btn-whats-toggle').addEventListener('click', async () => {
  const button = $('#btn-whats-toggle');
  button.disabled = true;

  try {
    if (whatsRunning) {
      await window.hub.stopWhatsApp();
      renderWhatsState({ status: 'stopped', lastError: '' });
    } else {
      await syncSystemSession();
      if (!sessionAuthenticated) {
        throw new Error('Entre no sistema nesta janela antes de abrir o WhatsApp.');
      }
      renderWhatsState({ status: 'connecting', lastError: '' });
      await window.hub.startWhatsApp();
    }
  } catch (error) {
    renderWhatsState({ status: 'error', lastError: error.message || 'Falha ao abrir o WhatsApp.' });
    alert(error.message || 'Falha ao abrir o WhatsApp.');
  } finally {
    button.disabled = false;
  }
});

window.hub.onWhatsAppState((state) => {
  renderWhatsState(state);
});

(async () => {
  bindWebviewEvents();

  const [initial, systemUrlState] = await Promise.all([
    window.hub.getSettings(),
    window.hub.getSystemUrl(),
  ]);

  currentSettings = initial.settings || { serverUrl: DEFAULT_SERVER_URL, lastSystemUrl: '' };
  renderServerLabel();

  if (initial.whatsState) {
    renderWhatsState(initial.whatsState);
  } else {
    renderWhatsState({ status: 'stopped' });
  }

  if (initial.whatsRunning) {
    setWhatsButtonState(true);
  }

  loadSystem(systemUrlState?.lastUrl || systemUrlState?.homeUrl || getSystemHomeUrl(), true);
  await syncSystemSession();
})();
