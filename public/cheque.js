/* Cheque Printing (Bangladesh bank cheques): register, cheque books, layout editor, printing */
(function () {
  const $ = s => document.querySelector(s);
  const MM = 3.7795; // css px per mm
  const localISO = d => new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);

  // Starting layout for a standard Bangladesh cheque leaf (8" x 3.5"). Every bank leaf differs a little,
  // so each bank account gets its own saved layout that you calibrate once with a test print.
  const DEF = {
    w: 203.2, h: 88.9, paper: 'a4', a4x: 4, a4y: 10, ox: 0, oy: 0,
    font: "Arial, Helvetica, 'Noto Sans Bengali', 'Nirmala UI', sans-serif", bg: '',
    date: { x: 139, y: 13, size: 11, pitch: 6.3 },
    payee: { x: 24, y: 31, size: 12, w: 140, upper: 0 },
    words1: { x: 30, y: 41, size: 11, w: 120 }, words2: { x: 12, y: 49, size: 11, w: 150 },
    words: { prefix: 'Taka', suffix: 'only', upper: 0 },
    fig: { x: 150, y: 57, size: 13, w: 44, prefix: '', suffix: '/-' },
    cross: { x: 12, y: 5, w: 40, h: 10, size: 8, angle: -14 },
    bearer: { x: 168, y: 34, w: 24 }
  };
  const mergeL = l => {
    const o = JSON.parse(JSON.stringify(DEF));
    for (const k in (l || {})) { if (l[k] && typeof l[k] === 'object' && o[k]) Object.assign(o[k], l[k]); else o[k] = l[k]; }
    return o;
  };

  // ---------- amount in words (Taka, lakh / crore) ----------
  const ONES = 'One Two Three Four Five Six Seven Eight Nine Ten Eleven Twelve Thirteen Fourteen Fifteen Sixteen Seventeen Eighteen Nineteen'.split(' ');
  const TENS = '_ _ Twenty Thirty Forty Fifty Sixty Seventy Eighty Ninety'.split(' ');
  const w2 = n => n < 20 ? (ONES[n - 1] || '') : TENS[Math.floor(n / 10)] + (n % 10 ? ' ' + ONES[n % 10 - 1] : '');
  function wordsInt(n) {
    if (n <= 0) return 'Zero';
    const o = [];
    for (const [d, l] of [[1e7, 'Crore'], [1e5, 'Lakh'], [1e3, 'Thousand'], [100, 'Hundred']]) {
      if (n >= d) { const q = Math.floor(n / d); o.push((q >= 100 ? wordsInt(q) : w2(q)) + ' ' + l); n %= d; }
    }
    if (n) o.push(w2(n));
    return o.join(' ');
  }
  function amtWords(a, L) {
    a = Math.round(Number(a || 0) * 100) / 100;
    const t = Math.floor(a + 1e-9), p = Math.round((a - t) * 100), parts = [];
    if (t > 0) parts.push(wordsInt(t));
    if (p > 0) parts.push((t > 0 ? 'and ' : '') + wordsInt(p) + ' Paisa');
    if (!parts.length) parts.push('Zero');
    let s = [L.words.prefix, parts.join(' '), L.words.suffix].filter(Boolean).join(' ');
    if (L.words.upper) s = s.toUpperCase();
    return s;
  }
  let ctx;
  function textW(txt, size, font) {
    try { if (!ctx) ctx = document.createElement('canvas').getContext('2d'); } catch (e) { ctx = null; }
    if (ctx && ctx.measureText) { ctx.font = `${size * 1.3333}px ${font}`; return ctx.measureText(txt).width / MM; }
    return txt.length * size * 0.2;
  }
  function splitWords(txt, w1, size, font) {
    const ws = txt.split(' '); let l1 = '', i = 0;
    for (; i < ws.length; i++) { const t = l1 ? l1 + ' ' + ws[i] : ws[i]; if (l1 && textW(t, size, font) > w1) break; l1 = t; }
    return [l1, ws.slice(i).join(' ')];
  }
  const figText = (a, L) => {
    a = Math.round(Number(a || 0) * 100) / 100;
    return (L.fig.prefix || '') + a.toLocaleString('en-IN', { minimumFractionDigits: a % 1 ? 2 : 0, maximumFractionDigits: 2 }) + (L.fig.suffix || '');
  };

  // ---------- cheque artwork (all positions in mm from the top-left corner of the leaf) ----------
  function chqHtml(ch, L, o = {}) {
    const ox = L.ox || 0, oy = L.oy || 0, ink = 'color:#000;line-height:1.15;';
    const box = (k, f, style, inner) => `<div class="cq-f" data-k="${k}" style="position:absolute;left:${f.x + ox}mm;top:${f.y + oy}mm;white-space:nowrap;${ink}${style}">${inner}</div>`;
    const ds = String(ch.cdate || '').slice(0, 10), dd = ds.length === 10 ? ds.slice(8, 10) + ds.slice(5, 7) + ds.slice(0, 4) : '';
    let h = '';
    if (o.preview && L.bg) h += `<img src="${L.bg}" alt="" style="position:absolute;left:0;top:0;width:${L.w}mm;height:${L.h}mm;opacity:.5;pointer-events:none">`;
    h += box('date', L.date, `font-size:${L.date.size}pt;display:flex;`, [...dd].map(c => `<span style="display:inline-block;width:${L.date.pitch}mm;text-align:center">${c}</span>`).join(''));
    const payee = L.payee.upper ? String(ch.payee || '').toUpperCase() : String(ch.payee || '');
    h += box('payee', L.payee, `font-size:${L.payee.size}pt;width:${L.payee.w}mm;overflow:hidden;`, esc(payee));
    const [l1, l2] = splitWords(amtWords(ch.amount, L), L.words1.w, L.words1.size, L.font);
    h += box('words1', L.words1, `font-size:${L.words1.size}pt;`, esc(l1));
    if (l2) h += box('words2', L.words2, `font-size:${L.words2.size}pt;`, esc(l2));
    h += box('fig', L.fig, `font-size:${L.fig.size}pt;font-weight:bold;width:${L.fig.w}mm;`, esc(figText(ch.amount, L)));
    if (ch.crossing && ch.crossing !== 'none') {
      h += box('cross', L.cross, `width:${L.cross.w}mm;height:${L.cross.h}mm;transform:rotate(${L.cross.angle}deg);transform-origin:center;display:flex;align-items:center;justify-content:center;box-sizing:border-box;border-top:.35mm solid #000;border-bottom:.35mm solid #000;font-size:${L.cross.size}pt;font-weight:bold;letter-spacing:.25mm;`, ch.crossing === 'ac_payee' ? 'A/C PAYEE ONLY' : '');
    }
    if (ch.bearer_cut) h += box('bearer', L.bearer, `width:${L.bearer.w}mm;border-top:.45mm solid #000;height:0;`, '');
    const frame = o.guide ? 'outline:.25mm solid #888;background-image:linear-gradient(#ddd 1px,transparent 1px),linear-gradient(90deg,#ddd 1px,transparent 1px);background-size:10mm 10mm;'
      : o.preview ? 'outline:.25mm solid #bbb;' : '';
    return `<div class="cq-chq" style="position:relative;width:${L.w}mm;height:${L.h}mm;font-family:${L.font};${frame}">${h}</div>`;
  }
  function sheetHtml(ch, L, o) {
    const inner = chqHtml(ch, L, { guide: o && o.guide });
    if (L.paper === 'cheque') return `<div class="cq-sheet" style="width:${L.w}mm;height:${L.h - 0.4}mm">${inner}</div>`;
    return `<div class="cq-sheet" style="width:210mm;height:296mm"><div style="position:absolute;left:${L.a4x}mm;top:${L.a4y}mm">${inner}</div></div>`;
  }
  function fitPrev(box, L, ch, o) {
    const s = Math.min(1.6, (box.clientWidth || 640) / (L.w * MM)) || 1; box.__s = s;
    box.style.height = (L.h * MM * s) + 'px';
    box.innerHTML = `<div style="transform:scale(${s});transform-origin:0 0;width:${L.w}mm">${chqHtml(ch, L, o)}</div>`;
  }

  // ---------- state ----------
  const CQ = { sub: 'register', lay: {}, books: [], payees: [], sel: new Set(), pre: null, form: null, layAcc: '',
    flt: { account_id: '', status: 'open', from: '', to: '', q: '' } };
  const banks = () => ACC.filter(a => a.kind === 'bank' && a.active);
  async function lay(acc) {
    if (!CQ.lay[acc]) { const r = await api('/api/cheque/layout/' + acc); CQ.lay[acc] = mergeL(r.layout); }
    return CQ.lay[acc];
  }
  const sample = () => ({ cdate: today(), payee: 'SAMPLE PAYEE NAME LTD', amount: 1234567.5, crossing: 'ac_payee', bearer_cut: 1 });
  const isStale = c => { const d = new Date(c.cdate + 'T00:00:00'); d.setMonth(d.getMonth() + 6); return localISO(d) < today(); };
  function badges(c) {
    const st = c.status, b = [`<span class="badge ${st === 'cleared' ? 'ok' : st === 'cancelled' ? 'bad' : ''}">${{ issued: 'Issued', printed: 'Printed' + (c.print_count > 1 ? ' ×' + c.print_count : ''), cleared: 'Cleared', cancelled: 'Cancelled' }[st]}</span>`];
    if (st === 'issued' || st === 'printed') { if (c.cdate > today()) b.push('<span class="badge">Post-dated</span>'); if (isStale(c)) b.push('<span class="badge bad">Stale (6 months)</span>'); }
    return b.join(' ');
  }
  function askDate(title, val) {
    return new Promise(res => {
      modal(`<h3>${esc(title)}</h3><input type="date" id="cqd" value="${val}"><div class="actions" style="margin-top:12px"><button class="btn" id="cqdok">OK</button><button class="btn ghost" id="cqdno">Cancel</button></div>`);
      const done = v => { closeModal(); res(v); };
      $('#cqdok').onclick = () => done($('#cqd').value || null); $('#cqdno').onclick = () => done(null);
      $('#modal').onclick = e => { if (e.target === $('#modal')) done(null); };
    });
  }

  // ---------- printing ----------
  function doPrint(items, o = {}) {
    const L0 = items[0].L;
    $('#cqpage').textContent = L0.paper === 'cheque' ? `@page{size:${L0.w}mm ${L0.h}mm;margin:0}` : '@page{size:A4 portrait;margin:0}';
    $('#chqp').innerHTML = items.map(it => sheetHtml(it.ch, it.L, { guide: o.guide })).join('');
    document.body.classList.add('chq-print');
    let done = false;
    const fin = () => { if (done) return; done = true; document.body.classList.remove('chq-print'); $('#chqp').innerHTML = ''; if (o.mark) askPrinted(o.mark); };
    window.addEventListener('afterprint', fin, { once: true });
    window.print();
    setTimeout(fin, 5 * 60 * 1000);
  }
  // every cheque print is previewed first (cheque outline, positions, background image for alignment)
  function cqPreview(items, o = {}) {
    const docs = items.map(it => `<div style="overflow-x:auto"><div style="font:12px Arial;color:#555;margin-bottom:6px">${it.ch.cheque_no ? 'Cheque ' + esc(it.ch.cheque_no) + ' · ' : 'Test cheque · '}${esc(it.ch.payee)} · ${money(it.ch.amount)} · prints on ${it.L.paper === 'a4' ? 'an A4 sheet at ' + it.L.a4x + ' / ' + it.L.a4y + ' mm' : 'cheque-size paper'}</div>${chqHtml(it.ch, it.L, { preview: true, guide: !!o.guide })}</div>`);
    pvOpen({ plain: true, docs, note: `${items.length} cheque${items.length > 1 ? 's' : ''}. The grey outline and any uploaded image are for alignment only and are not printed.`, printFn: () => { pvClose(); doPrint(items, o); } });
  }
  function askPrinted(ids) {
    modal(`<h3>Did the cheque${ids.length > 1 ? 's' : ''} print correctly?</h3><p class="muted">Only mark it printed if the paper came out right. A spoiled leaf should be cancelled.</p>
      <div class="actions"><button class="btn" id="cqpy">Yes, mark as printed</button><button class="btn ghost" id="cqpn">No, keep as not printed</button></div>`);
    $('#cqpy').onclick = async () => { try { await api('/api/cheques/printed', { method: 'POST', body: { ids } }); toast('Marked as printed'); } catch (e) { toast(e.message, true); } closeModal(); if (CQ.sub === 'register') vReg(); };
    $('#cqpn').onclick = closeModal;
  }
  async function printIds(ids) {
    const rows = []; for (const id of ids) rows.push(await api('/api/cheques/' + id));
    const no = rows.filter(r => ['cancelled', 'cleared'].includes(r.status));
    if (no.length) return toast(`Cheque ${no[0].cheque_no} is ${no[0].status} and cannot be printed`, true);
    const again = rows.filter(r => r.print_count > 0);
    if (again.length && !confirm(`Cheque ${again.map(r => r.cheque_no).join(', ')} was already printed. Print again?`)) return;
    const items = []; for (const r of rows) items.push({ ch: r, L: await lay(r.account_id) });
    cqPreview(items, { mark: ids });
  }

  // ---------- main view ----------
  window.vCheque = async function (sub) {
    if (sub) CQ.sub = sub;
    head('Cheque Printing');
    const tabs = [['register', 'Cheque register'], ['new', '+ New cheque'], ['books', 'Cheque books'], ['layout', 'Layout & test print']];
    $('#view').innerHTML = `<h2>Cheque Printing</h2><div class="cqtabs noprint">${tabs.map(([k, l]) => `<button class="${CQ.sub === k ? 'on' : ''}" data-k="${k}">${l}</button>`).join('')}</div><div id="cqbody"></div>`;
    document.querySelectorAll('.cqtabs button').forEach(b => b.onclick = () => window.vCheque(b.dataset.k));
    if (!banks().length) { $('#cqbody').innerHTML = '<div class="card">Add a bank account first: Chart of Accounts > <b>+ New bank account</b>.</div>'; return; }
    CQ.books = await api('/api/cheque/books');
    return ({ register: vReg, new: vNew, books: vBooks, layout: vLay }[CQ.sub] || vReg)();
  };

  // ---------- register ----------
  async function vReg() {
    const f = CQ.flt, st = [['open', 'Not cleared (issued / printed)'], ['issued', 'Issued, not printed'], ['printed', 'Printed'], ['cleared', 'Cleared'], ['cancelled', 'Cancelled'], ['all', 'All']];
    $('#cqbody').innerHTML = `<div id="cqk"></div><div class="card"><div class="row noprint">
      <div><label>Bank</label><select id="cqa">${opts(banks(), f.account_id, 'All banks')}</select></div>
      <div><label>Status</label><select id="cqs">${st.map(([v, l]) => `<option value="${v}" ${f.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>From</label><input type="date" id="cqf" value="${f.from}"></div><div><label>To</label><input type="date" id="cqt" value="${f.to}"></div>
      <div class="grow"><label>Search</label><input id="cqq" value="${esc(f.q)}" placeholder="Payee, cheque no, narration"></div><button class="btn" id="cqgo">Show</button></div>
      <div class="actions noprint" style="margin-bottom:10px"><button class="btn" id="cqps">Print selected</button><button class="btn ghost" id="cqcsv">Export CSV</button><button class="btn ghost" id="cqrp">🖨 Print preview (list)</button></div><div id="cqlist"></div></div>`;
    const qs = () => { f.account_id = $('#cqa').value; f.status = $('#cqs').value; f.from = $('#cqf').value; f.to = $('#cqt').value; f.q = $('#cqq').value; };
    const run = async () => {
      qs();
      const p = new URLSearchParams({ account_id: f.account_id, status: f.status === 'all' ? '' : f.status, from: f.from, to: f.to, q: f.q });
      const rows = await api('/api/cheques?' + p), open = await api('/api/cheques?status=open&account_id=' + f.account_id);
      $('#cqk').innerHTML = `<div class="grid"><div class="stat"><div class="l">Outstanding cheques</div><div class="v">${money(open.reduce((s, c) => s + Number(c.amount), 0))}</div><div class="s">${open.length} not yet cleared</div></div>
        <div class="stat"><div class="l">Post-dated</div><div class="v">${open.filter(c => c.cdate > today()).length}</div></div>
        <div class="stat"><div class="l">Stale (older than 6 months)</div><div class="v">${open.filter(isStale).length}</div><div class="s">Banks may refuse stale cheques</div></div></div>`;
      CQ.rows = rows;
      $('#cqlist').innerHTML = `<div class="wrap"><table class="tbl"><thead><tr><th></th><th>Date</th><th>Cheque no.</th><th>Bank</th><th>Payee</th><th class="n">Amount</th><th>Status</th><th></th></tr></thead><tbody>
      ${rows.map(c => `<tr class="click" data-id="${c.id}"><td><input type="checkbox" class="cqk" data-id="${c.id}" ${CQ.sel.has(c.id) ? 'checked' : ''} ${['cancelled', 'cleared'].includes(c.status) ? 'disabled' : ''}></td><td>${esc(c.cdate)}</td><td>${esc(c.cheque_no)}</td><td>${esc(c.bank_name_acc)}</td><td>${esc(c.payee)}</td><td class="n">${fmt(c.amount)}</td><td>${badges(c)}</td><td><button class="btn ghost sm" data-p="${c.id}">Print</button></td></tr>`).join('') || '<tr><td colspan="8" class="muted">No cheques found</td></tr>'}</tbody></table></div>`;
      document.querySelectorAll('#cqlist tr.click').forEach(tr => tr.onclick = e => { if (e.target.closest('input,button')) return; showCheque(+tr.dataset.id); });
      document.querySelectorAll('.cqk').forEach(c => c.onchange = () => { c.checked ? CQ.sel.add(+c.dataset.id) : CQ.sel.delete(+c.dataset.id); });
      document.querySelectorAll('[data-p]').forEach(b => b.onclick = () => printIds([+b.dataset.p]).catch(e => toast(e.message, true)));
    };
    $('#cqgo').onclick = run; $('#cqq').onkeydown = e => { if (e.key === 'Enter') run(); };
    $('#cqps').onclick = () => { const ids = [...CQ.sel]; if (!ids.length) return toast('Tick the cheques to print first', true); printIds(ids).catch(e => toast(e.message, true)); };
    $('#cqrp').onclick = () => pvFromEl('#cqlist', 'CHEQUE REGISTER', [f.account_id && (ACC.find(a => a.id == f.account_id) || {}).name, f.status !== 'all' && f.status, f.from && 'From ' + fdate(f.from), f.to && 'To ' + fdate(f.to)].filter(Boolean).join(' · ') || 'All cheques');
    $('#cqcsv').onclick = () => csv('cheque-register.csv', [['Date', 'Cheque no', 'Bank', 'Payee', 'Amount', 'Status', 'Cleared on', 'Voucher'], ...(CQ.rows || []).map(c => [c.cdate, c.cheque_no, c.bank_name_acc, c.payee, c.amount, c.status, c.cleared_on || '', c.voucher_no || ''])]);
    run();
  }
  async function showCheque(id) {
    const c = await api('/api/cheques/' + id), L = await lay(c.account_id), live = !['cleared', 'cancelled'].includes(c.status);
    modal(`<h3>Cheque ${esc(c.cheque_no)} · ${esc(c.bank_name_acc)}</h3><div>${badges(c)}</div>
      <table class="tbl" style="margin:10px 0"><tr><th>Date</th><td>${esc(c.cdate)}</td><th>Amount</th><td>${money(c.amount)}</td></tr><tr><th>Payee</th><td colspan="3">${esc(c.payee)}</td></tr>
      <tr><th>Crossing</th><td>${{ ac_payee: 'A/C Payee Only', crossed: 'General crossing', none: 'None' }[c.crossing]}${c.bearer_cut ? ' · "or Bearer" struck' : ''}</td><th>Voucher</th><td>${c.voucher_id ? `<a href="#" id="cqv">${esc(c.voucher_no)}</a>` : '—'}</td></tr>
      ${c.cleared_on ? `<tr><th>Cleared on</th><td colspan="3">${esc(c.cleared_on)}</td></tr>` : ''}${c.narration ? `<tr><th>Narration</th><td colspan="3">${esc(c.narration)}</td></tr>` : ''}
      <tr><th>Printed</th><td colspan="3">${c.print_count ? c.print_count + ' time(s), last ' + esc(c.printed_at) : 'Not printed yet'}</td></tr></table>
      <div id="cqm" class="cq-prevbox"></div>
      <div class="actions" style="margin-top:12px">${live ? '<button class="btn" id="cqpr">Print</button><button class="btn ghost" id="cqed">Edit</button>' : ''}
      ${c.status !== 'cancelled' ? `<button class="btn ghost" id="cqcl">${c.status === 'cleared' ? 'Mark not cleared' : 'Mark cleared'}</button>` : ''}
      ${c.status !== 'cleared' && c.status !== 'cancelled' ? '<button class="btn red" id="cqcx">Cancel cheque</button>' : ''}
      ${c.status === 'issued' && !c.print_count && !c.voucher_id ? '<button class="btn red" id="cqdl">Delete</button>' : ''}<button class="btn ghost" id="cqx">Close</button></div>`);
    fitPrev($('#cqm'), L, c, { preview: true });
    $('#cqx').onclick = closeModal;
    if ($('#cqv')) $('#cqv').onclick = e => { e.preventDefault(); showVoucher(c.voucher_id); };
    if ($('#cqpr')) $('#cqpr').onclick = () => { closeModal(); printIds([id]).catch(e => toast(e.message, true)); };
    if ($('#cqed')) $('#cqed').onclick = () => editCheque(c);
    if ($('#cqcl')) $('#cqcl').onclick = async () => {
      const d = c.status === 'cleared' ? null : await askDate('Cleared on', today()); if (c.status !== 'cleared' && !d) return;
      try { await api(`/api/cheques/${id}/clear`, { method: 'POST', body: { cleared_on: d } }); toast(d ? 'Marked cleared' : 'Marked not cleared'); closeModal(); vReg(); } catch (e) { toast(e.message, true); }
    };
    if ($('#cqcx')) $('#cqcx').onclick = async () => {
      if (!confirm(`Cancel cheque ${c.cheque_no}? Use this for a spoiled, lost or stopped cheque.`)) return;
      try {
        const r = await api(`/api/cheques/${id}/cancel`, { method: 'POST' });
        if (r.voucher_id && confirm(`Cheque ${c.cheque_no} has payment voucher ${c.voucher_no}. Delete that voucher too?`)) await lockApi('/api/vouchers/' + r.voucher_id, { method: 'DELETE' });
        toast('Cheque cancelled'); closeModal(); vReg();
      } catch (e) { toast(e.message, true); }
    };
    if ($('#cqdl')) $('#cqdl').onclick = async () => { if (!confirm('Delete this cheque entry?')) return; try { await api('/api/cheques/' + id, { method: 'DELETE' }); closeModal(); vReg(); } catch (e) { toast(e.message, true); } };
  }
  function editCheque(c) {
    modal(`<h3>Edit cheque ${esc(c.cheque_no)}</h3><div class="row"><div><label>Date</label><input type="date" id="ed" value="${c.cdate}"></div>
      <div class="grow"><label>Payee</label><input id="ep" value="${esc(c.payee)}"></div><div><label>Amount ${c.voucher_id ? '(linked to voucher)' : ''}</label><input id="ea" type="number" step="0.01" value="${c.amount}" ${c.voucher_id ? 'disabled' : ''}></div></div>
      <div class="row"><div><label>Crossing</label><select id="ec"><option value="ac_payee" ${c.crossing === 'ac_payee' ? 'selected' : ''}>A/C Payee Only</option><option value="crossed" ${c.crossing === 'crossed' ? 'selected' : ''}>General crossing</option><option value="none" ${c.crossing === 'none' ? 'selected' : ''}>None</option></select></div>
      <div><label>&nbsp;</label><label><input type="checkbox" id="eb" ${c.bearer_cut ? 'checked' : ''}> Strike "or Bearer"</label></div><div class="grow"><label>Narration</label><input id="en" value="${esc(c.narration)}"></div></div>
      <div class="actions"><button class="btn" id="eok">Save</button><button class="btn ghost" id="eno">Cancel</button></div><div class="err" id="eer"></div>`);
    $('#eno').onclick = () => showCheque(c.id);
    $('#eok').onclick = async () => {
      try { await api('/api/cheques/' + c.id, { method: 'PUT', body: { cdate: $('#ed').value, payee: $('#ep').value, amount: $('#ea').value, crossing: $('#ec').value, bearer_cut: $('#eb').checked ? 1 : 0, narration: $('#en').value } }); toast('Saved'); closeModal(); vReg(); }
      catch (e) { $('#eer').textContent = e.message; }
    };
  }

  // ---------- new cheque ----------
  async function vNew() {
    const b = banks(), pre = CQ.pre || {}; CQ.pre = null;
    const f = CQ.form = Object.assign({ account_id: b[0].id, cheque_no: '', cdate: today(), payee: '', amount: '', crossing: 'ac_payee', bearer_cut: 1, narration: '', create_voucher: 1, counter_account_id: '', vdate: today(), voucher_id: null }, pre);
    await loadParties();
    const counters = activeAcc(a => a.kind === 'normal');
    const hint = () => {
      const bk = CQ.books.filter(x => x.account_id == f.account_id && x.active && x.next_free)[0];
      return bk ? `Next number: <b>${String(bk.next_free).padStart(bk.pad, '0')}</b> (${esc(bk.label || 'cheque book')}, ${bk.total - bk.used} leaves left). Leave blank to use it.` : '<span style="color:var(--bad)">No cheque book with free leaves for this bank. Type the cheque number or add a book.</span>';
    };
    $('#cqbody').innerHTML = `<div class="card">${f.voucher_id ? '<div class="muted" style="margin-bottom:8px">Printing a cheque for an existing payment voucher. Details were filled in from the voucher.</div>' : ''}
      <div class="row"><div class="grow"><label>Bank account</label><select data-f="account_id">${banks().map(a => `<option value="${a.id}" ${a.id == f.account_id ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
        <div><label>Cheque no. (optional)</label><input data-f="cheque_no" value="${esc(f.cheque_no)}" placeholder="auto" style="width:150px"></div>
        <div><label>Cheque date</label><input type="date" data-f="cdate" value="${f.cdate}"></div></div>
      <div id="cqhint" class="muted" style="margin:-4px 0 10px">${hint()}</div>
      <div class="row"><div class="grow"><label>Pay to (payee)</label><input data-f="payee" class="sbi" value="${esc(f.payee)}" placeholder="Type to search or add…" autocomplete="off"></div>
        <div><label>Amount (৳)</label><input type="number" step="0.01" min="0" data-f="amount" value="${esc(f.amount)}" style="width:160px"></div></div>
      <div id="cqw" style="margin:-4px 0 10px;font-weight:600"></div><div id="cqdn" class="muted" style="margin-bottom:10px"></div>
      <div class="row"><div><label>Crossing</label><select data-f="crossing"><option value="ac_payee" ${f.crossing === 'ac_payee' ? 'selected' : ''}>A/C Payee Only</option><option value="crossed" ${f.crossing === 'crossed' ? 'selected' : ''}>General crossing (two lines)</option><option value="none" ${f.crossing === 'none' ? 'selected' : ''}>None</option></select></div>
        <div><label>&nbsp;</label><label><input type="checkbox" data-f="bearer_cut" ${f.bearer_cut ? 'checked' : ''}> Strike out "or Bearer"</label></div>
        <div class="grow"><label>Narration (for the register / voucher)</label><input data-f="narration" value="${esc(f.narration)}"></div></div>
      ${f.voucher_id ? '' : `<div class="card" style="background:var(--bg)"><label><input type="checkbox" data-f="create_voucher" ${f.create_voucher ? 'checked' : ''}> Also create the bank payment voucher (Dr expense / party account, Cr bank)</label>
        ${f.create_voucher ? `<div class="row" style="margin-top:8px"><div class="grow"><label>Expense / party account</label><select data-f="counter_account_id">${opts(counters, f.counter_account_id)}</select></div><div><label>Voucher date</label><input type="date" data-f="vdate" value="${f.vdate}"></div></div>` : ''}</div>`}
      <div class="actions"><button class="btn" id="cqsv">Save cheque</button><button class="btn ghost" id="cqsp">Save &amp; print</button></div></div>
      <div class="card"><h3>Preview</h3><div id="cqprev" class="cq-prevbox"></div><div class="muted" style="margin-top:6px">Positions come from this bank's layout. Adjust them in <b>Layout &amp; test print</b>.</div></div>`;
    const draw = async () => {
      const L = await lay(f.account_id);
      fitPrev($('#cqprev'), L, { ...f, bearer_cut: f.bearer_cut ? 1 : 0 }, { preview: true });
      $('#cqw').textContent = f.amount ? amtWords(f.amount, L) : '';
      $('#cqdn').textContent = f.cdate > today() ? 'Post-dated cheque: the bank pays it only on or after this date.' : '';
    };
    document.querySelectorAll('#cqbody [data-f]').forEach(el => {
      const upd = () => { f[el.dataset.f] = el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value; };
      el.oninput = () => { upd(); draw(); };
      el.onchange = async () => { upd(); if (['account_id', 'create_voucher'].includes(el.dataset.f)) { CQ.pre = { ...f }; await vNew(); } };
    });
    attachCombo($('[data-f=payee]'), {
      freeText: true, addLabel: x => `+ Add “${x}” as new payee`,
      items: () => PARTIES.filter(p => partyKindOk(p, 'paid')).map(p => ({ label: p.name })),
      onPick: it => { f.payee = it.label; draw(); },
      onAdd: async x => { try { const p = await api('/api/parties', { method: 'POST', body: { name: x, kind: 'paid' } }); mergeParty(p); $('[data-f=payee]').value = p.name; f.payee = p.name; draw(); toast('Added to party list'); } catch (e) { toast(e.message, true); } }
    });
    $('#cqsv').onclick = () => save(false); $('#cqsp').onclick = () => save(true);
    async function save(print) {
      try {
        const r = await lockApi('/api/cheques', { method: 'POST', body: { ...f, bearer_cut: f.bearer_cut ? 1 : 0, create_voucher: f.voucher_id ? 0 : (f.create_voucher ? 1 : 0) } });
        toast('Cheque ' + r.cheque_no + ' saved'); CQ.sub = 'register'; await window.vCheque('register');
        if (print) printIds([r.id]).catch(e => toast(e.message, true));
      } catch (e) { toast(e.message, true); }
    }
    draw();
  }
  window.cqFromVoucher = async id => {
    closeModal();
    try {
      const v = await api('/api/vouchers/' + id), bank = v.lines.find(l => l.credit > 0 && (ACC.find(a => a.id == l.account_id) || {}).kind === 'bank');
      if (!bank) return toast('This voucher has no bank account on its credit side', true);
      CQ.pre = { account_id: bank.account_id, cdate: v.vdate, payee: v.party || '', amount: v.lines.reduce((s, l) => s + l.debit, 0), narration: v.narration || '', cheque_no: /^\d+$/.test(v.cheque_no || '') ? v.cheque_no : '', voucher_id: v.id, create_voucher: 0 };
      CQ.sub = 'new'; go('chq');
    } catch (e) { toast(e.message, true); }
  };

  // ---------- cheque books ----------
  function vBooks() {
    const b = banks(), rows = CQ.books;
    $('#cqbody').innerHTML = `<div class="card"><h3>Add a cheque book</h3><div class="row"><div class="grow"><label>Bank account</label><select id="bkb">${b.map(a => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
      <div><label>Label</label><input id="bkl" placeholder="e.g. Book 5" style="width:140px"></div><div><label>First cheque no.</label><input id="bks" inputmode="numeric" placeholder="0123401" style="width:140px"></div>
      <div><label>Last cheque no.</label><input id="bke" inputmode="numeric" placeholder="0123450" style="width:140px"></div><button class="btn" id="bkadd">Add book</button></div><div class="err" id="bker"></div></div>
      <div class="card"><div class="wrap"><table class="tbl"><thead><tr><th>Bank</th><th>Book</th><th>Range</th><th>Next no.</th><th class="n">Used</th><th class="n">Left</th><th></th></tr></thead><tbody>
      ${rows.map(k => { const left = Math.max(0, k.total - k.used), p = n => String(n).padStart(k.pad, '0'); return `<tr style="${k.active ? '' : 'opacity:.55'}"><td>${esc(k.account_name)}</td><td>${esc(k.label)}</td><td>${p(k.start_no)} – ${p(k.end_no)}</td><td>${k.next_free ? p(k.next_free) : '—'}</td><td class="n">${k.used}</td><td class="n">${left}${left && left <= 5 && k.active ? ' <span class="badge bad">low</span>' : ''}</td><td><button class="btn ghost sm" data-t="${k.id}">${k.active ? 'Deactivate' : 'Activate'}</button> <button class="btn ghost sm" data-x="${k.id}">Delete</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">No cheque books yet. Add the number range printed on your cheque book.</td></tr>'}</tbody></table></div></div>`;
    $('#bkadd').onclick = async () => {
      try { await api('/api/cheque/books', { method: 'POST', body: { account_id: $('#bkb').value, label: $('#bkl').value, start_no: $('#bks').value, end_no: $('#bke').value } }); toast('Cheque book added'); window.vCheque('books'); }
      catch (e) { $('#bker').textContent = e.message; }
    };
    document.querySelectorAll('[data-t]').forEach(x => x.onclick = async () => { const k = rows.find(r => r.id == x.dataset.t); await api('/api/cheque/books/' + k.id, { method: 'PUT', body: { label: k.label, active: k.active ? 0 : 1 } }); window.vCheque('books'); });
    document.querySelectorAll('[data-x]').forEach(x => x.onclick = async () => { if (!confirm('Delete this cheque book?')) return; try { await api('/api/cheque/books/' + x.dataset.x, { method: 'DELETE' }); window.vCheque('books'); } catch (e) { toast(e.message, true); } });
  }

  // ---------- layout editor ----------
  const FIELDS = [['date', 'Date (first digit box)', ['x', 'y', 'size', 'pitch']], ['payee', 'Payee name', ['x', 'y', 'size', 'w']], ['words1', 'Amount in words, line 1', ['x', 'y', 'size', 'w']],
    ['words2', 'Amount in words, line 2', ['x', 'y', 'size', 'w']], ['fig', 'Amount in figures', ['x', 'y', 'size', 'w']], ['cross', 'A/C Payee crossing', ['x', 'y', 'w', 'h', 'angle']], ['bearer', 'Strike "or Bearer"', ['x', 'y', 'w']]];
  async function vLay() {
    const b = banks(); if (!CQ.layAcc || !b.find(a => a.id == CQ.layAcc)) CQ.layAcc = b[0].id;
    const L = await lay(CQ.layAcc), others = b.filter(a => a.id != CQ.layAcc), S = sample();
    const num = (id, v, st = 0.5) => `<input type="number" step="${st}" id="${id}" value="${v}" style="width:90px">`;
    $('#cqbody').innerHTML = `<div class="card"><div class="row"><div class="grow"><label>Bank account</label><select id="lyb">${b.map(a => `<option value="${a.id}" ${a.id == CQ.layAcc ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
      ${others.length ? `<div class="grow"><label>Copy layout from</label><select id="lyc"><option value="">Choose…</option>${others.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>` : ''}</div>
      <p class="muted" style="margin-top:0">Measure from the <b>top-left corner</b> of your cheque leaf (mm). Drag items on the preview or type values. Upload a photo or scan of the leaf to line things up on screen (it is never printed). Then use <b>Test print</b> on plain paper and hold it against a real cheque.</p>
      <div id="lyp" class="cq-prevbox" style="touch-action:none"></div>
      <div class="actions" style="margin:10px 0"><label class="btn ghost" style="cursor:pointer">Upload cheque image<input type="file" id="lyf" accept="image/*" class="hidden"></label><button class="btn ghost" id="lyrb">Remove image</button>
        <button class="btn ghost" id="lyt1">Test print (fields only)</button><button class="btn ghost" id="lyt2">Test print with guide</button><button class="btn" id="lysv">Save layout</button><button class="btn ghost" id="lyrs">Reset to default</button></div></div>
      <div class="card"><h3>Paper &amp; printer</h3><div class="row"><div><label>Print on</label><select id="lpp"><option value="a4" ${L.paper === 'a4' ? 'selected' : ''}>A4 sheet (cheque placed at top-left offset)</option><option value="cheque" ${L.paper === 'cheque' ? 'selected' : ''}>Cheque-size paper</option></select></div>
        <div><label>Leaf width (mm)</label>${num('lpw', L.w, 0.1)}</div><div><label>Leaf height (mm)</label>${num('lph', L.h, 0.1)}</div>
        <div><label>A4 offset X (mm)</label>${num('lpx', L.a4x)}</div><div><label>A4 offset Y (mm)</label>${num('lpy', L.a4y)}</div>
        <div><label>Shift all fields X</label>${num('lox', L.ox, 0.1)}</div><div><label>Shift all fields Y</label>${num('loy', L.oy, 0.1)}</div></div>
        <div class="row"><div><label>Words start with</label><input id="lwp" value="${esc(L.words.prefix)}" style="width:110px"></div><div><label>Words end with</label><input id="lws" value="${esc(L.words.suffix)}" style="width:110px"></div>
        <div><label>Figures prefix</label><input id="lfp" value="${esc(L.fig.prefix)}" style="width:90px"></div><div><label>Figures suffix</label><input id="lfs" value="${esc(L.fig.suffix)}" style="width:90px"></div>
        <div><label>&nbsp;</label><label><input type="checkbox" id="lwu" ${L.words.upper ? 'checked' : ''}> Words in CAPITALS</label></div><div><label>&nbsp;</label><label><input type="checkbox" id="lpu" ${L.payee.upper ? 'checked' : ''}> Payee in CAPITALS</label></div></div>
        <p class="muted" style="margin:0">Leave "Words start with" empty if your leaf already has "Taka" printed. "Shift all fields" corrects printer feed errors without moving each item.</p></div>
      <div class="card"><h3>Field positions (mm)</h3><div class="wrap"><table class="tbl"><thead><tr><th>Item</th><th>X</th><th>Y</th><th>Size / W</th><th>Width / H</th><th>Extra</th></tr></thead><tbody>
      ${FIELDS.map(([k, label, ps]) => `<tr><td>${label}</td>${['x', 'y'].map(p => `<td><input type="number" step="0.5" data-k="${k}" data-p="${p}" value="${L[k][p]}" style="width:80px"></td>`).join('')}
        <td>${ps.includes('size') ? `<input type="number" step="0.5" data-k="${k}" data-p="size" value="${L[k].size}" style="width:80px"> pt` : (ps.includes('w') ? `<input type="number" step="0.5" data-k="${k}" data-p="w" value="${L[k].w}" style="width:80px">` : '')}</td>
        <td>${ps.includes('size') && ps.includes('w') ? `<input type="number" step="0.5" data-k="${k}" data-p="w" value="${L[k].w}" style="width:80px">` : ps.includes('h') ? `<input type="number" step="0.5" data-k="${k}" data-p="h" value="${L[k].h}" style="width:80px">` : ps.includes('pitch') ? `<input type="number" step="0.1" data-k="${k}" data-p="pitch" value="${L[k].pitch}" style="width:80px"> box pitch` : ''}</td>
        <td>${ps.includes('angle') ? `<input type="number" step="1" data-k="${k}" data-p="angle" value="${L[k].angle}" style="width:70px"> ° &nbsp;<input type="number" step="0.5" data-k="${k}" data-p="size" value="${L[k].size}" style="width:70px"> pt` : ''}</td></tr>`).join('')}</tbody></table></div></div>`;
    const prev = $('#lyp'), draw = () => fitPrev(prev, L, S, { guide: true, preview: true });
    draw();
    const bind = (id, fn) => { $(id).oninput = () => { fn($(id)); draw(); }; };
    bind('#lpp', e => L.paper = e.value); bind('#lpw', e => L.w = +e.value || DEF.w); bind('#lph', e => L.h = +e.value || DEF.h); bind('#lpx', e => L.a4x = +e.value || 0); bind('#lpy', e => L.a4y = +e.value || 0);
    bind('#lox', e => L.ox = +e.value || 0); bind('#loy', e => L.oy = +e.value || 0); bind('#lwp', e => L.words.prefix = e.value.trim()); bind('#lws', e => L.words.suffix = e.value.trim());
    bind('#lfp', e => L.fig.prefix = e.value); bind('#lfs', e => L.fig.suffix = e.value); bind('#lwu', e => L.words.upper = e.checked ? 1 : 0); bind('#lpu', e => L.payee.upper = e.checked ? 1 : 0);
    document.querySelectorAll('input[data-k]').forEach(i => i.oninput = () => { L[i.dataset.k][i.dataset.p] = +i.value || 0; draw(); });
    // drag items on the preview
    let drag = null;
    prev.onpointerdown = e => { const el = e.target.closest('[data-k]'); if (!el || !L[el.dataset.k]) return; const k = el.dataset.k; drag = { k, sx: e.clientX, sy: e.clientY, x0: L[k].x, y0: L[k].y }; try { prev.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } e.preventDefault(); };
    prev.onpointermove = e => {
      if (!drag) return; const f = MM * (prev.__s || 1), r = v => Math.round(v * 2) / 2;
      L[drag.k].x = r(drag.x0 + (e.clientX - drag.sx) / f); L[drag.k].y = r(drag.y0 + (e.clientY - drag.sy) / f);
      document.querySelectorAll(`input[data-k="${drag.k}"]`).forEach(i => { if (i.dataset.p === 'x') i.value = L[drag.k].x; if (i.dataset.p === 'y') i.value = L[drag.k].y; });
      draw();
    };
    prev.onpointerup = prev.onpointercancel = () => { drag = null; };
    $('#lyb').onchange = e => { CQ.layAcc = e.target.value; vLay(); };
    if ($('#lyc')) $('#lyc').onchange = async e => { if (!e.target.value) return; const r = await api('/api/cheque/layout/' + e.target.value); if (!r.layout) return toast('That bank has no saved layout yet', true); CQ.lay[CQ.layAcc] = mergeL(r.layout); toast('Copied. Press Save layout to keep it.'); vLay(); };
    $('#lyf').onchange = e => {
      const file = e.target.files[0]; if (!file) return; const img = new Image();
      img.onload = () => { const sc = Math.min(1, 1600 / img.width), c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); L.bg = c.toDataURL('image/jpeg', 0.8); draw(); toast('Image added for alignment (not printed)'); };
      img.onerror = () => toast('Could not read that image', true); img.src = URL.createObjectURL(file);
    };
    $('#lyrb').onclick = () => { L.bg = ''; draw(); };
    $('#lyt1').onclick = () => cqPreview([{ ch: S, L }]); $('#lyt2').onclick = () => cqPreview([{ ch: S, L }], { guide: true });
    $('#lysv').onclick = async () => { try { await api('/api/cheque/layout/' + CQ.layAcc, { method: 'PUT', body: { layout: L } }); toast('Layout saved'); } catch (e) { toast(e.message, true); } };
    $('#lyrs').onclick = async () => { if (!confirm('Reset this bank to the default layout?')) return; await api('/api/cheque/layout/' + CQ.layAcc, { method: 'DELETE' }); delete CQ.lay[CQ.layAcc]; vLay(); };
  }
})();
