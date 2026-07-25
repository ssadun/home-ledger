from datetime import date

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Asset,
    AssetValuation,
    CurrencyRate,
    ExchangeRate,
    Investment,
    InvestmentHolding,
    Liability,
    LiabilityBalance,
)


ASSET_ACCOUNT_TYPES = {"bank", "wallet", "cash", "invest", "pension"}
LIABILITY_ACCOUNT_TYPES = {"credit", "overdraft"}


def _code(value) -> str:
    return getattr(value, "value", value) or "TRY"


def rate_to_try(db: Session, currency, as_of: date | None = None) -> float:
    code = _code(currency)
    if code == "TRY":
        return 1.0
    row = db.query(CurrencyRate).filter(CurrencyRate.code == code).first()
    if row and row.to_try:
        return float(row.to_try)
    q = db.query(ExchangeRate)
    if as_of:
        q = q.filter(ExchangeRate.date <= as_of)
    er = q.order_by(ExchangeRate.date.desc()).first()
    if er:
        if code == "USD" and er.usd_try:
            return float(er.usd_try)
        if code == "EUR" and er.eur_try:
            return float(er.eur_try)
    return 1.0


def amount_to_try(db: Session, amount: float, currency, as_of: date | None = None, stored_try=None) -> float:
    if stored_try is not None:
        return round(float(stored_try), 2)
    return round(float(amount or 0) * rate_to_try(db, currency, as_of), 2)


def account_asset_type(acc: Account) -> str:
    return {
        "bank": "bank_account",
        "wallet": "cash",
        "cash": "cash",
        "invest": "investment",
        "pension": "retirement",
    }.get(acc.type or "", "other")


def account_valuation_mode(acc: Account) -> str:
    if acc.type in {"invest", "pension"}:
        return "holdings"
    if acc.type in {"bank", "wallet", "cash"}:
        return "account_balance"
    return "manual"


def liability_type_for_account(acc: Account) -> str:
    return "credit_card" if acc.type == "credit" else "overdraft"


def latest_asset_valuation(db: Session, asset_id: int):
    return (
        db.query(AssetValuation)
        .filter(AssetValuation.asset_id == asset_id)
        .order_by(AssetValuation.valued_at.desc(), AssetValuation.id.desc())
        .first()
    )


def latest_liability_balance(db: Session, liability_id: int):
    return (
        db.query(LiabilityBalance)
        .filter(LiabilityBalance.liability_id == liability_id)
        .order_by(LiabilityBalance.balanced_at.desc(), LiabilityBalance.id.desc())
        .first()
    )


def ensure_asset_for_account(db: Session, acc: Account) -> Asset | None:
    if (acc.type or "") not in ASSET_ACCOUNT_TYPES:
        return None
    asset = (
        db.query(Asset)
        .filter(Asset.owner_id == acc.owner_id, Asset.account_id == acc.id)
        .first()
    )
    if asset is None:
        asset = Asset(
            owner_id=acc.owner_id,
            account_id=acc.id,
            name=acc.name,
            type=account_asset_type(acc),
            currency=acc.currency,
            ownership_percentage=100.0,
            valuation_mode=account_valuation_mode(acc),
            include_in_net_worth=True,
            is_active=True,
        )
        db.add(asset)
        db.flush()
    asset.name = acc.name
    asset.type = account_asset_type(acc)
    asset.currency = acc.currency
    asset.institution = acc.institution
    asset.valuation_mode = account_valuation_mode(acc)
    asset.ownership_percentage = asset.ownership_percentage or 100.0
    asset.include_in_net_worth = True if asset.include_in_net_worth is None else asset.include_in_net_worth
    asset.is_active = True if asset.is_active is None else asset.is_active
    return asset


def ensure_asset_for_platform(db: Session, owner_id: int, platform: str | None) -> Asset:
    name = (platform or "Investments").strip() or "Investments"
    acc = (
        db.query(Account)
        .filter(Account.owner_id == owner_id, func.lower(Account.name) == name.lower())
        .first()
    )
    if acc and acc.type in ASSET_ACCOUNT_TYPES:
        asset = ensure_asset_for_account(db, acc)
        if asset:
            return asset
    asset = (
        db.query(Asset)
        .filter(
            Asset.owner_id == owner_id,
            Asset.account_id.is_(None),
            func.lower(Asset.name) == name.lower(),
            Asset.type == "investment",
        )
        .first()
    )
    if asset is None:
        asset = Asset(
            owner_id=owner_id,
            name=name,
            type="investment",
            currency="TRY",
            ownership_percentage=100.0,
            liquidity="short_term",
            valuation_mode="holdings",
            include_in_net_worth=True,
            is_active=True,
        )
        db.add(asset)
        db.flush()
    return asset


def snapshot_asset_from_account(db: Session, acc: Account, as_of: date | None = None) -> None:
    asset = ensure_asset_for_account(db, acc)
    if not asset or asset.valuation_mode != "account_balance":
        return
    d = as_of or date.today()
    val = float(acc.balance or 0)
    existing = (
        db.query(AssetValuation)
        .filter(AssetValuation.asset_id == asset.id, AssetValuation.valued_at == d, AssetValuation.source == "account_balance")
        .first()
    )
    row = existing or AssetValuation(asset_id=asset.id, valued_at=d, source="account_balance")
    row.value = val
    row.currency = acc.currency
    row.exchange_rate_to_try = rate_to_try(db, acc.currency, d)
    row.value_try = amount_to_try(db, val, acc.currency, d)
    if existing is None:
        db.add(row)


