# Home Ledger

A self-hosted personal finance tracker for a multi-currency household. Home Ledger
tracks income and expenses in TRY, USD, and EUR; converts transactions with TCMB
rates; imports Turkish bank and card statements; manages accounts, cards,
budgets, recurring bills, subscriptions, investments, and BES retirement plans;
and sends optional browser push reminders.

Designed to run on a Synology NAS behind a reverse proxy with Docker.

> Personal project: the live SQLite database (`data/home-ledger.db`) and uploaded
> files in `uploads/` are git-ignored and must not be committed.

---

## Features

- Multi-currency transactions with stored original amount, TRY equivalent, USD
  equivalent, and exchange rate at save time.
- TCMB exchange-rate fetching with lazy per-day caching and previous trading-day
  fallback for weekends and holidays.
- Bank and credit-card statement import with preview, review, duplicate skipping,
  account matching, statement archives, and original file download.
- Supported import domains include Garanti BBVA, ON Burgan, credit-card
  statements, BES pension statements, and generic XLS/XLSX/CSV/PDF parsing.
- Receipt OCR with Tesseract (`tur+eng`) for amount, date, and merchant extraction.
- Unified account model for bank, overdraft, credit, debit, prepaid, wallet, cash,
  investment, and pension accounts.
- Credit payments, account activity, statements, recurring bills, subscriptions,
  budgets, categories, currencies, financial institutions, and statement value
  mapping screens.
- Household members with username or email login, role/active controls, and
  payer/payment visibility preferences.
- Profile page for self-service name, email, username, password, avatar, theme,
  and stored language preference.
- Web Push reminders for recurring bills and card payments, including per-item
  snooze actions.
- No frontend build step: React UMD + Babel-standalone pages served directly by
  nginx or the local dev server.

---

## Tech Stack

| Layer | Stack |
|---|---|
| Backend | Python, FastAPI, SQLAlchemy, SQLite, Pydantic |
| Auth | JWT via `python-jose`, bcrypt via `passlib` |
| Scheduling / push | APScheduler, Web Push / VAPID via `pywebpush` |
| Parsing / OCR | pandas, openpyxl, xlrd, pdfplumber, pytesseract, Pillow |
| Frontend | Vanilla JS, React UMD, Babel-standalone, static HTML/CSS |
| Infra | Docker, docker-compose, nginx |
| Tests | pytest backend fixtures, Playwright dependency for browser checks |

---

## Run

### Docker

```bash
docker-compose up --build
```

| Service | URL |
|---|---|
| Frontend | <http://localhost:3236> |
| Backend API | <http://localhost:8100> |
| Swagger UI | <http://localhost:8100/docs> |

The frontend container live-mounts `./frontend` into nginx, so normal frontend
file edits show up after a browser refresh. Rebuild `home-ledger-web` only after
changing frontend container files such as `nginx.conf` or the frontend
`Dockerfile`.

Backend source changes still require rebuilding or running the backend directly.

### Backend Directly

```bash
cd backend
pip install -r ../requirements.txt
uvicorn app.main:app --reload --port 8000
```

### Frontend Dev Server

Use the Python dev server when you want live frontend files, no browser caching,
and `/api/*` proxied to the backend at `http://localhost:8100`.

```bash
python3 dev-server.py
```

Default URL: <http://localhost:8088>

Optional environment variables:

```bash
PORT=8090 BACKEND=http://localhost:8100 python3 dev-server.py
```

---

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:////app/data/home-ledger.db` | SQLite database URL |
| `SECRET_KEY` | `change_this_in_production_please` | Change in production |
| `ALGORITHM` | `HS256` | JWT signing algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | 24-hour JWT lifetime |
| `VAPID_PUBLIC_KEY` | empty / env-provided | Public Web Push key |
| `VAPID_PRIVATE_KEY` | empty / env-provided | Private Web Push key; never commit it |
| `VAPID_CLAIMS_EMAIL` | `sadunsevingen@gmail.com` | Contact email in VAPID claims |

Generate a VAPID keypair once for push notifications and set it through the NAS
deployment environment or a local gitignored `.env` file.

```bash
openssl ecparam -name prime256v1 -genkey -noout -out vapid_priv.pem
openssl ec -in vapid_priv.pem -text -noout
```

---

## Database

SQLite lives at `./data/home-ledger.db` on the host and is mounted to
`/app/data/home-ledger.db` in the backend container.

There is no active Alembic migration workflow. `Base.metadata.create_all()` runs
at startup and creates missing tables, but new columns on existing tables require
manual `ALTER TABLE` statements or a database rebuild.

Current ORM-backed tables:

| Table | Purpose |
|---|---|
| `users` | Login users and household members |
| `transactions` | Income and expense rows |
| `categories` | Shared category definitions |
| `accounts` | Accounts, cards, wallets, cash, investments, pensions |
| `investments` | Holdings |
| `budgets` | Budget limits |
| `recurring_expenses` | Bills and subscriptions |
| `exchange_rates` | TCMB day-keyed rates |
| `currency_rates` | Currency configuration and history |
| `credit_payments` | Credit-card statement/payment records |
| `statements` | Bank-account statement archive records |
| `statement_mappings` | Bank tag to category mappings |
| `push_subscriptions` | Browser push subscriptions |
| `reminder_snoozes` | Per-item reminder snoozes |
| `financial_institutions` | Banks/providers and logos |

