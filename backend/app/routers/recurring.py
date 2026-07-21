from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import RecurringExpense, User
from app.schemas import RecurringCreate, RecurringUpdate, RecurringOut
from app.services.auth import get_current_user
from app.services.recurring import roll_forward_due_dates

router = APIRouter(prefix="/api/recurring", tags=["recurring"])


@router.get("/", response_model=List[RecurringOut])
def list_recurring(
    kind: Optional[str] = Query(None, description="Filter by kind: bill | subscription"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    roll_forward_due_dates(db, owner_id=current_user.id)
    q = db.query(RecurringExpense).filter(RecurringExpense.owner_id == current_user.id)
    if kind:
        q = q.filter(RecurringExpense.kind == kind)
    return q.order_by(RecurringExpense.id).all()


@router.post("/", response_model=RecurringOut, status_code=201)
def create_recurring(
    payload: RecurringCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = RecurringExpense(**payload.model_dump(), owner_id=current_user.id)
    rec.is_active = (payload.status == "active")
    db.add(rec)
    db.commit()
    db.refresh(rec)
    return rec


@router.patch("/{rec_id}", response_model=RecurringOut)
def update_recurring(
    rec_id: int,
    payload: RecurringUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = db.query(RecurringExpense).filter(
        RecurringExpense.id == rec_id, RecurringExpense.owner_id == current_user.id
    ).first()
    if not rec:
        raise HTTPException(404, "Tekrarlayan kayıt bulunamadı")
    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        setattr(rec, field, value)
    if "status" in data:
        rec.is_active = (data["status"] == "active")
    db.commit()
    db.refresh(rec)
    return rec


@router.delete("/{rec_id}", status_code=204)
def delete_recurring(rec_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = db.query(RecurringExpense).filter(
        RecurringExpense.id == rec_id, RecurringExpense.owner_id == current_user.id
    ).first()
    if not rec:
        raise HTTPException(404, "Tekrarlayan kayıt bulunamadı")
    db.delete(rec)
    db.commit()
