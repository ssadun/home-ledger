from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import ExchangeRate, User
from app.schemas import ExchangeRateOut
from app.services.auth import get_current_user
from app.services.tcmb import upsert_today_rate, fetch_tcmb_rates
from typing import List

router = APIRouter(prefix="/api/rates", tags=["rates"])


@router.get("/today", response_model=ExchangeRateOut)
async def today_rate(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rate = await upsert_today_rate(db)
    return rate


@router.post("/refresh", response_model=ExchangeRateOut)
async def refresh_rate(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """TCMB'den zorla yenile."""
    today = date.today()
    existing = db.query(ExchangeRate).filter(ExchangeRate.date == today).first()
    if existing:
        db.delete(existing)
        db.commit()
    rate = await upsert_today_rate(db)
    return rate


@router.get("/history", response_model=List[ExchangeRateOut])
def rate_history(
    limit: int = 90,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    return db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).limit(limit).all()
