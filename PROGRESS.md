# Hyper Ledger — Frontend ↔ DB Wiring Progress

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
| 8 | Currencies | ⬜ | ⬜ | ⬜ | Wire to `/api/rates` |
| 9 | Import/Export | ⬜ | ⬜ | ⬜ | `/api/import` exists; export endpoint TBD |
| 10 | Dashboard + Reports | ⬜ | ⬜ | ⬜ | **Consumers — done LAST.** See sequencing note |

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

## Open follow-ups

- [ ] **Global CATS hydration** — call `HL_CATEGORIES_API.hydrateLedgerCats()` on every page that renders category icons/colors (20+ pages read `window.LEDGER.CATS`), so custom categories propagate everywhere. Helper already exists; needs per-page include + boot call.
- [ ] **Seed demo transactions (optional)** — the 32 sample rows in `data.js` no longer appear (Spending now shows real, empty DB data). Offer a one-time import script if a populated starting point is wanted.
- [ ] Config-app sections still on static seed and pending their own modules: **currencies** (→ /api/rates), **account-types / cc-types / debit-types** (→ Accounts module).
- [ ] **Shared ACCOUNTS hydration** — `ACCOUNTS_DATA.ACCOUNTS` is now an empty placeholder, so payment-method/account pickers on not-yet-wired pages (import wizard, dashboard, account-activity, recurring/subscriptions/spending controls, calendar) render empty until they hydrate from `HL_ACCOUNTS_API.list()`. Same pattern/class as the Global CATS hydration follow-up; fold into the shared pre-mount hydration pass.

---

## How to verify a module (recipe)

```bash
cd /volume1/system/hyper-ledger
docker-compose up -d --build backend frontend      # apply baked code changes
API=http://localhost:8100
# register/login a throwaway user (use @example.com, NOT .local)
# exercise create → list → delete → list and confirm persistence
# then: sqlite3 data/hyper-ledger.db "DELETE FROM users WHERE email='...';"  # cleanup
```

The live SQLite DB is at `./data/hyper-ledger.db` (host) → `/app/data/hyper-ledger.db` (container).
