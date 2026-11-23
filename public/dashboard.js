/* Famous Accounts - interactive dashboard.
   Read-only apart from "Quick entry", which saves one normal voucher through the same /api/vouchers route as the New Voucher screen. */
(function () {
  const SECTIONS = [['attention', 'Needs attention'], ['cards', 'Summary cards'], ['actions', 'Quick buttons'], ['trend', 'Daily balance chart'], ['topexp', 'Top expenses'], ['monthly', 'Income vs expense by month'], ['quick', 'Quick entry'], ['checklist', 'Month-end checklist'], ['recent', 'Recent vouchers']];
  const CARDS = [['cash', 'Petty cash'], ['bank', 'Bank balance'], ['expense', 'Expenses'], ['income', 'Income'], ['lock', 'Books closed up to'], ['transit', 'Funds in transit'], ['recurring', 'Recurring vouchers due'], ['tb', 'Trial balance']];
  const PRESETS = [['today', 'Today'], ['month', 'This month'], ['lastmonth', 'Last month'], ['quarter', 'This quarter'], ['fy', 'This fiscal year'], ['custom', 'Custom']];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const ls = { get(k, d) { try { const v = JSON.parse(localStorage.getItem(k)); return v === null ? d : v; } catch (e) { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* ignore */ } } };
  let P = ls.get('fa_dash_period', { preset: 'month', from: '', to: '' });
  if (!PRESETS.some(p => p[0] === P.preset)) P = { preset: 'month', from: '', to: '' };
  let CFG = ls.get('fa_dash_cfg', {});
  const normCfg = () => {
    const known = SECTIONS.map(s => s[0]), order = (Array.isArray(CFG.order) ? CFG.order : []).filter(k => known.includes(k));
    known.forEach(k => { if (!order.includes(k)) order.push(k); });
    CFG = { order, hide: (CFG.hide || []).filter(k => known.includes(k)), hideCards: (CFG.hideCards || []).filter(k => CARDS.some(c => c[0] === k)) };
  };
  normCfg();
  let CUR = null, timer = null, qe = { kind: 'pay' }, updatedAt = '';

  // ---------- dates ----------
  const D = s => new Date(s + 'T00:00:00Z'), iso = d => d.toISOString().slice(0, 10);
  const addD = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const addM = (s, n) => { const d = D(s), day = d.getUTCDate(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); d.setUTCDate(Math.min(day, last)); return iso(d); };
  const eom = s => iso(new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7), 0)));
  const span = (a, b) => Math.round((D(b) - D(a)) / 864e5) + 1;
  function fyOf(date) { const [m, d] = (SET.fiscal_start || '07-01').split('-'), y = +date.slice(0, 4), s = `${y}-${m}-${d}`; return s <= date ? s : `${y - 1}-${m}-${d}`; }
  function range() {
    const t = today(); let from, to, pfrom, pto;
    if (P.preset === 'today') { from = to = t; pfrom = pto = addD(t, -1); }
    else if (P.preset === 'lastmonth') { from = addM(t.slice(0, 8) + '01', -1); to = eom(from); pfrom = addM(from, -1); pto = eom(pfrom); }
    else if (P.preset === 'quarter' || P.preset === 'fy') {
      let s = fyOf(t); if (P.preset === 'quarter') while (addM(s, 3) <= t) s = addM(s, 3);
      from = s; to = t; pfrom = addM(s, P.preset === 'fy' ? -12 : -3); pto = addD(pfrom, span(from, to) - 1); if (pto > addD(from, -1)) pto = addD(from, -1);
    }
    else if (P.preset === 'custom') {
      from = P.from || t.slice(0, 8) + '01'; to = P.to || t; if (from > to) [from, to] = [to, from];
      pto = addD(from, -1); pfrom = addD(pto, -(span(from, to) - 1));
    }
    else { from = t.slice(0, 8) + '01'; to = t; pfrom = addM(from, -1); pto = addM(t, -1); }
    return { from, to, pfrom, pto };
  }

  // ---------- small helpers ----------
  const short = n => { const a = Math.abs(n), s = n < 0 ? '-' : ''; return a >= 1e7 ? s + (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + ' Cr' : a >= 1e5 ? s + (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + ' L' : a >= 1e3 ? s + (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'k' : s + Math.round(a); };
  const dm = s => +s.slice(8, 10) + ' ' + MON[+s.slice(5, 7) - 1];
  const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  function cmp(cur, prev, mode) {   // mode: 'good-up' (income), 'bad-up' (expense) or '' (neutral)
    const dl = r2(cur - prev); if (!dl) return '<div class="cmp">No change vs previous period</div>';
    const up = dl > 0, cls = mode === 'good-up' ? (up ? 'ok' : 'bad') : mode === 'bad-up' ? (up ? 'bad' : 'ok') : '', pct = prev ? ' (' + Math.round(Math.abs(dl) / Math.abs(prev) * 100) + '%)' : '';
    return `<div class="cmp ${cls}">${up ? '▲' : '▼'} ${fmt(Math.abs(dl))}${pct} vs previous period</div>`;
  }
  function nice(lo, hi, n) {   // round axis limits and tick values (0 is always a tick when it is inside the range)
    const raw = (hi - lo) / n || 1, p = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / p, st = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
    const a = Math.floor(lo / st + 1e-9) * st, b = Math.ceil(hi / st - 1e-9) * st, ticks = [];
    for (let v = a; v <= b + st / 2; v += st) ticks.push(Math.round(v / st) * st);
    return { lo: a, hi: b, ticks };
  }
  const W = 640, H = 250, L = 56, R = 12, T = 12, B = 26;
  function trendScale(t) {
    const n = t.dates.length, all = [...t.cash, ...t.bank], nz = nice(Math.min(...all, 0), Math.max(...all, 0) || 1, 4), lo = nz.lo, hi = nz.hi;
    return { n, lo, hi, ticks: nz.ticks, X: i => L + (W - L - R) * i / (n - 1), Y: v => T + (H - T - B) * (1 - (v - lo) / (hi - lo)) };
  }
  const dateOk = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

  // ---------- data ----------
  async function load() {
    const r = range(), q = new URLSearchParams({ from: r.from, to: r.to, pfrom: r.pfrom, pto: r.pto, fy: fyOf(r.to) });
    const [d, x] = await Promise.all([api('/api/dashboard'), api('/api/dashboard/extra?' + q)]);
    CUR = { d, x, r }; const n = new Date(); updatedAt = String(n.getHours()).padStart(2, '0') + ':' + String(n.getMinutes()).padStart(2, '0');
  }

  // ---------- sections ----------
  function attention() {
    const { d, x } = CUR, a = x.attention, items = [], neg = [...x.cash, ...x.banks].filter(b => b.balance < 0);
    neg.forEach(b => items.push(['bad', '⛔', `<b>${esc(b.name)}</b> is below zero (${money(b.balance)}). Check opening balances and entries.`, { v: x.cash.some(c => c.id === b.id) ? 'cashbook' : 'bankbook' }]));
    if (!d.balanced) items.push(['bad', '⛔', `Trial balance is <b>not balanced</b> (difference ${fmt(d.difference)}).`, { v: 'tb' }]);
    if (d.backup && d.backup.warn) items.push(['bad', '⚠', `<b>Backup:</b> ${esc(d.backup.warn)}`, { v: 'settings' }]);
    if (d.recurring_due) items.push(['warn', '⏰', `<b>${d.recurring_due}</b> recurring voucher${d.recurring_due === 1 ? '' : 's'} due, waiting for your approval.`, { v: 'recurring' }]);
    const cashTotal = x.cash_total, lim = +d.imprest_limit || 0;
    if (lim && cashTotal > lim) items.push(['warn', '💵', `Petty cash in hand (${money(cashTotal)}) is above the imprest limit (${money(lim)}).`, { v: 'cashbook' }]);
    if (a.cheques_open.stale) items.push(['warn', '🖨', `<b>${a.cheques_open.stale}</b> cheque${a.cheques_open.stale === 1 ? ' is' : 's are'} over 6 months old and not cleared.`, { v: 'chq' }]);
    if (a.transit_stale.count) items.push(['warn', '🔁', `<b>${a.transit_stale.count}</b> transfer${a.transit_stale.count === 1 ? '' : 's'} (${money(a.transit_stale.amount)}) in transit for more than 7 days.`, { v: 'xfers', a: 'transit' }]);
    if (a.uncleared.count) items.push(['warn', '🏦', `<b>${a.uncleared.count}</b> bank entr${a.uncleared.count === 1 ? 'y' : 'ies'} (${money(a.uncleared.amount)}) not cleared for over 30 days.`, { v: 'recon' }]);
    if (a.cheques_open.count) items.push(['info', '🧾', `${a.cheques_open.count} cheque${a.cheques_open.count === 1 ? '' : 's'} issued and not yet cleared (${money(a.cheques_open.amount)}).`, { v: 'chq' }]);
    if (d.backup && !d.backup.warn && d.backup.tip) items.push(['info', '💾', esc(d.backup.tip), { v: 'settings' }]);
    const bad = items.filter(i => i[0] !== 'info').length;
    return `<details class="card dsec" open><summary><h3>Needs attention ${bad ? `<span class="badge bad">${bad}</span>` : '<span class="badge ok">All clear</span>'}</h3></summary>
      ${items.length ? `<div class="alist">${items.map(i => `<div class="aitem ${i[0]}" tabindex="0" role="button" data-do="go" data-v="${i[3].v}" ${i[3].a ? `data-a="${i[3].a}"` : ''}><span>${i[1]}</span><span>${i[2]}</span><span class="go">›</span></div>`).join('')}</div>` : '<p class="muted" style="margin:6px 0 0">Nothing needs your attention right now. ✔</p>'}</details>`;
  }
  function cards() {
    const { d, x } = CUR, hide = CFG.hideCards, lim = +d.imprest_limit || 0, c = x.cash_total, out = [];
    const card = (id, label, value, sub, go) => { if (hide.includes(id)) return; out.push(`<div class="stat dcard" tabindex="0" role="button" data-do="${go.do}" ${go.v ? `data-v="${go.v}"` : ''} ${go.a ? `data-a="${go.a}"` : ''}><div class="l">${label}</div><div class="v">${value}</div>${sub}</div>`); };
    const pct = lim ? Math.max(0, c) / lim * 100 : 0, mcls = !lim ? '' : c > lim ? 'bad' : pct < 20 ? 'warn' : 'ok';
    card('cash', 'Petty cash in hand', money(c), `${cmp(c, x.cash_prev, '')}${lim ? `<div class="meter" title="Cash in hand compared with the imprest limit"><i class="${mcls}" style="width:${Math.min(100, pct).toFixed(1)}%"></i></div><div class="s">${Math.round(pct)}% of imprest limit ${money(lim)} · replenish ${money(Math.max(0, lim - c))}</div>` : ''}`, { do: 'cash' });
    card('bank', 'Bank balance (book)', money(x.bank_total), `${cmp(x.bank_total, x.bank_prev, '')}<div class="s">${x.banks.map(b => esc(b.name) + ': ' + fmt(b.balance)).join('<br>') || 'No bank accounts'}</div>`, { do: 'bank' });
    card('expense', 'Expenses', money(x.expense.cur), cmp(x.expense.cur, x.expense.prev, 'bad-up'), { do: 'vouchers' });
    card('income', 'Income', money(x.income.cur), cmp(x.income.cur, x.income.prev, 'good-up'), { do: 'vouchers' });
    card('lock', 'Books closed up to', d.locked_through ? '🔒 ' + esc(d.locked_through) : 'Open', `<div class="s">${d.locked_through ? 'Editing needs the lock password' : 'No month is closed yet'}</div>`, { do: 'go', v: 'settings' });
    if (d.in_transit && d.in_transit.count) card('transit', 'Funds in transit', money(d.in_transit.amount), `<div class="s">${d.in_transit.count} transfer${d.in_transit.count === 1 ? '' : 's'} not yet received</div>`, { do: 'go', v: 'xfers', a: 'transit' });
    if (d.recurring_due) card('recurring', 'Recurring vouchers due', d.recurring_due, '<div class="s">Waiting for your approval</div>', { do: 'go', v: 'recurring' });
    card('tb', 'Trial balance', `<span class="badge ${d.balanced ? 'ok' : 'bad'}">${d.balanced ? 'Balanced' : 'Difference ' + fmt(d.difference)}</span>`, '', { do: 'go', v: 'tb' });
    return out.length ? `<div class="grid dgrid">${out.join('')}</div>` : '<p class="muted">All summary cards are hidden. Use Customise to show them.</p>';
  }
  const actions = () => `<div class="actions" style="margin-bottom:14px"><button class="btn" onclick="go('voucher','CP')">+ Petty cash payment</button><button class="btn ghost" onclick="go('voucher','CR')">+ Cash receipt</button><button class="btn ghost" onclick="go('xfer')">⇄ Transfer</button><button class="btn ghost" onclick="go('voucher','BP')">+ Bank payment</button><button class="btn ghost" onclick="go('voucher','BR')">+ Bank deposit</button></div>`;

  function trend() {
    const t = CUR.x.trend, n = t.dates.length, title = 'Petty cash and bank balance, day by day';
    if (n < 2) return `<div class="card dsec"><h3>${title}</h3><p class="muted">Choose a period of two days or more to see the trend.</p></div>`;
    const { lo, hi, ticks, X, Y } = trendScale(t);
    const step = arr => 'M' + X(0).toFixed(1) + ' ' + Y(arr[0]).toFixed(1) + arr.slice(1).map((v, i) => 'H' + X(i + 1).toFixed(1) + 'V' + Y(v).toFixed(1)).join('');
    const xt = [0, 1, 2, 3, 4].map(i => Math.round((n - 1) * i / 4));
    return `<div class="card dsec"><h3>${title}</h3><div class="legend"><span><i style="background:var(--c-cash)"></i>Petty cash</span><span><i style="background:var(--c-bank)"></i>Bank</span></div>
      <div class="chart" id="chTrend"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
        ${ticks.map(v => `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${short(v)}</text>`).join('')}
        ${lo < 0 && hi > 0 ? `<line class="zero" x1="${L}" x2="${W - R}" y1="${Y(0).toFixed(1)}" y2="${Y(0).toFixed(1)}"/>` : ''}
        ${xt.map(i => `<text class="ax" x="${X(i).toFixed(1)}" y="${H - 7}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${dm(t.dates[i])}</text>`).join('')}
        <path d="${step(t.bank)}" fill="none" stroke="var(--c-bank)" stroke-width="2" stroke-dasharray="6 3"/><path d="${step(t.cash)}" fill="none" stroke="var(--c-cash)" stroke-width="2.2"/>
        <line class="guide" y1="${T}" y2="${H - B}" x1="0" x2="0" style="display:none"/><circle class="dot1" r="4" style="display:none" fill="var(--c-cash)"/><circle class="dot2" r="4" style="display:none" fill="var(--c-bank)"/>
        <rect class="hit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent"/></svg><div class="tip" hidden></div></div></div>`;
  }
  function topexp() {
    const { x, r } = CUR, tot = x.top_expenses.reduce((s, e) => s + e.amount, 0), mx = Math.max(1, ...x.top_expenses.map(e => e.amount));
    return `<div class="card dsec"><h3>Top expenses <span class="muted" style="font-weight:400">· ${fdate(r.from)} to ${fdate(r.to)}</span></h3>
      ${x.top_expenses.length ? x.top_expenses.map(e => `<div class="hbar" tabindex="0" role="button" data-do="ledger" data-id="${e.id}" title="Open the ledger of ${esc(e.name)}"><div class="hl"><span>${esc(e.name)}</span><b>${fmt(e.amount)}</b></div><div class="ht"><i style="width:${(e.amount / mx * 100).toFixed(1)}%"></i></div><small class="muted">${tot ? Math.round(e.amount / tot * 100) : 0}% of top expenses</small></div>`).join('') : '<p class="muted">No expenses in this period.</p>'}</div>`;
  }
  function monthly() {
    const m = CUR.x.monthly, mx0 = Math.max(1, ...m.flatMap(a => [a.income, a.expense])), mx = nice(0, mx0, 4).hi, fy = CUR.x.fy, y0 = +fy.slice(0, 4), m0 = +fy.slice(5, 7);
    const nz = nice(0, mx, 4), bw = (W - L - R) / 12, any = m.some(a => a.income || a.expense), cm = today().slice(0, 7);
    const Y = v => T + (H - T - B) * (1 - v / mx), title = `Income vs expense by month · fiscal year from ${MON[m0 - 1]} ${y0}`;
    if (!any) return `<div class="card dsec"><h3>${title}</h3><p class="muted">No income or expense has been posted in this fiscal year yet.</p></div>`;
    return `<div class="card dsec"><h3>${title}</h3><div class="legend"><span><i style="background:var(--c-inc)"></i>Income</span><span><i style="background:var(--c-exp)"></i>Expense</span></div>
      <div class="chart" id="chMonthly"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${title}">
        ${nz.ticks.map(v => { return `<line class="gl" x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text class="ax" x="${L - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end">${short(v)}</text>`; }).join('')}
        ${m.map((a, i) => { const x0 = L + bw * i, w = bw * 0.34, ym = a.month, mm = +ym.slice(5, 7);
          return `<g class="mcol ${ym === cm ? 'cur' : ''}" data-i="${i}" data-do="month" data-ym="${ym}"><rect class="mhit" x="${x0}" y="${T}" width="${bw}" height="${H - T - B}" fill="transparent"/>
            <rect x="${(x0 + bw * 0.12).toFixed(1)}" y="${Y(a.income).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, H - B - Y(a.income)).toFixed(1)}" rx="2" fill="var(--c-inc)"/>
            <rect x="${(x0 + bw * 0.54).toFixed(1)}" y="${Y(a.expense).toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, H - B - Y(a.expense)).toFixed(1)}" rx="2" fill="var(--c-exp)"/>
            <text class="ax" x="${(x0 + bw / 2).toFixed(1)}" y="${H - 8}" text-anchor="middle">${MON[mm - 1]}${mm === 1 || i === 0 ? ' ' + ym.slice(2, 4) : ''}</text></g>`; }).join('')}
      </svg><div class="tip" hidden></div></div><p class="muted" style="margin:6px 0 0;font-size:12px">Click a month to open its vouchers.</p></div>`;
  }
  function quick() {
    const book = ACC.filter(a => a.active && (a.kind === 'cash' || a.kind === 'bank')), heads = ACC.filter(a => a.active && a.kind === 'normal' && a.name !== 'Funds in Transit');
    const first = qe.kind === 'pay' ? 'expense' : 'income', g1 = heads.filter(a => a.type === first), g2 = heads.filter(a => a.type !== first);
    const og = (l, list) => list.length ? `<optgroup label="${l}">${list.map(a => `<option value="${a.id}">${esc(a.code)} · ${esc(a.name)}</option>`).join('')}</optgroup>` : '';
    return `<div class="card dsec" id="dquick"><h3>Quick entry</h3>
      <div class="seg"><button type="button" class="${qe.kind === 'pay' ? 'on' : ''}" data-do="qe-kind" data-v="pay">Payment</button><button type="button" class="${qe.kind === 'rec' ? 'on' : ''}" data-do="qe-kind" data-v="rec">Receipt</button></div>
      <div class="qgrid">
        <div><label>${qe.kind === 'pay' ? 'Pay from' : 'Receive into'}</label><select id="qb">${book.map(a => `<option value="${a.id}">${esc(a.name)}${a.kind === 'bank' ? ' (bank)' : ' (cash)'}</option>`).join('')}</select></div>
        <div><label>${qe.kind === 'pay' ? 'Expense / party account' : 'Income / party account'}</label><select id="qh"><option value="">Select</option>${og(qe.kind === 'pay' ? 'Expenses' : 'Income', g1)}${og('Other accounts', g2)}</select></div>
        <div><label>Amount</label><input id="qa" inputmode="decimal" placeholder="0.00"></div>
        <div><label>Date</label><input id="qd" type="date" value="${today()}"></div>
        <div><label>${qe.kind === 'pay' ? 'Paid to' : 'Received from'}</label><input id="qp" placeholder="Name (optional)"></div>
        <div class="qwide"><label>Narration</label><input id="qn" placeholder="What is it for?"></div>
      </div>
      <div class="actions" style="margin-top:10px"><button class="btn" type="button" data-do="qe-save">Save voucher</button><span class="muted" id="qmsg" style="align-self:center"></span></div>
      <p class="muted" style="margin:8px 0 0;font-size:12px">For money moving between your own cash and bank accounts, use ⇄ Transfer instead.</p></div>`;
  }
  function checklist() {
    const c = CUR.x.checklist, done = c.filter(i => i.done).length;
    return `<div class="card dsec"><h3>Month-end checklist <span class="badge ${done === c.length ? 'ok' : ''}">${done} of ${c.length}</span></h3><div class="muted" style="font-size:12px;margin-bottom:6px">For ${esc(CUR.x.prev_month_end.slice(0, 7))}</div>
      ${c.map(i => `<div class="chk ${i.done ? 'done' : ''}" tabindex="0" role="button" data-do="go" data-v="${i.go}"><span class="tick">${i.done ? '✔' : ''}</span><span><b>${esc(i.label)}</b><br><small class="muted">${esc(i.detail)}</small></span><span class="go">›</span></div>`).join('')}</div>`;
  }
  function recent() {
    const rows = CUR.d.recent;
    return `<div class="card dsec"><h3>Recent vouchers</h3><table class="tbl">${rows.map(v => `<tr class="click" data-do="voucher" data-id="${v.id}"><td>${esc(v.voucher_no)}</td><td>${esc(v.vdate)}</td><td>${esc((v.narration || '').slice(0, 30))}</td><td class="n">${fmt(v.amount)}</td></tr>`).join('') || '<tr><td class="muted">No vouchers yet</td></tr>'}</table></div>`;
  }
  const BUILD = { attention, cards, actions, trend, topexp, monthly, quick, checklist, recent };
  const FULL = new Set(['attention', 'cards', 'actions']);   // sections that use the full width; the rest sit in a responsive grid

  function body() {
    const on = CFG.order.filter(k => !CFG.hide.includes(k));
    if (!on.length) return '<div class="card"><p class="muted">Everything is hidden. Press Customise to choose what to show.</p></div>';
    let html = '', buf = [];
    const flush = () => { if (buf.length) { html += `<div class="dflex">${buf.join('')}</div>`; buf = []; } };
    for (const k of on) { if (FULL.has(k)) { flush(); html += BUILD[k](); } else buf.push(BUILD[k]()); }
    flush(); return html;
  }
  function topbar() {
    const r = range();
    return `<div class="dtop"><div class="dtitle"><h2 style="margin:0">Dashboard</h2><span class="muted" id="drange">${fdate(r.from)} – ${fdate(r.to)}</span></div>
      <div class="chips" role="tablist">${PRESETS.map(p => `<button type="button" class="chip ${P.preset === p[0] ? 'on' : ''}" data-do="preset" data-v="${p[0]}">${p[1]}</button>`).join('')}</div>
      ${P.preset === 'custom' ? `<div class="cust"><input type="date" id="dfrom" value="${r.from}"><span>to</span><input type="date" id="dto" value="${r.to}"><button class="btn sm" type="button" data-do="custom-go">Show</button></div>` : ''}
      <div class="dtools"><span class="muted" id="dupd">${updatedAt ? 'Updated ' + updatedAt : ''}</span><button class="btn ghost sm" type="button" data-do="refresh" title="Refresh now">⟳ Refresh</button><button class="btn ghost sm" type="button" data-do="customise">⚙ Customise</button></div></div>`;
  }
  function paint() {
    if (!$('#dtop') || !$('#dbody')) return;
    const keep = $('#dquick') ? ['qb', 'qh', 'qa', 'qd', 'qp', 'qn'].map(id => [id, $('#' + id) && $('#' + id).value]) : [];
    $('#dtop').innerHTML = topbar(); $('#dbody').innerHTML = body();
    keep.forEach(([id, v]) => { if ($('#' + id) && v !== null && v !== undefined && v !== '') { try { $('#' + id).value = v; } catch (e) { /* ignore */ } } });
    hover();
  }

  // ---------- chart hover ----------
  function tipAt(box, e, html) {
    const tip = box.querySelector('.tip'), r = box.getBoundingClientRect(); tip.innerHTML = html; tip.hidden = false;
    const x = e.clientX - r.left, left = x > r.width * 0.6 ? x - tip.offsetWidth - 12 : x + 12; tip.style.left = Math.max(0, left) + 'px'; tip.style.top = Math.max(0, e.clientY - r.top - tip.offsetHeight - 10) + 'px';
  }
  function hover() {
    const tb = $('#chTrend');
    if (tb) {
      const svg = tb.querySelector('svg'), t = CUR.x.trend, { n, X, Y } = trendScale(t);
      const g = svg.querySelector('.guide'), d1 = svg.querySelector('.dot1'), d2 = svg.querySelector('.dot2'), hide = () => { g.style.display = d1.style.display = d2.style.display = 'none'; tb.querySelector('.tip').hidden = true; };
      svg.querySelector('.hit').onpointermove = e => {
        const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * W, i = Math.max(0, Math.min(n - 1, Math.round((vx - L) / (W - L - R) * (n - 1))));
        g.setAttribute('x1', X(i)); g.setAttribute('x2', X(i)); d1.setAttribute('cx', X(i)); d1.setAttribute('cy', Y(t.cash[i])); d2.setAttribute('cx', X(i)); d2.setAttribute('cy', Y(t.bank[i])); g.style.display = d1.style.display = d2.style.display = '';
        tipAt(tb, e, `<b>${fdate(t.dates[i])}</b><br><i class="sw" style="background:var(--c-cash)"></i>Petty cash ${fmt(t.cash[i])}<br><i class="sw" style="background:var(--c-bank)"></i>Bank ${fmt(t.bank[i])}`);
      };
      svg.querySelector('.hit').onpointerleave = hide;
    }
    const mb = $('#chMonthly');
    if (mb) {
      mb.querySelectorAll('.mcol').forEach(el => {
        const a = CUR.x.monthly[+el.dataset.i], mm = +a.month.slice(5, 7);
        el.onpointermove = e => { el.classList.add('hot'); tipAt(mb, e, `<b>${MON[mm - 1]} ${a.month.slice(0, 4)}</b><br><i class="sw" style="background:var(--c-inc)"></i>Income ${fmt(a.income)}<br><i class="sw" style="background:var(--c-exp)"></i>Expense ${fmt(a.expense)}<br>Net ${fmt(a.income - a.expense)}`); };
        el.onpointerleave = () => { el.classList.remove('hot'); mb.querySelector('.tip').hidden = true; };
      });
    }
  }

  // ---------- actions ----------
  async function refresh(silent) {
    try { await load(); paint(); }
    catch (e) { if (e.message === 'Locked') return; if (!silent) { $('#dtop').innerHTML = topbar(); $('#dbody').innerHTML = `<div class="card err">${esc(e.message)}</div>`; } }
  }
  function customise() {
    const row = (k, l, i, n) => `<div class="crow"><label><input type="checkbox" data-sec="${k}" ${CFG.hide.includes(k) ? '' : 'checked'}> ${l}</label><span><button class="btn ghost sm" type="button" data-mv="${k}" data-d="-1" ${i === 0 ? 'disabled' : ''}>↑</button> <button class="btn ghost sm" type="button" data-mv="${k}" data-d="1" ${i === n - 1 ? 'disabled' : ''}>↓</button></span></div>`;
    const name = k => SECTIONS.find(s => s[0] === k)[1];
    modal(`<h3>Customise dashboard</h3><p class="muted" style="margin-top:0">Choose what to show and the order. Saved on this computer.</p>
      <h4 style="margin:10px 0 4px">Sections</h4>${CFG.order.map((k, i) => row(k, name(k), i, CFG.order.length)).join('')}
      <h4 style="margin:12px 0 4px">Summary cards</h4><div class="ccards">${CARDS.map(c => `<label><input type="checkbox" data-card="${c[0]}" ${CFG.hideCards.includes(c[0]) ? '' : 'checked'}> ${c[1]}</label>`).join('')}</div>
      <div class="actions" style="margin-top:14px"><button class="btn" type="button" id="cdone">Done</button><button class="btn ghost" type="button" id="creset">Reset to default</button></div>`);
    const m = $('#modal').firstElementChild, save = () => { ls.set('fa_dash_cfg', CFG); paint(); };   // listeners live on this modal's own card, so they vanish when it closes
    m.onchange = e => {
      const t = e.target;
      if (t.dataset.sec) { CFG.hide = t.checked ? CFG.hide.filter(k => k !== t.dataset.sec) : [...CFG.hide, t.dataset.sec]; save(); }
      if (t.dataset.card) { CFG.hideCards = t.checked ? CFG.hideCards.filter(k => k !== t.dataset.card) : [...CFG.hideCards, t.dataset.card]; save(); }
    };
    m.addEventListener('click', function mv(e) {
      const b = e.target.closest('[data-mv]'); if (!b) return;
      const i = CFG.order.indexOf(b.dataset.mv), j = i + +b.dataset.d; if (j < 0 || j >= CFG.order.length) return;
      [CFG.order[i], CFG.order[j]] = [CFG.order[j], CFG.order[i]]; save(); m.removeEventListener('click', mv); customise();
    });
    $('#cdone').onclick = closeModal;
    $('#creset').onclick = () => { CFG = {}; normCfg(); save(); customise(); };
  }
  async function saveQuick() {
    const msg = t => { $('#qmsg').textContent = t; $('#qmsg').className = 'err'; $('#qmsg').style.marginTop = '0'; };
    const book = ACC.find(a => String(a.id) === $('#qb').value), head = ACC.find(a => String(a.id) === $('#qh').value), raw = $('#qa').value.replace(/,/g, '').trim(), date = $('#qd').value;
    if (!book) return msg('Choose the cash or bank account.');
    if (!head) return msg('Choose the account to post against.');
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) return msg('Enter an amount greater than zero (at most 2 decimals).');
    if (!dateOk(date)) return msg('Enter a valid date.');
    const amt = r2(raw), pay = qe.kind === 'pay';
    const bal = [...CUR.x.cash, ...CUR.x.banks].find(b => b.id === book.id);
    if (pay && bal && bal.balance - amt < 0 && !confirm(`This payment takes ${book.name} below zero (balance now ${fmt(bal.balance)}). Save anyway?`)) return;
    const vtype = book.kind === 'cash' ? (pay ? 'CP' : 'CR') : (pay ? 'BP' : 'BR');
    const lines = pay ? [{ account_id: head.id, debit: amt, credit: 0 }, { account_id: book.id, debit: 0, credit: amt }] : [{ account_id: book.id, debit: amt, credit: 0 }, { account_id: head.id, debit: 0, credit: amt }];
    try {
      const r = await lockApi('/api/vouchers', { method: 'POST', body: { vtype, vdate: date, narration: $('#qn').value.trim(), party: $('#qp').value.trim(), lines } });
      toast('Voucher saved'); ['qa', 'qp', 'qn', 'qh'].forEach(id => { $('#' + id).value = ''; });
      await refresh(true); const q = $('#qmsg'); if (q) { q.className = 'ok'; q.innerHTML = `Saved. <a href="#" data-do="voucher" data-id="${r.id}">View voucher</a>`; }
    } catch (e) { if (e.message !== 'Cancelled') msg(e.message); }
  }
  function open(el) {
    const x = CUR.x, r = CUR.r, d = el.dataset;
    switch (d.do) {
      case 'cash': { const a = x.cash[0]; if (a) BK.cash = { acc: a.id, from: r.from, to: r.to }; return go('cashbook'); }
      case 'bank': { const a = x.banks[0]; if (a) BK.bank = { acc: a.id, from: r.from, to: r.to }; return go('bankbook'); }
      case 'vouchers': VF = { from: r.from, to: r.to, type: '', q: '' }; return go('vouchers');
      case 'ledger': BK.any = { acc: +d.id, from: r.from, to: r.to }; return go('ledger');
      case 'month': VF = { from: d.ym + '-01', to: eom(d.ym + '-01'), type: '', q: '' }; return go('vouchers');
      case 'voucher': return showVoucher(+d.id);
      case 'go': return go(d.v, d.a || undefined);
    }
  }
  function onClick(e) {
    const el = e.target.closest('[data-do]'); if (!el || !$('#dash').contains(el)) return;
    const a = el.dataset.do;
    if (a === 'preset') { P.preset = el.dataset.v; if (P.preset === 'custom' && !P.from) { P.from = monthStart(); P.to = today(); } ls.set('fa_dash_period', P); $('#dtop').innerHTML = topbar(); return P.preset === 'custom' ? undefined : refresh(); }
    if (a === 'custom-go') { const f = $('#dfrom').value, t = $('#dto').value; if (!dateOk(f) || !dateOk(t)) return toast('Choose both dates', true); P.from = f; P.to = t; ls.set('fa_dash_period', P); return refresh(); }
    if (a === 'refresh') return refresh();
    if (a === 'customise') return customise();
    if (a === 'qe-kind') { qe.kind = el.dataset.v; if ($('#qh')) $('#qh').value = ''; paint(); return; }
    if (a === 'qe-save') return saveQuick();
    e.preventDefault(); open(el);
  }

  window.vDash = async function () {
    head('Dashboard'); clearInterval(timer);
    $('#view').innerHTML = '<div id="dash"><div id="dtop"></div><div id="dbody"><p class="muted">Loading…</p></div></div>';
    const root = $('#dash'); root.onclick = onClick;
    root.onkeydown = e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role=button]')) { e.preventDefault(); onClick(e); } };
    $('#dtop').innerHTML = topbar();
    await refresh();
    timer = setInterval(() => {   // quietly refresh every minute while this screen is open and you are not typing
      if (!$('#dash')) return clearInterval(timer);
      if (document.hidden || !$('#modal').classList.contains('hidden') || (document.activeElement && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName))) return;
      if (['qa', 'qp', 'qn'].some(id => $('#' + id) && $('#' + id).value)) return;
      refresh(true);
    }, 60000);
  };
})();
