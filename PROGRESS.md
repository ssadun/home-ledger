# Home Ledger — Frontend ↔ DB Wiring Progress

> **Goal:** Wire every frontend module to the backend database. Before this work,
> only authentication talked to the backend — every other page ran on static mock
> data (`data.js`, `*-data.js`) and mutated React state only, so adds/edits/deletes
> vanished on refresh (the original "deleted spending reappears" bug).

**Started:** 2026-06-18 · **Pace:** module-by-module, with review/approval after each module.

---

## Decisions (locked in)

| Topic | Decision |
|---|---|
| Accounts / Credit Cards / Debit Cards | **One `Account` model** with a `type` field (credit/debit/cash/bank) |
| Subscriptions | **Reuse `RecurringExpense`** model (no separate table) |
| Members | **Reuse `Users` table** (each member is a full account) |
| Categories representation | Transactions store a **string `category_key`** (e.g. `groceries`) alongside the optional FK; categories table seeded from defaults |
| Migrations | **No Alembic** — `Base.metadata.create_all()` + manual `ALTER TABLE` on the live SQLite DB |

---

## Architecture notes / patterns

- **Frontend has no build step.** Plain `<script>` + Babel-standalone in the browser. Each page is an HTML file listing its scripts. Code is **baked into the nginx image** (no bind-mount) — frontend changes require `docker-compose up -d --build frontend`.
- **Backend** is also baked into its image (only `./data` and `./uploads` are mounted) — backend changes require `docker-compose up -d --build backend`.
- **API host:** `http://localhost:8100` (container port 8000 → host 8100).
- **Auth wrapper:** `window.HL_AUTH.apiFetch(path, opts)` adds the bearer token and redirects to Login on 401. All new per-module API clients use it.
- **Per-module data layer pattern:** create a `<module>-data.js` (plain IIFE, NOT babel) exposing `window.HL_<MODULE>_API` with `list/create/update/remove` + `fromApi`/`toApi` mappers; include it in the page's HTML before the app's `.jsx`; then replace the app's local-state CRUD handlers with API calls.
- **Email validation gotcha:** backend `EmailStr` rejects `.local` TLDs — use real-looking domains (e.g. `@example.com`) when testing register/login.

### Field mapping — Transactions (backend ↔ frontend)
| Backend | Frontend |
|---|---|
| `date` | `date` |
| `payer` | `payer` |
| `paying_for` | `payingFor` (`–` = N/A) |
| `category_key` | `cat` |
| `description` | `desc` |
| `currency` | `cur` |
| `amount` | `amt` |
| `payment_method` | `paymentMethod` |
| `amount_try` / `amount_usd` | `tryV` / `usdV` (client-computed; backend overrides if a TCMB rate row exists for the date) |
| `type` | `type` (income/expense only) |

