from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Asset, Liability, User
from app.schemas import NetWorthSummary
from app.services.assets import amount_to_try, latest_asset_valuation, latest_liability_balance
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/net-worth", tags=["net-worth"])


@router.get("/summary", response_model=NetWorthSummary)
def summary(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    assets_try = 0.0
    liabilities_try = 0.0
    missing_assets = 0
    missing_liabilities = 0
    by_currency = {}

    assets = db.query(Asset).filter(
        Asset.owner_id == current_user.id,
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
        by_currency.setdefault(cur, {"assets": 0.0, "liabilities": 0.0})
        by_currency[cur]["assets"] += round(value, 2)

    liabilities = db.query(Liability).filter(
        Liability.owner_id == current_user.id,
        Liability.is_active == True,
        Liability.include_in_net_worth == True,
    ).all()
    for liab in liabilities:
        bal = latest_liability_balance(db, liab.id)
        if not bal:
            missing_liabilities += 1
            continue
        balance = float(bal.balance or 0)
        balance_try = amount_to_try(db, balance, bal.currency, bal.balanced_at, bal.balance_try)
        liabilities_try += balance_try
        cur = str(getattr(bal.currency, "value", bal.currency))
        by_currency.setdefault(cur, {"assets": 0.0, "liabilities": 0.0})
        by_currency[cur]["liabilities"] += round(balance, 2)

    return {
        "assets_try": round(assets_try, 2),
        "liabilities_try": round(liabilities_try, 2),
        "net_worth_try": round(assets_try - liabilities_try, 2),
        "assets_count": len(assets),
        "liabilities_count": len(liabilities),
        "missing_asset_valuations": missing_assets,
        "missing_liability_balances": missing_liabilities,
        "by_currency": by_currency,
    }
