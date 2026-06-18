from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Investment, User
from app.schemas import InvestmentCreate, InvestmentOut, InvestmentUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/investments", tags=["investments"])


@router.get("/", response_model=List[InvestmentOut])
def list_investments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Investment).filter(Investment.owner_id == current_user.id).all()


@router.post("/", response_model=InvestmentOut, status_code=201)
def create_investment(payload: InvestmentCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = Investment(**payload.model_dump(), owner_id=current_user.id)
    db.add(inv)
    db.commit()
    db.refresh(inv)
    return inv


@router.patch("/{inv_id}", response_model=InvestmentOut)
def update_investment(inv_id: int, payload: InvestmentUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = db.query(Investment).filter(Investment.id == inv_id, Investment.owner_id == current_user.id).first()
    if not inv:
        raise HTTPException(404, "Yatırım bulunamadı")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(inv, field, value)
    db.commit()
    db.refresh(inv)
    return inv


@router.delete("/{inv_id}", status_code=204)
def delete_investment(inv_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    inv = db.query(Investment).filter(Investment.id == inv_id, Investment.owner_id == current_user.id).first()
    if not inv:
        raise HTTPException(404, "Yatırım bulunamadı")
    db.delete(inv)
    db.commit()
