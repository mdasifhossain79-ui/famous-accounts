// Recurring vouchers (posted only after approval) and the cash-flow forecast.
// Money is handled in whole paisa; vouchers are created with the app's own saveVoucher, so the month-end lock and double entry always apply.
const DDL = [
  `CREATE TABLE IF NOT EXISTS recurring_vouchers (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(120) NOT NULL, direction VARCHAR(8) NOT NULL, account_id INT NOT NULL, bank_account_id INT NOT NULL,
    amount DECIMAL(14,2) NOT NULL, narration VARCHAR(300) NULL, party VARCHAR(150) NULL, frequency VARCHAR(10) NOT NULL DEFAULT 'monthly', day_of_month TINYINT NULL, start_date DATE NOT NULL, end_date DATE NULL,
    next_due DATE NOT NULL, active TINYINT NOT NULL DEFAULT 1, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_rv_due (next_due), FOREIGN KEY (account_id) REFERENCES accounts(id), FOREIGN KEY (bank_account_id) REFERENCES accounts(id))`,
  `CREATE TABLE IF NOT EXISTS recurring_log (id INT AUTO_INCREMENT PRIMARY KEY, rec_id INT NOT NULL, due_date DATE NOT NULL, action VARCHAR(10) NOT NULL, voucher_id INT NULL, amount DECIMAL(14,2) NULL, note VARCHAR(300) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_rl_rec (rec_id, due_date), FOREIGN KEY (rec_id) REFERENCES recurring_vouchers(id))`
];
const COLS = {
  recurring_vouchers: ['id', 'name', 'direction', 'account_id', 'bank_account_id', 'amount', 'narration', 'party', 'frequency', 'day_of_month', 'start_date', 'end_date', 'next_due', 'active'],
  recurring_log: ['id', 'rec_id', 'due_date', 'action', 'voucher_id', 'amount', 'note']
};
const TABLES_DELETE_ORDER = ['recurring_log', 'recurring_vouchers'];
const FREQ = { weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Every 3 months', yearly: 'Yearly' };
async function migrate(pool) { for (const q of DDL) await pool.query(q); }

// ---------- dates (UTC based so the time zone of the computer never moves a date) ----------
const iso = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null; };
const addDays = (s, n) => new Date(Date.parse(s + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
function addMonths(s, n, dom) {   // keeps the chosen day of month, using the last day of short months
  const y = +s.slice(0, 4), m = +s.slice(5, 7) - 1 + n, ty = y + Math.floor(m / 12), tm = ((m % 12) + 12) % 12, last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(dom || +s.slice(8, 10), last))).toISOString().slice(0, 10);
}
const nextDate = (r, from) => (r.frequency === 'weekly' ? addDays(from, 7) : addMonths(from, r.frequency === 'quarterly' ? 3 : r.frequency === 'yearly' ? 12 : 1, r.day_of_month));
const maxD = (a, b) => (a > b ? a : b);
const toC = v => Math.round(Number(v || 0) * 100), fromC = c => c / 100;
const AMT = /^\d+(\.\d{1,2})?$/;

