// Seed some sample products & services (run: npm run seed)
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const dbPath = path.join(require('electron').app ? require('electron').app.getPath('userData') : path.join(os.homedir(), '.hkpos'), 'hkpos.db');
const db = new Database(dbPath);

function run(sql, params){ db.prepare(sql).run(params || {}); }

db.prepare('PRAGMA journal_mode = WAL').run();

// ensure tax_profiles
const tpCount = db.prepare('SELECT COUNT(1) c FROM tax_profiles').get().c;
if(!tpCount){
  run(`CREATE TABLE IF NOT EXISTS tax_profiles (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, rate_json TEXT)`);
  run(`INSERT INTO tax_profiles(name, rate_json) VALUES (?,?)`, ['GST 5%','{"GST":0.05}']);
  run(`INSERT INTO tax_profiles(name, rate_json) VALUES (?,?)`, ['GST+PST 12%','{"GST":0.05,"PST":0.07}']);
}

// ensure products table
run(`CREATE TABLE IF NOT EXISTS products (
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
)`);

// sample rows
run(`INSERT OR IGNORE INTO products (sku,name,price,cost,stock_qty,quick_key,tax_profile_id,active)
VALUES (NULL,'Service: Passport Photo', 14.99, 0, 0, 1, 1, 1)`);
run(`INSERT OR IGNORE INTO products (sku,name,price,cost,stock_qty,quick_key,tax_profile_id,active)
VALUES (NULL,'Service: Phone Repair - Basic', 49.99, 0, 0, 1, 2, 1)`);
run(`INSERT OR IGNORE INTO products (sku,name,price,cost,stock_qty,quick_key,tax_profile_id,active)
VALUES ('ACC001','USB-C Cable', 9.99, 3.00, 40, 1, 2, 1)`);

console.log('Seeded sample data.');
