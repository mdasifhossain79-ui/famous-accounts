# Famous Accounts (RMG Accounts Software)

Same architecture as the Expense Tracker (Node.js + Express + MySQL, plain HTML/JS front end), rebuilt for
RMG (garments) accounting. Currency: BDT (৳).

## What is included (phase 1)
- **Petty cash management**: payments, receipts, imprest limit, petty cash book with running balance
- **Bank transaction management**: bank payment, deposit, contra (bank/cash transfers), bank book, cheque numbers, bank reconciliation (cleared date)
- **Automatic trial balance**: built live from every voucher plus opening balances (opening / period / closing), balance check, CSV and print
- Double-entry vouchers (CP, CR, BP, BR, CT, JV), edit/delete, search, print
- Ready-made RMG chart of accounts (editable), ledger for any account
- Password lock, daily auto backup, manual backup and restore

## Desktop app mode (click an icon, no .bat each time)
Same as the expense tracker. Install Node.js and MySQL once, then double-click **`famous-accounts-app.vbs`** one time. It starts the server silently
in the background, opens Famous Accounts in its **own window** (Edge or Chrome app mode, no tabs, no black console) and puts a
**Famous Accounts** icon on your Desktop the first time. After that, just double-click the Desktop icon. (`install-desktop-app.bat` does the same
and can also make the app open when Windows starts.) The first launch runs `npm install` by itself, so it needs internet once.
If it cannot start, a message appears and details are in `server.log`. In Edge/Chrome you can also use the browser's "Install app" for http://localhost:3000.

## Bank Reconciliation (Reports > Bank Reconciliation)
A separate, **read-only** report tab. It never creates or changes vouchers, the Bank Book, cleared dates or anything else; it only reads your accounts and Bank Book.
1. Choose the bank account (as in your Bank Book) and upload the bank statement: **PDF**, Excel (.xlsx/.xls) or CSV. PDF statements must contain real text
   (not a scanned picture). Wrapped descriptions, repeated page headers, Debit/Credit or Withdrawal/Deposit columns and balances with Dr/Cr are handled.
2. The columns are detected automatically and shown for you to correct. A check line tells you whether *opening + money in − money out = closing* on the
   statement, which catches missed or misread rows. Set the **as on** date (default: last statement date), how far back to look in the Bank Book
   (default 6 months before the statement) and the date tolerance (default 7 days).
3. Statement lines are matched with Bank Book entries by cheque number, then same date, then nearest date within the tolerance (same amount and side).
   Anything left over is shown in two lists; tick items from both sides and press **Match ticked items** when one bank line covers several book entries.
   Any match can be undone.
4. The **reconciliation statement** shows Balance per Bank Book, + cheques issued but not cleared, − deposits not yet credited, + bank credits not in the book,
   − bank debits not in the book = expected balance, compared with the statement balance, and the **difference** (Reconciled ✔ when 0).
5. **Print preview** gives the report in the same design: the statement, uncleared cheques (with age and a stale warning after 6 months), deposits in transit,
   bank items not in the book, cleared items, and signature lines. **Export CSV** is also available.
Bank items not in your book (charges, interest) are listed only; record them with a voucher in the normal way. PDF reading uses pdf.js (Apache-2.0, in `public/vendor`).

## Import from Excel / CSV (Petty Cash Book and Bank Book)
On the **Petty Cash Book** or **Bank Book** screen press **⬆ Import Excel / CSV**, choose the account, then the file (.xlsx, .xls, .csv).
- Header row and columns are detected automatically (Date, Head / Particulars, Party, Narration, Cheque no, Receipt/Deposit, Payment/Withdrawal, or one
  Amount column). Title lines above the headers are fine. Change any column or the header row number if needed. Excel dates, `05/11/2026`
  (day/month/year), `05-Nov-2026`, `2026-11-05` and Bengali digits are understood.
- A bank statement's *Credit* is money in and *Debit* is money out. If your own bank book uses the opposite, tick **Swap money in / out**.
- **Heads of account** are matched to your Chart of Accounts by name or code. Heads that are not found are listed: the closest existing account is
  pre-filled, or leave the box empty to create a new account (type and code are suggested). Rows with no head go to the fallback accounts you choose.
- Total / opening / closing balance rows are skipped, rows already in the book (same date, side and amount) are skipped by default, and every
  row has a tick box. Check the summary (rows, money in, money out) against your sheet, then press Import.
- Each row becomes a voucher (CP/CR for petty cash, BP/BR for bank, or a Contra if the head is another cash/bank account). Party names go to the Party
  List. The whole file is saved in one go or not at all, and rows in a closed month ask for the lock password.
