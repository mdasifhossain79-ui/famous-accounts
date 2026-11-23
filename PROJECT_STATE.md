# Famous Accounts - Project State (analysed 23 Nov 2026)

The zip itself cannot be stored in Project docs (binary). This file is the saved record of what is inside it. The zip stays in the chat attachment; keep your own copy at F:\project\famous-accounts and on GitHub.

## Stack
Node.js + Express 4, MySQL (mysql2), plain HTML/JS front end, no build step. Desktop mode through famous-accounts-app.vbs (Edge/Chrome app window). Port 3003. Version 1.0.0. No automated tests.

## Size
About 4,900 lines but dense (about 510 KB of own code). Own code only; vendor files (pdf.js, SheetJS) are separate.

| File | Role |
|---|---|
| server.js (65 KB) | DB init, auth, settings, month lock, parties, chart of accounts, vouchers, import, books, trial balance, dashboard, payroll tables, cheques, backup/restore |
| transfers.js | Inter-account transfers, funds in transit |
| bankanalysis.js | Bank statement import, categories/rules, unusual items, recon summary |
| bankops.js | Recurring vouchers, cash forecast |
| public/app.js | Main UI (vouchers, books, trial balance, settings) |
| public/payroll.js, cheque.js, recon.js, import.js, transfer.js, bankanalysis.js, bankops.js | One UI module per feature |

## Database tables
accounts, vouchers, voucher_lines, settings, parties, hr_* (company, departments, designations, signatories, employees, statements, cert_history, ref_counters), chq_books, cheques, chq_layouts, transfers, transfer_log, ba_* (periods, imports, transactions, categories, rules, recon_records, audit), recurring_vouchers, recurring_log.

## Data in latest backup (22 Nov)
95 accounts, 248 vouchers, 496 voucher lines, 116 employees, 14 salary statements, 36 certificate records, 2 transfers, no cheques yet, no bank statements imported yet, no recurring vouchers yet.

## What works well
- Double-entry check on every voucher (debit = credit, whole-paisa rounding).
- Whole-batch import in one transaction, rolled back on any error.
- Passwords hashed with scrypt, login throttling, session cookie HttpOnly + SameSite=Strict, server only listens on 127.0.0.1 unless LAN mode (password required).
- Backups are read back and parsed after writing; manual backups never deleted; second-folder copy.
- Month-end lock with a separate password.
- Transfers cancel by reversing vouchers.

## Part status
- Sidebar update (23 Nov): collapsible groups, menu search, icon-only mode. Done.
- Interactive dashboard (23 Nov): period switcher, clickable cards, charts, needs-attention, month-end checklist, quick entry, customise, new GET /api/dashboard/extra. Done.
- Part 1 safety fixes (23 Nov): findings 1, 2, 4 and 6 below are fixed; tests passed on MariaDB with the real backup (edit keeps cleared date, 15 simultaneous saves, numbering after delete/restore, paging, transfers still work). Next: Part 2.

## Findings (to fix)
1. FIXED in Part 1 (still change the MySQL password, it stays in old Git history). Security: the MySQL root password is hard-coded as the default in server.js (line 12) and is already in the first Git commit of the GitHub repo. Change the MySQL password, use db-config.json only, and remove the default.
2. FIXED in Part 1. Bug: editing a voucher deletes and re-inserts its lines without cleared_on, so editing a bank voucher wipes the bank "cleared" date (and breaks the reconciliation).
3. Vouchers are deleted for real (DELETE) and there is no voucher audit trail. Only bank analysis and transfers have an audit log. Your accounting rule is: reverse, never delete.
4. FIXED in Part 1. Voucher number = MAX(seq)+1, so deleting the last voucher reuses its number; two people saving together can clash.
5. One shared password for everybody; no users, roles, or "who did this".
6. FIXED in Part 1. Voucher list is silently cut at 1,000 rows.
7. /api/lines/:id/clear does not check the line exists or the lock.
8. express.json limit is 100 MB for every route.
9. No tests, no PROJECT_STATE file (this one is the first).
10. Backups hold employee NID / bank account data in plain JSON; the backups folder must never be shared or pushed to GitHub (it is in .gitignore, keep it so).
11. The service worker caches nothing (fine), so the app needs the PC server to be on.

## Missing features (ideas he already received)
Profit & Loss and Balance Sheet, year-end closing to Retained Earnings, post salary to the ledger, TDS/VDS/AIT module, users/roles + audit trail, Bangla option, QR on certificates, depreciation/fixed asset register, supplier/buyer ageing (receivable/payable), LC/BTB tracking.

## Proposed upgrade Parts (one at a time, wait for "next")
- Part 1 Safety fixes: remove hard-coded password, keep cleared dates on edit, never reuse voucher numbers, voucher list paging.
- Part 2 Audit trail + reverse-instead-of-delete for vouchers.
- Part 3 Users and roles (admin, accountant, viewer) with backend permission checks.
- Part 4 Profit & Loss, Balance Sheet, year-end closing.
- Part 5 Salary posting to ledger, TDS/VDS/AIT.
- Part 6 Receivable/Payable ageing for buyers and suppliers.
- Part 7 Automated tests (Vitest + Supertest) and README/state file.