---

## Architecture

```text
backend/app/
  main.py        FastAPI app, CORS, router registration, startup seeding, scheduler
  config.py      Pydantic settings
  database.py    SQLAlchemy engine and session dependency
  models.py      ORM models
  schemas.py     Request/response schemas
  routers/       HTTP layer, one module per /api group
  services/      Business logic: auth, TCMB, import, OCR, notifications, recurrence

frontend/
  *.html                 One page per screen
  nav.jsx                Single source of truth for sidebar navigation and app version
  *-app.jsx              Page controllers
  *-data.js              Per-module API clients and mappers
  styles/*.css           Global and page-level styles
  sw.js                  Service worker for Web Push only; no fetch caching
  theme.js               Root light/dark theme state
```

Patterns:

- Routers handle HTTP validation and authentication dependencies.
- Services hold business logic that should stay independent of FastAPI request
  handling.
- Frontend pages include their scripts directly and use
  `window.HL_AUTH.apiFetch(path, opts)` for authenticated API calls and 401
  redirects.
- The sidebar, top-right profile entry, persistent grid/list view selection, and
  displayed version are centralized in `frontend/nav.jsx`.

Current displayed app version: `v1.0.5`.

---

## API Overview

All routes require a bearer token except `/api/auth/register`, `/api/auth/login`,
public avatar lookup by token, `/api/push/vapid-public-key`, and
`/api/push/snooze`.

| Group | Base path | Highlights |
|---|---|---|
| Auth | `/api/auth` | Register, login, profile, password, avatar |
| Transactions | `/api/transactions` | CRUD, filters, receipt OCR upload |
| Rates | `/api/rates` | Today, refresh, history |
| Currencies | `/api/currencies` | Currency config CRUD |
| Investments | `/api/investments` | Holdings CRUD |
| Import | `/api/import` | Preview, confirm, investments, pension confirm |
| Categories | `/api/categories` | Category CRUD and seeded defaults |
| Budgets | `/api/budgets` | Budget CRUD |
| Recurring | `/api/recurring` | Bills/subscriptions CRUD via `kind` |
| Accounts | `/api/accounts` | Account CRUD, related preview, cascade delete, orphan cleanup |
| Credit payments | `/api/credit-payments` | Card statement records, upload preview/confirm/download |
| Statements | `/api/statements` | Bank statement records, upload/download |
| Statement mappings | `/api/statement-mappings` | Statement tag to category mapping CRUD |
| Local holidays | `/api/local-holidays` | Editable non-working dates for recurring due-date calculation |
| Institutions | `/api/institutions` | Bank/provider metadata and logos |
| Members | `/api/members` | Admin-managed household users |
| Push | `/api/push` | Subscribe, preferences, tests, snooze, manual due-date check |

Use <http://localhost:8100/docs> for the full live schema.

---

## Frontend Screens

Top-level navigation:

- Dashboard
- Transactions: Spending, Card Payments, Subscriptions, Recurring
- Accounts: Accounts, Account Activity, Statements
- Budgets
- Configuration: Members, Categories, Currencies, Card Types, Account Types,
  Financial Institutions, Statement Value Mapping, Local Holidays,
  Notifications, Backup & Export
- Profile, available from the top-right profile button

---

## Import Support

| Source | Formats | Notes |
|---|---|---|
| Garanti BBVA bank statements | XLS, XLSX, CSV, PDF | Recognizes Turkish columns and tags |
| ON Burgan bank statements | XLS, XLSX, CSV | Handles ON-specific column naming |
| Credit-card statements | PDF and supported spreadsheet formats | Creates `credit_payments` and links spendings by card/window |
| BES pension statements | PDF | Updates pension account JSON and fund holdings |
| Generic statements | XLS, XLSX, CSV, text PDF | Heuristic date/description/amount detection |
| Scanned PDFs/images | PDF/image input where supported | OCR fallback through Tesseract where dependencies are available |

Statement value mappings are editable from Configuration -> Statement Value
Mapping, so bank-provided labels can be routed to category keys without changing
the importer code.

---

## Tests

Backend parser fixtures live in `backend/tests/`. They parse real sample
statements from `import/` and lock in row counts, totals, account identity, and
classification behavior.

Run them in a throwaway container based on the backend image:

```bash
docker run --rm --network nas \
  -v /volume1/docker/resolv.conf:/etc/resolv.conf:ro \
  -v "$PWD":/src -w /src home-ledger-backend:latest \
  sh -c "pip install -q -r requirements-dev.txt && python -m pytest backend/tests"
```

The fixtures are golden. If parser behavior intentionally changes, update the
expected fixture values in the same change.

---

## Releasing

Commit and push with plain git. The sidebar version is read from `APP_BUILD` in
`frontend/nav.jsx`.

```js
const APP_BUILD = 5; // build:auto
```

Bump that value manually when the displayed version should change.

The service worker deliberately has no `fetch` listener, so it does not cache app
assets. It only handles Web Push notifications and notification clicks.

---

## License

Private project. All rights reserved.