- **Download sample CSV** in the wizard shows the layout. The Excel reader (SheetJS, Apache-2.0) is included in `public/vendor`, so no internet is needed.

## Printing, previews and letterhead
- **Every print opens a preview first** (Print preview / Print buttons on vouchers, books, ledger, trial balance, party list, chart of accounts,
  cheque register, payroll lists, payslips, certificates, the daily summary and cheques). Nothing prints until you press Print.
- **No browser header/footer**: pages print with a zero page margin, so Chrome/Edge do not add the date, page title or web address. The top/bottom gap is made by a spacer that repeats on every page. (If a browser still shows them, untick *Headers and footers* in its print dialog.)
- **Signatures at the bottom**: in every printed document (payslip, certificates, vouchers, daily summary, reports and lists) the signature row is pinned to the bottom of the page, with blank space above it for signing and space below it. Reports and lists get Prepared by / Checked by / Authorized Signature lines too (switch off under *Printing & letterhead*). Very long reports put the signature after the last row.
- **Margins in every preview**: the preview toolbar shows the document title (for example *Payslip — Name (November-26)*) and **Margins (mm) T / B / L / R** boxes. Change a number and the page updates instantly. **Reset** goes back to the default; **Save as default** remembers the margins for that kind of document (payslips, salary certificates, vouchers, reports, daily summary and so on). Default margins for everything are under Settings & Backup > *Printing & letterhead* (25.4 mm = 1 inch top and bottom, 12 mm left and right; payslips default to no bottom margin).
- **Letterhead gap**: Settings & Backup > *Printing & letterhead*. Default **25.4 mm (1 inch) at the top and bottom** of every page, shown as
  dashed lines in the preview. You can change the margins, set the company address and phone, hide the company name/address header (if your paper
  already has it) and hide the footer line. "Preview sample page" lets you test with your paper.
- **Payslip, Salary Certificate and Yearly Certificate** follow your two PDF designs, in the app's indigo colours. Employees now have TIN, salary
  category and payment mode (CSV import accepts `tin,salary_category,payment_mode`). Payslip numbers look like PS-202610-00010. On a certificate
  you can type the purpose in the preview and it prints (and is saved in Certificate history).
- **Daily Cash Summary** (Books > Daily Cash Summary): pick the petty cash account and a date (◀ ▶ buttons) to get opening balance, receipts,
  payments, payments by head, closing balance with amount in words, replenishment amount, a physical cash count line and signature boxes.
- Voucher printing (cash/bank payment & receipt, contra, journal) uses the same design with Prepared / Checked / Approved / Received signatures.

## Searchable dropdowns, Party List and themes
- **Account and party fields are searchable**: in vouchers, the Expense / Income / party account column and **Paid to / Received from** are type-to-search boxes (arrow keys + Enter, or Tab to accept the top match). After picking an account the cursor jumps to the amount.
- **Not in the list?** The last option is **+ Add “name”**. For an account it opens a small form (type and next free code are suggested); for a party it adds the name straight away. Duplicate account names are blocked.
- **Party List** (Transactions > Party List): payees ("Paid") and payers ("Receipt"). Names are added automatically whenever a voucher or cheque is saved, a party used both ways becomes "Both", and each list shows only the right kind (payment vouchers and cheques show payees, receipts show payers). It shows total paid / received and last date, with phone and note, edit, inactive and "View vouchers". A party used on records cannot be deleted, only made inactive. Renaming a party also updates its old vouchers (needs the lock password if any are in a closed month).
- **Themes**: Auto / Light / Dark switch at the bottom of the sidebar. The choice is remembered on that device. Printing always uses black on white.

## Cheque Printing (Transactions > Cheque Printing)
Prints the variable parts of a Bangladesh bank cheque onto your pre-printed cheque leaf: date in boxes (DD MM YYYY), payee, amount in words
(Taka, lakh/crore, with paisa) and in figures, the **A/C Payee Only** crossing and a strike through "or Bearer".
- **Cheque register**: every cheque with status (issued, printed, cleared, cancelled), post-dated and stale (over 6 months) warnings, outstanding total, CSV export, print selected.
- **New cheque**: next number comes from your cheque book; payee suggestions; optionally creates the **bank payment voucher** (Dr expense/party, Cr bank) in the same step. You can also press **Print cheque** on any Bank Payment voucher.
- **Cheque books**: number ranges per bank, leaves left and low-stock warning. Used, spoiled and cancelled leaves are tracked, so a number is never reused.
- **Mark cleared** sets the cleared date on the voucher's bank line, which feeds the Bank Book reconciliation.
- **Layout & test print**: each bank account has its own layout. Drag items on the preview or type measurements in mm, upload a photo/scan of the leaf to line things up on screen, then **Test print** on plain paper and hold it against a real cheque. Printer feed errors are fixed with "Shift all fields". Print on an A4 sheet (cheque placed at an offset) or on cheque-size paper.
The starting layout is for an 8" x 3.5" leaf. Bank leaves differ, so calibrate once per bank account and press Save layout.

