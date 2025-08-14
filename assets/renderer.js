const q = (s)=>document.querySelector(s);
const qa = (s)=>Array.from(document.querySelectorAll(s));
const fmt = (n)=> (Math.round(n*100)/100).toFixed(2);

let cart = []; // {id,name,price,qty,sku,tax_profile_id,is_custom}
let lastSaleId = null;

// Tabs
qa('.tab').forEach(t=> t.onclick = ()=>{
  qa('.tab').forEach(x=>x.classList.remove('active'));
  qa('.section').forEach(x=>x.classList.remove('active'));
  t.classList.add('active');
  q('#'+t.dataset.tab).classList.add('active');
  if(t.dataset.tab==='sales'){ loadQuickKeys(); loadSettingsHeader(); }
  if(t.dataset.tab==='products'){ loadTaxProfiles().then(loadProducts); }
  if(t.dataset.tab==='settings'){ loadTaxProfiles(); loadSettings(); }
});

// Settings header
async function loadSettingsHeader(){
  const s = await api.settings.get();
  q('#bizname').innerText = s.business_name || 'HK POS';
}

// Quick Keys + Search
async function loadQuickKeys(){
  const keys = await api.products.quickkeys();
  const box = q('#quickkeys'); box.innerHTML='';
  keys.forEach(p=>{
    const div=document.createElement('div');
    div.className='key';
    div.innerHTML=`<span class="name">${p.name}</span><small>$${fmt(p.price)}</small>`;
    div.onclick=()=> addToCart(p);
    box.appendChild(div);
  });
}
async function search(term){
  const res = await api.products.list(term || '');
  const wrap = q('#results'); wrap.innerHTML = '';
  res.forEach(p=>{
    const row = document.createElement('div');
    row.className='item';
    row.innerHTML = `<div><b>${p.name}</b><div class="badge">SKU: ${p.sku||'-'}</div></div><div>$${fmt(p.price)} • Stock: ${p.stock_qty}</div>`;
    row.onclick=()=>addToCart(p);
    wrap.appendChild(row);
  });
}

