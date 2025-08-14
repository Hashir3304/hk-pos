const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { parse } = require('csv-parse/sync');
const { stringify } = require('csv-stringify/sync');

let db;

function ensureSchema(){
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, role TEXT, pin_hash TEXT);
    CREATE TABLE IF NOT EXISTS tax_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, rate_json TEXT);
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sku TEXT UNIQUE,
      name TEXT NOT NULL,
      price REAL NOT NULL,
      cost REAL DEFAULT 0,
      stock_qty INTEGER DEFAULT 0,
      quick_key INTEGER DEFAULT 0,
      tax_profile_id INTEGER,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no INTEGER UNIQUE,
      dt TEXT DEFAULT CURRENT_TIMESTAMP,
      subtotal REAL NOT NULL,
      tax_total REAL NOT NULL,
      grand_total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER,
      name TEXT,
      qty INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      line_total REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      method TEXT NOT NULL,
      amount REAL NOT NULL
    );
    CREATE TABLE IF NOT EXISTS refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      amount REAL NOT NULL,
      dt TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `);

  if(!db.prepare('SELECT value FROM meta WHERE key=?').get('receipt_counter'))
    db.prepare('INSERT INTO meta(key,value) VALUES(?,?)').run('receipt_counter','1000');

  if(!db.prepare('SELECT id FROM users LIMIT 1').get())
    db.prepare('INSERT INTO users(name, role, pin_hash) VALUES (?,?,?)').run('Manager','manager','1234'); // demo PIN

  if(!db.prepare('SELECT id FROM tax_profiles LIMIT 1').get()){
    db.prepare('INSERT INTO tax_profiles(name, rate_json) VALUES (?,?)').run('GST 5%','{"GST":0.05}');
    db.prepare('INSERT INTO tax_profiles(name, rate_json) VALUES (?,?)').run('GST+PST 12%','{"GST":0.05,"PST":0.07}');
  }
  if(!db.prepare('SELECT value FROM settings WHERE key=?').get('business_name'))
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('business_name','HK POS');

  if(!db.prepare('SELECT value FROM settings WHERE key=?').get('round_cash'))
    db.prepare('INSERT INTO settings(key,value) VALUES(?,?)').run('round_cash','1');
}

async function init(userDataPath){
  const dbPath = path.join(userDataPath, 'hkpos.db');
  db = new Database(dbPath);
  ensureSchema();
}

function getSettings(){
  const rows = db.prepare('SELECT key,value FROM settings').all();
  const map = {}; rows.forEach(r=> map[r.key]=r.value);
  return { business_name: map.business_name || 'HK POS', round_cash: map.round_cash === '1' };
}
function setSettings(s){
  const stmt = db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value');
  if(s.business_name!==undefined) stmt.run('business_name', s.business_name);
  if(s.round_cash!==undefined) stmt.run('round_cash', String(s.round_cash));
  return getSettings();
}

function listTaxProfiles(){ return db.prepare('SELECT * FROM tax_profiles ORDER BY id').all(); }
function saveTaxProfile(tp){
  if(tp.id) db.prepare('UPDATE tax_profiles SET name=?, rate_json=? WHERE id=?').run(tp.name, tp.rate_json, tp.id);
  else db.prepare('INSERT INTO tax_profiles(name, rate_json) VALUES (?,?)').run(tp.name, tp.rate_json);
  return { ok:true };
}

function listProducts(q){
  const like = `%${q}%`;
  const stmt = db.prepare(`SELECT p.*, tp.name as tax_profile_name, tp.id as tax_profile_id, tp.rate_json FROM products p
                           LEFT JOIN tax_profiles tp ON tp.id=p.tax_profile_id
                           WHERE p.active=1 AND (p.name LIKE ? OR p.sku LIKE ?)
                           ORDER BY p.quick_key DESC, p.name LIMIT 500`);
  const res = stmt.all(like, like);
  return res.map(r=> ({ ...r, tax_profile: r.tax_profile_id? { id:r.tax_profile_id, name:r.tax_profile_name, rate_json:r.rate_json } : null }));
}
function listQuickKeys(){
  return db.prepare(`SELECT p.*, tp.name as tax_profile_name, tp.id as tax_profile_id, tp.rate_json FROM products p
                     LEFT JOIN tax_profiles tp ON tp.id=p.tax_profile_id
                     WHERE p.active=1 AND p.quick_key=1 ORDER BY p.name`).all()
            .map(r=> ({ ...r, tax_profile: r.tax_profile_id? { id:r.tax_profile_id, name:r.tax_profile_name, rate_json:r.rate_json } : null }));
}
function addProduct(p){
  const stmt = db.prepare(`INSERT INTO products(sku,name,price,cost,stock_qty,quick_key,tax_profile_id,active)
                           VALUES (@sku,@name,@price,@cost,@stock_qty,@quick_key,@tax_profile_id,1)`);
  const info = stmt.run(p);
  return { id: info.lastInsertRowid };
}
function updateProduct(p){
  const stmt = db.prepare(`UPDATE products SET
    sku=@sku, name=@name, price=@price, cost=@cost, stock_qty=@stock_qty,
    quick_key=@quick_key, tax_profile_id=@tax_profile_id, updated_at=CURRENT_TIMESTAMP
    WHERE id=@id`);
  stmt.run(p); return { ok:true };
}

function nextReceiptNo(){
  const row = db.prepare('SELECT value FROM meta WHERE key=?').get('receipt_counter');
  const current = parseInt(row.value,10);
  db.prepare('UPDATE meta SET value=? WHERE key=?').run(String(current+1),'receipt_counter');
  return current;
}
function calcTaxes(items){
  let subtotal = 0; const totals = {};
  items.forEach(i=> subtotal += i.qty * i.unit_price);
  items.forEach(i=> {
    let rates = i.tax_profile_rates;
    if(!rates && i.tax_profile_id){
      const tp = db.prepare('SELECT rate_json FROM tax_profiles WHERE id=?').get(i.tax_profile_id);
      if(tp) rates = JSON.parse(tp.rate_json);
    }
    if(rates){
      const line = i.qty * i.unit_price;
      for(const [name, rate] of Object.entries(rates)){
        totals[name] = (totals[name] || 0) + (line * rate);
      }
    }
  });
  let tax_total = 0; Object.values(totals).forEach(v=> tax_total += v);
  const grand_total = Math.round((subtotal + tax_total)*100)/100;
  return { subtotal: Math.round(subtotal*100)/100, tax_total: Math.round(tax_total*100)/100, grand_total, breakdown: totals };
}

function newSale(sale){
  const settings = getSettings();
  const trx = db.transaction((sale)=>{
    const tx = calcTaxes(sale.items);
    const hasCash = (sale.payments||[]).some(p=> p.method==='cash');
    let roundedTotal = tx.grand_total;
    if(hasCash && settings.round_cash) roundedTotal = Math.round(tx.grand_total * 20) / 20; // nearest 0.05

    const receipt_no = nextReceiptNo();
    const info = db.prepare(`INSERT INTO sales(receipt_no, subtotal, tax_total, grand_total)
                             VALUES (?,?,?,?)`).run(receipt_no, tx.subtotal, tx.tax_total, roundedTotal);
    const sale_id = info.lastInsertRowid;

    const insertItem = db.prepare(`INSERT INTO sale_items(sale_id, product_id, name, qty, unit_price, line_total)
                                   VALUES (?,?,?,?,?,?)`);
    sale.items.forEach(i=>{
      const line = Math.round(i.qty * i.unit_price * 100)/100;
      insertItem.run(sale_id, i.product_id || null, i.name || null, i.qty, i.unit_price, line);
      if(i.product_id){ db.prepare('UPDATE products SET stock_qty = MAX(0, stock_qty - ?) WHERE id=?').run(i.qty, i.product_id); }
    });

    const insertPay = db.prepare(`INSERT INTO payments(sale_id, method, amount) VALUES (?,?,?)`);
    sale.payments.forEach(p=> insertPay.run(sale_id, p.method, p.amount || roundedTotal));

    return { sale_id, receipt_no };
  });
  return trx(sale);
}

function refundSale({ receipt_no }){
  const trx = db.transaction((payload)=>{
    const sale = db.prepare('SELECT id, grand_total FROM sales WHERE receipt_no=?').get(payload.receipt_no);
    if(!sale) throw new Error('Sale not found');
    const items = db.prepare('SELECT product_id, qty FROM sale_items WHERE sale_id=?').all(sale.id);
    items.forEach(i=> { if(i.product_id) db.prepare('UPDATE products SET stock_qty = stock_qty + ? WHERE id=?').run(i.qty, i.product_id); });
    db.prepare('INSERT INTO refunds(sale_id, amount) VALUES (?,?)').run(sale.id, sale.grand_total);
    return { amount: sale.grand_total };
  });
  return trx({ receipt_no });
}

function dailySummary(isoDate){
  const totals = db.prepare(`SELECT ROUND(SUM(subtotal),2) as subtotal, ROUND(SUM(tax_total),2) as tax_total,
                                    ROUND(SUM(grand_total),2) as grand_total, COUNT(*) as count
                             FROM sales WHERE date(dt)=?`).get(isoDate);
  const tenders = db.prepare(`SELECT method, ROUND(SUM(amount),2) as total
                              FROM payments JOIN sales ON sales.id=payments.sale_id
                              WHERE date(sales.dt)=? GROUP BY method`).all(isoDate);
  const methods = { cash:0, card_external:0, etransfer:0 };
  tenders.forEach(t=> { if(methods.hasOwnProperty(t.method)) methods[t.method] = t.total; });
  return { ...totals, tenders: [
    { method:'cash', label:'Cash', total: methods.cash },
    { method:'card_external', label:'Debit', total: methods.card_external },
    { method:'etransfer', label:'E-transfer', total: methods.etransfer },
  ]};
}

function exportProducts(){
  const rows = db.prepare('SELECT sku,name,price,cost,stock_qty,quick_key,tax_profile_id FROM products WHERE active=1 ORDER BY name').all();
  const csv = stringify(rows, { header:true });
  const dest = path.join(process.env.USERPROFILE || process.env.HOME, 'Desktop', 'hkpos_products_export.csv');
  fs.writeFileSync(dest, csv, 'utf8');
  return dest;
}
function importProducts(filePath){
  const content = fs.readFileSync(filePath, 'utf8');
  const recs = parse(content, { columns:true, skip_empty_lines:true });
  const ins = db.prepare(`INSERT INTO products(sku,name,price,cost,stock_qty,quick_key,tax_profile_id,active)
                          VALUES (@sku,@name,@price,@cost,@stock_qty,@quick_key,@tax_profile_id,1)`);
  const upd = db.prepare(`UPDATE products SET name=@name, price=@price, cost=@cost, stock_qty=@stock_qty,
                          quick_key=@quick_key, tax_profile_id=@tax_profile_id WHERE sku=@sku`);
  const trx = db.transaction((rows)=>{ rows.forEach(r=>{ const p = db.prepare('SELECT id FROM products WHERE sku=?').get(r.sku); if(p) upd.run(r); else ins.run(r); }); });
  trx(recs);
  return { ok:true };
}

function checkPin(pin, action){
  const user = db.prepare('SELECT * FROM users WHERE pin_hash=?').get(pin);
  if(!user) return { allowed:false };
  if(user.role==='manager' || user.role==='owner') return { allowed:true };
  const restricted = ['discount','refund'];
  if(restricted.includes(action)) return { allowed:false };
  return { allowed:true };
}

module.exports = {
  init, getSettings, setSettings,
  listProducts, listQuickKeys, addProduct, updateProduct,
  listTaxProfiles, saveTaxProfile,
  newSale, refundSale, dailySummary,
  exportProducts, importProducts,
  checkPin
};
