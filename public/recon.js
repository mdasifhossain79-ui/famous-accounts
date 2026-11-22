/* Bank Reconciliation (separate, read-only).
   Reads a bank statement (PDF, Excel or CSV), matches it with the Bank Book and prints the reconciliation report.
   It only READS accounts and bank-book rows. It never creates or changes vouchers, cleared dates or any other data. */
(function () {
  const U = window.FAUtil, $ = s => document.querySelector(s);
  const norm = U.norm;
  const f2 = n => Math.round(Number(n || 0) * 100) / 100;
  const dayDiff = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5);
  const addDays = (s, n) => { const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) + n * 864e5); return d.toISOString().slice(0, 10); };
  const chq = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');

  // ================= reading the statement =================
  let pdfP = null;
  const loadPdfjs = () => window.pdfjsLib ? Promise.resolve() : (pdfP = pdfP || new Promise((res, rej) => {
    const s = document.createElement('script'); s.src = 'vendor/pdf.min.js';
    s.onload = () => { pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js'; res(); };
    s.onerror = () => rej(new Error('The PDF reader could not be loaded')); document.head.appendChild(s);
  }));
  const AMT = /^[\(\-]?(\d{1,3}(,\d{2,3})*|\d+)(\.\d{1,2})?\)?(\s?(dr|cr)\.?)?$/i;
  const isAmt = t => { const s = t.replace(/\s/g, ''); return AMT.test(s) && (/[.,]/.test(s) || false); };
  function fieldOf(k) {
    if (/value.*date|valdate/.test(k)) return 'vdate';
    if (/date|^dt$/.test(k)) return 'date';
    if (/chq|cheque|check|instrument/.test(k)) return 'cheque';
    if (/withdraw|debit|^dr$|paidout|moneyout/.test(k)) return 'out';
    if (/deposit|credit|^cr$|paidin|moneyin/.test(k)) return 'in';
    if (/balance|^bal$/.test(k)) return 'balance';
    if (/descr|particular|narrat|detail|remark/.test(k)) return 'desc';
    if (/^amount$|^amt$/.test(k)) return 'amount';
    return null;
  }
  const numField = f => ['out', 'in', 'balance', 'amount'].includes(f);
  async function pdfLines(file) {
    await loadPdfjs();
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await U.readAs(file, 'buf')) }).promise;
    const lines = []; let any = false;
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      const its = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: i.str.trim(), x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 9 }));
      if (its.length) any = true;
      its.sort((a, b) => b.y - a.y || a.x - b.x);
      let cur = null;
      for (const it of its) { if (!cur || Math.abs(it.y - cur.y) > Math.max(2.5, it.h * 0.45)) { cur = { y: it.y, p, items: [] }; lines.push(cur); } cur.items.push(it); }
    }
    lines.forEach(l => {
      l.items.sort((a, b) => a.x - b.x); const toks = [];
      for (const it of l.items) { const last = toks[toks.length - 1], gap = last ? it.x - last.x1 : 1e9; if (last && gap < Math.max(3, it.h * 0.55)) { last.s += (gap > it.h * 0.12 ? ' ' : '') + it.s; last.x1 = it.x + it.w; } else toks.push({ s: it.s, x0: it.x, x1: it.x + it.w }); }
      l.toks = toks;
    });
    return { lines, any };
  }
  const isHeader = l => { const f = new Set(); l.toks.forEach(t => { const k = fieldOf(norm(t.s)); if (k) f.add(k); }); return f.size >= 3 && (f.has('date') || f.has('vdate')); };
  function rowsFromHeader(lines) {
    const hi = lines.findIndex(isHeader); if (hi < 0) return null;
    // header cells may wrap onto the lines just above / below the main header line ("Instrument" / "No.")
    const near = (i, ds) => ds.map(d => lines[i + d]).filter(l => l && l.p === lines[i].p && Math.abs(l.y - lines[i].y) <= 26 && l.toks.length <= 5 && !l.toks.some(t => isAmt(t.s) || U.parseDate(t.s) || t.s.length > 24));
    const H = lines[hi], skip = new Set(), cols = H.toks.map(t => ({ name: t.s, x0: t.x0, x1: t.x1 }));
    const extra = near(hi, [-1, 1, -2, 2]), pieces = []; extra.forEach(l => { skip.add(l); l.toks.forEach(t => pieces.push({ t, above: l.y > H.y })); });
    const ovl = (a, b) => a.x0 <= b.x1 + 6 && a.x1 >= b.x0 - 6, used = new Set();
    pieces.forEach((pc, i) => { const c = cols.find(c => ovl(c, pc.t)); if (c) { c.name = pc.above ? pc.t.s + ' ' + c.name : c.name + ' ' + pc.t.s; c.x0 = Math.min(c.x0, pc.t.x0); c.x1 = Math.max(c.x1, pc.t.x1); used.add(i); } });
    pieces.forEach((pc, i) => { if (used.has(i)) return; const mate = pieces.findIndex((q, j) => j !== i && !used.has(j) && ovl(pc.t, q.t) && q.above !== pc.above); if (mate < 0) return; const [a, b] = pc.above ? [pc, pieces[mate]] : [pieces[mate], pc], name = a.t.s + ' ' + b.t.s; if (fieldOf(norm(name))) { cols.push({ name, x0: Math.min(a.t.x0, b.t.x0), x1: Math.max(a.t.x1, b.t.x1) }); used.add(i); used.add(mate); } });
    cols.sort((a, b) => a.x0 - b.x0); cols.forEach(c => { c.c = (c.x0 + c.x1) / 2; c.f = fieldOf(norm(c.name)); });
    for (let i = hi + 1; i < lines.length; i++) if (isHeader(lines[i])) { skip.add(lines[i]); near(i, [-1, 1, -2, 2]).forEach(l => skip.add(l)); }   // header repeated on every page
    const colOf = t => {
      if (isAmt(t.s)) {
        let best = null, bd = 1e9;
        for (const c of cols.filter(c => numField(c.f))) { const d = Math.min(Math.abs(t.x1 - c.x1), Math.abs((t.x0 + t.x1) / 2 - c.c), Math.abs(t.x0 - c.x0)); if (d < bd) { bd = d; best = c; } }
        if (best && bd < 70) return best;
      }
      let b = cols[0]; for (const c of cols) if (c.x0 <= t.x0 + 6) b = c; return b;
    };
    const dIdx = Math.max(0, cols.findIndex(c => c.f === 'date')), META = /^(total|grand total|closing balance|opening balance|balance b\/f|balance c\/f|carried forward|brought forward|page \d|this is a|end of)/;
    const data = lines.slice(hi + 1).filter(l => !skip.has(l));
    data.forEach(l => { l.cells = cols.map(() => []); l.toks.forEach(t => l.cells[cols.indexOf(colOf(t))].push(t)); l.date = U.parseDate(l.cells[dIdx].map(t => t.s).join(' ')); l.num = l.toks.some(t => isAmt(t.s)); l.meta = !l.date && META.test(l.toks.map(t => t.s).join(' ').toLowerCase()); });
    const anchors = data.filter(l => l.date), groups = new Map(anchors.map(a => [a, [a]])); let last = null;
    for (const l of data) {
      if (l.date) { last = l; continue; } if (l.meta || !anchors.length) continue;
      const same = anchors.filter(a => a.p === l.p), prev = same.filter(a => a.y > l.y).sort((a, b) => a.y - b.y)[0], next = same.filter(a => a.y < l.y).sort((a, b) => b.y - a.y)[0];
      const dP = prev ? prev.y - l.y : 1e9, dN = next ? l.y - next.y : 1e9; let pick = null;
      if (prev && !next) pick = prev; else if (next && !prev) pick = last && last.p < l.p && dN > 14 ? last : next;
      else if (prev && next) pick = l.num ? (dN <= dP ? next : prev) : (dP <= 18 || dP <= dN ? prev : next);
      else pick = last;
      const dist = pick === prev ? dP : pick === next ? dN : 0; if (!pick || dist > 45) continue;
      groups.get(pick).push(l);
    }
    const rows = [cols.map(c => c.name)];
    anchors.forEach(a => { const cells = cols.map(() => []); groups.get(a).sort((x, y) => x.p - y.p || y.y - x.y).forEach(l => l.cells.forEach((arr, k) => arr.forEach(t => cells[k].push(t.s)))); rows.push(cells.map(arr => arr.join(' '))); });
    return rows;
  }
  function rowsGeneric(lines) {   // no header text found: split dated lines into columns by position
    const dl = lines.filter(l => l.toks.length && U.parseDate(l.toks[0].s)); if (!dl.length) return null;
    const cl = (vals, gap) => { const v = [...vals].sort((a, b) => a - b), out = []; v.forEach(x => { if (!out.length || x - out[out.length - 1].max > gap) out.push({ min: x, max: x, sum: x, n: 1 }); else { const c = out[out.length - 1]; c.max = x; c.sum += x; c.n++; } }); return out.map(c => c.sum / c.n); };
    const txtX = [], numX = []; dl.forEach(l => l.toks.forEach(t => (isAmt(t.s) ? numX.push(t.x1) : txtX.push(t.x0))));
    const cols = [...cl(txtX, 22).map(x => ({ x, num: false })), ...cl(numX, 10).map(x => ({ x, num: true }))].sort((a, b) => a.x - b.x);
    const rows = [cols.map((c, i) => 'Col ' + U.letters(i))];
    dl.forEach(l => { const cells = cols.map(() => []); l.toks.forEach(t => { let bi = 0, bd = 1e9; cols.forEach((c, i) => { if (c.num !== isAmt(t.s)) return; const d = Math.abs((c.num ? t.x1 : t.x0) - c.x); if (d < bd) { bd = d; bi = i; } }); cells[bi].push(t.s); }); rows.push(cells.map(a => a.join(' '))); });
    return rows;
  }
  async function readStatement(file) {
    const n = file.name.toLowerCase();
    if (/\.pdf$/.test(n)) {
      const { lines, any } = await pdfLines(file);
      if (!any) throw new Error('This PDF has no selectable text (it looks like a scanned picture). Please ask the bank for a text PDF or an Excel / CSV statement.');
      const rows = rowsFromHeader(lines) || rowsGeneric(lines);
      if (!rows || rows.length < 2) throw new Error('No transaction table could be found in this PDF. Try the Excel / CSV statement from the bank.');
      return rows;
    }
    if (/\.(csv|txt)$/.test(n)) return U.parseCsv((await U.readAs(file, 'text')).replace(/^\ufeff/, ''));
    await U.loadXlsx(); const wb = XLSX.read(await U.readAs(file, 'buf'), { type: 'array', cellDates: true });
    const rows = U.sheetRows(wb.Sheets[wb.SheetNames[0]]); return rows;
  }
  function findHeaderRow(rows) {
    let best = 0, bi = 0;
    for (let i = 0; i < Math.min(rows.length, 30); i++) { const f = new Set(rows[i].map(c => fieldOf(norm(c))).filter(Boolean)); if ((f.has('date') || f.has('vdate')) && f.size > best) { best = f.size; bi = i; } }
    return bi;
  }
  function autoMap(hdr) {
    const m = { date: -1, vdate: -1, desc: -1, cheque: -1, out: -1, in: -1, amount: -1, balance: -1 };
    hdr.forEach((h, i) => { const f = fieldOf(norm(h)); if (f && m[f] < 0) m[f] = i; });
    if (m.date < 0 && m.vdate >= 0) m.date = m.vdate;
    if (m.out >= 0 || m.in >= 0) m.amount = -1;
    return m;
  }
  function parseBal(v) {
    const t = String(v == null ? '' : v).trim(); if (!t) return null;
    let n = U.parseAmt(t.replace(/\s*(dr|cr)\.?$/i, '')); if (/dr\.?$/i.test(t)) n = -Math.abs(n); return n;
  }

  // ================= state =================
  const R = { acc: '', file: '', rows: [], hdr: 0, map: {}, swap: false, items: [], autoOpen: null, autoClose: null, openIn: '', closeIn: '', asOf: '', bookFrom: '', tol: 7, skipCleared: true,
    book: null, bookKey: '', manual: [], block: new Set(), sel: { s: new Set(), b: new Set() }, out: null };

  function evalStatement() {
    const items = []; let openMeta = null;
    for (let i = R.hdr + 1; i < R.rows.length; i++) {
      const r = R.rows[i], g = k => (R.map[k] >= 0 ? r[R.map[k]] : '');
      const date = U.parseDate(g('date')) || U.parseDate(g('vdate')); let desc = String(g('desc') || '').replace(/\s+/g, ' ').trim();
      let inn = Math.abs(U.parseAmt(g('in'))), out = Math.abs(U.parseAmt(g('out')));
      if (R.map.amount >= 0 && !inn && !out) { let a = U.parseAmt(g('amount')); if (R.swap) a = -a; if (a > 0) inn = a; else if (a < 0) out = -a; }
      else if (R.swap) [inn, out] = [out, inn];
      const bal = parseBal(g('balance'));
      let cheque = String(g('cheque') || '').trim();
      if (!cheque) { const m = desc.match(/(?:chq|cheque|check|instrument)\s*(?:no\.?|number|#)?\s*[:#-]?\s*(\d{4,})/i); if (m) cheque = m[1]; }
      if (!date && !inn && !out && !desc) continue;
      if (/opening|brought forward|b\/f|balance b/i.test(desc) && bal != null && !inn && !out) { openMeta = bal; continue; }
      if (/^(total|grand total|closing balance|carried forward|page \d)/i.test(desc) && !date) continue;
      const ok = !!date && (inn > 0 || out > 0) && !(inn > 0 && out > 0);
      items.push({ n: i + 1, date, dateRaw: g('date'), desc, cheque, inn: f2(inn), out: f2(out), bal, ok });
    }
    R.items = items;
    const ok = items.filter(x => x.ok), asc = !(ok.length > 1 && ok[0].date > ok[ok.length - 1].date), ord = asc ? ok : ok.slice().reverse();
    const lastB = ord.slice().reverse().find(x => x.bal != null), firstB = ord.find(x => x.bal != null);
    R.autoClose = lastB ? lastB.bal : null;
    R.autoOpen = openMeta != null ? openMeta : (firstB ? f2(firstB.bal - firstB.inn + firstB.out) : null);
    const ds = ok.map(x => x.date).sort(); R.stmtFrom = ds[0] || ''; R.stmtTo = ds[ds.length - 1] || '';
  }
  const openBal = () => (R.openIn !== '' ? U.parseAmt(R.openIn) : R.autoOpen);
  const closeBal = () => (R.closeIn !== '' ? U.parseAmt(R.closeIn) : R.autoClose);

  async function loadBook() {
    const key = R.acc + '|' + R.asOf; if (R.bookKey === key && R.book) return;
    R.book = await api(`/api/book/${R.acc}?from=1900-01-01&to=${R.asOf}`); R.bookKey = key;   // read only
    try { R.transit = (await api('/api/transfers?status=in_transit&account=' + R.acc)).rows; } catch (e) { R.transit = []; }   // read only: transfers sent but not yet received
  }

  // ================= matching =================
  function reconcile() {
    const S = R.items.filter(x => x.ok && x.date <= R.asOf).map((x, i) => ({ ...x, id: i, side: x.inn ? 'in' : 'out', amt: x.inn || x.out }));
    const start = R.stmtFrom || R.asOf;
    const B = R.book.rows.filter(r => r.vdate >= R.bookFrom && r.vdate <= R.asOf && !(R.skipCleared && r.cleared_on && r.cleared_on < start))
      .map(r => ({ id: r.line_id, date: r.vdate, side: r.debit > 0 ? 'in' : 'out', amt: f2(r.debit > 0 ? r.debit : r.credit), cheque: r.cheque_no || '', no: r.voucher_no, vid: r.voucher_id, party: r.party || '', narr: r.narration || '', counter: r.counter || '', tr: r.transfer_no || (r.vtype === 'CT' ? 'Contra' : '') }));
    const sById = Object.fromEntries(S.map(s => [s.id, s])), bById = Object.fromEntries(B.map(b => [b.id, b]));
    const usedS = new Set(), usedB = new Set(), matches = [];
    R.manual = R.manual.filter(m => m.s.every(i => sById[i]) && m.b.every(i => bById[i]));
    R.manual.forEach(m => { m.s.forEach(i => usedS.add(i)); m.b.forEach(i => usedB.add(i)); matches.push({ s: m.s, b: m.b, how: 'manual' }); });
    const find = (s, cond) => { let best = null, bd = 1e9; for (const b of B) { if (usedB.has(b.id) || b.side !== s.side || Math.abs(b.amt - s.amt) > 0.004 || R.block.has(s.id + '|' + b.id) || !cond(b)) continue; const d = Math.abs(dayDiff(b.date, s.date)); if (d < bd) { bd = d; best = b; } } return best; };
    const link = (s, b, how) => { usedS.add(s.id); usedB.add(b.id); matches.push({ s: [s.id], b: [b.id], how }); };
    for (const s of S) { if (usedS.has(s.id) || !chq(s.cheque)) continue; const b = find(s, b => chq(b.cheque) && chq(b.cheque) === chq(s.cheque)); if (b) link(s, b, 'cheque no'); }
    for (const s of S) { if (usedS.has(s.id)) continue; const b = find(s, b => b.date === s.date); if (b) link(s, b, 'same date'); }
    for (const s of S) { if (usedS.has(s.id)) continue; const b = find(s, b => Math.abs(dayDiff(b.date, s.date)) <= R.tol); if (b) link(s, b, 'within ' + R.tol + ' days'); }
    const uS = S.filter(s => !usedS.has(s.id)), uB = B.filter(b => !usedB.has(b.id));
    const sum = (a, side) => f2(a.filter(x => x.side === side).reduce((t, x) => t + x.amt, 0));
    const bookBal = f2(R.book.closing), stmtBal = closeBal();
    const P = sum(uB, 'out'), D = sum(uB, 'in'), C = sum(uS, 'in'), W = sum(uS, 'out');
    const expected = f2(bookBal + P - D + C - W), diff = stmtBal == null ? null : f2(stmtBal - expected);
    R.out = { S, B, sById, bById, matches, uS, uB, bookBal, stmtBal, P, D, C, W, expected, diff, outstanding: uB.filter(b => b.side === 'out'), transit: uB.filter(b => b.side === 'in'), bankIn: uS.filter(s => s.side === 'in'), bankOut: uS.filter(s => s.side === 'out') };
  }

  // ================= screen =================
  const money2 = n => fmt(n);
  const trBadge = b => (b && b.tr ? ` <span class="badge" title="Inter-account transfer">${esc(b.tr)}</span>` : '');
  const acct = () => ACC.find(a => String(a.id) === String(R.acc)) || {};
  const colSel = (k, label) => `<div><label>${label}</label><select data-m="${k}"><option value="-1">— none —</option>${(R.rows[R.hdr] || []).map((h, i) => `<option value="${i}" ${R.map[k] === i ? 'selected' : ''}>${U.letters(i)} · ${esc(String(h).slice(0, 26))}</option>`).join('')}</select></div>`;
  window.vRecon = async function () {
    head('Bank Reconciliation');
    const banks = ACC.filter(a => a.kind === 'bank' && a.active);
    if (!R.acc || !banks.find(a => String(a.id) === String(R.acc))) R.acc = banks[0] ? banks[0].id : '';
    $('#view').innerHTML = `<h2>Bank Reconciliation</h2>
      <div class="card"><p class="muted" style="margin-top:0">Upload your bank statement (PDF, Excel or CSV). The app matches it with your Bank Book and prepares a reconciliation report with cleared items, uncleared cheques and the difference. <b>This page only reads your data. It does not change any voucher, the Bank Book or any other section.</b></p>
      ${banks.length ? `<div class="row"><div class="grow"><label>Bank account (as in your Bank Book)</label><select id="rca">${banks.map(a => `<option value="${a.id}" ${String(a.id) === String(R.acc) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
        <div class="grow"><label>Bank statement file</label><input type="file" id="rcf" accept=".pdf,.xlsx,.xls,.csv,.txt"></div></div><div id="rcmsg" class="err"></div>` : '<p>Add a bank account first: Chart of Accounts > + New bank account.</p>'}</div>
      <div id="rcmap"></div><div id="rcres"></div>`;
    if (!banks.length) return;
    $('#rca').onchange = async () => { R.acc = $('#rca').value; R.manual = []; R.block = new Set(); R.sel = { s: new Set(), b: new Set() }; if (R.rows.length) await refresh(); };
    $('#rcf').onchange = () => handleFile($('#rcf').files[0]);
    if (R.rows.length) { drawMap(); await refresh(); }
  };
  async function handleFile(file) {
    if (!file) return;
    const msg = $('#rcmsg'); if (msg) msg.textContent = '';
    try {
      if (msg) { msg.className = 'muted'; msg.textContent = 'Reading ' + file.name + '…'; }
      R.rows = await readStatement(file); R.file = file.name; R.hdr = findHeaderRow(R.rows); R.map = autoMap(R.rows[R.hdr] || []);
      R.swap = false; R.tol = 7; R.skipCleared = true; R.openIn = ''; R.closeIn = ''; R.manual = []; R.block = new Set(); R.sel = { s: new Set(), b: new Set() };
      evalStatement(); R.asOf = R.stmtTo || today(); R.bookFrom = addDays(R.stmtFrom || R.asOf, -180);
      if (msg) { msg.className = 'err'; msg.textContent = ''; }
      drawMap(); await refresh();
    } catch (e) { if (msg) { msg.className = 'err'; msg.textContent = e.message; } else toast(e.message, true); }
  }
  function drawMap() {
    const box = $('#rcmap'); if (!box) return;
    box.innerHTML = `<div class="card"><h3>1. Statement read from <b>${esc(R.file)}</b></h3>
      <div class="row"><div><label>Header row no.</label><input type="number" min="1" id="rchr" value="${R.hdr + 1}" style="width:90px"></div>
        ${colSel('date', 'Date')}${colSel('desc', 'Description')}${colSel('cheque', 'Cheque no')}${colSel('out', 'Debit / Withdrawal (money out)')}${colSel('in', 'Credit / Deposit (money in)')}${colSel('amount', 'Single amount column')}${colSel('balance', 'Balance')}</div>
      <div class="row"><label><input type="checkbox" id="rcsw" ${R.swap ? 'checked' : ''}> Swap money in / out (tick only if the money-out column of your file is really money coming in)</label></div>
      <div id="rcchk"></div></div>
      <div class="card"><h3>2. Reconcile as on</h3><div class="row"><div><label>As on date</label><input type="date" id="rcas" value="${R.asOf}"></div>
        <div><label>Include Bank Book entries from</label><input type="date" id="rcbf" value="${R.bookFrom}"></div>
        <div><label>Date tolerance (days)</label><input type="number" min="0" max="60" id="rctl" value="${R.tol}" style="width:90px"></div>
        <div><label>Opening balance per statement</label><input type="number" step="0.01" id="rcop" value="${R.openIn !== '' ? esc(R.openIn) : (R.autoOpen != null ? R.autoOpen : '')}" style="width:150px"></div>
        <div><label>Closing balance per statement</label><input type="number" step="0.01" id="rccl" value="${R.closeIn !== '' ? esc(R.closeIn) : (R.autoClose != null ? R.autoClose : '')}" style="width:150px"></div></div>
      <div class="row"><label><input type="checkbox" id="rcsk" ${R.skipCleared ? 'checked' : ''}> Leave out Bank Book entries already marked cleared before this statement started</label></div></div>`;
    $('#rchr').onchange = async () => { R.hdr = Math.max(0, (+$('#rchr').value || 1) - 1); R.map = autoMap(R.rows[R.hdr] || []); evalStatement(); R.openIn = R.closeIn = ''; R.manual = []; drawMap(); await refresh(); };
    box.querySelectorAll('[data-m]').forEach(s => s.onchange = async () => { R.map[s.dataset.m] = +s.value; evalStatement(); R.manual = []; R.block = new Set(); drawChk(); await refresh(); });
    $('#rcsw').onchange = async () => { R.swap = $('#rcsw').checked; evalStatement(); R.manual = []; R.block = new Set(); drawChk(); await refresh(); };
    const rc = async () => { R.asOf = $('#rcas').value; R.bookFrom = $('#rcbf').value; R.tol = Math.max(0, +$('#rctl').value || 0); R.openIn = $('#rcop').value; R.closeIn = $('#rccl').value; R.skipCleared = $('#rcsk').checked; drawChk(); await refresh(); };
    ['#rcas', '#rcbf', '#rctl', '#rcop', '#rccl', '#rcsk'].forEach(i => { $(i).onchange = rc; });
    drawChk();
  }
  function drawChk() {
    const box = $('#rcchk'); if (!box) return;
    const ok = R.items.filter(x => x.ok), bad = R.items.filter(x => !x.ok).length, inn = f2(ok.reduce((s, x) => s + x.inn, 0)), out = f2(ok.reduce((s, x) => s + x.out, 0));
    const o = openBal(), c = closeBal(), chk = o != null && c != null ? f2(o + inn - out - c) : null;
    box.innerHTML = `<div class="grid" style="margin-top:8px"><div class="stat"><div class="l">Transactions read</div><div class="v">${ok.length}</div><div class="s">${bad ? bad + ' row(s) not understood' : 'all rows understood'}</div></div>
      <div class="stat"><div class="l">Money in (credits)</div><div class="v" style="color:var(--ok)">${money2(inn)}</div></div><div class="stat"><div class="l">Money out (debits)</div><div class="v" style="color:var(--bad)">${money2(out)}</div></div>
      <div class="stat"><div class="l">Statement check</div><div class="v">${chk == null ? '—' : (Math.abs(chk) < 0.005 ? '<span class="badge ok">Opening + in − out = closing</span>' : '<span class="badge bad">Off by ' + money2(chk) + '</span>')}</div><div class="s">${chk != null && Math.abs(chk) >= 0.005 ? 'Some rows may be missing or misread. Check the column matching.' : ''}</div></div></div>
      <details style="margin-top:6px"><summary class="muted" style="cursor:pointer">Show the first rows read</summary><div class="wrap"><table class="tbl"><thead><tr><th>#</th><th>Date</th><th>Description</th><th>Cheque</th><th class="n">Out</th><th class="n">In</th><th class="n">Balance</th></tr></thead><tbody>
      ${R.items.slice(0, 12).map(x => `<tr style="${x.ok ? '' : 'opacity:.5'}"><td>${x.n}</td><td>${x.date ? esc(fdate(x.date)) : '<span class="err">' + esc(x.dateRaw) + '</span>'}</td><td>${esc(x.desc)}</td><td>${esc(x.cheque)}</td><td class="n">${x.out ? fmt(x.out) : ''}</td><td class="n">${x.inn ? fmt(x.inn) : ''}</td><td class="n">${x.bal != null ? fmt(x.bal) : ''}</td></tr>`).join('')}</tbody></table></div></details>`;
  }
  async function refresh() {
    const res = $('#rcres'); if (!res || !R.rows.length) return;
    if (!R.asOf) { res.innerHTML = '<div class="card err">Choose the “as on” date.</div>'; return; }
    try { await loadBook(); reconcile(); drawRes(); } catch (e) { res.innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  }
  const rowChk = (kind, id, on) => `<input type="checkbox" data-${kind}="${id}" ${on ? 'checked' : ''}>`;
  function drawRes() {
    const O = R.out, a = acct(), sel = R.sel, res = $('#rcres');
    const ok = O.diff != null && Math.abs(O.diff) < 0.005;
    const bookRow = b => `<td>${esc(fdate(b.date))}</td><td>${esc(b.no)}</td><td>${esc(b.cheque)}</td><td>${esc(b.party || b.narr || b.counter)}</td>`;
    const matchRows = O.matches.map((m, i) => { const ss = m.s.map(x => O.sById[x]), bb = m.b.map(x => O.bById[x]); return `<tr><td>${bb.map(b => esc(fdate(b.date))).join('<br>')}</td><td>${bb.map(b => esc(b.no) + trBadge(b)).join('<br>')}</td><td>${bb.map(b => esc(b.cheque)).join('<br>')}</td><td>${bb.map(b => esc(b.party || b.narr || b.counter)).join('<br>')}</td><td>${ss.map(s => esc(fdate(s.date))).join('<br>')}</td><td>${ss.map(s => esc(s.desc.slice(0, 40))).join('<br>')}</td><td class="n">${fmt(Math.abs(bb.reduce((t, b) => t + (b.side === 'in' ? b.amt : -b.amt), 0)))}</td><td><span class="badge">${esc(m.how)}</span> <button class="btn ghost sm" data-um="${i}">Unmatch</button></td></tr>`; }).join('');
    const tList = R.transit || [], transitCard = !tList.length ? '' : `<div class="card"><h3>Transfers in transit involving this account (${tList.length})</h3><div class="muted" style="margin-bottom:8px">Money sent between your own accounts that is not yet marked received. This table is for information; it does not change the reconciliation above.</div><div class="wrap"><table class="tbl"><thead><tr><th>Sent</th><th>Transfer</th><th>Direction</th><th>Other account</th><th class="n">Amount</th><th>Note</th></tr></thead><tbody>${tList.map(t => { const inc = String(t.to_account_id) === String(R.acc), seen = inc && O.bankIn.some(x => Math.abs(x.amt - t.amount) < 0.005); return `<tr><td>${esc(fdate(t.sent_date))}</td><td>${esc(t.transfer_no)}</td><td>${inc ? 'Coming in' : 'Going out'}</td><td>${esc(inc ? t.from_name : t.to_name)}</td><td class="n">${fmt(t.amount)}</td><td>${inc ? (seen ? '<span class="badge ok">The bank statement already shows a credit of this amount</span> — open Transfer Register → In transit and press “Mark received”.' : 'Not in this Bank Book until it is marked received.') : 'Already deducted in this Bank Book; it stays under “cheques issued but not cleared” until the bank pays it.'}</td></tr>`; }).join('')}</tbody></table></div></div>`;
    res.innerHTML = `<div class="card"><h3>3. Reconciliation statement — ${esc(a.name || '')} as on ${esc(fdate(R.asOf))}</h3>
      <div class="grid"><div class="stat"><div class="l">Balance per Bank Book</div><div class="v">${money2(O.bookBal)}</div></div><div class="stat"><div class="l">Balance per Bank Statement</div><div class="v">${O.stmtBal == null ? '—' : money2(O.stmtBal)}</div></div>
        <div class="stat"><div class="l">Difference</div><div class="v">${O.diff == null ? '—' : `<span class="badge ${ok ? 'ok' : 'bad'}" style="font-size:16px">${ok ? 'Reconciled ✔' : money2(O.diff)}</span>`}</div></div>
        <div class="stat"><div class="l">Matched / Unmatched</div><div class="v">${O.matches.length} / ${O.uS.length + O.uB.length}</div></div></div>
      <div class="wrap"><table class="tbl"><tbody>
        <tr><td><b>Balance as per Bank Book</b></td><td class="n"><b>${money2(O.bookBal)}</b></td></tr>
        <tr><td>Add: Cheques issued but not yet cleared by the bank (${O.outstanding.length})</td><td class="n">${money2(O.P)}</td></tr>
        <tr><td>Less: Deposits not yet credited by the bank (${O.transit.length})</td><td class="n">(${money2(O.D)})</td></tr>
        <tr><td>Add: Credits in the bank statement not in the Bank Book (${O.bankIn.length})</td><td class="n">${money2(O.C)}</td></tr>
        <tr><td>Less: Debits in the bank statement not in the Bank Book (${O.bankOut.length})</td><td class="n">(${money2(O.W)})</td></tr>
        <tr class="tot"><td>Expected balance as per Bank Statement</td><td class="n">${money2(O.expected)}</td></tr>
        <tr><td>Balance as per Bank Statement</td><td class="n">${O.stmtBal == null ? '—' : money2(O.stmtBal)}</td></tr>
        <tr class="tot"><td>Difference</td><td class="n" style="color:var(--${ok ? 'ok' : 'bad'})">${O.diff == null ? '—' : money2(O.diff)}</td></tr></tbody></table></div>
      ${O.diff != null && !ok ? '<p class="muted" style="margin-bottom:0">A difference means some item is missing or not matched. Try an earlier “Include Bank Book entries from” date, a larger date tolerance, or match items by hand below.</p>' : ''}
      <div class="actions noprint" style="margin-top:10px"><button class="btn" id="rcpr">🖨 Print preview</button><button class="btn ghost" id="rccsv">Export CSV</button></div></div>
      ${transitCard}
      <div class="card"><h3>Not matched yet — tick items from both lists that belong together, then press Match</h3><div class="muted" style="margin-bottom:8px">Use this when one bank line covers several book entries (or the other way round). The totals must be equal.</div>
        <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(380px,1fr))"><div><b>Bank statement items</b><div class="wrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th></th><th>Date</th><th>Description</th><th class="n">Out</th><th class="n">In</th></tr></thead><tbody>
          ${O.uS.map(s => `<tr><td>${rowChk('ss', s.id, sel.s.has(s.id))}</td><td>${esc(fdate(s.date))}</td><td>${esc(s.desc.slice(0, 44))}${s.cheque ? ' · ' + esc(s.cheque) : ''}</td><td class="n">${s.side === 'out' ? fmt(s.amt) : ''}</td><td class="n">${s.side === 'in' ? fmt(s.amt) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing left</td></tr>'}</tbody></table></div></div>
          <div><b>Bank Book entries</b><div class="wrap" style="max-height:260px;overflow:auto"><table class="tbl"><thead><tr><th></th><th>Date</th><th>Voucher / cheque / party</th><th class="n">Out</th><th class="n">In</th></tr></thead><tbody>
          ${O.uB.map(b => `<tr><td>${rowChk('bb', b.id, sel.b.has(b.id))}</td><td>${esc(fdate(b.date))}</td><td>${esc(b.no)}${trBadge(b)}${b.cheque ? ' · ' + esc(b.cheque) : ''} ${esc(b.party || b.narr)}</td><td class="n">${b.side === 'out' ? fmt(b.amt) : ''}</td><td class="n">${b.side === 'in' ? fmt(b.amt) : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nothing left</td></tr>'}</tbody></table></div></div></div>
        <div class="actions" style="margin-top:8px"><button class="btn ghost" id="rcmm">Match ticked items</button></div></div>
      <div class="card"><h3>Cleared items (${O.matches.length})</h3><div class="wrap"><table class="tbl"><thead><tr><th>Book date</th><th>Voucher</th><th>Cheque</th><th>Party / narration</th><th>Bank date</th><th>Bank description</th><th class="n">Amount</th><th>Matched by</th></tr></thead><tbody>${matchRows || '<tr><td colspan="8" class="muted">No matches found</td></tr>'}</tbody></table></div></div>`;
    res.querySelectorAll('[data-ss]').forEach(c => c.onchange = () => { c.checked ? sel.s.add(+c.dataset.ss) : sel.s.delete(+c.dataset.ss); });
    res.querySelectorAll('[data-bb]').forEach(c => c.onchange = () => { c.checked ? sel.b.add(+c.dataset.bb) : sel.b.delete(+c.dataset.bb); });
    $('#rcmm').onclick = () => {
      const ss = [...sel.s].filter(i => O.sById[i]), bb = [...sel.b].filter(i => O.bById[i]);
      if (!ss.length || !bb.length) return toast('Tick at least one bank item and one Bank Book entry', true);
      const sv = f2(ss.reduce((t, i) => t + (O.sById[i].side === 'in' ? 1 : -1) * O.sById[i].amt, 0)), bv = f2(bb.reduce((t, i) => t + (O.bById[i].side === 'in' ? 1 : -1) * O.bById[i].amt, 0));
      if (Math.abs(sv - bv) > 0.004) return toast(`Totals differ: bank ${fmt(sv)} vs book ${fmt(bv)}`, true);
      R.manual.push({ s: ss, b: bb }); R.sel = { s: new Set(), b: new Set() }; refresh();
    };
    res.querySelectorAll('[data-um]').forEach(b => b.onclick = () => {
      const m = O.matches[+b.dataset.um];
      if (m.how === 'manual') R.manual = R.manual.filter(x => !(x.s.join() === m.s.join() && x.b.join() === m.b.join()));
      else m.s.forEach(s => m.b.forEach(bk => R.block.add(s + '|' + bk)));
      refresh();
    });
    $('#rcpr').onclick = async () => pvOpen({ title: 'Bank Reconciliation — ' + (a.name || '') + ' (' + fdate(R.asOf) + ')', key: 'recon', keyLabel: 'bank reconciliation reports', docs: [await reportDoc()] });
    $('#rccsv').onclick = exportCsv;
  }

  // ================= printed report =================
  async function reportDoc() {
    const O = R.out, a = acct(), c = await getCompany(), ok = O.diff != null && Math.abs(O.diff) < 0.005;
    const age = b => Math.max(0, dayDiff(R.asOf, b.date)), amt = fmt;
    const tbl = (title, head, rows, total, empty) => `<div class="pd-card mb"><div class="h"><span>${title}</span><span>${rows.length} item${rows.length === 1 ? '' : 's'}</span></div><table class="pd-tbl"><thead><tr>${head}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="9" class="muted">${empty}</td></tr>`}${total}</tbody></table></div>`;
    const line = (l, v, bold) => `<div class="ln"><span>${bold ? '<b>' + l + '</b>' : l}</span><span class="a">${bold ? '<b>' + v + '</b>' : v}</span></div>`;
    const body = `<div class="pd-band"><span>Bank: ${esc(a.name || '')}${a.account_no ? ' · A/C ' + esc(a.account_no) : ''}</span><span>As on: ${esc(fdate(R.asOf))}</span></div>
      <div class="pd-card mb"><div class="h"><span>Reconciliation statement</span><span>Tk.</span></div>
        ${line('Balance as per Bank Book', amt(O.bookBal), true)}${line(`Add: Cheques issued but not yet cleared by the bank (${O.outstanding.length})`, amt(O.P))}${line(`Less: Deposits not yet credited by the bank (${O.transit.length})`, '(' + amt(O.D) + ')')}
        ${line(`Add: Credits in the bank statement not in the Bank Book (${O.bankIn.length})`, amt(O.C))}${line(`Less: Debits in the bank statement not in the Bank Book (${O.bankOut.length})`, '(' + amt(O.W) + ')')}
        <div class="tt"><span>Expected balance as per Bank Statement</span><span>${amt(O.expected)}</span></div>${line('Balance as per Bank Statement', O.stmtBal == null ? '—' : amt(O.stmtBal))}</div>
      <div class="pd-net"><span class="l">Difference ${ok ? '(reconciled)' : ''}</span><span class="v" style="color:${ok ? '#12805c' : '#c62f3b'}">Tk. ${O.diff == null ? '—' : amt(O.diff)}</span></div>
      ${tbl('Uncleared cheques (issued, not yet presented to the bank)', '<th>Date</th><th>Cheque no</th><th>Voucher</th><th>Paid to / narration</th><th class="n">Age (days)</th><th class="n">Amount</th>', O.outstanding.map(b => `<tr><td>${esc(fdate(b.date))}</td><td>${esc(b.cheque)}</td><td>${esc(b.no)}</td><td>${esc(b.party || b.narr || b.counter)}</td><td class="n">${age(b)}${age(b) > 180 ? ' ⚠ stale' : ''}</td><td class="n">${amt(b.amt)}</td></tr>`), `<tr class="tot"><td colspan="5">Total uncleared cheques</td><td class="n">${amt(O.P)}</td></tr>`, 'None')}
      ${tbl('Deposits not yet credited by the bank', '<th>Date</th><th>Cheque no</th><th>Voucher</th><th>Received from / narration</th><th class="n">Amount</th>', O.transit.map(b => `<tr><td>${esc(fdate(b.date))}</td><td>${esc(b.cheque)}</td><td>${esc(b.no)}</td><td>${esc(b.party || b.narr || b.counter)}</td><td class="n">${amt(b.amt)}</td></tr>`), `<tr class="tot"><td colspan="4">Total deposits in transit</td><td class="n">${amt(O.D)}</td></tr>`, 'None')}
      ${tbl('Bank statement items not in the Bank Book', '<th>Date</th><th>Description</th><th>Cheque</th><th class="n">Debit (out)</th><th class="n">Credit (in)</th>', O.uS.map(s => `<tr><td>${esc(fdate(s.date))}</td><td>${esc(s.desc)}</td><td>${esc(s.cheque)}</td><td class="n">${s.side === 'out' ? amt(s.amt) : ''}</td><td class="n">${s.side === 'in' ? amt(s.amt) : ''}</td></tr>`), `<tr class="tot"><td colspan="3">Total</td><td class="n">${amt(O.W)}</td><td class="n">${amt(O.C)}</td></tr>`, 'None')}
      ${tbl('Cleared items (matched with the bank statement)', '<th>Book date</th><th>Voucher</th><th>Cheque</th><th>Party / narration</th><th>Bank date</th><th class="n">Amount</th>', O.matches.map(m => { const bb = m.b.map(x => O.bById[x]), ss = m.s.map(x => O.sById[x]); return `<tr><td>${bb.map(b => esc(fdate(b.date))).join('<br>')}</td><td>${bb.map(b => esc(b.no)).join('<br>')}</td><td>${bb.map(b => esc(b.cheque)).join('<br>')}</td><td>${bb.map(b => esc(b.party || b.narr || b.counter)).join('<br>')}</td><td>${ss.map(s => esc(fdate(s.date))).join('<br>')}</td><td class="n">${amt(Math.abs(bb.reduce((t, b) => t + (b.side === 'in' ? b.amt : -b.amt), 0)))}</td></tr>`; }), `<tr class="tot"><td colspan="5">Total cleared</td><td class="n">${amt(O.matches.reduce((t, m) => t + Math.abs(m.b.reduce((x, id) => x + (O.bById[id].side === 'in' ? O.bById[id].amt : -O.bById[id].amt), 0)), 0))}</td></tr>`, 'None')}
      <div class="pd-sign"><div>Prepared by</div><div>Checked by</div><div>Authorized Signature</div></div>`;
    return pdocSync(c, 'BANK RECONCILIATION', `${a.name || ''} · as on ${fdate(R.asOf)}`, body, { foot: 'Computer-generated reconciliation report.', dense: true });
  }
  function exportCsv() {
    const O = R.out, a = acct(), rows = [['Bank Reconciliation Statement', a.name, 'As on', R.asOf], [], ['Balance as per Bank Book', O.bookBal], ['Add: cheques issued not cleared', O.P], ['Less: deposits not credited', O.D], ['Add: bank credits not in book', O.C], ['Less: bank debits not in book', O.W], ['Expected balance', O.expected], ['Balance per bank statement', O.stmtBal], ['Difference', O.diff], [],
      ['UNCLEARED CHEQUES'], ['Date', 'Cheque', 'Voucher', 'Party / narration', 'Amount'], ...O.outstanding.map(b => [b.date, b.cheque, b.no, b.party || b.narr, b.amt]), [],
      ['DEPOSITS NOT YET CREDITED'], ['Date', 'Cheque', 'Voucher', 'Party / narration', 'Amount'], ...O.transit.map(b => [b.date, b.cheque, b.no, b.party || b.narr, b.amt]), [],
      ['BANK ITEMS NOT IN BOOK'], ['Date', 'Description', 'Cheque', 'Out', 'In'], ...O.uS.map(s => [s.date, s.desc, s.cheque, s.side === 'out' ? s.amt : '', s.side === 'in' ? s.amt : '']), [],
      ['CLEARED ITEMS'], ['Book date', 'Voucher', 'Cheque', 'Party / narration', 'Bank date', 'Amount', 'Matched by'], ...O.matches.map(m => { const bb = m.b.map(x => O.bById[x]), ss = m.s.map(x => O.sById[x]); return [bb.map(b => b.date).join(' '), bb.map(b => b.no).join(' '), bb.map(b => b.cheque).join(' '), bb.map(b => b.party || b.narr).join(' '), ss.map(s => s.date).join(' '), Math.abs(bb.reduce((t, b) => t + (b.side === 'in' ? b.amt : -b.amt), 0)), m.how]; })];
    csv(`bank-reconciliation-${R.asOf}.csv`, rows);
  }
  window.FABankRead = { readStatement, findHeaderRow, autoMap, fieldOf };   // reused by the Statement Analysis tab (bankanalysis.js)
  window.__reHandleFile = handleFile; window.__reState = R; window.__rePdfLines = pdfLines;   // used by the automatic tests
})();
