// ESC/POS printing + Cash Drawer (Epson TM-T88V or compatible)
const escpos = require('escpos');
escpos.USB = require('escpos-usb');

function _getDevice(){
  try {
    const device = new escpos.USB(); // default USB thermal printer
    const options = { encoding: "GB18030" };
    const printer = new escpos.Printer(device, options);
    return { device, printer };
  } catch (e) {
    return null;
  }
}
function _fetchSaleData(sale_id){
  const Database = require('better-sqlite3');
  const path = require('path');
  const dbPath = path.join(require('electron').app.getPath('userData'), 'hkpos.db');
  const sdb = new Database(dbPath);
  const sale = sdb.prepare('SELECT * FROM sales WHERE id=?').get(sale_id);
  const items = sdb.prepare('SELECT qty, unit_price, line_total, name, product_id FROM sale_items WHERE sale_id=?').all(sale_id);
  const withNames = items.map(it=>{
    if(it.name) return it;
    const p = sdb.prepare('SELECT name FROM products WHERE id=?').get(it.product_id||-1);
    return { ...it, name: (p && p.name) ? p.name : 'Item' };
  });
  const settingsRows = sdb.prepare('SELECT key,value FROM settings').all();
  const settings = settingsRows.reduce((m,r)=> (m[r.key]=r.value,m), {});
  return { sale, items: withNames, settings };
}

async function printReceipt(sale_id){
  const dev = _getDevice();
  if(!dev) throw new Error('Printer not found');
  const { device, printer } = dev;

  const { sale, items, settings } = _fetchSaleData(sale_id);
  const name = settings.business_name || 'HK POS';

  device.open(()=>{
    printer
      .align('ct')
      .style('b').size(1,1).text(name).size(0,0).style('normal')
      .text(new Date().toLocaleString())
      .text('--------------------------------')
      .align('lt');

    items.forEach(it=>{
      const line = (it.qty * it.unit_price).toFixed(2);
      printer.text(`${it.qty} x ${it.name}`);
      printer.text(`   @ ${it.unit_price.toFixed(2)}   = ${line}`);
    });

    printer.text('--------------------------------');
    printer.text(`Subtotal: ${sale.subtotal.toFixed(2)}`);
    printer.text(`Tax:      ${sale.tax_total.toFixed(2)}`);
    printer.size(1,1).text(`TOTAL:   ${sale.grand_total.toFixed(2)}`).size(0,0);
    printer.text('All prices shown are before tax.');
    printer.text('Thank you!');
    printer.cut().close();
  });
  return { ok:true };
}

function kickDrawer(){
  const dev = _getDevice();
  if(!dev) throw new Error('Printer not found');
  const { device, printer } = dev;
  device.open(()=>{
    if (typeof printer.cashdraw === 'function') printer.cashdraw(2);
    else { printer.hardware('cashdraw'); }
    printer.close();
  });
  return { ok:true };
}

module.exports = { printReceipt, kickDrawer };
