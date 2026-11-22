/* Famous Accounts - front end */
const $ = s => document.querySelector(s);
const fmt = n => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = n => '৳ ' + fmt(n);
const drcr = n => (n < 0 ? fmt(-n) + ' Cr' : fmt(n) + ' Dr');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const monthStart = () => today().slice(0, 8) + '01';
const VT = { CP: 'Cash Payment', CR: 'Cash Receipt', BP: 'Bank Payment', BR: 'Bank Receipt', CT: 'Contra (Transfer)', JV: 'Journal' };
let ACC = [], SET = {};

function fyStart() {
  const [m, d] = (SET.fiscal_start || '07-01').split('-'), y = +today().slice(0, 4), s = `${y}-${m}-${d}`;
  return s <= today() ? s : `${y - 1}-${m}-${d}`;
}
let LOCKPW = '', LOCKT;
const setLockPw = pw => { LOCKPW = pw; clearTimeout(LOCKT); LOCKT = setTimeout(() => { LOCKPW = ''; }, 10 * 60 * 1000); };
async function api(url, opt = {}) {
  const hd = { 'Content-Type': 'application/json' }; if (LOCKPW) hd['X-Lock-Password'] = LOCKPW;
  const r = await fetch(url, { method: opt.method || 'GET', headers: hd, body: opt.body ? JSON.stringify(opt.body) : undefined });
  if (r.status === 401) { showLogin(); throw new Error('Locked'); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || (r.status === 404 ? 'The server does not recognise this request (HTTP 404). The server program is probably still the old version. Close the app, end all “node.exe” tasks in Task Manager (or restart the computer), then start it again.' : 'Something went wrong (HTTP ' + r.status + ')')); e.locked = !!j.locked; throw e; }
  return j;
}
// asks for the lock password when a change touches a closed month, then retries
function askLockPw(msg) {
  return new Promise(res => {
    modal(`<h3>🔒 Closed period</h3><p>${esc(msg)}</p><input id="lkpw" type="password" placeholder="Lock password" autocomplete="off" style="width:100%"><div class="actions" style="margin-top:12px"><button class="btn" id="lkok">Continue</button><button class="btn ghost" id="lkno">Cancel</button></div>`);
    const done = v => { closeModal(); res(v); };
    $('#lkok').onclick = () => done($('#lkpw').value); $('#lkno').onclick = () => done(null);
    $('#lkpw').onkeydown = e => { if (e.key === 'Enter') done($('#lkpw').value); };
    $('#modal').onclick = e => { if (e.target === $('#modal')) done(null); };
    $('#lkpw').focus();
  });
}
async function lockApi(url, opt) {
  try { return await api(url, opt); }
  catch (e) {
    if (!e.locked) throw e;
    let msg = e.message;
    for (let i = 0; i < 3; i++) {
      LOCKPW = '';
      const pw = await askLockPw(msg); if (!pw) throw new Error('Cancelled');
      setLockPw(pw);
      try { return await api(url, opt); } catch (e2) { if (!e2.locked) throw e2; msg = e2.message; }
    }
    LOCKPW = ''; throw new Error('Wrong lock password');
  }
}
function toast(m, bad) { const t = $('#toast'); t.textContent = m; t.className = 'show' + (bad ? ' bad' : ''); clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 2600); }
function modal(html) { const m = $('#modal'); m.innerHTML = '<div class="card">' + html + '</div>'; m.classList.remove('hidden'); m.onclick = e => { if (e.target === m) closeModal(); }; }
function closeModal() { $('#modal').classList.add('hidden'); }
function csv(name, rows) {
  const t = rows.map(r => r.map(c => '"' + String(c ?? '').replace(/"/g, '""') + '"').join(',')).join('\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['\ufeff' + t], { type: 'text/csv' })); a.download = name; a.click();
}
const opts = (list, sel, ph = 'Select account') => `<option value="">${ph}</option>` + list.map(a => `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('');
const activeAcc = (f = () => true) => ACC.filter(a => a.active && f(a));
const loadAcc = async () => { ACC = await api('/api/accounts'); };

// ---------- theme: Auto / Light / Dark ----------
function applyTheme(m) {
  const r = document.documentElement;
  if (m === 'light' || m === 'dark') r.setAttribute('data-theme', m); else r.removeAttribute('data-theme');
  try { localStorage.setItem('fa_theme', m === 'light' || m === 'dark' ? m : 'auto'); } catch (e) { /* ignore */ }
  document.querySelectorAll('#themeSw button').forEach(b => b.classList.toggle('on', b.dataset.m === (m === 'light' || m === 'dark' ? m : 'auto')));
}
function initTheme() {
  let m = 'auto'; try { m = localStorage.getItem('fa_theme') || 'auto'; } catch (e) { /* ignore */ }
  document.querySelectorAll('#themeSw button').forEach(b => b.onclick = () => applyTheme(b.dataset.m));
  applyTheme(m);
}

// ---------- searchable dropdown (type to search, Enter to pick, "+ Add" when not found) ----------
let CBF = null, CBA = null, CBP = null;
function cbFloat() { if (!CBF) { CBF = document.createElement('div'); CBF.className = 'cbf hidden'; document.body.appendChild(CBF); } return CBF; }
function cbHide() { if (CBF) CBF.classList.add('hidden'); CBA = null; }
window.addEventListener('scroll', () => { if (CBA && CBP) CBP(); }, true);
window.addEventListener('resize', () => { if (CBA && CBP) CBP(); });
// cfg: items() -> [{label,name?,sub?}], current() -> {label}|null, onPick(item|null), freeText, onText(text),
//      onAdd(text) async, addLabel(text), addAlways
function attachCombo(inp, cfg) {
  const fl = cbFloat(); let list = [], idx = 0, typed = false, mute = false;
  const build = () => {
    const raw = inp.value.trim(), q = raw.toLowerCase(), all = cfg.items(), filt = typed && q;
    let m = filt ? all.filter(it => q.split(/\s+/).every(t => it.label.toLowerCase().includes(t))) : all.slice();
    if (filt) m.sort((a, b) => (b.label.toLowerCase().startsWith(q) ? 1 : 0) - (a.label.toLowerCase().startsWith(q) ? 1 : 0));
    list = m.slice(0, 80);
    const exact = all.some(it => (it.name || it.label).toLowerCase() === q);
    if (cfg.onAdd && (cfg.addAlways || (raw && !exact))) list.push({ add: true, text: raw });
    if (idx > list.length - 1) idx = Math.max(0, list.length - 1);
  };
  const place = () => {
    const r = inp.getBoundingClientRect(), below = window.innerHeight - r.bottom;
    fl.style.left = r.left + 'px'; fl.style.width = Math.max(r.width, 240) + 'px';
    if (below < 200 && r.top > below) { fl.style.top = 'auto'; fl.style.bottom = (window.innerHeight - r.top + 2) + 'px'; fl.style.maxHeight = Math.max(120, Math.min(280, r.top - 10)) + 'px'; }
    else { fl.style.bottom = 'auto'; fl.style.top = (r.bottom + 2) + 'px'; fl.style.maxHeight = Math.max(120, Math.min(280, below - 10)) + 'px'; }
  };
  const paint = () => {
    fl.innerHTML = list.map((it, i) => it.add ? `<div class="add${i === idx ? ' on' : ''}" data-i="${i}">${esc(cfg.addLabel(it.text))}</div>`
      : `<div class="${i === idx ? 'on' : ''}" data-i="${i}">${esc(it.label)}${it.sub ? ` <small>${esc(it.sub)}</small>` : ''}</div>`).join('') || '<div class="none">No matches</div>';
    place(); const on = fl.querySelector('.on'); if (on && on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
  };
  const open = () => { CBA = inp; CBP = place; build(); fl.classList.remove('hidden'); fl.onmousedown = e => { const d = e.target.closest('[data-i]'); if (!d || CBA !== inp) return; e.preventDefault(); pick(list[+d.dataset.i]); }; paint(); };
  const close = () => { if (CBA === inp) cbHide(); };
  const setVal = it => { inp.value = it.label; if (cfg.freeText) { mute = true; inp.dispatchEvent(new Event('input', { bubbles: true })); mute = false; } };
  async function pick(it) {
    if (!it) return;
    if (it.add) { close(); await cfg.onAdd(it.text); return; }
    close(); typed = false; setVal(it); cfg.onPick && cfg.onPick(it);
  }
  inp.addEventListener('focus', () => { typed = false; idx = 0; open(); if (inp.select) inp.select(); });
  inp.addEventListener('click', () => { if (CBA !== inp) { typed = false; open(); } });
  inp.addEventListener('input', () => { if (mute) return; typed = true; idx = 0; if (cfg.freeText && cfg.onText) cfg.onText(inp.value); open(); });
  inp.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); if (CBA !== inp) open(); idx = Math.min(list.length - 1, idx + 1); paint(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); idx = Math.max(0, idx - 1); paint(); }
    else if (e.key === 'Enter') { if (CBA === inp && list[idx]) { e.preventDefault(); pick(list[idx]); } }
    else if (e.key === 'Escape') close();
    else if (e.key === 'Tab' && CBA === inp && typed && list[idx] && !list[idx].add && !cfg.freeText) { inp.value = list[idx].label; cfg.onPick && cfg.onPick(list[idx]); typed = false; }
  });
  inp.addEventListener('blur', () => {
    close();
    if (cfg.freeText) return;
    const c = cfg.current && cfg.current();
    if (!inp.value.trim()) { if (c) cfg.onPick && cfg.onPick(null); } else inp.value = c ? c.label : '';
  });
}

// ---------- quick "add new account" from a dropdown ----------
const TYPE_LBL = { expense: 'Expense', income: 'Income', asset: 'Asset (e.g. buyer receivable, advance)', liability: 'Liability (e.g. supplier payable, loan)', equity: 'Equity' };
const accLabel = id => { const a = ACC.find(x => String(x.id) === String(id)); return a ? `${a.code} · ${a.name}` : ''; };
function nextCode(type) {
  const d = { asset: 1, liability: 2, equity: 3, income: 4, expense: 5 }[type] || 5;
  const nums = ACC.map(a => a.code).filter(c => /^\d+$/.test(c) && c[0] === String(d));
  let n = nums.length ? Math.max(...nums.map(Number)) + 10 : d * 1000 + 10;
  while (ACC.some(a => a.code === String(n))) n++;
  return String(n);
}
function quickAddAccount(name, defType) {
  return new Promise(res => {
    modal(`<h3>Add new account</h3><div class="row"><div class="grow"><label>Account name</label><input id="qn" value="${esc(name || '')}"></div></div>
      <div class="row"><div class="grow"><label>Type</label><select id="qt">${Object.entries(TYPE_LBL).map(([k, l]) => `<option value="${k}" ${k === defType ? 'selected' : ''}>${l}</option>`).join('')}</select></div><div><label>Code</label><input id="qc" value="${nextCode(defType)}" style="width:100px"></div></div>
      <div class="muted">Tip: a supplier you owe money to is a Liability; a buyer who owes you is an Asset.</div>
      <div class="actions" style="margin-top:12px"><button class="btn" id="qok">Add account</button><button class="btn ghost" id="qno">Cancel</button></div><div class="err" id="qer"></div>`);
    let edited = false; $('#qc').oninput = () => { edited = true; }; $('#qt').onchange = () => { if (!edited) $('#qc').value = nextCode($('#qt').value); };
    const done = v => { closeModal(); res(v); };
    $('#qno').onclick = () => done(null); $('#modal').onclick = e => { if (e.target === $('#modal')) done(null); };
    $('#qok').onclick = async () => {
      const n = $('#qn').value.trim();
      if (!n) return ($('#qer').textContent = 'Enter the account name');
      if (ACC.some(a => a.name.toLowerCase() === n.toLowerCase())) return ($('#qer').textContent = 'An account with this name already exists. Search for it in the list.');
      try { const r = await api('/api/accounts', { method: 'POST', body: { code: $('#qc').value, name: n, type: $('#qt').value, kind: 'normal' } }); await loadAcc(); toast('Account added'); done(ACC.find(a => a.id === r.id)); }
      catch (e) { $('#qer').textContent = e.message; }
    };
    setTimeout(() => $('#qn') && $('#qn').focus(), 50);
  });
}


// ---------- printing: documents + print preview ----------
const _O = 'One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' '), _T = '_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split(' ');
const _w2 = n => n < 20 ? (_O[n - 1] || '') : _T[Math.floor(n / 10)] + (n % 10 ? '-' + _O[n % 10 - 1] : '');
function _wi(n) {
  if (n <= 0) return 'Zero';
  const o = [];
  for (const [d, l] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand'], [100, 'Hundred']]) if (n >= d) { const q = Math.floor(n / d); o.push((q >= 100 ? _wi(q) : _w2(q)) + ' ' + l); n %= d; }
  if (n) o.push(_w2(n));
  return o.join(' ');
}
function takaWords(a) {
  a = Math.round(Number(a || 0) * 100) / 100;
  const t = Math.floor(a + 1e-9), p = Math.round((a - t) * 100);
  if (t === 0 && p > 0) return _wi(p) + ' Paisa Only';
  return 'Taka ' + _wi(t) + (p ? ' and ' + _wi(p) + ' Paisa' : '') + ' Only';
}
const MONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fdate = s => { if (!s || !/^\d{4}-\d{2}-\d{2}/.test(s)) return s || ''; return `${s.slice(8, 10)}-${MONS[+s.slice(5, 7) - 1]}-${s.slice(0, 4)}`; };
let PCO = null;
async function getCompany() { if (!PCO) { try { const r = await api('/api/hr/t/company'); PCO = r[0] || {}; } catch (e) { if (e.message === 'Locked') throw e; PCO = {}; } } return PCO; }
const pgIn = k => { const v = parseFloat(SET[k]); return isNaN(v) ? 1 : v; };
const PAGE_DEFAULT = '@page{size:A4;margin:0}';
// company header + title + body + footer, in the same layout as the payslip / certificate designs
function pdocSync(c, title, sub, body, o = {}) {
  const name = c.name || SET.company_name || 'Company', addr = [c.address, c.phone ? 'Phone: ' + c.phone : ''].filter(Boolean).join(' · ');
  const cls = 'pdoc' + (o.dense ? ' dense' : '') + (SET.print_header === '0' ? ' nohead' : '') + (SET.print_footer === '0' ? ' nofoot' : '');
  return `<div class="${cls}"><div class="pd-head"><div><div class="pd-co">${esc(name)}</div><div class="pd-addr">${esc(addr)}</div></div><div class="pd-r"><div class="pd-title">${esc(title)}</div><div class="pd-sub">${esc(sub || '')}</div></div></div><div class="pd-rule"></div>${body}<div class="pd-foot">${esc(o.foot || 'Computer-generated document.')}&nbsp; ${today()}</div></div>`;
}
const pdoc = async (title, sub, body, o) => pdocSync(await getCompany(), title, sub, body, o);
function pvFit() { const p = $('#pvp'); if (p) p.style.zoom = Math.min(1, (window.innerWidth - 16) / (210 * 3.7795)); }
let PV_CLOSE = null;
function pvClose() { const pv = $('#pv'); pv.hidden = true; pv.innerHTML = ''; document.body.classList.remove('pv-print'); const f = PV_CLOSE; PV_CLOSE = null; if (f) f(); }
function pvPrint(o = {}) {
  if (o.printFn) return o.printFn();
  $('#cqpage').textContent = '@page{size:A4;margin:0}';
  document.body.classList.add('pv-print'); window.print();
}
// default margins (mm) for a kind of document: the saved preset, else the global gaps from Settings
const MM_IN = 25.4, r1 = v => Math.round(v * 10) / 10, numOr = (v, d) => (isFinite(parseFloat(v)) ? parseFloat(v) : d);
function pvMarginsBase(o) {
  let preset = null; try { preset = (JSON.parse(SET.print_margins || '{}') || {})[o.key || 'default']; } catch (e) { /* ignore */ }
  const base = { t: r1(numOr(SET.print_top_in, 1) * MM_IN), b: o.fit ? 0 : r1(numOr(SET.print_bottom_in, 1) * MM_IN), l: numOr(SET.print_left_mm, 12), r: numOr(SET.print_right_mm, 12) };
  return preset ? { t: numOr(preset.t, base.t), b: numOr(preset.b, base.b), l: numOr(preset.l, base.l), r: numOr(preset.r, base.r) } : base;
}
// o: {docs:[html], title, key, keyLabel, controls, note, fit, plain, onPrint(async, return false to cancel), printFn, onReady, onClose}
function pvOpen(o) {
  const pv = $('#pv'), M0 = pvMarginsBase(o); let M = { ...M0 };
  // Chrome/Edge draw their own header/footer (date, title, web address) inside the @page margin, so we print with
  // @page margin 0 and create the margins here: top/bottom with a table whose header and footer rows repeat on every page.
  const wrap = d => `<table class="pv-wrap"><thead><tr><td><div style="height:var(--gt)"></div></td></tr></thead><tbody><tr><td>${d}</td></tr></tbody><tfoot><tr><td><div style="height:var(--gb)"></div></td></tr></tfoot></table>`;
  const guides = '<div class="pv-guide"><span class="gt"></span></div><div class="pv-guide b"><span class="gb"></span></div>';
  const pages = o.plain ? o.docs.map(d => `<div class="pv-page" style="min-height:0;padding:14px"><div>${d}</div></div>`).join('') : o.docs.map(d => `<div class="pv-page${o.fit ? ' fit' : ''}">${guides}${wrap(d)}</div>`).join('');
  const mctl = o.plain ? '' : `<span class="pv-m"><span class="muted">Margins (mm)</span> <label>T</label><input type="number" id="pvmt" min="0" max="80" step="1"> <label>B</label><input type="number" id="pvmb" min="0" max="80" step="1"> <label>L</label><input type="number" id="pvml" min="0" max="60" step="1"> <label>R</label><input type="number" id="pvmr" min="0" max="60" step="1"> <button class="btn ghost sm" id="pvm0" title="Back to the default margins">Reset</button><button class="btn ghost sm" id="pvms" title="Remember these margins for ${esc(o.keyLabel || 'this kind of document')}">Save as default</button></span>`;
  pv.innerHTML = `<div class="pv-bar"><b class="pv-title">${esc(o.title || 'Print preview')}</b>${o.note ? `<span class="muted">${o.note}</span>` : ''}${mctl}<span id="pvctl">${o.controls || ''}</span><span class="pv-act"><button class="btn" id="pvpr">🖨 Print</button><button class="btn ghost" id="pvx">Close</button></span></div><div class="pv-scroll"><div class="pv-pages" id="pvp">${pages}</div></div>`;
  PV_CLOSE = o.onClose || null; pv.hidden = false; pvFit();
  if (!o.plain) {
    const ids = { t: '#pvmt', b: '#pvmb', l: '#pvml', r: '#pvmr' };
    const apply = () => {
      const p = $('#pvp'); if (!p) return;
      p.style.setProperty('--gt', M.t + 'mm'); p.style.setProperty('--gb', M.b + 'mm'); p.style.setProperty('--ml', M.l + 'mm'); p.style.setProperty('--mr', M.r + 'mm');
      p.classList.toggle('nob', M.b <= 0);
      p.querySelectorAll('.gt').forEach(e => { e.textContent = `top ${M.t} mm`; }); p.querySelectorAll('.gb').forEach(e => { e.textContent = `bottom ${M.b} mm`; });
      for (const k in ids) { const el = $(ids[k]); if (el && document.activeElement !== el) el.value = M[k]; }
    };
    Object.entries(ids).forEach(([k, sel]) => { $(sel).oninput = () => { const v = parseFloat($(sel).value); M[k] = isFinite(v) ? Math.min(k === 't' || k === 'b' ? 80 : 60, Math.max(0, v)) : 0; apply(); }; $(sel).onblur = apply; });
    $('#pvm0').onclick = () => { M = { ...M0 }; apply(); };
    $('#pvms').onclick = async () => {
      try {
        const all = JSON.parse(SET.print_margins || '{}') || {}; all[o.key || 'default'] = { t: r1(M.t), b: r1(M.b), l: r1(M.l), r: r1(M.r) };
        await api('/api/settings', { method: 'PUT', body: { print_margins: JSON.stringify(all) } }); SET.print_margins = JSON.stringify(all); M0.t = M.t; M0.b = M.b; M0.l = M.l; M0.r = M.r;
        toast('Margins saved as default for ' + (o.keyLabel || 'this document'));
      } catch (e) { toast(e.message, true); }
    };
    apply();
  }
  $('#pvx').onclick = pvClose;
  $('#pvpr').onclick = async () => { if (o.onPrint) { const r = await o.onPrint(); if (r === false) return; } pvPrint(o); };
  if (o.onReady) o.onReady();
}
window.addEventListener('afterprint', () => { document.body.classList.remove('pv-print'); $('#cqpage').textContent = PAGE_DEFAULT; });
window.addEventListener('resize', pvFit);
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#pv').hidden && !(CBF && !CBF.classList.contains('hidden'))) pvClose(); });
// preview of whatever is on screen (tables, books, reports) in the document design
async function pvFromEl(sel, title, sub) {
  const el = typeof sel === 'string' ? $(sel) : sel;
  if (!el) return toast('Nothing to print yet', true);
  const c = el.cloneNode(true);
  c.querySelectorAll('.noprint,button,select,textarea,script,.actions,.bar').forEach(x => x.remove());
  c.querySelectorAll('input').forEach(i => i.replaceWith(document.createTextNode(i.type === 'checkbox' ? (i.checked ? '✔' : '') : i.value)));
  c.querySelectorAll('a').forEach(a => a.replaceWith(...a.childNodes));
  c.querySelectorAll('[onclick]').forEach(x => x.removeAttribute('onclick'));
  const sign = SET.print_sign_reports === '0' ? '' : '<div class="pd-sign"><div>Prepared by</div><div>Checked by</div><div>Authorized Signature</div></div>';
  const tc = x => String(x).toLowerCase().replace(/(^|\s)\S/g, m => m.toUpperCase());
  pvOpen({ title: tc(title) + (sub ? ' — ' + sub : ''), key: 'report', keyLabel: 'reports and lists', docs: [await pdoc(title, sub, c.innerHTML + sign)] });
}

// ---------- voucher print ----------
const VT_TITLE = { CP: 'CASH PAYMENT VOUCHER', CR: 'CASH RECEIPT VOUCHER', BP: 'BANK PAYMENT VOUCHER', BR: 'BANK RECEIPT VOUCHER', CT: 'CONTRA VOUCHER', JV: 'JOURNAL VOUCHER' };
function voucherDoc(v, c) {
  const amt = v.lines.reduce((s, l) => s + l.debit, 0), pay = v.vtype === 'CP' || v.vtype === 'BP', rec = v.vtype === 'CR' || v.vtype === 'BR';
  const grid = [[pay ? 'Paid to' : rec ? 'Received from' : 'Party', v.party], ['Cheque / ref no.', v.cheque_no], ['Bill / memo no.', v.ref], ['Voucher type', VT[v.vtype]]]
    .map(([a, b]) => `<div><span>${a}</span><b>${esc(b || '—')}</b></div>`).join('');
  const rows = v.lines.map(l => `<tr><td>${esc(l.code)} · ${esc(l.name)}</td><td class="n">${l.debit ? fmt(l.debit) : ''}</td><td class="n">${l.credit ? fmt(l.credit) : ''}</td></tr>`).join('');
  const body = `<div class="pd-band"><span>Voucher No.: ${esc(v.voucher_no)}</span><span>Date: ${fdate(v.vdate)}</span></div><div class="pd-grid">${grid}</div>
    <div class="pd-card mb"><div class="h"><span>Account</span><span>Debit &nbsp;&nbsp;|&nbsp;&nbsp; Credit (Tk.)</span></div><table class="pd-tbl"><tbody>${rows}<tr class="tot"><td>Total</td><td class="n">${fmt(amt)}</td><td class="n">${fmt(amt)}</td></tr></tbody></table></div>
    <div class="pd-net"><span class="l">Amount</span><span class="v">Tk. ${fmt(amt)}</span></div><div class="pd-words"><small>In words</small>${esc(takaWords(amt))}</div>
    ${v.narration ? `<div class="pd-text"><h4>Narration</h4>${esc(v.narration)}</div>` : ''}
    <div class="pd-sign"><div>Prepared by</div><div>Checked by</div><div>Approved by</div><div>${pay ? 'Received by' : 'Paid by'}</div></div>`;
  return pdocSync(c, VT_TITLE[v.vtype], 'Accounts voucher', body, { foot: 'Computer-generated voucher.' });
}
async function pvVoucher(id) { closeModal(); try { const v = await api('/api/vouchers/' + id); pvOpen({ title: 'Voucher ' + v.voucher_no + ' — ' + VT[v.vtype], key: 'voucher', keyLabel: 'vouchers', docs: [voucherDoc(v, await getCompany())] }); } catch (e) { toast(e.message, true); } }

// ---------- daily petty cash summary ----------
const DY = { acc: '', date: '' };
function dailyDoc(b, date, c, hd) {
  const acc = b.account, rec = b.rows.filter(r => r.debit > 0), pay = b.rows.filter(r => r.credit > 0), lim = +SET.imprest_limit || 0;
  const isTr = r => r.transfer_no || r.vtype === 'CT', tIn = Math.round(rec.filter(isTr).reduce((s, r) => s + r.debit * 100, 0)) / 100, tOut = Math.round(pay.filter(isTr).reduce((s, r) => s + r.credit * 100, 0)) / 100;
  const who = r => `${r.party ? `<b>${esc(r.party)}</b>` : ''}${r.narration ? `<div class="muted" style="font-size:7.5pt">${esc(r.narration)}</div>` : ''}`;
  const tbl = (rows, key, head) => `<div class="pd-card mb"><div class="h"><span>${head}</span><span>${rows.length} voucher${rows.length === 1 ? '' : 's'}</span></div><table class="pd-tbl"><thead><tr><th>Voucher</th><th>${key === 'debit' ? 'Received for' : 'Head of account'}</th><th>${key === 'debit' ? 'Received from' : 'Paid to'} / narration</th><th class="n">Amount (Tk.)</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td>${esc(r.voucher_no)}</td><td>${esc(r.counter)}</td><td>${who(r)}</td><td class="n">${fmt(r[key])}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No transactions</td></tr>'}
    <tr class="tot"><td colspan="3">Total ${head.toLowerCase()}</td><td class="n">${fmt(key === 'debit' ? b.total_debit : b.total_credit)}</td></tr></tbody></table></div>`;
  const heads = (hd && hd.paid ? hd.paid : []).map(x => [x.name, Number(x.amount)]);
  const body = `<div class="pd-band"><span>Date: ${fdate(date)}</span><span>Account: ${esc(acc.code)} · ${esc(acc.name)}</span></div>
    <div class="pd-grid"><div><span>Opening balance</span><b>${fmt(b.opening)}</b></div><div><span>Imprest limit</span><b>${fmt(lim)}</b></div><div><span>Total receipts</span><b>${fmt(b.total_debit)}</b></div><div><span>Total payments</span><b>${fmt(b.total_credit)}</b></div>${tIn || tOut ? `<div><span>of receipts: cash from bank / transfers</span><b>${fmt(tIn)}</b></div><div><span>of payments: cash to bank / transfers</span><b>${fmt(tOut)}</b></div>` : ''}</div>
    ${tbl(rec, 'debit', 'Receipts')}${tbl(pay, 'credit', 'Payments')}
    ${heads.length ? `<div class="pd-card mb"><div class="h"><span>Payments by head</span><span>Tk.</span></div>${heads.map(([n, a]) => `<div class="ln"><span>${esc(n)}</span><span class="a">${fmt(a)}</span></div>`).join('')}</div>` : ''}
    <div class="pd-net"><span class="l">Closing cash balance</span><span class="v">Tk. ${fmt(b.closing)}</span></div>
    <div class="pd-words"><small>In words</small>${esc(takaWords(b.closing))}</div>
    <div class="pd-grid"><div><span>To replenish up to imprest limit</span><b>${fmt(Math.max(0, lim - b.closing))}</b></div><div><span>Physical cash counted</span><b>______________</b></div></div>
    <div class="pd-sign"><div>Prepared by (Cashier)</div><div>Checked by</div><div>Authorized Signature</div></div>`;
  return pdocSync(c, 'DAILY CASH SUMMARY', 'Petty cash report', body, { foot: 'Computer-generated petty cash summary.', dense: true });
}
async function vDaily() {
  head('Daily Cash Summary');
  const list = activeAcc(a => a.kind === 'cash');
  if (!list.length) { $('#view').innerHTML = '<h2>Daily Cash Summary</h2><div class="card">Add a petty cash account first (Chart of Accounts, kind “Petty cash / cash”).</div>'; return; }
  if (!DY.acc || !list.find(a => String(a.id) === String(DY.acc))) DY.acc = list[0].id;
  if (!DY.date) DY.date = today();
  $('#view').innerHTML = `<h2>Daily Cash Summary</h2><div class="card"><div class="row noprint"><div class="grow"><label>Petty cash account</label><select id="dya">${opts(list, DY.acc, 'Select')}</select></div>
    <div><label>Date</label><div style="display:flex;gap:6px"><button class="btn ghost" id="dyp">◀</button><input type="date" id="dyd" value="${DY.date}"><button class="btn ghost" id="dyn">▶</button></div></div>
    <button class="btn ghost" id="dyt">Today</button><button class="btn" id="dypr">🖨 Print preview</button></div>
    <div style="background:#fff;border-radius:10px;padding:18px;border:1px solid var(--line);overflow-x:auto"><div id="dysheet"></div></div></div>`;
  let cur = null;
  const run = async () => {
    DY.acc = $('#dya').value; DY.date = $('#dyd').value; if (!DY.acc || !DY.date) return;
    const [b, c, hd] = await Promise.all([api(`/api/book/${DY.acc}?from=${DY.date}&to=${DY.date}`), getCompany(), api(`/api/cash-heads/${DY.acc}?date=${DY.date}`)]);
    cur = dailyDoc(b, DY.date, c, hd); $('#dysheet').innerHTML = cur;
  };
  const shift = n => { const d = new Date($('#dyd').value + 'T00:00:00'); d.setDate(d.getDate() + n); $('#dyd').value = new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); run(); };
  $('#dya').onchange = $('#dyd').onchange = run; $('#dyp').onclick = () => shift(-1); $('#dyn').onclick = () => shift(1);
  $('#dyt').onclick = () => { $('#dyd').value = today(); run(); };
  $('#dypr').onclick = () => { if (cur) pvOpen({ title: 'Daily Cash Summary — ' + fdate(DY.date), key: 'daily', keyLabel: 'the daily cash summary', docs: [cur] }); };
  run();
}

// ---------- party list (payees / payers) ----------
let PARTIES = [];
const loadParties = async () => { try { PARTIES = await api('/api/parties'); } catch (e) { if (e.message === 'Locked') throw e; } };
const mergeParty = p => { const i = PARTIES.findIndex(x => x.id === p.id); if (i >= 0) PARTIES[i] = { ...PARTIES[i], ...p }; else PARTIES.push({ total_paid: 0, total_received: 0, vouchers: 0, active: 1, ...p }); PARTIES.sort((a, b) => a.name.localeCompare(b.name)); };
const partyKindOk = (p, k) => p.active && (!k || p.kind === k || p.kind === 'both');
const KIND_LBL = { paid: 'Paid (payee)', receipt: 'Receipt (payer)', both: 'Both' };
let PL = { tab: 'all', q: '' };
async function vParties() {
  head('Party List'); await loadParties();
  $('#view').innerHTML = `<h2>Party List</h2><div class="card"><div class="row noprint">
    <div class="actions" id="plt">${[['all', 'All'], ['paid', 'Paid (payees)'], ['receipt', 'Receipt (payers)']].map(([k, l]) => `<button class="btn ${PL.tab === k ? '' : 'ghost'}" data-t="${k}">${l}</button>`).join('')}</div>
    <div class="grow"><input id="plq" placeholder="Search name or phone" value="${esc(PL.q)}"></div><button class="btn" id="pladd">+ Add party</button><button class="btn ghost" id="plpr">🖨 Print preview</button></div>
    <p class="muted" style="margin-top:0">Names are added here automatically whenever you save a voucher or cheque. They appear in the “Paid to / Received from” dropdowns.</p><div id="pll"></div></div>`;
  const draw = () => {
    PL.q = $('#plq').value; const q = PL.q.toLowerCase();
    const rows = PARTIES.filter(p => (PL.tab === 'all' || p.kind === PL.tab || p.kind === 'both') && (!q || (p.name + ' ' + (p.phone || '')).toLowerCase().includes(q)));
    $('#pll').innerHTML = `<div class="wrap"><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Phone</th><th class="n">Total paid</th><th class="n">Total received</th><th>Last</th></tr></thead><tbody>
    ${rows.map(p => `<tr class="click" data-id="${p.id}" style="${p.active ? '' : 'opacity:.5'}"><td>${esc(p.name)}${p.active ? '' : ' <span class="muted">(inactive)</span>'}${p.note ? `<div class="muted">${esc(p.note)}</div>` : ''}</td><td><span class="badge">${KIND_LBL[p.kind]}</span></td><td>${esc(p.phone)}</td><td class="n">${p.total_paid ? fmt(p.total_paid) : ''}</td><td class="n">${p.total_received ? fmt(p.total_received) : ''}</td><td>${esc(p.last_date)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No parties yet. Press + Add party, or just save a voucher with a “Paid to / Received from” name.</td></tr>'}</tbody></table></div>`;
    document.querySelectorAll('#pll tr.click').forEach(tr => tr.onclick = () => editParty(+tr.dataset.id));
  };
  document.querySelectorAll('#plt button').forEach(b => b.onclick = () => { PL.tab = b.dataset.t; vParties(); });
  $('#plq').oninput = draw; $('#pladd').onclick = () => editParty(null);
  $('#plpr').onclick = () => pvFromEl('#pll', 'PARTY LIST', { all: 'All parties', paid: 'Paid (payees)', receipt: 'Receipt (payers)' }[PL.tab]);
  draw();
}
function editParty(id) {
  const p = id ? PARTIES.find(x => x.id === id) : { name: '', kind: PL.tab === 'all' ? 'paid' : PL.tab, phone: '', note: '', active: 1 };
  modal(`<h3>${id ? 'Edit' : 'Add'} party</h3><div class="row"><div class="grow"><label>Name</label><input id="pn" value="${esc(p.name)}"></div>
    <div><label>Type</label><select id="pk">${Object.entries(KIND_LBL).map(([k, l]) => `<option value="${k}" ${p.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
    <div class="row"><div><label>Phone</label><input id="pp" value="${esc(p.phone)}"></div><div class="grow"><label>Note</label><input id="pt" value="${esc(p.note)}"></div>
    ${id ? `<div><label>Status</label><select id="pa"><option value="1" ${p.active ? 'selected' : ''}>Active</option><option value="0" ${p.active ? '' : 'selected'}>Inactive</option></select></div>` : ''}</div>
    <div class="actions"><button class="btn" id="psv">Save</button>${id ? '<button class="btn ghost" id="pvv">View vouchers</button><button class="btn red" id="pdl">Delete</button>' : ''}<button class="btn ghost" onclick="closeModal()">Cancel</button></div><div class="err" id="per"></div>`);
  $('#psv').onclick = async () => {
    const body = { name: $('#pn').value, kind: $('#pk').value, phone: $('#pp').value, note: $('#pt').value, active: $('#pa') ? +$('#pa').value : 1 };
    try {
      if (id) await lockApi('/api/parties/' + id, { method: 'PUT', body });
      else { const r = await api('/api/parties', { method: 'POST', body }); if (r.existed) toast('Already in the list. Type updated.'); }
      closeModal(); toast('Saved'); vParties();
    } catch (e) { $('#per') ? $('#per').textContent = e.message : toast(e.message, true); }
  };
  if (id) {
    $('#pvv').onclick = () => { VF = { from: '', to: '', type: '', q: p.name }; closeModal(); go('vouchers'); };
    $('#pdl').onclick = async () => { if (!confirm('Delete this party?')) return; try { await api('/api/parties/' + id, { method: 'DELETE' }); closeModal(); toast('Deleted'); vParties(); } catch (e) { $('#per').textContent = e.message; } };
  }
}

const head = (title, period) => { $('#printHead').innerHTML = `<h2>${esc(SET.company_name)}</h2><div>${esc(title)}${period ? ' · ' + esc(period) : ''}</div>`; };

// ---------- navigation ----------
const NAV = [['dashboard', 'Dashboard'], ['sep', 'Transactions'], ['voucher', 'New Voucher'], ['vouchers', 'All Vouchers'], ['xfer', 'Inter-Account Transfer'], ['xfers', 'Transfer Register'], ['recurring', 'Recurring Vouchers'], ['chq', 'Cheque Printing'], ['parties', 'Party List'], ['sep', 'Books'], ['cashbook', 'Petty Cash Book'], ['daily', 'Daily Cash Summary'], ['bankbook', 'Bank Book'], ['ledger', 'Ledger'], ['sep', 'Reports'], ['tb', 'Trial Balance'], ['recon', 'Bank Reconciliation'], ['forecast', 'Cash Forecast'], ['sep', 'HR'], ['payroll', 'Certificate & Payslip'], ['sep', 'Setup'], ['coa', 'Chart of Accounts'], ['settings', 'Settings & Backup']];
function buildNav() {
  $('#nav').innerHTML = NAV.map(([k, l]) => k === 'sep' ? `<div class="sep">${l}</div>` : `<button data-v="${k}">${l}</button>`).join('');
  $('#nav').onclick = e => { const b = e.target.closest('button'); if (b) { go(b.dataset.v); $('#side').classList.remove('open'); } };
}
const VIEWS = { recurring: a => window.vRecurring(a), forecast: a => window.vForecast(a), dashboard: vDashboard, voucher: vVoucher, vouchers: vVouchers, cashbook: () => vBook('cash'), daily: vDaily, bankbook: () => vBook('bank'), ledger: () => vBook('any'), tb: vTB, recon: () => window.vRecon(), chq: () => window.vCheque(), xfer: a => window.vTransfer(a), xfers: a => window.vTransfers(a), parties: vParties, payroll: vPayroll, coa: vCOA, settings: vSettings };
async function go(name, arg) {
  location.hash = name; cbHide();
  document.querySelectorAll('#nav button').forEach(b => b.classList.toggle('on', b.dataset.v === name));
  try { await loadAcc(); await VIEWS[name](arg); } catch (e) { if (e.message !== 'Locked') $('#view').innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
}

// ---------- dashboard ----------
async function vDashboard() {
  head('Dashboard');
  const d = await api('/api/dashboard');
  const cashTotal = d.cash.reduce((s, c) => s + c.balance, 0), bankTotal = d.banks.reduce((s, c) => s + c.balance, 0);
  $('#view').innerHTML = `<h2>Dashboard</h2>
  <div class="grid">
    <div class="stat"><div class="l">Petty cash in hand</div><div class="v">${money(cashTotal)}</div><div class="s">Imprest limit ${money(d.imprest_limit)} · to replenish ${money(Math.max(0, d.imprest_limit - cashTotal))}</div></div>
    <div class="stat"><div class="l">Bank balance (book)</div><div class="v">${money(bankTotal)}</div><div class="s">${d.banks.map(b => esc(b.name) + ': ' + fmt(b.balance)).join('<br>') || 'No bank accounts'}</div></div>
    <div class="stat"><div class="l">Expenses this month</div><div class="v">${money(d.month_expense)}</div></div>
    <div class="stat"><div class="l">Books closed up to</div><div class="v">${d.locked_through ? '🔒 ' + esc(d.locked_through) : 'Open'}</div><div class="s">${d.locked_through ? 'Editing needs the lock password' : 'No month is closed yet'}</div></div>
    ${d.in_transit && d.in_transit.count ? `<div class="stat" style="cursor:pointer" onclick="go('xfers','transit')"><div class="l">Funds in transit</div><div class="v">${money(d.in_transit.amount)}</div><div class="s">${d.in_transit.count} transfer${d.in_transit.count === 1 ? '' : 's'} not yet received</div></div>` : ''}
    ${d.recurring_due ? `<div class="stat" style="cursor:pointer" onclick="go('recurring')"><div class="l">Recurring vouchers due</div><div class="v">${d.recurring_due}</div><div class="s">Waiting for your approval</div></div>` : ''}
    <div class="stat"><div class="l">Trial balance</div><div class="v"><span class="badge ${d.balanced ? 'ok' : 'bad'}">${d.balanced ? 'Balanced' : 'Difference ' + fmt(d.difference)}</span></div></div>
  </div>
  ${d.backup && (d.backup.warn || d.backup.tip) ? `<div class="ba-warn" style="margin-bottom:12px;cursor:pointer" onclick="go('settings')">${d.backup.warn ? '⚠ <b>Backup:</b> ' + esc(d.backup.warn) : '💾 ' + esc(d.backup.tip)}</div>` : ''}
  <div class="actions" style="margin-bottom:14px">
    <button class="btn" onclick="go('voucher','CP')">+ Petty cash payment</button><button class="btn ghost" onclick="go('voucher','CR')">+ Cash receipt</button>
    <button class="btn ghost" onclick="go('xfer')">⇄ Transfer</button><button class="btn ghost" onclick="go('voucher','BP')">+ Bank payment</button><button class="btn ghost" onclick="go('voucher','BR')">+ Bank deposit</button>
  </div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr))">
    <div class="card"><h3>Top expenses this month</h3><table class="tbl">${d.top_expenses.map(x => `<tr><td>${esc(x.name)}</td><td class="n">${fmt(x.amount)}</td></tr>`).join('') || '<tr><td class="muted">No expenses yet</td></tr>'}</table></div>
    <div class="card"><h3>Recent vouchers</h3><table class="tbl">${d.recent.map(v => `<tr class="click" onclick="showVoucher(${v.id})"><td>${esc(v.voucher_no)}</td><td>${esc(v.vdate)}</td><td>${esc((v.narration || '').slice(0, 30))}</td><td class="n">${fmt(v.amount)}</td></tr>`).join('') || '<tr><td class="muted">No vouchers yet</td></tr>'}</table></div>
  </div>`;
}

// ---------- voucher entry ----------
let V = null;
const blankRow = () => ({ account_id: '', amount: '', debit: '', credit: '' });
const newV = t => ({ id: null, vtype: t || 'CP', vdate: today(), main: '', to: '', rows: t === 'JV' ? [blankRow(), blankRow()] : [blankRow()], narration: '', party: '', ref: '', cheque_no: '' });
async function vVoucher(arg) {
  if (typeof arg === 'object' && arg) V = arg; else V = newV(typeof arg === 'string' ? arg : (V && !V.id ? V.vtype : 'CP'));
  await loadParties();
  renderVoucher();
}
function renderVoucher() {
  const t = V.vtype, jv = t === 'JV', ct = t === 'CT', pay = t === 'CP' || t === 'BP';
  head(VT[t]);
  const kinds = ct ? ['cash', 'bank'] : t[0] === 'C' ? ['cash'] : ['bank'];
  if (!jv && !V.main) { const ml = activeAcc(a => kinds.includes(a.kind)); if (ml.length === 1) V.main = String(ml[0].id); }
  const mainLbl = { CP: 'Paid from (petty cash)', CR: 'Received into (cash)', BP: 'Paid from (bank)', BR: 'Deposited into (bank)', CT: 'Transfer from' }[t];
  const counter = activeAcc(a => jv || a.kind === 'normal');
  const total = jv ? V.rows.reduce((s, r) => s + (+r.debit || 0), 0) : V.rows.reduce((s, r) => s + (+r.amount || 0), 0);
  const totalCr = V.rows.reduce((s, r) => s + (+r.credit || 0), 0);
  $('#view').innerHTML = `<h2>${V.id ? 'Edit' : 'New'} voucher</h2><div class="card">
  ${SET.lock_through && V.vdate <= SET.lock_through ? `<div class="err" style="margin:0 0 10px">🔒 This date is in a closed period (books closed up to ${esc(SET.lock_through)}). Saving will ask for the lock password.</div>` : ''}
  <div class="row">
    <div><label>Type</label><select id="vt" ${V.id ? 'disabled' : ''}>${Object.entries(VT).map(([k, l]) => `<option value="${k}" ${k === t ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div><label>Date</label><input type="date" id="vd" value="${V.vdate}"></div>
    ${jv ? '' : `<div class="grow"><label>${mainLbl}</label><select id="vm">${opts(activeAcc(a => kinds.includes(a.kind)), V.main, 'Select')}</select></div>`}
    ${ct ? `<div class="grow"><label>Transfer to</label><select id="vto">${opts(activeAcc(a => kinds.includes(a.kind)), V.to, 'Select')}</select></div>` : ''}
  </div>
  <div class="wrap"><table class="tbl"><thead><tr><th>${jv ? 'Account' : ct ? 'Amount' : pay ? 'Expense / party account (Dr)' : 'Income / party account (Cr)'}</th>${jv ? '<th class="n">Debit</th><th class="n">Credit</th>' : ct ? '' : '<th class="n">Amount (৳)</th>'}<th></th></tr></thead><tbody>
  ${V.rows.map((r, i) => ct ? `<tr><td><input data-i="${i}" data-f="amount" type="number" step="0.01" min="0" value="${esc(r.amount)}" placeholder="0.00"></td><td></td></tr>`
    : `<tr><td><input class="sbi" data-cb="acct" data-i="${i}" value="${esc(accLabel(r.account_id))}" placeholder="Type to search account…" autocomplete="off"></td>` +
    (jv ? `<td><input data-i="${i}" data-f="debit" type="number" step="0.01" min="0" value="${esc(r.debit)}" style="width:120px"></td><td><input data-i="${i}" data-f="credit" type="number" step="0.01" min="0" value="${esc(r.credit)}" style="width:120px"></td>`
      : `<td><input data-i="${i}" data-f="amount" type="number" step="0.01" min="0" value="${esc(r.amount)}" style="width:130px"></td>`) +
    `<td>${V.rows.length > 1 ? `<button class="btn ghost sm" data-del="${i}">✕</button>` : ''}</td></tr>`).join('')}
  </tbody>${ct ? '' : `<tfoot><tr class="tot"><td>Total</td>${jv ? `<td class="n">${fmt(total)}</td><td class="n">${fmt(totalCr)}</td>` : `<td class="n">${fmt(total)}</td>`}<td></td></tr></tfoot>`}</table></div>
  ${ct ? '' : '<button class="btn ghost sm" id="addRow" style="margin-top:8px">+ Add line</button>'}
  ${jv && Math.round((total - totalCr) * 100) ? `<div class="err">Debit and credit differ by ${fmt(total - totalCr)}</div>` : ''}
  <div class="row" style="margin-top:14px">
    <div class="grow"><label>${pay ? 'Paid to' : t === 'JV' || ct ? 'Party (optional)' : 'Received from'}</label><input id="vp" class="sbi" value="${esc(V.party)}" placeholder="Type to search or add…" autocomplete="off"></div>
    ${t[0] === 'B' || ct ? `<div><label>Cheque / ref no</label><input id="vc" value="${esc(V.cheque_no)}"></div>` : ''}
    <div><label>Bill / memo no</label><input id="vr" value="${esc(V.ref)}"></div>
  </div>
  <div class="row"><div class="grow"><label>Narration</label><textarea id="vn" rows="2">${esc(V.narration)}</textarea></div></div>
  <div class="actions"><button class="btn" id="save">Save voucher</button><button class="btn ghost" id="saveNew">Save & new</button>${V.id ? '<button class="btn ghost" id="cancel">Cancel</button>' : ''}</div></div>`;
  const v = $('#view');
  const sync = () => { V.vdate = $('#vd').value; V.party = $('#vp').value; V.ref = $('#vr').value; V.narration = $('#vn').value; if ($('#vc')) V.cheque_no = $('#vc').value; if ($('#vm')) V.main = $('#vm').value; if ($('#vto')) V.to = $('#vto').value; };
  cbHide();
  const defType = t === 'CR' || t === 'BR' ? 'income' : 'expense', pk = pay ? 'paid' : (t === 'CR' || t === 'BR') ? 'receipt' : '';
  v.querySelectorAll('[data-cb=acct]').forEach(el => {
    const i = +el.dataset.i;
    attachCombo(el, {
      addAlways: true, addLabel: x => x ? `+ Add “${x}” as new account` : '+ Add new account…',
      items: () => counter.map(a => ({ label: `${a.code} · ${a.name}`, name: a.name, id: a.id })),
      current: () => { const a = ACC.find(x => String(x.id) === String(V.rows[i].account_id)); return a ? { label: `${a.code} · ${a.name}` } : null; },
      onPick: it => { V.rows[i].account_id = it ? it.id : ''; if (it) { const nx = v.querySelector(`[data-i="${i}"][data-f="${jv ? 'debit' : 'amount'}"]`); if (nx) nx.focus(); } },
      onAdd: async x => { const a = await quickAddAccount(x, defType); if (a) { sync(); V.rows[i].account_id = a.id; renderVoucher(); } }
    });
  });
  attachCombo($('#vp'), {
    freeText: true, addLabel: x => `+ Add “${x}” as new ${pay ? 'payee' : pk ? 'payer' : 'party'}`,
    items: () => PARTIES.filter(p => partyKindOk(p, pk)).map(p => ({ label: p.name })),
    onPick: it => { V.party = it.label; },
    onAdd: async x => { try { const p = await api('/api/parties', { method: 'POST', body: { name: x, kind: pk || 'both' } }); mergeParty(p); $('#vp').value = p.name; V.party = p.name; toast('Added to party list'); } catch (e) { toast(e.message, true); } }
  });
  v.querySelectorAll('[data-f]').forEach(el => el.onchange = () => { sync(); V.rows[+el.dataset.i][el.dataset.f] = el.value; renderVoucher(); });
  v.querySelectorAll('[data-del]').forEach(el => el.onclick = () => { sync(); V.rows.splice(+el.dataset.del, 1); renderVoucher(); });
  if ($('#addRow')) $('#addRow').onclick = () => { sync(); V.rows.push(blankRow()); renderVoucher(); };
  if ($('#vt')) $('#vt').onchange = e => { sync(); const keep = { ...V }; V = newV(e.target.value); Object.assign(V, { vdate: keep.vdate, party: keep.party, ref: keep.ref, narration: keep.narration }); renderVoucher(); };
  $('#vd').onchange = () => { sync(); renderVoucher(); };
  if ($('#cancel')) $('#cancel').onclick = () => go('vouchers');
  $('#save').onclick = () => saveV(false); $('#saveNew').onclick = () => saveV(true);
  async function saveV(again) {
    sync();
    const L = [], amt = r => Math.round((+r.amount || 0) * 100) / 100;
    try {
      if (jv) V.rows.forEach(r => { const d = +r.debit || 0, c = +r.credit || 0; if (r.account_id && (d || c)) L.push({ account_id: +r.account_id, debit: d, credit: c }); });
      else if (ct) {
        const a = amt(V.rows[0]); if (!V.main || !V.to || !(a > 0)) throw new Error('Choose both accounts and enter an amount');
        if (V.main === V.to) throw new Error('From and to accounts must be different');
        L.push({ account_id: +V.to, debit: a, credit: 0 }, { account_id: +V.main, debit: 0, credit: a });
      } else {
        if (!V.main) throw new Error('Choose the ' + (t[0] === 'C' ? 'cash' : 'bank') + ' account');
        let tot = 0; V.rows.forEach(r => { const a = amt(r); if (r.account_id && a > 0) { L.push({ account_id: +r.account_id, debit: pay ? a : 0, credit: pay ? 0 : a }); tot += a; } });
        if (!L.length) throw new Error('Add at least one line with an account and amount');
        L.push({ account_id: +V.main, debit: pay ? 0 : tot, credit: pay ? tot : 0 });
      }
      const body = { vtype: t, vdate: V.vdate, narration: V.narration, party: V.party, ref: V.ref, cheque_no: V.cheque_no, lines: L };
      const r = await lockApi(V.id ? '/api/vouchers/' + V.id : '/api/vouchers', { method: V.id ? 'PUT' : 'POST', body });
      toast('Voucher saved'); if (again) { V = newV(t); renderVoucher(); } else showVoucher(r.id);
    } catch (e) { toast(e.message, true); }
  }
}

// ---------- vouchers list / view ----------
let VF = { from: '', to: '', type: '', q: '' };
async function vVouchers() {
  head('Vouchers');
  $('#view').innerHTML = `<h2>All vouchers</h2><div class="card"><div class="row noprint">
    <div><label>From</label><input type="date" id="f1" value="${VF.from}"></div><div><label>To</label><input type="date" id="f2" value="${VF.to}"></div>
    <div><label>Type</label><select id="f3"><option value="">All</option>${Object.entries(VT).map(([k, l]) => `<option value="${k}" ${VF.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
    <div class="grow"><label>Search</label><input id="f4" value="${esc(VF.q)}" placeholder="Narration, party, cheque, no."></div>
    <button class="btn" id="fgo">Show</button><button class="btn ghost" id="fpr">🖨 Print preview</button></div><div id="vl"></div></div>`;
  const run = async () => {
    VF = { from: $('#f1').value, to: $('#f2').value, type: $('#f3').value, q: $('#f4').value };
    const p = new URLSearchParams(VF), rows = await api('/api/vouchers?' + p);
    $('#vl').innerHTML = `<div class="wrap"><table class="tbl"><thead><tr><th>Date</th><th>No.</th><th>Type</th><th>Party</th><th>Narration</th><th class="n">Amount</th></tr></thead><tbody>${rows.map(v => `<tr class="click" onclick="showVoucher(${v.id})"><td>${esc(v.vdate)}</td><td>${esc(v.voucher_no)}</td><td>${VT[v.vtype]}</td><td>${esc(v.party)}</td><td>${esc(v.narration)}</td><td class="n">${fmt(v.amount)}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">No vouchers found</td></tr>'}</tbody></table></div>`;
  };
  $('#fpr').onclick = () => pvFromEl('#vl', 'VOUCHER LIST', [VF.from && 'From ' + fdate(VF.from), VF.to && 'To ' + fdate(VF.to), VF.type && VT[VF.type], VF.q && '“' + VF.q + '”'].filter(Boolean).join(' · ') || 'All vouchers');
  $('#fgo').onclick = run; $('#f4').onkeydown = e => { if (e.key === 'Enter') run(); }; run();
}
async function showVoucher(id) {
  const v = await api('/api/vouchers/' + id);
  modal(`<h3>${esc(v.voucher_no)} · ${VT[v.vtype]}</h3><div class="muted">${esc(v.vdate)}${v.party ? ' · ' + esc(v.party) : ''}${v.cheque_no ? ' · Cheque ' + esc(v.cheque_no) : ''}${v.ref ? ' · Ref ' + esc(v.ref) : ''}</div>
  <p>${esc(v.narration)}</p><div class="wrap"><table class="tbl"><thead><tr><th>Account</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>
  ${v.lines.map(l => `<tr><td>${esc(l.code)} · ${esc(l.name)}</td><td class="n">${l.debit ? fmt(l.debit) : ''}</td><td class="n">${l.credit ? fmt(l.credit) : ''}</td></tr>`).join('')}</tbody></table></div>
  <div class="actions noprint" style="margin-top:12px">${v.transfer_no ? `<button class="btn" onclick="openTransferByNo('${esc(v.transfer_no)}')">Open transfer ${esc(v.transfer_no)}</button>` : `<button class="btn" onclick='editVoucher(${id})'>Edit</button>`}<button class="btn ghost" onclick="pvVoucher(${id})">🖨 Print preview</button>${v.vtype === 'BP' && !v.transfer_no ? `<button class="btn ghost" onclick="cqFromVoucher(${id})">Print cheque</button>` : ''}${v.transfer_no ? '' : `<button class="btn red" onclick="delVoucher(${id})">Delete</button>`}<button class="btn ghost" onclick="closeModal()">Close</button></div>`);
  head(v.voucher_no + ' · ' + VT[v.vtype]);
}
async function openTransferByNo(no) {
  try { const { rows } = await api('/api/transfers?q=' + encodeURIComponent(no)); const r = rows.find(x => x.transfer_no === no && !x.legacy); closeModal(); if (r) window.showTransfer(r.id); } catch (e) { toast(e.message, true); }
}
async function editVoucher(id) {
  const v = await api('/api/vouchers/' + id); closeModal();
  const t = v.vtype, pay = t === 'CP' || t === 'BP';
  const o = { id: v.id, vtype: t, vdate: v.vdate, narration: v.narration || '', party: v.party || '', ref: v.ref || '', cheque_no: v.cheque_no || '', main: '', to: '', rows: [] };
  if (t === 'JV') o.rows = v.lines.map(l => ({ account_id: l.account_id, debit: l.debit || '', credit: l.credit || '' }));
  else if (t === 'CT') { const c = v.lines.find(l => l.credit > 0), d = v.lines.find(l => l.debit > 0); o.main = c.account_id; o.to = d.account_id; o.rows = [{ amount: d.debit }]; }
  else { const m = v.lines[v.lines.length - 1]; o.main = m.account_id; o.rows = v.lines.slice(0, -1).map(l => ({ account_id: l.account_id, amount: pay ? l.debit : l.credit })); }
  go('voucher', o);
}
async function delVoucher(id) {
  if (!confirm('Delete this voucher permanently?')) return;
  try { await lockApi('/api/vouchers/' + id, { method: 'DELETE' }); closeModal(); toast('Voucher deleted'); go(location.hash.slice(1) || 'vouchers'); }
  catch (e) { toast(e.message, true); }
}

// ---------- books: petty cash, bank, general ledger ----------
const BK = {};
async function vBook(mode) {
  const list = activeAcc(a => mode === 'any' || a.kind === mode);
  const title = { cash: 'Petty Cash Book', bank: 'Bank Book', any: 'Ledger' }[mode];
  const st = BK[mode] = Object.assign({ acc: list[0] ? list[0].id : '', from: monthStart(), to: today() }, BK[mode]);
  head(title);
  $('#view').innerHTML = `<h2>${title}</h2><div class="card"><div class="row noprint">
    <div class="grow"><label>Account</label><select id="ba">${opts(list, st.acc, 'Select')}</select></div>
    <div><label>From</label><input type="date" id="b1" value="${st.from}"></div><div><label>To</label><input type="date" id="b2" value="${st.to}"></div>
    <button class="btn" id="bgo">Show</button>${mode !== 'any' ? `<button class="btn ghost" onclick="go('voucher','${mode === 'cash' ? 'CP' : 'BP'}')">+ ${mode === 'cash' ? 'Payment' : 'Bank payment'}</button>` : ''}${mode !== 'any' ? '<button class="btn ghost" id="bimp">⬆ Import Excel / CSV</button>' : ''}</div><div id="bk"></div></div>`;
  const run = async () => {
    st.acc = $('#ba').value; st.from = $('#b1').value; st.to = $('#b2').value;
    if (!st.acc) { $('#bk').innerHTML = '<p class="muted">Select an account.</p>'; return; }
    const b = await api(`/api/book/${st.acc}?from=${st.from}&to=${st.to}`), bank = b.account.kind === 'bank', cash = b.account.kind === 'cash';
    head(`${title}: ${b.account.name}`, `${st.from} to ${st.to}`);
    const lim = +SET.imprest_limit || 0;
    $('#bk').innerHTML = `<div class="grid">
      <div class="stat"><div class="l">Opening</div><div class="v">${drcr(b.opening)}</div></div>
      <div class="stat"><div class="l">${mode === 'any' ? 'Debit' : 'Receipts'}</div><div class="v">${fmt(b.total_debit)}</div></div>
      <div class="stat"><div class="l">${mode === 'any' ? 'Credit' : 'Payments'}</div><div class="v">${fmt(b.total_credit)}</div></div>
      <div class="stat"><div class="l">Closing</div><div class="v">${drcr(b.closing)}</div>${cash ? `<div class="s">Imprest ${money(lim)} · replenish ${money(Math.max(0, lim - b.closing))}</div>` : ''}</div>
      ${bank ? `<div class="stat"><div class="l">Bank statement balance (cleared)</div><div class="v">${drcr(b.cleared_balance)}</div><div class="s">Uncleared: ${fmt(b.closing - b.cleared_balance)}</div></div>` : ''}</div>
    <div class="actions noprint" style="margin-bottom:10px"><button class="btn ghost sm" id="bcsv">Export CSV</button><button class="btn ghost sm" id="bpr">🖨 Print preview</button></div>
    <div class="wrap"><table class="tbl"><thead><tr><th>Date</th><th>Voucher</th><th>Particulars</th><th>Narration</th>${bank ? '<th>Cheque</th>' : ''}<th class="n">${mode === 'any' ? 'Debit' : 'Receipts'}</th><th class="n">${mode === 'any' ? 'Credit' : 'Payments'}</th><th class="n">Balance</th>${bank ? '<th class="noprint">Cleared on</th>' : ''}</tr></thead><tbody>
    <tr class="grp"><td colspan="${bank ? 7 : 6}">Opening balance</td><td class="n">${drcr(b.opening)}</td>${bank ? '<td class="noprint"></td>' : ''}</tr>
    ${b.rows.map(r => `<tr><td>${esc(r.vdate)}</td><td><a href="#" onclick="showVoucher(${r.voucher_id});return false">${esc(r.voucher_no)}</a></td><td>${esc(r.counter)}</td><td>${esc(r.narration || r.party)}</td>${bank ? `<td>${esc(r.cheque_no)}</td>` : ''}<td class="n">${r.debit ? fmt(r.debit) : ''}</td><td class="n">${r.credit ? fmt(r.credit) : ''}</td><td class="n">${drcr(r.balance)}</td>${bank ? `<td class="noprint"><input type="date" data-line="${r.line_id}" value="${r.cleared_on || ''}"></td>` : ''}</tr>`).join('')}
    <tr class="tot"><td colspan="${bank ? 5 : 4}">Total / Closing</td><td class="n">${fmt(b.total_debit)}</td><td class="n">${fmt(b.total_credit)}</td><td class="n">${drcr(b.closing)}</td>${bank ? '<td class="noprint"></td>' : ''}</tr></tbody></table></div>`;
    $('#bpr').onclick = () => pvFromEl('#bk', title.toUpperCase(), `${b.account.code} · ${b.account.name}  |  ${fdate(st.from)} to ${fdate(st.to)}`);
    $('#bcsv').onclick = () => csv(`${b.account.name}-${st.from}-${st.to}.csv`, [['Date', 'Voucher', 'Particulars', 'Narration', 'Cheque', 'Debit', 'Credit', 'Balance'], ['', '', 'Opening', '', '', '', '', b.opening], ...b.rows.map(r => [r.vdate, r.voucher_no, r.counter, r.narration, r.cheque_no, r.debit, r.credit, r.balance])]);
    document.querySelectorAll('[data-line]').forEach(el => el.onchange = async () => { try { await api(`/api/lines/${el.dataset.line}/clear`, { method: 'POST', body: { cleared_on: el.value || null } }); run(); } catch (e) { toast(e.message, true); } });
  };
  $('#bgo').onclick = run; $('#ba').onchange = run; if ($('#bimp')) $('#bimp').onclick = () => importWizard($('#ba').value, run); run();
}

// ---------- trial balance ----------
let TB = { from: '', to: '', all: false };
async function vTB() {
  TB = Object.assign({ from: fyStart(), to: today(), all: false }, TB.from ? TB : {});
  $('#view').innerHTML = `<h2>Trial Balance</h2><div class="card"><div class="row noprint">
    <div><label>From</label><input type="date" id="t1" value="${TB.from}"></div><div><label>To</label><input type="date" id="t2" value="${TB.to}"></div>
    <div><label>&nbsp;</label><label><input type="checkbox" id="t3" ${TB.all ? 'checked' : ''}> Show zero accounts</label></div>
    <button class="btn" id="tgo">Generate</button></div><div id="tb"></div></div>`;
  const run = async () => {
    TB = { from: $('#t1').value, to: $('#t2').value, all: $('#t3').checked };
    const d = await api(`/api/trial-balance?from=${TB.from}&to=${TB.to}&all=${TB.all ? 1 : 0}`), t = d.totals;
    head('Trial Balance', `${d.from} to ${d.to}`);
    const groups = [['asset', 'Assets'], ['liability', 'Liabilities'], ['equity', 'Equity'], ['income', 'Income'], ['expense', 'Expenses']];
    const z = n => n ? fmt(n) : '';
    $('#tb').innerHTML = `<p><span class="badge ${d.balanced ? 'ok' : 'bad'}">${d.balanced ? 'Trial balance is balanced' : 'Out of balance by ' + fmt(d.difference)}</span> <span class="muted">Built automatically from all vouchers and opening balances.</span></p>
    <div class="actions noprint" style="margin-bottom:10px"><button class="btn ghost sm" id="tcsv">Export CSV</button><button class="btn ghost sm" id="tpr">🖨 Print preview</button></div>
    <div class="wrap"><table class="tbl"><thead><tr><th>Code</th><th>Account</th><th class="n">Opening Dr</th><th class="n">Opening Cr</th><th class="n">Period Dr</th><th class="n">Period Cr</th><th class="n">Closing Dr</th><th class="n">Closing Cr</th></tr></thead><tbody>
    ${groups.map(([k, l]) => { const rs = d.rows.filter(r => r.type === k); return rs.length ? `<tr class="grp"><td colspan="8">${l}</td></tr>` + rs.map(r => `<tr class="click" onclick="openLedger(${r.id})"><td>${esc(r.code)}</td><td>${esc(r.name)}</td><td class="n">${z(r.open_dr)}</td><td class="n">${z(r.open_cr)}</td><td class="n">${z(r.dr)}</td><td class="n">${z(r.cr)}</td><td class="n">${z(r.close_dr)}</td><td class="n">${z(r.close_cr)}</td></tr>`).join('') : ''; }).join('')}
    <tr class="tot"><td colspan="2">Total</td><td class="n">${fmt(t.open_dr)}</td><td class="n">${fmt(t.open_cr)}</td><td class="n">${fmt(t.dr)}</td><td class="n">${fmt(t.cr)}</td><td class="n">${fmt(t.close_dr)}</td><td class="n">${fmt(t.close_cr)}</td></tr></tbody></table></div>`;
    $('#tpr').onclick = () => pvFromEl('#tb', 'TRIAL BALANCE', `${fdate(d.from)} to ${fdate(d.to)}`);
    $('#tcsv').onclick = () => csv(`trial-balance-${d.from}-${d.to}.csv`, [['Code', 'Account', 'Type', 'Opening Dr', 'Opening Cr', 'Period Dr', 'Period Cr', 'Closing Dr', 'Closing Cr'], ...d.rows.map(r => [r.code, r.name, r.type, r.open_dr, r.open_cr, r.dr, r.cr, r.close_dr, r.close_cr]), ['', 'Total', '', t.open_dr, t.open_cr, t.dr, t.cr, t.close_dr, t.close_cr]]);
  };
  $('#tgo').onclick = run; run();
}
function openLedger(id) { BK.any = { acc: id, from: TB.from, to: TB.to }; go('ledger'); }

// ---------- certificate & payslip (see payroll.js) ----------
function vPayroll() { head('Certificate & Payslip'); return window.hrOpen(); }

// ---------- chart of accounts ----------
async function vCOA() {
  head('Chart of Accounts');
  $('#view').innerHTML = `<h2>Chart of Accounts</h2><div class="card"><div class="actions" style="margin-bottom:10px"><button class="btn" onclick="editAcc()">+ New account</button><button class="btn ghost" onclick="editAcc(null,'bank')">+ New bank account</button><button class="btn ghost" onclick="pvFromEl('#view .card','CHART OF ACCOUNTS','')">🖨 Print preview</button></div>
  <p class="muted">Opening balances must balance overall (total Dr = total Cr), otherwise the trial balance will show a difference.</p>
  <div class="wrap"><table class="tbl"><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Kind</th><th class="n">Opening</th><th></th></tr></thead><tbody>
  ${ACC.map(a => `<tr class="click" onclick="editAcc(${a.id})" style="${a.active ? '' : 'opacity:.5'}"><td>${esc(a.code)}</td><td>${esc(a.name)}${a.kind === 'bank' ? `<div class="muted">${esc(a.bank_name)} ${esc(a.account_no)}</div>` : ''}</td><td>${a.type}</td><td>${a.kind === 'normal' ? '' : '<span class="badge">' + a.kind + '</span>'}</td><td class="n">${a.opening_balance ? fmt(a.opening_balance) + ' ' + a.opening_side : ''}</td><td>${a.active ? '' : 'inactive'}</td></tr>`).join('')}</tbody></table></div></div>`;
}
function editAcc(id, kind) {
  const a = id ? ACC.find(x => x.id === id) : { code: '', name: '', type: 'asset', kind: kind || 'normal', bank_name: '', account_no: '', opening_balance: 0, opening_side: 'Dr', active: 1 };
  modal(`<h3>${id ? 'Edit' : 'New'} account</h3><div class="row"><div><label>Code</label><input id="ac" value="${esc(a.code)}" style="width:100px"></div><div class="grow"><label>Name</label><input id="an" value="${esc(a.name)}"></div></div>
  <div class="row"><div><label>Type</label><select id="at">${['asset', 'liability', 'equity', 'income', 'expense'].map(t => `<option ${a.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
  <div><label>Kind</label><select id="ak"><option value="normal" ${a.kind === 'normal' ? 'selected' : ''}>Normal</option><option value="cash" ${a.kind === 'cash' ? 'selected' : ''}>Petty cash / cash</option><option value="bank" ${a.kind === 'bank' ? 'selected' : ''}>Bank account</option></select></div></div>
  <div class="row"><div class="grow"><label>Bank name</label><input id="ab" value="${esc(a.bank_name)}"></div><div class="grow"><label>Account no.</label><input id="aa" value="${esc(a.account_no)}"></div></div>
  <div class="row"><div><label>Opening balance</label><input id="ao" type="number" step="0.01" min="0" value="${a.opening_balance}"></div><div><label>Side</label><select id="as"><option ${a.opening_side === 'Dr' ? 'selected' : ''}>Dr</option><option ${a.opening_side === 'Cr' ? 'selected' : ''}>Cr</option></select></div>
  <div><label>Status</label><select id="av"><option value="1" ${a.active ? 'selected' : ''}>Active</option><option value="0" ${a.active ? '' : 'selected'}>Inactive</option></select></div></div>
  <div class="actions"><button class="btn" id="asave">Save</button>${id ? '<button class="btn red" id="adel">Delete</button>' : ''}<button class="btn ghost" onclick="closeModal()">Cancel</button></div><div class="err" id="aerr"></div>`);
  $('#asave').onclick = async () => {
    const body = { code: $('#ac').value, name: $('#an').value, type: $('#at').value, kind: $('#ak').value, bank_name: $('#ab').value, account_no: $('#aa').value, opening_balance: $('#ao').value, opening_side: $('#as').value, active: +$('#av').value };
    try { await lockApi(id ? '/api/accounts/' + id : '/api/accounts', { method: id ? 'PUT' : 'POST', body }); closeModal(); toast('Saved'); vCOA(); await loadAcc(); } catch (e) { $('#aerr') ? $('#aerr').textContent = e.message : toast(e.message, true); }
  };
  if (id) $('#adel').onclick = async () => { if (!confirm('Delete this account?')) return; try { await lockApi('/api/accounts/' + id, { method: 'DELETE' }); closeModal(); toast('Deleted'); vCOA(); } catch (e) { $('#aerr') ? $('#aerr').textContent = e.message : toast(e.message, true); } };
}

// ---------- settings & backup ----------
async function vSettings() {
  head('Settings');
  SET = await api('/api/settings'); const st = await api('/api/auth/status'); const lk = await api('/api/lock'); PCO = null; const co = await getCompany();
  $('#view').innerHTML = `<h2>Settings & Backup</h2>
  <div class="card"><h3>Company</h3><div class="row"><div class="grow"><label>Company name</label><input id="s1" value="${esc(SET.company_name)}"></div>
  <div><label>Petty cash imprest limit (৳)</label><input id="s2" type="number" min="0" value="${esc(SET.imprest_limit)}"></div>
  <div><label>Fiscal year starts (MM-DD)</label><input id="s3" value="${esc(SET.fiscal_start)}" style="width:100px"></div><button class="btn" id="ssave">Save</button></div></div>
  <div class="card"><h3>Password lock</h3><div class="row"><div><label>${st.hasPassword ? 'Current password' : '&nbsp;'}</label><input id="p0" type="password" ${st.hasPassword ? '' : 'disabled placeholder="not set"'}></div>
  <div><label>New password</label><input id="p1" type="password"></div><button class="btn" id="pset">${st.hasPassword ? 'Change' : 'Set'} password</button>${st.hasPassword ? '<button class="btn ghost" id="prem">Remove</button><button class="btn ghost" id="plog">Lock now</button>' : ''}</div></div>
  <div class="card"><h3>🔒 Month-end lock</h3>
  <p>${lk.through ? `Books are closed up to <b>${esc(lk.through)}</b>.` : 'No month is closed yet.'} Vouchers dated on or before the closed date cannot be added, edited or deleted without the lock password. Payroll certificates and payslips are not affected, so old months can always be printed.</p>
  <div class="row"><div><label>Close books up to the end of</label><input type="month" id="lkm" value="${lk.through ? lk.through.slice(0, 7) : today().slice(0, 7)}"></div>
  <button class="btn" id="lkset">Close month</button>${lk.through ? '<button class="btn ghost" id="lkoff">Reopen all months</button>' : ''}</div>
  <div class="row"><div><label>${lk.has_password ? 'Current lock password' : '&nbsp;'}</label><input id="lk0" type="password" ${lk.has_password ? '' : 'disabled placeholder="not set"'}></div>
  <div><label>${lk.has_password ? 'New lock password' : 'Set a lock password'}</label><input id="lk1" type="password"></div><button class="btn ghost" id="lkpwb">${lk.has_password ? 'Change' : 'Set'} lock password</button></div>
  <div class="muted">The lock password is separate from the login password. Keep it with the person who closes the books.</div></div>
  <div class="card"><h3>🖨 Printing & letterhead</h3>
  <p class="muted" style="margin-top:0">Default margins for every printout (25.4 mm = 1 inch top and bottom). Keep room at the top and bottom when you print on your company's pre-printed paper. Every print has a preview first, where you can also change the margins for that print (T / B / L / R) and save them per kind of document.</p>
  <div class="row"><div><label>Top margin (mm)</label><input type="number" step="1" min="0" max="76" id="prt" value="${r1(numOr(SET.print_top_in, 1) * MM_IN)}" style="width:100px"></div><div><label>Bottom margin (mm)</label><input type="number" step="1" min="0" max="76" id="prb" value="${r1(numOr(SET.print_bottom_in, 1) * MM_IN)}" style="width:100px"></div><div><label>Left (mm)</label><input type="number" step="1" min="0" max="60" id="prl" value="${numOr(SET.print_left_mm, 12)}" style="width:90px"></div><div><label>Right (mm)</label><input type="number" step="1" min="0" max="60" id="prr" value="${numOr(SET.print_right_mm, 12)}" style="width:90px"></div>
  <div class="grow"><label>Company address (printed under the name)</label><input id="pra" value="${esc(co.address)}"></div><div><label>Phone</label><input id="prp" value="${esc(co.phone)}" style="width:170px"></div></div>
  <div class="row"><label><input type="checkbox" id="prh" ${SET.print_header === '0' ? '' : 'checked'}> Print company name &amp; address at the top <span class="muted">(untick if your paper already has it)</span></label></div>
  <div class="row"><label><input type="checkbox" id="prf" ${SET.print_footer === '0' ? '' : 'checked'}> Print the “computer-generated” footer line</label></div>
  <div class="row"><label><input type="checkbox" id="prs" ${SET.print_sign_reports === '0' ? '' : 'checked'}> Print signature lines (Prepared by / Checked by / Authorized) at the bottom of reports and lists</label></div>
  <div class="actions"><button class="btn" id="prsave">Save printing settings</button><button class="btn ghost" id="prtest">Preview sample page</button></div></div>
  <div class="card"><h3>Backup & restore</h3><p class="muted">A backup is also saved automatically every day in the <b>backups</b> folder (last 14 kept).</p>
  <div class="actions"><a class="btn" href="/api/backup">Download backup</a><label class="btn ghost" style="cursor:pointer">Restore from file<input type="file" id="rfile" accept=".json" class="hidden"></label></div></div><div id="bkpanel"></div>`;
  if (window.backupPanel) window.backupPanel();
  $('#lkset').onclick = async () => {
    const v = $('#lkm').value; if (!v) return toast('Choose a month', true);
    const [y, m] = v.split('-'), through = `${y}-${m}-${String(new Date(+y, +m, 0).getDate()).padStart(2, '0')}`;
    try { await lockApi('/api/lock', { method: 'POST', body: { through } }); toast('Books closed up to ' + through); vSettings(); } catch (e) { toast(e.message, true); }
  };
  if ($('#lkoff')) $('#lkoff').onclick = async () => { try { await lockApi('/api/lock', { method: 'POST', body: { through: '' } }); toast('All months reopened'); vSettings(); } catch (e) { toast(e.message, true); } };
  $('#lkpwb').onclick = async () => { try { await api('/api/lock/password', { method: 'POST', body: { current: $('#lk0').value, password: $('#lk1').value } }); LOCKPW = ''; toast('Lock password saved'); vSettings(); } catch (e) { toast(e.message, true); } };
  $('#prsave').onclick = async () => {
    try {
      await api('/api/settings', { method: 'PUT', body: { print_top_in: r1(numOr($('#prt').value, 25.4) / MM_IN * 1000) / 1000, print_bottom_in: r1(numOr($('#prb').value, 25.4) / MM_IN * 1000) / 1000, print_left_mm: numOr($('#prl').value, 12), print_right_mm: numOr($('#prr').value, 12), print_header: $('#prh').checked ? 1 : 0, print_footer: $('#prf').checked ? 1 : 0, print_sign_reports: $('#prs').checked ? 1 : 0 } });
      await api('/api/hr/t/company/1', { method: 'PUT', body: { address: $('#pra').value, phone: $('#prp').value } });
      SET = await api('/api/settings'); PCO = null; toast('Printing settings saved');
    } catch (e) { toast(e.message, true); }
  };
  $('#prtest').onclick = async () => {
    SET.print_top_in = numOr($('#prt').value, 25.4) / MM_IN; SET.print_bottom_in = numOr($('#prb').value, 25.4) / MM_IN; SET.print_left_mm = numOr($('#prl').value, 12); SET.print_right_mm = numOr($('#prr').value, 12); SET.print_header = $('#prh').checked ? '1' : '0'; SET.print_footer = $('#prf').checked ? '1' : '0'; SET.print_sign_reports = $('#prs').checked ? '1' : '0';
    const c = { ...(await getCompany()), address: $('#pra').value, phone: $('#prp').value };
    pvOpen({ onClose: async () => { SET = await api('/api/settings'); }, docs: [pdocSync(c, 'SAMPLE PAGE', 'Letterhead check', '<div class="pd-band"><span>Top and bottom gaps are shown as dashed lines in this preview</span></div><div class="pd-text">Place your company paper in the printer and print this page to confirm the gaps before using it for payslips and certificates.</div>')] });
  };
  $('#ssave').onclick = async () => { try { await api('/api/settings', { method: 'PUT', body: { company_name: $('#s1').value, imprest_limit: $('#s2').value, fiscal_start: $('#s3').value } }); SET = await api('/api/settings'); $('#brandName').textContent = SET.company_name; toast('Saved'); } catch (e) { toast(e.message, true); } };
  $('#pset').onclick = async () => { try { await api('/api/auth/set', { method: 'POST', body: { current: $('#p0').value, password: $('#p1').value } }); toast('Password saved'); vSettings(); } catch (e) { toast(e.message, true); } };
  if ($('#prem')) $('#prem').onclick = async () => { try { await api('/api/auth/remove', { method: 'POST', body: { current: $('#p0').value } }); toast('Password removed'); vSettings(); } catch (e) { toast(e.message, true); } };
  if ($('#plog')) $('#plog').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); location.reload(); };
  $('#rfile').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (!confirm('Restoring REPLACES all current accounts and vouchers with the backup. Continue?')) return;
    try { const r = await lockApi('/api/restore', { method: 'POST', body: JSON.parse(await f.text()) }); toast('Restored ' + r.vouchers + ' vouchers'); SET = await api('/api/settings'); go('dashboard'); } catch (x) { toast(x.message, true); }
  };
}

// ---------- start ----------
function showLogin() { $('#app').classList.add('hidden'); $('#login').classList.remove('hidden'); $('#lpw').focus(); }
async function login() {
  try { await api('/api/auth/login', { method: 'POST', body: { password: $('#lpw').value } }); $('#lpw').value = ''; $('#lerr').textContent = ''; $('#login').classList.add('hidden'); boot(); }
  catch (e) { $('#lerr').textContent = e.message; }
}
async function boot() {
  const st = await fetch('/api/auth/status').then(r => r.json());
  if (!st.loggedIn) return showLogin();
  SET = await api('/api/settings'); $('#brandName').textContent = SET.company_name; document.title = SET.company_name;
  $('#login').classList.add('hidden'); $('#app').classList.remove('hidden'); buildNav(); initTheme();
  const v = location.hash.slice(1); go(VIEWS[v] ? v : 'dashboard');
}
$('#lbtn').onclick = login; $('#lpw').onkeydown = e => { if (e.key === 'Enter') login(); };
$('#menuBtn').onclick = () => $('#side').classList.toggle('open');
boot();
