/* Inter-Account Transfers: bank <-> bank, bank <-> petty cash, petty cash <-> petty cash.
   Entry form (with imprest helper, bank charges and "funds in transit"), register, in-transit list, summary and replenishment history.
   Everything is posted through /api/transfers as ordinary vouchers, so the books and the trial balance stay in step. */
(function () {
  const PUR = { cash_withdrawal: 'Cash withdrawal for petty cash', cash_deposit: 'Cash deposit to bank', bank_bank: 'Bank to bank transfer', petty_petty: 'Petty cash to petty cash', replenish: 'Imprest replenishment', other: 'Other transfer' };
  const MODE = { cash: 'Cash', cheque: 'Cheque', rtgs: 'RTGS', beftn: 'BEFTN / EFTN', online: 'Online / NPSB', payorder: 'Pay order', other: 'Other' };
  const PRESET_MODE = { cash_withdrawal: 'cheque', replenish: 'cheque', cash_deposit: 'cash', bank_bank: 'rtgs', petty_petty: 'cash', other: 'cash' };
  const ST = { posted: ['Posted', 'ok'], in_transit: ['In transit', 'warn'], received: ['Received', 'ok'], cancelled: ['Cancelled', 'bad'], legacy: ['Legacy contra', ''] };
  const stBadge = s => `<span class="badge ${ST[s] ? ST[s][1] : ''}">${ST[s] ? ST[s][0] : esc(s)}</span>`;
  const STALE_DAYS = 7;
  const dayDiff = (a, b) => Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10)) - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 864e5);
  const isCB = a => a.kind === 'cash' || a.kind === 'bank';
  const accName = id => { const a = ACC.find(x => String(x.id) === String(id)); return a ? `${a.code} · ${a.name}` : ''; };
  const optsBal = (list, sel, bal, ph) => `<option value="">${ph}</option>` + list.map(a => `<option value="${a.id}" ${String(a.id) === String(sel) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}${a.kind === 'cash' ? ' (petty cash)' : ''} — ${bal[a.id] === undefined ? '' : '৳ ' + fmt(bal[a.id])}</option>`).join('');
  const clr = (label, d) => (d === undefined ? '' : `<div class="muted" style="font-size:12px">${label}: ${d ? '✔ ' + esc(fdate(d)) : 'not cleared'}</div>`);

  // ================= entry form =================
  let F = null, CHK = null;
  const blank = meta => ({ id: null, status: '', sent_date: today(), from: '', to: '', amount: '', purpose: 'bank_bank', mode: 'rtgs', ref_no: '', party: '', narration: '', in_transit: false,
    charge_amount: '', vat_amount: '', charge_account_id: meta.charge_account_id || '', vat_account_id: meta.vat_account_id || '', charge_from_id: '', charges_open: false, meta });
  function applyPreset(p) {
    const list = ACC.filter(a => a.active && isCB(a)), by = k => list.filter(a => a.kind === k), kind = id => (ACC.find(a => String(a.id) === String(id)) || {}).kind;
    const need = { cash_withdrawal: ['bank', 'cash'], replenish: ['bank', 'cash'], cash_deposit: ['cash', 'bank'], bank_bank: ['bank', 'bank'], petty_petty: ['cash', 'cash'], other: [null, null] }[p];
    F.purpose = p; F.mode = PRESET_MODE[p];
    if (need[0] && kind(F.from) !== need[0]) F.from = (by(need[0])[0] || {}).id || '';
    if (need[1] && (kind(F.to) !== need[1] || String(F.to) === String(F.from))) F.to = (by(need[1]).find(a => String(a.id) !== String(F.from)) || {}).id || '';
    if (p === 'replenish') suggest(true);
  }
  function suggest(fill) {
    const lim = F.meta.imprest_limit, bal = F.meta.balances[F.to];
    if (!(lim > 0) || bal === undefined) return null;
    const s = Math.max(0, Math.round((lim - bal) * 100) / 100);
    if (fill && s > 0 && !F.amount) F.amount = String(s);
    return s;
  }
  function sync() {
    if (!$('#xfd')) return;
    const g = id => ($(id) ? $(id).value : '');
    Object.assign(F, { sent_date: g('#xfd'), from: g('#xff'), to: g('#xft'), amount: g('#xfa').trim(), mode: g('#xfm'), ref_no: g('#xfr'), party: g('#xfp'), narration: g('#xfn'),
      charge_amount: g('#xfc').trim(), vat_amount: g('#xfv').trim(), charge_account_id: g('#xfca'), vat_account_id: g('#xfva'), charge_from_id: g('#xfcf') });
    if ($('#xfi')) F.in_transit = $('#xfi').checked;
  }
  window.vTransfer = async function (arg) {
    head('Inter-Account Transfer');
    const meta = await api('/api/transfers/meta');
    F = blank(meta);
    if (typeof arg === 'number' || (typeof arg === 'string' && arg)) {
      const t = await api('/api/transfers/' + arg);
      if (!['posted', 'in_transit'].includes(t.status)) { toast('Only a posted or in-transit transfer can be edited', true); return window.vTransfers(); }
      if (t.any_cleared) { toast('This transfer is cleared in the Bank Book, so it cannot be edited', true); return window.vTransfers(); }
      Object.assign(F, { id: t.id, no: t.transfer_no, status: t.status, sent_date: t.sent_date, from: t.from_account_id, to: t.to_account_id, amount: String(t.amount), purpose: t.purpose, mode: t.mode, ref_no: t.ref_no || '', party: t.party || '',
        narration: t.narration || '', in_transit: t.status === 'in_transit', charge_amount: t.charge_amount ? String(t.charge_amount) : '', vat_amount: t.vat_amount ? String(t.vat_amount) : '', charge_account_id: t.charge_account_id || meta.charge_account_id || '', vat_account_id: t.vat_account_id || meta.vat_account_id || '', charge_from_id: t.charge_from_id || '', charges_open: !!(t.charge_amount || t.vat_amount) });
    } else { applyPreset(F.purpose); if (arg && arg.preset) applyPreset(arg.preset); }
    drawForm();
  };
  function drawForm() {
    const M = F.meta, bal = M.balances, edit = !!F.id;
    const keep = edit ? [+F.from, +F.to] : [];
    const list = ACC.filter(a => isCB(a) && (a.active || keep.includes(a.id)));
    if (list.length < 2) { $('#view').innerHTML = '<h2>Inter-Account Transfer</h2><div class="card">You need at least two bank or petty cash accounts. Add them in Chart of Accounts (kind “Bank account” or “Petty cash / cash”).</div>'; return; }
    const expAcc = ACC.filter(a => a.active && a.type === 'expense');
    const sug = F.purpose === 'replenish' ? suggest(false) : null, toA = ACC.find(a => String(a.id) === String(F.to));
    const payer = [F.from, F.to].filter(Boolean).map(id => `<option value="${id}" ${String(F.charge_from_id || F.from) === String(id) ? 'selected' : ''}>${esc(accName(id))}</option>`).join('');
    $('#view').innerHTML = `<h2>${edit ? 'Edit transfer ' + esc(F.no) : 'Inter-Account Transfer'}</h2>
    <div class="card">
      ${edit ? '' : `<div class="cqtabs" id="xfpre">${Object.entries(PUR).map(([k, l]) => `<button type="button" data-p="${k}" class="${F.purpose === k ? 'on' : ''}">${l}</button>`).join('')}</div>`}
      ${edit ? `<div class="row"><div><label>Purpose</label><select id="xfpu">${Object.entries(PUR).map(([k, l]) => `<option value="${k}" ${F.purpose === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>` : ''}
      <div class="row"><div><label>Date</label><input type="date" id="xfd" value="${esc(F.sent_date)}"></div>
        <div class="grow"><label>From account</label><select id="xff">${optsBal(list, F.from, bal, 'Select account')}</select></div>
        <div class="grow"><label>To account</label><select id="xft">${optsBal(list, F.to, bal, 'Select account')}</select></div>
        <div><label>Amount (৳)</label><input id="xfa" inputmode="decimal" placeholder="0.00" value="${esc(F.amount)}" style="width:150px"></div></div>
      ${F.purpose === 'replenish' && sug !== null ? `<div class="xf-help">Imprest limit <b>${money(M.imprest_limit)}</b> · ${esc(toA ? toA.name : 'petty cash')} now <b>${money(bal[F.to] || 0)}</b> · to top up: <b>${money(sug)}</b> <button type="button" class="btn ghost sm" id="xfsug">Use ${fmt(sug)}</button></div>` : ''}
      <div class="row"><div><label>Mode</label><select id="xfm">${Object.entries(MODE).map(([k, l]) => `<option value="${k}" ${F.mode === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
        <div class="grow"><label>Cheque / reference no</label><input id="xfr" value="${esc(F.ref_no)}" maxlength="40"></div>
        <div class="grow"><label>Person / party (optional)</label><input id="xfp" value="${esc(F.party)}" maxlength="150" placeholder="e.g. cashier who collected the cash"></div></div>
      <div class="row"><div class="grow"><label>Narration</label><input id="xfn" value="${esc(F.narration)}" maxlength="300"></div></div>
      <div class="row"><label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="xfi" ${F.in_transit ? 'checked' : ''} ${edit ? 'disabled' : ''}> <span><b>Funds in transit</b> — money has left the From account but has not reached the To account yet. You will mark it received later.</span></label></div>
      <details id="xfcd" ${F.charges_open ? 'open' : ''}><summary style="cursor:pointer;font-weight:600;margin-bottom:8px">Bank charges on this transfer (optional)</summary>
        <div class="row"><div><label>Bank charge (৳)</label><input id="xfc" inputmode="decimal" value="${esc(F.charge_amount)}" style="width:120px"></div><div><label>VAT (৳)</label><input id="xfv" inputmode="decimal" value="${esc(F.vat_amount)}" style="width:120px"></div>
          <div class="grow"><label>Charge account</label><select id="xfca">${opts(expAcc, F.charge_account_id, 'Select expense account')}</select></div>
          <div class="grow"><label>VAT account</label><select id="xfva">${opts(expAcc, F.vat_account_id, 'Same as charge account')}</select></div>
          <div class="grow"><label>Charges paid from</label><select id="xfcf">${payer}</select></div></div>
        <div class="muted" style="margin:-4px 0 10px">Charges are posted as a separate bank (or cash) payment voucher. They are an expense and are not part of the transferred amount.</div></details>
      <div id="xfw"></div>
      <div class="actions" style="margin-top:12px"><button class="btn" id="xfs">${edit ? 'Save changes' : 'Save transfer'}</button>${edit ? '' : '<button class="btn ghost" id="xfs2">Save & new</button>'}<button class="btn ghost" id="xfx">${edit ? 'Cancel' : 'Transfer register'}</button></div>
    </div>`;
    wire(); liveCheck();
  }
  function wire() {
    const redraw = () => { sync(); drawForm(); };
    document.querySelectorAll('#xfpre [data-p]').forEach(b => b.onclick = () => { sync(); applyPreset(b.dataset.p); drawForm(); });
    if ($('#xfpu')) $('#xfpu').onchange = e => { sync(); F.purpose = e.target.value; drawForm(); };
    $('#xff').onchange = () => { sync(); if (String(F.from) === String(F.to)) F.to = ''; drawForm(); };
    $('#xft').onchange = redraw; $('#xfi').onchange = () => { sync(); liveCheck(); };
    if ($('#xfsug')) $('#xfsug').onclick = () => { sync(); F.amount = String(suggest(false)); drawForm(); };
    ['#xfd', '#xfa', '#xfc', '#xfv', '#xfcf'].forEach(s => { if ($(s)) $(s).oninput = () => { sync(); clearTimeout(CHK); CHK = setTimeout(liveCheck, 300); }; });
    $('#xfs').onclick = () => save(false); if ($('#xfs2')) $('#xfs2').onclick = () => save(true);
    $('#xfx').onclick = () => (F.id ? window.vTransfers() : go('xfers'));
  }
  async function liveCheck() {
    sync(); const box = $('#xfw'); if (!box) return;
    try {
      const r = await api('/api/transfers/check', { method: 'POST', body: { sent_date: F.sent_date, from_account_id: F.from, to_account_id: F.to, amount: F.amount, in_transit: F.in_transit, charge_amount: F.charge_amount, vat_amount: F.vat_amount, charge_from_id: F.charge_from_id || F.from, exclude_id: F.id } });
      if (!$('#xfw')) return;
      const b = r.balances || {}, bits = [];
      if (b[F.from] !== undefined) bits.push(`${esc(accName(F.from))}: <b>${money(b[F.from])}</b>`);
      if (b[F.to] !== undefined) bits.push(`${esc(accName(F.to))}: <b>${money(b[F.to])}</b>`);
      box.innerHTML = (bits.length ? `<div class="muted">Balance on ${esc(fdate(F.sent_date))} — ${bits.join(' &nbsp;·&nbsp; ')}</div>` : '') + (r.warnings || []).map(w => `<div class="xf-warn">⚠ ${esc(w)}</div>`).join('');
    } catch (e) { /* the live hint is optional */ }
  }
  async function save(again) {
    sync();
    const body = { sent_date: F.sent_date, from_account_id: F.from, to_account_id: F.to, amount: F.amount, purpose: F.purpose, mode: F.mode, ref_no: F.ref_no, party: F.party, narration: F.narration, in_transit: F.in_transit,
      charge_amount: F.charge_amount, vat_amount: F.vat_amount, charge_account_id: F.charge_account_id, vat_account_id: F.vat_account_id, charge_from_id: F.charge_from_id || F.from };
    try {
      const r = await lockApi(F.id ? '/api/transfers/' + F.id : '/api/transfers', { method: F.id ? 'PUT' : 'POST', body });
      savedDlg(r, again, !!F.id);
    } catch (e) { toast(e.message, true); }
  }
  function savedDlg(r, again, edited) {
    modal(`<h3>✔ Transfer ${esc(r.transfer_no)} ${edited ? 'updated' : 'saved'}</h3>${r.status === 'in_transit' ? '<p class="muted">The money is recorded as <b>in transit</b>. Open the Transfer Register → In transit and press “Mark received” when it reaches the other account.</p>' : ''}
      ${(r.warnings || []).map(w => `<div class="xf-warn">⚠ ${esc(w)}</div>`).join('')}
      <div class="actions" style="margin-top:12px"><button class="btn" id="sv1">🖨 Print voucher</button><button class="btn ghost" id="sv2">New transfer</button><button class="btn ghost" id="sv3">Transfer register</button></div>`);
    $('#sv1').onclick = () => printTransfer(r.id); $('#sv2').onclick = () => { closeModal(); window.vTransfer(); }; $('#sv3').onclick = () => { closeModal(); go('xfers'); };
    if (again) { closeModal(); toast('Transfer ' + r.transfer_no + ' saved'); window.vTransfer(); }
  }

  // ================= print voucher =================
  async function printTransfer(id) {
    closeModal();
    try {
      const t = await api('/api/transfers/' + id), c = await getCompany(), amt = Number(t.amount), ch = Number(t.charge_amount) + Number(t.vat_amount);
      const grid = [['From account', t.from.name], ['To account', t.to.name], ['Purpose', t.purpose_label], ['Mode', t.mode_label], ['Cheque / ref no.', t.ref_no], ['Person / party', t.party], ['Status', (ST[t.status] || [t.status])[0]], ['Sent / received', fdate(t.sent_date) + (t.received_date ? ' / ' + fdate(t.received_date) : '')]]
        .map(([a, b]) => `<div><span>${a}</span><b>${esc(b || '—')}</b></div>`).join('');
      const vt = (title, v) => !v ? '' : `<div class="pd-card mb"><div class="h"><span>${title} · ${esc(v.voucher_no)} · ${esc(fdate(v.vdate))}</span><span>Debit &nbsp;|&nbsp; Credit (Tk.)</span></div><table class="pd-tbl"><tbody>${v.lines.map(l => `<tr><td>${esc(l.code)} · ${esc(l.name)}</td><td class="n">${l.debit ? fmt(l.debit) : ''}</td><td class="n">${l.credit ? fmt(l.credit) : ''}</td></tr>`).join('')}</tbody></table></div>`;
      const body = `<div class="pd-band"><span>Transfer No.: ${esc(t.transfer_no)}</span><span>Date: ${esc(fdate(t.sent_date))}</span></div><div class="pd-grid">${grid}</div>
        ${vt(t.status === 'in_transit' || t.status === 'received' ? 'Sent' : 'Transfer', t.vouchers.send)}${vt('Received', t.vouchers.receive)}${vt('Bank charges', t.vouchers.charge)}
        <div class="pd-net"><span class="l">Amount transferred</span><span class="v">Tk. ${fmt(amt)}</span></div><div class="pd-words"><small>In words</small>${esc(takaWords(amt))}</div>
        ${ch ? `<div class="pd-text"><h4>Bank charges (not part of the transfer)</h4>Charge Tk. ${fmt(t.charge_amount)}${Number(t.vat_amount) ? ' + VAT Tk. ' + fmt(t.vat_amount) : ''} = Tk. ${fmt(ch)}</div>` : ''}
        ${t.narration ? `<div class="pd-text"><h4>Narration</h4>${esc(t.narration)}</div>` : ''}
        ${t.status === 'cancelled' ? '<div class="pd-text"><h4>CANCELLED</h4>This transfer was cancelled and reversed.</div>' : ''}
        <div class="pd-sign"><div>Prepared by</div><div>Checked by</div><div>Approved by</div><div>Received by</div></div>`;
      pvOpen({ title: 'Transfer ' + t.transfer_no, key: 'voucher', keyLabel: 'vouchers', docs: [pdocSync(c, 'INTER-ACCOUNT TRANSFER VOUCHER', 'Accounts voucher', body, { foot: 'Computer-generated voucher.' })] });
    } catch (e) { toast(e.message, true); }
  }

  // ================= register and reports =================
  const XR = { sub: 'register', from: '', to: '', account: '', status: '', purpose: '', q: '', page: 1, per: 25, sort: 'date', dir: -1, sFrom: '', sTo: '' };
  window.vTransfers = async function (sub) {
    if (sub) XR.sub = sub;
    if (!XR.from) { XR.from = fyStart(); XR.sFrom = fyStart(); XR.sTo = today(); }
    head('Transfer Register');
    const tabs = [['register', 'Register'], ['transit', 'In transit'], ['summary', 'Summary by account'], ['repl', 'Petty cash replenishment']];
    $('#view').innerHTML = `<h2>Inter-Account Transfers</h2><div class="cqtabs noprint">${tabs.map(([k, l]) => `<button data-k="${k}" class="${XR.sub === k ? 'on' : ''}">${l}</button>`).join('')}<button class="btn" id="xnew" style="margin-left:auto">+ New transfer</button></div><div id="xbody"></div>`;
    document.querySelectorAll('.cqtabs [data-k]').forEach(b => b.onclick = () => { XR.sub = b.dataset.k; window.vTransfers(); });
    $('#xnew').onclick = () => go('xfer');
    try { await ({ register: tRegister, transit: tTransit, summary: tSummary, repl: tRepl }[XR.sub])(); } catch (e) { if (e.message !== 'Locked') $('#xbody').innerHTML = `<div class="card err">${esc(e.message)}</div>`; }
  };
  const qs = o => Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
  const cb = () => ACC.filter(isCB);
  const lines = r => `<div>${esc(r.from_name)}</div><div class="muted">→ ${esc(r.to_name)}</div>`;
  function rowHtml(r, act) {
    const open = r.legacy ? `showVoucher(${r.voucher_id})` : `showTransfer(${r.id})`;
    return `<tr class="${act ? 'click' : ''}" ${act ? `onclick="${open}"` : ''}><td>${esc(fdate(r.sent_date))}${r.received_date ? `<div class="muted" style="font-size:12px">rec. ${esc(fdate(r.received_date))}</div>` : ''}</td><td>${esc(r.transfer_no)}</td><td>${lines(r)}</td>
      <td>${esc(r.mode ? MODE[r.mode] : '')}${r.ref_no ? `<div class="muted" style="font-size:12px">${esc(r.ref_no)}</div>` : ''}${r.purpose ? `<div class="muted" style="font-size:12px">${esc(PUR[r.purpose])}</div>` : ''}</td>
      <td class="n"${r.status === 'cancelled' ? ' style="text-decoration:line-through;opacity:.6"' : ''}>${fmt(r.amount)}</td><td class="n">${r.total_charges ? fmt(r.total_charges) : ''}</td><td>${stBadge(r.status)}</td><td>${clr('Out', r.from_cleared)}${clr('In', r.to_cleared)}</td></tr>`;
  }
  const HEAD = '<th data-s="date">Date</th><th data-s="no">No.</th><th>From → To</th><th>Mode / reference</th><th class="n" data-s="amount">Amount</th><th class="n">Charges</th><th>Status</th><th>Bank clearing</th>';
  function csvRows(rows) { return [['Date', 'Received', 'No.', 'From', 'To', 'Purpose', 'Mode', 'Reference', 'Person', 'Amount', 'Charges', 'Status', 'Narration'], ...rows.map(r => [r.sent_date, r.received_date || '', r.transfer_no, r.from_name, r.to_name, r.purpose ? PUR[r.purpose] : 'Legacy contra', r.mode ? MODE[r.mode] : '', r.ref_no || '', r.party || '', r.amount, r.total_charges || 0, (ST[r.status] || [r.status])[0], r.narration || ''])]; }
  async function tRegister() {
    const accs = cb();
    $('#xbody').innerHTML = `<div class="card"><div class="row noprint"><div><label>From</label><input type="date" id="rf" value="${XR.from}"></div><div><label>To</label><input type="date" id="rt" value="${XR.to}"></div>
      <div class="grow"><label>Account</label><select id="ra"><option value="">All accounts</option>${accs.map(a => `<option value="${a.id}" ${String(a.id) === String(XR.account) ? 'selected' : ''}>${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</select></div>
      <div><label>Status</label><select id="rs"><option value="">All</option>${Object.entries(ST).map(([k, v]) => `<option value="${k}" ${XR.status === k ? 'selected' : ''}>${v[0]}</option>`).join('')}</select></div>
      <div><label>Purpose</label><select id="rp"><option value="">All</option>${Object.entries(PUR).map(([k, l]) => `<option value="${k}" ${XR.purpose === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="grow"><label>Search</label><input id="rq" value="${esc(XR.q)}" placeholder="No., cheque / ref, person, narration"></div><button class="btn" id="rgo">Show</button></div><div id="rres"></div></div>`;
    const run = async () => {
      Object.assign(XR, { from: $('#rf').value, to: $('#rt').value, account: $('#ra').value, status: $('#rs').value, purpose: $('#rp').value, q: $('#rq').value.trim() });
      const { rows } = await api('/api/transfers?' + qs({ from: XR.from, to: XR.to, account: XR.account, status: XR.status, purpose: XR.purpose, q: XR.q }));
      draw(rows);
    };
    const draw = rows => {
      const live = rows.filter(r => r.status !== 'cancelled'), tot = live.reduce((s, r) => s + Math.round(r.amount * 100), 0), chg = live.reduce((s, r) => s + Math.round((r.total_charges || 0) * 100), 0);
      const k = XR.sort, d = XR.dir, sorted = rows.slice().sort((a, b) => d * (k === 'amount' ? a.amount - b.amount : k === 'no' ? String(a.transfer_no).localeCompare(b.transfer_no) : a.sent_date < b.sent_date ? -1 : a.sent_date > b.sent_date ? 1 : (a.id || 0) - (b.id || 0)));
      const pages = Math.max(1, Math.ceil(sorted.length / XR.per)); XR.page = Math.min(XR.page, pages);
      const show = sorted.slice((XR.page - 1) * XR.per, XR.page * XR.per);
      $('#rres').innerHTML = `<div class="grid"><div class="stat"><div class="l">Transfers (not cancelled)</div><div class="v">${live.length}</div><div class="s">${rows.length - live.length} cancelled</div></div><div class="stat"><div class="l">Total transferred</div><div class="v">${money(tot / 100)}</div></div><div class="stat"><div class="l">Bank charges + VAT</div><div class="v">${money(chg / 100)}</div></div></div>
        <div class="actions noprint" style="margin-bottom:10px"><button class="btn ghost sm" id="rcsv">Export CSV</button><button class="btn ghost sm" id="rpr">🖨 Print preview</button></div>
        <div class="wrap"><table class="tbl"><thead><tr>${HEAD}</tr></thead><tbody>${show.map(r => rowHtml(r, true)).join('') || '<tr><td colspan="8" class="muted">No transfers found</td></tr>'}</tbody></table></div>
        <div class="actions noprint" style="margin-top:10px;align-items:center"><button class="btn ghost sm" id="rpv" ${XR.page <= 1 ? 'disabled' : ''}>◀</button><span class="muted">Page ${XR.page} of ${pages}</span><button class="btn ghost sm" id="rnx" ${XR.page >= pages ? 'disabled' : ''}>▶</button></div>`;
      document.querySelectorAll('#rres th[data-s]').forEach(th => th.onclick = () => { if (XR.sort === th.dataset.s) XR.dir = -XR.dir; else { XR.sort = th.dataset.s; XR.dir = -1; } draw(rows); });
      $('#rpv').onclick = () => { XR.page--; draw(rows); }; $('#rnx').onclick = () => { XR.page++; draw(rows); };
      $('#rcsv').onclick = () => csv(`transfers-${XR.from || 'all'}-${XR.to || today()}.csv`, csvRows(sorted));
      $('#rpr').onclick = () => {
        const el = document.createElement('div'); el.innerHTML = `<table class="tbl"><thead><tr>${HEAD}</tr></thead><tbody>${sorted.map(r => rowHtml(r, false)).join('')}<tr class="tot"><td colspan="4">Total (not cancelled)</td><td class="n">${fmt(tot / 100)}</td><td class="n">${fmt(chg / 100)}</td><td colspan="2"></td></tr></tbody></table>`;
        pvFromEl(el, 'INTER-ACCOUNT TRANSFER REGISTER', [XR.from && 'From ' + fdate(XR.from), XR.to && 'To ' + fdate(XR.to)].filter(Boolean).join(' · ') || 'All dates');
      };
    };
    $('#rgo').onclick = () => { XR.page = 1; run(); }; $('#rq').onkeydown = e => { if (e.key === 'Enter') { XR.page = 1; run(); } };
    await run();
  }
  async function tTransit() {
    const { rows } = await api('/api/transfers?status=in_transit'), t = today(), total = rows.reduce((s, r) => s + Math.round(r.amount * 100), 0);
    $('#xbody').innerHTML = `<div class="card"><h3>Open transfers in transit</h3><p class="muted">Money that has left one account but is not yet recorded as received in the other. The total here is the balance of the <b>Funds in Transit</b> account.</p>
      <div class="grid"><div class="stat"><div class="l">Open transfers</div><div class="v">${rows.length}</div></div><div class="stat"><div class="l">Amount in transit</div><div class="v">${money(total / 100)}</div></div></div>
      <div class="wrap"><table class="tbl"><thead><tr><th>Sent</th><th>No.</th><th>From → To</th><th>Mode / reference</th><th class="n">Amount</th><th>Open for</th><th class="noprint"></th></tr></thead><tbody>
      ${rows.map(r => { const age = dayDiff(t, r.sent_date); return `<tr><td>${esc(fdate(r.sent_date))}</td><td><a href="#" onclick="showTransfer(${r.id});return false">${esc(r.transfer_no)}</a></td><td>${lines(r)}</td><td>${esc(MODE[r.mode] || '')}${r.ref_no ? ' · ' + esc(r.ref_no) : ''}</td><td class="n">${fmt(r.amount)}</td><td>${age} day${age === 1 ? '' : 's'} ${age > STALE_DAYS ? '<span class="badge bad">over a week</span>' : ''}</td><td class="noprint"><button class="btn sm" data-rc="${r.id}">Mark received</button></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Nothing in transit ✔</td></tr>'}</tbody></table></div>
      <div class="actions noprint" style="margin-top:10px"><button class="btn ghost sm" id="tpr">🖨 Print preview</button></div></div>`;
    document.querySelectorAll('[data-rc]').forEach(b => b.onclick = () => receiveDlg(+b.dataset.rc));
    $('#tpr').onclick = () => pvFromEl($('#xbody .card'), 'TRANSFERS IN TRANSIT', 'As on ' + fdate(t));
  }
  async function tSummary() {
    $('#xbody').innerHTML = `<div class="card"><div class="row noprint"><div><label>From</label><input type="date" id="sf" value="${XR.sFrom}"></div><div><label>To</label><input type="date" id="st" value="${XR.sTo}"></div><button class="btn" id="sgo">Show</button></div><div id="sres"></div></div>`;
    const run = async () => {
      XR.sFrom = $('#sf').value; XR.sTo = $('#st').value;
      const s = await api('/api/transfers/summary?' + qs({ from: XR.sFrom, to: XR.sTo }));
      $('#sres').innerHTML = `<div class="grid"><div class="stat"><div class="l">Transfers sent</div><div class="v">${money(s.sent)}</div><div class="s">${s.count} transfer${s.count === 1 ? '' : 's'}</div></div><div class="stat"><div class="l">Transfers received</div><div class="v">${money(s.received)}</div></div>
        <div class="stat"><div class="l">In transit at end</div><div class="v">${money(s.in_transit.closing)}</div><div class="s">at start ${money(s.in_transit.opening)}</div></div><div class="stat"><div class="l">Bank charges + VAT</div><div class="v">${money(s.charges)}</div></div></div>
        <div class="actions noprint" style="margin-bottom:10px"><span class="badge ${s.check_ok ? 'ok' : 'bad'}">${s.check_ok ? 'Check OK: in transit at start + sent − received = in transit at end' : 'Check failed — please review the transfers'}</span><button class="btn ghost sm" id="spr">🖨 Print preview</button><button class="btn ghost sm" id="scsv">Export CSV</button></div>
        <div class="wrap" id="stbl"><table class="tbl"><thead><tr><th>Account</th><th class="n">Sent (out)</th><th class="n">Received (in)</th><th class="n">Net</th></tr></thead><tbody>
        ${s.accounts.map(a => `<tr><td>${esc(a.code)} · ${esc(a.name)}</td><td class="n">${fmt(a.sent)}</td><td class="n">${fmt(a.received)}</td><td class="n">${fmt(a.net)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No transfers in this period</td></tr>'}
        <tr class="tot"><td>Total</td><td class="n">${fmt(s.sent)}</td><td class="n">${fmt(s.received)}</td><td class="n">${fmt(Math.round((s.received - s.sent) * 100) / 100)}</td></tr></tbody></table></div>
        <p class="muted">Sent equals received except for money still in transit. Cancelled transfers are left out. Includes contra vouchers entered the old way.</p>`;
      $('#spr').onclick = () => pvFromEl('#sres', 'TRANSFER SUMMARY BY ACCOUNT', fdate(XR.sFrom) + ' to ' + fdate(XR.sTo));
      $('#scsv').onclick = () => csv('transfer-summary.csv', [['Account', 'Sent', 'Received', 'Net'], ...s.accounts.map(a => [a.code + ' ' + a.name, a.sent, a.received, a.net]), ['Total', s.sent, s.received, Math.round((s.received - s.sent) * 100) / 100]]);
    };
    $('#sgo').onclick = run; await run();
  }
  async function tRepl() {
    const s = await api('/api/transfers/replenishments?' + qs({ from: XR.from, to: XR.to }));
    $('#xbody').innerHTML = `<div class="card"><h3>Petty cash replenishment history</h3><p class="muted">Money moved into petty cash accounts, against the imprest limit of <b>${money(s.imprest_limit)}</b>. “After” is the closing balance of that day.</p>
      <div class="wrap" id="rtbl"><table class="tbl"><thead><tr><th>Date</th><th>No.</th><th>From</th><th>Petty cash</th><th class="n">Amount</th><th class="n">Before</th><th class="n">After</th><th>Limit</th></tr></thead><tbody>
      ${s.rows.map(r => `<tr><td>${esc(fdate(r.date))}</td><td>${r.legacy ? `<span class="muted">${esc(r.transfer_no)}</span>` : `<a href="#" onclick="showTransfer(${r.id});return false">${esc(r.transfer_no)}</a>`}</td><td>${esc(r.from_name)}</td><td>${esc(r.to_name)}</td><td class="n">${fmt(r.amount)}</td><td class="n">${fmt(r.before)}</td><td class="n">${fmt(r.after)}</td><td>${r.over_limit ? '<span class="badge bad">above limit</span>' : '<span class="badge ok">within</span>'}</td></tr>`).join('') || '<tr><td colspan="8" class="muted">No replenishments in this period (use the filter dates on the Register tab)</td></tr>'}</tbody></table></div>
      <div class="actions noprint" style="margin-top:10px"><button class="btn ghost sm" id="rpr2">🖨 Print preview</button></div></div>`;
    $('#rpr2').onclick = () => pvFromEl('#rtbl', 'PETTY CASH REPLENISHMENT', [XR.from && 'From ' + fdate(XR.from), XR.to && 'To ' + fdate(XR.to)].filter(Boolean).join(' · ') || 'All dates');
  }

  // ================= detail, receive, cancel, delete =================
  window.showTransfer = async function (id) {
    try {
      const t = await api('/api/transfers/' + id), vt = (title, v) => !v ? '' : `<h4 style="margin:12px 0 4px">${title} — <a href="#" onclick="showVoucher(${v.id});return false">${esc(v.voucher_no)}</a> · ${esc(fdate(v.vdate))}</h4><table class="tbl"><tbody>${v.lines.map(l => `<tr><td>${esc(l.code)} · ${esc(l.name)}</td><td class="n">${l.debit ? fmt(l.debit) : ''}</td><td class="n">${l.credit ? fmt(l.credit) : ''}</td></tr>`).join('')}</tbody></table>`;
      const live = ['posted', 'in_transit'].includes(t.status);
      modal(`<h3>${esc(t.transfer_no)} · ${esc(t.purpose_label)} ${stBadge(t.status)}</h3>
        <div class="muted">${esc(fdate(t.sent_date))}${t.received_date ? ' → received ' + esc(fdate(t.received_date)) : ''} · ${esc(t.mode_label)}${t.ref_no ? ' · ' + esc(t.ref_no) : ''}${t.party ? ' · ' + esc(t.party) : ''}</div>
        <p><b>${esc(t.from.name)}</b> → <b>${esc(t.to.name)}</b> · <b>${money(t.amount)}</b>${Number(t.charge_amount) + Number(t.vat_amount) ? ` · charges ${money(Number(t.charge_amount) + Number(t.vat_amount))}` : ''}</p>${t.narration ? `<p>${esc(t.narration)}</p>` : ''}
        ${vt(t.status === 'posted' ? 'Transfer voucher' : 'Sent', t.vouchers.send)}${vt('Received', t.vouchers.receive)}${vt('Bank charges', t.vouchers.charge)}
        ${t.any_cleared ? '<p class="muted">Part of this transfer is cleared in the Bank Book, so it cannot be edited or cancelled until the cleared date is removed.</p>' : ''}
        <details style="margin-top:12px"><summary style="cursor:pointer">History (${t.log.length})</summary><table class="tbl"><tbody>${t.log.map(l => `<tr><td>${esc(l.created_at)}</td><td>${esc(l.action)}</td><td class="muted" style="font-size:12px;word-break:break-all">${esc((l.detail || '').slice(0, 200))}</td></tr>`).join('')}</tbody></table></details>
        <div class="actions noprint" style="margin-top:14px">${live && !t.any_cleared ? '<button class="btn" id="dEdit">Edit</button>' : ''}${t.status === 'in_transit' ? '<button class="btn" id="dRec">Mark received</button>' : ''}<button class="btn ghost" id="dPrint">🖨 Print voucher</button>
        ${['posted', 'in_transit', 'received'].includes(t.status) ? '<button class="btn red" id="dCan">Cancel transfer</button>' : ''}${live ? '<button class="btn red ghost" id="dDel">Delete</button>' : ''}<button class="btn ghost" onclick="closeModal()">Close</button></div>`);
      const on = (i, f) => { if ($(i)) $(i).onclick = f; };
      on('#dEdit', () => { closeModal(); go('xfer', t.id); }); on('#dRec', () => receiveDlg(t.id)); on('#dPrint', () => printTransfer(t.id)); on('#dCan', () => cancelDlg(t)); on('#dDel', () => deleteDlg(t));
    } catch (e) { toast(e.message, true); }
  };
  async function receiveDlg(id) {
    const t = await api('/api/transfers/' + id);
    modal(`<h3>Mark ${esc(t.transfer_no)} received</h3><p>${money(t.amount)} from <b>${esc(t.from.name)}</b> to <b>${esc(t.to.name)}</b>, sent ${esc(fdate(t.sent_date))}.</p>
      <div class="row"><div><label>Date received</label><input type="date" id="rcd" value="${today() < t.sent_date ? t.sent_date : today()}" min="${esc(t.sent_date)}"></div></div>
      <div class="actions"><button class="btn" id="rcok">Mark received</button><button class="btn ghost" onclick="closeModal()">Cancel</button></div>`);
    $('#rcok').onclick = async () => { try { await lockApi(`/api/transfers/${id}/receive`, { method: 'POST', body: { received_date: $('#rcd').value } }); closeModal(); toast('Marked received'); window.vTransfers(); } catch (e) { toast(e.message, true); } };
  }
  function cancelDlg(t) {
    modal(`<h3>Cancel ${esc(t.transfer_no)}?</h3><p>Reversing entries are posted so both accounts return to where they were. The original entries stay in the books for the audit trail, and a cancelled transfer cannot be restored.</p>
      <div class="row"><div><label>Date of reversal</label><input type="date" id="cnd" value="${today()}"></div></div>
      <div class="actions"><button class="btn red" id="cnok">Yes, cancel this transfer</button><button class="btn ghost" onclick="closeModal()">Keep it</button></div>`);
    $('#cnok').onclick = async () => { try { await lockApi(`/api/transfers/${t.id}/cancel`, { method: 'POST', body: { date: $('#cnd').value } }); closeModal(); toast('Transfer cancelled'); window.vTransfers(); } catch (e) { toast(e.message, true); } };
  }
  function deleteDlg(t) {
    modal(`<h3>Delete ${esc(t.transfer_no)}?</h3><p>This removes the transfer and its vouchers completely (only a transfer nobody has cleared yet can be deleted). If it was a real movement of money, use <b>Cancel transfer</b> instead so the history is kept. The deletion is recorded in the audit log.</p>
      <div class="actions"><button class="btn red" id="dlok">Yes, delete</button><button class="btn ghost" onclick="closeModal()">No</button></div>`);
    $('#dlok').onclick = async () => { try { await lockApi('/api/transfers/' + t.id, { method: 'DELETE' }); closeModal(); toast('Transfer deleted'); window.vTransfers(); } catch (e) { toast(e.message, true); } };
  }
  window.printTransfer = printTransfer;
})();
