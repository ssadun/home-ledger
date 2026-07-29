from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Asset, Investment, InvestmentHolding, User
from app.schemas import InvestmentHoldingCreate, InvestmentHoldingOut, InvestmentHoldingUpdate
from app.services.assets import record_asset_valuation_from_holdings
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/holdings", tags=["holdings"])


def _owned_asset(db: Session, asset_id: int, owner_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.owner_id == owner_id).first()
    if not asset:
        raise HTTPException(400, "Asset not found")
    return asset


def _owned_holding(db: Session, holding_id: int, owner_id: int) -> InvestmentHolding:
    row = db.query(InvestmentHolding).filter(InvestmentHolding.id == holding_id, InvestmentHolding.owner_id == owner_id).first()
    if not row:
        raise HTTPException(404, "Holding not found")
    return row


def _asset_for_account(db: Session, account_id: int, owner_id: int) -> Asset | None:
    acc = db.query(Account).filter(Account.id == account_id, Account.owner_id == owner_id).first()
    if not acc:
        raise HTTPException(400, "Account not found")
    return db.query(Asset).filter(Asset.owner_id == owner_id, Asset.account_id == acc.id).first()


@router.get("/", response_model=List[InvestmentHoldingOut])
def list_holdings(
    asset_id: Optional[int] = Query(None),
    account_id: Optional[int] = Query(None),
    legacy_platform: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(InvestmentHolding).filter(InvestmentHolding.owner_id == current_user.id)
    if asset_id is not None:
        _owned_asset(db, asset_id, current_user.id)
        q = q.filter(InvestmentHolding.asset_id == asset_id)
    if account_id is not None:
        asset = _asset_for_account(db, account_id, current_user.id)
        if not asset:
            return []
        q = q.filter(InvestmentHolding.asset_id == asset.id)
    if legacy_platform:
        key = legacy_platform.strip().lower()
        asset = (
            db.query(Asset)
            .filter(Asset.owner_id == current_user.id, func.lower(Asset.name) == key)
            .first()
        )
        if not asset:
            return []
        q = q.filter(InvestmentHolding.asset_id == asset.id)
    return q.order_by(InvestmentHolding.name).all()


@router.post("/", response_model=InvestmentHoldingOut, status_code=201)
def create_holding(payload: InvestmentHoldingCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_asset(db, payload.asset_id, current_user.id)
    if payload.legacy_investment_id is not None:
        inv = db.query(Investment).filter(Investment.id == payload.legacy_investment_id, Investment.owner_id == current_user.id).first()
        if not inv:
            raise HTTPException(400, "Legacy investment not found")
    row = InvestmentHolding(**payload.model_dump(), owner_id=current_user.id)
    db.add(row)
    db.flush()
    record_asset_valuation_from_holdings(db, db.query(Asset).filter(Asset.id == row.asset_id).first())
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{holding_id}", response_model=InvestmentHoldingOut)
def update_holding(holding_id: int, payload: InvestmentHoldingUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned_holding(db, holding_id, current_user.id)
    old_asset_id = row.asset_id
    data = payload.model_dump(exclude_unset=True)
    if "asset_id" in data:
        _owned_asset(db, data["asset_id"], current_user.id)
    if "legacy_investment_id" in data and data["legacy_investment_id"] is not None:
        inv = db.query(Investment).filter(Investment.id == data["legacy_investment_id"], Investment.owner_id == current_user.id).first()
        if not inv:
            raise HTTPException(400, "Legacy investment not found")
    for field, value in data.items():
        setattr(row, field, value)
    db.flush()
    for aid in {old_asset_id, row.asset_id}:
        asset = db.query(Asset).filter(Asset.id == aid, Asset.owner_id == current_user.id).first()
        if asset:
            record_asset_valuation_from_holdings(db, asset)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{holding_id}", status_code=204)
def delete_holding(holding_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = _owned_holding(db, holding_id, current_user.id)
    asset_id = row.asset_id
    db.delete(row)
    db.flush()
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.owner_id == current_user.id).first()
    if asset:
        record_asset_valuation_from_holdings(db, asset)
    db.commit()
