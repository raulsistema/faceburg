const { contextBridge, ipcRenderer } = require('electron');

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
  stopPrint: () => ipcRenderer.invoke('hub:stop-print'),

  // Auto-start settings
  toggleAutostart: (payload) => ipcRenderer.invoke('hub:toggle-autostart', payload),

  // Events from main
  onWhatsAppState: (cb) => ipcRenderer.on('whatsapp:state', (_e, d) => cb(d)),
  onPrintState: (cb) => ipcRenderer.on('print:state', (_e, d) => cb(d)),
  onAgentLog: (cb) => ipcRenderer.on('agent:log', (_e, d) => cb(d)),
});
