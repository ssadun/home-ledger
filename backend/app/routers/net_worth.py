from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Account, Asset, User
from app.schemas import NetWorthSummary
from app.services.assets import amount_to_try, latest_asset_valuation
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/net-worth", tags=["net-worth"])


@router.get("/summary", response_model=NetWorthSummary)
def summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    assets_try = 0.0
    missing_assets = 0
    by_currency = {}

    accounts = db.query(Account).filter(Account.owner_id == current_user.id).all()
    account_assets = 0
    for acc in accounts:
        value = float(acc.balance or 0)
        value_try = amount_to_try(db, value, acc.currency)
        if value_try <= 0:
            continue
        assets_try += value_try
        account_assets += 1
        cur = str(getattr(acc.currency, "value", acc.currency))
        by_currency.setdefault(cur, {"assets": 0.0})
        by_currency[cur]["assets"] += round(value, 2)

    assets = db.query(Asset).filter(
        Asset.owner_id == current_user.id,
        Asset.account_id.is_(None),
        Asset.type == "physical",
        Asset.is_active == True,
        Asset.include_in_net_worth == True,
    ).all()
    for asset in assets:
        val = latest_asset_valuation(db, asset.id)
        if not val:
            missing_assets += 1
            continue
        share = (asset.ownership_percentage or 100.0) / 100.0
        value = float(val.value or 0) * share
        value_try = amount_to_try(db, value, val.currency, val.valued_at, (val.value_try or 0) * share)
        assets_try += value_try
        cur = str(getattr(val.currency, "value", val.currency))
        by_currency.setdefault(cur, {"assets": 0.0})
        by_currency[cur]["assets"] += round(value, 2)

    return {
        "assets_try": round(assets_try, 2),
        "net_worth_try": round(assets_try, 2),
        "assets_count": account_assets + len(assets),
        "missing_asset_valuations": missing_assets,
        "by_currency": by_currency,
    }
