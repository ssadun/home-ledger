from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Budget, User
from app.schemas import BudgetCreate, BudgetUpdate, BudgetOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/budgets", tags=["budgets"])


@router.get("/", response_model=List[BudgetOut])
def list_budgets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Budget).filter(Budget.owner_id == current_user.id).order_by(Budget.id).all()


@router.post("/", response_model=BudgetOut, status_code=201)
def create_budget(
    payload: BudgetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    bgt = Budget(**payload.model_dump(), owner_id=current_user.id)
    db.add(bgt)
    db.commit()
    db.refresh(bgt)
    return bgt


@router.patch("/{bgt_id}", response_model=BudgetOut)
def update_budget(
    bgt_id: int,
    payload: BudgetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    bgt = db.query(Budget).filter(Budget.id == bgt_id, Budget.owner_id == current_user.id).first()
    if not bgt:
        raise HTTPException(404, "Bütçe bulunamadı")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(bgt, field, value)
    db.commit()
    db.refresh(bgt)
    return bgt


@router.delete("/{bgt_id}", status_code=204)
def delete_budget(bgt_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    bgt = db.query(Budget).filter(Budget.id == bgt_id, Budget.owner_id == current_user.id).first()
    if not bgt:
        raise HTTPException(404, "Bütçe bulunamadı")
    db.delete(bgt)
    db.commit()
