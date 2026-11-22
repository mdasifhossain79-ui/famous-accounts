/* Import Excel / CSV into the Petty Cash book or a Bank book */
(function () {
  const $ = s => document.querySelector(s);
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9\u0980-\u09ff]/g, '');
  const bn = s => String(s).replace(/[০-৯]/g, d => '০১২৩৪৫৬৭৮৯'.indexOf(d));
  const letters = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  const MN = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const mk = (y, m, d) => { if (m < 1 || m > 12 || d < 1 || d > 31) return ''; const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 ? t.toISOString().slice(0, 10) : ''; };
  const y2 = y => (y < 100 ? 2000 + y : y);

  // ---------- reading files ----------
  function parseCsv(t) {
    const first = t.split(/\r?\n/, 1)[0], delim = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
    const rows = []; let row = [], cur = '', q = false;
    for (let i = 0; i < t.length; i++) {
      const c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === delim) { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; rows.push(row); row = []; }
      else cur += c;
    }
    if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }
  const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(new Error('Could not read the file')); how === 'text' ? r.readAsText(file) : r.readAsArrayBuffer(file); });
  let xlsxP = null;
  const loadXlsx = () => window.XLSX ? Promise.resolve() : (xlsxP = xlsxP || new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vendor/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Excel reader could not be loaded')); document.head.appendChild(s); }));
  // dates come back as fixed yyyy-mm-dd text (independent of the PC's time zone); numbers stay exact
  function sheetRows(ws) {
    for (const a in ws) { if (a[0] === '!') continue; const c = ws[a]; if (c && c.t === 'd') { c.z = 'yyyy-mm-dd'; delete c.w; } }
    const raw = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' }), fm = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '' });
    return raw.map((r, i) => r.map((v, j) => (v instanceof Date ? (fm[i] || [])[j] : v)));
  }

  // ---------- value parsing ----------
  function parseDate(v) {
    if (v == null || v === '') return '';
    if (typeof v === 'number') return v > 20000 && v < 80000 ? new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5).toISOString().slice(0, 10) : '';
    const s = bn(String(v)).trim().replace(/\s+\d{1,2}:\d{2}(:\d{2})?\s*([ap]m)?$/i, '').replace(/^[A-Za-z]{3,9},\s*/, ''); let m;
    if ((m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/))) return mk(+m[1], +m[2], +m[3]);
    if ((m = s.match(/^(\d{1,2})[-\/. ](\d{1,2})[-\/. ](\d{2,4})$/))) return mk(y2(+m[3]), +m[2], +m[1]);   // day / month / year
    if ((m = s.match(/^(\d{1,2})[-\/. ]([A-Za-z]{3,9})[-\/. ,]*(\d{2,4})$/))) return mk(y2(+m[3]), MN.findIndex(x => m[2].toLowerCase().startsWith(x)) + 1, +m[1]);
    if ((m = s.match(/^([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/))) return mk(+m[3], MN.findIndex(x => m[1].toLowerCase().startsWith(x)) + 1, +m[2]);
    return '';
  }
  function parseAmt(v) {
    if (v == null || v === '') return 0; if (typeof v === 'number') return v;
    const s = bn(String(v)).trim(); if (!s || /^[-—–]+$/.test(s)) return 0;
    const neg = /^\(.*\)$/.test(s) || /^-/.test(s), n = parseFloat(s.replace(/[^0-9.]/g, ''));
    return isNaN(n) ? 0 : (neg ? -n : n);
  }

  // ---------- column detection ----------
  const SYN = {
    date: ['date', 'txndate', 'transactiondate', 'valuedate', 'postdate', 'dt', 'তারিখ'],
    in: ['receipt', 'receipts', 'deposit', 'deposits', 'credit', 'cr', 'moneyin', 'cashin', 'received', 'income', 'inflow', 'জমা'],
    out: ['payment', 'payments', 'withdrawal', 'withdrawals', 'debit', 'dr', 'moneyout', 'cashout', 'paid', 'expense', 'outflow', 'খরচ'],
    amount: ['amount', 'amt', 'taka', 'tk', 'netamount'],
    cheque: ['chequeno', 'chequenumber', 'cheque', 'chq', 'chqno', 'checkno', 'check', 'instrument', 'instrumentno'],
    ref: ['ref', 'reference', 'refno', 'billno', 'memono', 'voucherno', 'vchno', 'billmemono'],
    party: ['party', 'name', 'paidto', 'receivedfrom', 'payee', 'payer', 'vendor', 'customer', 'beneficiary', 'partyname', 'paidtoreceivedfrom'],
    head: ['head', 'headofaccount', 'accounthead', 'account', 'accountname', 'ledger', 'category', 'expensehead'],
    narr: ['narration', 'remarks', 'remark', 'description', 'details', 'note', 'notes', 'memo', 'purpose', 'narrative', 'transactiondetails']
  };
  function findHeader(rows) {
    let best = 0, bi = 0;
    for (let i = 0; i < Math.min(rows.length, 25); i++) {
      const ks = rows[i].map(norm); let n = 0; for (const f in SYN) if (ks.some(k => SYN[f].includes(k))) n++;
      if (ks.some(k => SYN.date.includes(k)) && n > best) { best = n; bi = i; }
    }
    return bi;
  }
  function autoMap(hdr, kind) {
    const keys = hdr.map(norm), used = new Set(), map = {};
    const find = (f, extra = []) => { const i = keys.findIndex((k, j) => !used.has(j) && (SYN[f].includes(k) || extra.includes(k))); if (i >= 0) used.add(i); return i; };
    map.date = find('date'); map.in = find('in'); map.out = find('out'); map.amount = (map.in >= 0 || map.out >= 0) ? -1 : find('amount');
    map.cheque = find('cheque'); map.ref = find('ref'); map.party = find('party');
    // “Particulars” is the head in a petty cash book, the description in a bank statement
    map.head = find('head', kind === 'cash' ? ['particulars', 'particular', 'description', 'details'] : []);
    map.narr = find('narr', ['particulars', 'particular']);
    return map;
  }

  // ---------- state ----------
  let ST = null;
  const accLabel2 = a => `${a.code} · ${a.name}`;
  const pickAccounts = () => ACC.filter(a => a.active && String(a.id) !== String(ST.acc));
  function matchHead(text) {
    const t = String(text || '').trim(); if (!t) return null;
    const cands = pickAccounts(), n = norm(t), code = (t.match(/^\d{3,6}/) || [])[0];
    let a = cands.find(x => norm(x.name) === n) || cands.find(x => norm(x.code + x.name) === n) || (code && cands.find(x => x.code === code)) || cands.find(x => norm(x.code) === n);
    return a ? a.id : null;
  }
  // closest existing account when exactly one account name contains the head text ("Tea" -> "Tea, Snacks & Refreshment")
  function suggest(text) {
    const n = norm(text); if (n.length < 3) return null;
    const c = pickAccounts().filter(a => norm(a.name).includes(n));
    return c.length === 1 ? c[0].id : null;
  }
  function evaluate() {
    const S = ST, items = [];
    for (let i = S.hdr + 1; i < S.rows.length; i++) {
      const r = S.rows[i], g = k => (S.map[k] >= 0 ? r[S.map[k]] : '');
      const date = parseDate(g('date')); let inn = Math.abs(parseAmt(g('in'))), out = Math.abs(parseAmt(g('out')));
      if (S.map.amount >= 0 && !inn && !out) { let a = parseAmt(g('amount')); if (S.swap) a = -a; if (a > 0) inn = a; else if (a < 0) out = -a; }
      else if (S.swap) [inn, out] = [out, inn];
      const head = String(g('head') || '').trim(), narr = String(g('narr') || '').trim();
      if (!date && !inn && !out && !head && !narr) continue;
      let status = 'ok';
      if (/^(total|grand total|closing|opening|balance|b\/f|c\/f|carried|brought|sub total)/i.test(head || narr)) status = 'skip';
      else if (!inn && !out) status = 'noamt'; else if (inn && out) status = 'both'; else if (!date) status = 'baddate';
      items.push({ n: i + 1, date, dateRaw: g('date'), head, party: String(g('party') || '').trim(), narr, cheque: String(g('cheque') || '').trim(), ref: String(g('ref') || '').trim(), inn, out, status, on: status === 'ok' });
    }
    S.items = items;
  }
  async function markDuplicates() {
    const S = ST, ok = S.items.filter(x => x.status === 'ok'); if (!ok.length) return;
    const dates = ok.map(x => x.date).sort(), cnt = {};
    try {
      const b = await api(`/api/book/${S.acc}?from=${dates[0]}&to=${dates[dates.length - 1]}`);
      b.rows.forEach(r => { const k = `${r.vdate}|${r.debit > 0 ? 'I' : 'O'}|${(r.debit || r.credit).toFixed(2)}`; cnt[k] = (cnt[k] || 0) + 1; });
    } catch (e) { /* duplicates simply not flagged */ }
    S.items.forEach(x => { x.dup = false; if (x.status !== 'ok') return; const k = `${x.date}|${x.inn ? 'I' : 'O'}|${(x.inn || x.out).toFixed(2)}`; if (cnt[k] > 0) { cnt[k]--; x.dup = true; } x.on = !(x.dup && S.skipDup); });
  }
  function buildHeads() {
    const S = ST, old = S.heads || {}, heads = {};
    S.items.filter(x => x.status === 'ok' && x.head).forEach(x => {
      if (matchHead(x.head)) { x.acc = matchHead(x.head); return; }
      const k = norm(x.head), h = heads[k] || (heads[k] = { text: x.head, rows: 0, inn: 0, out: 0, acc: old[k] ? old[k].acc : suggest(x.head), type: (old[k] || {}).type || null });
      h.rows++; x.inn ? h.inn++ : h.out++; x.hk = k; x.acc = null;
    });
    Object.values(heads).forEach(h => { if (!h.type) h.type = h.inn > h.out ? 'income' : 'expense'; });
    S.heads = heads;
  }

  // ---------- user interface ----------
  const SAMPLE = {
    cash: 'Date,Head of account,Paid to / Received from,Narration,Receipt,Payment\n2026-11-02,Tea, Snacks & Refreshment,Canteen,Tea for office,,250\n2026-11-02,Conveyance,Rickshaw,Visit to bank,,120\n2026-11-03,Cash from bank,Main Bank,Petty cash top up,10000,\n',
    bank: 'Date,Description,Head of account,Party,Cheque no,Deposit,Withdrawal\n2026-11-02,Cheque deposit,Export Sales,ABC Buyer,0123456,150000,\n2026-11-03,Cheque payment,Factory Rent,Landlord,0123401,,35000\n2026-11-04,Bank charge,Bank Charges,,,,550\n'
  };
  const fld = [['date', 'Date *'], ['head', 'Head of account'], ['party', 'Party'], ['narr', 'Narration'], ['cheque', 'Cheque no'], ['ref', 'Bill / ref no'], ['in', 'Money in (receipt / deposit)'], ['out', 'Money out (payment / withdrawal)'], ['amount', 'Single amount column (− = money out)']];
  function begin(accId, onDone) {
    const a = ACC.find(x => String(x.id) === String(accId));
    if (!a || !['cash', 'bank'].includes(a.kind)) return toast('Choose a petty cash or bank account first', true);
    ST = { acc: a.id, kind: a.kind, onDone, rows: [], map: {}, hdr: 0, swap: false, skipDup: true, items: [], heads: {}, fb: {} };
    const pay = ACC.find(x => x.code === '5520') || ACC.find(x => x.type === 'expense'), rec = ACC.find(x => x.code === '4060') || ACC.find(x => x.type === 'income');
    ST.fb = { pay: pay ? pay.id : '', rec: rec ? rec.id : '' };
    modal(''); const card = $('#modal .card'); card.style.maxWidth = '1100px'; card.id = 'imcard'; $('#modal').onclick = null; draw1();
  }
  function draw1() {
    const a = ACC.find(x => String(x.id) === String(ST.acc));
    $('#imcard').innerHTML = `<h3>⬆ Import into ${esc(accLabel2(a))}</h3>
      <p class="muted" style="margin-top:0">Upload an Excel (.xlsx, .xls) or CSV file of your ${ST.kind === 'cash' ? 'petty cash book' : 'bank statement / bank book'}. You will see a full preview and can fix the column matching before anything is saved. Each row becomes a ${ST.kind === 'cash' ? 'cash' : 'bank'} voucher.</p>
      <div class="row"><div class="grow"><label>Choose file</label><input type="file" id="imf" accept=".xlsx,.xls,.csv,.txt"></div></div>
      <div class="actions"><button class="btn ghost" id="imsa">Download sample CSV</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div><div class="err" id="imer"></div>`;
    $('#imf').onchange = () => handleFile($('#imf').files[0]);
    $('#imsa').onclick = () => { const l = document.createElement('a'); l.href = URL.createObjectURL(new Blob(['\ufeff' + SAMPLE[ST.kind]], { type: 'text/csv' })); l.download = `sample-${ST.kind === 'cash' ? 'petty-cash' : 'bank'}-import.csv`; l.click(); };
  }
  async function handleFile(file) {
    if (!file) return;
    try {
      ST.file = file.name;
      if (/\.(csv|txt)$/i.test(file.name)) { ST.sheets = null; ST.rows = parseCsv((await readAs(file, 'text')).replace(/^\ufeff/, '')); }
      else { await loadXlsx(); const wb = XLSX.read(await readAs(file, 'buf'), { type: 'array', cellDates: true, dateNF: 'yyyy-mm-dd' }); ST.wb = wb; ST.sheets = wb.SheetNames; ST.sheet = 0; ST.rows = sheetRows(wb.Sheets[wb.SheetNames[0]]); }
      if (!ST.rows.length) throw new Error('The file has no data rows');
      ST.hdr = findHeader(ST.rows); ST.map = autoMap(ST.rows[ST.hdr], ST.kind); await refresh(true);
    } catch (e) { if ($('#imer')) $('#imer').textContent = e.message; else toast(e.message, true); }
  }
  async function refresh(full) {
    evaluate(); await markDuplicates(); buildHeads();
    if (full || !$('#imprev')) draw2(); else drawPrev();
  }
  const colOpts = (sel) => `<option value="-1">— none —</option>` + (ST.rows[ST.hdr] || []).map((h, i) => `<option value="${i}" ${+sel === i ? 'selected' : ''}>${letters(i)} · ${esc(String(h).slice(0, 28))}</option>`).join('');
  function draw2() {
    const a = ACC.find(x => String(x.id) === String(ST.acc)), normal = ACC.filter(x => x.active && x.kind === 'normal');
    $('#imcard').innerHTML = `<h3>⬆ Import into ${esc(accLabel2(a))}</h3>
      <div class="row"><div class="muted grow">File: <b>${esc(ST.file)}</b>${ST.sheets && ST.sheets.length > 1 ? '' : ''}</div>
        ${ST.sheets && ST.sheets.length > 1 ? `<div><label>Sheet</label><select id="imsh">${ST.sheets.map((s, i) => `<option value="${i}" ${i === ST.sheet ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></div>` : ''}
        <div><label>Header row no.</label><input type="number" min="1" id="imhr" value="${ST.hdr + 1}" style="width:90px"></div><button class="btn ghost" id="imch">Change file</button></div>
      <div class="card" style="background:var(--bg)"><h3 style="font-size:13px">Match your columns</h3><div class="row">${fld.map(([k, l]) => `<div><label>${l}</label><select data-m="${k}">${colOpts(ST.map[k])}</select></div>`).join('')}</div>
        <div class="row"><label><input type="checkbox" id="imsw" ${ST.swap ? 'checked' : ''}> Swap money in / out (tick if your “Debit” column is money coming IN)</label></div>
        <div class="muted">Dates such as 05/11/2026 are read as day / month / year.</div></div>
      <div class="row"><div><label>Rows with no head → payments go to</label><select id="imfp">${normal.filter(x => x.type !== 'income').map(x => `<option value="${x.id}" ${String(x.id) === String(ST.fb.pay) ? 'selected' : ''}>${esc(accLabel2(x))}</option>`).join('')}</select></div>
        <div><label>Rows with no head → receipts go to</label><select id="imfr">${normal.filter(x => x.type !== 'expense').map(x => `<option value="${x.id}" ${String(x.id) === String(ST.fb.rec) ? 'selected' : ''}>${esc(accLabel2(x))}</option>`).join('')}</select></div>
        <div><label>&nbsp;</label><label><input type="checkbox" id="imsd" ${ST.skipDup ? 'checked' : ''}> Skip rows that already exist in this book</label></div></div>
      <div id="imheads"></div><div id="imprev"></div><div class="err" id="imer"></div>`;
    $('#imch').onclick = draw1;
    $('#imhr').onchange = async () => { ST.hdr = Math.max(0, (+$('#imhr').value || 1) - 1); ST.map = autoMap(ST.rows[ST.hdr] || [], ST.kind); await refresh(true); };
    if ($('#imsh')) $('#imsh').onchange = async () => { ST.sheet = +$('#imsh').value; ST.rows = sheetRows(ST.wb.Sheets[ST.sheets[ST.sheet]]); ST.hdr = findHeader(ST.rows); ST.map = autoMap(ST.rows[ST.hdr] || [], ST.kind); await refresh(true); };
    document.querySelectorAll('#imcard [data-m]').forEach(s => s.onchange = async () => { ST.map[s.dataset.m] = +s.value; await refresh(false); });
    $('#imsw').onchange = async () => { ST.swap = $('#imsw').checked; await refresh(false); };
    $('#imsd').onchange = async () => { ST.skipDup = $('#imsd').checked; ST.items.forEach(x => { if (x.dup) x.on = !ST.skipDup; }); drawPrev(); };
    $('#imfp').onchange = () => { ST.fb.pay = $('#imfp').value; };
    $('#imfr').onchange = () => { ST.fb.rec = $('#imfr').value; };
    drawHeads(); drawPrev();
  }
  function drawHeads() {
    const hs = Object.entries(ST.heads), box = $('#imheads'); if (!box) return;
    if (!hs.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<div class="card" style="background:var(--bg)"><h3 style="font-size:13px">Heads not found in your Chart of Accounts (${hs.length})</h3>
      <p class="muted" style="margin:0 0 8px">The closest existing account is filled in where there is one. Clear the box to <b>create a new account</b> with that name, or search and pick another account.</p>
      <div class="wrap"><table class="tbl"><thead><tr><th>Head in file</th><th class="n">Rows</th><th>Map to existing account (or leave empty to create)</th><th>New account type</th></tr></thead><tbody>
      ${hs.map(([k, h]) => `<tr><td>${esc(h.text)}</td><td class="n">${h.rows}</td><td><input class="sbi" data-hk="${esc(k)}" placeholder="Create new “${esc(h.text)}” — or search…" value="${esc(h.acc ? accLabel(h.acc) : '')}" autocomplete="off"></td>
        <td><select data-ht="${esc(k)}" ${h.acc ? 'disabled' : ''}>${['expense', 'income', 'asset', 'liability'].map(t => `<option ${h.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table></div></div>`;
    box.querySelectorAll('[data-hk]').forEach(el => {
      const k = el.dataset.hk;
      attachCombo(el, {
        items: () => pickAccounts().map(a => ({ label: accLabel2(a), name: a.name, id: a.id })),
        current: () => (ST.heads[k].acc ? { label: accLabel(ST.heads[k].acc) } : null),
        onPick: it => { ST.heads[k].acc = it ? it.id : null; const sel = box.querySelector(`[data-ht="${k}"]`); if (sel) sel.disabled = !!it; }
      });
    });
    box.querySelectorAll('[data-ht]').forEach(s => s.onchange = () => { ST.heads[s.dataset.ht].type = s.value; });
  }
  const statusTxt = { ok: '', dup: 'Already in book', skip: 'Total / balance row', noamt: 'No amount', both: 'Both in and out filled', baddate: 'Date not understood' };
  function drawPrev() {
    const S = ST, box = $('#imprev'); if (!box) return;
    const sel = S.items.filter(x => x.on), inn = sel.reduce((s, x) => s + x.inn, 0), out = sel.reduce((s, x) => s + x.out, 0);
    const bad = S.items.filter(x => x.status !== 'ok').length, dup = S.items.filter(x => x.dup).length, closed = SET.lock_through ? sel.filter(x => x.date <= SET.lock_through).length : 0;
    box.innerHTML = `<div class="grid" style="margin:10px 0"><div class="stat"><div class="l">Rows to import</div><div class="v">${sel.length}</div><div class="s">${S.items.length} rows read</div></div>
      <div class="stat"><div class="l">Money in</div><div class="v" style="color:var(--ok)">${fmt(inn)}</div></div><div class="stat"><div class="l">Money out</div><div class="v" style="color:var(--bad)">${fmt(out)}</div></div>
      <div class="stat"><div class="l">Skipped / problems</div><div class="v">${bad + dup}</div><div class="s">${dup} already in book · ${bad} unreadable</div></div></div>
      ${closed ? `<div class="err" style="margin:0 0 8px">🔒 ${closed} row(s) are in a closed period. You will be asked for the lock password.</div>` : ''}
      <div class="wrap" style="max-height:300px;overflow:auto"><table class="tbl"><thead><tr><th><input type="checkbox" id="imall" ${sel.length && sel.length === S.items.filter(x => x.status === 'ok').length ? 'checked' : ''}></th><th>#</th><th>Date</th><th>Head</th><th>Party</th><th>Narration</th><th>Cheque</th><th class="n">In</th><th class="n">Out</th><th></th></tr></thead><tbody>
      ${S.items.slice(0, 300).map((x, i) => `<tr style="${x.status === 'ok' && !x.dup ? '' : 'opacity:.6'}"><td><input type="checkbox" data-r="${i}" ${x.on ? 'checked' : ''} ${x.status !== 'ok' ? 'disabled' : ''}></td><td>${x.n}</td><td>${x.date ? esc(fdate(x.date)) : `<span class="err">${esc(String(x.dateRaw))}</span>`}</td>
        <td>${esc(x.head)}${x.head && !matchHead(x.head) ? ' <span class="badge">new</span>' : ''}</td><td>${esc(x.party)}</td><td>${esc(x.narr)}</td><td>${esc(x.cheque)}</td><td class="n">${x.inn ? fmt(x.inn) : ''}</td><td class="n">${x.out ? fmt(x.out) : ''}</td>
        <td class="${x.dup || x.status !== 'ok' ? 'err' : ''}" style="margin:0">${x.dup ? statusTxt.dup : statusTxt[x.status]}</td></tr>`).join('') || '<tr><td colspan="10" class="muted">No rows found. Check the header row number and column matching above.</td></tr>'}</tbody></table></div>
      ${S.items.length > 300 ? `<div class="muted">Showing the first 300 of ${S.items.length} rows. All ticked rows are imported.</div>` : ''}
      <div class="actions" style="margin-top:12px"><button class="btn" id="imgo" ${sel.length ? '' : 'disabled'}>Import ${sel.length} row${sel.length === 1 ? '' : 's'}</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`;
    box.querySelectorAll('[data-r]').forEach(c => c.onchange = () => { S.items[+c.dataset.r].on = c.checked; drawPrev(); });
    $('#imall').onchange = e => { S.items.forEach(x => { if (x.status === 'ok') x.on = e.target.checked; }); drawPrev(); };
    $('#imgo').onclick = doImport;
  }
  function genCode(type, taken) {
    const d = { asset: 1, liability: 2, equity: 3, income: 4, expense: 5 }[type] || 5, nums = [...ACC.map(a => a.code), ...taken].filter(c => /^\d+$/.test(c) && c[0] === String(d));
    let n = nums.length ? Math.max(...nums.map(Number)) + 10 : d * 1000 + 10; while (nums.includes(String(n))) n++; return String(n);
  }
  async function doImport() {
    const S = ST, sel = S.items.filter(x => x.on); if (!sel.length) return;
    if (!S.fb.pay && sel.some(x => x.out && !x.head && !x.hk) || !S.fb.rec && sel.some(x => x.inn && !x.head && !x.hk)) { $('#imer').textContent = 'Choose the fallback accounts for rows that have no head.'; return; }
    const taken = [], newAcc = [];
    Object.entries(S.heads).forEach(([k, h]) => { if (!h.acc && sel.some(x => x.hk === k)) { const code = genCode(h.type, taken); taken.push(code); newAcc.push({ key: k, name: h.text.slice(0, 120), type: h.type, code }); } });
    const rows = sel.map(x => {
      const counter = x.acc || (x.hk && S.heads[x.hk] && S.heads[x.hk].acc) || (!x.head ? (x.inn ? S.fb.rec : S.fb.pay) : null);
      return { vdate: x.date, side: x.inn ? 'in' : 'out', amount: x.inn || x.out, counter: counter || null, new_key: counter ? null : x.hk, party: x.party, narration: x.narr || x.head, cheque_no: x.cheque, ref: x.ref };
    });
    $('#imgo').disabled = true; $('#imgo').textContent = 'Importing…';
    try {
      const r = await lockApi('/api/import/vouchers', { method: 'POST', body: { account_id: S.acc, rows, new_accounts: newAcc } });
      await loadAcc(); closeModal(); toast(`Imported ${r.created} voucher${r.created === 1 ? '' : 's'}${r.accounts ? ` and created ${r.accounts} new account${r.accounts === 1 ? '' : 's'}` : ''}`);
      if (S.onDone) S.onDone();
    } catch (e) { if ($('#imer')) { $('#imer').textContent = e.message; $('#imgo').disabled = false; $('#imgo').textContent = `Import ${sel.length} rows`; } else toast(e.message, true); }
  }
  window.FAUtil = { parseDate, parseAmt, parseCsv, sheetRows, loadXlsx, readAs, norm, letters };   // shared with the Bank Reconciliation tab
  window.importWizard = begin;
  window.__imHandleFile = handleFile;   // used by the automatic tests
})();
