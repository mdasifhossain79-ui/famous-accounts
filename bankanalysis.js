// Detailed Bank Transaction Analysis (inside Bank Reconciliation).
// The browser reads the PDF / Excel / CSV statement (see public/recon.js, nothing leaves the computer); this module validates every
// row again on the server, stores the statement exactly as imported, categorises it with editable rules and produces the analysis.
// All money is handled as whole paisa (integers) in code and DECIMAL(16,2) in MySQL, so no floating-point rounding can creep in.
// It only READS vouchers and accounts. It never creates, changes or clears a voucher.
const crypto = require('crypto');

const D = 'DECIMAL(16,2)';
const DDL = [
  `CREATE TABLE IF NOT EXISTS ba_periods (id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, period_from DATE NOT NULL, period_to DATE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE (account_id, period_from, period_to), FOREIGN KEY (account_id) REFERENCES accounts(id))`,
  `CREATE TABLE IF NOT EXISTS ba_imports (id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, period_id INT NULL, file_name VARCHAR(255) NULL, content_hash CHAR(40) NOT NULL,
    bank_name VARCHAR(100) NULL, branch VARCHAR(100) NULL, period_from DATE NOT NULL, period_to DATE NOT NULL, opening_balance ${D} NOT NULL, closing_balance ${D} NULL,
    stated_debit ${D} NULL, stated_credit ${D} NULL, total_debit ${D} NOT NULL DEFAULT 0, total_credit ${D} NOT NULL DEFAULT 0, txn_count INT NOT NULL DEFAULT 0,
    skipped_count INT NOT NULL DEFAULT 0, skipped_json TEXT NULL, validation_ok TINYINT NOT NULL DEFAULT 1, validation_note VARCHAR(400) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (account_id, content_hash), INDEX idx_bai_acc (account_id, period_from), FOREIGN KEY (account_id) REFERENCES accounts(id), FOREIGN KEY (period_id) REFERENCES ba_periods(id))`,
  `CREATE TABLE IF NOT EXISTS ba_categories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, direction VARCHAR(8) NOT NULL, is_charge TINYINT NOT NULL DEFAULT 0,
    active TINYINT NOT NULL DEFAULT 1, sort_no INT NOT NULL DEFAULT 0, UNIQUE (name, direction))`,
  `CREATE TABLE IF NOT EXISTS ba_rules (id INT AUTO_INCREMENT PRIMARY KEY, category_id INT NOT NULL, direction VARCHAR(8) NOT NULL, match_field VARCHAR(12) NOT NULL DEFAULT 'description',
    match_type VARCHAR(10) NOT NULL DEFAULT 'contains', keyword VARCHAR(200) NOT NULL, priority INT NOT NULL DEFAULT 100, mark_internal TINYINT NOT NULL DEFAULT 0, active TINYINT NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_bar_pri (priority), FOREIGN KEY (category_id) REFERENCES ba_categories(id))`,
  `CREATE TABLE IF NOT EXISTS ba_transactions (id INT AUTO_INCREMENT PRIMARY KEY, import_id INT NOT NULL, account_id INT NOT NULL, row_no INT NOT NULL DEFAULT 0, txn_date DATE NOT NULL, value_date DATE NULL,
    description VARCHAR(500) NULL, reference VARCHAR(100) NULL, cheque_no VARCHAR(40) NULL, debit ${D} NOT NULL DEFAULT 0, credit ${D} NOT NULL DEFAULT 0, balance ${D} NULL,
    category_id INT NULL, cat_source VARCHAR(10) NOT NULL DEFAULT 'none', is_internal TINYINT NOT NULL DEFAULT 0, review_status VARCHAR(12) NOT NULL DEFAULT 'new', remarks VARCHAR(500) NULL,
    parse_note VARCHAR(300) NULL, dup_key CHAR(40) NULL, raw_json TEXT NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_bat_acc (account_id, txn_date), INDEX idx_bat_imp (import_id), INDEX idx_bat_cat (category_id), INDEX idx_bat_ref (reference), INDEX idx_bat_dup (dup_key),
    FOREIGN KEY (import_id) REFERENCES ba_imports(id), FOREIGN KEY (account_id) REFERENCES accounts(id), FOREIGN KEY (category_id) REFERENCES ba_categories(id))`,
  `CREATE TABLE IF NOT EXISTS ba_recon_records (id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, period_id INT NULL, as_of DATE NOT NULL, statement_closing ${D} NOT NULL, book_closing ${D} NOT NULL,
    outstanding_cheques ${D} NOT NULL DEFAULT 0, deposits_in_transit ${D} NOT NULL DEFAULT 0, charges_not_in_book ${D} NOT NULL DEFAULT 0, other_debits_not_in_book ${D} NOT NULL DEFAULT 0,
    credits_not_in_book ${D} NOT NULL DEFAULT 0, other_adjustments ${D} NOT NULL DEFAULT 0, other_note VARCHAR(300) NULL, unmatched_bank INT NOT NULL DEFAULT 0, unmatched_book INT NOT NULL DEFAULT 0,
    difference ${D} NOT NULL DEFAULT 0, status VARCHAR(12) NOT NULL DEFAULT 'draft', approval_note VARCHAR(400) NULL, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_barr_acc (account_id, as_of), FOREIGN KEY (account_id) REFERENCES accounts(id))`,
  `CREATE TABLE IF NOT EXISTS ba_audit (id INT AUTO_INCREMENT PRIMARY KEY, entity VARCHAR(12) NOT NULL, entity_id INT NULL, action VARCHAR(24) NOT NULL, detail TEXT NULL, ip VARCHAR(45) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_baa_e (entity, entity_id))`
];
const COLS = {
  ba_periods: ['id', 'account_id', 'period_from', 'period_to'],
  ba_imports: ['id', 'account_id', 'period_id', 'file_name', 'content_hash', 'bank_name', 'branch', 'period_from', 'period_to', 'opening_balance', 'closing_balance', 'stated_debit', 'stated_credit', 'total_debit', 'total_credit', 'txn_count', 'skipped_count', 'skipped_json', 'validation_ok', 'validation_note'],
  ba_categories: ['id', 'name', 'direction', 'is_charge', 'active', 'sort_no'],
  ba_rules: ['id', 'category_id', 'direction', 'match_field', 'match_type', 'keyword', 'priority', 'mark_internal', 'active'],
  ba_transactions: ['id', 'import_id', 'account_id', 'row_no', 'txn_date', 'value_date', 'description', 'reference', 'cheque_no', 'debit', 'credit', 'balance', 'category_id', 'cat_source', 'is_internal', 'review_status', 'remarks', 'parse_note', 'dup_key', 'raw_json', 'voucher_id'],
  ba_recon_records: ['id', 'account_id', 'period_id', 'as_of', 'statement_closing', 'book_closing', 'outstanding_cheques', 'deposits_in_transit', 'charges_not_in_book', 'other_debits_not_in_book', 'credits_not_in_book', 'other_adjustments', 'other_note', 'unmatched_bank', 'unmatched_book', 'difference', 'status', 'approval_note'],
  ba_audit: ['id', 'entity', 'entity_id', 'action', 'detail', 'ip']
};
const TABLES_DELETE_ORDER = ['ba_audit', 'ba_recon_records', 'ba_transactions', 'ba_rules', 'ba_categories', 'ba_imports', 'ba_periods'];

