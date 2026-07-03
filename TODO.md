# TODO

## 1. Credit Payments (credit card statements)

Create a `credit_payments` table to hold uploaded credit card statements, related to the main credit card.

- [x] New `credit_payments` table storing uploaded credit card statements as an **attachment**.
- [x] Dedicated menu item under **Transactions** called **"Credit Payments"**.
- [x] All created spendings get a dedicated field to store this record (link spending → credit payment record).
- [x] Record naming format: **"YYYY.MM - Card Name"**.
- [x] Store the following fields on each record:
  - [x] Cutover date
  - [x] Payment date
  - [x] Total payment amount
  - [x] Minimum payment amount
- [x] Associate the record with the corresponding **Credit Card** entry in the `accounts` table.
- [x] Surface the record on the **calendar widget**.

## 2. Mass delete on all tables

Every table should have row **checkboxes** and a **Delete** button to mass-delete selected records.
Reusable pattern built on the shared `TxRow` + `DeleteConfirm` (batch mode) components; deletes
loop the per-row API (no bulk endpoint → no backend rebuild).

- [x] **Spending** table — checkbox column, select-all (per page), bulk bar, batch-confirm delete (desktop + mobile 360).
- [x] **Subscriptions** table — checkbox column, select-all (per page), bulk bar, batch-confirm delete (desktop + mobile 360).
- [x] **Recurring** table — checkbox column, select-all (per page), bulk bar, batch-confirm delete (desktop + mobile 360).
- [x] **Account Activity** table — checkbox column, select-all (per page), bulk bar, batch-confirm delete (desktop + mobile 360). ⚠ Local-only: no backend for this screen, so deletes drop client rows and do **not** persist across a reload.
- [x] **Credit Payments** table — checkbox column, select-all, bulk bar, batch-confirm delete (real backend, per-row API loop; desktop + mobile 360).
- [x] **Categories / Currencies / Account-Types** tables (config page) — shared `CfgSectionTable` gains a checkbox column, select-all (over visible rows), bulk bar, and section-aware batch-confirm delete; routes through the per-section API (categories/currencies) or client-persist store (account-types). Applies to all config sections. Desktop + mobile 360.

## 3. Fix GUI

- [x] Fix calendar .date-input-icon color to var(--muted); (also keep it muted on :focus-within instead of turning accent)
- [x] Change color of .cp-empty svg from var(--orange); to var(--red);
- [x] Make "Credit Payments" screen same with "Spending" screen — tightened .cp-body padding to 7px horizontal, loaded menu.js so the sidebar toggle works + persists
- [x] Centralize menu/sidebar — sidebar was already single-source (nav.jsx markup + app.css styling + menu.js behavior). Real fix: removed the stale duplicated mobile-sidebar CSS blocks from accounts.css / budgets.css / dashboard.css so every page renders the bottom tab bar from app.css alone (dropped divergent z-index:200 → canonical 101). Menu items are added/edited in one place: the NAV arrays in nav.jsx.
- [x] Make Menu resizeble and remember position on next visit
- [x] If user makes menu size lower then 180px please collapse the menu 
- [x] Color of select box expended border need to be var(--border)
- [x] Changes on "Transaction Categories" color are not reflecting to Spendings table item color
- [x] In all table pages page starts with horizontal scroll can you fix it?
- [x] On accounts screen on table there is "0" after div class="acct-card-row" also same on account modal after span class="bal-display bal-positive bal-lg"

## 4. Table imporevements
- [x] Can we assign Institude logo from internet or from local computer? — per-institution logo (Config → Financial Institutions gains a Logo `image` field: paste a URL or upload a local file, downscaled to a ≤96px PNG data-URI, persisted in the localStorage institutions map). Accounts match by institution name and render the logo in place of the type icon on cards + detail modal (desktop + mobile).
- [ ] Account Activity screen is empty however imported bank account transactions should be here. Can you fix it. 
- [ ] Also add group by Bank Accounts and make them collapsible
- [ ] First find how many tables are using week-group-row. Then one by one make them collapsible in week-group-row. if you have any questions please ask.
- [ ] Credit Payments screen add class="filter-bar" from Account Activity however add year add a period
