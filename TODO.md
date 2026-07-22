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
- [x] Account Activity screen is empty however imported bank account transactions should be here. Can you fix it. — the page was rendering an empty client-side seed. Now it hydrates household accounts, fetches the selected month's transactions from `/api/transactions`, keeps only imported bank-account movements (`note=="banka_import"` & no `credit_payment_id`, and matched account not `type:credit` so card interim-dumps stay on Credit Payments), maps `payment_method`→account by `account_key`, and derives Type/Direction. Loading/error states + backend-wired mass-delete. Verified desktop + mobile 360.
- [x] Credit Payments screen add class="filter-bar" from Account Activity however add year add a period — added a filter-bar (Account Activity styling) with a Year stepper (year-only, no month per request), a Search box, and a Card filter in the Filters popup; records list filters client-side by year/card/search (desktop + mobile)
- [x] Accounts screen on detail modal add last account acitivities for more please give link to "Account Activity" screen with filter the account — the detail modal's "Recent Activity" section now fetches the account's real imported bank movements (`HL_ACCT_TX_API.listRecentForAccount`, most-recent 5, across all months) instead of the old empty client seed, with loading/empty/error states. A "View All →" link deep-links to `Account Activity.html?account=<id>`; that page reads the `?account=` query param to pre-pin its Account filter (chip shown). Scoped to non-credit, non-invest accounts (credit activity lives on Credit Payments; invest shows holdings). Verified desktop + mobile 360.
- [x] Account Activity screen when you click on a record detail modal should pop-up and user should see when was this record added and name of the source file — clicking a row (matching the existing Spending/`TxRow` convention) opens a read-only `AtxDetailModal` with the full record plus an **Added** field (`transactions.created_at`, already existed) and a **Source File** field backed by a new `transactions.source_filename` column, threaded through `import_transactions()` from both `/api/import/confirm` and the Credit Payments statement-confirm route (`ALTER TABLE transactions ADD COLUMN source_filename VARCHAR;` — see CLAUDE.md). The import wizard (`import.jsx`) now sends the uploaded file's original name through `HL_IMPORT_API.confirm(rows, skipDuplicates, sourceFilename)`. Rows imported before this change show "Not recorded" instead of a blank field. Verified end-to-end (a direct `/api/import/confirm` call round-tripped `source_filename` correctly) and desktop + mobile 360 via Playwright.
- [x] Spending, Subscriptions, Recurring and Account Activity using week-group-row. Then one by one make them collapsible in week-group-row. — all four already grouped rows into `week-group-row` headers (Spending/Account Activity by week-of-month, Subscriptions/Recurring by calendar week via `weekKey()`); added the collapsible behavior on top. Clicking a group header (cursor:pointer, hover tint) toggles a `wk-collapsed` class: a chevron rotates -90°, member rows stop rendering, and an item-count pill appears (`3 items`). Collapse state is per-page React state keyed by the group's key — reset on month/year change for the two month-scoped pages (Spending, Account Activity) so "Week 1" collapsed in June doesn't carry into July; kept as-is for Subscriptions/Recurring since their week key is an absolute calendar date. New shared CSS in `styles/tables.css` (`.week-group-chevron`, `.wk-collapsed`, `.week-group-count`). Verified all 4 screens collapse/expand correctly, desktop + mobile 360, via Playwright.

## 5. Bank-import parser regression fixtures

Use the sample statements under `import/` as golden fixtures so parser changes can't silently regress a supported format. One fixture per format currently in the registry.

