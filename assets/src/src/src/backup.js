// src/backup.js
const fs = require('fs');
const path = require('path');

function backupNow(userDataDir){
  const src = path.join(process.cwd(),'hkpos.db');
  const dir = path.join(userDataDir,'backups');
  fs.mkdirSync(dir, { recursive:true });
  const stamp = new Date().toISOString().replace(/[:T]/g,'-').slice(0,19);
  const dest = path.join(dir, `hkpos-${stamp}.db`);
  fs.copyFileSync(src, dest);

  // keep last 10
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.db')).sort().reverse();
  files.slice(10).forEach(f=> fs.unlinkSync(path.join(dir,f)));
  return dest;
}

function scheduleBackups(userDataDir){
  // simple once-a-day timer after app start
  const oneDay = 24*60*60*1000;
  // do a backup now on startup
  try { backupNow(userDataDir); } catch {}
  setInterval(()=> { try { backupNow(userDataDir); } catch {} }, oneDay);
}

module.exports = { scheduleBackups, backupNow };
