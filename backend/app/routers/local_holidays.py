from datetime import date
from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import LocalHoliday, User
from app.schemas import LocalHolidayCreate, LocalHolidayOut, LocalHolidayUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/local-holidays", tags=["local-holidays"])


DEFAULT_LOCAL_HOLIDAYS = [
    ("TR", "2026-01-01", "New Year's Day", False),
    ("TR", "2026-03-19", "Ramazan Bayrami Eve", True),
    ("TR", "2026-03-20", "Ramazan Bayrami", False),
    ("TR", "2026-03-21", "Ramazan Bayrami Holiday", False),
    ("TR", "2026-03-22", "Ramazan Bayrami Holiday", False),
    ("TR", "2026-04-23", "National Sovereignty and Children's Day", False),
    ("TR", "2026-05-01", "Labor and Solidarity Day", False),
    ("TR", "2026-05-19", "Commemoration of Ataturk, Youth and Sports Day", False),
    ("TR", "2026-05-26", "Kurban Bayrami Eve", True),
    ("TR", "2026-05-27", "Kurban Bayrami", False),
    ("TR", "2026-05-28", "Kurban Bayrami Holiday", False),
    ("TR", "2026-05-29", "Kurban Bayrami Holiday", False),
    ("TR", "2026-05-30", "Kurban Bayrami Holiday", False),
    ("TR", "2026-07-15", "Democracy and National Unity Day", False),
    ("TR", "2026-08-30", "Victory Day", False),
    ("TR", "2026-10-29", "Republic Day", False),
    ("TR", "2027-01-01", "New Year's Day", False),
    ("TR", "2027-03-08", "Ramazan Bayrami Eve", True),
    ("TR", "2027-03-09", "Ramazan Bayrami", False),
    ("TR", "2027-03-10", "Ramazan Bayrami Holiday", False),
    ("TR", "2027-03-11", "Ramazan Bayrami Holiday", False),
    ("TR", "2027-04-23", "National Sovereignty and Children's Day", False),
    ("TR", "2027-05-01", "Labor and Solidarity Day", False),
    ("TR", "2027-05-15", "Kurban Bayrami Eve", True),
    ("TR", "2027-05-16", "Kurban Bayrami", False),
    ("TR", "2027-05-17", "Kurban Bayrami Holiday", False),
    ("TR", "2027-05-18", "Kurban Bayrami Holiday", False),
    ("TR", "2027-05-19", "Kurban Bayrami Holiday / Commemoration of Ataturk, Youth and Sports Day", False),
    ("TR", "2027-07-15", "Democracy and National Unity Day", False),
    ("TR", "2027-08-30", "Victory Day", False),
    ("TR", "2027-10-29", "Republic Day", False),
    ("TR", "2028-01-01", "New Year's Day", False),
    ("TR", "2028-02-26", "Ramazan Bayrami Eve", True),
    ("TR", "2028-02-27", "Ramazan Bayrami", False),
    ("TR", "2028-02-28", "Ramazan Bayrami Holiday", False),
    ("TR", "2028-02-29", "Ramazan Bayrami Holiday", False),
    ("TR", "2028-04-23", "National Sovereignty and Children's Day", False),
    ("TR", "2028-05-01", "Labor and Solidarity Day", False),
    ("TR", "2028-05-04", "Kurban Bayrami Eve", True),
    ("TR", "2028-05-05", "Kurban Bayrami", False),
    ("TR", "2028-05-06", "Kurban Bayrami Holiday", False),
    ("TR", "2028-05-07", "Kurban Bayrami Holiday", False),
    ("TR", "2028-05-08", "Kurban Bayrami Holiday", False),
    ("TR", "2028-05-19", "Commemoration of Ataturk, Youth and Sports Day", False),
    ("TR", "2028-07-15", "Democracy and National Unity Day", False),
    ("TR", "2028-08-30", "Victory Day", False),
    ("TR", "2028-10-29", "Republic Day", False),
]


def seed_default_local_holidays(db: Session) -> None:
    """Seed/backfill the editable local holiday calendar."""
    existing = {
        (row.country, row.date, row.name)
        for row in db.query(LocalHoliday.country, LocalHoliday.date, LocalHoliday.name).all()
    }
    changed = False
    for country, ymd, name, is_half_day in DEFAULT_LOCAL_HOLIDAYS:
        day = date.fromisoformat(ymd)
        if (country, day, name) in existing:
            continue
        db.add(LocalHoliday(
            country=country,
            date=day,
            name=name,
            is_half_day=is_half_day,
            affects_due_dates=True,
            is_active=True,
        ))
        changed = True
    if changed:
        db.commit()


@router.get("/", response_model=List[LocalHolidayOut])
def list_local_holidays(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(LocalHoliday).order_by(LocalHoliday.date, LocalHoliday.id).all()


@router.post("/", response_model=LocalHolidayOut, status_code=201)
def create_local_holiday(
    payload: LocalHolidayCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = LocalHoliday(
        country=(payload.country or "TR").strip().upper(),
        date=payload.date,
        name=payload.name.strip(),
        is_half_day=payload.is_half_day,
        affects_due_dates=payload.affects_due_dates,
        is_active=payload.is_active,
    )
    if not row.name:
        raise HTTPException(400, "Tatil adı gerekli")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{holiday_id}", response_model=LocalHolidayOut)
def update_local_holiday(
    holiday_id: int,
    payload: LocalHolidayUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(LocalHoliday).filter(LocalHoliday.id == holiday_id).first()
    if not row:
        raise HTTPException(404, "Tatil kaydı bulunamadı")
    data = payload.model_dump(exclude_none=True)
    if "country" in data:
        data["country"] = (data["country"] or "TR").strip().upper()
    if "name" in data:
        data["name"] = data["name"].strip()
        if not data["name"]:
            raise HTTPException(400, "Tatil adı gerekli")
    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{holiday_id}", status_code=204)
def delete_local_holiday(holiday_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(LocalHoliday).filter(LocalHoliday.id == holiday_id).first()
    if not row:
        raise HTTPException(404, "Tatil kaydı bulunamadı")
    db.delete(row)
    db.commit()