def ensure_liability_for_account(db: Session, acc: Account) -> Liability | None:
    if (acc.type or "") not in LIABILITY_ACCOUNT_TYPES:
        return None
    liab = (
        db.query(Liability)
        .filter(Liability.owner_id == acc.owner_id, Liability.account_id == acc.id)
        .first()
    )
    if liab is None:
        liab = Liability(
            owner_id=acc.owner_id,
            account_id=acc.id,
            name=acc.name,
            type=liability_type_for_account(acc),
            currency=acc.currency,
            include_in_net_worth=True,
            is_active=True,
        )
        db.add(liab)
        db.flush()
    liab.name = acc.name
    liab.type = liability_type_for_account(acc)
    liab.currency = acc.currency
    liab.original_principal = acc.credit_limit
    liab.minimum_payment = liab.minimum_payment
    liab.include_in_net_worth = True if liab.include_in_net_worth is None else liab.include_in_net_worth
    liab.is_active = True if liab.is_active is None else liab.is_active
    return liab


def snapshot_liability_from_account(db: Session, acc: Account, as_of: date | None = None) -> None:
    liab = ensure_liability_for_account(db, acc)
    if not liab:
        return
    d = as_of or date.today()
    bal = abs(float(acc.balance or 0))
    existing = (
        db.query(LiabilityBalance)
        .filter(LiabilityBalance.liability_id == liab.id, LiabilityBalance.balanced_at == d, LiabilityBalance.source == "account_balance")
        .first()
    )
    row = existing or LiabilityBalance(liability_id=liab.id, balanced_at=d, source="account_balance")
    row.balance = bal
    row.currency = acc.currency
    row.exchange_rate_to_try = rate_to_try(db, acc.currency, d)
    row.balance_try = amount_to_try(db, bal, acc.currency, d)
    if existing is None:
        db.add(row)


def sync_account_domain(db: Session, acc: Account) -> None:
    if (acc.type or "") in ASSET_ACCOUNT_TYPES:
        ensure_asset_for_account(db, acc)
        snapshot_asset_from_account(db, acc)
    if (acc.type or "") in LIABILITY_ACCOUNT_TYPES:
        ensure_liability_for_account(db, acc)
        snapshot_liability_from_account(db, acc)


def symbol_from_name(name: str | None) -> str | None:
    text = (name or "").strip()
    return text.split(" - ", 1)[0].strip() if text else None


def holding_value(inv: Investment) -> float:
    qty = float(inv.amount or 0)
    price = inv.purchase_price
    return round(qty * float(price), 2) if price is not None else round(qty, 2)


def sync_investment_holding(db: Session, inv: Investment) -> InvestmentHolding:
    asset = ensure_asset_for_platform(db, inv.owner_id, inv.platform)
    holding = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.owner_id == inv.owner_id, InvestmentHolding.legacy_investment_id == inv.id)
        .first()
    )
    if holding is None:
        holding = InvestmentHolding(
            owner_id=inv.owner_id,
            asset_id=asset.id,
            legacy_investment_id=inv.id,
            symbol=symbol_from_name(inv.name),
            name=inv.name,
            asset_class=inv.asset_type or "stock",
            currency=inv.currency,
            quantity=inv.amount or 0,
            is_active=True,
        )
        db.add(holding)
        db.flush()
    holding.asset_id = asset.id
    holding.symbol = symbol_from_name(inv.name)
    holding.name = inv.name
    holding.asset_class = inv.asset_type or "stock"
    holding.currency = inv.currency
    holding.quantity = inv.amount or 0
    holding.average_cost = inv.purchase_price
    holding.note = inv.note
    holding.is_active = True
    return holding


def snapshot_asset_from_holdings(db: Session, asset: Asset, source: str = "holdings") -> None:
    holdings = (
        db.query(InvestmentHolding)
        .filter(InvestmentHolding.asset_id == asset.id, InvestmentHolding.is_active == True)
        .all()
    )
    if not holdings:
        return
    total_try = 0.0
    for h in holdings:
        unit = h.current_price if h.current_price is not None else h.average_cost
        val = float(h.quantity or 0) * float(unit) if unit is not None else float(h.quantity or 0)
        total_try += amount_to_try(db, val, h.currency, h.price_as_of)
    d = date.today()
    row = (
        db.query(AssetValuation)
        .filter(AssetValuation.asset_id == asset.id, AssetValuation.valued_at == d, AssetValuation.source == source)
        .first()
    ) or AssetValuation(asset_id=asset.id, valued_at=d, source=source)
    row.value = round(total_try, 2)
    row.currency = "TRY"
    row.exchange_rate_to_try = 1.0
    row.value_try = round(total_try, 2)
    if row.id is None:
        db.add(row)


def delete_investment_holding(db: Session, inv: Investment) -> None:
    db.query(InvestmentHolding).filter(
        InvestmentHolding.owner_id == inv.owner_id,
        InvestmentHolding.legacy_investment_id == inv.id,
    ).delete(synchronize_session=False)


def backfill_asset_domain(db: Session) -> None:
    for acc in db.query(Account).all():
        sync_account_domain(db, acc)
    db.flush()
    for inv in db.query(Investment).all():
        sync_investment_holding(db, inv)
    db.flush()
    asset_ids = {
        h.asset_id for h in db.query(InvestmentHolding.asset_id).distinct().all()
    }
    for asset_id in asset_ids:
        asset = db.query(Asset).filter(Asset.id == asset_id).first()
        if asset:
            snapshot_asset_from_holdings(db, asset)
    db.commit()
