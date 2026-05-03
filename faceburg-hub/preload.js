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
  updatePrinter: (payload) => ipcRenderer.invoke('hub:update-printer', payload),

  // Individual agent controls
  startWhatsApp: () => ipcRenderer.invoke('hub:start-whatsapp'),
  stopWhatsApp: () => ipcRenderer.invoke('hub:stop-whatsapp'),
  restartWhatsApp: () => ipcRenderer.invoke('hub:restart-whatsapp'),
  startPrint: () => ipcRenderer.invoke('hub:start-print'),
  restartPrint: () => ipcRenderer.invoke('hub:restart-print'),
  stopPrint: () => ipcRenderer.invoke('hub:stop-print'),
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
});

contextBridge.exposeInMainWorld('faceburgDesktop', {
  isDesktopApp: true,
  getState: async () => {
    const current = await ipcRenderer.invoke('hub:get-settings');
    return {
      isDesktopApp: true,
      whatsRunning: Boolean(current?.whatsRunning),
      printRunning: Boolean(current?.printRunning),
      whatsapp: current?.whatsState || null,
      print: current?.printState || null,
    };
  },
  syncSession: syncSystemSession,
  listPrinters: () => ipcRenderer.invoke('hub:list-printers'),
  updatePrinter: (payload) => ipcRenderer.invoke('hub:update-printer', payload),
  startWhatsApp: () => ipcRenderer.invoke('hub:start-whatsapp'),
  stopWhatsApp: () => ipcRenderer.invoke('hub:stop-whatsapp'),
  restartWhatsApp: () => ipcRenderer.invoke('hub:restart-whatsapp'),
  startPrint: () => ipcRenderer.invoke('hub:start-print'),
  restartPrint: () => ipcRenderer.invoke('hub:restart-print'),
  stopPrint: () => ipcRenderer.invoke('hub:stop-print'),
  onWhatsAppState: (cb) => subscribe('whatsapp:state', cb),
  onPrintState: (cb) => subscribe('print:state', cb),
});
