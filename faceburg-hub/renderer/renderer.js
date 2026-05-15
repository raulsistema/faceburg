/* eslint-disable no-alert */

const DEFAULT_SERVER_URL = 'https://faceburg.vercel.app';

const $ = (selector) => document.querySelector(selector);

let currentSettings = null;
let currentWhatsState = { status: 'stopped' };
let currentPrintState = { status: 'stopped' };
let currentAgentConfig = { print: null, whatsapp: null };
let availablePrinters = [];
let whatsRunning = false;
let printRunning = false;
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

function setConfigMessage(text, tone = '') {
  const message = $('#config-message');
  if (!message) return;
  message.textContent = text || '';
  message.className = `config-message ${tone ? `config-message-${tone}` : ''}`;
}

function setPrintState(status, text, className) {
  const chip = $('#print-status-chip');
  chip.textContent = text;
  chip.className = `status-chip ${className}`;
  currentPrintState = { ...currentPrintState, status };
}

function renderPrintState(state = {}) {
  currentPrintState = { ...currentPrintState, ...state };
  const status = String(currentPrintState.status || 'stopped');
  printRunning = status === 'ready' || status === 'connecting';

  if (status === 'ready') {
    setPrintState(status, 'Impressao ativa', 'status-chip-on');
    return;
  }
  if (status === 'connecting') {
    setPrintState(status, 'Impressao abrindo', 'status-chip-warn');
    return;
  }
  if (status === 'error') {
    setPrintState(status, 'Impressao com erro', 'status-chip-error');
    return;
  }
  if (currentSettings?.printAgentKey) {
    setPrintState(status, 'Impressao pronta', 'status-chip-on');
    return;
  }
  setPrintState(status, 'Impressao desligada', 'status-chip-off');
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

function populatePrinterSelect() {
  const select = $('#config-printer');
  const currentPrinter = String(currentSettings?.printerName || currentAgentConfig?.print?.printerName || '').trim();
  const names = Array.from(new Set([currentPrinter, ...availablePrinters].filter(Boolean)));
  select.replaceChildren();

  const defaultOption = document.createElement('option');
  defaultOption.value = '';
  defaultOption.textContent = 'Padrao do Windows';
  select.append(defaultOption);

  for (const name of names) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    select.append(option);
  }
  select.value = currentPrinter;
}

async function refreshPrinters() {
  availablePrinters = await window.hub.listPrinters().catch(() => []);
  populatePrinterSelect();
}

async function refreshHubState() {
  const [state, agentConfig] = await Promise.all([
    window.hub.getSettings(),
    window.hub.getAgentConfig().catch(() => ({ print: null, whatsapp: null })),
  ]);
  currentSettings = state.settings || currentSettings || {};
  currentAgentConfig = agentConfig || { print: null, whatsapp: null };
  whatsRunning = Boolean(state.whatsRunning);
  printRunning = Boolean(state.printRunning);
  renderWhatsState(state.whatsState || currentWhatsState);
  renderPrintState(state.printState || currentPrintState);
  renderServerLabel();
  return state;
}

function fillConfigForm() {
  $('#config-server-url').value = getServerUrl();
  $('#config-print-enabled').checked = Boolean(currentAgentConfig?.print?.enabled);
  $('#config-whatsapp-enabled').checked = Boolean(currentAgentConfig?.whatsapp?.enabled);
  $('#config-auto-print').checked = Boolean(currentSettings?.autoStartPrint);
  $('#config-auto-whatsapp').checked = Boolean(currentSettings?.autoStartWhatsApp);
  $('#config-start-windows').checked = currentSettings?.autoStartWithWindows !== false;
  populatePrinterSelect();
}

function setConfigBusy(busy) {
  const controls = [
    '#btn-config-save',
    '#btn-refresh-printers',
    '#btn-print-start',
    '#btn-print-stop',
    '#btn-whatsapp-start',
    '#btn-whatsapp-stop',
    '#config-server-url',
    '#config-printer',
    '#config-print-enabled',
    '#config-whatsapp-enabled',
    '#config-auto-print',
    '#config-auto-whatsapp',
    '#config-start-windows',
  ];
  for (const selector of controls) {
    const element = $(selector);
    if (element) element.disabled = busy;
  }
}

async function openConfigModal() {
  const modal = $('#config-modal');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
  setConfigMessage('Carregando configuracao...');
  setConfigBusy(true);
  try {
    await refreshHubState();
    await refreshPrinters();
    fillConfigForm();
    setConfigMessage('');
  } catch (error) {
    setConfigMessage(error.message || 'Falha ao carregar configuracao.', 'error');
  } finally {
    setConfigBusy(false);
  }
}

function closeConfigModal() {
  const modal = $('#config-modal');
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
  setConfigMessage('');
}

