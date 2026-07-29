from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
import asyncio
from apscheduler.schedulers.background import BackgroundScheduler
from app.database import engine, SessionLocal
from app.models import Base
from app.routers import auth, transactions, rates, investments, bank_import, categories, budgets, recurring, accounts, members, currencies, credit_payments, statements, statement_mappings, institutions, local_holidays, push, assets, holdings, net_worth, ui_logs
from app.services.notify import run_due_date_check
from app.services.tcmb import refresh_currency_rates_from_previous_tcmb

# SQLite dosyasının yaşadığı klasörü garantile
Path("/app/data").mkdir(parents=True, exist_ok=True)
Path("/app/uploads").mkdir(parents=True, exist_ok=True)

# Tablolar yoksa oluştur (Alembic migration'a gerek kalmadan)
Base.metadata.create_all(bind=engine)

# Seed shared default categories + currencies on first run
from app.routers.categories import seed_default_categories, ensure_category, ensure_unique_key_index, ensure_show_in_recurring_column
from app.routers.currencies import seed_default_currencies
from app.routers.statement_mappings import seed_default_statement_mappings, ensure_statement_mapping
from app.routers.local_holidays import seed_default_local_holidays
from app.routers.institutions import (
    seed_default_institutions,
    ensure_institution,
    ensure_short_name_column,
    normalize_institution_names,
)
from app.services.assets import backfill_asset_domain
_seed_db = SessionLocal()
try:
    accounts.ensure_account_bank_columns(_seed_db)
    ensure_show_in_recurring_column(_seed_db)
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
    seed_default_local_holidays(_seed_db)
    # Backfill mappings added after the initial seed (idempotent on existing DBs).
    ensure_statement_mapping(_seed_db, "tr", "Emeklilik / Sigorta", "insurance")
    ensure_short_name_column(_seed_db)
    seed_default_institutions(_seed_db)
    # Backfill institutions added after the initial seed (idempotent).
    ensure_institution(_seed_db, "garantiemek", "Garanti BBVA Emeklilik", short_name="Garanti Emek")
    ensure_institution(_seed_db, "teb", "TEB Türk Ekonomi Bankası", "TEBUTRIS", short_name="TEB")
    # Heal institution names padded with whitespace, which break the name-based
    # match from accounts.institution and duplicate the entry in the picker.
    normalize_institution_names(_seed_db)
    backfill_asset_domain(_seed_db)
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
app.include_router(statements.router)
app.include_router(statement_mappings.router)
app.include_router(institutions.router)
app.include_router(local_holidays.router)
app.include_router(push.router)
app.include_router(assets.router)
app.include_router(holdings.router)
app.include_router(net_worth.router)
app.include_router(ui_logs.router)

scheduler = BackgroundScheduler()


def _run_daily_due_date_check():
    db = SessionLocal()
    try:
        run_due_date_check(db)
    finally:
        db.close()


def _refresh_previous_tcmb_currency_rates():
    db = SessionLocal()
    try:
        asyncio.run(refresh_currency_rates_from_previous_tcmb(db))
    finally:
        db.close()


@app.on_event("startup")
async def start_scheduler():
    db = SessionLocal()
    try:
        await refresh_currency_rates_from_previous_tcmb(db)
    finally:
        db.close()
    scheduler.add_job(_run_daily_due_date_check, "cron", hour=8, minute=0, id="due_date_check", replace_existing=True)
    scheduler.add_job(_refresh_previous_tcmb_currency_rates, "cron", hour=8, minute=10, id="previous_tcmb_currency_rates", replace_existing=True)
    scheduler.start()


@app.on_event("shutdown")
def stop_scheduler():
    scheduler.shutdown(wait=False)


@app.get("/health")
def health():
    return {"status": "ok"}
