from typing import List
from datetime import date
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import CurrencyRate, User
from app.schemas import CurrencyCreate, CurrencyUpdate, CurrencyOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/currencies", tags=["currencies"])


# Default currencies — mirror the frontend FX dictionary (data.js).
# (code, to_try, to_usd, source)  ·  TRY is the base (to_try = 1, no source/date).
DEFAULT_CURRENCIES = [
    ("TRY", 1.0,      1 / 46.2765, None),
    ("USD", 46.2765,  1.0,         "TCMB"),
    ("EUR", 53.7123,  1.1607,      "TCMB"),
]


def seed_default_currencies(db: Session) -> None:
    """Populate the shared currency_rates table on first run if it is empty."""
    if db.query(CurrencyRate).first():
        return
    today = date.today()
    for code, to_try, to_usd, source in DEFAULT_CURRENCIES:
        is_base = code == "TRY"
        as_of = None if is_base else today
        history = [] if is_base else [
            {"date": today.isoformat(), "toTRY": to_try, "toUSD": to_usd,
             "source": source, "note": "Initial rate"}
        ]
        db.add(CurrencyRate(
            code=code, to_try=to_try, to_usd=to_usd, as_of=as_of,
            source=source, history=history, is_default=True,
        ))
    db.commit()


@router.get("/", response_model=List[CurrencyOut])
def list_currencies(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(CurrencyRate).order_by(CurrencyRate.id).all()


@router.post("/", response_model=CurrencyOut, status_code=201)
def create_currency(
    payload: CurrencyCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    code = (payload.code or "").strip().upper()
    if not code:
        raise HTTPException(400, "Para birimi kodu gerekli")
    if db.query(CurrencyRate).filter(CurrencyRate.code == code).first():
        raise HTTPException(400, f"Para birimi zaten mevcut: {code}")
    cur = CurrencyRate(
        code=code,
        to_try=payload.to_try,
        to_usd=payload.to_usd,
        as_of=payload.as_of,
        source=payload.source,
        history=payload.history or [],
        is_default=False,
    )
    db.add(cur)
    db.commit()
    db.refresh(cur)
    return cur


@router.patch("/{currency_id}", response_model=CurrencyOut)
def update_currency(
    currency_id: int,
    payload: CurrencyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    cur = db.query(CurrencyRate).filter(CurrencyRate.id == currency_id).first()
    if not cur:
        raise HTTPException(404, "Para birimi bulunamadı")
    data = payload.model_dump(exclude_none=True)
    if "code" in data:
        data["code"] = data["code"].strip().upper()
        clash = db.query(CurrencyRate).filter(
            CurrencyRate.code == data["code"], CurrencyRate.id != currency_id
        ).first()
        if clash:
            raise HTTPException(400, f"Para birimi zaten mevcut: {data['code']}")
    for field, value in data.items():
        setattr(cur, field, value)
    db.commit()
    db.refresh(cur)
    return cur


@router.delete("/{currency_id}", status_code=204)
def delete_currency(currency_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    cur = db.query(CurrencyRate).filter(CurrencyRate.id == currency_id).first()
    if not cur:
        raise HTTPException(404, "Para birimi bulunamadı")
    db.delete(cur)
    db.commit()
