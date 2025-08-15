// src/printing.js
const escpos = require('escpos'); escpos.USB = require('escpos-usb');
const fs = require('fs');
const path = require('path');
const { getSettings } = require('./db');
const Database = require('better-sqlite3');
const db = new Database(path.join(process.cwd(),'hkpos.db'));

function _getDevice(){
  try {
    const device = new escpos.USB(); // Epson TM-T88V over USB
    const printer = new escpos.Printer(device, { width: 48 });
    return { device, printer };
  } catch { return null; }
}

async function kickDrawer(){
  const dev = _getDevice(); if(!dev) return false;
  const { device, printer } = dev;
  return new Promise(resolve=>{
    device.open(()=>{ printer.cashdraw(); printer.close(); resolve(true); });
  });
}

async function printReceipt(sale_id){
  const dev = _getDevice(); if(!dev) return false;
  const { device, printer } = dev;
  const s = getSettings();
  const sale = db.prepare('SELECT * FROM sales WHERE id=?').get(sale_id);
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id=?').all(sale_id);

  return new Promise(resolve=>{
    device.open(async ()=>{
      printer.align('ct');
      // logo (best effort)
      try{
        const logo = s.logo_path && fs.existsSync(s.logo_path) ? s.logo_path : path.join(process.cwd(), 'assets', 'hkpos-logo.svg');
        if (fs.existsSync(logo)) {
          const img = await escpos.Image.load(logo);
          printer.raster(img, 'dwdh');
        }
      }catch{}
      printer.style('b').text(s.business_name || 'HK POS').style('normal');
      printer.text(new Date(sale.ts).toLocaleString());
      printer.drawLine();
      printer.align('lt');
      for (const i of items) {
        printer.text(`${i.qty} x ${i.name}   $${(i.price*i.qty).toFixed(2)}`);
      }
      printer.drawLine();
      printer.text(`Subtotal: $${sale.subtotal.toFixed(2)}`);
      printer.text(`GST:      $${sale.gst.toFixed(2)}   PST: $${sale.pst.toFixed(2)}`);
      printer.style('b').text(`TOTAL:    $${sale.total.toFixed(2)}`).style('normal');
      printer.text(`Paid: ${sale.method.toUpperCase()}`);
      printer.newLine(); printer.cut(); printer.close();
      resolve(true);
    });
  });
}

module.exports = { printReceipt, kickDrawer };
