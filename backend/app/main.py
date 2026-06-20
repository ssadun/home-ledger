from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pathlib import Path
from app.database import engine, SessionLocal
from app.models import Base
from app.routers import auth, transactions, rates, investments, bank_import, categories, budgets, recurring, accounts, members, currencies

# SQLite dosyasının yaşadığı klasörü garantile
Path("/app/data").mkdir(parents=True, exist_ok=True)
Path("/app/uploads").mkdir(parents=True, exist_ok=True)

# Tablolar yoksa oluştur (Alembic migration'a gerek kalmadan)
Base.metadata.create_all(bind=engine)

# Seed shared default categories + currencies on first run
from app.routers.categories import seed_default_categories
from app.routers.currencies import seed_default_currencies
_seed_db = SessionLocal()
try:
    seed_default_categories(_seed_db)
    seed_default_currencies(_seed_db)
finally:
    _seed_db.close()

app = FastAPI(
    title="Hyper Ledger API",
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


@app.get("/health")
def health():
    return {"status": "ok"}
