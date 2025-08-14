const fs = require('fs');
const path = require('path');

function rotateBackups(dir, keep=10){
  const files = fs.readdirSync(dir).filter(f=>f.endsWith('.dbbak')).sort();
  while(files.length > keep){
    const f = files.shift();
    fs.unlinkSync(path.join(dir, f));
  }
}
function backupNow(userDataPath){
  const src = path.join(userDataPath, 'hkpos.db');
  const backups = path.join(userDataPath, 'backups');
  if(!fs.existsSync(backups)) fs.mkdirSync(backups);
  const stamp = new Date().toISOString().slice(0,10)+'_'+String(Date.now()).slice(-6);
  const dest = path.join(backups, `hkpos_${stamp}.dbbak`);
  fs.copyFileSync(src, dest);
  rotateBackups(backups, 10);
  return dest;
}
function scheduleBackups(userDataPath){
  backupNow(userDataPath);
  setInterval(()=> backupNow(userDataPath), 24*60*60*1000);
}
module.exports = { scheduleBackups, backupNow };
