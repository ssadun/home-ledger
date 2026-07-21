---
name: db-column-migration
description: Diff backend/app/models.py against the live SQLite schema and emit the exact ALTER TABLE statement(s) needed, plus the matching CLAUDE.md doc line. User-invoked only — use after adding/changing a column in models.py.
disable-model-invocation: true
---

# DB Column Migration

This project has **no Alembic** — `Base.metadata.create_all()` only creates missing *tables*, it
never adds columns to existing ones. Every new/changed column on an existing model needs a
hand-written `ALTER TABLE`, and CLAUDE.md keeps a running log of these under **Database** so a
production DB (which already exists and won't get `create_all()`'d fresh) can be brought up to
date. See the `notify_lead_days`, `show_as_payer`, and `show_in_payment_method` entries there for
precedent.

## Steps

1. **Find the live schema.** The dev DB is at `data/home-ledger.db` (SQLite):
   ```bash
   sqlite3 data/home-ledger.db ".schema <table>"
   ```
   or dump all tables: `sqlite3 data/home-ledger.db ".tables"`.

2. **Diff against `backend/app/models.py`.** For each SQLAlchemy `Column` in the model that has no
   matching column in the live `.schema` output, that's a pending migration. Pay attention to:
   - Column type (map SQLAlchemy → SQLite: `String`→`TEXT`, `Integer`→`INTEGER`,
     `Boolean`→`BOOLEAN`, `Float`→`REAL`, `DateTime`→`DATETIME`, `JSON`→`TEXT`)
   - `default=` on the model → `DEFAULT` in the `ALTER TABLE` (SQLite requires a constant default,
     not a callable — check the model isn't relying on a Python-side `default=` that can't be
     expressed in SQL; if so, note that new rows get it from the ORM but existing rows need a
     literal backfill value)
   - `nullable=False` — SQLite's `ALTER TABLE ADD COLUMN` cannot add a `NOT NULL` column without a
     `DEFAULT`; always include one for existing rows to satisfy

3. **Emit the exact statement(s)**, one per new column:
   ```sql
   ALTER TABLE <table> ADD COLUMN <column> <TYPE> DEFAULT <value>;
   ```
   If a whole new table was added instead (new model, no `ALTER TABLE` needed), say so explicitly —
   `create_all()` handles that case for free, don't emit a spurious statement.

4. **Do not run the statement against `data/home-ledger.db` yourself** unless the user explicitly
   asks — this is real household financial data. Present the statement(s) for the user to run
   (locally and/or on the NAS production DB) and let them confirm.

5. **Add a doc line to CLAUDE.md** in the same style as the existing three, appended to the
   "No Alembic" paragraph in the Database section:
   > Likewise the `<feature>` added `<table>.<column>`, needing:
   > `ALTER TABLE <table> ADD COLUMN <column> <TYPE> DEFAULT <value>;`

6. Remind the user this also needs to be run against the **production DB on the NAS** separately —
   the dev DB and NAS DB are different files and this skill only inspects/patches the one at
   `data/home-ledger.db` relative to the repo root.
