// src/db.js
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

let db;
const nowISO = () => new Date().toISOString();

function init(userDataDir) {
  const dbPath = path.join(process.cwd(), 'hkpos.db'); // app folder
  db = new Database(dbPath);
  // schema
  db.exec(`
    PRAGMA journal_mode=WAL;

    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS pins (action TEXT PRIMARY KEY, pin TEXT);

    CREATE TABLE IF NOT EXISTS tax_profiles (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      gst REAL NOT NULL DEFAULT 0,
      pst REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY,
      sku TEXT,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      quick INTEGER NOT NULL DEFAULT 0,
      tax_profile_id INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY,
      ts TEXT NOT NULL,
      method TEXT NOT NULL,
      subtotal REAL NOT NULL,
      gst REAL NOT NULL,
      pst REAL NOT NULL,
      total REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'paid'
    );

    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY,
      sale_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      qty REAL NOT NULL DEFAULT 1,
      tax_profile_id INTEGER NOT NULL DEFAULT 1
    );
  `);

  // defaults
  const sget = db.prepare('SELECT value FROM settings WHERE key=?');
  const sup = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if (!sget.get('business_name')) sup.run('business_name', 'HK POS');
  if (!sget.get('logo_path')) sup.run('logo_path', 'assets/hkpos-logo.svg');
  if (!sget.get('round_cash')) sup.run('round_cash', '0');

  if (db.prepare('SELECT COUNT(*) c FROM pins').get().c === 0) {
    db.prepare('INSERT INTO pins(action,pin) VALUES (?,?),(?,?)')
      .run('discount','1234','refund','1234');
  }
  if (db.prepare('SELECT COUNT(*) c FROM tax_profiles').get().c === 0) {
    db.prepare('INSERT INTO tax_profiles(name,gst,pst) VALUES (?,?,?),(?,?,?)')
      .run('GST 5%',0.05,0,'GST+PST 12%',0.05,0.07);
  }
  if (db.prepare('SELECT COUNT(*) c FROM products').get().c === 0) {
    db.prepare('INSERT INTO products(sku,name,price,quick,tax_profile_id) VALUES (?,?,?,?,?),(?,?,?,?,?),(?,?,?,?,?)')
      .run('SRV-PHOTO','Passport Photo',14.99,1,1,'SRV-REPAIR','Phone Repair (Basic)',49.99,1,2,'ACC-USB-C','USB-C Cable',9.99,1,2);
  }
  return true;
}

/* ---------- Settings ---------- */
function getSettings() {
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const s = Object.fromEntries(rows.map(r=>[r.key,r.value]));
  return { business_name: s.business_name || 'HK POS',
           logo_path: s.logo_path || 'assets/hkpos-logo.svg',
           round_cash: s.round_cash === '1' };
}
function setSettings(s) {
  const sup = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if (s.business_name !== undefined) sup.run('business_name', String(s.business_name));
  if (s.logo_path !== undefined) sup.run('logo_path', String(s.logo_path));
  if (s.round_cash !== undefined) sup.run('round_cash', s.round_cash ? '1':'0');
  return getSettings();
}

/* ---------- Products ---------- */
function listProducts(q) {
  q = q.trim();
  if (!q) return db.prepare('SELECT * FROM products ORDER BY name').all();
  return db.prepare('SELECT * FROM products WHERE name LIKE ? OR sku LIKE ? ORDER BY name').all(`%${q}%`,`%${q}%`);
}
function listQuickKeys() {
  return db.prepare('SELECT * FROM products WHERE quick=1 ORDER BY name LIMIT 24').all();
}
function addProduct(p) {
  return db.prepare('INSERT INTO products(sku,name,price,quick,tax_profile_id) VALUES (?,?,?,?,?)')
    .run(p.sku||null, p.name, +p.price, p.quick?1:0, p.tax_profile_id||1).lastInsertRowid;
}
function updateProduct(p) {
  db.prepare('UPDATE products SET sku=?, name=?, price=?, quick=?, tax_profile_id=? WHERE id=?')
    .run(p.sku||null, p.name, +p.price, p.quick?1:0, p.tax_profile_id||1, p.id);
  return true;
}
function exportProducts() {
  const rows = db.prepare('SELECT sku,name,price,quick,tax_profile_id FROM products ORDER BY name').all();
  return stringify(rows, { header:true });
}
function importProducts(filePath) {
  const csv = fs.readFileSync(filePath,'utf8');
  const recs = parse(csv, { columns:true, skip_empty_lines:true });
  const ins = db.prepare('INSERT INTO products(sku,name,price,quick,tax_profile_id) VALUES (?,?,?,?,?)');
  const upd = db.prepare('UPDATE products SET name=?, price=?, quick=?, tax_profile_id=? WHERE sku=?');
  const getBySku = db.prepare('SELECT id FROM products WHERE sku=?');
  const txn = db.transaction(()=>{
    for (const r of recs) {
      const ex = getBySku.get(r.sku);
      if (ex) upd.run(r.name, +r.price, +r.quick?1:0, +(r.tax_profile_id||1), r.sku);
      else ins.run(r.sku||null, r.name, +r.price, r.quick?1:0, +(r.tax_profile_id||1));
    }
  });
  txn();
  return true;
}

