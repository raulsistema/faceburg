/* eslint-disable no-console */
/* Faceburg Hub - Renderer */

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);

function showScreen(id) {
  $$('.screen').forEach((screen) => screen.classList.remove('active'));
  $(`#${id}`).classList.add('active');
}

function switchTab(tab) {
  $$('.nav-btn[data-tab]').forEach((button) => button.classList.remove('active'));
  $(`.nav-btn[data-tab="${tab}"]`).classList.add('active');
  $$('.tab-panel').forEach((panel) => panel.classList.remove('active'));
  $(`#tab-${tab}`).classList.add('active');
}

$$('.nav-btn[data-tab]').forEach((button) => {
  button.addEventListener('click', () => switchTab(button.dataset.tab));
});

async function populatePrinters(selectEl) {
  try {
    const printers = await window.hub.listPrinters();
    const currentValue = selectEl.value;
    selectEl.innerHTML = '<option value="">Padrao do sistema</option>';
    printers.forEach((name) => {
      const option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      selectEl.appendChild(option);
    });
    if (currentValue) {
      selectEl.value = currentValue;
    }
  } catch {
    // silent
  }
}

function setText(id, value, fallback = '-') {
  const element = $(id);
  if (!element) return;
  element.textContent = value || fallback;
}

function setChannelUi(prefix, realtimeConnected) {
  const chip = $(`#${prefix}-channel-chip`);
  const text = $(`#${prefix}-channel-text`);
  const description = $(`#${prefix}-channel-description`);
  const mode = realtimeConnected ? 'Tempo real' : 'Fallback polling';
  const detail = realtimeConnected
    ? 'Gateway realtime conectado. O agente acorda assim que surge job novo.'
    : 'Sem canal realtime. O agente faz consultas periodicas para nao perder pedidos.';

  if (chip) {
    chip.textContent = mode;
    chip.className = `channel-chip ${realtimeConnected ? 'channel-chip-live' : 'channel-chip-fallback'}`;
  }
  if (text) text.textContent = mode;
  if (description) description.textContent = detail;
}

