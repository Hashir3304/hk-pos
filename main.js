const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const db = require('./src/db');
const { printReceipt, kickDrawer } = require('./src/printing');
const { scheduleBackups, backupNow } = require('./src/backup');

function createWindow () {
  const win = new BrowserWindow({
    width: 1280, height: 860,
    webPreferences: { preload: path.join(__dirname, 'preload.js') }
  });
  win.loadFile('index.html');
}

app.whenReady().then(async () => {
  try { await db.init(app.getPath('userData')); }
  catch (e) { dialog.showErrorBox('Database Error', String(e)); app.quit(); return; }
  scheduleBackups(app.getPath('userData'));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// IPC
ipcMain.handle('products:list', (evt, q) => db.listProducts(q||''));
ipcMain.handle('products:quickkeys', () => db.listQuickKeys());
ipcMain.handle('products:add', (evt, p) => db.addProduct(p));
ipcMain.handle('products:update', (evt, p) => db.updateProduct(p));
ipcMain.handle('csv:exportProducts', () => db.exportProducts());
ipcMain.handle('csv:importProducts', (evt, filePath) => db.importProducts(filePath));

ipcMain.handle('taxProfiles:list', () => db.listTaxProfiles());
ipcMain.handle('taxProfiles:save', (evt, tp) => db.saveTaxProfile(tp));

ipcMain.handle('settings:get', () => db.getSettings());
ipcMain.handle('settings:set', (evt, s) => db.setSettings(s));

ipcMain.handle('sales:new', (evt, sale) => db.newSale(sale));
ipcMain.handle('sales:refund', (evt, data) => db.refundSale(data));
ipcMain.handle('sales:dailySummary', (evt, isoDate) => db.dailySummary(isoDate));

ipcMain.handle('auth:checkPin', (evt, { pin, action }) => db.checkPin(pin, action));

ipcMain.handle('print:receipt', (evt, { sale_id }) => printReceipt(sale_id));
ipcMain.handle('drawer:kick', () => kickDrawer());

ipcMain.handle('backup:manual', () => backupNow(app.getPath('userData')));
