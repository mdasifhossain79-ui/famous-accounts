// Famous Accounts - RMG accounts software (petty cash, bank, auto trial balance)
const express = require('express');
const mysql = require('mysql2/promise');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const os = require('os');
const transfersMod = require('./transfers');
const bankMod = require('./bankanalysis');
const opsMod = require('./bankops');

const cfg = { host: 'localhost', port: 3306, user: 'root', password: 'Asif@21490!', name: 'famous_accounts', lan: false, webPort: 3003 };
try { Object.assign(cfg, JSON.parse(fs.readFileSync(path.join(__dirname, 'db-config.json'), 'utf8'))); } catch (e) {}
if (process.env.DB_USER) cfg.user = process.env.DB_USER;
if (process.env.DB_PASSWORD !== undefined) cfg.password = process.env.DB_PASSWORD;
if (process.env.LAN_ACCESS === '1') cfg.lan = true;

const IDLE = 30 * 60 * 1000;
const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'];
const VTYPES = ['CP', 'CR', 'BP', 'BR', 'CT', 'JV'];
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const signedOpening = a => (a.opening_side === 'Cr' ? -1 : 1) * Number(a.opening_balance || 0);
const today = () => { const d = new Date(); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10); };
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
const bad = m => Object.assign(new Error(m), { status: 400 });
const h = fn => (req, res, next) => fn(req, res, next).catch(e => { if (!e.status) console.error(e); res.status(e.status || 500).json({ error: e.message, locked: e.locked || undefined }); });

let pool;

// ---------- default RMG chart of accounts: [code, name, type, kind] ----------
const CHART = [
  ['1010', 'Petty Cash', 'asset', 'cash'], ['1110', 'Main Bank A/C', 'asset', 'bank'],
  ['1200', 'Accounts Receivable (Buyers)', 'asset'], ['1210', 'Advance to Suppliers', 'asset'], ['1220', 'Advance Income Tax (AIT)', 'asset'],
  ['1230', 'Security Deposits', 'asset'], ['1240', 'Staff Advance', 'asset'], ['1300', 'Stock - Fabrics', 'asset'], ['1310', 'Stock - Trims & Accessories', 'asset'],
  ['1320', 'Work in Process', 'asset'], ['1330', 'Finished Goods', 'asset'], ['1500', 'Plant & Machinery', 'asset'], ['1510', 'Furniture & Fixtures', 'asset'], ['1520', 'Factory Building', 'asset'],
  ['2010', 'Accounts Payable (Suppliers)', 'liability'], ['2020', 'Salary & Wages Payable', 'liability'], ['2030', 'Bank Loan (Short Term)', 'liability'], ['2040', 'BTB LC Payable', 'liability'],
  ['2050', 'TDS / VDS Payable', 'liability'], ['2060', 'PF / Welfare Fund Payable', 'liability'], ['2070', 'Accrued Expenses', 'liability'],
  ['3010', 'Share Capital', 'equity'], ['3020', 'Retained Earnings', 'equity'], ['3030', 'Directors Drawings', 'equity'],
  ['4010', 'Export Sales', 'income'], ['4020', 'Local Sales', 'income'], ['4030', 'Cash Incentive', 'income'], ['4040', 'Scrap & Waste Sales', 'income'], ['4050', 'Bank Interest Income', 'income'], ['4060', 'Other Income', 'income'],
  ['5010', 'Fabric Consumption', 'expense'], ['5020', 'Trims & Accessories Consumption', 'expense'], ['5030', 'Sewing / CM Wages', 'expense'], ['5040', 'Washing & Printing Charges', 'expense'], ['5050', 'Embroidery Charges', 'expense'],
  ['5100', 'Factory Salary', 'expense'], ['5110', 'Overtime', 'expense'], ['5120', 'Festival Bonus', 'expense'], ['5200', 'Factory Rent', 'expense'], ['5210', 'Electricity', 'expense'],
  ['5220', 'Gas & Fuel', 'expense'], ['5230', 'Water', 'expense'], ['5240', 'Repair & Maintenance', 'expense'], ['5300', 'Freight & Carrying', 'expense'], ['5310', 'C&F / Shipping Charges', 'expense'],
  ['5320', 'Testing & Inspection', 'expense'], ['5400', 'Office Salary', 'expense'], ['5410', 'Stationery & Printing', 'expense'], ['5420', 'Tea, Snacks & Refreshment', 'expense'], ['5430', 'Conveyance', 'expense'],
  ['5440', 'Mobile & Internet', 'expense'], ['5460', 'Entertainment', 'expense'], ['5470', 'Medical Expenses', 'expense'], ['5480', 'Legal & Professional Fees', 'expense'],
  ['5500', 'Bank Charges', 'expense'], ['5510', 'Bank Interest', 'expense'], ['5520', 'Miscellaneous Expenses', 'expense']
];

