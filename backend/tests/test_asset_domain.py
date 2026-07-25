from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import Account, Asset, AssetValuation, Base, InvestmentHolding, Liability, LiabilityBalance, User
from app.routers import assets, holdings, investments, liabilities, net_worth
from app.services.assets import backfill_asset_domain
from app.services.auth import get_current_user


@pytest.fixture()
def api():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()
    user1 = User(email="u1@example.com", username="u1", full_name="User One", hashed_password="x")
    user2 = User(email="u2@example.com", username="u2", full_name="User Two", hashed_password="x")
    db.add_all([user1, user2])
    db.commit()
    db.refresh(user1)
    db.refresh(user2)
    current = {"user": user1}

    app = FastAPI()
    for router in (assets.router, holdings.router, investments.router, liabilities.router, net_worth.router):
        app.include_router(router)

    def override_db():
        try:
            yield db
        finally:
            pass

    def override_user():
        return current["user"]

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    client = TestClient(app)
    try:
        yield client, db, current, user1, user2
    finally:
        db.close()


def test_asset_crud_owner_scope_and_summary(api):
    client, db, current, user1, user2 = api
    res = client.post("/api/assets/", json={
        "name": "Kadikoy Flat",
        "type": "real_estate",
        "currency": "TRY",
        "ownership_percentage": 50,
        "valuation_mode": "manual",
    })
    assert res.status_code == 201
    asset_id = res.json()["id"]

    res = client.post(f"/api/assets/{asset_id}/valuations", json={
        "value": 1000000,
        "currency": "TRY",
        "valued_at": "2026-07-24",
        "source": "appraisal",
    })
    assert res.status_code == 201

    res = client.post("/api/liabilities/", json={
        "name": "Mortgage",
        "type": "mortgage",
        "currency": "TRY",
    })
    assert res.status_code == 201
    liability_id = res.json()["id"]
    assert client.post(f"/api/liabilities/{liability_id}/balances", json={
        "balance": 120000,
        "currency": "TRY",
        "balanced_at": "2026-07-24",
        "source": "manual",
    }).status_code == 201

    summary = client.get("/api/net-worth/summary").json()
    assert summary["assets_try"] == pytest.approx(500000)
    assert summary["liabilities_try"] == pytest.approx(120000)
    assert summary["net_worth_try"] == pytest.approx(380000)

    current["user"] = user2
    assert client.get("/api/assets/").json() == []
    assert client.patch(f"/api/assets/{asset_id}", json={"name": "Other"}).status_code == 404


def test_investments_dual_write_to_holdings(api):
    client, db, current, user1, user2 = api
    res = client.post("/api/investments/", json={
        "name": "ALTIN.S1 - Darphane Sertifikasi",
        "platform": "Midas",
        "asset_type": "gold",
        "currency": "TRY",
        "amount": 10,
        "purchase_price": 100,
    })
    assert res.status_code == 201
    inv_id = res.json()["id"]
    holding = db.query(InvestmentHolding).filter(InvestmentHolding.legacy_investment_id == inv_id).first()
    assert holding is not None
    assert holding.name == "ALTIN.S1 - Darphane Sertifikasi"
    assert holding.asset_class == "gold"
    assert holding.quantity == pytest.approx(10)

    assert client.patch(f"/api/investments/{inv_id}", json={"amount": 12, "purchase_price": 110}).status_code == 200
    db.refresh(holding)
    assert holding.quantity == pytest.approx(12)
    assert holding.average_cost == pytest.approx(110)

    assert client.delete(f"/api/investments/{inv_id}").status_code == 204
    assert db.query(InvestmentHolding).filter(InvestmentHolding.legacy_investment_id == inv_id).first() is None


def test_backfill_asset_domain_is_idempotent(api):
    client, db, current, user1, user2 = api
    acc = Account(
        owner_id=user1.id,
        account_key="acc-1",
        name="Cash Box",
        type="cash",
        currency="TRY",
        balance=500,
    )
    card = Account(
        owner_id=user1.id,
        account_key="acc-2",
        name="Bonus Card",
        type="credit",
        currency="TRY",
        balance=-1250,
    )
    db.add_all([acc, card])
    db.commit()

    backfill_asset_domain(db)
    backfill_asset_domain(db)

    assert db.query(Asset).filter(Asset.account_id == acc.id).count() == 1
    assert db.query(AssetValuation).join(Asset).filter(Asset.account_id == acc.id).count() == 1
    assert db.query(Liability).filter(Liability.account_id == card.id).count() == 1
    balance = db.query(LiabilityBalance).join(Liability).filter(Liability.account_id == card.id).first()
    assert balance.balance == pytest.approx(1250)
