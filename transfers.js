// Inter-account transfers: bank <-> bank, bank <-> petty cash, petty cash <-> petty cash.
// Money is posted as ordinary double-entry vouchers (CT for the transfer, BP/CP for bank charges) so the Bank Book,
// Petty Cash Book, Ledger, Trial Balance and Bank Reconciliation keep working unchanged. This module only adds the
// transfer record that links those vouchers together, the "funds in transit" step and an audit log.

const D = 'DECIMAL(14,2)';
const DDL = [
  `CREATE TABLE IF NOT EXISTS transfers (
    id INT AUTO_INCREMENT PRIMARY KEY, seq INT NOT NULL, transfer_no VARCHAR(20) NOT NULL UNIQUE,
    from_account_id INT NOT NULL, to_account_id INT NOT NULL, amount ${D} NOT NULL,
    purpose VARCHAR(20) NOT NULL DEFAULT 'bank_bank', mode VARCHAR(12) NOT NULL DEFAULT 'cash',
    ref_no VARCHAR(60) NULL, party VARCHAR(150) NULL, narration VARCHAR(400) NULL,
    status VARCHAR(12) NOT NULL DEFAULT 'posted', sent_date DATE NOT NULL, received_date DATE NULL,
    send_voucher_id INT NULL, receive_voucher_id INT NULL, charge_voucher_id INT NULL,
    charge_amount ${D} NOT NULL DEFAULT 0, vat_amount ${D} NOT NULL DEFAULT 0,
    charge_account_id INT NULL, vat_account_id INT NULL, charge_from_id INT NULL,
    reversal_ids VARCHAR(120) NULL, cancelled_at DATETIME NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_tr_sent (sent_date), INDEX idx_tr_from (from_account_id), INDEX idx_tr_to (to_account_id), INDEX idx_tr_status (status),
    INDEX idx_tr_sv (send_voucher_id), INDEX idx_tr_rv (receive_voucher_id), INDEX idx_tr_cv (charge_voucher_id),
    FOREIGN KEY (from_account_id) REFERENCES accounts(id), FOREIGN KEY (to_account_id) REFERENCES accounts(id))`,
  `CREATE TABLE IF NOT EXISTS transfer_log (
    id INT AUTO_INCREMENT PRIMARY KEY, transfer_id INT NOT NULL, action VARCHAR(20) NOT NULL, detail TEXT NULL,
    ip VARCHAR(45) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_tl_t (transfer_id))`
];
// columns saved in the backup file (see /api/backup)
const COLS = {
  transfers: ['id', 'seq', 'transfer_no', 'from_account_id', 'to_account_id', 'amount', 'purpose', 'mode', 'ref_no', 'party', 'narration', 'status', 'sent_date', 'received_date',
    'send_voucher_id', 'receive_voucher_id', 'charge_voucher_id', 'charge_amount', 'vat_amount', 'charge_account_id', 'vat_account_id', 'charge_from_id', 'reversal_ids', 'cancelled_at'],
  transfer_log: ['id', 'transfer_id', 'action', 'detail', 'ip']
};
const PURPOSES = { cash_withdrawal: 'Cash withdrawal for petty cash', cash_deposit: 'Cash deposit to bank', bank_bank: 'Bank to bank transfer', petty_petty: 'Petty cash to petty cash', replenish: 'Imprest replenishment', other: 'Other transfer' };
const MODES = { cash: 'Cash', cheque: 'Cheque', rtgs: 'RTGS', beftn: 'BEFTN / EFTN', online: 'Online / NPSB', payorder: 'Pay order', other: 'Other' };
const FIT_NAME = 'Funds in Transit';
const MAX_AMT = 99999999999.99;

async function migrate(pool) { for (const q of DDL) await pool.query(q); }