## Inter-Account Transfers (Transactions > Inter-Account Transfer, Transfer Register)
Moves money between your own accounts: bank to bank, bank to petty cash, petty cash to bank, petty cash to petty cash.
- **Entry screen:** purpose presets pre-fill From/To (cash withdrawal for petty cash, cash deposit to bank, bank to bank, petty cash to petty cash, imprest replenishment). Each account shows its balance. The replenishment preset suggests *imprest limit - current petty cash balance*.
- **Funds in transit:** tick it when the money has left one account but not reached the other. The amount waits in a **Funds in Transit** account (created automatically the first time) until you press **Mark received** in Transfer Register > In transit. It is zero when nothing is pending.
- **Bank charges and VAT** can be entered with the transfer. They post as a separate bank (or cash) payment voucher and are an expense, not part of the transferred amount.
- **Warnings, not blocks:** the From account going below zero, or petty cash going above the imprest limit. Amounts must be typed with at most 2 decimals and are never rounded silently.
- **Edit / Cancel / Delete:** a transfer that is cleared in the Bank Book cannot be changed. *Cancel* posts reversing vouchers and keeps everything for audit; *Delete* is only for an untouched transfer and is recorded in the audit log. Vouchers that belong to a transfer cannot be edited from All Vouchers; the voucher window shows an *Open transfer* button instead.
- **Transfer Register tabs:** Register (search, filters, sorting, pages, CSV, print), In transit (age, stale warning after 7 days), Summary by account (sent / received, with an in-transit check), Petty cash replenishment history against the imprest limit. Contra vouchers entered the old way appear as *Legacy contra* (read-only).
- **Other screens:** Bank Reconciliation shows a transfer badge on book entries and a list of transfers in transit for the chosen account (information only). Daily Cash Summary shows cash received from / paid to bank transfers. The dashboard shows funds in transit when there are any.
- **Database:** two new tables, `transfers` and `transfer_log`, are created automatically on the next start and are included in Backup and Restore. Nothing existing is changed.

## Bank Statement Analysis (Bank Reconciliation > Statement Analysis)
A second tab inside Bank Reconciliation. The original reconciliation tab is unchanged.
- **Import** a PDF, Excel or CSV statement. It is read on this computer, you see a preview, can fix columns and rows, skip rows, and the server checks every row again. Opening balance, total debit, total credit and closing balance are validated. Rows with errors block the save; nothing is dropped silently (skipped rows are kept on record). Importing the same statement twice, or rows already saved, is detected.
- **Overview**: opening, credit, debit, net cash flow, closing, transaction count, unclassified, with filters (account, bank, branch, dates, type). Money is handled in whole paisa, never floating point.
- **Credit / Debit Analysis**: category tables with count, total and % plus a clickable chart. Money moved between your own accounts is shown separately as *Internal transfers* (matched against your transfer vouchers), not as income or expense.
- **Categories & Rules**: your own categories and keyword rules with priority. Categories you set by hand are never overwritten by rules.
- **Unusual Transactions**: review alerts only (large value, duplicate reference, possible duplicate, missing description, invalid amount, balance jump, unclassified, date problems, statement totals mismatch). Mark each Reviewed / Needs investigation / Accepted / Incorrect data.
- **Reconciliation Summary**: statement closing vs Bank Book closing, outstanding cheques, deposits in transit, charges and credits not in the book, difference. A reconciliation can only be marked *completed* if the difference is zero or someone writes an explicit approval.
- **Reports**: 8 reports as print/PDF, Excel and CSV.
- Database: tables ba_periods, ba_imports, ba_transactions, ba_categories, ba_rules, ba_recon_records, ba_audit (created automatically, included in backup and restore). Account numbers are shown masked (last 4 digits). Back up before the first start after updating.