// ----- starting categories and rules (written once, never again, so deleting one stays deleted) -----
const CATS = [
  ['credit', 'LC Assignment Credits'], ['credit', 'Transfers from Other Accounts'], ['credit', 'Cash Deposits'], ['credit', 'Cheque Deposits'], ['credit', 'RTGS Credits'], ['credit', 'BEFTN/EFTN Credits'], ['credit', 'Customer Receipts'], ['credit', 'Other Credits'],
  ['debit', 'RTGS Funds Transfers'], ['debit', 'Cash Withdrawals'], ['debit', 'Investment Repayments'], ['debit', 'Inward Clearing Cheques'], ['debit', 'LC Opening Commission', 1], ['debit', 'LC Negotiation Commission', 1],
  ['debit', 'LC Acceptance Commission', 1], ['debit', 'LC Amendment Commission', 1], ['debit', 'LC SWIFT Charges', 1], ['debit', 'Stamp Charges', 1], ['debit', 'Miscellaneous Bank Charges', 1], ['debit', 'VAT on Banking Services', 1],
  ['debit', 'CIB Charges', 1], ['debit', 'Credit Report Charges', 1], ['debit', 'Guarantee Issuance Charges', 1], ['debit', 'Account Transfers'], ['debit', 'Other Bank Charges', 1]
];
const RULES = [   // direction, keyword, category, priority (a smaller number is tried first)
  ['credit', 'assignment under lc', 'LC Assignment Credits', 10], ['credit', 'rtgs', 'RTGS Credits', 30], ['credit', 'beftn', 'BEFTN/EFTN Credits', 30], ['credit', 'eftn', 'BEFTN/EFTN Credits', 31],
  ['credit', 'cash deposit', 'Cash Deposits', 30], ['credit', 'cheque deposit', 'Cheque Deposits', 40], ['credit', 'chq deposit', 'Cheque Deposits', 40], ['credit', 'clearing', 'Cheque Deposits', 45],
  ['credit', 'transfer from', 'Transfers from Other Accounts', 50], ['credit', 'fund transfer', 'Transfers from Other Accounts', 55], ['credit', 'transfer', 'Transfers from Other Accounts', 60],
  ['debit', 'rtgs funds transfer', 'RTGS Funds Transfers', 10], ['debit', 'rtgs', 'RTGS Funds Transfers', 40], ['debit', 'cash withdrawal', 'Cash Withdrawals', 10], ['debit', 'cash wdl', 'Cash Withdrawals', 10],
  ['debit', 'repayment', 'Investment Repayments', 20], ['debit', 'inward clg chq', 'Inward Clearing Cheques', 10], ['debit', 'inward clearing', 'Inward Clearing Cheques', 10],
  ['debit', 'opening commission', 'LC Opening Commission', 10], ['debit', 'negotiation commission', 'LC Negotiation Commission', 10], ['debit', 'acceptance commission', 'LC Acceptance Commission', 10],
  ['debit', 'amendment commission', 'LC Amendment Commission', 10], ['debit', 'lc swift charges', 'LC SWIFT Charges', 10], ['debit', 'swift', 'LC SWIFT Charges', 20],
  ['debit', 'stamp charge', 'Stamp Charges', 10], ['debit', 'stamp duty', 'Stamp Charges', 10], ['debit', 'vat', 'VAT on Banking Services', 25], ['debit', 'cib', 'CIB Charges', 20],
  ['debit', 'credit report', 'Credit Report Charges', 20], ['debit', 'guarantee issu', 'Guarantee Issuance Charges', 10], ['debit', 'guarantee', 'Guarantee Issuance Charges', 30],
  ['debit', 'bank charge', 'Miscellaneous Bank Charges', 30], ['debit', 'service charge', 'Miscellaneous Bank Charges', 30], ['debit', 'misc charge', 'Miscellaneous Bank Charges', 30],
  ['debit', 'transfer', 'Account Transfers', 60], ['debit', 'charge', 'Other Bank Charges', 90], ['debit', 'commission', 'Other Bank Charges', 90], ['debit', 'fee', 'Other Bank Charges', 95]
];
async function migrate(pool, getSetting, setSetting) {
  for (const q of DDL) await pool.query(q);
  try { await pool.query('ALTER TABLE ba_transactions ADD COLUMN voucher_id INT NULL'); } catch (e) { if (!/duplicate column|exists/i.test(e.message)) throw e; }   // voucher created from this bank line (safe to repeat)
  if (await getSetting('ba_seeded')) return;
  const id = {};
  for (const [dir, name, chg] of CATS) {
    const [ex] = await pool.query('SELECT id FROM ba_categories WHERE name=? AND direction=?', [name, dir]);
    id[dir + name] = ex[0] ? ex[0].id : (await pool.query('INSERT INTO ba_categories (name,direction,is_charge,sort_no) VALUES (?,?,?,?)', [name, dir, chg ? 1 : 0, Object.keys(id).length]))[0].insertId;
  }
  for (const [dir, kw, name, pri] of RULES) await pool.query('INSERT INTO ba_rules (category_id,direction,keyword,priority) VALUES (?,?,?,?)', [id[dir + name], dir, kw, pri]);
  await setSetting('ba_seeded', '1');
}

const REVIEW = { new: 'New', reviewed: 'Reviewed', investigate: 'Needs investigation', accepted: 'Accepted', incorrect: 'Incorrect data' };
const FLAGS = { large: 'Large-value transaction', dup_ref: 'Duplicate reference', possible_dup: 'Possible duplicate', missing_desc: 'Missing description', bad_amount: 'Zero or invalid amount',
  balance_jump: 'Unexpected balance movement', unclassified: 'Unclassified', date_sequence: 'Date out of sequence', date_value: 'Value date far from transaction date', date_future: 'Future date', statement_mismatch: 'Does not reconcile with statement totals' };
const MAX_ROWS = 60000;