function escapeHtml(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
  return String(str || '').replace(/[&<>\"]/g, (char) => map[char]);
}

let currentSettings = null;
let whatsRunning = false;
let printRunning = false;

function renderConfigSummary(settings) {
  setText('#config-server-url', settings.serverUrl || '');
  setText('#config-tenant-name', settings.tenantName || settings.slug || '');
  setText('#config-user-name', settings.userName || settings.email || '');
  setText('#config-whats-key', settings.whatsAgentKey ? 'Carregada' : 'Nao carregada');
  setText('#config-print-key', settings.printAgentKey ? 'Carregada' : 'Nao carregada');
}

function enterDashboard(settings) {
  currentSettings = settings;
  showScreen('main-screen');

  setText('#user-name', settings.userName || settings.email || '', '');
  setText('#tenant-name', settings.tenantName || settings.slug || '', '');

  populatePrinters($('#printer-select')).then(() => {
    if (settings.printerName) {
      $('#printer-select').value = settings.printerName;
    }
  });

  $('#toggle-win-startup').checked = Boolean(settings.autoStartWithWindows);
  $('#toggle-auto-whats').checked = Boolean(settings.autoStartWhatsApp);
  $('#toggle-auto-print').checked = Boolean(settings.autoStartPrint);

  renderConfigSummary(settings);
}

function setWhatsRunning(running) {
  whatsRunning = running;
  const button = $('#btn-whats-toggle');
  const restartButton = $('#btn-restart-whats');
  if (running) {
    button.textContent = 'Parar';
    button.className = 'btn btn-sm btn-danger';
    restartButton.classList.remove('hidden');
  } else {
    button.textContent = 'Iniciar';
    button.className = 'btn btn-sm btn-success';
    restartButton.classList.add('hidden');
  }
}

function setPrintRunning(running) {
  printRunning = running;
  const button = $('#btn-print-toggle');
  if (running) {
    button.textContent = 'Parar';
    button.className = 'btn btn-sm btn-danger';
  } else {
    button.textContent = 'Iniciar';
    button.className = 'btn btn-sm btn-success';
  }
}

const STATUS_MAP = {
  stopped: { text: 'Parado', icon: 'status-stopped' },
  connecting: { text: 'Conectando...', icon: 'status-connecting' },
  qr: { text: 'Aguardando QR Code', icon: 'status-qr' },
  ready: { text: 'Conectado', icon: 'status-ready' },
  disconnected: { text: 'Desconectado', icon: 'status-error' },
  auth_failure: { text: 'Falha de autenticacao', icon: 'status-error' },
  error: { text: 'Erro', icon: 'status-error' },
};

function updateWhatsAppUI(state) {
  const info = STATUS_MAP[state.status] || STATUS_MAP.stopped;

  $('#whats-status-display .status-icon').className = `status-icon ${info.icon}`;
  $('#whats-status-text').textContent = info.text;

  const badge = $('#whats-badge');
  if (state.status === 'ready') {
    badge.className = 'badge';
  } else if (state.status === 'qr' || state.status === 'connecting') {
    badge.className = 'badge badge-warn';
  } else if (state.status === 'error' || state.status === 'disconnected' || state.status === 'auth_failure') {
    badge.className = 'badge badge-error';
  } else {
    badge.className = 'badge hidden';
  }

  setChannelUi('whats', Boolean(state.realtimeConnected));

  if (state.phoneNumber) {
    $('#whats-phone').classList.remove('hidden');
    $('#whats-phone-number').textContent = state.phoneNumber;
  } else {
    $('#whats-phone').classList.add('hidden');
  }

  if (state.lastError) {
    $('#whats-error').classList.remove('hidden');
    $('#whats-error-text').textContent = state.lastError;
  } else {
    $('#whats-error').classList.add('hidden');
  }

  const qr = $('#qr-container');
  if (state.qrCode) {
    qr.innerHTML = `<img src="${state.qrCode}" alt="QR Code WhatsApp" width="280" height="280" />`;
  } else if (state.status === 'ready') {
    qr.innerHTML = '<div class="qr-placeholder"><p style="color:var(--green-text);font-weight:600;">Conectado ao WhatsApp</p></div>';
  } else if (state.status === 'connecting') {
    qr.innerHTML = '<div class="qr-placeholder"><p>Iniciando sessao WhatsApp...</p></div>';
  } else {
    qr.innerHTML = '<div class="qr-placeholder"><p>Inicie o agente para gerar o QR code.</p></div>';
  }

  if (state.status !== 'stopped' && !whatsRunning) setWhatsRunning(true);
  if (state.status === 'stopped' && whatsRunning) setWhatsRunning(false);
}

function updatePrintUI(state) {
  const info = STATUS_MAP[state.status] || STATUS_MAP.stopped;

  $('#print-status-display .status-icon').className = `status-icon ${info.icon}`;
  $('#print-status-text').textContent = info.text;

  const badge = $('#print-badge');
  if (state.status === 'ready') {
    badge.className = 'badge';
  } else if (state.status === 'connecting') {
    badge.className = 'badge badge-warn';
  } else if (state.status === 'error') {
    badge.className = 'badge badge-error';
  } else {
    badge.className = 'badge hidden';
  }

  setChannelUi('print', Boolean(state.realtimeConnected));

  if (state.lastJobAt) {
    $('#print-last-job').classList.remove('hidden');
    $('#print-last-job-time').textContent = state.lastJobAt;
  } else {
    $('#print-last-job').classList.add('hidden');
  }

  if (state.lastError) {
    $('#print-error').classList.remove('hidden');
    $('#print-error-text').textContent = state.lastError;
  } else {
    $('#print-error').classList.add('hidden');
  }

  if (state.status !== 'stopped' && !printRunning) setPrintRunning(true);
  if (state.status === 'stopped' && printRunning) setPrintRunning(false);
}

function appendLog(entry) {
  const container = $('#log-container');
  const empty = container.querySelector('.log-empty');
  if (empty) empty.remove();

  const item = document.createElement('div');
  item.className = 'log-entry';
  item.innerHTML = `
    <span class="log-time">${escapeHtml(entry.ts || '')}</span>
    <span class="log-source log-source-${entry.source || 'system'}">${escapeHtml((entry.source || 'system').toUpperCase())}</span>
    <span class="log-message">${escapeHtml(entry.message || '')}</span>
  `;
  container.appendChild(item);
  container.scrollTop = container.scrollHeight;
}

$('#login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = $('#login-btn');
  const errorEl = $('#login-error');
  button.disabled = true;
  button.textContent = 'Conectando...';
  errorEl.textContent = '';

  try {
    const settings = await window.hub.login({
      serverUrl: $('#login-server').value,
      slug: $('#login-slug').value,
      email: $('#login-email').value,
      password: $('#login-password').value,
      printerName: $('#login-printer').value,
    });
    enterDashboard(settings);
  } catch (error) {
    errorEl.textContent = error.message || 'Falha ao conectar.';
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
});

$('#btn-save-config').addEventListener('click', async () => {
  const button = $('#btn-save-config');
  button.disabled = true;
  try {
    const next = await window.hub.toggleAutostart({
      autoStartWithWindows: $('#toggle-win-startup').checked,
      autoStartWhatsApp: $('#toggle-auto-whats').checked,
      autoStartPrint: $('#toggle-auto-print').checked,
    });
    currentSettings = { ...(currentSettings || {}), ...next };
    renderConfigSummary(currentSettings);
    button.textContent = 'Salvo';
    setTimeout(() => {
      button.textContent = 'Salvar configuracoes';
    }, 1800);
  } catch (error) {
    alert(`Erro ao salvar configuracoes: ${error.message || error}`);
  } finally {
    button.disabled = false;
  }
});

$('#btn-whats-toggle').addEventListener('click', async () => {
  const button = $('#btn-whats-toggle');
  button.disabled = true;
  try {
    if (whatsRunning) {
      await window.hub.stopWhatsApp();
      setWhatsRunning(false);
    } else {
      await window.hub.startWhatsApp();
      setWhatsRunning(true);
    }
  } catch (error) {
    alert(error.message || 'Erro ao controlar o agente WhatsApp.');
  } finally {
    button.disabled = false;
  }
});

$('#btn-restart-whats').addEventListener('click', async () => {
  try {
    await window.hub.restartWhatsApp();
  } catch (error) {
    alert(error.message || 'Erro ao reiniciar o agente WhatsApp.');
  }
});

$('#btn-print-toggle').addEventListener('click', async () => {
  const button = $('#btn-print-toggle');
  button.disabled = true;
  try {
    if (printRunning) {
      await window.hub.stopPrint();
      setPrintRunning(false);
    } else {
      await window.hub.startPrint();
      setPrintRunning(true);
    }
  } catch (error) {
    alert(error.message || 'Erro ao controlar o agente de impressao.');
  } finally {
    button.disabled = false;
  }
});

$('#btn-update-printer').addEventListener('click', async () => {
  try {
    const next = await window.hub.updatePrinter({ printerName: $('#printer-select').value });
    currentSettings = { ...(currentSettings || {}), ...next };
    renderConfigSummary(currentSettings);
    const button = $('#btn-update-printer');
    button.textContent = 'Salvo';
    setTimeout(() => {
      button.textContent = 'Salvar impressora';
    }, 1800);
  } catch (error) {
    alert(error.message || 'Erro ao salvar impressora.');
  }
});

$('#btn-clear-logs').addEventListener('click', () => {
  $('#log-container').innerHTML = '<div class="log-empty">Nenhum log ainda.</div>';
});

$('#logout-btn').addEventListener('click', async () => {
  if (!confirm('Deseja sair? Os agentes serao parados.')) return;
  await window.hub.logout();
  currentSettings = null;
  setWhatsRunning(false);
  setPrintRunning(false);
  updateWhatsAppUI({ status: 'stopped', qrCode: '', phoneNumber: '', lastError: '', realtimeConnected: false });
  updatePrintUI({ status: 'stopped', lastError: '', lastJobAt: '', realtimeConnected: false });
  showScreen('login-screen');
});

window.hub.onWhatsAppState((state) => updateWhatsAppUI(state));
window.hub.onPrintState((state) => updatePrintUI(state));
window.hub.onAgentLog((entry) => appendLog(entry));

(async () => {
  await populatePrinters($('#login-printer'));
  try {
    const initial = await window.hub.getSettings();
    const settings = initial.settings;

    if ((settings.printAgentKey || settings.whatsAgentKey || (settings.email && settings.password)) && settings.serverUrl) {
      enterDashboard(settings);
      updateWhatsAppUI(initial.whatsState || { status: 'stopped', realtimeConnected: false });
      updatePrintUI(initial.printState || { status: 'stopped', realtimeConnected: false });
      if (initial.logs?.length) {
        initial.logs.forEach((entry) => appendLog(entry));
      }
      if (initial.whatsRunning) setWhatsRunning(true);
      if (initial.printRunning) setPrintRunning(true);
    } else {
      showScreen('login-screen');
      if (settings.serverUrl) $('#login-server').value = settings.serverUrl;
      if (settings.slug) $('#login-slug').value = settings.slug;
      if (settings.email) $('#login-email').value = settings.email;
      if (settings.printerName) $('#login-printer').value = settings.printerName;
    }
  } catch {
    showScreen('login-screen');
  }
})();
