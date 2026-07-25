from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Asset, Liability, LiabilityBalance, User
from app.schemas import LiabilityBalanceCreate, LiabilityBalanceOut, LiabilityCreate, LiabilityOut, LiabilityUpdate, LiabilityWithLatest
from app.services.assets import amount_to_try, latest_liability_balance, rate_to_try
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/liabilities", tags=["liabilities"])


def _owned_liability(db: Session, liability_id: int, owner_id: int) -> Liability:
    row = db.query(Liability).filter(Liability.id == liability_id, Liability.owner_id == owner_id).first()
    if not row:
        raise HTTPException(404, "Liability not found")
    return row


def _validate_links(db: Session, account_id: int | None, asset_id: int | None, owner_id: int) -> None:
    if account_id is not None and not db.query(Account).filter(Account.id == account_id, Account.owner_id == owner_id).first():
        raise HTTPException(400, "Linked account not found")
    if asset_id is not None and not db.query(Asset).filter(Asset.id == asset_id, Asset.owner_id == owner_id).first():
        raise HTTPException(400, "Secured asset not found")


def _with_latest(db: Session, row: Liability) -> Liability:
    row.latest_balance = latest_liability_balance(db, row.id)
    return row


@router.get("/", response_model=List[LiabilityWithLatest])
def list_liabilities(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Liability).filter(Liability.owner_id == current_user.id).order_by(Liability.name).all()
    return [_with_latest(db, row) for row in rows]


@router.post("/", response_model=LiabilityOut, status_code=201)
def create_liability(payload: LiabilityCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _validate_links(db, payload.account_id, payload.secured_asset_id, current_user.id)
    row = Liability(**payload.model_dump(), owner_id=current_user.id)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{liability_id}", response_model=LiabilityOut)
def update_liability(liability_id: int, payload: LiabilityUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned_liability(db, liability_id, current_user.id)
    data = payload.model_dump(exclude_unset=True)
    _validate_links(db, data.get("account_id"), data.get("secured_asset_id"), current_user.id)
    for field, value in data.items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{liability_id}", status_code=204)
def delete_liability(liability_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned_liability(db, liability_id, current_user.id)
    db.query(LiabilityBalance).filter(LiabilityBalance.liability_id == row.id).delete(synchronize_session=False)
    db.delete(row)
    db.commit()


@router.get("/{liability_id}/balances", response_model=List[LiabilityBalanceOut])
def list_balances(liability_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_liability(db, liability_id, current_user.id)
    return (
        db.query(LiabilityBalance)
        .filter(LiabilityBalance.liability_id == liability_id)
        .order_by(LiabilityBalance.balanced_at.desc(), LiabilityBalance.id.desc())
        .all()
    )


@router.post("/{liability_id}/balances", response_model=LiabilityBalanceOut, status_code=201)
def create_balance(liability_id: int, payload: LiabilityBalanceCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_liability(db, liability_id, current_user.id)
    data = payload.model_dump()
    if data.get("exchange_rate_to_try") is None:
        data["exchange_rate_to_try"] = rate_to_try(db, data["currency"], data["balanced_at"])
    if data.get("balance_try") is None:
        data["balance_try"] = amount_to_try(db, data["balance"], data["currency"], data["balanced_at"])
    row = LiabilityBalance(liability_id=liability_id, **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