// Cart
function renderCart(){
  const tbody = q('#cart tbody'); tbody.innerHTML='';
  let subtotal = 0; const taxTotals = {};
  cart.forEach((it, idx)=>{
    const line = it.price * it.qty; subtotal += line;
    if(it.tax_profile_rates){
      for(const [name, rate] of Object.entries(it.tax_profile_rates)){
        taxTotals[name] = (taxTotals[name] || 0) + (line * rate);
      }
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${it.name}</td>
      <td>$${fmt(it.price)}</td>
      <td class="qty">
         <button data-i="${idx}" data-d="-1">-</button>
         <span>${it.qty}</span>
         <button data-i="${idx}" data-d="1">+</button>
         <button data-discount="${idx}">%</button>
      </td>
      <td>$${fmt(line)}</td>
      <td><button data-r="${idx}">×</button></td>
    `;
    tbody.appendChild(tr);
  });
  q('#subtotal').innerText = fmt(subtotal);

  const taxRows = q('#taxRows'); taxRows.innerHTML='';
  let grand = subtotal;
  Object.entries(taxTotals).forEach(([name, amt])=>{
    grand += amt;
    const div = document.createElement('div');
    div.textContent = `${name}: $${fmt(amt)}`;
    taxRows.appendChild(div);
  });
  q('#grand').innerText = fmt(grand);
}
function addToCart(p){
  const ex = cart.find(x=>x.id===p.id && !p.is_custom);
  if(ex){ ex.qty += 1; } else {
    const rates = p.tax_profile && p.tax_profile.rate_json ? JSON.parse(p.tax_profile.rate_json) : null;
    cart.push({ id:p.id, name:p.name, price:p.price, qty:1, sku:p.sku, tax_profile_id:p.tax_profile_id||null, tax_profile_rates:rates, is_custom: !!p.is_custom });
  }
  renderCart();
}

// Qty / remove / discount
document.addEventListener('click',(e)=>{
  const t=e.target;
  if(t.dataset.i){ const idx=+t.dataset.i; const d=+t.dataset.d; cart[idx].qty = Math.max(1, cart[idx].qty + d); renderCart(); }
  if(t.dataset.r){ const idx=+t.dataset.r; cart.splice(idx,1); renderCart(); }
  if(t.dataset.discount){ requestPin('discount').then(ok=>{
      if(!ok) return;
      const idx=+t.dataset.discount;
      const percent = parseFloat(prompt('Discount % ?','10')) || 0;
      if(percent>0){ cart[idx].price = Math.max(0, cart[idx].price * (1 - percent/100)); renderCart(); }
  });}
});

// Custom item (manual entry)
q('#addCustom').addEventListener('click', async ()=>{
  const name = prompt('Item name (service):'); if(!name) return;
  const price = parseFloat(prompt('Price (before tax):','0')||'0');
  const taxChoice = confirm('Apply GST+PST (OK = yes, Cancel = GST only)?');
  addToCart({ id: 'custom-'+Date.now(), name, price, sku: null, tax_profile: { rate_json: JSON.stringify(taxChoice? {"GST":0.05,"PST":0.07} : {"GST":0.05}) }, tax_profile_id: null, is_custom:true });
});

async function completeSale(){
  if(cart.length===0){ q('#status').innerText='Cart is empty.'; return; }
  const method = q('#method').value;
  const amount = parseFloat(q('#amount').value || 0);
  const sale = {
    items: cart.map(c=>({ product_id: (c.is_custom? null : c.id), name: c.is_custom? c.name : null, qty:c.qty, unit_price:c.price, tax_profile_id: c.tax_profile_id, tax_profile_rates: c.tax_profile_rates })),
    payments: [{ method, amount }]
  };
  const res = await api.sales.new(sale);
  lastSaleId = res.sale_id;
  if(method==='cash'){ await api.printing.kick(); }
  await api.printing.receipt(res.sale_id);
  q('#status').innerText = `Sale complete. Receipt #${res.receipt_no}.`;
  cart = []; renderCart(); q('#amount').value='';
}

// Refund (PIN)
async function doRefund(){
  const receipt = prompt('Enter receipt # to refund'); if(!receipt) return;
  const ok = await requestPin('refund'); if(!ok) return;
  const res = await api.sales.refund({ receipt_no: parseInt(receipt,10) });
  alert(`Refund done: -$${fmt(res.amount)} for receipt #${receipt}`);
}

q('#pay').addEventListener('click', completeSale);
q('#printLast').addEventListener('click', ()=> lastSaleId && api.printing.receipt(lastSaleId));
q('#kick').addEventListener('click', ()=> api.printing.kick());
q('#search').addEventListener('input', (e)=> search(e.target.value));
document.addEventListener('keydown', (e)=>{
  if(e.key==='Enter'){ completeSale(); }
  if(e.key==='F2'){ e.preventDefault(); q('#search').focus(); }
  if(e.ctrlKey && e.key.toLowerCase()==='r'){ e.preventDefault(); doRefund(); }
  if(e.ctrlKey && e.shiftKey && e.key.toLowerCase()==='k'){ e.preventDefault(); api.printing.kick(); }
});

// Products UI
async function loadProducts(){
  const list = await api.products.list('');
  const wrap = q('#plist'); wrap.innerHTML='';
  list.forEach(p=>{
    const row = document.createElement('div');
    row.className='item';
    row.innerHTML = `<div><b>${p.name}</b> ($${fmt(p.price)}) <span class="badge">SKU: ${p.sku||'-'}</span> <span class="badge">Tax: ${p.tax_profile?.name||'-'}</span> ${p.quick_key?'<span class="badge">Quick</span>':''}</div><div>Stock: ${p.stock_qty}</div>`;
    row.onclick = ()=>{
      q('#p_id').value = p.id;
      q('#p_sku').value = p.sku||'';
      q('#p_name').value = p.name;
      q('#p_price').value = p.price;
      q('#p_cost').value = p.cost||0;
      q('#p_stock').value = p.stock_qty||0;
      q('#p_quick').checked = !!p.quick_key;
      q('#p_tax').value = p.tax_profile_id || '';
    };
    wrap.appendChild(row);
  });
}
q('#saveProd').onclick = async ()=>{
  const payload = {
    id: q('#p_id').value ? +q('#p_id').value : undefined,
    sku: q('#p_sku').value || null,
    name: q('#p_name').value,
    price: parseFloat(q('#p_price').value||'0'),
    cost: parseFloat(q('#p_cost').value||'0'),
    stock_qty: parseInt(q('#p_stock').value||'0',10),
    quick_key: q('#p_quick').checked ? 1 : 0,
    tax_profile_id: q('#p_tax').value ? +q('#p_tax').value : null
  };
  if(payload.id){ await api.products.update(payload); } else { await api.products.add(payload); }
  await loadProducts(); await loadQuickKeys();
};

// CSV import/export
q('#exportCSV').onclick = async ()=>{
  const path = await api.csv.exportProducts();
  alert('Exported to: '+path);
};
q('#importCSV').onclick = async ()=>{
  const fileInput = q('#importFile');
  if(!fileInput.files.length){ alert('Choose a CSV file first.'); return; }
  await api.csv.importProducts(fileInput.files[0].path);
  await loadProducts(); await loadQuickKeys();
};

// Taxes
async function loadTaxProfiles(){
  const list = await api.taxProfiles.list();
  const box = q('#t_list'); box.innerHTML='';
  const sel = q('#p_tax'); sel.innerHTML = '<option value="">No Tax</option>';
  list.forEach(t=>{
    const div=document.createElement('div'); div.className='item';
    div.innerHTML = `<div><b>${t.name}</b> <span class="badge">${t.rate_json}</span></div>`;
    div.onclick = ()=>{ q('#t_id').value=t.id; q('#t_name').value=t.name; q('#t_json').value=t.rate_json; };
    box.appendChild(div);
    const opt = document.createElement('option'); opt.value=t.id; opt.textContent=t.name; sel.appendChild(opt);
  });
}
q('#t_save').onclick = async ()=>{
  const tp = { id: q('#t_id').value? +q('#t_id').value : undefined, name: q('#t_name').value, rate_json: q('#t_json').value };
  await api.taxProfiles.save(tp); await loadTaxProfiles();
};

// Settings
async function loadSettings(){
  const s = await api.settings.get();
  q('#s_name').value = s.business_name || '';
  q('#s_round').checked = !!s.round_cash;
}
q('#s_save').onclick = async ()=>{
  await api.settings.set({ business_name: q('#s_name').value, round_cash: q('#s_round').checked ? '1' : '0' });
  await loadSettingsHeader();
};

// PIN modal helpers
function showPin(){ q('#pinModal').style.display='flex'; q('#pinInput').value=''; q('#pinMsg').innerText=''; }
function hidePin(){ q('#pinModal').style.display='none'; }
function requestPin(action){
  return new Promise((resolve)=>{
    showPin();
    q('#pinOk').onclick = async ()=>{
      const ok = await api.auth.checkPin({ pin: q('#pinInput').value, action });
      if(ok && ok.allowed){ hidePin(); resolve(true); } else { q('#pinMsg').innerText='Invalid PIN or permission.'; }
    };
    q('#pinCancel').onclick = ()=>{ hidePin(); resolve(false); };
  });
}

// Init
loadQuickKeys(); search(''); renderCart(); loadSettingsHeader();
q('#search').addEventListener('input', (e)=> search(e.target.value));
