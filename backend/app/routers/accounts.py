from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Account, User
from app.schemas import AccountCreate, AccountUpdate, AccountOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


@router.get("/", response_model=List[AccountOut])
def list_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Account).filter(Account.owner_id == current_user.id).order_by(Account.id).all()


@router.post("/", response_model=AccountOut, status_code=201)
def create_account(
    payload: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    acc = Account(**payload.model_dump(), owner_id=current_user.id)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    # Stable frontend key referenced by linked_key / transactions.payment_method.
    if not acc.account_key:
        acc.account_key = f"acc-{acc.id}"
        db.commit()
        db.refresh(acc)
    return acc


@router.patch("/{acc_id}", response_model=AccountOut)
def update_account(
    acc_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    acc = db.query(Account).filter(Account.id == acc_id, Account.owner_id == current_user.id).first()
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(acc, field, value)
    db.commit()
    db.refresh(acc)
    return acc


@router.delete("/{acc_id}", status_code=204)
def delete_account(acc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = db.query(Account).filter(Account.id == acc_id, Account.owner_id == current_user.id).first()
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    db.delete(acc)
    db.commit()