function register(ctx) {
  const { app, h, bad, isDate, today, getSetting, setSetting, saveVoucher } = ctx;
  const pool = { query: (...a) => ctx.getPool().query(...a), getConnection: (...a) => ctx.getPool().getConnection(...a) };
  const tx = async fn => { const c = await pool.getConnection(); try { await c.beginTransaction(); const r = await fn(c); await c.commit(); return r; } catch (e) { await c.rollback(); throw e; } finally { c.release(); } };

  // ---------- exact money helpers (whole paisa) ----------
  const toC = v => Math.round(Number(v || 0) * 100);            // a DECIMAL(16,2) value already has two decimals, so this is exact
  const fromC = c => c / 100;
  const AMT = /^\d+(\.\d{1,2})?$/;
  function parseMoney(v, allowNeg) {   // -> { c, empty, err }  (a balance may be negative on an overdraft account; debit and credit amounts may not)
    if (v === null || v === undefined || (typeof v === 'string' && v.trim() === '')) return { c: 0, empty: true };
    let s = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : 'x') : String(v).trim();
    s = s.replace(/[,\s]/g, '').replace(/^(bdt|tk\.?|৳)/i, '');
    let neg = false; if (allowNeg && /^-/.test(s)) { neg = true; s = s.slice(1); }
    if (!AMT.test(s)) return { c: 0, err: /^-/.test(s) ? 'Negative amount (use the other column)' : /\.\d{3,}/.test(s) ? 'More than 2 decimals' : 'Not a valid amount' };
    const c = Math.round(Number(s) * 100); return Number.isSafeInteger(c) && c <= 99999999999999 ? { c: neg ? -c : c } : { c: 0, err: 'Amount is too large' };
  }
  const iso = s => { if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return null; const d = new Date(s + 'T00:00:00Z'); return !isNaN(d) && d.toISOString().slice(0, 10) === s ? s : null; };
  const dayDiff = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 864e5);
  const normText = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const digits = s => String(s || '').replace(/\D/g, '').replace(/^0+/, '');
  const sha = s => crypto.createHash('sha1').update(s).digest('hex');
  const mask = no => { const s = String(no || '').replace(/\s/g, ''); return s ? '•••• ' + s.slice(-4) : ''; };
  const audit = (db, entity, id, action, detail, req) => db.query('INSERT INTO ba_audit (entity,entity_id,action,detail,ip) VALUES (?,?,?,?,?)', [entity, id || null, action, JSON.stringify(detail || {}).slice(0, 4000), (req && req.socket && req.socket.remoteAddress || '').slice(0, 45)]);
  const intParam = v => (Number.isInteger(+v) && +v > 0 ? +v : 0);

  async function bankAccount(db, id) {
    const [[a]] = await db.query('SELECT id,code,name,kind,bank_name,account_no,opening_balance,opening_side FROM accounts WHERE id=?', [intParam(id)]);
    if (!a || a.kind !== 'bank') throw bad('Choose a bank account');
    return a;
  }

  // ---------- categorisation ----------
  async function loadRules(db) {
    const [r] = await db.query('SELECT r.*, c.name category_name, c.active cat_active FROM ba_rules r JOIN ba_categories c ON c.id=r.category_id WHERE r.active=1 AND c.active=1 ORDER BY r.priority, r.id');
    return r;
  }
  const hit = (rule, text) => { const k = normText(rule.keyword); if (!k) return false; return rule.match_type === 'equals' ? text === k : rule.match_type === 'starts' ? text.startsWith(k) : text.includes(k); };
  function classify(rules, t) {   // t: { dir:'credit'|'debit', description, reference } -> { category_id, is_internal, note }
    const d = normText(t.description), r = normText(t.reference), found = [];
    for (const rule of rules) {
      if (rule.direction !== 'any' && rule.direction !== t.dir) continue;
      const ok = rule.match_field === 'reference' ? hit(rule, r) : rule.match_field === 'either' ? hit(rule, d) || hit(rule, r) : hit(rule, d);
      if (ok) { if (found.length && rule.priority > found[0].priority) break; found.push(rule); }
    }
    if (!found.length) return { category_id: null, is_internal: 0, note: '' };
    const cats = new Set(found.map(f => f.category_id));
    if (cats.size > 1) return { category_id: null, is_internal: 0, note: 'Conflicting rules (' + [...new Set(found.map(f => f.category_name))].join(' / ') + ') - needs manual review' };
    return { category_id: found[0].category_id, is_internal: found.some(f => f.mark_internal) ? 1 : 0, note: '' };
  }
  // a bank line that matches a contra / inter-account transfer voucher of the same account is an internal transfer, not income or expense
  async function internalHints(db, accountId) {
    const [ls] = await db.query("SELECT l.debit, l.credit, v.vdate, v.voucher_no, v.ref FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE v.vtype='CT' AND l.account_id=?", [accountId]);
    return ls.map(l => ({ side: toC(l.credit) > 0 ? 'debit' : 'credit', c: toC(l.credit) > 0 ? toC(l.credit) : toC(l.debit), date: l.vdate, no: l.ref || l.voucher_no, used: false }));
  }
  function internalMatch(hints, t) {
    const c = t.dir === 'debit' ? t.c_debit : t.c_credit; let best = null, bd = 99;
    for (const h of hints) { if (h.used || h.side !== t.dir || h.c !== c) continue; const d = Math.abs(dayDiff(t.date, h.date)); if (d <= 7 && d < bd) { best = h; bd = d; } }
    if (best) best.used = true; return best;
  }

  // ---------- checking the rows of a statement (used for the preview and again on save) ----------
  async function prepare(db, body) {
    const acc = await bankAccount(db, body.account_id);
    const input = Array.isArray(body.rows) ? body.rows : [];
    if (!input.length) throw bad('There are no transactions to import');
    if (input.length > MAX_ROWS) throw bad(`Too many rows (maximum ${MAX_ROWS})`);
    const rows = input.map((r, i) => {
      const issues = [], o = { n: r.n || i + 1, raw: r.raw === undefined ? null : r.raw, exclude: !!r.exclude, keep_duplicate: !!r.keep_duplicate };
      o.date = iso(r.date); if (!o.date) issues.push(['error', r.date ? 'Date "' + String(r.date).slice(0, 20) + '" is not a valid date' : 'Date is missing']);
      o.value_date = r.value_date ? iso(r.value_date) : null; if (r.value_date && !o.value_date) issues.push(['warn', 'Value date is not valid and was left empty']);
      const dr = parseMoney(r.debit), cr = parseMoney(r.credit), bl = parseMoney(r.balance, true);
      if (dr.err) issues.push(['error', 'Debit: ' + dr.err]); if (cr.err) issues.push(['error', 'Credit: ' + cr.err]);
      if (bl.err && !bl.empty) issues.push(['warn', 'Balance: ' + bl.err]);
      o.c_debit = dr.c; o.c_credit = cr.c; o.c_balance = bl.empty || bl.err ? null : bl.c;
      if (!dr.err && !cr.err) { if (dr.c > 0 && cr.c > 0) issues.push(['error', 'Both debit and credit have an amount']); else if (!dr.c && !cr.c) issues.push(['error', 'No debit or credit amount']); }
      let desc = String(r.description === undefined || r.description === null ? '' : r.description).replace(/\s+/g, ' ').trim();
      if (!desc) issues.push(['warn', 'Description is missing']);
      if (desc.length > 500) { desc = desc.slice(0, 500); issues.push(['warn', 'Description was longer than 500 characters (the original is kept in the saved copy)']); }
      o.description = desc; o.reference = String(r.reference || '').trim().slice(0, 100); o.cheque_no = String(r.cheque_no || '').trim().slice(0, 40);
      o.dir = o.c_debit > 0 ? 'debit' : 'credit'; o.issues = issues;
      return o;
    });
    // statements are printed oldest-first or newest-first; the running balance tells us which, so it can be checked row by row
    const withBal = rows.filter(r => r.c_balance !== null && !r.issues.some(i => i[0] === 'error'));
    let asc = 0, desc = 0;
    for (let i = 1; i < withBal.length; i++) { const a = withBal[i - 1], b = withBal[i]; if (b.c_balance === a.c_balance + b.c_credit - b.c_debit) asc++; if (a.c_balance === b.c_balance + a.c_credit - a.c_debit) desc++; }
    let order = withBal.length > 2 ? (desc > asc ? 'desc' : 'asc') : 'unknown';
    if (order === 'unknown') { const ds = rows.map(r => r.date).filter(Boolean); if (ds.length > 1 && ds[0] > ds[ds.length - 1]) order = 'desc'; }
    const ordered = order === 'desc' ? rows.slice().reverse() : rows.slice();
    ordered.forEach((r, i) => { r.seq = i + 1; });
    let prev = null, jumps = 0;
    for (const r of ordered) {
      if (r.c_balance !== null && prev && prev.c_balance !== null && !r.issues.some(i => i[0] === 'error')) {
        if (r.c_balance !== prev.c_balance + r.c_credit - r.c_debit) { r.issues.push(['warn', 'Running balance does not follow from the previous row']); jumps++; }
      }
      if (!r.issues.some(i => i[0] === 'error')) prev = r;
    }
    // duplicates: against already saved rows and inside the file
    rows.forEach(r => { r.dup_key = r.date ? sha([acc.id, r.date, normText(r.description), r.c_debit, r.c_credit, r.c_balance === null ? '' : r.c_balance].join('|')) : null; });
    const keys = [...new Set(rows.map(r => r.dup_key).filter(Boolean))], existing = new Map();
    for (let i = 0; i < keys.length; i += 500) { const [ex] = await db.query('SELECT dup_key, import_id FROM ba_transactions WHERE account_id=? AND dup_key IN (?)', [acc.id, keys.slice(i, i + 500)]); ex.forEach(e => existing.set(e.dup_key, e.import_id)); }
    const seen = new Map();
    for (const r of ordered) {
      if (!r.dup_key) continue;
      if (existing.has(r.dup_key)) { r.dup_existing = existing.get(r.dup_key); r.issues.push(['warn', 'Already imported earlier (import #' + r.dup_existing + ')']); }
      if (seen.has(r.dup_key)) { r.dup_in_file = true; r.issues.push(['warn', 'Identical to row ' + seen.get(r.dup_key) + ' of this file']); } else seen.set(r.dup_key, r.n);
    }
    rows.forEach(r => { r.status = r.issues.some(i => i[0] === 'error') ? 'error' : r.issues.length ? 'review' : 'ok'; r.skip_dup = !!r.dup_existing && !r.keep_duplicate; });
    const used = ordered.filter(r => !r.exclude && !r.skip_dup && r.status !== 'error');
    let td = 0, tc = 0; used.forEach(r => { td += r.c_debit; tc += r.c_credit; });
    // opening / closing / totals
    const op = body.opening_balance === undefined || body.opening_balance === '' || body.opening_balance === null ? null : parseMoney(body.opening_balance, true);
    const cl = body.closing_balance === undefined || body.closing_balance === '' || body.closing_balance === null ? null : parseMoney(body.closing_balance, true);
    const sd = body.stated_debit === undefined || body.stated_debit === '' || body.stated_debit === null ? null : parseMoney(body.stated_debit);
    const sc = body.stated_credit === undefined || body.stated_credit === '' || body.stated_credit === null ? null : parseMoney(body.stated_credit);
    for (const [m, label] of [[op, 'Opening balance'], [cl, 'Closing balance'], [sd, 'Statement total debit'], [sc, 'Statement total credit']]) if (m && m.err) throw bad(label + ': ' + m.err);
    const first = used.find(r => r.c_balance !== null), last = [...used].reverse().find(r => r.c_balance !== null);
    const opening = op ? op.c : first ? first.c_balance - first.c_credit + first.c_debit : null;
    const closing = cl ? cl.c : last ? last.c_balance : null;
    const checks = []; let vOk = true;
    if (opening === null) { vOk = false; checks.push({ ok: false, label: 'Opening balance', msg: 'Enter the opening balance (the statement has no running balance to work it out from)' }); }
    else if (closing !== null) {
      const calc = opening + tc - td, diff = closing - calc;
      checks.push({ ok: diff === 0, label: 'Closing balance', msg: diff === 0 ? 'Opening + credits - debits equals the statement closing balance' : `Opening + credits - debits = ${fromC(calc).toFixed(2)} but the statement closing balance is ${fromC(closing).toFixed(2)} (difference ${fromC(diff).toFixed(2)})` });
      if (diff !== 0) vOk = false;
    } else checks.push({ ok: false, label: 'Closing balance', msg: 'No closing balance to compare with. Enter it to complete the check.' });
    if (sd) { const ok = sd.c === td; checks.push({ ok, label: 'Total debit', msg: ok ? 'Matches the statement total' : `Rows add up to ${fromC(td).toFixed(2)}, statement says ${fromC(sd.c).toFixed(2)}` }); if (!ok) vOk = false; }
    if (sc) { const ok = sc.c === tc; checks.push({ ok, label: 'Total credit', msg: ok ? 'Matches the statement total' : `Rows add up to ${fromC(tc).toFixed(2)}, statement says ${fromC(sc.c).toFixed(2)}` }); if (!ok) vOk = false; }
    if (jumps) checks.push({ ok: false, label: 'Running balance', msg: jumps + ' row(s) where the balance does not follow from the row before' });
    const dates = used.map(r => r.date).sort();
    const contentHash = sha(acc.id + '|' + ordered.filter(r => !r.exclude && r.status !== 'error').map(r => r.dup_key + ':' + r.seq).sort().join(','));   // the whole file, so importing it again is caught even though every row is then a duplicate
    const [same] = await db.query('SELECT id, file_name, created_at FROM ba_imports WHERE account_id=? AND content_hash=?', [acc.id, contentHash]);
    let overlap = [];
    if (dates.length) { const [ov] = await db.query('SELECT id, file_name, period_from, period_to FROM ba_imports WHERE account_id=? AND period_from<=? AND period_to>=?', [acc.id, dates[dates.length - 1], dates[0]]); overlap = ov; }
    return { acc, rows, ordered, used, order, opening, closing, td, tc, checks, vOk, dates, contentHash, already: same[0] || null, overlap, stated: { sd, sc, cl } };
  }
  const outRow = r => ({ n: r.n, seq: r.seq, date: r.date, value_date: r.value_date, description: r.description, reference: r.reference, cheque_no: r.cheque_no, debit: fromC(r.c_debit), credit: fromC(r.c_credit),
    balance: r.c_balance === null ? null : fromC(r.c_balance), status: r.status, issues: r.issues.map(i => ({ level: i[0], msg: i[1] })), dup_existing: r.dup_existing || null, dup_in_file: !!r.dup_in_file, skip_dup: r.skip_dup, category_name: r.cat_name || '', is_internal: r.is_internal ? 1 : 0, hint: r.hint || '' });

  async function suggestions(db, p) {   // what the rules (and matching transfer vouchers) would do with each row, used in the preview
    const rules = await loadRules(db), hints = await internalHints(db, p.acc.id), [cats] = await db.query('SELECT id,name FROM ba_categories'), nm = new Map(cats.map(c => [c.id, c.name]));
    for (const r of p.ordered) {
      if (r.status === 'error') continue;
      const c = classify(rules, { dir: r.dir, description: r.description, reference: r.reference });
      r.category_id = c.category_id; r.is_internal = c.is_internal; r.cat_name = c.category_id ? nm.get(c.category_id) : ''; r.cat_source = c.category_id ? 'rule' : 'none'; r.parse_note = c.note || '';
      if (!r.is_internal) { const m = internalMatch(hints, { dir: r.dir, c_debit: r.c_debit, c_credit: r.c_credit, date: r.date }); if (m) { r.is_internal = 1; r.cat_source = 'transfer'; r.hint = 'Matches transfer ' + m.no; } }
      if (c.note) r.hint = c.note;
    }
  }
  const summaryOf = p => ({ order: p.order, rows_total: p.rows.length, rows_ok: p.rows.filter(r => r.status === 'ok').length, rows_review: p.rows.filter(r => r.status === 'review').length, rows_error: p.rows.filter(r => r.status === 'error' && !r.exclude).length,
    rows_dup: p.rows.filter(r => r.skip_dup).length, rows_used: p.used.length, total_debit: fromC(p.td), total_credit: fromC(p.tc), opening: p.opening === null ? null : fromC(p.opening), closing: p.closing === null ? null : fromC(p.closing),
    computed_closing: p.opening === null ? null : fromC(p.opening + p.tc - p.td), checks: p.checks, validation_ok: p.vOk, period_from: p.dates[0] || null, period_to: p.dates[p.dates.length - 1] || null,
    already_imported: p.already ? { id: p.already.id, file_name: p.already.file_name } : null, overlap: p.overlap.map(o => ({ id: o.id, file_name: o.file_name, from: o.period_from, to: o.period_to })) });

  app.post('/api/ba/import/preview', h(async (req, res) => {
    const p = await prepare(pool, req.body || {}); await suggestions(pool, p);
    res.json({ summary: summaryOf(p), rows: p.rows.map(outRow), bank_name: p.acc.bank_name || '', account: p.acc.name, masked_account: mask(p.acc.account_no) });
  }));

  app.post('/api/ba/import/commit', h(async (req, res) => {
    const b = req.body || {};
    const out = await tx(async conn => {
      const p = await prepare(conn, b);
      if (p.already) throw bad(`This statement was already imported (import #${p.already.id}${p.already.file_name ? ', ' + p.already.file_name : ''}). Nothing was saved.`);
      const errs = p.rows.filter(r => r.status === 'error' && !r.exclude);
      if (errs.length) throw bad(`${errs.length} row(s) still have errors (first: row ${errs[0].n}: ${errs[0].issues.find(i => i[0] === 'error')[1]}). Correct them or exclude them, then save again.`);
      if (!p.used.length) throw bad('There are no rows left to import');
      if (p.opening === null) throw bad('Enter the opening balance');
      if (!p.vOk && !b.accept_mismatch) throw bad('The statement totals do not reconcile: ' + p.checks.filter(c => !c.ok).map(c => c.msg).join('; ') + '. Fix the rows, or tick "Save anyway" to keep it marked as not reconciled.');
      await suggestions(conn, p);
      const from = p.dates[0], to = p.dates[p.dates.length - 1];
      const [pr] = await conn.query('SELECT id FROM ba_periods WHERE account_id=? AND period_from=? AND period_to=?', [p.acc.id, from, to]);
      const periodId = pr[0] ? pr[0].id : (await conn.query('INSERT INTO ba_periods (account_id,period_from,period_to) VALUES (?,?,?)', [p.acc.id, from, to]))[0].insertId;
      const skipped = p.rows.filter(r => r.exclude || r.skip_dup).map(r => ({ row: r.n, date: r.date, description: r.description, debit: fromC(r.c_debit), credit: fromC(r.c_credit), reason: r.exclude ? 'excluded by user' : 'duplicate of an earlier import', raw: r.raw }));
      const note = p.vOk ? null : p.checks.filter(c => !c.ok).map(c => c.msg).join('; ').slice(0, 400);
      const closing = p.closing;
      const [ins] = await conn.query('INSERT INTO ba_imports SET ?', [{ account_id: p.acc.id, period_id: periodId, file_name: String(b.file_name || '').slice(0, 255) || null, content_hash: p.contentHash, bank_name: String(b.bank_name || p.acc.bank_name || '').slice(0, 100) || null,
        branch: String(b.branch || '').slice(0, 100) || null, period_from: from, period_to: to, opening_balance: fromC(p.opening), closing_balance: closing === null ? null : fromC(closing),
        stated_debit: p.stated.sd ? fromC(p.stated.sd.c) : null, stated_credit: p.stated.sc ? fromC(p.stated.sc.c) : null, total_debit: fromC(p.td), total_credit: fromC(p.tc), txn_count: p.used.length,
        skipped_count: skipped.length, skipped_json: skipped.length ? JSON.stringify(skipped).slice(0, 60000) : null, validation_ok: p.vOk ? 1 : 0, validation_note: note }]);
      const rowsOut = p.used.map(r => [ins.insertId, p.acc.id, r.seq, r.date, r.value_date, r.description || null, r.reference || null, r.cheque_no || null, fromC(r.c_debit), fromC(r.c_credit), r.c_balance === null ? null : fromC(r.c_balance),
        r.category_id || null, r.cat_source || 'none', r.is_internal ? 1 : 0, 'new', r.hint ? r.hint.slice(0, 500) : null, r.issues.length ? r.issues.map(i => i[1]).join('; ').slice(0, 300) : null, r.dup_key, JSON.stringify(r.raw).slice(0, 8000)]);
      for (let i = 0; i < rowsOut.length; i += 200) await conn.query('INSERT INTO ba_transactions (import_id,account_id,row_no,txn_date,value_date,description,reference,cheque_no,debit,credit,balance,category_id,cat_source,is_internal,review_status,remarks,parse_note,dup_key,raw_json) VALUES ?', [rowsOut.slice(i, i + 200)]);
      await audit(conn, 'import', ins.insertId, 'import', { account: p.acc.code, file: b.file_name, rows: p.used.length, skipped: skipped.length, debit: fromC(p.td), credit: fromC(p.tc), reconciled: p.vOk }, req);
      return { id: ins.insertId, rows: p.used.length, skipped: skipped.length, total_debit: fromC(p.td), total_credit: fromC(p.tc), validation_ok: p.vOk };
    });
    res.json(out);
  }));

  app.get('/api/ba/imports', h(async (req, res) => {
    const w = [], p = []; if (intParam(req.query.account_id)) { w.push('i.account_id=?'); p.push(+req.query.account_id); }
    const [r] = await pool.query(`SELECT i.id, i.account_id, a.code, a.name, i.file_name, i.bank_name, i.branch, i.period_from, i.period_to, i.opening_balance, i.closing_balance, i.total_debit, i.total_credit, i.txn_count, i.skipped_count, i.validation_ok, i.validation_note, i.created_at
      FROM ba_imports i JOIN accounts a ON a.id=i.account_id ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY i.account_id, i.period_from, i.id`, p);
    res.json({ rows: r });
  }));
  app.get('/api/ba/imports/:id/skipped', h(async (req, res) => { const [[i]] = await pool.query('SELECT skipped_json FROM ba_imports WHERE id=?', [intParam(req.params.id)]); res.json({ rows: i && i.skipped_json ? JSON.parse(i.skipped_json) : [] }); }));
  app.delete('/api/ba/imports/:id', h(async (req, res) => {
    if (!req.body || req.body.confirm !== true) throw bad('Please confirm that you want to delete this imported statement');
    await tx(async conn => {
      const [[i]] = await conn.query('SELECT * FROM ba_imports WHERE id=?', [intParam(req.params.id)]); if (!i) throw Object.assign(new Error('Import not found'), { status: 404 });
      const [[n]] = await conn.query('SELECT COUNT(*) n FROM ba_transactions WHERE import_id=?', [i.id]);
      await conn.query('DELETE FROM ba_transactions WHERE import_id=?', [i.id]); await conn.query('DELETE FROM ba_imports WHERE id=?', [i.id]);
      const [left] = await conn.query('SELECT COUNT(*) n FROM ba_imports WHERE period_id=?', [i.period_id]); if (!left[0].n && i.period_id) await conn.query('DELETE FROM ba_periods WHERE id=?', [i.period_id]);
      await audit(conn, 'import', i.id, 'delete', { file: i.file_name, rows: n.n, from: i.period_from, to: i.period_to, debit: i.total_debit, credit: i.total_credit }, req);
    });
    res.json({ ok: true });
  }));

  // ---------- reading transactions with filters ----------
  function where(q) {
    const w = ['1=1'], p = [];
    if (intParam(q.account_id)) { w.push('t.account_id=?'); p.push(+q.account_id); }
    if (q.bank) { w.push('i.bank_name=?'); p.push(String(q.bank)); }
    if (q.branch) { w.push('i.branch=?'); p.push(String(q.branch)); }
    if (iso(q.from)) { w.push('t.txn_date>=?'); p.push(q.from); }
    if (iso(q.to)) { w.push('t.txn_date<=?'); p.push(q.to); }
    if (q.type === 'debit') w.push('t.debit>0'); else if (q.type === 'credit') w.push('t.credit>0');
    if (q.category === 'none') w.push('t.category_id IS NULL AND t.is_internal=0'); else if (q.category === 'internal') w.push('t.is_internal=1'); else if (intParam(q.category)) { w.push('t.category_id=? AND t.is_internal=0'); p.push(+q.category); }
    if (REVIEW[q.status]) { w.push('t.review_status=?'); p.push(q.status); }
    if (q.q && String(q.q).trim()) { const k = '%' + String(q.q).trim() + '%'; w.push('(t.description LIKE ? OR t.reference LIKE ? OR t.cheque_no LIKE ?)'); p.push(k, k, k); }
    return { sql: w.join(' AND '), p };
  }
  const SEL = `SELECT t.id, t.import_id, t.account_id, t.row_no, t.txn_date, t.value_date, t.description, t.reference, t.cheque_no, t.debit, t.credit, t.balance, t.category_id, t.cat_source, t.is_internal, t.review_status, t.remarks, t.parse_note,
    c.name category_name, c.is_charge, i.bank_name, i.branch, a.code account_code, a.name account_name
    FROM ba_transactions t JOIN ba_imports i ON i.id=t.import_id JOIN accounts a ON a.id=t.account_id LEFT JOIN ba_categories c ON c.id=t.category_id`;
  const rowsOf = async q => { const w = where(q); const [r] = await pool.query(`${SEL} WHERE ${w.sql} ORDER BY t.txn_date, t.account_id, t.import_id, t.row_no, t.id`, w.p); r.forEach(x => { x.c_debit = toC(x.debit); x.c_credit = toC(x.credit); }); return r; };
  const dirOf = r => (r.c_debit > 0 ? 'debit' : 'credit');

  // accounts and filter lists
  app.get('/api/ba/accounts', h(async (req, res) => {
    const [accs] = await pool.query("SELECT id,code,name,bank_name,account_no FROM accounts WHERE kind='bank' ORDER BY code");
    const [imps] = await pool.query('SELECT account_id, COUNT(*) n, MIN(period_from) f, MAX(period_to) t FROM ba_imports GROUP BY account_id');
    const [bb] = await pool.query('SELECT DISTINCT bank_name, branch FROM ba_imports');
    const by = new Map(imps.map(i => [i.account_id, i]));
    res.json({ accounts: accs.map(a => ({ id: a.id, code: a.code, name: a.name, bank_name: a.bank_name || '', masked: mask(a.account_no), imports: by.get(a.id) ? by.get(a.id).n : 0, from: by.get(a.id) ? by.get(a.id).f : null, to: by.get(a.id) ? by.get(a.id).t : null })),
      banks: [...new Set(bb.map(x => x.bank_name).filter(Boolean))].sort(), branches: [...new Set(bb.map(x => x.branch).filter(Boolean))].sort(), large_threshold: Number(await getSetting('ba_large_threshold')) || 0 });
  }));
  app.put('/api/ba/settings', h(async (req, res) => {
    const v = req.body && req.body.large_threshold; const m = parseMoney(v === '' || v === null || v === undefined ? '0' : v); if (m.err) throw bad('Large-value limit: ' + m.err);
    await setSetting('ba_large_threshold', String(fromC(m.c))); res.json({ ok: true });
  }));

  // ---------- analysis (cards, credit and debit by category) ----------
  async function openingOf(q) {
    const w = [], p = []; if (intParam(q.account_id)) { w.push('account_id=?'); p.push(+q.account_id); } if (q.bank) { w.push('bank_name=?'); p.push(String(q.bank)); } if (q.branch) { w.push('branch=?'); p.push(String(q.branch)); }
    const [accs] = await pool.query(`SELECT DISTINCT account_id FROM ba_imports ${w.length ? 'WHERE ' + w.join(' AND ') : ''}`, p);
    let total = 0, first = null;
    for (const a of accs) {
      const [[f]] = await pool.query('SELECT opening_balance, period_from FROM ba_imports WHERE account_id=? ORDER BY period_from, id LIMIT 1', [a.account_id]);
      let c = toC(f.opening_balance);
      if (iso(q.from)) { const [[n]] = await pool.query('SELECT COALESCE(SUM(credit),0) cr, COALESCE(SUM(debit),0) dr FROM ba_transactions WHERE account_id=? AND txn_date<?', [a.account_id, q.from]); c += toC(n.cr) - toC(n.dr); }
      total += c; if (!first || f.period_from < first) first = f.period_from;
    }
    return { c: total, accounts: accs.length };
  }
  function groups(rows, dir, totalC, names) {
    const g = new Map();
    for (const r of rows) {
      if (dirOf(r) !== dir) continue;
      const c = dir === 'debit' ? r.c_debit : r.c_credit, key = r.is_internal ? 'internal' : r.category_id ? String(r.category_id) : 'none';
      const x = g.get(key) || { key, category_id: r.category_id && !r.is_internal ? r.category_id : null, name: key === 'internal' ? 'Internal transfers (between own accounts)' : key === 'none' ? (dir === 'debit' ? 'Uncategorized Debits' : 'Uncategorized Credits') : r.category_name, count: 0, c: 0, is_charge: key !== 'internal' && key !== 'none' && !!r.is_charge };
      x.count++; x.c += c; g.set(key, x);
    }
    return [...g.values()].sort((a, b) => b.c - a.c).map(x => ({ key: x.key, category_id: x.category_id, name: x.name, count: x.count, amount: fromC(x.c), percent: totalC ? Math.round(x.c * 10000 / totalC) / 100 : 0, is_charge: x.is_charge, internal: x.key === 'internal', uncategorized: x.key === 'none' }));
  }
  const kindsFilter = q => !!(q.type || q.category || q.status || (q.q && String(q.q).trim()));
  app.get('/api/ba/analysis', h(async (req, res) => {
    const q = req.query || {}, rows = await rowsOf(q), op = await openingOf(q);
    let td = 0, tc = 0, unc = 0; for (const r of rows) { td += r.c_debit; tc += r.c_credit; if (!r.category_id && !r.is_internal) unc++; }
    const [imps] = await pool.query(`SELECT i.id, a.code, a.name, i.file_name, i.period_from, i.period_to, i.opening_balance, i.closing_balance, i.total_debit, i.total_credit, i.txn_count, i.validation_ok, i.validation_note, i.skipped_count, i.bank_name, i.branch
      FROM ba_imports i JOIN accounts a ON a.id=i.account_id WHERE ${[intParam(q.account_id) ? 'i.account_id=' + (+q.account_id) : '1=1', q.bank ? 'i.bank_name=?' : '1=1', q.branch ? 'i.branch=?' : '1=1'].join(' AND ')} ORDER BY i.account_id, i.period_from`, [q.bank, q.branch].filter(Boolean));
    const closing = op.c + tc - td;
    res.json({ cards: { opening: fromC(op.c), credit: fromC(tc), debit: fromC(td), net: fromC(tc - td), closing: fromC(closing), count: rows.length, unclassified: unc }, partial: kindsFilter(q),
      credit: { total: fromC(tc), rows: groups(rows, 'credit', tc) }, debit: { total: fromC(td), rows: groups(rows, 'debit', td) }, imports: imps, has_data: imps.length > 0 });
  }));

  app.get('/api/ba/transactions', h(async (req, res) => {
    const q = req.query || {}, all = await rowsOf(q), sort = q.sort === 'amount' ? 'amount' : 'date', dir = q.dir === 'asc' ? 1 : -1;
    const amt = r => (r.c_debit || r.c_credit);
    all.sort((a, b) => dir * (sort === 'amount' ? amt(a) - amt(b) || a.id - b.id : (a.txn_date < b.txn_date ? -1 : a.txn_date > b.txn_date ? 1 : a.id - b.id)));
    let td = 0, tc = 0; all.forEach(r => { td += r.c_debit; tc += r.c_credit; });
    const per = Math.min(Math.max(intParam(q.per) || 25, 5), 500), pages = Math.max(1, Math.ceil(all.length / per)), page = Math.min(intParam(q.page) || 1, pages);
    const slice = q.all === '1' ? all : all.slice((page - 1) * per, page * per);
    res.json({ count: all.length, page, pages, per, total_debit: fromC(td), total_credit: fromC(tc), rows: slice.map(({ c_debit, c_credit, ...r }) => r) });
  }));
  app.get('/api/ba/transactions/:id', h(async (req, res) => {
    const [[t]] = await pool.query(`${SEL} WHERE t.id=?`, [intParam(req.params.id)]); if (!t) throw Object.assign(new Error('Transaction not found'), { status: 404 });
    const [[raw]] = await pool.query('SELECT raw_json FROM ba_transactions WHERE id=?', [t.id]);
    const [log] = await pool.query("SELECT action, detail, created_at FROM ba_audit WHERE entity='txn' AND entity_id=? ORDER BY id", [t.id]);
    res.json({ ...t, raw: raw.raw_json ? JSON.parse(raw.raw_json) : null, log });
  }));

  // ---------- changing a transaction (category, internal flag, review status, remarks, wording; never the amount) ----------
  async function changeTxn(conn, id, b, req) {
    const [[t]] = await conn.query('SELECT * FROM ba_transactions WHERE id=?', [id]); if (!t) throw Object.assign(new Error('Transaction not found'), { status: 404 });
    const set = {}, log = {};
    if (b.category_id !== undefined) {
      const cid = b.category_id === null || b.category_id === '' ? null : intParam(b.category_id);
      if (cid) { const [[c]] = await conn.query('SELECT direction FROM ba_categories WHERE id=?', [cid]); if (!c) throw bad('Category not found'); if (c.direction !== (toC(t.debit) > 0 ? 'debit' : 'credit')) throw bad(`This is a ${toC(t.debit) > 0 ? 'debit' : 'credit'} transaction, but that category is for ${c.direction}s`); }
      if (cid !== t.category_id) { set.category_id = cid; set.cat_source = cid ? 'manual' : 'none'; log.category = [t.category_id, cid]; }
    }
    if (b.is_internal !== undefined && (b.is_internal ? 1 : 0) !== t.is_internal) { set.is_internal = b.is_internal ? 1 : 0; if (!('cat_source' in set)) set.cat_source = 'manual'; log.internal = [t.is_internal, set.is_internal]; }
    if (b.review_status !== undefined && b.review_status !== t.review_status) { if (!REVIEW[b.review_status]) throw bad('Unknown review status'); set.review_status = b.review_status; log.status = [t.review_status, b.review_status]; }
    if (b.remarks !== undefined) { const r = String(b.remarks || '').slice(0, 500) || null; if (r !== t.remarks) { set.remarks = r; log.remarks = [t.remarks, r]; } }
    for (const [k, len] of [['description', 500], ['reference', 100], ['cheque_no', 40]]) if (b[k] !== undefined) { const v = String(b[k] || '').replace(/\s+/g, ' ').trim().slice(0, len) || null; if (v !== t[k]) { set[k] = v; log[k] = [t[k], v]; } }
    if (!Object.keys(set).length) return false;
    await conn.query('UPDATE ba_transactions SET ? WHERE id=?', [set, id]); await audit(conn, 'txn', id, 'change', log, req); return true;
  }
  app.put('/api/ba/transactions/:id', h(async (req, res) => { await tx(conn => changeTxn(conn, intParam(req.params.id), req.body || {}, req)); res.json({ ok: true }); }));
  app.post('/api/ba/transactions/bulk', h(async (req, res) => {
    const ids = (Array.isArray(req.body && req.body.ids) ? req.body.ids : []).map(intParam).filter(Boolean).slice(0, 2000); if (!ids.length) throw bad('Select at least one transaction');
    const b = {}; for (const k of ['category_id', 'is_internal', 'review_status']) if (req.body[k] !== undefined) b[k] = req.body[k];
    let n = 0; await tx(async conn => { for (const id of ids) if (await changeTxn(conn, id, b, req)) n++; });
    res.json({ changed: n });
  }));

  // ---------- categories and rules ----------
  app.get('/api/ba/categories', h(async (req, res) => {
    const [c] = await pool.query('SELECT id,name,direction,is_charge,active,sort_no FROM ba_categories ORDER BY direction DESC, sort_no, name');
    const [u] = await pool.query('SELECT category_id, COUNT(*) n FROM ba_transactions WHERE category_id IS NOT NULL GROUP BY category_id'), [rc] = await pool.query('SELECT category_id, COUNT(*) n FROM ba_rules GROUP BY category_id');
    const um = new Map(u.map(x => [x.category_id, x.n])), rm = new Map(rc.map(x => [x.category_id, x.n]));
    const [rules] = await pool.query('SELECT id,category_id,direction,match_field,match_type,keyword,priority,mark_internal,active FROM ba_rules ORDER BY priority, id');
    res.json({ categories: c.map(x => ({ ...x, used: um.get(x.id) || 0, rules: rm.get(x.id) || 0 })), rules });
  }));
  const catBody = b => {
    const name = String(b.name || '').trim().slice(0, 100); if (!name) throw bad('Enter a category name');
    if (!['credit', 'debit'].includes(b.direction)) throw bad('Choose debit or credit');
    return { name, direction: b.direction, is_charge: b.is_charge ? 1 : 0, active: b.active === false || b.active === 0 ? 0 : 1 };
  };
  app.post('/api/ba/categories', h(async (req, res) => {
    const c = catBody(req.body || {}); const [ex] = await pool.query('SELECT id FROM ba_categories WHERE name=? AND direction=?', [c.name, c.direction]); if (ex.length) throw bad('A category with this name already exists');
    const [r] = await pool.query('INSERT INTO ba_categories SET ?', [{ ...c, sort_no: 500 }]); await audit(pool, 'category', r.insertId, 'create', c, req); res.json({ id: r.insertId });
  }));
  app.put('/api/ba/categories/:id', h(async (req, res) => {
    const id = intParam(req.params.id), [[o]] = await pool.query('SELECT * FROM ba_categories WHERE id=?', [id]); if (!o) throw Object.assign(new Error('Category not found'), { status: 404 });
    const c = catBody({ ...o, ...req.body });
    if (c.direction !== o.direction) { const [[u]] = await pool.query('SELECT (SELECT COUNT(*) FROM ba_transactions WHERE category_id=?) + (SELECT COUNT(*) FROM ba_rules WHERE category_id=?) n', [id, id]); if (u.n) throw bad('This category is already used, so its debit / credit type cannot be changed'); }
    const [dup] = await pool.query('SELECT id FROM ba_categories WHERE name=? AND direction=? AND id<>?', [c.name, c.direction, id]); if (dup.length) throw bad('A category with this name already exists');
    await pool.query('UPDATE ba_categories SET ? WHERE id=?', [c, id]); await audit(pool, 'category', id, 'edit', { before: { name: o.name, direction: o.direction, active: o.active }, after: c }, req); res.json({ ok: true });
  }));
  app.delete('/api/ba/categories/:id', h(async (req, res) => {
    const id = intParam(req.params.id), [[u]] = await pool.query('SELECT (SELECT COUNT(*) FROM ba_transactions WHERE category_id=?) t, (SELECT COUNT(*) FROM ba_rules WHERE category_id=?) r', [id, id]);
    if (u.t) throw bad(`This category is used by ${u.t} transaction(s). Make it inactive instead of deleting it, so history is kept.`);
    if (u.r) throw bad(`This category is used by ${u.r} rule(s). Delete or change those rules first.`);
    const [[o]] = await pool.query('SELECT name,direction FROM ba_categories WHERE id=?', [id]); await pool.query('DELETE FROM ba_categories WHERE id=?', [id]); await audit(pool, 'category', id, 'delete', o, req); res.json({ ok: true });
  }));
  const ruleBody = async b => {
    const kw = String(b.keyword || '').trim().slice(0, 200); if (!kw) throw bad('Enter the keyword to look for');
    const cid = intParam(b.category_id), [[c]] = await pool.query('SELECT id,direction FROM ba_categories WHERE id=?', [cid]); if (!c) throw bad('Choose a category');
    const direction = ['credit', 'debit', 'any'].includes(b.direction) ? b.direction : c.direction; if (direction !== 'any' && direction !== c.direction) throw bad(`That category is for ${c.direction}s`);
    const pri = Number.isInteger(+b.priority) ? Math.min(Math.max(+b.priority, 1), 9999) : 100;
    return { category_id: cid, direction, match_field: ['description', 'reference', 'either'].includes(b.match_field) ? b.match_field : 'description', match_type: ['contains', 'starts', 'equals'].includes(b.match_type) ? b.match_type : 'contains', keyword: kw, priority: pri, mark_internal: b.mark_internal ? 1 : 0, active: b.active === false || b.active === 0 ? 0 : 1 };
  };
  app.post('/api/ba/rules', h(async (req, res) => { const r = await ruleBody(req.body || {}); const [i] = await pool.query('INSERT INTO ba_rules SET ?', [r]); await audit(pool, 'rule', i.insertId, 'create', r, req); res.json({ id: i.insertId }); }));
  app.put('/api/ba/rules/:id', h(async (req, res) => { const id = intParam(req.params.id), [[o]] = await pool.query('SELECT * FROM ba_rules WHERE id=?', [id]); if (!o) throw Object.assign(new Error('Rule not found'), { status: 404 }); const r = await ruleBody({ ...o, ...req.body }); await pool.query('UPDATE ba_rules SET ? WHERE id=?', [r, id]); await audit(pool, 'rule', id, 'edit', { before: o, after: r }, req); res.json({ ok: true }); }));
  app.delete('/api/ba/rules/:id', h(async (req, res) => { const id = intParam(req.params.id), [[o]] = await pool.query('SELECT * FROM ba_rules WHERE id=?', [id]); await pool.query('DELETE FROM ba_rules WHERE id=?', [id]); await audit(pool, 'rule', id, 'delete', o || {}, req); res.json({ ok: true }); }));
  // apply the rules again; categories chosen by hand are never touched
  app.post('/api/ba/recategorize', h(async (req, res) => {
    const b = req.body || {}, only = b.only_unclassified !== false;
    const out = await tx(async conn => {
      const rules = await loadRules(conn), w = ["t.cat_source<>'manual'"], p = []; if (intParam(b.account_id)) { w.push('t.account_id=?'); p.push(+b.account_id); } if (intParam(b.import_id)) { w.push('t.import_id=?'); p.push(+b.import_id); } if (only) w.push('t.category_id IS NULL');
      const [rows] = await conn.query(`SELECT t.id, t.description, t.reference, t.debit, t.category_id, t.is_internal, t.cat_source FROM ba_transactions t WHERE ${w.join(' AND ')}`, p);
      let changed = 0, classified = 0;
      for (const t of rows) {
        if (t.cat_source === 'transfer' && t.is_internal) continue;
        const c = classify(rules, { dir: toC(t.debit) > 0 ? 'debit' : 'credit', description: t.description, reference: t.reference });
        if (c.category_id !== t.category_id || c.is_internal !== t.is_internal && c.is_internal) { await conn.query('UPDATE ba_transactions SET category_id=?, cat_source=?, is_internal=? WHERE id=?', [c.category_id, c.category_id ? 'rule' : 'none', c.is_internal || t.is_internal, t.id]); changed++; }
        if (c.category_id) classified++;
      }
      await audit(conn, 'rule', null, 'recategorize', { scanned: rows.length, changed, account: b.account_id || null, import: b.import_id || null }, req);
      return { scanned: rows.length, changed, classified };
    });
    res.json(out);
  }));

  // ---------- unusual transactions (review alerts only; nothing is ever declared fraud) ----------
  app.get('/api/ba/unusual', h(async (req, res) => {
    const rows = await rowsOf(req.query || {}), limitSet = toC(await getSetting('ba_large_threshold')), flags = new Map(), add = (r, code) => { const a = flags.get(r.id) || []; if (!a.includes(code)) a.push(code); flags.set(r.id, a); };
    // large amounts: a limit you set, otherwise anything far above the usual size of that kind of transaction
    const thr = {};
    for (const dir of ['debit', 'credit']) {
      if (limitSet > 0) { thr[dir] = limitSet; continue; }
      const v = rows.filter(r => dirOf(r) === dir).map(r => r[dir === 'debit' ? 'c_debit' : 'c_credit']).sort((a, b) => a - b);
      if (v.length >= 8) { const q1 = v[Math.floor(v.length * 0.25)], q3 = v[Math.floor(v.length * 0.75)], iqr = q3 - q1; thr[dir] = iqr > 0 ? q3 + 3 * iqr : null; } else thr[dir] = null;
    }
    const refCount = new Map(), dupCount = new Map(), today_ = today();
    for (const r of rows) {
      const ref = String(r.reference || '').trim(); if (ref.length >= 4) refCount.set(r.account_id + '|' + ref, (refCount.get(r.account_id + '|' + ref) || 0) + 1);
      const k = [r.account_id, r.txn_date, r.c_debit, r.c_credit, normText(r.description)].join('|'); dupCount.set(k, (dupCount.get(k) || 0) + 1);
    }
    const byImport = new Map(); rows.forEach(r => { const a = byImport.get(r.import_id) || []; a.push(r); byImport.set(r.import_id, a); });
    for (const r of rows) {
      const dir = dirOf(r), c = dir === 'debit' ? r.c_debit : r.c_credit;
      if (thr[dir] && c > thr[dir]) add(r, 'large');
      const ref = String(r.reference || '').trim(); if (ref.length >= 4 && refCount.get(r.account_id + '|' + ref) > 1) add(r, 'dup_ref');
      if (dupCount.get([r.account_id, r.txn_date, r.c_debit, r.c_credit, normText(r.description)].join('|')) > 1) add(r, 'possible_dup');
      if (!normText(r.description)) add(r, 'missing_desc');
      if ((!r.c_debit && !r.c_credit) || (r.c_debit && r.c_credit) || r.c_debit < 0 || r.c_credit < 0) add(r, 'bad_amount');
      if (!r.category_id && !r.is_internal) add(r, 'unclassified');
      if (r.value_date && Math.abs(dayDiff(r.value_date, r.txn_date)) > 30) add(r, 'date_value');
      if (r.txn_date > today_) add(r, 'date_future');
    }
    for (const list of byImport.values()) {
      list.sort((a, b) => a.row_no - b.row_no);
      for (let i = 1; i < list.length; i++) {
        const p = list[i - 1], r = list[i];
        if (r.txn_date < p.txn_date) add(r, 'date_sequence');
        if (r.balance !== null && p.balance !== null && toC(r.balance) !== toC(p.balance) + r.c_credit - r.c_debit) add(r, 'balance_jump');
      }
    }
    const [imps] = await pool.query('SELECT i.id, a.code, i.file_name, i.period_from, i.period_to, i.validation_ok, i.validation_note FROM ba_imports i JOIN accounts a ON a.id=i.account_id WHERE i.validation_ok=0' + (intParam(req.query.account_id) ? ' AND i.account_id=' + (+req.query.account_id) : ''));
    const out = rows.filter(r => flags.has(r.id)).map(r => ({ id: r.id, date: r.txn_date, description: r.description, reference: r.reference, debit: r.debit, credit: r.credit, account_code: r.account_code, category_name: r.category_name, is_internal: r.is_internal,
      review_status: r.review_status, remarks: r.remarks, flags: flags.get(r.id).map(code => ({ code, label: FLAGS[code] })) }));
    const counts = {}; out.forEach(r => r.flags.forEach(f => { counts[f.code] = (counts[f.code] || 0) + 1; }));
    res.json({ rows: out, counts, labels: FLAGS, thresholds: { debit: thr.debit ? fromC(thr.debit) : null, credit: thr.credit ? fromC(thr.credit) : null, user_set: limitSet > 0 }, statement_alerts: imps.map(i => ({ ...i, flag: 'statement_mismatch', label: FLAGS.statement_mismatch })), total: rows.length });
  }));

  // ---------- reconciliation summary: statement analysis compared with the Bank Book ----------
  async function reconCompute(accountId, asOf, tol, otherC) {
    const acc = await bankAccount(pool, accountId);
    const [imps] = await pool.query('SELECT id, opening_balance, period_from FROM ba_imports WHERE account_id=? ORDER BY period_from, id', [acc.id]);
    if (!imps.length) throw bad('No bank statement has been imported for this account yet');
    const [bank] = await pool.query('SELECT t.id, t.txn_date, t.description, t.reference, t.cheque_no, t.debit, t.credit, t.balance, t.voucher_id, t.category_id, t.is_internal, c.is_charge, c.name category_name FROM ba_transactions t LEFT JOIN ba_categories c ON c.id=t.category_id WHERE t.account_id=? AND t.txn_date<=? ORDER BY t.txn_date, t.import_id, t.row_no, t.id', [acc.id, asOf]);
    bank.forEach(t => { t.c_debit = toC(t.debit); t.c_credit = toC(t.credit); });
    let stmt = toC(imps[0].opening_balance); bank.forEach(t => { stmt += t.c_credit - t.c_debit; });
    const lastBal = [...bank].reverse().find(t => t.balance !== null); const stmtStated = lastBal ? toC(lastBal.balance) : null;
    const [book] = await pool.query('SELECT l.id, l.debit, l.credit, l.cleared_on, v.vdate, v.voucher_no, v.cheque_no, v.narration, v.party FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE l.account_id=? AND v.vdate<=? ORDER BY v.vdate, l.id', [acc.id, asOf]);
    book.forEach(l => { l.c_debit = toC(l.debit); l.c_credit = toC(l.credit); });
    let bookClose = (acc.opening_side === 'Cr' ? -1 : 1) * toC(acc.opening_balance); book.forEach(l => { bookClose += l.c_debit - l.c_credit; });
    // match each bank line with a book line of the same amount: by cheque number first, then by date
    const bBank = bank.filter(t => t.c_debit || t.c_credit), used = new Set(), matched = new Map(), how = new Map();
    const side = (t, l) => (t.c_debit ? l.c_credit === t.c_debit : l.c_debit === t.c_credit);
    for (const t of bBank) { const rawCn = String(t.cheque_no || '').replace(/\D/g, '') || (String(t.description || '').match(/(?:chq|cheque|check)\s*(?:no\.?|number|#)?\s*[:#-]?\s*(\d{4,})/i) || [])[1] || '', cn = digits(rawCn); if (rawCn.length < 4 || !cn) continue;
      const l = book.find(l => !used.has(l.id) && digits(l.cheque_no) === cn && side(t, l)); if (l) { used.add(l.id); matched.set(t.id, l); how.set(t.id, 'cheque no'); } }
    for (const t of bBank) { if (matched.has(t.id)) continue; let best = null, bd = 1e9;
      for (const l of book) { if (used.has(l.id) || !side(t, l)) continue; const d = Math.abs(dayDiff(t.txn_date, l.vdate)); if (d <= tol && d < bd) { best = l; bd = d; } }
      if (best) { used.add(best.id); matched.set(t.id, best); how.set(t.id, bd === 0 ? 'same date' : 'within ' + bd + ' day' + (bd === 1 ? '' : 's')); } }
    const unBank = bBank.filter(t => !matched.has(t.id)), unBook = book.filter(l => !used.has(l.id) && (l.c_debit || l.c_credit));
    const outstanding = unBook.filter(l => l.c_credit && (!l.cleared_on || l.cleared_on > asOf)), transit = unBook.filter(l => l.c_debit && (!l.cleared_on || l.cleared_on > asOf));
    const clearedNotSeen = unBook.filter(l => l.cleared_on && l.cleared_on <= asOf);
    const charges = unBank.filter(t => t.c_debit && t.is_charge), otherDeb = unBank.filter(t => t.c_debit && !t.is_charge), credits = unBank.filter(t => t.c_credit);
    const sum = (a, k) => a.reduce((s, x) => s + x[k], 0), oc = sum(outstanding, 'c_credit'), dt = sum(transit, 'c_debit'), ch = sum(charges, 'c_debit'), od = sum(otherDeb, 'c_debit'), cr = sum(credits, 'c_credit');
    const adjBank = stmt + dt - oc, adjBook = bookClose - ch - od + cr + otherC, diff = adjBank - adjBook;
    const lst = (a, f) => a.slice(0, 300).map(f);
    const B = t => ({ id: t.id, date: t.txn_date, description: t.description, reference: t.reference, amount: fromC(t.c_debit || t.c_credit), category: t.category_name || '' });
    const L = l => ({ id: l.id, date: l.vdate, voucher_no: l.voucher_no, cheque_no: l.cheque_no, narration: l.narration, party: l.party, amount: fromC(l.c_debit || l.c_credit), cleared_on: l.cleared_on });
    return { account: { id: acc.id, code: acc.code, name: acc.name, bank_name: acc.bank_name || '', masked: mask(acc.account_no) }, as_of: asOf, tolerance_days: tol, book_lines: book.length, bank_lines: bBank.length, matched: matched.size,
      statement_closing: fromC(stmt), statement_last_balance: stmtStated === null ? null : fromC(stmtStated), statement_balance_ok: stmtStated === null || stmtStated === stmt, book_closing: fromC(bookClose),
      outstanding_cheques: fromC(oc), deposits_in_transit: fromC(dt), charges_not_in_book: fromC(ch), other_debits_not_in_book: fromC(od), credits_not_in_book: fromC(cr), other_adjustments: fromC(otherC),
      adjusted_bank: fromC(adjBank), adjusted_book: fromC(adjBook), difference: fromC(diff), unmatched_bank: unBank.length, unmatched_book: unBook.length, cleared_not_in_statement: clearedNotSeen.length,
      lists: { outstanding: lst(outstanding, L), transit: lst(transit, L), charges: lst(charges, B), other_debits: lst(otherDeb, B), credits: lst(credits, B) }, c: { diff, stmt, book: bookClose, oc, dt, ch, od, cr, other: otherC, pairs: bBank.filter(t => matched.has(t.id)).map(t => ({ t, l: matched.get(t.id), how: how.get(t.id) })), chargeRows: charges, bankAcc: acc } };
  }
  const asOfOf = q => (iso(q.as_of) ? q.as_of : today());
  const otherOf = v => { const m = parseMoney(v === undefined || v === null || v === '' ? '0' : String(v).replace(/^-/, '')); if (m.err) throw bad('Other adjustments: ' + m.err); return /^\s*-/.test(String(v || '')) ? -m.c : m.c; };
  app.get('/api/ba/recon-summary', h(async (req, res) => {
    const r = await reconCompute(intParam(req.query.account_id), asOfOf(req.query), Math.min(Math.max(Number(req.query.tol) || 7, 0), 60), otherOf(req.query.other));
    const [recs] = await pool.query('SELECT id, as_of, statement_closing, book_closing, difference, status, approval_note, other_adjustments, other_note, created_at FROM ba_recon_records WHERE account_id=? ORDER BY id DESC LIMIT 20', [r.account.id]);
    const { c, ...rest } = r; res.json({ ...rest, records: recs });
  }));
  app.post('/api/ba/recon-records', h(async (req, res) => {
    const b = req.body || {}, asOf = asOfOf(b), other = otherOf(b.other_adjustments), status = b.status === 'completed' ? 'completed' : 'draft';
    const r = await reconCompute(intParam(b.account_id), asOf, Math.min(Math.max(Number(b.tol) || 7, 0), 60), other);    // always worked out again here; the browser's numbers are not trusted
    const note = String(b.approval_note || '').trim().slice(0, 400);
    if (status === 'completed') {
      if (!r.book_lines) throw bad('There are no Bank Book entries for this account up to that date, so the books have not been compared with the statement');
      if (r.c.diff !== 0 && note.length < 5) throw bad(`The reconciliation difference is ${r.difference.toFixed(2)}. It can only be marked completed if the difference is zero, or if someone explicitly approves it by writing the reason.`);
    }
    const [pr] = await pool.query('SELECT id FROM ba_periods WHERE account_id=? AND period_from<=? AND period_to>=? ORDER BY period_to DESC LIMIT 1', [r.account.id, asOf, asOf]);
    const [ins] = await pool.query('INSERT INTO ba_recon_records SET ?', [{ account_id: r.account.id, period_id: pr[0] ? pr[0].id : null, as_of: asOf, statement_closing: r.statement_closing, book_closing: r.book_closing, outstanding_cheques: r.outstanding_cheques, deposits_in_transit: r.deposits_in_transit,
      charges_not_in_book: r.charges_not_in_book, other_debits_not_in_book: r.other_debits_not_in_book, credits_not_in_book: r.credits_not_in_book, other_adjustments: r.other_adjustments, other_note: String(b.other_note || '').slice(0, 300) || null,
      unmatched_bank: r.unmatched_bank, unmatched_book: r.unmatched_book, difference: r.difference, status, approval_note: note || null }]);
    await audit(pool, 'recon', ins.insertId, status, { account: r.account.code, as_of: asOf, difference: r.difference, approval: note || null }, req);
    res.json({ id: ins.insertId, status, difference: r.difference });
  }));

  // ---------- month-end tasks: clear matched Bank Book lines, and post bank charges that are missing from the books ----------
  const tasksArgs = q => ({ account_id: intParam(q.account_id), as_of: asOfOf(q), tol: Math.min(Math.max(Number(q.tol) || 7, 0), 60) });
  app.get('/api/ba/tasks/clear', h(async (req, res) => {
    const a = tasksArgs(req.query), r = await reconCompute(a.account_id, a.as_of, a.tol, 0);
    const rows = r.c.pairs.map(p => ({ line_id: p.l.id, bank_id: p.t.id, bank_date: p.t.txn_date, book_date: p.l.vdate, voucher_no: p.l.voucher_no, cheque_no: p.l.cheque_no, description: p.t.description, amount: fromC(p.t.c_debit || p.t.c_credit), side: p.t.c_debit ? 'debit' : 'credit',
      how: p.how, day_gap: Math.abs(dayDiff(p.t.txn_date, p.l.vdate)), cleared_on: p.l.cleared_on }));
    const open = rows.filter(x => !x.cleared_on), same = rows.filter(x => x.cleared_on && x.cleared_on === x.bank_date).length, diff = rows.filter(x => x.cleared_on && x.cleared_on !== x.bank_date);
    res.json({ account: r.account, as_of: a.as_of, to_clear: open, already_cleared: same, cleared_other_date: diff.length, cleared_other: diff.slice(0, 50), matched: rows.length });
  }));
  app.post('/api/ba/tasks/clear', h(async (req, res) => {
    const b = req.body || {}, a = tasksArgs(b), ids = new Set((Array.isArray(b.line_ids) ? b.line_ids : []).map(intParam).filter(Boolean)); if (!ids.size) throw bad('Select at least one line to clear');
    const r = await reconCompute(a.account_id, a.as_of, a.tol, 0), todo = r.c.pairs.filter(p => ids.has(p.l.id) && !p.l.cleared_on);
    if (todo.length !== ids.size) throw bad('The statement or the Bank Book changed since the list was made. Refresh the list and try again.');
    const out = await tx(async conn => {
      let n = 0; for (const p of todo) { const [u] = await conn.query('UPDATE voucher_lines SET cleared_on=? WHERE id=? AND cleared_on IS NULL', [p.t.txn_date, p.l.id]); n += u.affectedRows || 0; }
      await audit(conn, 'clear', null, 'autoclear', { account: r.account.code, as_of: a.as_of, lines: todo.map(p => [p.l.id, p.t.txn_date]) }, req); return n;
    });
    res.json({ cleared: out });
  }));
  async function chargeMap() { try { return JSON.parse((await getSetting('ba_charge_map')) || '{}'); } catch (e) { return {}; } }
  app.get('/api/ba/tasks/charges', h(async (req, res) => {
    const a = tasksArgs(req.query), r = await reconCompute(a.account_id, a.as_of, a.tol, 0), map = await chargeMap(), dflt = intParam(await getSetting('tr_charge_acct')), vat = intParam(await getSetting('tr_vat_acct'));
    const rows = r.c.chargeRows.filter(t => !t.voucher_id).map(t => ({ txn_id: t.id, date: t.txn_date, description: t.description, reference: t.reference, category_id: t.category_id, category: t.category_name, amount: fromC(t.c_debit),
      suggest: intParam(map[t.category_id]) || (/vat/i.test(t.category_name || '') && vat ? vat : dflt) || null }));
    res.json({ account: r.account, as_of: a.as_of, rows, total: fromC(rows.reduce((s, x) => s + toC(x.amount), 0)) });
  }));
  app.post('/api/ba/tasks/charges', h(async (req, res) => {
    const b = req.body || {}, a = tasksArgs(b), items = Array.isArray(b.items) ? b.items : []; if (!items.length) throw bad('Select at least one charge to post');
    const r = await reconCompute(a.account_id, a.as_of, a.tol, 0), cand = new Map(r.c.chargeRows.filter(t => !t.voucher_id).map(t => [t.id, t]));
    const [expAccs] = await pool.query("SELECT id, name FROM accounts WHERE kind='normal' AND active=1"); const okAcc = new Set(expAccs.map(x => x.id));
    const todo = items.map(i => { const t = cand.get(intParam(i.txn_id)); if (!t) throw bad('A selected charge is no longer available. Refresh the list and try again.'); const acc = intParam(i.expense_account_id); if (!okAcc.has(acc)) throw bad('Choose an expense account (not a cash or bank account) for every charge'); return { t, acc }; });
    const seen = new Set(); todo.forEach(x => { if (seen.has(x.t.id)) throw bad('The same charge was selected twice'); seen.add(x.t.id); });
    const made = await tx(async conn => {
      const out = [];
      for (const { t, acc } of todo) {
        const amt = fromC(t.c_debit), vid = await saveVoucher(null, { vtype: 'BP', vdate: t.txn_date, narration: ('Bank charge: ' + (t.description || '')).slice(0, 500), party: '', ref: t.reference || '', lines: [{ account_id: acc, debit: amt, credit: 0 }, { account_id: r.account.id, debit: 0, credit: amt }] }, req, conn);
        await conn.query('UPDATE voucher_lines SET cleared_on=? WHERE voucher_id=? AND account_id=?', [t.txn_date, vid, r.account.id]); await conn.query('UPDATE ba_transactions SET voucher_id=? WHERE id=?', [vid, t.id]);
        const [[v]] = await conn.query('SELECT voucher_no FROM vouchers WHERE id=?', [vid]); out.push({ txn_id: t.id, voucher_id: vid, voucher_no: v.voucher_no, amount: amt });
      }
      await audit(conn, 'charges', null, 'post_charges', { account: r.account.code, vouchers: out.map(x => [x.voucher_no, x.amount]) }, req); return out;
    });
    if (b.remember) { const map = await chargeMap(); todo.forEach(x => { if (x.t.category_id) map[x.t.category_id] = x.acc; }); await setSetting('ba_charge_map', JSON.stringify(map)); }
    res.json({ posted: made.length, vouchers: made });
  }));

  // ---------- audit trail ----------
  app.get('/api/ba/audit', h(async (req, res) => { const [r] = await pool.query('SELECT entity, entity_id, action, detail, created_at FROM ba_audit ORDER BY id DESC LIMIT 200'); res.json({ rows: r }); }));

  return { classify, parseMoney };
}

module.exports = { migrate, register, COLS, DDL, TABLES_DELETE_ORDER, REVIEW, FLAGS };
