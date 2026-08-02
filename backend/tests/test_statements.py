from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import (
    Account, Asset, AssetValuation, Base, Investment, InvestmentHolding,
    Statement, Transaction, User,
)
from app.routers import statements
from app.services.auth import get_current_user


def _api():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()
    user = User(
        email="statements@example.com",
        username="statements",
        full_name="Statement User",
        hashed_password="x",
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    credit = Account(
        owner_id=user.id,
        account_key="acc-credit",
        name="Bonus",
        type="credit",
        currency="TRY",
    )
    debit = Account(
        owner_id=user.id,
        account_key="acc-debit",
        name="Debit Card",
        type="debit",
        currency="TRY",
    )
    db.add_all([credit, debit])
    db.commit()
    db.refresh(credit)
    db.refresh(debit)

    app = FastAPI()
    app.include_router(statements.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app), db, credit, debit


def _payload(account_id):
    return {
        "account_id": account_id,
        "period_year": 2026,
        "period_month": 7,
        "period_from": "2026-07-01",
        "period_to": "2026-07-31",
        "currency": "TRY",
    }


def test_credit_card_cannot_be_entered_as_account_statement():
    client, db, credit, _ = _api()
    try:
        response = client.post("/api/statements/", json=_payload(credit.id))
        assert response.status_code == 400
        assert response.json()["detail"] == (
            "Credit card statements must be entered through Card Payments."
        )
        assert db.query(Statement).count() == 0
    finally:
        db.close()


def test_debit_card_can_be_entered_as_account_statement():
    client, db, _, debit = _api()
    try:
        response = client.post("/api/statements/", json=_payload(debit.id))
        assert response.status_code == 201
        assert response.json()["account_id"] == debit.id
        assert response.json()["name"] == "2026.07 - Debit Card"
    finally:
        db.close()


def test_statement_cannot_be_changed_to_credit_card():
    client, db, credit, debit = _api()
    try:
        created = client.post("/api/statements/", json=_payload(debit.id))
        response = client.patch(
            f"/api/statements/{created.json()['id']}",
            json={"account_id": credit.id},
        )
        assert response.status_code == 400
        db.expire_all()
        assert db.query(Statement).one().account_id == debit.id
    finally:
        db.close()


def test_statement_overlap_check_is_date_range_based():
    client, db, credit, debit = _api()
    try:
        existing = client.post("/api/statements/", json=_payload(debit.id))
        assert existing.status_code == 201

        response = client.get(
            "/api/statements/check-overlap",
            params={
                "account_id": debit.id,
                "period_from": "2026-07-15",
                "period_to": "2026-08-05",
            },
        )
        assert response.status_code == 200
        body = response.json()
        assert body["count"] == 1
        assert body["matches"][0]["id"] == existing.json()["id"]
        assert body["matches"][0]["name"] == "2026.07 - Debit Card"
    finally:
        db.close()


def test_statement_overlap_is_scoped_and_rejects_reversed_ranges():
    client, db, _, debit = _api()
    try:
        existing = client.post("/api/statements/", json=_payload(debit.id))
        assert existing.status_code == 201
        other = Account(
            owner_id=debit.owner_id,
            account_key="acc-other-debit",
            name="Other Debit",
            type="debit",
            currency="TRY",
        )
        db.add(other)
        db.commit()
        db.refresh(other)

        adjacent = client.get(
            "/api/statements/check-overlap",
            params={
                "account_id": debit.id,
                "period_from": "2026-08-01",
                "period_to": "2026-08-31",
            },
        )
        different_account = client.get(
            "/api/statements/check-overlap",
            params={
                "account_id": other.id,
                "period_from": "2026-07-01",
                "period_to": "2026-07-31",
            },
        )
        reversed_range = client.get(
            "/api/statements/check-overlap",
            params={
                "account_id": debit.id,
                "period_from": "2026-08-01",
                "period_to": "2026-07-01",
            },
        )

        assert adjacent.json()["count"] == 0
        assert different_account.json()["count"] == 0
        assert reversed_range.status_code == 400
    finally:
        db.close()


def test_statement_create_and_update_reject_overlapping_ranges():
    client, db, _, debit = _api()
    try:
        existing = client.post("/api/statements/", json=_payload(debit.id))
        assert existing.status_code == 201

        duplicate = client.post("/api/statements/", json=_payload(debit.id))
        assert duplicate.status_code == 409
        assert "overlapping date range" in duplicate.json()["detail"]
        assert db.query(Statement).count() == 1

        august = _payload(debit.id) | {
            "period_month": 8,
            "period_from": "2026-08-01",
            "period_to": "2026-08-31",
        }
        second = client.post("/api/statements/", json=august)
        assert second.status_code == 201
        overlapping_update = client.patch(
            f"/api/statements/{second.json()['id']}",
            json={"period_from": "2026-07-31"},
        )
        assert overlapping_update.status_code == 409
    finally:
        db.close()


def test_deleting_bank_statement_deletes_only_its_account_activity_rows():
    client, db, _, _ = _api()
    try:
        user = db.query(User).one()
        bank = Account(
            owner_id=user.id,
            account_key="acc-bank",
            name="Checking",
            type="bank",
            currency="TRY",
        )
        db.add(bank)
        db.commit()
        db.refresh(bank)
        created = client.post("/api/statements/", json=_payload(bank.id))
        assert created.status_code == 201
        statement_id = created.json()["id"]

        linked = Transaction(
            owner_id=user.id,
            type="expense",
            amount=100,
            currency="TRY",
            description="Imported movement",
            date=date(2026, 7, 10),
            payment_method=bank.account_key,
            statement_id=statement_id,
        )
        unrelated = Transaction(
            owner_id=user.id,
            type="expense",
            amount=25,
            currency="TRY",
            description="Manual movement",
            date=date(2026, 7, 11),
            payment_method=bank.account_key,
        )
        db.add_all([linked, unrelated])
        db.commit()
        unrelated_id = unrelated.id

        response = client.delete(f"/api/statements/{statement_id}")
        assert response.status_code == 204
        db.expire_all()
        assert db.query(Statement).filter(Statement.id == statement_id).first() is None
        assert db.query(Transaction).count() == 1
        assert db.query(Transaction).one().id == unrelated_id
    finally:
        db.close()


def test_deleting_investment_statement_clears_only_that_accounts_holdings():
    client, db, _, _ = _api()
    try:
        user = db.query(User).one()
        invest = Account(
            owner_id=user.id,
            account_key="acc-invest",
            name="Midas NASDAQ",
            type="invest",
            currency="USD",
        )
        other = Account(
            owner_id=user.id,
            account_key="acc-other-invest",
            name="Other Broker",
            type="invest",
            currency="USD",
        )
        db.add_all([invest, other])
        db.commit()
        db.refresh(invest)
        db.refresh(other)
        created = client.post("/api/statements/", json=_payload(invest.id) | {"currency": "USD"})
        assert created.status_code == 201
        statement_id = created.json()["id"]

        asset = Asset(
            owner_id=user.id, account_id=invest.id, name=invest.name,
            type="investment", currency="USD", valuation_mode="holdings",
        )
        other_asset = Asset(
            owner_id=user.id, account_id=other.id, name=other.name,
            type="investment", currency="USD", valuation_mode="holdings",
        )
        db.add_all([asset, other_asset])
        db.flush()
        investment = Investment(
            owner_id=user.id, name="LMT - Lockheed Martin",
            platform=invest.name, asset_type="stock", currency="USD", amount=1,
        )
        other_investment = Investment(
            owner_id=user.id, name="MSFT - Microsoft",
            platform=other.name, asset_type="stock", currency="USD", amount=1,
        )
        db.add_all([investment, other_investment])
        db.flush()
        db.add_all([
            InvestmentHolding(
                owner_id=user.id, asset_id=asset.id,
                legacy_investment_id=investment.id, name=investment.name,
                asset_class="stock", currency="USD", quantity=1,
            ),
            InvestmentHolding(
                owner_id=user.id, asset_id=other_asset.id,
                legacy_investment_id=other_investment.id, name=other_investment.name,
                asset_class="stock", currency="USD", quantity=1,
            ),
            AssetValuation(
                asset_id=asset.id, value=600, currency="USD",
                valued_at=date(2026, 7, 31), source="holdings",
            ),
        ])
        db.commit()

        response = client.delete(f"/api/statements/{statement_id}")
        assert response.status_code == 204
        db.expire_all()
        assert db.query(Investment).filter(Investment.platform == invest.name).count() == 0
        assert db.query(InvestmentHolding).filter(InvestmentHolding.asset_id == asset.id).count() == 0
        assert db.query(AssetValuation).filter(AssetValuation.asset_id == asset.id).count() == 0
        assert db.query(Asset).filter(Asset.id == asset.id).count() == 1
        assert db.query(Investment).filter(Investment.platform == other.name).count() == 1
        assert db.query(InvestmentHolding).filter(InvestmentHolding.asset_id == other_asset.id).count() == 1
    finally:
        db.close()