async function saveHubConfig() {
  setConfigBusy(true);
  setConfigMessage('Salvando...');
  try {
    const previousServerUrl = getServerUrl();
    const serverUrl = normalizeServerUrl($('#config-server-url').value);
    const printerName = $('#config-printer').value;
    const printEnabled = $('#config-print-enabled').checked;
    const whatsappEnabled = $('#config-whatsapp-enabled').checked;

    if (serverUrl !== previousServerUrl) {
      currentSettings = await window.hub.saveSettings({ serverUrl, lastSystemUrl: '' });
      sessionAuthenticated = false;
      renderServerLabel();
      loadSystem(`${serverUrl}/`, true);
    }

    if (currentSettings?.printAgentKey) {
      await window.hub.updatePrintConfig({ printerName, enabled: printEnabled });
    } else {
      await window.hub.updatePrintConfig({ printerName });
    }
    if (currentSettings?.whatsAgentKey) {
      await window.hub.updateWhatsAppConfig({ enabled: whatsappEnabled });
    }
    currentSettings = await window.hub.toggleAutostart({
      autoStartWithWindows: $('#config-start-windows').checked,
      autoStartPrint: $('#config-auto-print').checked,
      autoStartWhatsApp: $('#config-auto-whatsapp').checked,
    });

    await refreshHubState();
    fillConfigForm();
    setConfigMessage('Configuracao salva.', 'success');
  } catch (error) {
    setConfigMessage(error.message || 'Falha ao salvar configuracao.', 'error');
  } finally {
    setConfigBusy(false);
  }
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

$('#btn-config-hub').addEventListener('click', () => {
  void openConfigModal();
});

$('#btn-config-close').addEventListener('click', closeConfigModal);

document.querySelectorAll('[data-close-config]').forEach((element) => {
  element.addEventListener('click', closeConfigModal);
});

$('#btn-refresh-printers').addEventListener('click', async () => {
  setConfigBusy(true);
  setConfigMessage('Buscando impressoras...');
  try {
    await refreshPrinters();
    setConfigMessage('Lista atualizada.', 'success');
  } catch (error) {
    setConfigMessage(error.message || 'Falha ao buscar impressoras.', 'error');
  } finally {
    setConfigBusy(false);
  }
});

$('#btn-config-save').addEventListener('click', () => {
  void saveHubConfig();
});

$('#btn-print-start').addEventListener('click', async () => {
  setConfigBusy(true);
  setConfigMessage('Ligando impressao...');
  try {
    await syncSystemSession();
    await window.hub.startPrint();
    renderPrintState({ status: 'connecting', lastError: '' });
    await refreshHubState();
    setConfigMessage('Impressao ligada.', 'success');
  } catch (error) {
    renderPrintState({ status: 'error', lastError: error.message || 'Falha ao ligar impressao.' });
    setConfigMessage(error.message || 'Falha ao ligar impressao.', 'error');
  } finally {
    setConfigBusy(false);
  }
});

$('#btn-print-stop').addEventListener('click', async () => {
  setConfigBusy(true);
  setConfigMessage('Parando impressao...');
  try {
    await window.hub.stopPrint();
    renderPrintState({ status: 'stopped', lastError: '' });
    await refreshHubState();
    setConfigMessage('Impressao parada.', 'success');
  } catch (error) {
    setConfigMessage(error.message || 'Falha ao parar impressao.', 'error');
  } finally {
    setConfigBusy(false);
  }
});

$('#btn-whatsapp-start').addEventListener('click', async () => {
  setConfigBusy(true);
  setConfigMessage('Abrindo WhatsApp...');
  try {
    await syncSystemSession();
    if (!sessionAuthenticated) {
      throw new Error('Entre no sistema nesta janela antes de abrir o WhatsApp.');
    }
    renderWhatsState({ status: 'connecting', lastError: '' });
    await window.hub.startWhatsApp();
    await refreshHubState();
    setConfigMessage('WhatsApp abrindo.', 'success');
  } catch (error) {
    renderWhatsState({ status: 'error', lastError: error.message || 'Falha ao abrir WhatsApp.' });
    setConfigMessage(error.message || 'Falha ao abrir WhatsApp.', 'error');
  } finally {
    setConfigBusy(false);
  }
});

$('#btn-whatsapp-stop').addEventListener('click', async () => {
  setConfigBusy(true);
  setConfigMessage('Parando WhatsApp...');
  try {
    await window.hub.stopWhatsApp();
    renderWhatsState({ status: 'stopped', lastError: '' });
    await refreshHubState();
    setConfigMessage('WhatsApp parado.', 'success');
  } catch (error) {
    setConfigMessage(error.message || 'Falha ao parar WhatsApp.', 'error');
  } finally {
    setConfigBusy(false);
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

window.hub.onPrintState((state) => {
  renderPrintState(state);
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
  printRunning = Boolean(initial.printRunning);
  renderPrintState(initial.printState || { status: printRunning ? 'connecting' : 'stopped' });

  loadSystem(systemUrlState?.lastUrl || systemUrlState?.homeUrl || getSystemHomeUrl(), true);
  await syncSystemSession();
})();
