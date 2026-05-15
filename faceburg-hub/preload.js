const { contextBridge, ipcRenderer } = require('electron');

let syncSystemSessionPromise = null;

function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
}

function syncSystemSession() {
  if (!syncSystemSessionPromise) {
    syncSystemSessionPromise = ipcRenderer.invoke('hub:sync-system-session')
      .finally(() => {
        syncSystemSessionPromise = null;
      });
  }
  return syncSystemSessionPromise;
}

contextBridge.exposeInMainWorld('hub', {
  // Settings
  getSettings: () => ipcRenderer.invoke('hub:get-settings'),
  saveSettings: (payload) => ipcRenderer.invoke('hub:save-settings', payload),
  login: (payload) => ipcRenderer.invoke('hub:login', payload),
  logout: () => ipcRenderer.invoke('hub:logout'),

  // Printer
  listPrinters: () => ipcRenderer.invoke('hub:list-printers'),
  getAgentConfig: () => ipcRenderer.invoke('hub:get-agent-config'),
  updatePrinter: (payload) => ipcRenderer.invoke('hub:update-printer', payload),
  updatePrintConfig: (payload) => ipcRenderer.invoke('hub:update-print-config', payload),
  updateWhatsAppConfig: (payload) => ipcRenderer.invoke('hub:update-whatsapp-config', payload),

  // Individual agent controls
  startWhatsApp: () => ipcRenderer.invoke('hub:start-whatsapp'),
  stopWhatsApp: () => ipcRenderer.invoke('hub:stop-whatsapp'),
  restartWhatsApp: () => ipcRenderer.invoke('hub:restart-whatsapp'),
  startPrint: () => ipcRenderer.invoke('hub:start-print'),
  restartPrint: () => ipcRenderer.invoke('hub:restart-print'),
  stopPrint: () => ipcRenderer.invoke('hub:stop-print'),
  printDirect: (payload) => ipcRenderer.invoke('hub:print-direct', payload),
  sendWhatsAppDirect: (payload) => ipcRenderer.invoke('hub:whatsapp-send-direct', payload),
  openSystem: (payload) => ipcRenderer.invoke('hub:open-system', payload),
  syncSystemSession,
  getSystemUrl: () => ipcRenderer.invoke('hub:get-system-url'),
  clearSystemUrl: () => ipcRenderer.invoke('hub:clear-system-url'),

  // Auto-start settings
  toggleAutostart: (payload) => ipcRenderer.invoke('hub:toggle-autostart', payload),

  // Events from main
  onWhatsAppState: (cb) => subscribe('whatsapp:state', cb),
  onPrintState: (cb) => subscribe('print:state', cb),
  onAgentLog: (cb) => subscribe('agent:log', cb),
  
  // Updates and formatting
  onSystemUpdateAvailable: (cb) => subscribe('system:update-available', cb),
  onSystemUpdateProgress: (cb) => subscribe('system:update-progress', cb),
  onSystemUpdateDownloaded: (cb) => subscribe('system:update-downloaded', cb),
  numeroPorExtenso: (payload) => ipcRenderer.invoke('hub:numero-por-extenso', payload),
});

contextBridge.exposeInMainWorld('faceburgDesktop', {
  isDesktopApp: true,
  getState: async () => {
    const current = await ipcRenderer.invoke('hub:get-settings');
    return {
      isDesktopApp: true,
      whatsRunning: Boolean(current?.whatsRunning),
      printRunning: Boolean(current?.printRunning),
      hasLocalWhatsappSession: Boolean(current?.hasLocalWhatsappSession),
      whatsapp: current?.whatsState || null,
      print: current?.printState || null,
    };
  },
  syncSession: syncSystemSession,
  listPrinters: () => ipcRenderer.invoke('hub:list-printers'),
  getAgentConfig: () => ipcRenderer.invoke('hub:get-agent-config'),
  updatePrinter: (payload) => ipcRenderer.invoke('hub:update-printer', payload),
  updatePrintConfig: (payload) => ipcRenderer.invoke('hub:update-print-config', payload),
  updateWhatsAppConfig: (payload) => ipcRenderer.invoke('hub:update-whatsapp-config', payload),
  startWhatsApp: () => ipcRenderer.invoke('hub:start-whatsapp'),
  stopWhatsApp: () => ipcRenderer.invoke('hub:stop-whatsapp'),
  restartWhatsApp: () => ipcRenderer.invoke('hub:restart-whatsapp'),
  startPrint: () => ipcRenderer.invoke('hub:start-print'),
  restartPrint: () => ipcRenderer.invoke('hub:restart-print'),
  stopPrint: () => ipcRenderer.invoke('hub:stop-print'),
  printDirect: (payload) => ipcRenderer.invoke('hub:print-direct', payload),
  sendWhatsAppDirect: (payload) => ipcRenderer.invoke('hub:whatsapp-send-direct', payload),
  onWhatsAppState: (cb) => subscribe('whatsapp:state', cb),
  onPrintState: (cb) => subscribe('print:state', cb),
});