function register(ctx) {
  const { app, h, bad, today, saveVoucher } = ctx;
  const pool = { query: (...a) => ctx.getPool().query(...a), getConnection: (...a) => ctx.getPool().getConnection(...a) };
  const tx = async fn => { const c = await pool.getConnection(); try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; } catch (e) { await c.rollback(); throw e; } finally { c.release(); } };
  const intp = v => (Number.isInteger(+v) && +v > 0 ? +v : 0);

  // ================= recurring vouchers =================
  async function body(b, old) {
    const o = { ...(old || {}), ...b };
    const name = String(o.name || '').trim().slice(0, 120); if (!name) throw bad('Enter a name for this recurring voucher');
    if (!['pay', 'receive'].includes(o.direction)) throw bad('Choose payment or receipt');
    const amt = String(o.amount === undefined || o.amount === null ? '' : o.amount).replace(/,/g, '').trim(); if (!AMT.test(amt) || !(Number(amt) > 0)) throw bad('Amount must be a positive number with at most 2 decimals');
    const acc = intp(o.account_id), bank = intp(o.bank_account_id);
    const [[a]] = await pool.query('SELECT kind, active FROM accounts WHERE id=?', [acc]); if (!a || a.kind !== 'normal' || !a.active) throw bad(o.direction === 'pay' ? 'Choose an active expense / ledger account' : 'Choose an active income / ledger account');
    const [[bk]] = await pool.query('SELECT kind, active FROM accounts WHERE id=?', [bank]); if (!bk || !['cash', 'bank'].includes(bk.kind) || !bk.active) throw bad('Choose an active cash or bank account');
    if (!FREQ[o.frequency]) throw bad('Choose how often it repeats');
    const start = iso(o.start_date); if (!start) throw bad('Enter a valid start date'); const end = o.end_date ? iso(o.end_date) : null; if (o.end_date && !end) throw bad('Enter a valid end date'); if (end && end < start) throw bad('End date is before the start date');
    const dom = o.frequency === 'weekly' ? null : Math.min(Math.max(intp(o.day_of_month) || +start.slice(8, 10), 1), 31);
    return { name, direction: o.direction, account_id: acc, bank_account_id: bank, amount: amt, narration: String(o.narration || '').slice(0, 300) || null, party: String(o.party || '').slice(0, 150) || null, frequency: o.frequency, day_of_month: dom, start_date: start, end_date: end };
  }
  const view = (r, t) => { const behind = []; let d = r.next_due, n = 0; if (r.active) while (d <= t && n < 60) { behind.push(d); d = nextDate(r, d); n++; }
    return { ...r, amount: Number(r.amount), freq_label: FREQ[r.frequency], days_until: dayDiff(r.next_due, t), missed: behind.length, status: !r.active ? 'ended' : r.next_due < t ? 'overdue' : r.next_due === t ? 'due' : 'upcoming' }; };
  app.get('/api/recurring', h(async (req, res) => {
    const [r] = await pool.query(`SELECT r.*, a.name account_name, b.name bank_name, (SELECT MAX(due_date) FROM recurring_log WHERE rec_id=r.id AND action='posted') last_posted FROM recurring_vouchers r JOIN accounts a ON a.id=r.account_id JOIN accounts b ON b.id=r.bank_account_id ORDER BY r.active DESC, r.next_due, r.id`);
    const t = today(); res.json({ today: t, rows: r.map(x => view(x, t)) });
  }));
  app.post('/api/recurring', h(async (req, res) => {
    const f = await body(req.body || {}); const nd = f.start_date; const [i] = await pool.query('INSERT INTO recurring_vouchers SET ?', [{ ...f, next_due: nd, active: 1 }]); res.json({ id: i.insertId });
  }));
  app.put('/api/recurring/:id', h(async (req, res) => {
    const id = intp(req.params.id), [[o]] = await pool.query('SELECT * FROM recurring_vouchers WHERE id=?', [id]); if (!o) throw Object.assign(new Error('Not found'), { status: 404 });
    const f = await body(req.body || {}, { ...o, amount: String(o.amount) }); const set = { ...f, active: req.body.active === false || req.body.active === 0 ? 0 : 1 };
    if (req.body.next_due) { const nd = iso(req.body.next_due); if (!nd) throw bad('Enter a valid next due date'); set.next_due = nd; }
    await pool.query('UPDATE recurring_vouchers SET ? WHERE id=?', [set, id]); res.json({ ok: true });
  }));
  app.delete('/api/recurring/:id', h(async (req, res) => {
    if (!req.body || req.body.confirm !== true) throw bad('Please confirm that you want to delete this recurring voucher');
    const id = intp(req.params.id); const [[n]] = await pool.query("SELECT COUNT(*) n FROM recurring_log WHERE rec_id=? AND action='posted'", [id]);
    if (n.n) { await pool.query('UPDATE recurring_vouchers SET active=0 WHERE id=?', [id]); return res.json({ ok: true, ended: true }); }   // it has posted vouchers, so keep it for the history and just stop it
    await pool.query('DELETE FROM recurring_log WHERE rec_id=?', [id]); await pool.query('DELETE FROM recurring_vouchers WHERE id=?', [id]); res.json({ ok: true });
  }));
  app.get('/api/recurring/:id/log', h(async (req, res) => { const [r] = await pool.query('SELECT l.due_date, l.action, l.amount, l.note, l.created_at, v.voucher_no FROM recurring_log l LEFT JOIN vouchers v ON v.id=l.voucher_id WHERE l.rec_id=? ORDER BY l.id DESC LIMIT 100', [intp(req.params.id)]); res.json({ rows: r }); }));

  // post or skip ONE occurrence (always the next one, so nothing is posted out of order)
  async function step(conn, id, due, action, req, amountOverride, note) {
    const [[r]] = await conn.query('SELECT * FROM recurring_vouchers WHERE id=?', [id]); if (!r) throw Object.assign(new Error('Recurring voucher not found'), { status: 404 });
    if (!r.active) throw bad('This recurring voucher has ended'); if (r.next_due !== due) throw bad('This occurrence was already handled. Refresh the list.');
    let amount = String(r.amount), vid = null;
    if (amountOverride !== undefined && amountOverride !== null && String(amountOverride).trim() !== '') { const a = String(amountOverride).replace(/,/g, '').trim(); if (!AMT.test(a) || !(Number(a) > 0)) throw bad('Amount must be a positive number with at most 2 decimals'); amount = a; }
    if (action === 'posted') {
      const [[bk]] = await conn.query('SELECT kind FROM accounts WHERE id=?', [r.bank_account_id]), pay = r.direction === 'pay', vtype = pay ? (bk.kind === 'bank' ? 'BP' : 'CP') : (bk.kind === 'bank' ? 'BR' : 'CR');
      const A = Number(amount), lines = pay ? [{ account_id: r.account_id, debit: A, credit: 0 }, { account_id: r.bank_account_id, debit: 0, credit: A }] : [{ account_id: r.bank_account_id, debit: A, credit: 0 }, { account_id: r.account_id, debit: 0, credit: A }];
      vid = await saveVoucher(null, { vtype, vdate: due, narration: (r.narration || r.name) + ' (recurring)', party: r.party || '', ref: 'REC-' + r.id, lines }, req, conn);
    }
    const nx = nextDate(r, due), ended = r.end_date && nx > r.end_date;
    await conn.query('UPDATE recurring_vouchers SET next_due=?, active=? WHERE id=?', [nx, ended ? 0 : 1, id]);
    await conn.query('INSERT INTO recurring_log (rec_id,due_date,action,voucher_id,amount,note) VALUES (?,?,?,?,?,?)', [id, due, action, vid, action === 'posted' ? amount : null, (amount !== String(r.amount) && action === 'posted' ? `amount changed from ${r.amount} to ${amount}. ` : '') + String(note || '').slice(0, 250) || null]);
    return { voucher_id: vid, next_due: nx, ended: !!ended };
  }
  app.post('/api/recurring/:id/post', h(async (req, res) => { const b = req.body || {}; res.json(await tx(c => step(c, intp(req.params.id), iso(b.due_date), 'posted', req, b.amount, b.note))); }));
  app.post('/api/recurring/:id/skip', h(async (req, res) => { const b = req.body || {}; res.json(await tx(c => step(c, intp(req.params.id), iso(b.due_date), 'skipped', req, undefined, b.note))); }));
  app.post('/api/recurring/post-due', h(async (req, res) => {   // every occurrence up to today, in order, all or nothing
    const t = today(), ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(intp).filter(Boolean); if (!ids.length) throw bad('Select at least one');
    const out = await tx(async c => { let n = 0; for (const id of ids) for (let k = 0; k < 60; k++) { const [[r]] = await c.query('SELECT next_due, active FROM recurring_vouchers WHERE id=?', [id]); if (!r || !r.active || r.next_due > t) break; await step(c, id, r.next_due, 'posted', req); n++; } return n; });
    res.json({ posted: out });
  }));

  // ================= cash-flow forecast =================
  app.get('/api/forecast', h(async (req, res) => {
    const q = req.query || {}, t = today(), days = Math.min(Math.max(intp(q.days) || 60, 7), 180), clear = Math.min(Math.max(Number.isInteger(+q.clear_days) ? +q.clear_days : 3, 0), 30), transit = Math.min(Math.max(Number.isInteger(+q.transit_days) ? +q.transit_days : 2, 0), 30), end = addDays(t, days);
    const kinds = q.include_cash === '1' ? ['bank', 'cash'] : ['bank'];
    let [accs] = await pool.query('SELECT id, code, name, kind, opening_balance, opening_side FROM accounts WHERE active=1 AND kind IN (?)', [kinds]); if (intp(q.account_id)) accs = accs.filter(a => a.id === +q.account_id);
    if (!accs.length) throw bad('There is no bank account to forecast'); const ids = accs.map(a => a.id), byId = new Map(accs.map(a => [a.id, a]));
    const [lines] = await pool.query('SELECT l.id, l.account_id, l.debit, l.credit, l.cleared_on, v.vdate, v.voucher_no, v.narration, v.party, v.cheque_no FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE l.account_id IN (?)', [ids]);
    const ev = []; const add = (date, c, kind, label, acc, extra) => ev.push({ date: date <= t ? t : date, raw_date: date, c, kind, label, account: byId.get(acc).code, ...extra });
    let book = 0, start = 0;
    for (const a of accs) { const o = (a.opening_side === 'Cr' ? -1 : 1) * toC(a.opening_balance); book += o; start += o; }
    for (const l of lines) {
      const a = byId.get(l.account_id), d = toC(l.debit), cr = toC(l.credit), net = d - cr, isBank = a.kind === 'bank', lag = isBank ? clear : 0;
      if (l.vdate <= t) {
        book += net; start += net;
        if (isBank && !l.cleared_on) { start -= net; add(maxD(addDays(t, 1), addDays(l.vdate, lag)), net, net < 0 ? 'cheque' : 'deposit', (net < 0 ? 'Cheque not yet cleared ' : 'Deposit not yet credited ') + (l.cheque_no || l.voucher_no), l.account_id, { cheque: l.cheque_no || '' }); }
      } else add(addDays(l.vdate, lag), net, 'dated', 'Future-dated ' + l.voucher_no + (l.party ? ' · ' + l.party : ''), l.account_id, {});
    }
    // transfers sent but not yet received
    try { const [tr] = await pool.query("SELECT transfer_no, to_account_id, amount, sent_date FROM transfers WHERE status='in_transit' AND to_account_id IN (?)", [ids]); tr.forEach(x => add(maxD(addDays(t, 1), addDays(x.sent_date, transit)), toC(x.amount), 'transfer', 'Transfer in transit ' + x.transfer_no, x.to_account_id, {})); } catch (e) { /* no transfer module */ }
    // recurring vouchers (only items you approve; shown as expected)
    const [rec] = await pool.query('SELECT * FROM recurring_vouchers WHERE active=1 AND bank_account_id IN (?)', [ids]);
    for (const r of rec) { let d = r.next_due, n = 0; while (d <= end && n < 400) { if (r.end_date && d > r.end_date) break; add(d, (r.direction === 'pay' ? -1 : 1) * toC(r.amount), 'recurring', r.name + (d < t ? ' (overdue, awaiting approval)' : ''), r.bank_account_id, {}); d = nextDate(r, d); n++; } }
    const within = ev.filter(e => e.date <= end).sort((a, b) => a.date.localeCompare(b.date) || a.c - b.c);
    const series = []; let bal = start, minB = start, minD = t; const sums = { cheque: 0, deposit: 0, transfer: 0, recurring: 0, dated: 0 };
    for (let i = 0; i <= days; i++) {
      const d = addDays(t, i); let inn = 0, out = 0; within.filter(e => e.date === d).forEach(e => { if (e.c >= 0) inn += e.c; else out += -e.c; sums[e.kind] += e.c; });
      bal += inn - out; if (bal < minB) { minB = bal; minD = d; } series.push({ date: d, balance: fromC(bal), inflow: fromC(inn), outflow: fromC(out) });
    }
    res.json({ today: t, days, assumptions: { clear_days: clear, transit_days: transit, include_cash: kinds.length > 1 }, accounts: accs.map(a => ({ id: a.id, code: a.code, name: a.name, kind: a.kind })), book_balance: fromC(book), start_balance: fromC(start),
      end_balance: series[series.length - 1].balance, min_balance: fromC(minB), min_date: minD, goes_negative: minB < 0, sources: Object.fromEntries(Object.entries(sums).map(([k, v]) => [k, fromC(v)])),
      series, events: within.map(e => ({ date: e.date, kind: e.kind, label: e.label, account: e.account, amount: fromC(e.c) })) });
  }));
  return { nextDate };
}
module.exports = { migrate, register, COLS, DDL, TABLES_DELETE_ORDER, nextDate, addMonths };