function register(ctx) {
  const { app, h, bad, r2, isDate, today, guardLock, saveVoucher, getSetting, setSetting } = ctx;
  // server.js creates its database pool after this module is loaded, so always look the pool up at the moment it is used
  const pool = { query: (...a) => ctx.getPool().query(...a), getConnection: (...a) => ctx.getPool().getConnection(...a) };
  const cents = n => Math.round(Number(n || 0) * 100);
  const nowStr = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19).replace('T', ' '); };
  const idList = a => ',' + a.filter(Boolean).join(',') + ',';

  // an amount must be typed with at most two decimals; it is never rounded silently
  function amountOf(v, label, optional) {
    const s = String(v === undefined || v === null ? '' : v).trim();
    if (s === '' && optional) return 0;
    if (!/^\d{1,11}(\.\d{1,2})?$/.test(s)) throw bad(`${label} must be a number with at most 2 decimals`);
    const n = Number(s);
    if (!optional && !(n > 0)) throw bad(`${label} must be greater than zero`);
    if (n > MAX_AMT) throw bad(`${label} is too large`);
    return n;
  }
  function clean(b) {
    b = b || {};
    const t = {
      sent_date: b.sent_date, from_account_id: +b.from_account_id || 0, to_account_id: +b.to_account_id || 0,
      amount: amountOf(b.amount, 'Amount'), purpose: PURPOSES[b.purpose] ? b.purpose : 'bank_bank', mode: MODES[b.mode] ? b.mode : 'cash',
      ref_no: String(b.ref_no || '').trim().slice(0, 60) || null, party: String(b.party || '').trim().slice(0, 150) || null, narration: String(b.narration || '').trim().slice(0, 300) || null,
      in_transit: !!b.in_transit, charge_amount: amountOf(b.charge_amount, 'Bank charge', true), vat_amount: amountOf(b.vat_amount, 'VAT', true),
      charge_account_id: +b.charge_account_id || null, vat_account_id: +b.vat_account_id || null, charge_from_id: +b.charge_from_id || null
    };
    if (!isDate(t.sent_date)) throw bad('Enter a valid date');
    if (!t.from_account_id || !t.to_account_id) throw bad('Choose both the From and the To account');
    if (t.from_account_id === t.to_account_id) throw bad('From and To accounts must be different');
    if (t.charge_amount + t.vat_amount > 0) {
      if (!t.charge_account_id) throw bad('Choose the account for the bank charge');
      if (t.vat_amount > 0 && !t.vat_account_id) t.vat_account_id = t.charge_account_id;
      if (!t.charge_from_id) t.charge_from_id = t.from_account_id;
      if (![t.from_account_id, t.to_account_id].includes(t.charge_from_id)) throw bad('Charges must be paid from the From or the To account');
    } else { t.charge_account_id = t.vat_account_id = t.charge_from_id = null; }
    return t;
  }
  async function accountsOk(db, t, keep = []) {
    const ids = [t.from_account_id, t.to_account_id];
    const [rows] = await db.query('SELECT * FROM accounts WHERE id IN (?)', [ids]);
    const by = Object.fromEntries(rows.map(a => [a.id, a]));
    for (const id of ids) {
      const a = by[id]; if (!a) throw bad('An account does not exist');
      if (!['cash', 'bank'].includes(a.kind)) throw bad(`${a.name} is not a bank or petty cash account`);
      if (!a.active && !keep.includes(id)) throw bad(`${a.name} is inactive`);
    }
    if (t.charge_account_id) {
      const need = [t.charge_account_id, t.vat_account_id].filter(Boolean);
      const [c] = await db.query('SELECT id,type FROM accounts WHERE id IN (?)', [need]);
      if (c.length !== new Set(need).size) throw bad('The charge or VAT account does not exist');
      if (c.some(a => a.type !== 'expense' && a.type !== 'asset' && a.type !== 'liability')) throw bad('Choose an expense account for charges');
    }
    return by;
  }

  // ----- balances and warnings (warnings never block a transfer) -----
  async function balances(db, ids, asOf, excludeVouchers = []) {
    const out = {};
    for (const id of ids) {
      const [[a]] = await db.query('SELECT opening_balance, opening_side FROM accounts WHERE id=?', [id]);
      const ex = excludeVouchers.length ? ' AND v.id NOT IN (?)' : '';
      const [[s]] = await db.query(`SELECT COALESCE(SUM(l.debit-l.credit),0) s FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE l.account_id=? AND v.vdate<=?${ex}`, excludeVouchers.length ? [id, asOf, excludeVouchers] : [id, asOf]);
      out[id] = r2((a.opening_side === 'Cr' ? -1 : 1) * Number(a.opening_balance || 0) + Number(s.s));
    }
    return out;
  }
  async function warningsFor(db, t, accs, excludeVouchers = []) {
    const bal = await balances(db, [t.from_account_id, t.to_account_id], t.sent_date, excludeVouchers), w = [];
    const fa = accs[t.from_account_id], ta = accs[t.to_account_id], limit = Number(await getSetting('imprest_limit')) || 0;
    const outflow = cents(t.amount) + (t.charge_from_id === t.from_account_id ? cents(t.charge_amount) + cents(t.vat_amount) : 0);
    if (cents(bal[fa.id]) - outflow < 0) w.push(`${fa.name} has ${bal[fa.id].toFixed(2)} on ${t.sent_date}; this transfer takes it below zero.`);
    if (!t.in_transit && ta.kind === 'cash' && limit > 0 && cents(bal[ta.id]) + cents(t.amount) > cents(limit)) w.push(`${ta.name} would hold ${r2(bal[ta.id] + t.amount).toFixed(2)}, above the imprest limit of ${limit.toFixed(2)}.`);
    return { balances: bal, warnings: w };
  }

  // ----- the clearing account that holds money between "sent" and "received" -----
  async function fitId(db, create) {
    const [r] = await db.query('SELECT id FROM accounts WHERE name=? ORDER BY id LIMIT 1', [FIT_NAME]);
    if (r[0]) return r[0].id;
    if (!create) return null;
    for (let c = 1190; c < 1200; c++) {
      const [x] = await db.query('SELECT id FROM accounts WHERE code=?', [String(c)]);
      if (!x.length) { const [ins] = await db.query("INSERT INTO accounts (code,name,type,kind) VALUES (?,?,'asset','normal')", [String(c), FIT_NAME]); return ins.insertId; }
    }
    throw bad('Could not create the Funds in Transit account (codes 1190-1199 are all used)');
  }
  const log = (db, id, action, detail, req) => db.query('INSERT INTO transfer_log (transfer_id,action,detail,ip) VALUES (?,?,?,?)', [id, action, JSON.stringify(detail || {}).slice(0, 4000), (req && req.socket && req.socket.remoteAddress || '').slice(0, 45)]);

  // ----- build the voucher lines -----
  const legLines = (debitId, creditId, amt) => [{ account_id: debitId, debit: amt, credit: 0 }, { account_id: creditId, debit: 0, credit: amt }];
  const narr = (no, t, extra) => `${no} · ${PURPOSES[t.purpose]}${extra ? ' · ' + extra : ''}${t.narration ? ' — ' + t.narration : ''}`.slice(0, 500);
  const sendVoucher = (no, t, fit) => ({ vtype: 'CT', vdate: t.sent_date, narration: narr(no, t, t.in_transit ? 'sent, in transit' : ''), party: t.party, ref: no, cheque_no: t.ref_no, lines: legLines(t.in_transit ? fit : t.to_account_id, t.from_account_id, t.amount) });
  const recvVoucher = (no, t, date, fit) => ({ vtype: 'CT', vdate: date, narration: narr(no, t, 'received'), party: t.party, ref: no, cheque_no: t.ref_no, lines: legLines(t.to_account_id, fit, t.amount) });
  async function chargeVoucher(db, no, t) {
    if (!(t.charge_amount + t.vat_amount > 0)) return null;
    const [[payer]] = await db.query('SELECT kind FROM accounts WHERE id=?', [t.charge_from_id]);
    const lines = [];
    if (t.charge_amount > 0) lines.push({ account_id: t.charge_account_id, debit: t.charge_amount, credit: 0 });
    if (t.vat_amount > 0) lines.push({ account_id: t.vat_account_id, debit: t.vat_amount, credit: 0 });
    lines.push({ account_id: t.charge_from_id, debit: 0, credit: r2((cents(t.charge_amount) + cents(t.vat_amount)) / 100) });
    return { vtype: payer.kind === 'bank' ? 'BP' : 'CP', vdate: t.sent_date, narration: `${no} · bank charge${t.vat_amount > 0 ? ' and VAT' : ''}`, party: null, ref: no, cheque_no: null, lines };
  }
  async function anyCleared(db, ids) {
    ids = ids.filter(Boolean); if (!ids.length) return false;
    const [r] = await db.query('SELECT COUNT(*) n FROM voucher_lines WHERE voucher_id IN (?) AND cleared_on IS NOT NULL', [ids]);
    return r[0].n > 0;
  }
  const voucherDate = async (db, id) => { if (!id) return null; const [[v]] = await db.query('SELECT vdate FROM vouchers WHERE id=?', [id]); return v ? v.vdate : null; };
  const snap = t => ({ transfer_no: t.transfer_no, status: t.status, amount: t.amount, from: t.from_account_id, to: t.to_account_id, sent_date: t.sent_date, received_date: t.received_date, mode: t.mode, ref_no: t.ref_no, charge: t.charge_amount, vat: t.vat_amount });
  async function load(db, id) {
    const [[t]] = await db.query('SELECT * FROM transfers WHERE id=?', [+id]);
    if (!t) throw Object.assign(new Error('Transfer not found'), { status: 404 });
    return t;
  }
  const tx = async fn => {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r; }
    catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
  };

  // ================= create =================
  app.post('/api/transfers', h(async (req, res) => {
    const t = clean(req.body);
    await guardLock(req, t.sent_date);
    const out = await tx(async conn => {
      const accs = await accountsOk(conn, t);
      const wr = await warningsFor(conn, t, accs);
      const fit = t.in_transit ? await fitId(conn, true) : null;
      const [[{ s }]] = await conn.query('SELECT COALESCE(MAX(seq),0)+1 s FROM transfers');
      const no = 'TR-' + String(s).padStart(5, '0');
      const sv = await saveVoucher(null, sendVoucher(no, t, fit), req, conn);
      const cvDef = await chargeVoucher(conn, no, t), cv = cvDef ? await saveVoucher(null, cvDef, req, conn) : null;
      const [ins] = await conn.query('INSERT INTO transfers SET ?', [{
        seq: s, transfer_no: no, from_account_id: t.from_account_id, to_account_id: t.to_account_id, amount: t.amount, purpose: t.purpose, mode: t.mode, ref_no: t.ref_no, party: t.party, narration: t.narration,
        status: t.in_transit ? 'in_transit' : 'posted', sent_date: t.sent_date, send_voucher_id: sv, charge_voucher_id: cv,
        charge_amount: t.charge_amount, vat_amount: t.vat_amount, charge_account_id: t.charge_account_id, vat_account_id: t.vat_account_id, charge_from_id: t.charge_from_id }]);
      await log(conn, ins.insertId, 'create', { ...snap({ ...t, transfer_no: no, status: t.in_transit ? 'in_transit' : 'posted' }) }, req);
      return { id: ins.insertId, transfer_no: no, status: t.in_transit ? 'in_transit' : 'posted', warnings: wr.warnings };
    });
    if (t.charge_account_id) { await setSetting('tr_charge_acct', t.charge_account_id); if (t.vat_account_id) await setSetting('tr_vat_acct', t.vat_account_id); }
    res.json(out);
  }));

  // ================= edit (only while neither side has been cleared in the Bank Book) =================
  app.put('/api/transfers/:id', h(async (req, res) => {
    const t = clean(req.body);
    const out = await tx(async conn => {
      const o = await load(conn, req.params.id);
      if (!['posted', 'in_transit'].includes(o.status)) throw bad('Only a posted or in-transit transfer can be edited. Cancel it and enter a new one.');
      if (await anyCleared(conn, [o.send_voucher_id, o.charge_voucher_id])) throw bad('This transfer is already cleared in the Bank Book, so it cannot be changed. Remove the cleared date first, or cancel it.');
      await guardLock(req, o.sent_date, t.sent_date);
      t.in_transit = o.status === 'in_transit';
      const accs = await accountsOk(conn, t, [o.from_account_id, o.to_account_id]);
      const wr = await warningsFor(conn, t, accs, [o.send_voucher_id, o.charge_voucher_id].filter(Boolean));
      const fit = t.in_transit ? await fitId(conn, true) : null;
      await saveVoucher(o.send_voucher_id, sendVoucher(o.transfer_no, t, fit), req, conn);
      const cvDef = await chargeVoucher(conn, o.transfer_no, t);
      let cv = o.charge_voucher_id;
      if (cvDef && cv) {
        const [[ov]] = await conn.query('SELECT vtype FROM vouchers WHERE id=?', [cv]);
        if (ov.vtype === cvDef.vtype) await saveVoucher(cv, cvDef, req, conn);
        else { await conn.query('DELETE FROM vouchers WHERE id=?', [cv]); cv = await saveVoucher(null, cvDef, req, conn); }
      } else if (cvDef) cv = await saveVoucher(null, cvDef, req, conn);
      else if (cv) { await conn.query('DELETE FROM vouchers WHERE id=?', [cv]); cv = null; }
      await conn.query('UPDATE transfers SET ? WHERE id=?', [{
        from_account_id: t.from_account_id, to_account_id: t.to_account_id, amount: t.amount, purpose: t.purpose, mode: t.mode, ref_no: t.ref_no, party: t.party, narration: t.narration,
        sent_date: t.sent_date, charge_voucher_id: cv, charge_amount: t.charge_amount, vat_amount: t.vat_amount, charge_account_id: t.charge_account_id, vat_account_id: t.vat_account_id, charge_from_id: t.charge_from_id }, o.id]);
      await log(conn, o.id, 'edit', { before: snap(o), after: snap({ ...t, transfer_no: o.transfer_no, status: o.status, charge: t.charge_amount, vat: t.vat_amount }) }, req);
      return { id: o.id, transfer_no: o.transfer_no, warnings: wr.warnings };
    });
    res.json(out);
  }));

  // ================= mark received (in-transit transfers) =================
  app.post('/api/transfers/:id/receive', h(async (req, res) => {
    const date = req.body && req.body.received_date;
    if (!isDate(date)) throw bad('Enter the date the money was received');
    const out = await tx(async conn => {
      const o = await load(conn, req.params.id);
      if (o.status !== 'in_transit') throw bad('This transfer is not in transit');
      if (date < o.sent_date) throw bad('The received date cannot be before the sent date');
      await guardLock(req, date);
      await accountsOk(conn, { from_account_id: o.from_account_id, to_account_id: o.to_account_id }, [o.from_account_id]);
      const fit = await fitId(conn, true);
      const rv = await saveVoucher(null, recvVoucher(o.transfer_no, o, date, fit), req, conn);
      await conn.query("UPDATE transfers SET status='received', received_date=?, receive_voucher_id=? WHERE id=?", [date, rv, o.id]);
      await log(conn, o.id, 'receive', { received_date: date, amount: o.amount }, req);
      return { id: o.id, transfer_no: o.transfer_no };
    });
    res.json(out);
  }));

  // ================= cancel: posts reversing vouchers, keeps everything for audit =================
  app.post('/api/transfers/:id/cancel', h(async (req, res) => {
    const date = isDate(req.body && req.body.date) ? req.body.date : today();
    const out = await tx(async conn => {
      const o = await load(conn, req.params.id);
      if (!['posted', 'in_transit', 'received'].includes(o.status)) throw bad('This transfer is already cancelled');
      const vids = [o.send_voucher_id, o.receive_voucher_id, o.charge_voucher_id].filter(Boolean);
      if (await anyCleared(conn, vids)) throw bad('This transfer is cleared in the Bank Book. Remove the cleared date first, then cancel it.');
      await guardLock(req, date, ...(await Promise.all(vids.map(v => voucherDate(conn, v)))));
      const rev = [];
      for (const vid of vids) {
        const [[v]] = await conn.query('SELECT vtype FROM vouchers WHERE id=?', [vid]);
        const [ls] = await conn.query('SELECT account_id,debit,credit FROM voucher_lines WHERE voucher_id=? ORDER BY id', [vid]);
        rev.push(await saveVoucher(null, { vtype: v.vtype === 'CT' ? 'CT' : 'JV', vdate: date, narration: `Reversal of ${o.transfer_no} (cancelled)`.slice(0, 500), ref: o.transfer_no, party: null, cheque_no: null,
          lines: ls.map(l => ({ account_id: l.account_id, debit: Number(l.credit), credit: Number(l.debit) })) }, req, conn));
      }
      await conn.query("UPDATE transfers SET status='cancelled', reversal_ids=?, cancelled_at=? WHERE id=?", [idList(rev), nowStr(), o.id]);
      await log(conn, o.id, 'cancel', { reversal_vouchers: rev, date, was: o.status }, req);
      return { id: o.id, transfer_no: o.transfer_no };
    });
    res.json(out);
  }));

  // ================= delete: only an untouched posted / in-transit transfer =================
  app.delete('/api/transfers/:id', h(async (req, res) => {
    await tx(async conn => {
      const o = await load(conn, req.params.id);
      if (!['posted', 'in_transit'].includes(o.status)) throw bad('Only a posted or in-transit transfer can be deleted. Cancel a received transfer instead.');
      if (await anyCleared(conn, [o.send_voucher_id, o.charge_voucher_id])) throw bad('This transfer is cleared in the Bank Book and cannot be deleted.');
      await guardLock(req, o.sent_date);
      await conn.query('DELETE FROM transfers WHERE id=?', [o.id]);
      for (const v of [o.send_voucher_id, o.charge_voucher_id].filter(Boolean)) await conn.query('DELETE FROM vouchers WHERE id=?', [v]);
      await log(conn, o.id, 'delete', snap(o), req);
    });
    res.json({ ok: true });
  }));

  // ================= reading =================
  async function clearedMap(db, rows) {
    const ids = [...new Set(rows.flatMap(r => [r.send_voucher_id, r.receive_voucher_id]).filter(Boolean))];
    if (!ids.length) return {};
    const [ls] = await db.query('SELECT voucher_id, account_id, debit, credit, cleared_on FROM voucher_lines WHERE voucher_id IN (?)', [ids]);
    const m = {}; for (const l of ls) (m[l.voucher_id] = m[l.voucher_id] || []).push(l); return m;
  }
  async function listAll(q) {
    const w = [], p = [];
    if (isDate(q.from)) { w.push('t.sent_date>=?'); p.push(q.from); }
    if (isDate(q.to)) { w.push('t.sent_date<=?'); p.push(q.to); }
    if (+q.account) { w.push('(t.from_account_id=? OR t.to_account_id=?)'); p.push(+q.account, +q.account); }
    if (q.status && q.status !== 'legacy') { w.push('t.status=?'); p.push(String(q.status)); }
    if (q.purpose) { w.push('t.purpose=?'); p.push(String(q.purpose)); }
    if (q.q) { const k = '%' + String(q.q).trim() + '%'; w.push('(t.transfer_no LIKE ? OR t.ref_no LIKE ? OR t.party LIKE ? OR t.narration LIKE ?)'); p.push(k, k, k, k); }
    const [rows] = await pool.query(`SELECT t.*, fa.code from_code, fa.name from_name, fa.kind from_kind, ta.code to_code, ta.name to_name, ta.kind to_kind
      FROM transfers t JOIN accounts fa ON fa.id=t.from_account_id JOIN accounts ta ON ta.id=t.to_account_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY t.sent_date DESC, t.id DESC`, p);
    const cl = await clearedMap(pool, rows);
    for (const r of rows) {
      r.total_charges = r2(Number(r.charge_amount) + Number(r.vat_amount));
      const fromLine = (cl[r.send_voucher_id] || []).find(l => l.account_id === r.from_account_id && l.credit > 0);
      const toLine = (cl[r.status === 'received' ? r.receive_voucher_id : r.send_voucher_id] || []).find(l => l.account_id === r.to_account_id && l.debit > 0);
      r.from_cleared = r.from_kind === 'bank' ? (fromLine ? fromLine.cleared_on : null) : undefined;
      r.to_cleared = r.to_kind === 'bank' && ['posted', 'received'].includes(r.status) ? (toLine ? toLine.cleared_on : null) : undefined;
    }
    // contra vouchers made before this module existed (shown read-only)
    if (!q.status || q.status === 'legacy') {
      const [all] = await pool.query('SELECT send_voucher_id s, receive_voucher_id r, charge_voucher_id c, reversal_ids x FROM transfers');
      const linked = new Set(); for (const a of all) { [a.s, a.r, a.c].forEach(v => v && linked.add(v)); String(a.x || '').split(',').filter(Boolean).forEach(v => linked.add(+v)); }
      const vw = ["v.vtype='CT'"], vp = [];
      if (isDate(q.from)) { vw.push('v.vdate>=?'); vp.push(q.from); } if (isDate(q.to)) { vw.push('v.vdate<=?'); vp.push(q.to); }
      const [vs] = await pool.query(`SELECT v.id, v.voucher_no, v.vdate, v.cheque_no, v.party, v.narration FROM vouchers v WHERE ${vw.join(' AND ')} ORDER BY v.vdate DESC, v.id DESC`, vp);
      const lv = vs.filter(v => !linked.has(v.id));
      if (lv.length) {
        const [ls] = await pool.query('SELECT l.voucher_id, l.account_id, l.debit, l.credit, l.cleared_on, a.code, a.name, a.kind FROM voucher_lines l JOIN accounts a ON a.id=l.account_id WHERE l.voucher_id IN (?)', [lv.map(v => v.id)]);
        const by = {}; for (const l of ls) (by[l.voucher_id] = by[l.voucher_id] || []).push(l);
        const kw = q.q ? String(q.q).trim().toLowerCase() : '';
        for (const v of lv) {
          const dr = (by[v.id] || []).find(l => l.debit > 0), cr = (by[v.id] || []).find(l => l.credit > 0);
          if (!dr || !cr) continue;
          if (+q.account && ![dr.account_id, cr.account_id].includes(+q.account)) continue;
          if (kw && ![v.voucher_no, v.cheque_no, v.party, v.narration].some(x => String(x || '').toLowerCase().includes(kw))) continue;
          if (q.purpose) continue;
          rows.push({ id: null, legacy: true, voucher_id: v.id, transfer_no: v.voucher_no, status: 'legacy', sent_date: v.vdate, amount: Number(dr.debit), purpose: null, mode: null, ref_no: v.cheque_no, party: v.party, narration: v.narration,
            from_account_id: cr.account_id, to_account_id: dr.account_id, from_code: cr.code, from_name: cr.name, from_kind: cr.kind, to_code: dr.code, to_name: dr.name, to_kind: dr.kind,
            charge_amount: 0, vat_amount: 0, total_charges: 0, from_cleared: cr.kind === 'bank' ? cr.cleared_on : undefined, to_cleared: dr.kind === 'bank' ? dr.cleared_on : undefined });
        }
        rows.sort((a, b) => (a.sent_date < b.sent_date ? 1 : a.sent_date > b.sent_date ? -1 : 0));
      }
    }
    return rows;
  }
  app.get('/api/transfers', h(async (req, res) => res.json({ rows: await listAll(req.query || {}) })));

  // balances, defaults and labels for the entry screen
  app.get('/api/transfers/meta', h(async (req, res) => {
    const d = isDate(req.query.date) ? req.query.date : today();
    const [accs] = await pool.query("SELECT id FROM accounts WHERE kind IN ('cash','bank')");
    const bal = await balances(pool, accs.map(a => a.id), d);
    const find = async (setting, code) => { const s = Number(await getSetting(setting)) || 0; if (s) return s; const [r] = await pool.query('SELECT id FROM accounts WHERE code=? LIMIT 1', [code]); return r[0] ? r[0].id : null; };
    res.json({ balances: bal, imprest_limit: Number(await getSetting('imprest_limit')) || 0, fit_account_id: await fitId(pool, false), charge_account_id: await find('tr_charge_acct', '5500'), vat_account_id: Number(await getSetting('tr_vat_acct')) || null, purposes: PURPOSES, modes: MODES });
  }));
  // live balances and warnings while the form is being filled
  app.post('/api/transfers/check', h(async (req, res) => {
    const b = req.body || {};
    const t = { sent_date: isDate(b.sent_date) ? b.sent_date : today(), from_account_id: +b.from_account_id, to_account_id: +b.to_account_id, amount: 0, in_transit: !!b.in_transit, charge_amount: 0, vat_amount: 0, charge_from_id: +b.charge_from_id || null };
    try { t.amount = amountOf(b.amount, 'Amount'); t.charge_amount = amountOf(b.charge_amount, 'Bank charge', true); t.vat_amount = amountOf(b.vat_amount, 'VAT', true); } catch (e) { return res.json({ balances: {}, warnings: [] }); }
    if (!t.from_account_id || !t.to_account_id || t.from_account_id === t.to_account_id) return res.json({ balances: {}, warnings: [] });
    const [rows] = await pool.query('SELECT * FROM accounts WHERE id IN (?)', [[t.from_account_id, t.to_account_id]]);
    const accs = Object.fromEntries(rows.map(a => [a.id, a])); if (!accs[t.from_account_id] || !accs[t.to_account_id]) return res.json({ balances: {}, warnings: [] });
    let ex = []; if (+b.exclude_id) { const [[o]] = await pool.query('SELECT send_voucher_id s, charge_voucher_id c FROM transfers WHERE id=?', [+b.exclude_id]); if (o) ex = [o.s, o.c].filter(Boolean); }
    res.json(await warningsFor(pool, t, accs, ex));
  }));

  // totals per account and the in-transit position for a period
  app.get('/api/transfers/summary', h(async (req, res) => {
    const from = isDate(req.query.from) ? req.query.from : '1900-01-01', to = isDate(req.query.to) ? req.query.to : '2999-12-31';
    const all = (await listAll({ ...req.query, from: '', to: '', status: '' })).filter(r => r.status !== 'cancelled');
    const accs = {}, acc = r => (accs[r] = accs[r] || { id: r, sent: 0, received: 0 });
    const names = {}; all.forEach(r => { names[r.from_account_id] = [r.from_code, r.from_name]; names[r.to_account_id] = [r.to_code, r.to_name]; });
    let opening = 0, sent = 0, received = 0, closing = 0, charges = 0, count = 0;
    const inR = d => d >= from && d <= to;
    for (const r of all) {
      const c = cents(r.amount), recvDate = r.status === 'received' ? r.received_date : r.status === 'in_transit' ? null : r.sent_date;
      if (inR(r.sent_date)) { acc(r.from_account_id).sent += c; sent += c; charges += cents(r.total_charges); count++; }
      if (recvDate && inR(recvDate)) { acc(r.to_account_id).received += c; received += c; }
      const openAt = d => r.sent_date < d && !(recvDate && recvDate < d);
      if (r.status !== 'posted' && r.status !== 'legacy') { if (openAt(from)) opening += c; if (r.sent_date <= to && !(recvDate && recvDate <= to)) closing += c; }
    }
    const rows = Object.values(accs).map(a => ({ id: a.id, code: names[a.id][0], name: names[a.id][1], sent: a.sent / 100, received: a.received / 100, net: (a.received - a.sent) / 100 })).sort((a, b) => String(a.code).localeCompare(String(b.code)));
    res.json({ from, to, accounts: rows, count, sent: sent / 100, received: received / 100, charges: charges / 100, in_transit: { opening: opening / 100, closing: closing / 100 }, check_ok: opening + sent - received - closing === 0 });
  }));

  // money sent to petty cash accounts, against the imprest limit
  app.get('/api/transfers/replenishments', h(async (req, res) => {
    const rows = (await listAll({ ...req.query, status: '' })).filter(r => r.to_kind === 'cash' && r.status !== 'cancelled' && r.status !== 'in_transit');
    const limit = Number(await getSetting('imprest_limit')) || 0, out = [];
    for (const r of rows.slice(0, 300)) {
      const date = r.status === 'received' ? r.received_date : r.sent_date, prev = new Date(Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) - 864e5).toISOString().slice(0, 10);
      const b0 = (await balances(pool, [r.to_account_id], prev))[r.to_account_id], b1 = (await balances(pool, [r.to_account_id], date))[r.to_account_id];
      out.push({ transfer_no: r.transfer_no, id: r.id, legacy: !!r.legacy, date, from_name: r.from_name, to_name: r.to_name, amount: Number(r.amount), before: b0, after: b1, over_limit: limit > 0 && cents(b1) > cents(limit) });
    }
    res.json({ imprest_limit: limit, rows: out });
  }));

  app.get('/api/transfers/:id', h(async (req, res) => {
    const t = await load(pool, req.params.id);
    const [[fa]] = await pool.query('SELECT id,code,name,kind FROM accounts WHERE id=?', [t.from_account_id]);
    const [[ta]] = await pool.query('SELECT id,code,name,kind FROM accounts WHERE id=?', [t.to_account_id]);
    const vouchers = {};
    for (const [k, id] of [['send', t.send_voucher_id], ['receive', t.receive_voucher_id], ['charge', t.charge_voucher_id]]) {
      if (!id) continue;
      const [[v]] = await pool.query('SELECT id,voucher_no,vtype,vdate FROM vouchers WHERE id=?', [id]);
      const [ls] = await pool.query('SELECT l.account_id,a.code,a.name,l.debit,l.credit,l.cleared_on FROM voucher_lines l JOIN accounts a ON a.id=l.account_id WHERE l.voucher_id=? ORDER BY l.id', [id]);
      vouchers[k] = { ...v, lines: ls };
    }
    const [lg] = await pool.query('SELECT action,detail,ip,created_at FROM transfer_log WHERE transfer_id=? ORDER BY id', [t.id]);
    const cl = Object.values(vouchers).some(v => v.lines.some(l => l.cleared_on));
    res.json({ ...t, from: fa, to: ta, vouchers, log: lg, any_cleared: cl, purpose_label: PURPOSES[t.purpose], mode_label: MODES[t.mode] });
  }));

  // ================= hooks used by server.js =================
  return {
    // a voucher that belongs to a transfer must be changed from the transfer screen, so the two never disagree
    async guardVoucher(id) {
      const [r] = await pool.query('SELECT transfer_no FROM transfers WHERE send_voucher_id=? OR receive_voucher_id=? OR charge_voucher_id=? OR reversal_ids LIKE ? LIMIT 1', [id, id, id, '%,' + (+id) + ',%']);
      if (r[0]) throw bad(`This voucher belongs to transfer ${r[0].transfer_no}. Change or cancel it from Inter-Account Transfer.`);
    },
    // adds transfer_no to Bank Book / Petty Cash Book rows
    async annotateRows(rows) {
      const ids = [...new Set(rows.map(r => r.voucher_id))]; if (!ids.length) return rows;
      const [ts] = await pool.query('SELECT transfer_no, status, send_voucher_id s, receive_voucher_id r, charge_voucher_id c, reversal_ids x FROM transfers WHERE send_voucher_id IN (?) OR receive_voucher_id IN (?) OR charge_voucher_id IN (?) OR reversal_ids IS NOT NULL', [ids, ids, ids]);
      const m = new Map();
      for (const t of ts) { [t.s, t.r, t.c].forEach(v => v && m.set(v, t)); String(t.x || '').split(',').filter(Boolean).forEach(v => m.set(+v, t)); }
      for (const r of rows) { const t = m.get(r.voucher_id); if (t) { r.transfer_no = t.transfer_no; r.transfer_status = t.status; } }
      return rows;
    },
    async inTransit() {
      const [[r]] = await pool.query("SELECT COUNT(*) n, COALESCE(SUM(amount),0) a FROM transfers WHERE status='in_transit'");
      return { count: r.n, amount: r2(r.a) };
    }
  };
}

module.exports = { migrate, register, COLS, PURPOSES, MODES, DDL };
