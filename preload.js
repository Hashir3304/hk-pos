const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('api', {
  products: {
    list: (q) => ipcRenderer.invoke('products:list', q),
    quickkeys: () => ipcRenderer.invoke('products:quickkeys'),
    add: (p) => ipcRenderer.invoke('products:add', p),
    update: (p) => ipcRenderer.invoke('products:update', p),
  },
  csv: {
    exportProducts: () => ipcRenderer.invoke('csv:exportProducts'),
    importProducts: (filePath) => ipcRenderer.invoke('csv:importProducts', filePath),
  },
  taxProfiles: {
    list: () => ipcRenderer.invoke('taxProfiles:list'),
    save: (tp) => ipcRenderer.invoke('taxProfiles:save', tp),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (s) => ipcRenderer.invoke('settings:set', s),
  },
  sales: {
    new: (sale) => ipcRenderer.invoke('sales:new', sale),
    refund: (data) => ipcRenderer.invoke('sales:refund', data),
    dailySummary: (d) => ipcRenderer.invoke('sales:dailySummary', d),
  },
  auth: { checkPin: (payload) => ipcRenderer.invoke('auth:checkPin', payload) },
  printing: {
    receipt: (sale_id) => ipcRenderer.invoke('print:receipt', { sale_id }),
    kick: () => ipcRenderer.invoke('drawer:kick'),
  },
  backup: { manual: () => ipcRenderer.invoke('backup:manual') }
});
