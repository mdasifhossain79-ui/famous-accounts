/* Detailed Bank Transaction Analysis (a tab inside Bank Reconciliation).
   The statement is read in the browser (public/recon.js reader); the server checks every row again and stores it exactly as imported.
   This tab only READS vouchers. It never creates or changes a voucher or a cleared date. */
(function () {
  const U = window.FAUtil, $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
  const tk = n => '৳' + fmt(n);
  const orig = window.vRecon;
  const BA = { tab: 'recon', sub: 'overview', f: { account_id: '', bank: '', branch: '', from: '', to: '', type: '' }, meta: null, tx: { q: '', category: '', status: '', sort: 'date', dir: 'desc', page: 1, per: 25 }, rc: { account_id: '', as_of: '', tol: 7, other: '', other_note: '' }, imp: null, cats: null };
  const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v != null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const SUBS = [['overview', 'Overview'], ['txns', 'Transactions'], ['credit', 'Credit Analysis'], ['debit', 'Debit Analysis'], ['cats', 'Categories & Rules'], ['unusual', 'Unusual Transactions'], ['recon', 'Reconciliation Summary'], ['tasks', 'Clear & Post Charges'], ['reports', 'Reports & Export']];
  const REVIEW = { new: 'New', reviewed: 'Reviewed', investigate: 'Needs investigation', accepted: 'Accepted', incorrect: 'Incorrect data' };
  const COLORS = ['#2563eb', '#16a34a', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#4f46e5', '#ca8a04', '#0d9488', '#ea580c', '#7c3aed', '#475569'];
  const bad = e => toast(e.message || String(e), true);
  const badge = (t, c) => `<span class="badge ${c || ''}">${esc(t)}</span>`;

  window.vRecon = async function () {
    if (BA.tab === 'analysis') return vAnalysis();
    await orig(); $('#view').insertAdjacentHTML('afterbegin', tabsHtml()); bindTabs();
  };
  const tabsHtml = () => `<div class="cqtabs noprint ba-top"><button data-t="recon" class="${BA.tab === 'recon' ? 'on' : ''}">Bank Reconciliation (match with books)</button><button data-t="analysis" class="${BA.tab === 'analysis' ? 'on' : ''}">Statement Analysis</button></div>`;
  const bindTabs = () => $$('.ba-top [data-t]').forEach(b => b.onclick = () => { BA.tab = b.dataset.t; window.vRecon(); });

  // ================= frame =================
  async function vAnalysis() {
    head('Bank Statement Analysis');
    try { BA.meta = await api('/api/ba/accounts'); } catch (e) { return bad(e); }
    $('#view').innerHTML = tabsHtml() + `<h2>Detailed Bank Transaction Analysis</h2><div class="ba-note"><b>Statement Analysis</b> checks the bank statement itself (its own arithmetic and what the money was for). <b>Bank Reconciliation</b> compares the statement with your books. A statement can be arithmetically correct and still not reconciled with your books.</div>
      <div class="cqtabs noprint" id="basub">${SUBS.map(([k, l]) => `<button data-k="${k}" class="${BA.sub === k ? 'on' : ''}">${l}</button>`).join('')}<button class="btn" id="baimp" style="margin-left:auto">⬆ Import statement</button></div><div id="bafilt"></div><div id="babody"></div>`;
    bindTabs(); $('#baimp').onclick = () => { BA.sub = 'import'; showSub(); };
    $$('#basub [data-k]').forEach(b => b.onclick = () => { BA.sub = b.dataset.k; showSub(); });
    showSub();
  }
  const FILTERED = ['overview', 'txns', 'credit', 'debit', 'unusual', 'reports'];
  function showSub() {
    $$('#basub [data-k]').forEach(b => b.classList.toggle('on', b.dataset.k === BA.sub));
    $('#bafilt').innerHTML = FILTERED.includes(BA.sub) ? filterBar() : '';
    if (FILTERED.includes(BA.sub)) bindFilter();
    const fn = { overview, txns, credit: () => catView('credit'), debit: () => catView('debit'), cats, unusual, recon, tasks, reports, import: importView }[BA.sub];
    $('#babody').innerHTML = '<p class="muted">Loading…</p>'; Promise.resolve(fn()).catch(bad);
  }
  function filterBar() {
    const m = BA.meta, f = BA.f, o = (list, v, ph) => `<option value="">${ph}</option>` + list.map(x => `<option value="${esc(x[0])}" ${String(x[0]) === String(v) ? 'selected' : ''}>${esc(x[1])}</option>`).join('');
    return `<div class="row ba-filt noprint"><div class="grow"><label>Bank account</label><select data-f="account_id">${o(m.accounts.map(a => [a.id, `${a.code} · ${a.name}${a.masked ? ' · ' + a.masked : ''}${a.imports ? '' : ' (no statement)'}`]), f.account_id, 'All accounts')}</select></div>
      <div><label>Bank</label><select data-f="bank">${o(m.banks.map(x => [x, x]), f.bank, 'All banks')}</select></div><div><label>Branch</label><select data-f="branch">${o(m.branches.map(x => [x, x]), f.branch, 'All branches')}</select></div>
      <div><label>From</label><input type="date" data-f="from" value="${f.from}"></div><div><label>To</label><input type="date" data-f="to" value="${f.to}"></div>
      <div><label>Type</label><select data-f="type">${o([['credit', 'Credit (money in)'], ['debit', 'Debit (money out)']], f.type, 'All')}</select></div><div><button class="btn ghost" id="bafc">Clear</button></div></div>`;
  }
  function bindFilter() {
    $$('#bafilt [data-f]').forEach(e => e.onchange = () => { BA.f[e.dataset.f] = e.value; BA.tx.page = 1; showBody(); });
    $('#bafc').onclick = () => { Object.keys(BA.f).forEach(k => BA.f[k] = ''); BA.tx.page = 1; showSub(); };
  }
  const showBody = () => { const fn = { overview, txns, credit: () => catView('credit'), debit: () => catView('debit'), unusual, reports }[BA.sub]; if (fn) Promise.resolve(fn()).catch(bad); };
  const body = h => { $('#babody').innerHTML = h; };

  // ================= overview =================
  const cards = c => `<div class="grid ba-cards">${[['Opening Balance', tk(c.opening)], ['Total Credit', tk(c.credit), 'ok'], ['Total Debit', tk(c.debit), 'bad'], ['Net Cash Flow', tk(c.net), c.net < 0 ? 'bad' : 'ok'], ['Closing Balance', tk(c.closing)], ['Total Transactions', c.count], ['Unclassified', c.unclassified, c.unclassified ? 'bad' : '']].map(([l, v, k]) => `<div class="stat"><div class="l">${l}</div><div class="v ${k || ''}">${v}</div></div>`).join('')}</div>`;
  async function overview() {
    const A = await api('/api/ba/analysis?' + qs(BA.f)); BA.an = A;
    if (!A.has_data) return body(`<div class="card"><p>No bank statement has been imported${BA.f.account_id || BA.f.bank || BA.f.branch ? ' for this selection' : ' yet'}.</p><button class="btn" id="baimp2">⬆ Import a bank statement</button></div>`), $('#baimp2').onclick = () => { BA.sub = 'import'; showSub(); };
    body(`${cards(A.cards)}${A.partial ? '<p class="muted">A type filter is on, so Closing Balance here is Opening + the credits and debits shown, not the real bank balance.</p>' : ''}
      <div class="card"><h3 style="margin-top:0">Imported statements</h3><table class="tbl"><thead><tr><th>Account</th><th>File</th><th>Period</th><th class="n">Opening</th><th class="n">Credit</th><th class="n">Debit</th><th class="n">Closing</th><th>Rows</th><th>Check</th><th></th></tr></thead><tbody>
      ${A.imports.map(i => `<tr><td>${esc(i.code)} · ${esc(i.name)}</td><td>${esc(i.file_name || '')}</td><td>${fdate(i.period_from)} – ${fdate(i.period_to)}</td><td class="n">${fmt(i.opening_balance)}</td><td class="n">${fmt(i.total_credit)}</td><td class="n">${fmt(i.total_debit)}</td><td class="n">${i.closing_balance === null ? '' : fmt(i.closing_balance)}</td>
      <td>${i.txn_count}${i.skipped_count ? ` <a href="#" data-sk="${i.id}">(${i.skipped_count} skipped)</a>` : ''}</td><td>${i.validation_ok ? badge('Totals agree', 'ok') : `<span title="${esc(i.validation_note || '')}">${badge('Not reconciled', 'bad')}</span>`}</td><td><button class="btn ghost" data-del="${i.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>
      <div class="card"><div class="ba-two2"><div><h3 style="margin-top:0">Money received</h3>${miniBars(A.credit.rows)}</div><div><h3 style="margin-top:0">Money paid</h3>${miniBars(A.debit.rows)}</div></div></div>`);
    $$('[data-sk]').forEach(a => a.onclick = async e => { e.preventDefault(); const r = await api(`/api/ba/imports/${a.dataset.sk}/skipped`); modal(`<h3>Rows not imported</h3><p class="muted">Kept for your record. Nothing here was lost silently.</p><div style="max-height:60vh;overflow:auto"><table class="tbl"><thead><tr><th>Row</th><th>Date</th><th>Description</th><th class="n">Debit</th><th class="n">Credit</th><th>Why</th></tr></thead><tbody>${r.rows.map(x => `<tr><td>${x.row}</td><td>${esc(x.date || '')}</td><td>${esc(x.description || '')}</td><td class="n">${fmt(x.debit)}</td><td class="n">${fmt(x.credit)}</td><td>${esc(x.reason)}</td></tr>`).join('')}</tbody></table></div><div class="actions"><button class="btn" onclick="closeModal()">Close</button></div>`); });
    $$('[data-del]').forEach(b => b.onclick = () => {
      const i = A.imports.find(x => String(x.id) === b.dataset.del);
      modal(`<h3>Delete imported statement?</h3><p>${esc(i.code)} · ${fdate(i.period_from)} – ${fdate(i.period_to)} · ${i.txn_count} transactions${i.file_name ? ' · ' + esc(i.file_name) : ''}.</p><p>This removes the imported rows and their categories and remarks from this tab (your vouchers are not touched). The deletion is recorded in the audit log.</p><div class="actions"><button class="btn bad" id="bdy">Yes, delete it</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
      $('#bdy').onclick = async () => { try { await api('/api/ba/imports/' + i.id, { method: 'DELETE', body: { confirm: true } }); closeModal(); toast('Statement deleted'); BA.meta = await api('/api/ba/accounts'); showSub(); } catch (e) { bad(e); } };
    });
  }
  const miniBars = rows => rows.length ? rows.slice(0, 8).map((r, i) => `<div class="ba-bar"><span>${esc(r.name)}</span><div><i style="width:${Math.max(1, r.percent)}%;background:${COLORS[i % COLORS.length]}"></i></div><b>${r.percent}%</b></div>`).join('') : '<p class="muted">None</p>';

  // ================= credit / debit analysis =================
  function donut(rows, dir) {
    const R = 70, r = 42, cx = 80, cy = 80; let a0 = -Math.PI / 2; const tot = rows.reduce((s, x) => s + x.amount, 0) || 1, P = (a, rad) => [cx + rad * Math.cos(a), cy + rad * Math.sin(a)];
    const paths = rows.map((x, i) => {
      const a1 = a0 + Math.min(x.amount / tot, 0.99999) * 2 * Math.PI, big = a1 - a0 > Math.PI ? 1 : 0, [x0, y0] = P(a0, R), [x1, y1] = P(a1, R), [x2, y2] = P(a1, r), [x3, y3] = P(a0, r);
      const d = `M${x0},${y0} A${R},${R} 0 ${big} 1 ${x1},${y1} L${x2},${y2} A${r},${r} 0 ${big} 0 ${x3},${y3}Z`; a0 = a1;
      return `<path d="${d}" fill="${COLORS[i % COLORS.length]}" data-k="${esc(x.key)}" class="ba-sl"><title>${esc(x.name)}: ${tk(x.amount)} (${x.percent}%)</title></path>`;
    }).join('');
    return `<svg viewBox="0 0 160 160" class="ba-donut">${paths}<text x="80" y="76" text-anchor="middle" class="ba-dt">${dir === 'credit' ? 'Received' : 'Paid'}</text><text x="80" y="92" text-anchor="middle" class="ba-ds">${rows.reduce((s, x) => s + x.count, 0)} txns</text></svg>`;
  }
  async function catView(dir) {
    const A = await api('/api/ba/analysis?' + qs({ ...BA.f, type: '' })), G = A[dir], title = dir === 'credit' ? 'Credit Analysis – Money Received' : 'Debit Analysis – Money Paid';
    if (!A.has_data) return body('<div class="card"><p>No statement imported for this selection.</p></div>');
    body(`<div class="card"><h3 style="margin-top:0">${title}</h3><div class="ba-two"><div class="ba-chart">${G.rows.length ? donut(G.rows, dir) : '<p class="muted">No transactions</p>'}</div><div><table class="tbl"><thead><tr><th></th><th>Category</th><th class="n">Transactions</th><th class="n">Total amount</th><th class="n">% of total</th></tr></thead><tbody>
      ${G.rows.map((x, i) => `<tr class="click" data-k="${esc(x.key)}"><td><i class="ba-dot" style="background:${COLORS[i % COLORS.length]}"></i></td><td>${esc(x.name)}${x.uncategorized ? ' ' + badge('review', 'bad') : ''}${x.internal ? ' ' + badge('internal') : ''}</td><td class="n">${x.count}</td><td class="n">${fmt(x.amount)}</td><td class="n">${x.percent}%</td></tr>`).join('')}
      <tr class="tot"><td></td><td>Total</td><td class="n">${G.rows.reduce((s, x) => s + x.count, 0)}</td><td class="n">${fmt(G.total)}</td><td class="n">${G.rows.length ? '100%' : ''}</td></tr></tbody></table></div></div><p class="muted">Click a category or a slice of the chart to see its transactions.</p></div><div id="badrill"></div>`);
    const open = k => drill(dir, G.rows.find(x => x.key === k));
    $$('#babody tr.click').forEach(t => t.onclick = () => open(t.dataset.k)); $$('#babody .ba-sl').forEach(p => p.onclick = () => open(p.dataset.k));
  }
  async function drill(dir, g) {
    if (!g) return; const key = g.internal ? 'internal' : g.uncategorized ? 'none' : g.category_id;
    const r = await api('/api/ba/transactions?' + qs({ ...BA.f, type: dir, category: key, all: 1 }));
    $('#badrill').innerHTML = `<div class="card"><h3 style="margin-top:0">${esc(g.name)} · ${r.count} transaction${r.count === 1 ? '' : 's'} · ${tk(dir === 'debit' ? r.total_debit : r.total_credit)}</h3>${txTable(r.rows)}</div>`; bindTx(r.rows); $('#badrill').scrollIntoView({ behavior: 'smooth' });
  }

  // ================= transactions table =================
  const catName = r => (r.is_internal ? 'Internal transfer' : r.category_name || '— Uncategorized —');
  const txTable = rows => `<div style="overflow:auto"><table class="tbl ba-tx"><thead><tr><th>Date</th><th>Description</th><th>Reference</th><th class="n">Debit</th><th class="n">Credit</th><th>Category</th><th>Status</th></tr></thead><tbody>${rows.map(r => `<tr class="click" data-id="${r.id}"><td>${fdate(r.txn_date)}</td><td>${esc(r.description || '')}${r.remarks ? `<div class="muted">${esc(r.remarks)}</div>` : ''}</td><td>${esc(r.reference || '')}</td><td class="n">${r.debit > 0 ? fmt(r.debit) : ''}</td><td class="n">${r.credit > 0 ? fmt(r.credit) : ''}</td><td>${r.category_name || r.is_internal ? esc(catName(r)) : badge('Uncategorized', 'bad')}</td><td>${badge(REVIEW[r.review_status], r.review_status === 'reviewed' || r.review_status === 'accepted' ? 'ok' : r.review_status === 'new' ? '' : 'bad')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">No transactions</td></tr>'}</tbody></table></div>`;
  const bindTx = () => $$('.ba-tx tr.click').forEach(t => t.onclick = () => txDetail(t.dataset.id));
  async function txns() {
    const T = BA.tx, r = await api('/api/ba/transactions?' + qs({ ...BA.f, q: T.q, category: T.category, status: T.status, sort: T.sort, dir: T.dir, page: T.page, per: T.per }));
    if (!BA.cats) BA.cats = await api('/api/ba/categories');
    const cs = BA.cats.categories.filter(c => c.active);
    body(`<div class="card"><div class="row noprint"><div class="grow"><label>Search description, reference or cheque no.</label><input id="baq" value="${esc(T.q)}" placeholder="Search…"></div>
      <div><label>Category</label><select id="bacat"><option value="">All</option><option value="none" ${T.category === 'none' ? 'selected' : ''}>Uncategorized</option><option value="internal" ${T.category === 'internal' ? 'selected' : ''}>Internal transfers</option>${cs.map(c => `<option value="${c.id}" ${String(T.category) === String(c.id) ? 'selected' : ''}>${esc(c.name)} (${c.direction})</option>`).join('')}</select></div>
      <div><label>Review status</label><select id="bast"><option value="">All</option>${Object.entries(REVIEW).map(([k, l]) => `<option value="${k}" ${T.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Sort</label><select id="basort">${[['date|desc', 'Date, newest first'], ['date|asc', 'Date, oldest first'], ['amount|desc', 'Amount, largest first'], ['amount|asc', 'Amount, smallest first']].map(([v, l]) => `<option value="${v}" ${v === T.sort + '|' + T.dir ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><button class="btn" id="baxp">Export CSV</button></div></div>
      <div class="ba-totals"><span>${r.count} transactions</span><span>Total debit <b>${tk(r.total_debit)}</b></span><span>Total credit <b>${tk(r.total_credit)}</b></span></div>${txTable(r.rows)}
      <div class="row noprint" style="margin-top:10px"><button class="btn ghost" id="bapp" ${r.page <= 1 ? 'disabled' : ''}>‹ Previous</button><span>Page ${r.page} of ${r.pages}</span><button class="btn ghost" id="banp" ${r.page >= r.pages ? 'disabled' : ''}>Next ›</button><select id="baper">${[25, 50, 100, 250].map(n => `<option ${n === T.per ? 'selected' : ''}>${n}</option>`).join('')}</select><span class="muted">per page</span></div></div>`);
    let tm; $('#baq').oninput = e => { clearTimeout(tm); tm = setTimeout(() => { T.q = e.target.value; T.page = 1; txns().then(() => { const i = $('#baq'); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }); }, 350); };
    $('#bacat').onchange = e => { T.category = e.target.value; T.page = 1; txns(); }; $('#bast').onchange = e => { T.status = e.target.value; T.page = 1; txns(); };
    $('#basort').onchange = e => { [T.sort, T.dir] = e.target.value.split('|'); txns(); }; $('#baper').onchange = e => { T.per = +e.target.value; T.page = 1; txns(); };
    $('#bapp').onclick = () => { T.page--; txns(); }; $('#banp').onclick = () => { T.page++; txns(); }; bindTx();
    $('#baxp').onclick = async () => { const a = await api('/api/ba/transactions?' + qs({ ...BA.f, q: T.q, category: T.category, status: T.status, sort: T.sort, dir: T.dir, all: 1 })); csv('bank-transactions.csv', [['Date', 'Value date', 'Description', 'Reference', 'Cheque', 'Debit', 'Credit', 'Balance', 'Category', 'Review status', 'Remarks'], ...a.rows.map(x => [x.txn_date, x.value_date || '', x.description, x.reference, x.cheque_no, x.debit || '', x.credit || '', x.balance ?? '', catName(x), REVIEW[x.review_status], x.remarks || ''])]); };
  }
  async function txDetail(id) {
    const t = await api('/api/ba/transactions/' + id); if (!BA.cats) BA.cats = await api('/api/ba/categories');
    const dir = t.debit > 0 ? 'debit' : 'credit', cs = BA.cats.categories.filter(c => c.direction === dir && (c.active || c.id === t.category_id));
    modal(`<h3>Transaction details</h3><div class="ba-det"><div><span>Date</span><b>${fdate(t.txn_date)}</b></div><div><span>Value date</span><b>${t.value_date ? fdate(t.value_date) : '—'}</b></div><div><span>Account</span><b>${esc(t.account_code)} · ${esc(t.account_name)}</b></div><div><span>Statement row</span><b>#${t.row_no}</b></div>
      <div><span>${dir === 'debit' ? 'Debit' : 'Credit'}</span><b>${tk(t.debit > 0 ? t.debit : t.credit)}</b></div><div><span>Balance after</span><b>${t.balance === null ? '—' : tk(t.balance)}</b></div></div>
      <p class="muted" style="margin:4px 0">The amount cannot be edited here. If the statement was read wrongly, delete the import and import it again.</p>
      <div class="row"><div class="grow"><label>Description (as extracted)</label><input id="tdd" value="${esc(t.description || '')}"></div><div><label>Reference</label><input id="tdr" value="${esc(t.reference || '')}"></div></div>
      <div class="row"><div class="grow"><label>Category</label><select id="tdc"><option value="">— Uncategorized —</option>${cs.map(c => `<option value="${c.id}" ${c.id === t.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label>Review status</label><select id="tds">${Object.entries(REVIEW).map(([k, l]) => `<option value="${k}" ${t.review_status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label class="chk"><input type="checkbox" id="tdi" ${t.is_internal ? 'checked' : ''}> Internal transfer between our own accounts (not income or expense)</label>
      <div class="row"><div class="grow"><label>Remarks</label><input id="tdm" value="${esc(t.remarks || '')}" maxlength="500"></div></div>
      ${t.raw ? `<details><summary class="muted">Original imported row</summary><pre class="ba-raw">${esc(JSON.stringify(t.raw))}</pre></details>` : ''}
      ${t.parse_note ? `<p class="muted">Import note: ${esc(t.parse_note)}</p>` : ''}${t.log.length ? `<details><summary class="muted">Change history (${t.log.length})</summary>${t.log.map(l => `<div class="muted">${esc(String(l.created_at).slice(0, 16))} · ${esc(l.detail)}</div>`).join('')}</details>` : ''}
      <div class="actions" style="margin-top:12px"><button class="btn" id="tdsave">Save</button><button class="btn ghost" id="tdrev">Save & mark reviewed</button><button class="btn ghost" onclick="closeModal()">Close</button></div>`);
    const save = async rev => { try { await api('/api/ba/transactions/' + id, { method: 'PUT', body: { description: $('#tdd').value, reference: $('#tdr').value, category_id: $('#tdc').value || null, is_internal: $('#tdi').checked, remarks: $('#tdm').value, review_status: rev ? 'reviewed' : $('#tds').value } }); closeModal(); toast('Saved'); BA.cats = null; showBody(); } catch (e) { bad(e); } };
    $('#tdsave').onclick = () => save(false); $('#tdrev').onclick = () => save(true);
  }

  // ================= categories and rules =================
  async function cats() {
    const C = await api('/api/ba/categories'); BA.cats = C; const cn = Object.fromEntries(C.categories.map(c => [c.id, c.name]));
    body(`<div class="card"><div class="row"><h3 style="margin:0">Categories</h3><button class="btn" id="bacn" style="margin-left:auto">+ New category</button></div><table class="tbl"><thead><tr><th>Name</th><th>Type</th><th>Bank charge</th><th class="n">Transactions</th><th class="n">Rules</th><th>Status</th><th></th></tr></thead><tbody>
      ${C.categories.map(c => `<tr><td>${esc(c.name)}</td><td>${c.direction}</td><td>${c.is_charge ? 'Yes' : ''}</td><td class="n">${c.used}</td><td class="n">${c.rules}</td><td>${c.active ? badge('Active', 'ok') : badge('Inactive')}</td><td><button class="btn ghost" data-ec="${c.id}">Edit</button> <button class="btn ghost" data-dc="${c.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>
      <div class="card"><div class="row"><h3 style="margin:0">Automatic rules</h3><span class="muted">Smaller priority number is tried first. Categories you set by hand are never changed by rules.</span><button class="btn" id="barn" style="margin-left:auto">+ New rule</button></div>
      <table class="tbl"><thead><tr><th class="n">Priority</th><th>Type</th><th>Look in</th><th>Match</th><th>Keyword</th><th>Category</th><th>Internal?</th><th></th></tr></thead><tbody>${C.rules.map(r => `<tr class="${r.active ? '' : 'muted'}"><td class="n">${r.priority}</td><td>${r.direction}</td><td>${r.match_field}</td><td>${r.match_type}</td><td>${esc(r.keyword)}</td><td>${esc(cn[r.category_id] || '')}</td><td>${r.mark_internal ? 'Yes' : ''}</td><td><button class="btn ghost" data-er="${r.id}">Edit</button> <button class="btn ghost" data-dr="${r.id}">Delete</button></td></tr>`).join('')}</tbody></table>
      <div class="actions" style="margin-top:12px"><button class="btn" id="barc">Apply rules to uncategorized transactions</button><button class="btn ghost" id="barca">Re-apply to all (except manual choices)</button></div></div>`);
    const catForm = c => { modal(`<h3>${c ? 'Edit' : 'New'} category</h3><div class="row"><div class="grow"><label>Name</label><input id="cfn" value="${esc(c ? c.name : '')}" maxlength="100"></div><div><label>Type</label><select id="cfd" ${c && (c.used || c.rules) ? 'disabled' : ''}><option value="credit" ${c && c.direction === 'credit' ? 'selected' : ''}>Credit (money in)</option><option value="debit" ${!c || c.direction === 'debit' ? 'selected' : ''}>Debit (money out)</option></select></div></div>
      <label class="chk"><input type="checkbox" id="cfc" ${c && c.is_charge ? 'checked' : ''}> Bank charge (used by the Bank Charges report and reconciliation)</label>${c ? `<label class="chk"><input type="checkbox" id="cfa" ${c.active ? 'checked' : ''}> Active</label>` : ''}<div class="actions" style="margin-top:12px"><button class="btn" id="cfs">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
      $('#cfs').onclick = async () => { try { const b = { name: $('#cfn').value, direction: $('#cfd').value, is_charge: $('#cfc').checked }; if (c) b.active = $('#cfa').checked; await api('/api/ba/categories' + (c ? '/' + c.id : ''), { method: c ? 'PUT' : 'POST', body: b }); closeModal(); cats(); } catch (e) { bad(e); } }; };
    $('#bacn').onclick = () => catForm(null); $$('[data-ec]').forEach(b => b.onclick = () => catForm(C.categories.find(c => String(c.id) === b.dataset.ec)));
    $$('[data-dc]').forEach(b => b.onclick = async () => { if (!confirm('Delete this category?')) return; try { await api('/api/ba/categories/' + b.dataset.dc, { method: 'DELETE' }); cats(); } catch (e) { bad(e); } });
    const ruleForm = r => { modal(`<h3>${r ? 'Edit' : 'New'} rule</h3><div class="row"><div class="grow"><label>Keyword to look for</label><input id="rfk" value="${esc(r ? r.keyword : '')}" maxlength="200"></div><div><label>Priority</label><input id="rfp" type="number" min="1" max="9999" value="${r ? r.priority : 100}" style="width:90px"></div></div>
      <div class="row"><div class="grow"><label>Category</label><select id="rfc">${C.categories.filter(c => c.active).map(c => `<option value="${c.id}" ${r && r.category_id === c.id ? 'selected' : ''}>${esc(c.name)} (${c.direction})</option>`).join('')}</select></div><div><label>Look in</label><select id="rff">${[['description', 'Description'], ['reference', 'Reference'], ['either', 'Either']].map(([v, l]) => `<option value="${v}" ${r && r.match_field === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div><label>Match</label><select id="rft">${[['contains', 'Contains'], ['starts', 'Starts with'], ['equals', 'Equals']].map(([v, l]) => `<option value="${v}" ${r && r.match_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <label class="chk"><input type="checkbox" id="rfi" ${r && r.mark_internal ? 'checked' : ''}> Mark matching transactions as internal transfers</label>${r ? `<label class="chk"><input type="checkbox" id="rfa" ${r.active ? 'checked' : ''}> Active</label>` : ''}<div class="actions" style="margin-top:12px"><button class="btn" id="rfs">Save</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
      $('#rfs').onclick = async () => { try { const b = { keyword: $('#rfk').value, priority: $('#rfp').value, category_id: $('#rfc').value, match_field: $('#rff').value, match_type: $('#rft').value, mark_internal: $('#rfi').checked }; if (r) b.active = $('#rfa').checked; await api('/api/ba/rules' + (r ? '/' + r.id : ''), { method: r ? 'PUT' : 'POST', body: b }); closeModal(); cats(); } catch (e) { bad(e); } }; };
    $('#barn').onclick = () => ruleForm(null); $$('[data-er]').forEach(b => b.onclick = () => ruleForm(C.rules.find(r => String(r.id) === b.dataset.er)));
    $$('[data-dr]').forEach(b => b.onclick = async () => { if (!confirm('Delete this rule?')) return; try { await api('/api/ba/rules/' + b.dataset.dr, { method: 'DELETE' }); cats(); } catch (e) { bad(e); } });
    const apply = only => async () => { try { const r = await api('/api/ba/recategorize', { method: 'POST', body: { only_unclassified: only } }); toast(`${r.scanned} checked, ${r.changed} changed`); cats(); } catch (e) { bad(e); } };
    $('#barc').onclick = apply(true); $('#barca').onclick = apply(false);
  }

  // ================= unusual transactions =================
  async function unusual() {
    const U_ = await api('/api/ba/unusual?' + qs(BA.f)); if (!BA.cats) BA.cats = await api('/api/ba/categories');
    const only = BA.uflag || '';
    const rows = U_.rows.filter(r => !only || r.flags.some(f => f.code === only));
    body(`<div class="card"><p class="muted" style="margin-top:0">These are accounting review alerts only. A flag does not mean anything is wrong or dishonest.</p>
      <div class="row noprint"><div><label>Large-value limit (৳, blank = automatic)</label><input id="balim" value="${U_.thresholds.user_set ? U_.thresholds.debit : ''}" placeholder="${U_.thresholds.debit ? 'auto: ' + fmt(U_.thresholds.debit) : 'auto'}"></div><div><button class="btn" id="balimb">Save limit</button></div></div>
      <div class="ba-chips">${Object.entries(U_.counts).map(([k, n]) => `<button class="chip ${only === k ? 'on' : ''}" data-fl="${k}">${esc(U_.labels[k])} · ${n}</button>`).join('') || '<span class="muted">No alerts for this selection.</span>'}${only ? '<button class="chip" data-fl="">Show all</button>' : ''}</div>
      ${U_.statement_alerts.length ? `<div class="ba-warn"><b>Statements that do not reconcile with their totals</b>${U_.statement_alerts.map(s => `<div>${esc(s.code)} · ${fdate(s.period_from)} – ${fdate(s.period_to)} · ${esc(s.validation_note || '')}</div>`).join('')}</div>` : ''}
      <div style="overflow:auto"><table class="tbl"><thead><tr><th>Date</th><th>Description</th><th class="n">Debit</th><th class="n">Credit</th><th>Why flagged</th><th>Review</th></tr></thead><tbody>${rows.map(r => `<tr><td>${fdate(r.date)}</td><td><a href="#" data-id="${r.id}">${esc(r.description || '(none)')}</a><div class="muted">${esc(r.reference || '')}</div></td><td class="n">${r.debit > 0 ? fmt(r.debit) : ''}</td><td class="n">${r.credit > 0 ? fmt(r.credit) : ''}</td><td>${r.flags.map(f => badge(f.label, 'bad')).join(' ')}</td>
      <td><select data-st="${r.id}">${Object.entries(REVIEW).map(([k, l]) => `<option value="${k}" ${r.review_status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing to show</td></tr>'}</tbody></table></div></div>`);
    $$('[data-fl]').forEach(b => b.onclick = () => { BA.uflag = b.dataset.fl; unusual(); });
    $$('[data-st]').forEach(s => s.onchange = async () => { try { await api('/api/ba/transactions/' + s.dataset.st, { method: 'PUT', body: { review_status: s.value } }); toast('Saved'); } catch (e) { bad(e); } });
    $$('#babody a[data-id]').forEach(a => a.onclick = e => { e.preventDefault(); txDetail(a.dataset.id); });
    $('#balimb').onclick = async () => { try { await api('/api/ba/settings', { method: 'PUT', body: { large_threshold: $('#balim').value } }); toast('Saved'); unusual(); } catch (e) { bad(e); } };
  }

  // ================= reconciliation summary =================
  async function recon() {
    const m = BA.meta, R = BA.rc; if (!R.account_id) R.account_id = (m.accounts.find(a => a.imports) || m.accounts[0] || {}).id || ''; if (!R.as_of) R.as_of = today();
    let S = null, err = '';
    if (R.account_id) { try { S = await api('/api/ba/recon-summary?' + qs({ account_id: R.account_id, as_of: R.as_of, tol: R.tol, other: R.other })); } catch (e) { err = e.message; } }
    const line = (l, v, b) => `<div class="ln"><span>${b ? '<b>' + l + '</b>' : l}</span><span>${b ? '<b>' + v + '</b>' : v}</span></div>`, zero = S && Math.abs(S.difference) < 0.005;
    body(`<div class="card"><div class="ba-two2"><div class="ba-note" style="margin:0"><b>1. Bank Statement Analysis</b> – is the statement itself consistent?<br>${S ? (S.statement_balance_ok ? badge('Statement balance agrees with its rows', 'ok') : badge('Last running balance differs from opening + rows', 'bad')) : '—'}</div>
      <div class="ba-note" style="margin:0"><b>2. Bank Reconciliation</b> – does the statement agree with your Bank Book?<br>${S ? (zero ? badge('Difference is zero', 'ok') : badge('Difference ' + tk(S.difference), 'bad')) : '—'}</div></div>
      <div class="row noprint" style="margin-top:12px"><div class="grow"><label>Bank account</label><select id="rsa">${m.accounts.map(a => `<option value="${a.id}" ${String(a.id) === String(R.account_id) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}${a.masked ? ' · ' + a.masked : ''}</option>`).join('')}</select></div><div><label>As on</label><input type="date" id="rsd" value="${R.as_of}"></div><div><label>Match within (days)</label><input type="number" id="rst" value="${R.tol}" min="0" max="60" style="width:80px"></div>
      <div><label>Other adjustments (৳, can be negative)</label><input id="rso" value="${esc(R.other)}" placeholder="0.00"></div><div class="grow"><label>Note for other adjustments</label><input id="rsn" value="${esc(R.other_note)}" maxlength="300"></div><div><button class="btn" id="rsr">Refresh</button></div></div>
      ${err ? `<p class="err">${esc(err)}</p>` : ''}</div>
      ${S ? `<div class="card"><h3 style="margin-top:0">Reconciliation summary · ${esc(S.account.name)} ${esc(S.account.masked)} · as on ${fdate(S.as_of)}</h3><div class="ba-recon">${line('Bank statement closing balance', tk(S.statement_closing), 1)}${line(`Add: deposits in transit (${S.lists.transit.length})`, tk(S.deposits_in_transit))}${line(`Less: outstanding cheques (${S.lists.outstanding.length})`, tk(S.outstanding_cheques))}${line('Adjusted bank balance', tk(S.adjusted_bank), 1)}<hr>
        ${line('Company cash book closing balance', tk(S.book_closing), 1)}${line(`Less: bank charges not recorded in the book (${S.lists.charges.length})`, tk(S.charges_not_in_book))}${line(`Less: other bank debits not in the book (${S.lists.other_debits.length})`, tk(S.other_debits_not_in_book))}${line(`Add: direct bank credits not recorded in the book (${S.lists.credits.length})`, tk(S.credits_not_in_book))}${line('Other reconciliation adjustments', tk(S.other_adjustments))}${line('Adjusted book balance', tk(S.adjusted_book), 1)}<hr>
        ${line('Unmatched statement lines / book lines', S.unmatched_bank + ' / ' + S.unmatched_book)}${line('Reconciliation difference', `<span class="${zero ? 'ok' : 'err'}" style="margin:0">${tk(S.difference)}</span>`, 1)}</div>
        <p class="muted">${S.matched} of ${S.bank_lines} statement lines matched with book lines (cheque number first, then amount within ${S.tolerance_days} days). ${S.cleared_not_in_statement ? `${S.cleared_not_in_statement} book line(s) are marked cleared but are not in the imported statement, so they show up in the difference.` : ''} A difference that is not zero usually means the opening balances differ, an amount was recorded differently, or a statement period is missing.</p>
        <div class="row noprint"><button class="btn ghost" id="rsdr">Save as draft</button><button class="btn" id="rsco">Mark as completed…</button><button class="btn ghost" id="rsfull">Open full matching tool</button></div>
        ${['outstanding', 'transit'].map(k => S.lists[k].length ? `<details><summary>${k === 'outstanding' ? 'Outstanding cheques' : 'Deposits in transit'} (${S.lists[k].length})</summary><table class="tbl"><tbody>${S.lists[k].map(x => `<tr><td>${fdate(x.date)}</td><td>${esc(x.voucher_no)}</td><td>${esc(x.cheque_no || '')}</td><td>${esc(x.party || x.narration || '')}</td><td class="n">${fmt(x.amount)}</td></tr>`).join('')}</tbody></table></details>` : '').join('')}
        ${['charges', 'other_debits', 'credits'].map(k => S.lists[k].length ? `<details><summary>${{ charges: 'Bank charges not in book', other_debits: 'Other bank debits not in book', credits: 'Direct bank credits not in book' }[k]} (${S.lists[k].length})</summary><table class="tbl"><tbody>${S.lists[k].map(x => `<tr><td>${fdate(x.date)}</td><td>${esc(x.description || '')}</td><td>${esc(x.category)}</td><td class="n">${fmt(x.amount)}</td></tr>`).join('')}</tbody></table></details>` : '').join('')}</div>
        <div class="card"><h3 style="margin-top:0">Saved reconciliation records</h3><table class="tbl"><thead><tr><th>Saved</th><th>As on</th><th class="n">Statement</th><th class="n">Book</th><th class="n">Difference</th><th>Status</th><th>Approval note</th></tr></thead><tbody>${S.records.map(x => `<tr><td>${esc(String(x.created_at).slice(0, 16))}</td><td>${fdate(x.as_of)}</td><td class="n">${fmt(x.statement_closing)}</td><td class="n">${fmt(x.book_closing)}</td><td class="n">${fmt(x.difference)}</td><td>${x.status === 'completed' ? badge('Completed', 'ok') : badge('Draft')}</td><td>${esc(x.approval_note || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">None yet</td></tr>'}</tbody></table></div>` : ''}`);
    const rd = () => { R.account_id = $('#rsa').value; R.as_of = $('#rsd').value; R.tol = $('#rst').value; R.other = $('#rso').value; R.other_note = $('#rsn').value; };
    $('#rsr').onclick = () => { rd(); recon(); }; $('#rsa').onchange = () => { rd(); recon(); };
    if (!S) return;
    const save = async (status, note) => { rd(); try { const r = await api('/api/ba/recon-records', { method: 'POST', body: { account_id: R.account_id, as_of: R.as_of, tol: R.tol, other_adjustments: R.other, other_note: R.other_note, status, approval_note: note } }); closeModal(); toast(status === 'completed' ? 'Reconciliation marked completed' : 'Draft saved'); recon(); } catch (e) { bad(e); } };
    $('#rsdr').onclick = () => save('draft', ''); $('#rsfull').onclick = () => { BA.tab = 'recon'; window.vRecon(); };
    $('#rsco').onclick = () => modal(`<h3>Mark reconciliation as completed</h3><p>Difference: <b>${tk(S.difference)}</b></p>${zero ? '<p>The bank and the books agree.</p>' : '<p class="err">The difference is not zero. It can only be completed if someone explicitly approves it. Write who approved it and why.</p><input id="rsap" placeholder="Approved by … because …" style="width:100%">'}<div class="actions" style="margin-top:12px"><button class="btn" id="rsok">Mark completed</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`) || ($('#rsok').onclick = () => save('completed', zero ? '' : $('#rsap').value));
  }

  // ================= month-end tasks: clear matched lines, post missing bank charges =================
  async function tasks() {
    const m = BA.meta, R = BA.rc; if (!R.account_id) R.account_id = (m.accounts.find(a => a.imports) || m.accounts[0] || {}).id || ''; if (!R.as_of) R.as_of = today();
    let C = null, P = null, err = '';
    if (R.account_id) { const q = qs({ account_id: R.account_id, as_of: R.as_of, tol: R.tol }); try { [C, P] = await Promise.all([api('/api/ba/tasks/clear?' + q), api('/api/ba/tasks/charges?' + q)]); } catch (e) { err = e.message; } }
    const exp = ACC.filter(a => a.kind === 'normal' && a.active);
    body(`<div class="card"><p class="muted" style="margin-top:0">Two month-end jobs that use the imported statement. Nothing changes until you press the button, and you can untick any line.</p>
      <div class="row noprint"><div class="grow"><label>Bank account</label><select id="tka">${m.accounts.map(a => `<option value="${a.id}" ${String(a.id) === String(R.account_id) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}${a.masked ? ' · ' + a.masked : ''}</option>`).join('')}</select></div><div><label>Statement lines up to</label><input type="date" id="tkd" value="${R.as_of}"></div><div><label>Match within (days)</label><input type="number" id="tkt" min="0" max="60" value="${R.tol}" style="width:80px"></div><div><button class="btn" id="tkr">Refresh</button></div></div>${err ? `<p class="err">${esc(err)}</p>` : ''}</div>
      ${C ? `<div class="card"><h3 style="margin-top:0">1. Mark Bank Book lines as cleared</h3><p class="muted">Statement lines that match a Bank Book line (cheque number first, then amount and date) are cleared on the <b>bank's date</b>. This is the same as clearing each line in the Bank Book by hand. ${C.already_cleared} already cleared${C.cleared_other_date ? `, ${C.cleared_other_date} cleared on a different date (left unchanged)` : ''}.</p>
        ${C.to_clear.length ? `<div style="overflow:auto;max-height:340px"><table class="tbl"><thead><tr><th><input type="checkbox" id="tkall" checked></th><th>Bank date</th><th>Book date</th><th>Voucher</th><th>Cheque</th><th>Statement description</th><th class="n">Amount</th><th>Matched by</th></tr></thead><tbody>${C.to_clear.map(x => `<tr><td><input type="checkbox" class="tkc" value="${x.line_id}" checked></td><td>${fdate(x.bank_date)}</td><td>${fdate(x.book_date)}</td><td>${esc(x.voucher_no)}</td><td>${esc(x.cheque_no || '')}</td><td>${esc(x.description || '')}</td><td class="n">${fmt(x.amount)}</td><td>${badge(x.how, x.how === 'cheque no' ? 'ok' : '')}</td></tr>`).join('')}</tbody></table></div><div class="actions" style="margin-top:10px"><button class="btn" id="tkclear">Clear selected lines</button></div>` : '<p class="muted">Nothing to clear. All matched lines are already cleared.</p>'}</div>
      <div class="card"><h3 style="margin-top:0">2. Post bank charges that are missing from the books</h3><p class="muted">Charges and VAT on the statement that have no Bank Book entry. Each becomes a Bank Payment voucher (Dr the expense account, Cr this bank) dated on the statement date and cleared. Choose the expense account for each.</p>
        ${P.rows.length ? `<div style="overflow:auto;max-height:380px"><table class="tbl"><thead><tr><th><input type="checkbox" id="tkall2" checked></th><th>Date</th><th>Description</th><th>Category</th><th class="n">Amount</th><th>Expense account</th></tr></thead><tbody>${P.rows.map(x => `<tr><td><input type="checkbox" class="tkh" value="${x.txn_id}" checked></td><td>${fdate(x.date)}</td><td>${esc(x.description || '')}</td><td>${esc(x.category || '')}</td><td class="n">${fmt(x.amount)}</td><td><select class="tka2" data-t="${x.txn_id}">${opts(exp, x.suggest, 'Choose account')}</select></td></tr>`).join('')}</tbody></table></div>
          <label class="chk"><input type="checkbox" id="tkrem" checked> Remember these accounts for the next statement</label><div class="actions"><span><b>Total ${tk(P.total)}</b></span><button class="btn" id="tkpost">Post selected as Bank Payment vouchers</button></div>` : '<p class="muted">No missing bank charges.</p>'}</div>` : ''}`);
    const rd = () => { R.account_id = $('#tka').value; R.as_of = $('#tkd').value; R.tol = $('#tkt').value; };
    $('#tkr').onclick = () => { rd(); tasks(); }; $('#tka').onchange = () => { rd(); tasks(); };
    const all = (id, cls) => { const a = $(id); if (a) a.onchange = () => $$(cls).forEach(c => { c.checked = a.checked; }); }; all('#tkall', '.tkc'); all('#tkall2', '.tkh');
    if ($('#tkclear')) $('#tkclear').onclick = async () => { const ids = $$('.tkc:checked').map(c => +c.value); if (!ids.length) return toast('Select at least one line', true); try { const r = await api('/api/ba/tasks/clear', { method: 'POST', body: { account_id: R.account_id, as_of: R.as_of, tol: R.tol, line_ids: ids } }); toast(`${r.cleared} line(s) cleared`); tasks(); } catch (e) { bad(e); } };
    if ($('#tkpost')) $('#tkpost').onclick = async () => {
      const items = $$('.tkh:checked').map(c => ({ txn_id: +c.value, expense_account_id: $(`.tka2[data-t="${c.value}"]`).value })); if (!items.length) return toast('Select at least one charge', true); if (items.some(i => !i.expense_account_id)) return toast('Choose an expense account for every selected charge', true);
      if (!confirm(`Post ${items.length} Bank Payment voucher(s)?`)) return;
      try { const r = await lockApi('/api/ba/tasks/charges', { method: 'POST', body: { account_id: R.account_id, as_of: R.as_of, tol: R.tol, items, remember: $('#tkrem').checked } }); toast(`${r.posted} voucher(s) posted: ${r.vouchers.map(v => v.voucher_no).join(', ')}`); tasks(); } catch (e) { bad(e); }
    };
  }

  // ================= import =================
  const FIELDS = [['date', 'Date'], ['vdate', 'Value date'], ['desc', 'Description'], ['ref', 'Reference'], ['cheque', 'Cheque no.'], ['out', 'Debit (withdrawal)'], ['in', 'Credit (deposit)'], ['amount', 'Single amount column'], ['balance', 'Balance']];
  function autoMapA(hdr) {
    const m = {}; FIELDS.forEach(([k]) => m[k] = -1);
    hdr.forEach((h, i) => { const n = U.norm(h); let f = window.FABankRead.fieldOf(n); if (!f && /^ref|reference|txnid|transid|utr|narration2/.test(n)) f = 'ref'; if (f && m[f] < 0) m[f] = i; });
    if (m.date < 0 && m.vdate >= 0) m.date = m.vdate; if (m.out >= 0 || m.in >= 0) m.amount = -1; return m;
  }
  const money = v => { if (v === null || v === undefined) return ''; if (typeof v === 'number') { const c = Math.round(v * 100); return Math.abs(v * 100 - c) < 1e-6 ? (c / 100).toFixed(2) : String(v); } return String(v).trim().replace(/\s*(dr|cr)\.?$/i, '').replace(/^[-—–]+$/, ''); };
  const META = /^(total|grand total|closing balance|opening balance|balance b\/f|balance c\/f|carried forward|brought forward|page \d|this is a|end of)/i;
  function buildRows() {
    const I = BA.imp, rows = [], ignored = []; let openFound = null;
    for (let i = I.hdr + 1; i < I.rows.length; i++) {
      const r = I.rows[i], g = k => (I.map[k] >= 0 ? r[I.map[k]] : ''); if (!r.some(c => String(c ?? '').trim() !== '')) continue;
      const dr = U.parseDate(g('date')), desc = String(g('desc') ?? '').trim(), bal = money(g('balance'));
      const lead = String(r.find(c => String(c ?? '').trim() !== '') ?? '').trim();
      if (!dr && (META.test(desc) || META.test(lead)) || (!dr && !money(g('out')) && !money(g('in')) && !money(g('amount')))) { ignored.push({ n: i + 1, text: r.filter(c => String(c ?? '').trim()).join(' | ') }); if (/opening|brought|b\/f/i.test(desc) && bal) openFound = bal; continue; }
      let debit = money(g('out')), credit = money(g('in'));
      if (I.map.amount >= 0 && !debit && !credit) { const a = money(g('amount')); const neg = /^\(.*\)$|^-/.test(a); const x = a.replace(/[()\-]/g, ''); if (x) { if (neg !== I.swap) debit = x; else credit = x; } }
      else if (I.swap) [debit, credit] = [credit, debit];
      const e = I.edits[i + 1] || {};
      rows.push({ n: i + 1, date: e.date ?? (dr || String(g('date') ?? '').trim()), value_date: U.parseDate(g('vdate')) || '', description: e.description ?? desc, reference: e.reference ?? String(g('ref') ?? '').trim(), cheque_no: String(g('cheque') ?? '').trim(), debit: e.debit ?? debit, credit: e.credit ?? credit, balance: e.balance ?? bal, raw: r, exclude: I.exclude.has(i + 1), keep_duplicate: I.keep.has(i + 1) });
    }
    I.ignored = ignored; I.openFound = openFound; return rows;
  }
  function importView() {
    const I = BA.imp = BA.imp || { acc: '', branch: '', file: '', rows: [], hdr: 0, map: {}, swap: false, edits: {}, exclude: new Set(), keep: new Set(), open: '', close: '', sd: '', sc: '', prev: null, attn: true, accept: false };
    const banks = ACC.filter(a => a.kind === 'bank' && a.active); if (!I.acc) I.acc = banks[0] ? banks[0].id : '';
    body(`<div class="card"><h3 style="margin-top:0">Import a bank statement</h3><p class="muted">PDF, Excel or CSV. The file is read on this computer. You will see a preview and can correct anything before it is saved.</p>
      ${banks.length ? `<div class="row"><div class="grow"><label>Bank account</label><select id="bia">${banks.map(a => `<option value="${a.id}" ${String(a.id) === String(I.acc) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}${a.account_no ? ' · •••• ' + esc(String(a.account_no).slice(-4)) : ''}</option>`).join('')}</select></div><div><label>Branch</label><input id="bib" value="${esc(I.branch)}" placeholder="e.g. Motijheel"></div><div class="grow"><label>Statement file</label><input type="file" id="bif" accept=".pdf,.xlsx,.xls,.csv,.txt"></div></div><div id="bimsg" class="muted"></div>` : '<p>Add a bank account first (Chart of Accounts).</p>'}</div><div id="bimap"></div><div id="biprev"></div>`);
    if (!banks.length) return;
    $('#bia').onchange = e => { I.acc = e.target.value; if (I.prev) preview(); }; $('#bib').onchange = e => { I.branch = e.target.value; };
    $('#bif').onchange = async e => { const f = e.target.files[0]; if (!f) return; $('#bimsg').textContent = 'Reading ' + f.name + '…'; try { I.rows = await window.FABankRead.readStatement(f); I.file = f.name; I.hdr = window.FABankRead.findHeaderRow(I.rows); I.map = autoMapA(I.rows[I.hdr] || []); I.swap = false; I.edits = {}; I.exclude = new Set(); I.keep = new Set(); I.open = I.close = I.sd = I.sc = ''; I.prev = null; I.accept = false; $('#bimsg').textContent = `${I.rows.length} lines read from ${f.name}.`; drawMap(); preview(); } catch (er) { $('#bimsg').className = 'err'; $('#bimsg').textContent = er.message; } };
    if (I.rows.length) { drawMap(); if (I.prev) drawPrev(); }
  }
  function drawMap() {
    const I = BA.imp, hdr = I.rows[I.hdr] || [], sel = k => `<select data-m="${k}"><option value="-1">— none —</option>${hdr.map((h, i) => `<option value="${i}" ${I.map[k] === i ? 'selected' : ''}>${U.letters(i)} · ${esc(String(h).slice(0, 28))}</option>`).join('')}</select>`;
    $('#bimap').innerHTML = `<details class="card" ${I.prev && I.prev.summary.rows_error === 0 && I.map.date >= 0 ? '' : 'open'}><summary><b>Column mapping</b> <span class="muted">(detected automatically – change it if a column is wrong)</span></summary><div class="row" style="margin-top:10px"><div><label>Header row no.</label><input type="number" id="bihr" min="1" value="${I.hdr + 1}" style="width:80px"></div>${FIELDS.map(([k, l]) => `<div><label>${l}</label>${sel(k)}</div>`).join('')}<div><label class="chk"><input type="checkbox" id="biswap" ${I.swap ? 'checked' : ''}> Swap debit / credit</label></div></div>
      <div style="overflow:auto;max-height:200px"><table class="tbl"><tbody>${I.rows.slice(I.hdr, I.hdr + 7).map(r => `<tr>${r.map(c => `<td>${esc(String(c ?? '').slice(0, 30))}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`;
    $$('#bimap [data-m]').forEach(s => s.onchange = () => { I.map[s.dataset.m] = +s.value; I.edits = {}; preview(); });
    $('#bihr').onchange = e => { I.hdr = Math.max(0, (+e.target.value || 1) - 1); I.map = autoMapA(I.rows[I.hdr] || []); I.edits = {}; drawMap(); preview(); };
    $('#biswap').onchange = e => { I.swap = e.target.checked; I.edits = {}; preview(); };
  }
  async function preview() {
    const I = BA.imp; if (I.map.date < 0) { $('#biprev').innerHTML = '<p class="err">Choose the Date column in the column mapping.</p>'; return; }
    if (I.map.amount < 0 && I.map.out < 0 && I.map.in < 0) { $('#biprev').innerHTML = '<p class="err">Choose the Debit and Credit columns (or a single Amount column).</p>'; return; }
    const rows = buildRows(); if (!rows.length) { $('#biprev').innerHTML = '<p class="err">No transaction rows were found with this mapping.</p>'; return; }
    $('#biprev').innerHTML = '<p class="muted">Checking…</p>';
    try { I.prev = await api('/api/ba/import/preview', { method: 'POST', body: { account_id: I.acc, rows, opening_balance: I.open || (I.openFound || ''), closing_balance: I.close, stated_debit: I.sd, stated_credit: I.sc } }); drawPrev(); } catch (e) { $('#biprev').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
  }
  function drawPrev() {
    const I = BA.imp, P = I.prev, S = P.summary, bad_ = P.rows.filter(r => r.status !== 'ok'), show = (I.attn && bad_.length ? bad_ : P.rows).slice(0, 400);
    const inp = (n, k, v, cls) => `<input data-e="${n}|${k}" value="${esc(v ?? '')}" class="${cls || ''}">`;
    $('#biprev').innerHTML = `<div class="card"><h3 style="margin-top:0">Preview and checks</h3><div class="grid ba-cards"><div class="stat"><div class="l">Rows to import</div><div class="v">${S.rows_used}</div><div class="s">${S.rows_total} read${S.rows_dup ? ', ' + S.rows_dup + ' duplicate' : ''}</div></div><div class="stat"><div class="l">Rows with errors</div><div class="v ${S.rows_error ? 'bad' : 'ok'}">${S.rows_error}</div><div class="s">${S.rows_review} to review</div></div><div class="stat"><div class="l">Total debit</div><div class="v">${tk(S.total_debit)}</div></div><div class="stat"><div class="l">Total credit</div><div class="v">${tk(S.total_credit)}</div></div><div class="stat"><div class="l">Opening → Closing</div><div class="v" style="font-size:15px">${S.opening === null ? '?' : tk(S.opening)} → ${S.closing === null ? '?' : tk(S.closing)}</div><div class="s">Computed closing ${S.computed_closing === null ? '?' : tk(S.computed_closing)}</div></div></div>
      <div class="row" style="margin-top:10px"><div><label>Opening balance (blank = from first row)</label><input id="bio" value="${esc(I.open)}" placeholder="${S.opening ?? ''}"></div><div><label>Closing balance (blank = last row)</label><input id="bic" value="${esc(I.close)}" placeholder="${S.closing ?? ''}"></div><div><label>Statement total debit (optional)</label><input id="bisd" value="${esc(I.sd)}"></div><div><label>Statement total credit (optional)</label><input id="bisc" value="${esc(I.sc)}"></div><div><button class="btn ghost" id="bire">Re-check</button></div></div>
      ${S.checks.map(c => `<div class="ba-chk ${c.ok ? 'ok' : 'err'}">${c.ok ? '✔' : '✖'} <b>${esc(c.label)}</b>: ${esc(c.msg)}</div>`).join('')}
      ${S.already_imported ? `<div class="ba-warn">This exact statement was already imported (#${S.already_imported.id}${S.already_imported.file_name ? ', ' + esc(S.already_imported.file_name) : ''}).</div>` : ''}${S.overlap.length ? `<div class="ba-warn">The period overlaps an earlier import (${S.overlap.map(o => fdate(o.from) + ' – ' + fdate(o.to)).join(', ')}). Rows already saved are marked duplicate and skipped unless you keep them.</div>` : ''}
      ${I.ignored && I.ignored.length ? `<details><summary class="muted">${I.ignored.length} line(s) that are not transactions were left out (headings, totals…)</summary>${I.ignored.slice(0, 50).map(x => `<div class="muted">row ${x.n}: ${esc(x.text.slice(0, 160))}</div>`).join('')}</details>` : ''}
      <label class="chk"><input type="checkbox" id="biat" ${I.attn ? 'checked' : ''}> Show only rows that need attention (${bad_.length})</label>
      <div style="overflow:auto;max-height:480px"><table class="tbl ba-pv"><thead><tr><th>#</th><th>Date</th><th>Description</th><th>Reference</th><th class="n">Debit</th><th class="n">Credit</th><th class="n">Balance</th><th>Category (suggested)</th><th>Status</th><th>Skip</th></tr></thead><tbody>${show.map(r => `<tr class="st-${r.status}"><td>${r.n}</td><td>${inp(r.n, 'date', r.date || '', 'w90')}</td><td>${inp(r.n, 'description', r.description)}</td><td>${inp(r.n, 'reference', r.reference, 'w90')}</td><td class="n">${inp(r.n, 'debit', r.debit || '', 'w90 n')}</td><td class="n">${inp(r.n, 'credit', r.credit || '', 'w90 n')}</td><td class="n">${inp(r.n, 'balance', r.balance ?? '', 'w90 n')}</td><td>${r.is_internal ? 'Internal transfer' : esc(r.category_name || '—')}${r.hint ? `<div class="muted">${esc(r.hint)}</div>` : ''}</td>
      <td>${r.status === 'ok' ? badge('OK', 'ok') : badge(r.status === 'error' ? 'Error' : 'Review', 'bad')}${r.issues.map(i => `<div class="${i.level === 'error' ? 'err' : 'muted'}" style="margin:0">${esc(i.msg)}</div>`).join('')}${r.dup_existing ? `<label class="chk"><input type="checkbox" data-kd="${r.n}" ${I.keep.has(r.n) ? 'checked' : ''}> import anyway</label>` : ''}</td><td><input type="checkbox" data-ex="${r.n}" ${I.exclude.has(r.n) ? 'checked' : ''}></td></tr>`).join('')}</tbody></table></div>${(I.attn && bad_.length ? bad_ : P.rows).length > 400 ? '<p class="muted">Showing the first 400 rows.</p>' : ''}
      ${!S.validation_ok ? `<label class="chk err"><input type="checkbox" id="biac" ${I.accept ? 'checked' : ''}> Save anyway (the statement will be marked "Not reconciled")</label>` : ''}
      <div class="actions" style="margin-top:12px"><button class="btn" id="bisave" ${S.rows_error || !S.rows_used ? 'disabled' : ''}>Save statement (${S.rows_used} rows)</button><span class="muted">${S.rows_error ? 'Correct or skip the rows with errors first.' : ''}</span></div></div>`;
    const rd = () => { I.open = $('#bio').value.trim(); I.close = $('#bic').value.trim(); I.sd = $('#bisd').value.trim(); I.sc = $('#bisc').value.trim(); };
    $('#bire').onclick = () => { rd(); preview(); }; ['#bio', '#bic', '#bisd', '#bisc'].forEach(s => $(s).onchange = () => { rd(); preview(); });
    $('#biat').onchange = e => { I.attn = e.target.checked; drawPrev(); };
    $$('#biprev [data-e]').forEach(x => x.onchange = () => { const [n, k] = x.dataset.e.split('|'); (I.edits[n] = I.edits[n] || {})[k] = x.value; rd(); preview(); });
    $$('#biprev [data-ex]').forEach(x => x.onchange = () => { x.checked ? I.exclude.add(+x.dataset.ex) : I.exclude.delete(+x.dataset.ex); rd(); preview(); });
    $$('#biprev [data-kd]').forEach(x => x.onchange = () => { x.checked ? I.keep.add(+x.dataset.kd) : I.keep.delete(+x.dataset.kd); rd(); preview(); });
    if ($('#biac')) $('#biac').onchange = e => { I.accept = e.target.checked; };
    $('#bisave').onclick = async () => {
      rd(); const rows = buildRows(); try {
        const r = await api('/api/ba/import/commit', { method: 'POST', body: { account_id: I.acc, rows, file_name: I.file, branch: I.branch, opening_balance: I.open || (I.openFound || ''), closing_balance: I.close, stated_debit: I.sd, stated_credit: I.sc, accept_mismatch: I.accept } });
        toast(`Saved ${r.rows} transactions${r.skipped ? ', ' + r.skipped + ' skipped (kept on record)' : ''}`); const acc = I.acc; BA.imp = null; BA.cats = null; BA.meta = await api('/api/ba/accounts'); BA.f = { account_id: acc, bank: '', branch: '', from: '', to: '', type: '' }; BA.sub = 'overview'; showSub();
      } catch (e) { bad(e); } };
  }

  // ================= reports =================
  const REPORTS = [['full', 'Detailed Bank Transaction Analysis'], ['credit', 'Credit Analysis Report'], ['debit', 'Debit Analysis Report'], ['catwise', 'Category-wise Transaction Report'], ['charges', 'Bank Charges Report'], ['unclassified', 'Unclassified Transaction Report'], ['unusual', 'Unusual Transaction Report'], ['recon', 'Bank Reconciliation Summary']];
  function reports() {
    body(`<div class="card"><p class="muted" style="margin-top:0">Reports use the account, bank, branch and date filters above. Choose Print / PDF, Excel or CSV.</p><table class="tbl"><tbody>${REPORTS.map(([k, l]) => `<tr><td><b>${l}</b></td><td class="n"><button class="btn" data-r="${k}|pdf">Print / PDF</button> <button class="btn ghost" data-r="${k}|xlsx">Excel</button> <button class="btn ghost" data-r="${k}|csv">CSV</button></td></tr>`).join('')}</tbody></table>
      ${BA.f.account_id ? '' : '<p class="muted">Tip: the Reconciliation Summary needs one bank account. Pick it in the filter, or in the Reconciliation Summary tab.</p>'}</div>`);
    $$('[data-r]').forEach(b => b.onclick = async () => { const [k, fmt_] = b.dataset.r.split('|'); b.disabled = true; try { const R = await buildReport(k); await outReport(R, fmt_); } catch (e) { bad(e); } b.disabled = false; });
  }
  const catSec = (title, G) => ({ h: title, cols: [['Category'], ['Transactions', 1], ['Total amount', 1], ['% of total', 1]], rows: G.rows.map(x => [x.name, x.count, x.amount, x.percent]), foot: ['Total', G.rows.reduce((s, x) => s + x.count, 0), G.total, G.rows.length ? 100 : 0] });
  const txCols = [['Date'], ['Description'], ['Reference'], ['Debit', 1], ['Credit', 1], ['Category'], ['Status']];
  const txRows = rs => rs.map(r => [fdate(r.txn_date), r.description || '', r.reference || '', r.debit > 0 ? r.debit : '', r.credit > 0 ? r.credit : '', catName(r), REVIEW[r.review_status]]);
  const sumTx = rs => ['Total', '', '', rs.reduce((s, r) => s + Math.round(r.debit * 100), 0) / 100, rs.reduce((s, r) => s + Math.round(r.credit * 100), 0) / 100, '', ''];
  async function buildReport(k) {
    const f = BA.f, acc = BA.meta.accounts.find(a => String(a.id) === String(f.account_id));
    const A = await api('/api/ba/analysis?' + qs({ ...f, type: '' })); if (!A.has_data) throw new Error('No statement imported for this selection');
    const imp = A.imports[0] || {}, R = { kind: k, bank: acc ? acc.bank_name || imp.bank_name || '' : f.bank || (imp.bank_name || ''), branch: f.branch || imp.branch || '', account: acc ? `${acc.code} · ${acc.name} ${acc.masked}` : 'All accounts', from: f.from || (A.imports[0] || {}).period_from || '', to: f.to || (A.imports[A.imports.length - 1] || {}).period_to || '', sections: [], summary: [] };
    const all = async x => (await api('/api/ba/transactions?' + qs({ ...f, ...x, all: 1 }))).rows, c = A.cards;
    R.summary = [['Opening balance', c.opening], ['Total credit', c.credit], ['Total debit', c.debit], ['Net cash flow', c.net], ['Closing balance', c.closing], ['Transactions', c.count, 'int'], ['Unclassified', c.unclassified, 'int']];
    if (k === 'full') { R.title = 'DETAILED BANK TRANSACTION ANALYSIS'; R.sections.push(catSec('Credit analysis', A.credit), catSec('Debit analysis', A.debit)); const t = await all({}); R.sections.push({ h: 'Transaction details', cols: txCols, rows: txRows(t), foot: sumTx(t) }); }
    else if (k === 'credit' || k === 'debit') { R.title = k === 'credit' ? 'CREDIT ANALYSIS REPORT' : 'DEBIT ANALYSIS REPORT'; R.sections.push(catSec(k === 'credit' ? 'Credit analysis by category' : 'Debit analysis by category', A[k])); const t = await all({ type: k }); R.sections.push({ h: 'Transaction details', cols: txCols, rows: txRows(t), foot: sumTx(t) }); }
    else if (k === 'catwise') { R.title = 'CATEGORY-WISE TRANSACTION REPORT'; const t = await all({}), g = new Map(); t.forEach(r => { const n = catName(r) + (r.debit > 0 ? ' (debit)' : ' (credit)'); (g.get(n) || g.set(n, []).get(n)).push(r); }); [...g].sort((a, b) => a[0].localeCompare(b[0])).forEach(([n, rs]) => R.sections.push({ h: n, cols: txCols, rows: txRows(rs), foot: sumTx(rs) })); }
    else if (k === 'charges') { R.title = 'BANK CHARGES REPORT'; const t = (await all({ type: 'debit' })).filter(r => r.is_charge), g = new Map(); t.forEach(r => (g.get(r.category_name) || g.set(r.category_name, []).get(r.category_name)).push(r)); R.sections.push({ h: 'Charges by category', cols: [['Category'], ['Transactions', 1], ['Total', 1]], rows: [...g].map(([n, rs]) => [n, rs.length, rs.reduce((s, r) => s + Math.round(r.debit * 100), 0) / 100]), foot: ['Total', t.length, t.reduce((s, r) => s + Math.round(r.debit * 100), 0) / 100] }); R.sections.push({ h: 'Charge details', cols: txCols, rows: txRows(t), foot: sumTx(t) }); }
    else if (k === 'unclassified') { R.title = 'UNCLASSIFIED TRANSACTION REPORT'; const t = await all({ category: 'none' }); R.sections.push({ h: 'Transactions without a category', cols: txCols, rows: txRows(t), foot: sumTx(t) }); }
    else if (k === 'unusual') { R.title = 'UNUSUAL TRANSACTION REPORT'; const U_ = await api('/api/ba/unusual?' + qs(f)); R.note = 'Accounting review alerts only. A flag does not mean a transaction is wrong or improper.'; R.sections.push({ h: 'Alert counts', cols: [['Alert'], ['Transactions', 1]], rows: Object.entries(U_.counts).map(([c, n]) => [U_.labels[c], n]) }); R.sections.push({ h: 'Flagged transactions', cols: [['Date'], ['Description'], ['Reference'], ['Debit', 1], ['Credit', 1], ['Why flagged'], ['Review']], rows: U_.rows.map(r => [fdate(r.date), r.description || '', r.reference || '', r.debit > 0 ? r.debit : '', r.credit > 0 ? r.credit : '', r.flags.map(x => x.label).join('; '), REVIEW[r.review_status]]) }); }
    else if (k === 'recon') {
      if (!f.account_id) throw new Error('Choose one bank account in the filter for the reconciliation summary'); R.title = 'BANK RECONCILIATION SUMMARY';
      const S = await api('/api/ba/recon-summary?' + qs({ account_id: f.account_id, as_of: f.to || today(), tol: BA.rc.tol, other: BA.rc.other })); R.to = S.as_of;
      R.summary = [['Statement closing balance', S.statement_closing], ['Deposits in transit', S.deposits_in_transit], ['Outstanding cheques', S.outstanding_cheques], ['Adjusted bank balance', S.adjusted_bank], ['Cash book closing balance', S.book_closing], ['Bank charges not in book', S.charges_not_in_book], ['Other bank debits not in book', S.other_debits_not_in_book], ['Direct credits not in book', S.credits_not_in_book], ['Other adjustments', S.other_adjustments], ['Adjusted book balance', S.adjusted_book], ['Reconciliation difference', S.difference]];
      R.note = 'Statement Analysis and Bank Reconciliation are different checks: a statement can be arithmetically correct and still differ from the books.';
      const L = (h, rs, bank) => ({ h, cols: bank ? [['Date'], ['Description'], ['Category'], ['Amount', 1]] : [['Date'], ['Voucher'], ['Cheque'], ['Party / narration'], ['Amount', 1]], rows: rs.map(x => bank ? [fdate(x.date), x.description || '', x.category, x.amount] : [fdate(x.date), x.voucher_no, x.cheque_no || '', x.party || x.narration || '', x.amount]) });
      R.sections.push(L('Outstanding cheques', S.lists.outstanding), L('Deposits in transit', S.lists.transit), L('Bank charges not recorded in the book', S.lists.charges, 1), L('Other bank debits not in the book', S.lists.other_debits, 1), L('Direct bank credits not recorded in the book', S.lists.credits, 1)); R.closing = S.adjusted_bank;
    }
    if (R.closing === undefined) R.closing = c.closing; return R;
  }
  const cell = (v, c) => (typeof v === 'number' && c[1] ? fmt(v) : esc(v ?? ''));
  async function outReport(R, kind) {
    const nm = R.kind + '-' + (R.to || today());
    if (kind === 'csv') return csv(`bank-${nm}.csv`, [[R.title], ['Bank', R.bank, 'Branch', R.branch], ['Account', R.account], ['Period', R.from, R.to], ...(R.note ? [[R.note]] : []), [], ...R.summary.map(s => [s[0], s[1]]), ...R.sections.flatMap(s => [[], [s.h], s.cols.map(c => c[0]), ...s.rows.map(r => r.map(v => v ?? '')), ...(s.foot ? [s.foot] : [])])]);
    if (kind === 'xlsx') {
      await U.loadXlsx(); const wb = XLSX.utils.book_new(), sh = (name, rows) => { const ws = XLSX.utils.aoa_to_sheet(rows); ws['!cols'] = [{ wch: 34 }, { wch: 40 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 28 }, { wch: 18 }]; XLSX.utils.book_append_sheet(wb, ws, name.replace(/[\\/?*[\]:]/g, ' ').slice(0, 31)); };
      sh('Summary', [[R.title], ['Bank', R.bank, 'Branch', R.branch], ['Account', R.account], ['Period', R.from, R.to], [], ...R.summary.map(s => [s[0], s[1]])]);
      const used = new Set(['Summary']); R.sections.forEach((s, i) => { let n = s.h.slice(0, 28); while (used.has(n)) n = s.h.slice(0, 25) + ' ' + (i + 1); used.add(n); sh(n, [s.cols.map(c => c[0]), ...s.rows, ...(s.foot ? [s.foot] : [])]); });
      return XLSX.writeFile(wb, `bank-${nm}.xlsx`);
    }
    const c = await getCompany(), money_ = v => (v[2] === 'int' ? v[1] : tk(v[1]));
    const html = `<div class="pd-band"><span>${esc(R.bank || 'Bank')}${R.branch ? ' · ' + esc(R.branch) : ''}</span><span>${esc(R.account)}</span></div><div class="pd-band"><span>Period: ${R.from ? fdate(R.from) : ''} – ${R.to ? fdate(R.to) : ''}</span><span>Generated: ${fdate(today())}</span></div>${R.note ? `<p class="muted">${esc(R.note)}</p>` : ''}
      <div class="pd-grid">${R.summary.map(s => `<div><span>${esc(s[0])}</span><b>${money_(s)}</b></div>`).join('')}</div>
      ${R.sections.map(s => `<div class="pd-card mb"><div class="h"><span>${esc(s.h)}</span><span>${s.rows.length} line${s.rows.length === 1 ? '' : 's'}</span></div><table class="pd-tbl compact"><thead><tr>${s.cols.map(c => `<th class="${c[1] ? 'n' : ''}">${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${s.rows.map(r => `<tr>${r.map((v, i) => `<td class="${s.cols[i][1] ? 'n' : ''}">${cell(v, s.cols[i])}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${s.cols.length}" class="muted">None</td></tr>`}${s.foot ? `<tr class="tot">${s.foot.map((v, i) => `<td class="n" style="${i === 0 ? 'text-align:left' : ''};font-weight:700">${cell(v, s.cols[i])}</td>`).join('')}</tr>` : ''}</tbody></table></div>`).join('')}
      <div class="pd-band"><span>Closing balance</span><span>${tk(R.closing)}</span></div><div class="pd-sign"><div>Prepared by</div><div>Checked by</div><div>Authorized by</div></div>`;
    pvOpen({ title: R.title, key: 'bankanalysis', keyLabel: 'bank analysis reports', docs: [pdocSync(c, R.title, `${R.bank || ''} · ${R.account}`, html, { foot: 'Computer-generated report.', dense: true })] });
  }
})();
