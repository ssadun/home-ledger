# Home Ledger

A self-hosted **personal finance tracker** built for a multi-currency (TRY / USD / EUR)
household. It tracks income and expenses with automatic TCMB exchange-rate conversion,
imports statements from Turkish banks, and manages investments, budgets, accounts/cards,
recurring bills, and subscriptions. Designed to run on a Synology NAS behind a reverse
proxy via Docker.

> ⚠️ Personal project — the live database (`data/home-ledger.db`) and uploaded receipts
> are **git-ignored** and never committed.

---

## Features

- **Multi-currency** — every transaction stores its original amount plus computed `amount_try`
  and `amount_usd`, using the closest TCMB rate on or before the transaction date.
- **Automatic exchange rates** — fetched from the TCMB XML feed, lazily cached per day, with a
  weekend/holiday fallback to the previous trading day.
- **Bank statement import** — Garanti BBVA and ON Burgan (XLS / XLSX / CSV / PDF), plus a generic
  heuristic parser. Two-step flow: preview → review → confirm, with duplicate skipping.
- **Receipt OCR** — Tesseract (Turkish + English) extracts amount, date, and merchant from receipt
  images.
- **Budgets, recurring bills & subscriptions** — per-category limits and fixed/recurring charges.
- **Accounts & cards** — one unified account model (bank / credit / debit / cash / wallet / …).
- **Members** — multi-user household; each member is a full account that can log in by username or
  email.
- **JWT auth** — bcrypt-hashed passwords, bearer-token protected API.

---

## Tech stack

| Layer | Stack |
|---|---|
| Backend | Python · FastAPI · SQLAlchemy · SQLite · python-jose / passlib (JWT + bcrypt) |
| Parsing / OCR | pandas · openpyxl · xlrd · pdfplumber · pytesseract · Pillow |
| Frontend | Vanilla JS + React (UMD) + Babel-standalone (no build step), served by nginx |
| Infra | Docker · docker-compose |

---

## Getting started

### Run with Docker (recommended)

```bash
docker-compose up --build
```

| Service | URL |
|---|---|
| Frontend | <http://localhost:3236> |
| Backend API | <http://localhost:8100> |
| Interactive API docs (Swagger) | <http://localhost:8100/docs> |

The backend and frontend are **baked into their images** (only `./data` and `./uploads` are
mounted), so after changing source you must rebuild:

```bash
docker-compose up -d --build backend     # backend changes
docker-compose up -d --build frontend    # frontend changes
```

### Run the backend directly

```bash
cd backend
pip install -r ../requirements.txt
uvicorn app.main:app --reload --port 8000
```

---

## Configuration

| Variable | Default | Notes |
|---|---|---|
| `DATABASE_URL` | `sqlite:////app/data/home-ledger.db` | |
| `SECRET_KEY` | `change_this_in_production` | **Change in production** |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | `1440` | 24-hour JWT lifetime |

### Database

SQLite at `./data/home-ledger.db` (host) → `/app/data/home-ledger.db` (container).
There is **no Alembic migration flow** — `Base.metadata.create_all()` runs at startup. To add
columns, update `models.py` and either recreate the DB or run a manual `ALTER TABLE`.

---

## Architecture

```
backend/app/
  main.py        FastAPI app, CORS, router registration, table creation + seeding on startup
  config.py      Pydantic settings (.env / env vars)
  database.py    SQLAlchemy engine + get_db() dependency
  models.py      ORM models
  schemas.py     Pydantic request/response models
  routers/       HTTP layer — one file per resource, all prefixed /api/<resource>
  services/      Business logic (auth, tcmb, bank_import, ocr)

frontend/
  *.html         One file per page; lists its own <script> includes
  nav.jsx        Single source of truth for the sidebar
  <module>-data.js   Per-module API client (window.HL_<MODULE>_API)
  styles/*.css   Per-page stylesheets
  sw.js          Service worker (precache + stale-while-revalidate)
```

**Patterns**

- **Routers** own HTTP validation and the auth dependency; **services** own business logic.
- The frontend has **no build step** — each page includes plain `<script>` + Babel-standalone.
  `window.HL_AUTH.apiFetch(path, opts)` wraps fetch with the bearer token and 401 → login redirect.
- Each module has a `<module>-data.js` client exposing `list/create/update/remove` plus
  `fromApi` / `toApi` mappers.

---

## API overview

All routes except `/api/auth/register` and `/api/auth/login` require a bearer token.

| Group | Base path | Endpoints |
|---|---|---|
| Auth | `/api/auth` | `register`, `login`, `me` |
| Transactions | `/api/transactions` | CRUD, filters (year/month/type/category/payer), `ocr/upload` |
| Exchange rates | `/api/rates` | `today`, `refresh`, `history` |
| Investments | `/api/investments` | CRUD |
| Bank import | `/api/import` | `preview`, `confirm` |
| Categories | `/api/categories` | CRUD (+ seeded defaults) |
| Budgets | `/api/budgets` | CRUD (upsert per category) |
| Recurring | `/api/recurring` | CRUD (`?kind=bill\|subscription`) |
| Accounts | `/api/accounts` | CRUD (unified account model) |
| Members | `/api/members` | CRUD over the users table |

See <http://localhost:8100/docs> for the full, live schema.

---

## Supported bank import formats

| Bank | Formats | Column detection |
|---|---|---|
| Garanti BBVA | XLS / XLSX / CSV | Tarih · Açıklama · Borç · Alacak · Bakiye |
| ON Burgan | XLS / XLSX / CSV | Same structure, different column names |
| Generic | XLS / XLSX / CSV | Heuristic column detection |
| Any bank | PDF | pdfplumber (text PDFs) · PyMuPDF + Tesseract (scanned PDFs) |

---

## Module wiring status

Every frontend module is being wired from static mock data to the backend database, one module at
a time. Current state:

| Module | Status |
|---|---|
| Spending | ✅ |
| Categories | ✅ |
| Budgets | ✅ |
| Recurring | ✅ |
| Subscriptions | ✅ |
| Accounts / Cards | ✅ |
| Members | ✅ |
| Currencies | ⬜ |
| Import / Export | ⬜ |
| Dashboard + Reports | ⬜ (read-only aggregators — done last) |

---

## Releasing

`push.sh` bumps the in-app build number, commits, pushes to GitHub, and redeploys the frontend
container so the running app shows the new version:

```bash
./push.sh                       # bump build, commit, push, redeploy
./push.sh "feat: add report"    # custom commit message
./push.sh --no-deploy           # push only (skip the local docker rebuild)
```

Each push increments the version shown at the bottom of the sidebar (`v1.0.<build>`) and bumps the
service-worker cache version in lockstep, so clients always pick up fresh assets.

---

## License

Private project. All rights reserved.