const seedCounters = async c => {   // make sure every voucher type has a counter that is at least as high as the vouchers already saved
  await c.query("INSERT IGNORE INTO voucher_counters (vtype,last_seq) VALUES ('CP',0),('CR',0),('BP',0),('BR',0),('CT',0),('JV',0)");
  await c.query('UPDATE voucher_counters c SET last_seq=GREATEST(last_seq, COALESCE((SELECT MAX(v.seq) FROM vouchers v WHERE v.vtype=c.vtype),0))');
};
async function init() {
  const c = await mysql.createConnection({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password });
  await c.query('CREATE DATABASE IF NOT EXISTS `' + cfg.name + '` CHARACTER SET utf8mb4');
  await c.end();
  pool = mysql.createPool({ host: cfg.host, port: cfg.port, user: cfg.user, password: cfg.password, database: cfg.name, dateStrings: true, decimalNumbers: true, connectionLimit: 8, waitForConnections: true });
  await pool.query(`CREATE TABLE IF NOT EXISTS accounts (
    id INT AUTO_INCREMENT PRIMARY KEY, code VARCHAR(20) NOT NULL UNIQUE, name VARCHAR(120) NOT NULL,
    type ENUM('asset','liability','equity','income','expense') NOT NULL, kind ENUM('normal','cash','bank') NOT NULL DEFAULT 'normal',
    bank_name VARCHAR(100) NULL, account_no VARCHAR(60) NULL, opening_balance DECIMAL(14,2) NOT NULL DEFAULT 0,
    opening_side ENUM('Dr','Cr') NOT NULL DEFAULT 'Dr', active TINYINT(1) NOT NULL DEFAULT 1)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS vouchers (
    id INT AUTO_INCREMENT PRIMARY KEY, vtype CHAR(2) NOT NULL, seq INT NOT NULL, voucher_no VARCHAR(20) NOT NULL UNIQUE, vdate DATE NOT NULL,
    narration VARCHAR(500) NULL, party VARCHAR(150) NULL, ref VARCHAR(100) NULL, cheque_no VARCHAR(40) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, INDEX idx_vdate (vdate))`);
  await pool.query(`CREATE TABLE IF NOT EXISTS voucher_lines (
    id INT AUTO_INCREMENT PRIMARY KEY, voucher_id INT NOT NULL, account_id INT NOT NULL,
    debit DECIMAL(14,2) NOT NULL DEFAULT 0, credit DECIMAL(14,2) NOT NULL DEFAULT 0, cleared_on DATE NULL,
    INDEX idx_v (voucher_id), INDEX idx_a (account_id), FOREIGN KEY (voucher_id) REFERENCES vouchers(id) ON DELETE CASCADE)`);
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (skey VARCHAR(50) PRIMARY KEY, sval TEXT)`);
  await pool.query('CREATE TABLE IF NOT EXISTS voucher_counters (vtype CHAR(2) PRIMARY KEY, last_seq INT NOT NULL)');   // highest number ever used per voucher type, so a deleted voucher number is never handed out again
  await seedCounters(pool);

  const D = 'DECIMAL(12,2) DEFAULT 0';
  for (const q of [
    `CREATE TABLE IF NOT EXISTS hr_company (id INT PRIMARY KEY, name VARCHAR(150), address VARCHAR(255), phone VARCHAR(40), email VARCHAR(100), reg_no VARCHAR(60), heads TEXT)`,
    `INSERT IGNORE INTO hr_company (id,name) VALUES (1,'Famous Design Ltd')`,
    `CREATE TABLE IF NOT EXISTS hr_departments (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS hr_designations (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS hr_signatories (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(100) NOT NULL, title VARCHAR(100))`,
    `CREATE TABLE IF NOT EXISTS hr_employees (id INT AUTO_INCREMENT PRIMARY KEY, emp_code VARCHAR(30), name VARCHAR(120) NOT NULL, designation_id INT, department_id INT, join_date DATE, bank_name VARCHAR(100), account_no VARCHAR(50), nid VARCHAR(50), nationality VARCHAR(50) DEFAULT 'Bangladeshi', job_status VARCHAR(30) DEFAULT 'Permanent', gender VARCHAR(10) DEFAULT 'Male', tin VARCHAR(40), salary_category VARCHAR(40) DEFAULT 'Monthly Salaried', payment_mode VARCHAR(40) DEFAULT 'Bank Transfer', basic ${D}, housing ${D}, transport ${D}, other ${D}, total ${D})`,
    `CREATE TABLE IF NOT EXISTS hr_statements (id INT AUTO_INCREMENT PRIMARY KEY, employee_id INT NOT NULL, month VARCHAR(12), year INT, ref_no VARCHAR(40), issue_date DATE, signatory_id INT, items LONGTEXT, gross ${D}, deductions ${D}, net ${D}, INDEX idx_emp (employee_id), FOREIGN KEY (employee_id) REFERENCES hr_employees(id) ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS hr_cert_history (id INT AUTO_INCREMENT PRIMARY KEY, statement_id INT, kind VARCHAR(10), employee_name VARCHAR(120), month VARCHAR(12), year INT, ref_no VARCHAR(40), snapshot LONGTEXT, issued_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS hr_ref_counters (k VARCHAR(100) PRIMARY KEY, n INT NOT NULL DEFAULT 0)`
  ]) await pool.query(q);
  for (const q of [
    `CREATE TABLE IF NOT EXISTS chq_books (id INT AUTO_INCREMENT PRIMARY KEY, account_id INT NOT NULL, label VARCHAR(60), start_no BIGINT NOT NULL, end_no BIGINT NOT NULL, next_no BIGINT NOT NULL, pad TINYINT NOT NULL DEFAULT 7, active TINYINT NOT NULL DEFAULT 1, INDEX idx_acc (account_id))`,
    `CREATE TABLE IF NOT EXISTS cheques (id INT AUTO_INCREMENT PRIMARY KEY, book_id INT NULL, account_id INT NOT NULL, cheque_no VARCHAR(20) NOT NULL, cdate DATE NOT NULL, payee VARCHAR(150) NOT NULL, amount DECIMAL(14,2) NOT NULL, narration VARCHAR(300) NULL, crossing VARCHAR(10) NOT NULL DEFAULT 'ac_payee', bearer_cut TINYINT NOT NULL DEFAULT 1, voucher_id INT NULL, status VARCHAR(10) NOT NULL DEFAULT 'issued', cleared_on DATE NULL, printed_at DATETIME NULL, print_count INT NOT NULL DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uq_chq (account_id, cheque_no), INDEX idx_cdate (cdate))`,
    `CREATE TABLE IF NOT EXISTS chq_layouts (account_id INT PRIMARY KEY, layout LONGTEXT)`
  ]) await pool.query(q);
  await transfersMod.migrate(pool);
  await bankMod.migrate(pool, getSetting, setSetting);
  await opsMod.migrate(pool);
  await pool.query(`CREATE TABLE IF NOT EXISTS parties (id INT AUTO_INCREMENT PRIMARY KEY, name VARCHAR(150) NOT NULL UNIQUE, kind VARCHAR(8) NOT NULL DEFAULT 'both', phone VARCHAR(40) NULL, note VARCHAR(300) NULL, active TINYINT NOT NULL DEFAULT 1)`);
  // bring names already used on vouchers / cheques into the party list (safe to repeat)
  await pool.query(`INSERT IGNORE INTO parties (name,kind) SELECT party, CASE WHEN SUM(vtype IN ('CP','BP'))>0 AND SUM(vtype IN ('CR','BR'))>0 THEN 'both' WHEN SUM(vtype IN ('CR','BR'))>0 THEN 'receipt' WHEN SUM(vtype IN ('CP','BP'))>0 THEN 'paid' ELSE 'both' END FROM vouchers WHERE party IS NOT NULL AND party<>'' GROUP BY party`);
  await pool.query(`INSERT IGNORE INTO parties (name,kind) SELECT DISTINCT payee,'paid' FROM cheques WHERE payee<>''`);
  for (const [col, def] of [['tin', 'VARCHAR(40) NULL'], ['salary_category', "VARCHAR(40) DEFAULT 'Monthly Salaried'"], ['payment_mode', "VARCHAR(40) DEFAULT 'Bank Transfer'"]]) {
    const [[c]] = await pool.query("SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='hr_employees' AND column_name=?", [col]);
    if (!c.n) await pool.query(`ALTER TABLE hr_employees ADD COLUMN ${col} ${def}`);
  }
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM accounts');
  if (!n) {
    await pool.query('INSERT INTO accounts (code,name,type,kind) VALUES ?', [CHART.map(a => [a[0], a[1], a[2], a[3] || 'normal'])]);
    await pool.query('UPDATE accounts SET bank_name=?, account_no=? WHERE code=?', ['Your Bank', '', '1110']);
  }
  for (const [k, v] of [['company_name', 'Famous Accounts'], ['imprest_limit', '50000'], ['fiscal_start', '07-01'], ['print_top_in', '1'], ['print_bottom_in', '1'], ['print_header', '1'], ['print_footer', '1'], ['print_sign_reports', '1']]) {
    await pool.query('INSERT IGNORE INTO settings (skey,sval) VALUES (?,?)', [k, v]);
  }
}
const getSetting = async k => { const [r] = await pool.query('SELECT sval FROM settings WHERE skey=?', [k]); return r[0] ? r[0].sval : null; };
const setSetting = (k, v) => pool.query('INSERT INTO settings (skey,sval) VALUES (?,?) ON DUPLICATE KEY UPDATE sval=VALUES(sval)', [k, String(v)]);

// ---------- password lock ----------
const sessions = new Map();
const fails = new Map();
const sidOf = req => ((req.headers.cookie || '').match(/fa_sid=([a-f0-9]+)/) || [])[1];
const isAuthed = req => { const s = sidOf(req); return !!(s && sessions.has(s) && sessions.get(s) > Date.now()); };
const hashPw = pw => { const salt = crypto.randomBytes(16).toString('hex'); return salt + ':' + crypto.scryptSync(pw, salt, 64).toString('hex'); };
const checkPw = (pw, stored) => {
  const [salt, hex] = (stored || '').split(':'); if (!salt) return false;
  const a = Buffer.from(hex, 'hex'), b = crypto.scryptSync(String(pw || ''), salt, 64);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const isPrivate = ip => /^(::ffff:)?(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip || '');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100mb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' });
  next();
});
app.use(h(async (req, res, next) => {
  if (!isLocal(req)) {
    if (!cfg.lan || !isPrivate(req.socket.remoteAddress)) return res.status(403).send('Not allowed');
    if (!(await getSetting('pw_hash'))) return res.status(403).send('Set a password on the PC first (Settings tab).');
  }
  if (!req.path.startsWith('/api/') || req.path.startsWith('/api/auth/')) return next();
  if (!(await getSetting('pw_hash'))) return next();
  if (isAuthed(req)) { sessions.set(sidOf(req), Date.now() + IDLE); return next(); }
  res.status(401).json({ error: 'locked' });
}));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/auth/status', h(async (req, res) => { const hp = !!(await getSetting('pw_hash')); res.json({ hasPassword: hp, loggedIn: !hp || isAuthed(req) }); }));
app.post('/api/auth/login', h(async (req, res) => {
  const ip = req.socket.remoteAddress, f = fails.get(ip) || { n: 0, until: 0 };
  if (f.until > Date.now()) throw Object.assign(new Error('Too many tries. Wait a minute.'), { status: 429 });
  if (!checkPw(req.body.password, await getSetting('pw_hash'))) {
    f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(ip, f);
    throw Object.assign(new Error('Wrong password'), { status: 401 });
  }
  fails.delete(ip);
  const sid = crypto.randomBytes(24).toString('hex'); sessions.set(sid, Date.now() + IDLE);
  res.set('Set-Cookie', `fa_sid=${sid}; HttpOnly; SameSite=Strict; Path=/`).json({ ok: true });
}));
app.post('/api/auth/logout', (req, res) => { sessions.delete(sidOf(req)); res.set('Set-Cookie', 'fa_sid=; Max-Age=0; Path=/').json({ ok: true }); });
app.post('/api/auth/set', h(async (req, res) => {
  const old = await getSetting('pw_hash');
  if (old && !checkPw(req.body.current, old)) throw bad('Current password is wrong');
  if (!req.body.password || req.body.password.length < 6) throw bad('Use at least 6 characters');
  await setSetting('pw_hash', hashPw(req.body.password));
  const sid = crypto.randomBytes(24).toString('hex'); sessions.set(sid, Date.now() + IDLE);
  res.set('Set-Cookie', `fa_sid=${sid}; HttpOnly; SameSite=Strict; Path=/`).json({ ok: true });
}));
app.post('/api/auth/remove', h(async (req, res) => {
  if (!checkPw(req.body.current, await getSetting('pw_hash'))) throw bad('Password is wrong');
  await pool.query("DELETE FROM settings WHERE skey='pw_hash'"); res.json({ ok: true });
}));

// ---------- settings ----------
app.get('/api/settings', h(async (req, res) => {
  const [r] = await pool.query("SELECT skey,sval FROM settings WHERE skey NOT IN ('pw_hash','lock_hash')");
  res.json(Object.fromEntries(r.map(x => [x.skey, x.sval])));
}));
app.put('/api/settings', h(async (req, res) => {
  for (const k of ['company_name', 'imprest_limit', 'fiscal_start', 'print_top_in', 'print_bottom_in', 'print_header', 'print_footer', 'print_sign_reports', 'print_left_mm', 'print_right_mm', 'print_margins', 'tr_charge_acct', 'tr_vat_acct']) {
    if (req.body[k] === undefined) continue;
    if (['tr_charge_acct', 'tr_vat_acct'].includes(k) && !(Number(req.body[k]) >= 0)) throw bad('Invalid account');
    if (k === 'fiscal_start' && !/^\d{2}-\d{2}$/.test(req.body[k])) throw bad('Fiscal start must be MM-DD');
    if (k === 'imprest_limit' && !(Number(req.body[k]) >= 0)) throw bad('Imprest limit must be a number');
    if (['print_top_in', 'print_bottom_in'].includes(k) && !(Number(req.body[k]) >= 0 && Number(req.body[k]) <= 3)) throw bad('Top and bottom gap must be between 0 and 3 inches');
    if (['print_left_mm', 'print_right_mm'].includes(k) && !(Number(req.body[k]) >= 0 && Number(req.body[k]) <= 60)) throw bad('Left and right margins must be between 0 and 60 mm');
    if (k === 'print_margins') {
      let m; try { m = JSON.parse(req.body[k]); } catch (e) { throw bad('Invalid margins'); }
      if (!m || typeof m !== 'object' || Object.keys(m).length > 30) throw bad('Invalid margins');
      for (const key in m) for (const side of ['t', 'b', 'l', 'r']) { const v = Number(m[key][side]); if (!(v >= 0 && v <= 80)) throw bad('Margins must be between 0 and 80 mm'); }
    }
    if (['print_header', 'print_footer', 'print_sign_reports'].includes(k)) req.body[k] = req.body[k] ? '1' : '0';
    await setSetting(k, String(req.body[k]).slice(0, k === 'print_margins' ? 4000 : 150));
  }
  res.json({ ok: true });
}));


// ---------- month-end lock (books closed up to a date; override with the lock password) ----------
const locked = m => Object.assign(new Error(m), { status: 423, locked: true });
async function guardLock(req, ...dates) {
  const lt = await getSetting('lock_through');
  if (!lt || !dates.some(d => d && d <= lt)) return;
  const pw = req.headers['x-lock-password'], key = 'lock:' + req.socket.remoteAddress, f = fails.get(key) || { n: 0, until: 0 };
  if (f.until > Date.now()) throw Object.assign(new Error('Too many wrong tries. Wait a minute.'), { status: 429 });
  if (pw) {
    if (checkPw(pw, await getSetting('lock_hash'))) { fails.delete(key); return; }
    f.n++; if (f.n >= 5) { f.until = Date.now() + 60000; f.n = 0; } fails.set(key, f);
    throw locked('Wrong lock password');
  }
  throw locked(`Books are closed up to ${lt}. Enter the lock password to change this.`);
}
app.get('/api/lock', h(async (req, res) => res.json({ through: (await getSetting('lock_through')) || '', has_password: !!(await getSetting('lock_hash')) })));
app.post('/api/lock/password', h(async (req, res) => {
  const old = await getSetting('lock_hash');
  if (old && !checkPw(req.body.current, old)) throw bad('Current lock password is wrong');
  const pw = String(req.body.password || '');
  if (pw.length < 4) throw bad('Use at least 4 characters');
  await setSetting('lock_hash', hashPw(pw)); res.json({ ok: true });
}));
app.post('/api/lock', h(async (req, res) => {
  const t = req.body.through || '';
  if (t && !isDate(t)) throw bad('Invalid date');
  if (!(await getSetting('lock_hash'))) throw bad('Set a lock password first');
  const cur = (await getSetting('lock_through')) || '';
  if (cur && (!t || t < cur)) await guardLock(req, cur);   // reopening a month needs the password
  await setSetting('lock_through', t); res.json({ ok: true, through: t });
}));


// ---------- parties: payees ("paid") and payers ("receipt") ----------
const PK = ['paid', 'receipt', 'both'];
const kindOf = vt => (['CP', 'BP'].includes(vt) ? 'paid' : ['CR', 'BR'].includes(vt) ? 'receipt' : 'both');
async function upsertParty(db, name, kind) {
  name = String(name || '').trim().slice(0, 150); if (!name) return;
  await db.query("INSERT INTO parties (name,kind) VALUES (?,?) ON DUPLICATE KEY UPDATE kind=IF(kind=VALUES(kind) OR kind='both', kind, 'both')", [name, kind]);
}
app.get('/api/parties', h(async (req, res) => {
  const [ps] = await pool.query('SELECT * FROM parties ORDER BY name');
  const [st] = await pool.query(`SELECT v.party, v.vtype, SUM(l.debit) amt, MAX(v.vdate) last_date, COUNT(DISTINCT v.id) n FROM vouchers v JOIN voucher_lines l ON l.voucher_id=v.id WHERE v.party IS NOT NULL AND v.party<>'' GROUP BY v.party, v.vtype`);
  const m = {};
  for (const x of st) {
    const o = m[x.party.toLowerCase()] || (m[x.party.toLowerCase()] = { paid: 0, rec: 0, last: '', n: 0 });
    if (['CP', 'BP'].includes(x.vtype)) o.paid += Number(x.amt); else if (['CR', 'BR'].includes(x.vtype)) o.rec += Number(x.amt);
    if (x.last_date > o.last) o.last = x.last_date; o.n += Number(x.n);
  }
  res.json(ps.map(p => { const o = m[p.name.toLowerCase()] || { paid: 0, rec: 0, last: '', n: 0 }; return { ...p, total_paid: r2(o.paid), total_received: r2(o.rec), last_date: o.last, vouchers: o.n }; }));
}));
app.post('/api/parties', h(async (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 150); if (!name) throw bad('Enter a name');
  const kind = PK.includes(req.body.kind) ? req.body.kind : 'both';
  const [[old]] = await pool.query('SELECT id FROM parties WHERE name=?', [name]);
  await upsertParty(pool, name, kind);
  let [[p]] = await pool.query('SELECT * FROM parties WHERE name=?', [name]);
  const ph = req.body.phone === undefined ? null : String(req.body.phone).slice(0, 40) || null, nt = req.body.note === undefined ? null : String(req.body.note).slice(0, 300) || null;
  if (ph !== null || nt !== null) { await pool.query('UPDATE parties SET phone=COALESCE(?,phone), note=COALESCE(?,note) WHERE id=?', [ph, nt, p.id]); [[p]] = await pool.query('SELECT * FROM parties WHERE id=?', [p.id]); }
  res.json({ ...p, existed: !!old });
}));
app.put('/api/parties/:id', h(async (req, res) => {
  const [[o]] = await pool.query('SELECT * FROM parties WHERE id=?', [+req.params.id]);
  if (!o) throw Object.assign(new Error('Party not found'), { status: 404 });
  const name = String(req.body.name || '').trim().slice(0, 150); if (!name) throw bad('Enter a name');
  const kind = PK.includes(req.body.kind) ? req.body.kind : o.kind;
  if (name !== o.name) {
    const [[dup]] = await pool.query('SELECT id FROM parties WHERE name=? AND id<>?', [name, o.id]);
    if (dup) throw bad('Another party already has that name');
    const lt = await getSetting('lock_through');
    if (lt) { const [[c]] = await pool.query('SELECT COUNT(*) n FROM vouchers WHERE party=? AND vdate<=?', [o.name, lt]); if (c.n) await guardLock(req, lt); }
    await pool.query('UPDATE vouchers SET party=? WHERE party=?', [name, o.name]);
    await pool.query('UPDATE cheques SET payee=? WHERE payee=?', [name, o.name]);
  }
  await pool.query('UPDATE parties SET name=?, kind=?, phone=?, note=?, active=? WHERE id=?', [name, kind, String(req.body.phone || '').slice(0, 40) || null, String(req.body.note || '').slice(0, 300) || null, req.body.active === 0 || req.body.active === false ? 0 : 1, o.id]);
  res.json({ ok: true });
}));
app.delete('/api/parties/:id', h(async (req, res) => {
  const [[o]] = await pool.query('SELECT name FROM parties WHERE id=?', [+req.params.id]);
  if (o) {
    const [[v]] = await pool.query('SELECT (SELECT COUNT(*) FROM vouchers WHERE party=?) + (SELECT COUNT(*) FROM cheques WHERE payee=?) n', [o.name, o.name]);
    if (v.n) throw bad(`This party is used on ${v.n} voucher/cheque record(s). Mark it inactive instead.`);
  }
  await pool.query('DELETE FROM parties WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

// ---------- chart of accounts ----------
function cleanAccount(b) {
  const a = {
    code: String(b.code || '').trim().slice(0, 20), name: String(b.name || '').trim().slice(0, 120), type: b.type,
    kind: ['cash', 'bank'].includes(b.kind) ? b.kind : 'normal', bank_name: String(b.bank_name || '').slice(0, 100) || null,
    account_no: String(b.account_no || '').slice(0, 60) || null, opening_balance: r2(Math.abs(Number(b.opening_balance) || 0)),
    opening_side: b.opening_side === 'Cr' ? 'Cr' : 'Dr', active: b.active === 0 || b.active === false ? 0 : 1
  };
  if (!a.code || !a.name) throw bad('Code and name are required');
  if (!TYPES.includes(a.type)) throw bad('Invalid account type');
  if (a.kind !== 'normal' && a.type !== 'asset') throw bad('Cash and bank accounts must be of type asset');
  return a;
}
app.get('/api/accounts', h(async (req, res) => { const [r] = await pool.query('SELECT * FROM accounts ORDER BY code'); res.json(r); }));
app.post('/api/accounts', h(async (req, res) => {
  const a = cleanAccount(req.body);
  if (a.opening_balance) await guardLock(req, '1900-01-01');
  try { const [r] = await pool.query('INSERT INTO accounts SET ?', [a]); res.json({ id: r.insertId }); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') throw bad('That account code already exists'); throw e; }
}));
app.put('/api/accounts/:id', h(async (req, res) => {
  const a = cleanAccount(req.body);
  const [[o]] = await pool.query('SELECT name,opening_balance,opening_side FROM accounts WHERE id=?', [+req.params.id]);
  if (o && o.name === 'Funds in Transit' && (a.name !== o.name || a.kind !== 'normal')) throw bad('Funds in Transit is used by Inter-Account Transfers; its name and kind cannot be changed.');
  if (o && (Number(o.opening_balance) !== a.opening_balance || (a.opening_balance && o.opening_side !== a.opening_side))) await guardLock(req, '1900-01-01');
  try { await pool.query('UPDATE accounts SET ? WHERE id=?', [a, +req.params.id]); res.json({ ok: true }); }
  catch (e) { if (e.code === 'ER_DUP_ENTRY') throw bad('That account code already exists'); throw e; }
}));
app.delete('/api/accounts/:id', h(async (req, res) => {
  const [[o]] = await pool.query('SELECT opening_balance FROM accounts WHERE id=?', [+req.params.id]);
  if (o && Number(o.opening_balance)) await guardLock(req, '1900-01-01');
  const [[{ n }]] = await pool.query('SELECT COUNT(*) n FROM voucher_lines WHERE account_id=?', [+req.params.id]);
  if (n) throw bad('This account has transactions. Mark it inactive instead.');
  await pool.query('DELETE FROM accounts WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

// ---------- vouchers ----------
async function saveVoucher(id, b, req, ext) {   // ext: an open transaction connection (used by batch import)
  if (!VTYPES.includes(b.vtype)) throw bad('Invalid voucher type');
  if (!isDate(b.vdate)) throw bad('Enter a valid date');
  if (!Array.isArray(b.lines) || b.lines.length < 2) throw bad('A voucher needs at least two lines');
  const lines = b.lines.map(l => ({ account_id: +l.account_id, debit: r2(l.debit || 0), credit: r2(l.credit || 0) }));
  let dr = 0, cr = 0;
  for (const l of lines) {
    if (!l.account_id) throw bad('Choose an account on every line');
    if (l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0)) throw bad('Each line needs either a debit or a credit amount');
    dr += l.debit; cr += l.credit;
  }
  if (r2(dr) !== r2(cr)) throw bad(`Debit (${r2(dr)}) and credit (${r2(cr)}) are not equal`);
  const lockDates = [b.vdate];
  if (id) { const [[o]] = await pool.query('SELECT vdate FROM vouchers WHERE id=?', [id]); if (o) lockDates.push(o.vdate); }
  await guardLock(req, ...lockDates);
  const ids = [...new Set(lines.map(l => l.account_id))];
  const [found] = await (ext || pool).query('SELECT id FROM accounts WHERE id IN (?)', [ids]);
  if (found.length !== ids.length) throw bad('An account on the voucher does not exist');
  const conn = ext || await pool.getConnection();
  try {
    if (!ext) await conn.beginTransaction();
    const f = { vdate: b.vdate, narration: String(b.narration || '').slice(0, 500) || null, party: String(b.party || '').slice(0, 150) || null, ref: String(b.ref || '').slice(0, 100) || null, cheque_no: String(b.cheque_no || '').slice(0, 40) || null };
    if (id) {
      const [[old]] = await conn.query('SELECT vtype FROM vouchers WHERE id=?', [id]);
      if (!old) throw bad('Voucher not found');
      if (old.vtype !== b.vtype) throw bad('Voucher type cannot be changed. Delete and create a new one.');
      await conn.query('UPDATE vouchers SET ? WHERE id=?', [f, id]);
      // Lines that did not change (same account and amount) are left exactly as they are, so a bank line keeps its "cleared" date when only the narration, party or date is edited.
      const [oldLines] = await conn.query('SELECT id,account_id,debit,credit FROM voucher_lines WHERE voucher_id=? ORDER BY id', [id]), spare = [...oldLines];
      for (let k = lines.length - 1; k >= 0; k--) { const i = spare.findIndex(o => o.account_id === lines[k].account_id && r2(o.debit) === lines[k].debit && r2(o.credit) === lines[k].credit); if (i >= 0) { spare.splice(i, 1); lines.splice(k, 1); } }
      if (spare.length) await conn.query('DELETE FROM voucher_lines WHERE id IN (?)', [spare.map(o => o.id)]);
    } else {
      await conn.query('UPDATE voucher_counters SET last_seq=LAST_INSERT_ID(last_seq+1) WHERE vtype=?', [b.vtype]);   // row lock: two people saving together get different numbers
      const [[{ s }]] = await conn.query('SELECT LAST_INSERT_ID() s');
      const [r] = await conn.query('INSERT INTO vouchers SET ?', [{ ...f, vtype: b.vtype, seq: s, voucher_no: b.vtype + '-' + String(s).padStart(5, '0') }]);
      id = r.insertId;
    }
    if (lines.length) await conn.query('INSERT INTO voucher_lines (voucher_id,account_id,debit,credit) VALUES ?', [lines.map(l => [id, l.account_id, l.debit, l.credit])]);
    if (f.party) await upsertParty(conn, f.party, kindOf(b.vtype));
    if (!ext) await conn.commit();
    return id;
  } catch (e) { if (!ext) await conn.rollback(); throw e; } finally { if (!ext) conn.release(); }
}
app.get('/api/vouchers', h(async (req, res) => {
  const { from, to, type, q } = req.query, w = ['1=1'], p = [];
  if (isDate(from)) { w.push('v.vdate>=?'); p.push(from); }
  if (isDate(to)) { w.push('v.vdate<=?'); p.push(to); }
  if (VTYPES.includes(type)) { w.push('v.vtype=?'); p.push(type); }
  if (q) { w.push('(v.narration LIKE ? OR v.party LIKE ? OR v.voucher_no LIKE ? OR v.ref LIKE ? OR v.cheque_no LIKE ?)'); const l = '%' + q + '%'; p.push(l, l, l, l, l); }
  const lim = Math.min(Math.max(parseInt(req.query.limit) || 1000, 1), 5000), off = Math.max(parseInt(req.query.offset) || 0, 0);
  const [[{ n }]] = await pool.query(`SELECT COUNT(*) n FROM vouchers v WHERE ${w.join(' AND ')}`, p);
  const [r] = await pool.query(`SELECT v.*, (SELECT COALESCE(SUM(debit),0) FROM voucher_lines WHERE voucher_id=v.id) amount FROM vouchers v WHERE ${w.join(' AND ')} ORDER BY v.vdate DESC, v.id DESC LIMIT ? OFFSET ?`, [...p, lim, off]);
  res.set('X-Total-Count', String(n)); res.json(r);
}));
app.get('/api/vouchers/:id', h(async (req, res) => {
  const [[v]] = await pool.query('SELECT * FROM vouchers WHERE id=?', [+req.params.id]);
  if (!v) throw Object.assign(new Error('Voucher not found'), { status: 404 });
  const [lines] = await pool.query('SELECT l.id,l.account_id,l.debit,l.credit,l.cleared_on,a.code,a.name FROM voucher_lines l JOIN accounts a ON a.id=l.account_id WHERE l.voucher_id=? ORDER BY l.id', [v.id]);
  const [tr] = await TR.annotateRows([{ voucher_id: v.id }]);
  res.json({ ...v, lines, transfer_no: tr.transfer_no || null });
}));
app.post('/api/vouchers', h(async (req, res) => res.json({ id: await saveVoucher(null, req.body, req) })));
app.put('/api/vouchers/:id', h(async (req, res) => { await TR.guardVoucher(req.params.id); res.json({ id: await saveVoucher(+req.params.id, req.body, req) }); }));
app.delete('/api/vouchers/:id', h(async (req, res) => {
  await TR.guardVoucher(req.params.id);
  const [[o]] = await pool.query('SELECT vdate FROM vouchers WHERE id=?', [+req.params.id]);
  if (o) await guardLock(req, o.vdate);
  await pool.query('DELETE FROM vouchers WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

// ---------- inter-account transfers (bank <-> bank, bank <-> petty cash) ----------
bankMod.register({ app, getPool: () => pool, h, bad, isDate, today, getSetting, setSetting, saveVoucher });
opsMod.register({ app, getPool: () => pool, h, bad, today, saveVoucher });
const TR = transfersMod.register({ app, getPool: () => pool, h, bad, r2, isDate, today, guardLock, saveVoucher, getSetting, setSetting });

// ---------- import a petty cash book / bank statement (rows from Excel or CSV) ----------
app.post('/api/import/vouchers', h(async (req, res) => {
  const { account_id, rows, new_accounts = [] } = req.body || {};
  const [[book]] = await pool.query("SELECT id, kind FROM accounts WHERE id=? AND kind IN ('cash','bank')", [+account_id]);
  if (!book) throw bad('Choose a petty cash or bank account');
  if (!Array.isArray(rows) || !rows.length) throw bad('There is nothing to import');
  if (rows.length > 5000) throw bad('Import at most 5000 rows at a time');
  rows.forEach((r, i) => {
    if (!isDate(r.vdate)) throw bad(`Row ${i + 1}: the date is not valid`);
    if (!['in', 'out'].includes(r.side) || !(r2(r.amount) > 0)) throw bad(`Row ${i + 1}: needs an amount`);
  });
  await guardLock(req, rows.map(r => r.vdate).sort()[0]);   // one check for the oldest date in the file
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const keyToId = {};
    for (const na of new_accounts) {
      const a = cleanAccount({ code: na.code, name: na.name, type: na.type, kind: 'normal', opening_balance: 0 });
      try { const [r] = await conn.query('INSERT INTO accounts SET ?', [a]); keyToId[na.key] = r.insertId; }
      catch (e) { if (e.code === 'ER_DUP_ENTRY') throw bad(`Account code ${a.code} already exists. Try the import again.`); throw e; }
    }
    const used = [...new Set(rows.map(r => +r.counter).filter(Boolean))];
    const [accs] = used.length ? await conn.query('SELECT id, kind FROM accounts WHERE id IN (?)', [used]) : [[]];
    const kind = {}; accs.forEach(a => { kind[a.id] = a.kind; });
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i], counter = +r.counter || keyToId[r.new_key];
      if (!counter) throw bad(`Row ${i + 1}: no account to post against`);
      if (counter === book.id) throw bad(`Row ${i + 1}: the head is the same account as the book you are importing into`);
      if (+r.counter && !kind[counter]) throw bad(`Row ${i + 1}: that account does not exist`);
      const amt = r2(r.amount), inn = r.side === 'in';
      const vtype = (kind[counter] || 'normal') !== 'normal' ? 'CT' : book.kind === 'cash' ? (inn ? 'CR' : 'CP') : (inn ? 'BR' : 'BP');
      await saveVoucher(null, { vtype, vdate: r.vdate, narration: r.narration, party: r.party, ref: r.ref, cheque_no: r.cheque_no,
        lines: inn ? [{ account_id: book.id, debit: amt, credit: 0 }, { account_id: counter, debit: 0, credit: amt }] : [{ account_id: counter, debit: amt, credit: 0 }, { account_id: book.id, debit: 0, credit: amt }] }, req, conn);
    }
    await conn.commit(); res.json({ created: rows.length, accounts: new_accounts.length });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));

app.post('/api/lines/:id/clear', h(async (req, res) => {
  const d = req.body.cleared_on || null;
  if (d && !isDate(d)) throw bad('Invalid date');
  await pool.query('UPDATE voucher_lines SET cleared_on=? WHERE id=?', [d, +req.params.id]); res.json({ ok: true });
}));

// ---------- books (cash book / bank book / any ledger) ----------
app.get('/api/book/:id', h(async (req, res) => {
  const id = +req.params.id;
  const from = isDate(req.query.from) ? req.query.from : '1900-01-01', to = isDate(req.query.to) ? req.query.to : '2999-12-31';
  const [[acc]] = await pool.query('SELECT * FROM accounts WHERE id=?', [id]);
  if (!acc) throw Object.assign(new Error('Account not found'), { status: 404 });
  const [[pre]] = await pool.query('SELECT COALESCE(SUM(l.debit-l.credit),0) s FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE l.account_id=? AND v.vdate<?', [id, from]);
  const opening = r2(signedOpening(acc) + pre.s);
  const [rows] = await pool.query(`SELECT l.id line_id, v.id voucher_id, v.vdate, v.voucher_no, v.vtype, v.narration, v.party, v.ref, v.cheque_no, l.debit, l.credit, l.cleared_on,
      (SELECT GROUP_CONCAT(DISTINCT a2.name ORDER BY a2.name SEPARATOR ', ') FROM voucher_lines l2 JOIN accounts a2 ON a2.id=l2.account_id WHERE l2.voucher_id=v.id AND l2.account_id<>l.account_id) counter
    FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE l.account_id=? AND v.vdate BETWEEN ? AND ? ORDER BY v.vdate, v.id, l.id`, [id, from, to]);
  let run = opening, td = 0, tc = 0;
  for (const r of rows) { run = r2(run + r.debit - r.credit); r.balance = run; td += r.debit; tc += r.credit; }
  await TR.annotateRows(rows);
  const [[cl]] = await pool.query('SELECT COALESCE(SUM(l.debit-l.credit),0) s FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id WHERE l.account_id=? AND l.cleared_on IS NOT NULL AND v.vdate<=?', [id, to]);
  res.json({ account: acc, opening, rows, total_debit: r2(td), total_credit: r2(tc), closing: run, cleared_balance: r2(signedOpening(acc) + cl.s) });
}));

// payments / receipts of a cash or bank account on one day, split by the other account (head) on each voucher line
app.get('/api/cash-heads/:id', h(async (req, res) => {
  const d = isDate(req.query.date) ? req.query.date : today(), q = side => pool.query(
    `SELECT a2.name, SUM(l2.${side === 'paid' ? 'debit' : 'credit'}) amount FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id
     JOIN voucher_lines l2 ON l2.voucher_id=v.id AND l2.account_id<>l.account_id JOIN accounts a2 ON a2.id=l2.account_id
     WHERE l.account_id=? AND l.${side === 'paid' ? 'credit' : 'debit'}>0 AND v.vdate=? AND l2.${side === 'paid' ? 'debit' : 'credit'}>0 GROUP BY a2.id ORDER BY amount DESC`, [+req.params.id, d]);
  const [[paid], [received]] = await Promise.all([q('paid'), q('received')]);
  res.json({ paid, received });
}));

// ---------- automatic trial balance ----------
async function trialBalance(from, to, all) {
  const [accs] = await pool.query(`SELECT a.*,
      COALESCE(SUM(CASE WHEN v.vdate < ? THEN l.debit-l.credit END),0) pre,
      COALESCE(SUM(CASE WHEN v.vdate BETWEEN ? AND ? THEN l.debit END),0) pdr,
      COALESCE(SUM(CASE WHEN v.vdate BETWEEN ? AND ? THEN l.credit END),0) pcr
    FROM accounts a LEFT JOIN voucher_lines l ON l.account_id=a.id LEFT JOIN vouchers v ON v.id=l.voucher_id GROUP BY a.id ORDER BY a.code`, [from, from, to, from, to]);
  const rows = [], t = { open_dr: 0, open_cr: 0, dr: 0, cr: 0, close_dr: 0, close_cr: 0 };
  for (const a of accs) {
    const ob = r2(signedOpening(a) + a.pre), cb = r2(ob + a.pdr - a.pcr);
    const row = { id: a.id, code: a.code, name: a.name, type: a.type, kind: a.kind, active: a.active,
      open_dr: ob > 0 ? ob : 0, open_cr: ob < 0 ? -ob : 0, dr: r2(a.pdr), cr: r2(a.pcr), close_dr: cb > 0 ? cb : 0, close_cr: cb < 0 ? -cb : 0 };
    if (!all && !row.open_dr && !row.open_cr && !row.dr && !row.cr) continue;
    for (const k in t) t[k] = r2(t[k] + row[k]);
    rows.push(row);
  }
  return { from, to, rows, totals: t, balanced: t.close_dr === t.close_cr && t.open_dr === t.open_cr, difference: r2(t.close_dr - t.close_cr) };
}
app.get('/api/trial-balance', h(async (req, res) => {
  const from = isDate(req.query.from) ? req.query.from : today().slice(0, 4) + '-01-01', to = isDate(req.query.to) ? req.query.to : today();
  res.json(await trialBalance(from, to, req.query.all === '1'));
}));

// ---------- dashboard ----------
app.get('/api/dashboard', h(async (req, res) => {
  const t = today(), ms = t.slice(0, 8) + '01';
  const tb = await trialBalance('1900-01-01', t, true);
  const bal = r => r.close_dr - r.close_cr;
  const cash = tb.rows.filter(r => r.kind === 'cash').map(r => ({ id: r.id, name: r.name, balance: bal(r) }));
  const banks = tb.rows.filter(r => r.kind === 'bank' && r.active).map(r => ({ id: r.id, name: r.name, balance: bal(r) }));
  const [top] = await pool.query(`SELECT a.name, SUM(l.debit-l.credit) amount FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id JOIN accounts a ON a.id=l.account_id
    WHERE a.type='expense' AND v.vdate BETWEEN ? AND ? GROUP BY a.id HAVING amount<>0 ORDER BY amount DESC LIMIT 6`, [ms, t]);
  const [recent] = await pool.query('SELECT v.id,v.voucher_no,v.vtype,v.vdate,v.narration,(SELECT COALESCE(SUM(debit),0) FROM voucher_lines WHERE voucher_id=v.id) amount FROM vouchers v ORDER BY v.id DESC LIMIT 8');
  res.json({ cash, banks, month_expense: r2(top.reduce((s, x) => s + Number(x.amount), 0)), top_expenses: top, recent, balanced: tb.balanced, difference: tb.difference, in_transit: await TR.inTransit(), backup: await backupHealth(), recurring_due: (await pool.query('SELECT COUNT(*) n FROM recurring_vouchers WHERE active=1 AND next_due<=?', [t]))[0][0].n, imprest_limit: Number(await getSetting('imprest_limit')) || 0, locked_through: (await getSetting('lock_through')) || '' });
}));


// ---------- dashboard extras (read-only): period totals, daily trend, monthly chart, things that need attention ----------
const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
async function cashBankAt(date) {   // balance of every petty cash / bank account at the end of a day
  const [accs] = await pool.query(`SELECT a.id, a.name, a.kind, a.active, a.opening_balance, a.opening_side,
      COALESCE(SUM(CASE WHEN v.vdate <= ? THEN l.debit - l.credit END), 0) mv
    FROM accounts a LEFT JOIN voucher_lines l ON l.account_id = a.id LEFT JOIN vouchers v ON v.id = l.voucher_id
    WHERE a.kind IN ('cash','bank') GROUP BY a.id ORDER BY a.code`, [date]);
  return accs.map(a => ({ id: a.id, name: a.name, kind: a.kind, active: a.active, balance: r2(signedOpening(a) + Number(a.mv)) }));
}
const sumKind = (list, k) => r2(list.filter(a => a.kind === k && (k === 'cash' || a.active)).reduce((s, a) => s + a.balance, 0));
async function typeTotal(type, from, to) {
  const [[r]] = await pool.query('SELECT COALESCE(SUM(l.debit),0) d, COALESCE(SUM(l.credit),0) c FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id JOIN accounts a ON a.id=l.account_id WHERE a.type=? AND v.vdate BETWEEN ? AND ?', [type, from, to]);
  return r2(type === 'expense' ? r.d - r.c : r.c - r.d);
}
app.get('/api/dashboard/extra', h(async (req, res) => {
  const t = today(), to = isDate(req.query.to) ? req.query.to : t, from = isDate(req.query.from) ? req.query.from : to.slice(0, 8) + '01';
  if (from > to) throw bad('The start date is after the end date');
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 864e5) + 1;
  if (days > 732) throw bad('Choose a period of at most 2 years');
  const pto = isDate(req.query.pto) ? req.query.pto : addDays(from, -1), pfrom = isDate(req.query.pfrom) ? req.query.pfrom : addDays(pto, -(days - 1));

  // balances at the end of the period and at the end of the previous period
  const endBal = await cashBankAt(to), prevBal = await cashBankAt(pto), startBal = await cashBankAt(addDays(from, -1));
  const cash = endBal.filter(a => a.kind === 'cash'), banks = endBal.filter(a => a.kind === 'bank' && a.active);

  // day-by-day petty cash and bank balance
  const [daily] = await pool.query(`SELECT v.vdate d, a.kind k, SUM(l.debit - l.credit) s FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id JOIN accounts a ON a.id=l.account_id
    WHERE (a.kind='cash' OR (a.kind='bank' AND a.active=1)) AND v.vdate BETWEEN ? AND ? GROUP BY v.vdate, a.kind`, [from, to]);
  const mv = {}; for (const r of daily) mv[r.d + '|' + r.k] = Number(r.s);
  let c = sumKind(startBal, 'cash'), b = sumKind(startBal, 'bank'); const trend = { dates: [], cash: [], bank: [] };
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i); c = r2(c + (mv[d + '|cash'] || 0)); b = r2(b + (mv[d + '|bank'] || 0));
    trend.dates.push(d); trend.cash.push(c); trend.bank.push(b);
  }

  // top expenses in the period (with account id so the screen can open the ledger)
  const [top] = await pool.query(`SELECT a.id, a.name, SUM(l.debit - l.credit) amount FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id JOIN accounts a ON a.id=l.account_id
    WHERE a.type='expense' AND v.vdate BETWEEN ? AND ? GROUP BY a.id HAVING amount<>0 ORDER BY amount DESC LIMIT 8`, [from, to]);

  // income and expense for each month of a fiscal year
  const fy = isDate(req.query.fy) ? req.query.fy : t.slice(0, 4) + '-01-01', fy0 = new Date(fy + 'T00:00:00Z'), months = [];
  for (let i = 0; i < 12; i++) { const m = new Date(Date.UTC(fy0.getUTCFullYear(), fy0.getUTCMonth() + i, 1)); months.push(m.toISOString().slice(0, 7)); }
  const fyEnd = new Date(Date.UTC(fy0.getUTCFullYear(), fy0.getUTCMonth() + 12, 0)).toISOString().slice(0, 10);
  const [mrows] = await pool.query(`SELECT DATE_FORMAT(v.vdate,'%Y-%m') ym, a.type, SUM(l.debit) d, SUM(l.credit) c FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id JOIN accounts a ON a.id=l.account_id
    WHERE a.type IN ('income','expense') AND v.vdate BETWEEN ? AND ? GROUP BY ym, a.type`, [fy, fyEnd]);
  const monthly = months.map(ym => {
    const inc = mrows.find(r => r.ym === ym && r.type === 'income'), exp = mrows.find(r => r.ym === ym && r.type === 'expense');
    return { month: ym, income: inc ? r2(inc.c - inc.d) : 0, expense: exp ? r2(exp.d - exp.c) : 0 };
  });

  // things that need attention
  const stale6 = addDays(t, -183), d7 = addDays(t, -7), d30 = addDays(t, -30);
  const [[chq]] = await pool.query("SELECT COUNT(*) n, COALESCE(SUM(amount),0) a, COALESCE(SUM(cdate < ?),0) stale, COALESCE(SUM(cdate > ?),0) post FROM cheques WHERE status IN ('issued','printed')", [stale6, t]);
  const [[tr]] = await pool.query("SELECT COUNT(*) n, COALESCE(SUM(amount),0) a FROM transfers WHERE status='in_transit' AND sent_date < ?", [d7]);
  const unclearedQ = d => pool.query("SELECT COUNT(*) n, COALESCE(SUM(l.debit + l.credit),0) a FROM voucher_lines l JOIN vouchers v ON v.id=l.voucher_id JOIN accounts a ON a.id=l.account_id WHERE a.kind='bank' AND a.active=1 AND l.cleared_on IS NULL AND v.vdate <= ?", [d]);
  const [[unc30]] = await unclearedQ(d30);
  // month-end checklist (last calendar month)
  const prevEnd = addDays(t.slice(0, 8) + '01', -1), lt = (await getSetting('lock_through')) || '';
  const [[rec]] = await pool.query('SELECT COUNT(*) n FROM recurring_vouchers WHERE active=1 AND next_due<=?', [t]);
  const [[uncPrev]] = await unclearedQ(prevEnd);
  const tb = await trialBalance('1900-01-01', t, true);
  const checklist = [
    { key: 'recurring', label: 'Post recurring vouchers that are due', done: rec.n === 0, detail: rec.n ? rec.n + ' waiting' : 'None waiting', go: 'recurring' },
    { key: 'bank', label: 'Clear bank entries up to ' + prevEnd, done: uncPrev.n === 0, detail: uncPrev.n ? uncPrev.n + ' not cleared (৳ ' + r2(uncPrev.a).toLocaleString('en-IN') + ')' : 'All cleared', go: 'recon' },
    { key: 'tb', label: 'Trial balance is balanced', done: tb.balanced, detail: tb.balanced ? 'Balanced' : 'Difference ' + tb.difference, go: 'tb' },
    { key: 'close', label: 'Close the month ' + prevEnd.slice(0, 7), done: !!lt && lt >= prevEnd, detail: lt ? 'Closed up to ' + lt : 'No month closed yet', go: 'settings' }
  ];
  res.json({
    from, to, pfrom, pto, fy, days,
    cash, banks, cash_total: sumKind(endBal, 'cash'), bank_total: sumKind(endBal, 'bank'),
    cash_prev: sumKind(prevBal, 'cash'), bank_prev: sumKind(prevBal, 'bank'),
    expense: { cur: await typeTotal('expense', from, to), prev: await typeTotal('expense', pfrom, pto) },
    income: { cur: await typeTotal('income', from, to), prev: await typeTotal('income', pfrom, pto) },
    top_expenses: top.map(x => ({ id: x.id, name: x.name, amount: r2(x.amount) })), trend, monthly,
    attention: { cheques_open: { count: chq.n, amount: r2(chq.a), stale: Number(chq.stale), post_dated: Number(chq.post) }, transit_stale: { count: tr.n, amount: r2(tr.a) }, uncleared: { count: unc30.n, amount: r2(unc30.a) } },
    checklist, prev_month_end: prevEnd
  });
}));

// ---------- Certificate & Payslip (payroll) ----------
const HR = {
  company: ['id', 'name', 'address', 'phone', 'email', 'reg_no', 'heads'],
  departments: ['id', 'name'], designations: ['id', 'name'], signatories: ['id', 'name', 'title'],
  employees: ['id', 'emp_code', 'name', 'designation_id', 'department_id', 'join_date', 'bank_name', 'account_no', 'nid', 'nationality', 'job_status', 'gender', 'tin', 'salary_category', 'payment_mode', 'basic', 'housing', 'transport', 'other', 'total'],
  statements: ['id', 'employee_id', 'month', 'year', 'ref_no', 'issue_date', 'signatory_id', 'items', 'gross', 'deductions', 'net'],
  cert_history: ['id', 'statement_id', 'kind', 'employee_name', 'month', 'year', 'ref_no', 'snapshot', 'issued_at'],
  ref_counters: ['k', 'n']
};
const HRT = Object.keys(HR);
const hasHR = t => Object.prototype.hasOwnProperty.call(HR, t);
const hrWritable = t => HR[t].filter(c => c !== 'id' && c !== 'issued_at');
const hrT = fn => h(async (req, res) => {
  if (!hasHR(req.params.t) || req.params.t === 'ref_counters') throw Object.assign(new Error('Not found'), { status: 404 });
  await fn(req, res);
});
const hrPick = (t, b) => { const c = hrWritable(t).filter(k => k in (b || {})); if (!c.length) throw bad('No data to save'); return [c, c.map(k => (b[k] === '' ? null : b[k]))]; };
const hrQ = c => c.map(k => '`' + k + '`').join(',');
app.get('/api/hr/t/:t', hrT(async (req, res) => { const [r] = await pool.query(`SELECT * FROM hr_${req.params.t} ORDER BY id DESC`); res.json(r); }));
app.post('/api/hr/t/:t', hrT(async (req, res) => {
  const [c, v] = hrPick(req.params.t, req.body);
  const [r] = await pool.query(`INSERT INTO hr_${req.params.t} (${hrQ(c)}) VALUES (?)`, [v]); res.json({ id: r.insertId });
}));
app.put('/api/hr/t/:t/:id', hrT(async (req, res) => {
  const [c, v] = hrPick(req.params.t, req.body);
  await pool.query(`UPDATE hr_${req.params.t} SET ${c.map(k => '`' + k + '`=?').join(',')} WHERE id=?`, [...v, +req.params.id]); res.json({ ok: 1 });
}));
app.delete('/api/hr/t/:t/:id', hrT(async (req, res) => { await pool.query(`DELETE FROM hr_${req.params.t} WHERE id=?`, [+req.params.id]); res.json({ ok: 1 }); }));

// automatic reference numbers (e.g. HR/2026/0001)
const refScope = (reset, d) => 'cert:' + (reset === 'never' ? 'all' : reset === 'month' ? String(d).slice(0, 7) : String(d).slice(0, 4));
app.post('/api/hr/ref/next', h(async (req, res) => {
  const count = Math.max(1, Math.min(5000, +req.body.count || 1)), date = isDate(req.body.date) ? req.body.date : today(), k = refScope(req.body.reset, date);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('INSERT INTO hr_ref_counters (k,n) VALUES (?,?) ON DUPLICATE KEY UPDATE n=n+?', [k, count, count]);
    const [[r]] = await conn.query('SELECT n FROM hr_ref_counters WHERE k=?', [k]);
    await conn.commit(); res.json({ from: r.n - count + 1, to: r.n });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
app.get('/api/hr/ref/peek', h(async (req, res) => {
  const date = isDate(req.query.date) ? req.query.date : today();
  const [r] = await pool.query('SELECT n FROM hr_ref_counters WHERE k=?', [refScope(req.query.reset, date)]); res.json({ next: (r[0] ? r[0].n : 0) + 1 });
}));
app.post('/api/hr/ref/set', h(async (req, res) => {
  const date = isDate(req.body.date) ? req.body.date : today();
  await pool.query('INSERT INTO hr_ref_counters (k,n) VALUES (?,?) ON DUPLICATE KEY UPDATE n=VALUES(n)', [refScope(req.body.reset, date), Math.max(0, Math.floor(+req.body.next || 1) - 1)]); res.json({ ok: 1 });
}));

// payroll-only backup (also accepts backup files from the old standalone payroll app)
async function hrRestore(conn, src) {
  await conn.query('SET FOREIGN_KEY_CHECKS=0');
  for (const t of [...HRT].reverse()) if (Array.isArray(src[t])) await conn.query(`DELETE FROM hr_${t}`);
  for (const t of HRT) {
    const rows = Array.isArray(src[t]) ? src[t] : [];
    if (!rows.length) continue;
    const cols = HR[t].filter(c => c in rows[0]);
    for (let i = 0; i < rows.length; i += 500) await conn.query(`INSERT INTO hr_${t} (${hrQ(cols)}) VALUES ?`, [rows.slice(i, i + 500).map(r => cols.map(c => (r[c] === undefined ? null : r[c])))]);
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1');
}
app.get('/api/hr/backup/download', h(async (req, res) => {
  const o = { app: 'payroll', date: new Date().toISOString() };
  for (const t of HRT) o[t] = (await pool.query(`SELECT * FROM hr_${t}`))[0];
  res.set('Content-Disposition', `attachment; filename="salary-backup-${today()}.json"`).json(o);
}));
app.post('/api/hr/backup/restore', h(async (req, res) => {
  if (!req.body || req.body.app !== 'payroll') throw bad('This is not a valid payroll backup file');
  const conn = await pool.getConnection();
  try { await conn.beginTransaction(); await hrRestore(conn, req.body); await conn.commit(); res.json({ ok: 1 }); }
  catch (e) { await conn.rollback(); throw e; } finally { await conn.query('SET FOREIGN_KEY_CHECKS=1'); conn.release(); }
}));


// ---------- cheque printing (Bangladesh bank cheques) ----------
const CQC = {
  chq_books: ['id', 'account_id', 'label', 'start_no', 'end_no', 'next_no', 'pad', 'active'],
  cheques: ['id', 'book_id', 'account_id', 'cheque_no', 'cdate', 'payee', 'amount', 'narration', 'crossing', 'bearer_cut', 'voucher_id', 'status', 'cleared_on', 'printed_at', 'print_count'],
  chq_layouts: ['account_id', 'layout']
};
const CQT = Object.keys(CQC);
const padNo = (n, pad) => String(n).padStart(pad, '0');
async function bankAcc(id) {
  const [[a]] = await pool.query("SELECT id FROM accounts WHERE id=? AND kind='bank'", [+id]);
  if (!a) throw bad('Choose a bank account');
}
const cqSelect = `SELECT c.*, a.name bank_name_acc, a.bank_name, a.account_no, v.voucher_no FROM cheques c JOIN accounts a ON a.id=c.account_id LEFT JOIN vouchers v ON v.id=c.voucher_id`;

app.get('/api/cheque/books', h(async (req, res) => {
  const [r] = await pool.query('SELECT b.*, a.name account_name, (SELECT COUNT(*) FROM cheques c WHERE c.book_id=b.id) used FROM chq_books b JOIN accounts a ON a.id=b.account_id ORDER BY b.id DESC');
  const [u] = await pool.query('SELECT book_id, cheque_no FROM cheques WHERE book_id IS NOT NULL');
  const used = {}; for (const x of u) (used[x.book_id] = used[x.book_id] || new Set()).add(Number(x.cheque_no));
  for (const b of r) { let n = Number(b.next_no); const set = used[b.id] || new Set(); while (n <= Number(b.end_no) && set.has(n)) n++; b.next_free = n <= Number(b.end_no) ? n : null; b.total = Number(b.end_no) - Number(b.start_no) + 1; }
  res.json(r);
}));
app.post('/api/cheque/books', h(async (req, res) => {
  const b = req.body; await bankAcc(b.account_id);
  const raw = String(b.start_no || '').trim(), rawEnd = String(b.end_no || '').trim();
  if (!/^\d{1,12}$/.test(raw) || !/^\d{1,12}$/.test(rawEnd)) throw bad('Cheque numbers must be digits only');
  const st = +raw, en = +rawEnd;
  if (!(st > 0 && en >= st)) throw bad('Enter a valid cheque number range');
  if (en - st > 9999) throw bad('A cheque book can have at most 10,000 leaves');
  const [[o]] = await pool.query('SELECT COUNT(*) n FROM chq_books WHERE account_id=? AND NOT (end_no<? OR start_no>?)', [+b.account_id, st, en]);
  if (o.n) throw bad('This range overlaps another cheque book of the same bank account');
  const [r] = await pool.query('INSERT INTO chq_books SET ?', [{ account_id: +b.account_id, label: String(b.label || '').slice(0, 60) || null, start_no: st, end_no: en, next_no: st, pad: Math.max(raw.length, rawEnd.length) }]);
  res.json({ id: r.insertId });
}));
app.put('/api/cheque/books/:id', h(async (req, res) => {
  await pool.query('UPDATE chq_books SET label=?, active=? WHERE id=?', [String(req.body.label || '').slice(0, 60) || null, req.body.active === 0 || req.body.active === false ? 0 : 1, +req.params.id]); res.json({ ok: true });
}));
app.delete('/api/cheque/books/:id', h(async (req, res) => {
  const [[u]] = await pool.query('SELECT COUNT(*) n FROM cheques WHERE book_id=?', [+req.params.id]);
  if (u.n) throw bad('This book has cheques in the register. Mark it inactive instead.');
  await pool.query('DELETE FROM chq_books WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

app.get('/api/cheque/payees', h(async (req, res) => {
  const [r] = await pool.query("SELECT name FROM parties WHERE active=1 AND kind IN ('paid','both') ORDER BY name LIMIT 2000");
  res.json(r.map(x => x.name));
}));
app.get('/api/cheque/layout/:acc', h(async (req, res) => {
  const [[r]] = await pool.query('SELECT layout FROM chq_layouts WHERE account_id=?', [+req.params.acc]);
  res.json({ layout: r ? JSON.parse(r.layout) : null });
}));
app.put('/api/cheque/layout/:acc', h(async (req, res) => {
  await bankAcc(req.params.acc);
  const L = req.body && req.body.layout; if (!L || typeof L !== 'object') throw bad('Layout is missing');
  const txt = JSON.stringify(L); if (txt.length > 6e6) throw bad('Layout (background image) is too large');
  await pool.query('INSERT INTO chq_layouts (account_id,layout) VALUES (?,?) ON DUPLICATE KEY UPDATE layout=VALUES(layout)', [+req.params.acc, txt]); res.json({ ok: true });
}));
app.delete('/api/cheque/layout/:acc', h(async (req, res) => { await pool.query('DELETE FROM chq_layouts WHERE account_id=?', [+req.params.acc]); res.json({ ok: true }); }));

app.get('/api/cheques', h(async (req, res) => {
  const { account_id, status, from, to, q } = req.query, w = ['1=1'], p = [];
  if (+account_id) { w.push('c.account_id=?'); p.push(+account_id); }
  if (['issued', 'printed', 'cleared', 'cancelled'].includes(status)) { w.push('c.status=?'); p.push(status); }
  else if (status === 'open') w.push("c.status IN ('issued','printed')");
  if (isDate(from)) { w.push('c.cdate>=?'); p.push(from); }
  if (isDate(to)) { w.push('c.cdate<=?'); p.push(to); }
  if (q) { w.push('(c.payee LIKE ? OR c.cheque_no LIKE ? OR c.narration LIKE ?)'); const l = '%' + q + '%'; p.push(l, l, l); }
  const [r] = await pool.query(`${cqSelect} WHERE ${w.join(' AND ')} ORDER BY c.cdate DESC, c.id DESC LIMIT 1000`, p); res.json(r);
}));
app.get('/api/cheques/:id', h(async (req, res) => {
  const [[r]] = await pool.query(`${cqSelect} WHERE c.id=?`, [+req.params.id]);
  if (!r) throw Object.assign(new Error('Cheque not found'), { status: 404 }); res.json(r);
}));
function cqFields(b) {
  if (!isDate(b.cdate)) throw bad('Enter a valid cheque date');
  const payee = String(b.payee || '').trim().slice(0, 150); if (!payee) throw bad('Enter the payee name');
  const amount = r2(b.amount); if (!(amount > 0)) throw bad('Enter the amount');
  return { cdate: b.cdate, payee, amount, narration: String(b.narration || '').slice(0, 300) || null,
    crossing: ['ac_payee', 'crossed', 'none'].includes(b.crossing) ? b.crossing : 'ac_payee', bearer_cut: b.bearer_cut === 0 || b.bearer_cut === false ? 0 : 1 };
}
app.post('/api/cheques', h(async (req, res) => {
  const b = req.body, acc = +b.account_id; await bankAcc(acc);
  const f = cqFields(b); let vid = null, newVoucher = null;
  if (b.voucher_id) {
    const [[v]] = await pool.query('SELECT v.id FROM vouchers v JOIN voucher_lines l ON l.voucher_id=v.id AND l.account_id=? WHERE v.id=? LIMIT 1', [acc, +b.voucher_id]);
    if (!v) throw bad('That voucher does not use this bank account');
    const [[l]] = await pool.query('SELECT id FROM cheques WHERE voucher_id=?', [+b.voucher_id]);
    if (l) throw bad('A cheque is already linked to that voucher');
    vid = +b.voucher_id;
  }
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    let no = String(b.cheque_no || '').trim(), bookId = null;
    if (no) {
      if (!/^\d{1,12}$/.test(no)) throw bad('Cheque number must be digits only');
      const [[bk]] = await conn.query('SELECT * FROM chq_books WHERE account_id=? AND start_no<=? AND end_no>=? LIMIT 1 FOR UPDATE', [acc, +no, +no]);
      if (bk) { bookId = bk.id; if (+no === Number(bk.next_no)) await conn.query('UPDATE chq_books SET next_no=? WHERE id=?', [+no + 1, bk.id]); no = padNo(+no, bk.pad); }
    } else {
      // lowest free leaf of the first active book that still has one
      const [bks] = await conn.query('SELECT * FROM chq_books WHERE account_id=? AND active=1 AND next_no<=end_no ORDER BY id FOR UPDATE', [acc]);
      let picked = null;
      for (const bk of bks) {
        const [used] = await conn.query('SELECT cheque_no FROM cheques WHERE account_id=? AND book_id=?', [acc, bk.id]), set = new Set(used.map(x => Number(x.cheque_no)));
        let n = Number(bk.next_no); while (n <= Number(bk.end_no) && set.has(n)) n++;
        if (n <= Number(bk.end_no)) { picked = { bk, n }; break; }
        await conn.query('UPDATE chq_books SET next_no=end_no+1 WHERE id=?', [bk.id]);
      }
      if (!picked) throw bad('No cheque book with free leaves for this bank. Add a cheque book or type the cheque number.');
      no = padNo(picked.n, picked.bk.pad); bookId = picked.bk.id; await conn.query('UPDATE chq_books SET next_no=? WHERE id=?', [picked.n + 1, picked.bk.id]);
    }
    const [[dup]] = await conn.query('SELECT id FROM cheques WHERE account_id=? AND cheque_no=?', [acc, no]);
    if (dup) throw bad(`Cheque ${no} is already in the register`);
    if (b.create_voucher && !vid) {
      const cv = +b.counter_account_id; if (!cv) throw bad('Choose the expense / party account for the payment voucher');
      newVoucher = vid = await saveVoucher(null, { vtype: 'BP', vdate: isDate(b.vdate) ? b.vdate : today(), narration: f.narration || `Cheque ${no} to ${f.payee}`, party: f.payee, cheque_no: no,
        lines: [{ account_id: cv, debit: f.amount, credit: 0 }, { account_id: acc, debit: 0, credit: f.amount }] }, req);
    }
    const [r] = await conn.query('INSERT INTO cheques SET ?', [{ ...f, book_id: bookId, account_id: acc, cheque_no: no, voucher_id: vid }]);
    await upsertParty(conn, f.payee, 'paid');
    await conn.commit(); res.json({ id: r.insertId, cheque_no: no, voucher_id: vid });
  } catch (e) {
    await conn.rollback();
    if (newVoucher) await pool.query('DELETE FROM vouchers WHERE id=?', [newVoucher]).catch(() => {});
    throw e;
  } finally { conn.release(); }
}));
app.put('/api/cheques/:id', h(async (req, res) => {
  const [[c]] = await pool.query('SELECT * FROM cheques WHERE id=?', [+req.params.id]);
  if (!c) throw Object.assign(new Error('Cheque not found'), { status: 404 });
  if (['cleared', 'cancelled'].includes(c.status)) throw bad(`A ${c.status} cheque cannot be edited`);
  const f = cqFields(req.body);
  if (c.voucher_id && r2(f.amount) !== r2(c.amount)) throw bad('The amount is linked to its payment voucher. Edit the voucher, or cancel this cheque and issue a new one.');
  await pool.query('UPDATE cheques SET ? WHERE id=?', [f, c.id]); res.json({ ok: true });
}));
app.post('/api/cheques/printed', h(async (req, res) => {
  const ids = (req.body.ids || []).map(Number).filter(Boolean); if (!ids.length) throw bad('Nothing to mark');
  await pool.query("UPDATE cheques SET print_count=print_count+1, printed_at=NOW(), status=IF(status='issued','printed',status) WHERE id IN (?) AND status<>'cancelled'", [ids]); res.json({ ok: true });
}));
app.post('/api/cheques/:id/clear', h(async (req, res) => {
  const [[c]] = await pool.query('SELECT * FROM cheques WHERE id=?', [+req.params.id]);
  if (!c) throw Object.assign(new Error('Cheque not found'), { status: 404 });
  if (c.status === 'cancelled') throw bad('A cancelled cheque cannot be cleared');
  const d = req.body.cleared_on || null; if (d && !isDate(d)) throw bad('Invalid date');
  await pool.query('UPDATE cheques SET status=?, cleared_on=? WHERE id=?', [d ? 'cleared' : (c.print_count ? 'printed' : 'issued'), d, c.id]);
  if (c.voucher_id) await pool.query('UPDATE voucher_lines SET cleared_on=? WHERE voucher_id=? AND account_id=?', [d, c.voucher_id, c.account_id]);   // feeds bank reconciliation
  res.json({ ok: true });
}));
app.post('/api/cheques/:id/cancel', h(async (req, res) => {
  const [[c]] = await pool.query('SELECT * FROM cheques WHERE id=?', [+req.params.id]);
  if (!c) throw Object.assign(new Error('Cheque not found'), { status: 404 });
  if (c.status === 'cleared') throw bad('A cleared cheque cannot be cancelled');
  await pool.query("UPDATE cheques SET status='cancelled' WHERE id=?", [c.id]); res.json({ ok: true, voucher_id: c.voucher_id });
}));
app.delete('/api/cheques/:id', h(async (req, res) => {
  const [[c]] = await pool.query('SELECT * FROM cheques WHERE id=?', [+req.params.id]);
  if (c && (c.print_count || c.voucher_id || c.status !== 'issued')) throw bad('Only an unprinted cheque with no voucher can be deleted. Cancel it instead.');
  await pool.query('DELETE FROM cheques WHERE id=?', [+req.params.id]); res.json({ ok: true });
}));

// ---------- backup ----------
const COLS = {
  accounts: ['id', 'code', 'name', 'type', 'kind', 'bank_name', 'account_no', 'opening_balance', 'opening_side', 'active'],
  vouchers: ['id', 'vtype', 'seq', 'voucher_no', 'vdate', 'narration', 'party', 'ref', 'cheque_no'],
  voucher_lines: ['id', 'voucher_id', 'account_id', 'debit', 'credit', 'cleared_on'],
  settings: ['skey', 'sval'],
  ...Object.fromEntries(HRT.map(t => ['hr_' + t, HR[t]])),
  ...CQC,
  ...transfersMod.COLS,
  ...bankMod.COLS,
  ...opsMod.COLS,
  parties: ['id', 'name', 'kind', 'phone', 'note', 'active']
};
async function dump() {
  const out = { app: 'famous-accounts', version: 1, exported_at: new Date().toISOString(), tables: {} };
  for (const t in COLS) { const [r] = await pool.query(`SELECT ${COLS[t].join(',')} FROM ${t}` + (t === 'settings' ? " WHERE skey NOT IN ('pw_hash','lock_hash')" : '')); out.tables[t] = r; }
  return out;
}
app.get('/api/backup', h(async (req, res) => {
  res.set('Content-Disposition', `attachment; filename="famous-accounts-${today()}.json"`).json(await dump());
}));
app.post('/api/restore', h(async (req, res) => {
  const tb = req.body && req.body.tables;
  if (!tb || req.body.app !== 'famous-accounts' || !Array.isArray(tb.accounts) || !Array.isArray(tb.vouchers) || !Array.isArray(tb.voucher_lines)) throw bad('This is not a Famous Accounts backup file');
  await guardLock(req, '1900-01-01');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query('SET FOREIGN_KEY_CHECKS=0');
    for (const t of ['voucher_lines', 'vouchers', 'accounts']) await conn.query(`DELETE FROM ${t}`);
    await conn.query('DELETE FROM voucher_counters');   // numbering restarts from the restored vouchers
    await conn.query("DELETE FROM settings WHERE skey NOT IN ('pw_hash','lock_hash')");
    for (const t of [...HRT].reverse()) if (Array.isArray(tb['hr_' + t])) await conn.query(`DELETE FROM hr_${t}`);
    for (const t of CQT) if (Array.isArray(tb[t])) await conn.query(`DELETE FROM ${t}`);
    for (const t of opsMod.TABLES_DELETE_ORDER) await conn.query('DELETE FROM ' + t);
    for (const t of bankMod.TABLES_DELETE_ORDER) await conn.query('DELETE FROM ' + t);   // statement analysis tables point at accounts, which are replaced
    await conn.query('DELETE FROM transfer_log'); await conn.query('DELETE FROM transfers');   // vouchers are replaced, so transfers must be too (older backups have none)
    if (Array.isArray(tb.parties)) await conn.query('DELETE FROM parties');
    for (const t in COLS) {
      const rows = (tb[t] || []).filter(r => t !== 'settings' || !['pw_hash', 'lock_hash'].includes(r.skey));
      for (let i = 0; i < rows.length; i += 500) {
        await conn.query(`INSERT INTO ${t} (${COLS[t].join(',')}) VALUES ?`, [rows.slice(i, i + 500).map(r => COLS[t].map(c => (r[c] === undefined ? null : r[c])))]);
      }
    }
    await seedCounters(conn);
    await conn.query('SET FOREIGN_KEY_CHECKS=1');
    await conn.commit(); res.json({ ok: true, vouchers: tb.vouchers.length });
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}));
// ---------- backups: daily copy in ./backups (as before) + an optional second copy on another drive / folder ----------
const BK_MAIN = path.join(__dirname, 'backups');
const bkHours = async () => { const v = +(await getSetting('backup_hours')); return [1, 6, 12, 24].includes(v) ? v : 24; };
const bkKeep = async () => { const v = +(await getSetting('backup_keep')); return Number.isInteger(v) && v >= 3 && v <= 365 ? v : 14; };
const bkSlot = hours => { const d = new Date(); return today() + (hours < 24 ? '-' + String(Math.floor(d.getHours() / hours) * hours).padStart(2, '0') : ''); };
function bkWrite(dir, name, text, keep) {   // writes, then reads the file back to make sure it is complete
  fs.mkdirSync(dir, { recursive: true }); const f = path.join(dir, name); fs.writeFileSync(f, text);
  const back = fs.readFileSync(f, 'utf8'); if (back.length !== text.length) throw new Error('the file written to ' + dir + ' is incomplete'); JSON.parse(back);
  if (keep) fs.readdirSync(dir).filter(n => /^auto-.*\.json$/.test(n)).sort().slice(0, -keep).forEach(n => fs.unlinkSync(path.join(dir, n)));   // only the automatic files are rotated, manual ones are never deleted
  return f;
}
async function runBackup(manual) {
  const hours = await bkHours(), keep = await bkKeep(), dir2 = await getSetting('backup_dir2'), text = JSON.stringify(await dump());
  const stamp = new Date(), name = manual ? `manual-${today()}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(stamp.getSeconds()).padStart(2, '0')}.json` : `auto-${bkSlot(hours)}.json`, out = { main: null, second: null, errors: [] };
  try { out.main = bkWrite(BK_MAIN, name, text, keep); await setSetting('bk_last_ok', new Date().toISOString()); await setSetting('bk_last_err', ''); } catch (e) { out.errors.push('Backups folder: ' + e.message); await setSetting('bk_last_err', e.message); }
  if (dir2) { try { out.second = bkWrite(dir2, name, text, keep); await setSetting('bk_dir2_ok', new Date().toISOString()); await setSetting('bk_dir2_err', ''); } catch (e) { out.errors.push('Second folder: ' + e.message); await setSetting('bk_dir2_err', e.message); } }
  return out;
}
async function autoBackup() {
  try { const hours = await bkHours(), dir2 = await getSetting('backup_dir2'), name = `auto-${bkSlot(hours)}.json`; if (!fs.existsSync(path.join(BK_MAIN, name)) || (dir2 && !fs.existsSync(path.join(dir2, name)))) await runBackup(false); }
  catch (e) { console.error('Auto backup failed:', e.message); }
}
async function backupHealth() {
  const last = await getSetting('bk_last_ok'), err = await getSetting('bk_last_err'), dir2 = await getSetting('backup_dir2'), err2 = await getSetting('bk_dir2_err'), ok2 = await getSetting('bk_dir2_ok');
  const ago = last ? (Date.now() - Date.parse(last)) / 36e5 : null; let warn = null;
  if (!last) warn = 'No backup has been made yet.'; else if (err) warn = 'The last backup failed: ' + err; else if (ago > 48) warn = `The last backup was ${Math.floor(ago / 24)} days ago.`; else if (dir2 && err2) warn = 'The second-folder backup failed: ' + err2;
  return { last_ok: last, hours_ago: ago === null ? null : Math.round(ago), second_folder: !!dir2, second_ok: ok2 || null, warn, tip: !dir2 ? 'Keep a second copy on another drive or USB: Settings & Backup.' : null };
}
app.get('/api/backup/status', h(async (req, res) => {
  const files = []; for (const [where, dir] of [['Backups folder', BK_MAIN], ['Second folder', await getSetting('backup_dir2')]]) { if (!dir || !fs.existsSync(dir)) continue; for (const n of fs.readdirSync(dir).filter(n => /^(auto|manual)-.*\.json$/.test(n))) { const s = fs.statSync(path.join(dir, n)); files.push({ where, name: n, size: s.size, mtime: s.mtime.toISOString() }); } }
  files.sort((a, b) => b.mtime.localeCompare(a.mtime));
  res.json({ main_dir: BK_MAIN, dir2: (await getSetting('backup_dir2')) || '', hours: await bkHours(), keep: await bkKeep(), health: await backupHealth(), second_err: (await getSetting('bk_dir2_err')) || '', files: files.slice(0, 40) });
}));
app.put('/api/backup/settings', h(async (req, res) => {
  const b = req.body || {}, dir2 = String(b.dir2 || '').trim(), hours = +b.hours, keep = +b.keep;
  if (![1, 6, 12, 24].includes(hours)) throw bad('Choose how often to back up'); if (!Number.isInteger(keep) || keep < 3 || keep > 365) throw bad('Keep between 3 and 365 backups');
  if (dir2) {
    if (!path.isAbsolute(dir2)) throw bad('Enter the full folder path, for example E:\\Backups'); if (path.resolve(dir2).toLowerCase() === path.resolve(BK_MAIN).toLowerCase()) throw bad('The second folder must be different from the main backups folder');
    try { fs.mkdirSync(dir2, { recursive: true }); const t = path.join(dir2, '.write-test'); fs.writeFileSync(t, 'ok'); fs.unlinkSync(t); } catch (e) { throw bad('This folder cannot be written to: ' + e.message); }
  }
  await setSetting('backup_dir2', dir2); await setSetting('backup_hours', hours); await setSetting('backup_keep', keep); await setSetting('bk_dir2_err', ''); res.json({ ok: true });
}));
app.post('/api/backup/run', h(async (req, res) => { const r = await runBackup(true); if (r.errors.length) throw bad(r.errors.join(' ')); res.json({ ok: true, main: r.main, second: r.second }); }));

// ---------- start ----------
(async () => {
  await init();
  if (process.argv.includes('--reset-password')) { await pool.query("DELETE FROM settings WHERE skey='pw_hash'"); console.log('Password removed.'); process.exit(0); }
  await autoBackup(); setInterval(autoBackup, 3600 * 1000);
  app.listen(cfg.webPort, cfg.lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`Famous Accounts is running: http://localhost:${cfg.webPort}`);
    if (cfg.lan) for (const l of Object.values(os.networkInterfaces()).flat()) if (l.family === 'IPv4' && !l.internal) console.log(`On your phone: http://${l.address}:${cfg.webPort}`);
  });
})().catch(e => {
  console.error('Could not start:', e.message);
  if (e.code === 'ER_ACCESS_DENIED_ERROR') console.error('MySQL refused the login. Create a file named db-config.json in this folder (copy db-config.example.json) and put your MySQL user name and password in it.');
  else console.error('Check that MySQL is running and the user/password in db-config.json are correct.');
  process.exit(1);
});