### Field mapping — Categories (backend ↔ frontend config item)
`{id, key, name, icon, color, kind}` ↔ `{id, key, label, icon, color, kind}`
(`kind` ∈ income/expense/**transfer**; backend `type` enum stays income/expense for compat.)

---

## Module status

| # | Module | Backend | Frontend | Verified | Notes |
|---|--------|---------|----------|----------|-------|
| 1 | **Spending** | ✅ | ✅ | ✅ | Original bug fixed |
| 2 | **Categories** | ✅ | ✅ | ✅ | Global-CATS propagation deferred (see follow-ups) |
| 3 | **Budgets** | ✅ | ✅ | ✅ | Upsert-by-category; "spent" still from static TX until shared hydration |
| 4 | **Recurring** | ✅ | ✅ | ✅ | 14 new cols incl. JSON `history`; `kind` discriminator; status↔is_active |
| 5 | **Subscriptions** | ✅ | ✅ | ✅ | Reuses recurring backend, `kind=subscription` |
| 6 | **Accounts/Cards** | ✅ | ✅ | ✅ | One `Account` model (type field); `account_key` for stable linking |
| 7 | **Members** | ✅ | ✅ | ✅ | Reuse Users table; login now accepts username + gates on `is_active` |
| 8 | **Currencies** | ✅ | ✅ | ✅ | New `CurrencyRate` table (NOT `/api/rates`); per-currency rows + JSON `history` |
| 9 | **Import** | ✅ | ✅ | ✅ | Wizard now uploads real files → `/api/import/preview` → `/confirm`. Export stays client-side, data-fix deferred to #10 |
| 10 | **Dashboard + Reports + Export** | ✅ | ✅ | ✅ | Shared pre-mount `ledger-hydrate.js` pass; Budgets "spent" + Calendar fold in for free |

### Sequencing note (Dashboard/Reports moved to last)
Dashboard and Reports are **pure read-only aggregators** — `dashboard-data.js`/`reports-data.js`
are just math over transactions + budgets + recurring + accounts. They read `window.LEDGER.TX`
(captured once at module scope and fed into ~10 memos whose dependency arrays don't include TX),
plus their own add/edit/delete tx modal that mutates the static array (same bug class as Spending).
Wiring them now would only half-work (real tx, mock budgets/accounts) and need revisiting per
dependency. **Plan:** finish the CRUD source modules first, then a shared pre-mount `LEDGER.TX`
hydration lets Dashboard + Reports light up in one clean pass.

---

## ✅ Module 1 — Spending (DONE, verified)

**Backend**
- `models.py` → `Transaction`: added `category_key`, `paying_for`, `payment_method` columns.
- `schemas.py` → `TransactionCreate/Out/Update`: added the 3 fields + accept client `amount_try`/`amount_usd` as fallback.
- `ALTER TABLE transactions ADD COLUMN` for the 3 columns on the live DB.
- `routers/transactions.py` delete endpoint was already correct (`db.delete` + `db.commit`) — the bug was purely frontend.

**Frontend**
- New `frontend/spending-data.js` (`window.HL_SPENDING_API`).
- `Spending.html`: include `spending-data.js`.
- `spending-app.jsx`: load rows from API on mount; `saveTx` → POST/PATCH; `confirmDelete` → DELETE. (Was previously `setRows(... filter)` local-only.)

**Verification:** create persists all fields → `DELETE` returns 204 → row stays gone on refetch. Test user removed afterward.

---

## ✅ Module 2 — Categories (DONE, verified)

**Backend**
- `models.py` → `Category`: added `key` (frontend identifier) and `kind` (allows `transfer`).
- `schemas.py`: extended `CategoryOut`; added `CategoryCreate`, `CategoryUpdate`.
- New `routers/categories.py`: CRUD + `seed_default_categories()` (16 defaults mirroring `data.js` CATS).
- `main.py`: register router + run seed at startup.
- `ALTER TABLE categories ADD COLUMN key, kind` on the live DB.

**Frontend**
- New `frontend/categories-data.js` (`window.HL_CATEGORIES_API`, includes `hydrateLedgerCats()` helper — written but not yet wired into other pages).
- `Categories.html`: include `categories-data.js`.
- `config-app.jsx`: load categories from API on mount; `saveItem`/`deleteItem` route through the API for the `categories` section (other config sections still on static seed).

**Verification:** 16 defaults seed; custom create persists (id 17); delete → 204 → count back to 16. Test user removed.

---

## ✅ Module 3 — Budgets (DONE, verified)

**Backend**
- `models.py` → `Budget`: added `category_key`, `start_date`, `end_date` (reuse `amount` as the monthly limit).
- `schemas.py`: added `BudgetCreate`, `BudgetUpdate`, `BudgetOut`.
- New `routers/budgets.py`: user-scoped CRUD. `main.py`: register.
- `ALTER TABLE budgets ADD COLUMN category_key, start_date, end_date`.

**Frontend**
- `budgets-data.js`: replaced static dict with `window.HL_BUDGETS_API` — **upsert-by-category-key**
  (keeps an internal `category_key → id` map so the dict-shaped UI stays unchanged; one budget per category).
- `budgets-app.jsx`: load dict from API on mount; `handleSave`/`handleRemove` go through the API.

**Verification:** create (rent, id 1) → patch (limit 32000→35000) → delete → 204 → count 0. Test user removed.

**Note:** budget *limits* are now real; the *spent* figure still derives from static `window.LEDGER.TX`
until the shared TX hydration (part of the Dashboard/Reports pass).

---

## ✅ Modules 4 & 5 — Recurring + Subscriptions (DONE, verified)

**Backend** (shared `recurring_expenses` table)
- `models.py` → `RecurringExpense`: added `category_key, kind, status, frequency, weekend_rule,
  start_date, end_date, payer, paying_for, payment_method, description, last_paid, next_due` and a
  JSON `history` column (stores the nested payment-history array). `kind` ∈ `bill | subscription`.
- `schemas.py`: rewrote `RecurringCreate`, added `RecurringUpdate`, expanded `RecurringOut`.
- New `routers/recurring.py`: user-scoped CRUD; `GET /api/recurring/?kind=` filter; create/update
  keep `is_active` in sync with `status`. `main.py`: register.
- `ALTER TABLE recurring_expenses` for all 14 columns (history as JSON/TEXT).

**Frontend**
- `recurring-data.js`: rewritten as `window.HL_RECURRING_API` (kind=bill) + `window.HL_SUBSCRIPTIONS_API`
  (kind=subscription) via a `makeApi(kind)` factory; keeps empty `RECURRING_DATA` placeholders so the
  ~10 guarded `window.RECURRING_DATA?.…` reads across pages still work.
- `subscriptions-data.js`: now a copy of the same client (self-contained for that page).
- `recurring-app.jsx` + `subscriptions-app.jsx`: load via API on mount; `saveRec`/`confirmDelete`
  go through the API.

**Recurring/Subscriptions split decision:** Recurring page = `kind=bill`, Subscriptions page =
`kind=subscription`. Clean separation, no overlap (the old mock mixed them).

**Verification:** created a bill with a 2-entry `history` JSON (persisted len 2); `?kind=bill` vs
`?kind=subscription` correctly returned 1 each; `status→paused` flipped `is_active=false`; delete → 204
→ count 0. Test user removed. (Subscriptions uses the identical verified endpoint.)

**Lost (demo glue):** the `LINK_PATTERNS`/`REC_TX_MAP` regex linking of recurring items to specific
transactions was tied to hardcoded `rec-N` ids; dropped. Linked-tx panels now show empty. Re-deriving
links against real data is a follow-up.

---

## ✅ Module 6 — Accounts / Cards (DONE, verified)

**Decision realised:** one `Account` table discriminated by `type` (bank / overdraft /
credit / debit / wallet / cash / invest) — no separate Credit/Debit tables. The former
"Credit Cards" / "Debit Cards" / "Account Types" pages are just type-filtered views.

**Backend**
- `models.py` → new `Account` model. Notable columns: `account_key` (stable string id
  `acc-{id}`, assigned on create — referenced by `linked_key` and
  `transactions.payment_method`), `holder` (household member label, distinct from the
  auth `owner_id` FK), `is_primary`, `credit_limit`, `iban`, `linked_key`, card fields
  (`cc_type`, `debit_type`, `card_name`, `validity_month/year`, `statement_cutoff`).
- `schemas.py`: `AccountCreate`, `AccountUpdate`, `AccountOut`.
- New `routers/accounts.py`: user-scoped CRUD; create back-fills `account_key=acc-{id}`.
- `main.py`: register router. **No ALTER needed** — brand-new table, `create_all()` makes it.

**Frontend**
- `accounts-data.js`: rewritten as `window.HL_ACCOUNTS_API` (`list/create/update/remove`
  + `fromApi`/`toApi`). Config maps (`ACCOUNT_TYPES`, `CC_TYPES`, `DEBIT_TYPES`) stay
  static; `ACCOUNTS` is now an empty placeholder hydrated via the API on mount.
  Each row carries `id` (=`account_key`, for linking + React keys) and `_dbId` (numeric, for API calls).
- `accounts-app.jsx`: load via API on mount; `handleSave` → create/update by `_dbId`;
  `handleDelete` → remove by `_dbId`; `handleImport` now **persists** the per-account
  balance deltas (was local-state only).

**Naming note:** frontend `owner` ("Sadun"/"Handan"/"Shared") is a *household member
label* → stored as `holder`; the auth user is `owner_id`. `limit` → `credit_limit`
(reserved-word avoidance), `linked` → `linked_key`.

**Verification:** create bank (id 1 → `acc-1`) + credit card (negative balance, limit,
cutoff persisted) → list count 2 → PATCH balance 87420.55→90000 → DELETE → 204 → count 1.
Test user removed.

---

## ✅ Module 7 — Members (DONE, verified)

**Decision realised:** Members reuse the `users` table — each member is a full account.
The Members config page is now a CRUD view over Users.

**Backend**
- `models.py` → `User`: added `username` (unique), `role` (`admin`/`user`), `is_active`.
- `schemas.py`: `MemberCreate`, `MemberUpdate`, `MemberOut` (field names match the UI:
  `name`↔`full_name`, `active`↔`is_active`; `password` is write-only).
- New `routers/members.py`: list/create/update/delete over Users. Create synthesizes
  `email = {username}@hyperledger.app` when none given (UI has no email field; model still
  requires a unique email). Guards: duplicate username → 400, self-delete → 400. Password is
  only re-hashed when a non-empty value is sent (PATCH with blank password keeps the old one).
- `routers/auth.py` → login now matches **email OR username** and returns **403 if `is_active`
  is false** ("Active — Can Log In" is now enforced).
- `main.py`: register router. `ALTER TABLE users ADD COLUMN username, role, is_active`
  + `CREATE UNIQUE INDEX ix_users_username` on the live DB.

**Frontend**
- New `members-data.js` (`window.HL_MEMBERS_API`); `Members.html` includes it.
- `config-app.jsx`: load members from API on mount (Members page only); `saveItem`/`deleteItem`
  route the `members` section through the API.
- Password field made **`requiredOnCreate`** instead of `required` (the masked field is blank on
  edit, so it no longer blocks role/active edits) + an `editHint`. Generic `requiredOnCreate`/
  `editHint` support added to `ItemModal` validation, label asterisk, and hint rendering.

**Naming note:** frontend `name` → `full_name`; the auth user *is* the member, so there is no
separate owner FK here. Existing accounts with a NULL `username` list with a username derived from
their email local-part (display only; they still log in by email).

**Verification:** registered throwaway owner → listed (incl. real user) → created `melis`
→ logged in **by username** → PATCH (deactivate + role=admin + new password) persisted →
login as deactivated member returned **403** → duplicate username **400** → self-delete **400**
→ delete `melis` **204** → list back to baseline. Throwaway user removed.

---

## ✅ Module 8 — Currencies (DONE, verified)

**Decision (locked in):** the Currencies page is **currency-centric** (one row per ISO
code, each carrying its own latest rate + a nested rate `history`) — a different shape
from the day-keyed `ExchangeRate` table that drives transaction conversion. So instead of
reusing `/api/rates`, a **new `CurrencyRate` table** mirrors the frontend. `ExchangeRate` /
`_apply_rates()` left untouched; manual/TCMB rate edits here do **not** (yet) feed
transaction `amount_try`/`amount_usd` conversion (deferred follow-up below).

**Backend**
- `models.py` → new `CurrencyRate` model (table `currency_rates`): `code` (unique),
  `to_try`, `to_usd`, `as_of`, `source`, JSON `history`, `is_default`. Named `CurrencyRate`
  to avoid clashing with the existing `Currency` enum.
- `schemas.py`: `CurrencyCreate`, `CurrencyUpdate`, `CurrencyOut`.
- New `routers/currencies.py`: **global** CRUD (not user-scoped — FX rates are shared facts,
  like categories) + `seed_default_currencies()` (TRY base + USD/EUR from `data.js` FX).
  Code is upper-cased + dedup-guarded (duplicate → 400) on create and on code-change PATCH.
- `main.py`: register router + run seed at startup. **No ALTER needed** — brand-new table,
  `create_all()` makes it.

**Frontend**
- New `currencies-data.js` (`window.HL_CURRENCIES_API`, `list/create/update/remove` +
  `fromApi`/`toApi`; maps `to_try↔toTRY`, `to_usd↔toUSD`, `as_of↔asOf`). `Currencies.html`
  includes it.
- `config-app.jsx`: load currencies from API on mount (Currencies page only);
  `saveItem`/`deleteItem` route the `currencies` section through the API. The **History
  modal** save and the **Retrieve From TCMB** apply now persist (TCMB apply diffs vs. current
  state and `PATCH`es only the changed rows). `CURRENCY_SAMPLE_HISTORY`/`TCMB_RATES` constants
  stay as the static bulletin source for the TCMB-preview math.

**Field mapping — Currencies (backend ↔ frontend config item)**
`{id, code, to_try, to_usd, as_of, source, history[]}` ↔ `{id, code, toTRY, toUSD, asOf, source, history[]}`

**Verification:** 3 defaults seed (TRY base, USD/EUR w/ initial history) → create `gbp`
(code upper-cased → `GBP`, id 4) → duplicate `GBP` **400** → PATCH appends history (len 2) +
new rate → DELETE **204** → list back to 3 defaults. Throwaway user removed.

---

## ✅ Module 9 — Import (DONE, verified)

**Scope decision (locked in):** *Import* = full real wiring; *Export* = leave the
client-side CSV/JSON exporter as-is and fix its empty data sources in the shared
pre-mount hydration pass bundled with Dashboard/Reports (#10). No backend export
endpoint — the client-side exporter already honours each page's CSV schema.

**Backend**
- `services/bank_import.py` → `import_transactions()`: now persists `category_key`,
  `payment_method`, `payer`, `paying_for` per row (previously only date/amount/type/
  currency/description). Amount is normalised to **`abs()`** with direction carried by
  `type` — matching how the Spending module stores rows (was: signed amount). `type`
  falls back to the sign of the parsed amount when not explicitly supplied (the real
  `/preview` parse path supplies it; the review wizard supplies both). Dedup now compares
  on the absolute amount.
- `/api/import/preview` + `/confirm` routers were already correct — no change.

**Frontend**
- `import-data.js`: added `window.HL_IMPORT_API` — `preview(file, bank)` (multipart
  upload to `/api/import/preview`; **no Content-Type header** so the browser sets the
  boundary) + `confirm(rows, skipDuplicates)` (`/api/import/confirm`). Kept the sample
  `DOCUMENTS` + `guessCategory`/`tidyDesc` as an offline demo path.
- `import.jsx` (rewrite): the wizard now hydrates **accounts from `HL_ACCOUNTS_API.list()`**
  on mount (the static `ACCOUNTS_DATA.ACCOUNTS` placeholder is empty), accepts a **real
  picked/dropped file**, and on Continue calls `/preview` (busy spinner + inline error
  banner). `/preview` results are normalised into the same shape the sample docs use so
  Detect/Review render identically. On Import it maps the reviewed rows to the backend
  shape (`abs` amount + derived `type` + `category_key` + `payment_method`=account id +
  `payer`=account owner) and calls `/confirm`; the Done screen shows real
  `imported`/`skipped` counts. The sample-statement list stays as a `demo`-tagged path.
- New CSS in `styles/import.css` (`.imp-drop.has-file`, `.imp-error-banner`,
  `.imp-demo-tag`) — no inline styles.

**Verification** (synthesized Garanti CSV, throwaway user + `acc-1`):
`/preview` auto-detected `garanti`, returned 3 rows with correct income/expense types →
`/confirm` imported 3 → re-confirm of an existing row **skipped 1** (dedup) → transactions
API showed all 3 with `category_key`/`payment_method=acc-1`/`payer=Sadun`, **positive**
amounts, `note=banka_import`. Throwaway user + data removed.

---

## ✅ Module 10 — Dashboard + Reports + Export (DONE, verified)

**Decision realised:** the read-only aggregator pages (Dashboard + Reports merged
into `dashboard-app.jsx`, and the Backup & Export hub) capture their data at
**module scope** (`const { TX } = window.LEDGER`) before React mounts, and their
~14 memos list only period vars (not TX) in their dependency arrays. So instead
of rewriting every memo, a **shared pre-mount hydration pass** fetches the real
DB rows and fills the static `window.LEDGER` / `*_DATA` placeholders **in place**
(never reassigned), keeping the captured references valid; the mount is gated on
that pass so the first render already computes against real data.

**Frontend**
- New `frontend/ledger-hydrate.js` (plain IIFE) → `window.HL_HYDRATE`. `all()`
  hydrates **CATS + FX first** (recurring rows derive TRY/USD from `LEDGER.FX` at
  map time), then transactions / budgets / accounts / recurring in parallel. Each
  hydrator is a no-op when its API client/placeholder is absent and is wrapped so
  an individual failure logs but never blocks the others or the mount. Fills via
  in-place `fillArray`/`fillObject`; reuses the existing
  `HL_CATEGORIES_API.hydrateLedgerCats()`.
- `dashboard-app.jsx`: mount gated on `HL_HYDRATE.all()`. Add/edit/delete tx now
  go through `HL_SPENDING_API` (was local-state mutation of the static array — the
  original bug class) + `refreshTx()` re-hydrates and bumps a new `dataVersion`
  state that is threaded into every aggregation memo's dependency array so charts
  refresh after a CRUD. Removed the `window.LEDGER.TX = …filter(…)` reassignment
  (it broke the captured reference).
- `backup-export-app.jsx`: mount gated on `HL_HYDRATE.all()`; `AVAILABLE_YEARS`
  moved from module scope into a `useMemo` inside `App` so the year picker reflects
  the hydrated rows (the dataset `getRows()` are already lazy).
- `budgets-app.jsx`: mount gated on `HL_HYDRATE.all()` — the per-category **"spent"**
  (derived from `LEDGER.TX`) and category labels now reflect real data on first
  render. *(Closes the Module 3 "spent still from static TX" note.)*
- HTML includes (`Dashboard.html`, `Backup & Export.html`, `Budgets.html`): added
  `spending-data.js`, `categories-data.js`, (`currencies-data.js` where used) and
  `ledger-hydrate.js` before the babel app scripts.

**Free wins:** the Dashboard **Calendar** tab (`calendar-component.jsx`, also
`const { TX } = window.LEDGER` at module scope) lights up via the same gated
hydration. `ACCOUNTS_DATA.FX` shares the same object reference as `LEDGER.FX`, so
the in-place FX fill reaches it too.

**Export scope:** unchanged from Module 9 — the client-side CSV/JSON exporter
stays; this pass just feeds it real rows. Account-activity export still reads the
static `ACCT_TX_DATA` (no backend module for it yet).

**Verification** (throwaway user + 2 tx, 1 budget, 1 account, via Playwright
against the live `hyper-ledger-web` container): Dashboard mounts with **no console/
page errors**; KPIs render real figures — Actual Spend YTD **₺1,251**, YTD Income
**₺50,000**, YTD Budget **₺30,000** / Annual **₺60,000**. Backup & Export "Spending
Transactions" shows **2 rows** (was 0). Budgets "Groceries" shows **₺1,251 / ₺5,000
· ₺3,750 left** (real spent). Throwaway user + data removed.

---

## Open follow-ups

- [ ] **Global CATS hydration (remaining pages)** — `ledger-hydrate.js` now hydrates `LEDGER.CATS` on Dashboard / Backup&Export / Budgets. The other pages that render category icons/colors (Spending, Recurring, Subscriptions, Account Activity, calendar consumers, config sub-pages) still read the static `window.LEDGER.CATS`; include `categories-data.js` + a boot call (or `ledger-hydrate.js`) there so custom categories propagate everywhere.
- [ ] **Seed demo transactions (optional)** — the 32 sample rows in `data.js` no longer appear (Spending now shows real, empty DB data). Offer a one-time import script if a populated starting point is wanted.
- [ ] Config-app sections still on static seed and pending their own modules: **account-types / cc-types / debit-types** (→ Accounts module).
- [ ] **Currency rates → transaction conversion** — manual/TCMB edits on the Currencies page write to `currency_rates` only; `_apply_rates()` still reads the separate `ExchangeRate` table. To make edited rates actually drive `amount_try`/`amount_usd`, upsert the USD/EUR row into `ExchangeRate` on currency save (the "New table + sync rates" option, deferred per the Module 8 decision).
- [ ] **Shared ACCOUNTS hydration (remaining pages)** — Dashboard / Backup&Export / Budgets now hydrate `ACCOUNTS_DATA.ACCOUNTS` via the `ledger-hydrate.js` pass; the import wizard self-hydrates (Module 9). Still empty on the other not-yet-wired pages (account-activity, recurring/subscriptions/spending account pickers, calendar controls) — include `ledger-hydrate.js` (or call `HL_ACCOUNTS_API.list()`) there too.
- [ ] **`_parse_amount` Turkish-decimal bug** (pre-existing, surfaced during Module 9 verify) — a value like `800,00` (comma decimal, **no** thousands separator) is parsed as `80000` instead of `800.00` (the regex only treats comma as decimal when a `.` is also present). Affects every bank-import parse path. Fix: treat a lone comma followed by exactly 2 digits as the decimal separator.
- [ ] **Import balance-sync vs dedup** — the Accounts page's `handleImport` adjusts each account's balance by the net delta of **all reviewed rows**, but `/confirm` may `skip` duplicates. Re-importing a file thus re-adjusts balances for rows that weren't actually inserted. Either pass `skip_duplicates=false` for wizard imports, or have `/confirm` return which rows were imported so the balance delta can match.

---

## How to verify a module (recipe)

```bash
cd /volume1/system/home-ledger
docker-compose up -d --build backend frontend      # apply baked code changes
API=http://localhost:8100
# register/login a throwaway user (use @example.com, NOT .local)
# exercise create → list → delete → list and confirm persistence
# then: sqlite3 data/home-ledger.db "DELETE FROM users WHERE email='...';"  # cleanup
```

The live SQLite DB is at `./data/home-ledger.db` (host) → `/app/data/home-ledger.db` (container).
