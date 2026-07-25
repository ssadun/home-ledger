from typing import List

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Asset, AssetValuation, InvestmentHolding, User
from app.schemas import AssetCreate, AssetOut, AssetUpdate, AssetValuationCreate, AssetValuationOut, AssetWithLatest
from app.services.assets import amount_to_try, latest_asset_valuation, rate_to_try, snapshot_asset_from_holdings
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/assets", tags=["assets"])


def _owned_asset(db: Session, asset_id: int, owner_id: int) -> Asset:
    asset = db.query(Asset).filter(Asset.id == asset_id, Asset.owner_id == owner_id).first()
    if not asset:
        raise HTTPException(404, "Asset not found")
    return asset


def _validate_account(db: Session, account_id: int | None, owner_id: int, exclude_asset_id: int | None = None) -> None:
    if account_id is None:
        return
    if not db.query(Account).filter(Account.id == account_id, Account.owner_id == owner_id).first():
        raise HTTPException(400, "Linked account not found")
    q = db.query(Asset).filter(Asset.owner_id == owner_id, Asset.account_id == account_id)
    if exclude_asset_id is not None:
        q = q.filter(Asset.id != exclude_asset_id)
    if q.first():
        raise HTTPException(409, "Linked account already has an asset")


def _with_latest(db: Session, asset: Asset) -> Asset:
    asset.latest_valuation = latest_asset_valuation(db, asset.id)
    return asset


@router.get("/", response_model=List[AssetWithLatest])
def list_assets(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = db.query(Asset).filter(Asset.owner_id == current_user.id).order_by(Asset.name).all()
    return [_with_latest(db, row) for row in rows]


@router.post("/", response_model=AssetOut, status_code=201)
def create_asset(payload: AssetCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _validate_account(db, payload.account_id, current_user.id)
    asset = Asset(**payload.model_dump(), owner_id=current_user.id)
    db.add(asset)
    db.commit()
    db.refresh(asset)
    return asset


@router.patch("/{asset_id}", response_model=AssetOut)
def update_asset(asset_id: int, payload: AssetUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = _owned_asset(db, asset_id, current_user.id)
    data = payload.model_dump(exclude_unset=True)
    if "account_id" in data:
        _validate_account(db, data.get("account_id"), current_user.id, exclude_asset_id=asset.id)
    for field, value in data.items():
        setattr(asset, field, value)
    db.commit()
    db.refresh(asset)
    return asset


@router.delete("/{asset_id}", status_code=204)
def delete_asset(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = _owned_asset(db, asset_id, current_user.id)
    db.query(InvestmentHolding).filter(InvestmentHolding.asset_id == asset.id, InvestmentHolding.owner_id == current_user.id).delete(synchronize_session=False)
    db.query(AssetValuation).filter(AssetValuation.asset_id == asset.id).delete(synchronize_session=False)
    db.delete(asset)
    db.commit()


@router.get("/{asset_id}/valuations", response_model=List[AssetValuationOut])
def list_valuations(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_asset(db, asset_id, current_user.id)
    return (
        db.query(AssetValuation)
        .filter(AssetValuation.asset_id == asset_id)
        .order_by(AssetValuation.valued_at.desc(), AssetValuation.id.desc())
        .all()
    )


@router.post("/{asset_id}/valuations", response_model=AssetValuationOut, status_code=201)
def create_valuation(asset_id: int, payload: AssetValuationCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    _owned_asset(db, asset_id, current_user.id)
    data = payload.model_dump()
    if data.get("exchange_rate_to_try") is None:
        data["exchange_rate_to_try"] = rate_to_try(db, data["currency"], data["valued_at"])
    if data.get("value_try") is None:
        data["value_try"] = amount_to_try(db, data["value"], data["currency"], data["valued_at"])
    row = AssetValuation(asset_id=asset_id, **data)
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.post("/{asset_id}/snapshot-holdings", response_model=AssetWithLatest)
def snapshot_holdings(asset_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    asset = _owned_asset(db, asset_id, current_user.id)
    snapshot_asset_from_holdings(db, asset)
    db.commit()
    return _with_latest(db, asset)