/* ---------- Taxes ---------- */
function listTaxProfiles(){ return db.prepare('SELECT * FROM tax_profiles ORDER BY id').all(); }
function saveTaxProfile(tp){
  if (tp.id)
    db.prepare('UPDATE tax_profiles SET name=?, gst=?, pst=? WHERE id=?').run(tp.name, +tp.gst, +tp.pst, tp.id);
  else
    tp.id = db.prepare('INSERT INTO tax_profiles(name,gst,pst) VALUES (?,?,?)').run(tp.name, +tp.gst, +tp.pst).lastInsertRowid;
  return tp.id;
}

/* ---------- Auth ---------- */
function checkPin(pin, action){ const r = db.prepare('SELECT pin FROM pins WHERE action=?').get(action||'discount'); return !!r && r.pin===String(pin); }

/* ---------- Sales ---------- */
function _calcTotals(items){
  const s = getSettings(); let subtotal=0, gst=0, pst=0;
  for (const i of items){
    const t = db.prepare('SELECT gst,pst FROM tax_profiles WHERE id=?').get(i.tax_profile_id||1) || {gst:0,pst:0};
    subtotal += i.price*i.qty; gst += i.price*i.qty*(t.gst||0); pst += i.price*i.qty*(t.pst||0);
  }
  let total = subtotal + gst + pst;
  if (s.round_cash) total = Math.round(total*20)/20; // 0.05
  return { subtotal, gst, pst, total };
}

function newSale(sale){
  // sale = { items:[{name,price,qty,tax_profile_id}], method:'cash'|'debit'|'etransfer' }
  const items = (sale.items||[]).map(i=>({ name:i.name, price:+i.price, qty:+(i.qty||1), tax_profile_id:i.tax_profile_id||1 }));
  const t = _calcTotals(items);
  const res = db.prepare('INSERT INTO sales(ts,method,subtotal,gst,pst,total,status) VALUES (?,?,?,?,?,?, "paid")')
                .run(nowISO(), sale.method, t.subtotal, t.gst, t.pst, t.total);
  const sale_id = res.lastInsertRowid;
  const ins = db.prepare('INSERT INTO sale_items(sale_id,name,price,qty,tax_profile_id) VALUES (?,?,?,?,?)');
  items.forEach(i=> ins.run(sale_id, i.name, i.price, i.qty, i.tax_profile_id));
  return { sale_id, ...t, method: sale.method };
}

function refundSale({ sale_id, pin }){
  if (!checkPin(pin,'refund')) return { ok:false, error:'PIN' };
  db.prepare('UPDATE sales SET status="refunded" WHERE id=?').run(sale_id);
  return { ok:true };
}

function dailySummary(isoDate){
  const day = isoDate ? isoDate.slice(0,10) : new Date().toISOString().slice(0,10);
  const rows = db.prepare(`
    SELECT method, SUM(total) amt, COUNT(*) cnt
    FROM sales WHERE status='paid' AND substr(ts,1,10)=?
    GROUP BY method
  `).all(day);
  const by = Object.fromEntries(rows.map(r=>[r.method, +r.amt]));
  const cnt = rows.reduce((a,r)=> a + r.cnt, 0);
  return { cash: by.cash||0, debit: by.debit||0, etransfer: by.etransfer||0, count: cnt };
}

module.exports = {
  init,
  // products
  listProducts, listQuickKeys, addProduct, updateProduct,
  exportProducts, importProducts,
  // taxes
  listTaxProfiles, saveTaxProfile,
  // settings
  getSettings, setSettings,
  // sales
  newSale, refundSale, dailySummary,
  // auth
  checkPin
};