- [x] fine tune `import/garanti-tl-hesaphareketleri.pdf` there is a "Etiket \ tag" based on that you can decide the category — the Garanti "Etiket" column now drives `category_key` (direction still follows the amount's sign) via `_ETIKET_CATEGORY`/`_etiket_category()` in `bank_import.py`, wired into `_normalize_row` (precedence: `_cc_classify` → Etiket map → bank-Diğer rule → sign) and mirrored in the frontend `ETIKET_MAP`. Mapping: Para Transferi & Döviz Al/Sat→wire-transfer, Kart Ödemesi→credit-card-payment, Faiz/Komisyon→interest, Telekomünikasyon→utilities, Ulaşım→transport; Diğer & Para Çekme intentionally unmapped. Verified end-to-end against the sample PDF (14/14 rows classified as expected).
  1. Para Transferi = Money Transfer
  2. Kart Ödemesi = Card Payment
  3. Faiz / Komisyon = Interest / Commission
  4. Telekomünikasyon = Telco Payment
  5. Ulaşım = Transportation Fee
  6. Döviz Al / Sat = Currency Exchange
  7. Diğer = Other
- [x] Can you create a new menu item under configuration like "satement value mapping" and include those definitions there with a language code. You can take other configuration modules design as referance. — added a **Statement Value Mapping** config section (mirrors Categories design): new `statement_mappings` table + `StatementMapping` model, `/api/statement-mappings` CRUD router (seeded from the Etiket defaults), and a config page (`Statement Value Mapping.html` + `statement-mappings-data.js` + SECTIONS entry + nav submenu item). Each row has a **Language** code (tr/en), the **Statement Tag** (Etiket), and a **Category** picker. The importer now reads this table: `parse_bank_file(db=…)` calls `load_etiket_map(db)` so edits/deletes take effect on the next import (hardcoded `_ETIKET_CATEGORY` stays as bootstrap fallback). Verified end-to-end: seed (16 rows), HTTP CRUD, live edit/delete reclassification, and desktop + mobile 360 rendering via Playwright.

Scaffolding added with the first fixture: `pytest.ini` (`pythonpath = backend`), `requirements-dev.txt`,
`backend/tests/conftest.py` (session-cached `parse_sample`) and `backend/tests/test_bank_import_fixtures.py`.
Pytest isn't in the runtime image, so the suite runs in a throwaway container off `home-ledger-backend`
with the repo mounted — exact command in CLAUDE.md → _Backend tests_. **30 tests, all passing.**

- [x] `import/26.01-BonusCardEkstre.pdf` — Garanti credit-card statement (`_parse_garanti_cc_pdf`): 114 rows, income/expense totals, date range, card identity (masked number, no IBAN, holder, institution), the billed-cycle fields (`payment_due` 2026-02-05 / `total` 178.313,25, **not** `interim`), `ÖDEMENİZ…TEŞEKKÜR`→income/`credit-card-payment`, `G.E. 0000017943452`→`retirement` (beats the Emeklilik/Sigorta Etiket), and `Microsoft*Xbox Game Pa` casing preserved verbatim.
- [x] `import/on-Hesap Hareketleri-tl.pdf` — ON / Burgan checking account (`_parse_on_burgan_pdf`): 44 rows, totals, IBAN identity + account no derived from the IBAN's last 6, running balance on every row, 33 virman rows all `wire-transfer` in both directions, bank-`Diger`→`wire-transfer`. Two amount assertions guard `_parse_on_amount`: `-160.643,550`→160643.55 and **`1,000`→1.0** — swapping in the shared `_parse_amount` makes that second one read 1000.0, verified by monkeypatching the parser and re-running.
- [x] `import/Midas_Ekstre_Mayıs_2026.pdf` — Midas portfolio → investments (`_parse_midas_holdings`): `kind:"investments"` with zero rows/accounts, the portfolio summary (cash, total, period), and all 3 holdings with asset_type (`gold`/`fund`), quantity, purchase price and current value.
- [x] `import/garanti-tl-hesaphareketleri.pdf` — Garanti checking account, TL (`_parse_garanti_hesap_pdf`): 14 rows, totals, IBAN/account-no/branch identity, four Etiket→category mappings, `Para Çekme` asserted **unmapped** on purpose, same-Etiket-opposite-sign pair proving direction still follows the sign, and casing preserved on `Sadun Sevıngen--EFT-CEP ŞUBE` / `K.Kartı Ödeme`.
- [x] `import/garanti-usd-hesaphareketleri.pdf` — Garanti checking account, USD (`_parse_garanti_hesap_pdf`): currency detected as USD on both the account and every row (the TL sample's twin), identity, and `Maaş`→`salary`.

- [ ] After deleting an account cascade realted transaction stored in account activity screen
- [ ] Clean orphan account activity records (without associated account)
- [ ] check related transaction of an account