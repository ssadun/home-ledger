from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from apscheduler.schedulers.background import BackgroundScheduler
from app.database import engine, SessionLocal
from app.models import Base
from app.routers import auth, transactions, rates, investments, bank_import, categories, budgets, recurring, accounts, members, currencies, credit_payments, statement_mappings, institutions, push
from app.services.notify import run_due_date_check

# SQLite dosyasının yaşadığı klasörü garantile
Path("/app/data").mkdir(parents=True, exist_ok=True)
Path("/app/uploads").mkdir(parents=True, exist_ok=True)

# Tablolar yoksa oluştur (Alembic migration'a gerek kalmadan)
Base.metadata.create_all(bind=engine)

# Seed shared default categories + currencies on first run
from app.routers.categories import seed_default_categories, ensure_category, ensure_unique_key_index
from app.routers.currencies import seed_default_currencies
from app.routers.statement_mappings import seed_default_statement_mappings, ensure_statement_mapping
from app.routers.institutions import (
    seed_default_institutions,
    ensure_institution,
    normalize_institution_names,
)
_seed_db = SessionLocal()
try:
    seed_default_categories(_seed_db)
    # Backfill categories added after the initial seed (idempotent on existing DBs).
    ensure_category(_seed_db, "credit-card-payment", "Credit Card Payment", "transfer", "credit-card", "var(--orange)")
    ensure_category(_seed_db, "debt", "Debt", "expense", "trending-down", "var(--red)")
    ensure_category(_seed_db, "commission", "Commission", "expense", "percent", "var(--coral)")
    ensure_category(_seed_db, "retirement", "Retirement", "expense", "piggy-bank", "var(--lime)")
    ensure_category(_seed_db, "insurance", "Insurance", "expense", "shield", "var(--steel)")
    # Enforce category.key uniqueness on existing DBs (create_all only does new tables).
    ensure_unique_key_index(_seed_db)
    seed_default_currencies(_seed_db)
    seed_default_statement_mappings(_seed_db)
    # Backfill mappings added after the initial seed (idempotent on existing DBs).
    ensure_statement_mapping(_seed_db, "tr", "Emeklilik / Sigorta", "insurance")
    seed_default_institutions(_seed_db)
    # Backfill institutions added after the initial seed (idempotent).
    ensure_institution(_seed_db, "garantiemek", "Garanti BBVA Emeklilik")
    ensure_institution(_seed_db, "teb", "TEB Türk Ekonomi Bankası", "TEBUTRIS")
    # Heal institution names padded with whitespace, which break the name-based
    # match from accounts.institution and duplicate the entry in the picker.
    normalize_institution_names(_seed_db)
finally:
    _seed_db.close()

app = FastAPI(
    title="Home Ledger API",
    description="Personal finance tracker",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Synology reverse proxy arkasında çalışacak
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(transactions.router)
app.include_router(rates.router)
app.include_router(investments.router)
app.include_router(bank_import.router)
app.include_router(categories.router)
app.include_router(budgets.router)
app.include_router(recurring.router)
app.include_router(accounts.router)
app.include_router(members.router)
app.include_router(currencies.router)
app.include_router(credit_payments.router)
app.include_router(statement_mappings.router)
app.include_router(institutions.router)
app.include_router(push.router)

scheduler = BackgroundScheduler()


def _run_daily_due_date_check():
    db = SessionLocal()
    try:
        run_due_date_check(db)
    finally:
        db.close()


@app.on_event("startup")
def start_scheduler():
    scheduler.add_job(_run_daily_due_date_check, "cron", hour=8, minute=0, id="due_date_check", replace_existing=True)
    scheduler.start()


@app.on_event("shutdown")
def stop_scheduler():
    scheduler.shutdown(wait=False)


@app.get("/health")
def health():
    return {"status": "ok"}