## Month-end bank tasks, Recurring vouchers, Cash forecast, Backups
- **Statement Analysis > Clear & Post Charges**: (1) marks Bank Book lines as cleared on the bank's date when they match an imported statement line (cheque number first, then amount and date); (2) turns charges / VAT found on the statement but missing from the books into Bank Payment vouchers (you choose the expense account; it is remembered). Nothing is changed until you press the button; the month-end lock still applies.
- **Recurring Vouchers** (Transactions): rent, salary, instalments. Nothing posts by itself: due items wait for your approval, overdue ones catch up in date order, the amount can be changed only explicitly (and is logged), and a month-end day like the 31st becomes the last day of short months.
- **Cash Forecast** (Reports): expected bank balance day by day from the balance the bank should show today, cheques and deposits clearing (you set the days), transfers in transit, future-dated vouchers and recurring vouchers. It warns of a shortfall. It is an estimate.
- **Backups** (Settings & Backup): the daily backup in the backups folder continues. You can add a second folder (another drive or USB), choose how often (day / 12 / 6 hours) and how many to keep. Every file is read back after writing, "Back up now" copies are never deleted, and the dashboard warns if no backup was made for 2 days, a backup failed, or there is no second copy.
- New tables: recurring_vouchers, recurring_log (in backup and restore). New column ba_transactions.voucher_id.

## Month-end lock
Settings & Backup > **Month-end lock**: first set a *lock password* (separate from the login password), then choose a month and press
**Close month**. Vouchers dated on or before the end of that month cannot be added, edited, deleted or moved into/out of the closed
period, and opening balances cannot be changed, unless the lock password is entered. The password is asked only when needed and is
remembered for 10 minutes. Closing a later month needs no password; reopening a month does. Bank reconciliation (cleared date) is not blocked.
Payroll certificates and payslips are never locked, so old months can always be printed.

## Certificate & Payslip tab (HR)
Full copy of the Payroll app, inside the sidebar tab **Certificate & Payslip**, with these sub-tabs:
Overview, Employees (search, filters, CSV import), Salary statements (add/edit, **Bulk generate** a whole month, print one or **print all**),
Certificate history (every printed certificate/payslip is saved exactly as issued and can be reprinted), Departments, Designations,
Signatories, Backup, Settings (company info, salary structure with % heads and deductions, automatic reference-number format like HR/2026/0001).
**Yearly certificate** sub-tab: pick an employee, calendar or fiscal year (fiscal start follows Settings), see a month-by-month salary table with totals and amount in words, and print one or print for all employees. Any past year works; each printed yearly certificate gets an automatic reference number and is saved in Certificate history.
Each statement prints as a **Salary Certificate** or a **Payslip**, with the net amount in words (Taka, lakh/crore style).

Moving your old data: open Certificate & Payslip > Backup > Restore and choose a backup file downloaded from the old Payroll app.
Payroll data is also included in the main backup (Settings & Backup).

## Run
1. Install Node.js and MySQL (or XAMPP).
2. `mysql -u root -p < setup-mysql-user.sql` (edit the password first), then copy `db-config.example.json` to `db-config.json` and set the same password.
3. Windows: double-click `famous-accounts-app.vbs` (desktop app mode, see below) or `start.bat`. Mac/Linux: `./start.sh`. Open http://localhost:3000

## First use
1. Settings: set company name, imprest limit and fiscal year start (default 1 July).
2. Chart of Accounts: edit your bank account(s) and enter opening balances (total Dr must equal total Cr).
3. Enter vouchers. The trial balance updates by itself.

Forgot the password? Run `npm run reset-password`.
Phone access on the same Wi-Fi: set `"lan": true` in db-config.json (a password is then required).
#   f a m o u s - a c c o u n t s 
 
 

## Database login (db-config.json)
The program no longer has a MySQL password written inside it. Create a file named `db-config.json` in this folder (copy `db-config.example.json`) and put your own MySQL user name and password in it. This file is never uploaded to GitHub. If it is missing or wrong, the server window says "MySQL refused the login".

## Part 1 safety fixes (23 Nov 2026)
- The MySQL password was removed from `server.js` and `setup-mysql-user.sql`.
- Editing a voucher keeps lines that did not change, so a bank line keeps its "cleared" date. If you change the amount or account of a line, that line starts again as not cleared.
- Voucher numbers are never reused: a counter per voucher type remembers the highest number used, even if that voucher is deleted. Two people saving at the same moment get different numbers.
- All Vouchers shows 200 per page with Newer / Older buttons and the total count.
- Not changed yet: transfer numbers (TR-) still use the old method, and vouchers can still be deleted (Part 2 replaces delete with reverse).
