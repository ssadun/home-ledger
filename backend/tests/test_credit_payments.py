from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import Account, Base, CreditPayment, Transaction, User
from app.routers import credit_payments
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
    user1 = User(email="cp1@example.com", username="cp1", full_name="CP One", hashed_password="x")
    user2 = User(email="cp2@example.com", username="cp2", full_name="CP Two", hashed_password="x")
    db.add_all([user1, user2])
    db.commit()
    db.refresh(user1)
    db.refresh(user2)
    current = {"user": user1}

    app = FastAPI()
    app.include_router(credit_payments.router)

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


def _card(owner_id, key):
    return Account(
        owner_id=owner_id,
        account_key=key,
        name="Bonus",
        type="credit",
        currency="TRY",
    )


def _payment(owner_id, account):
    return CreditPayment(
        owner_id=owner_id,
        account_id=account.id,
        account_key=account.account_key,
        name="2026.07 - Bonus",
        period_year=2026,
        period_month=7,
        period_from=date(2026, 7, 1),
        period_to=date(2026, 7, 26),
        cutover_date=date(2026, 7, 26),
        payment_date=date(2026, 8, 5),
        total_amount=1000,
        minimum_amount=100,
        currency="TRY",
    )


def _tx(owner_id, cp_id, desc):
    return Transaction(
        owner_id=owner_id,
        type="expense",
        amount=125,
        currency="TRY",
        amount_try=125,
        amount_usd=0,
        description=desc,
        date=date(2026, 7, 10),
        payment_method="acc-card",
        category_key="shopping",
        credit_payment_id=cp_id,
    )


def test_delete_credit_payment_deletes_linked_spendings(api):
    client, db, current, user1, user2 = api
    card1 = _card(user1.id, "acc-card")
    card2 = _card(user2.id, "acc-other")
    db.add_all([card1, card2])
    db.commit()
    db.refresh(card1)
    db.refresh(card2)

    cp1 = _payment(user1.id, card1)
    cp2 = _payment(user2.id, card2)
    db.add_all([cp1, cp2])
    db.commit()
    db.refresh(cp1)
    db.refresh(cp2)

    linked = _tx(user1.id, cp1.id, "linked row")
    unrelated_owner = _tx(user2.id, cp1.id, "other owner row")
    unrelated_payment = _tx(user1.id, cp2.id, "other statement row")
    db.add_all([linked, unrelated_owner, unrelated_payment])
    db.commit()
    linked_id = linked.id
    unrelated_owner_id = unrelated_owner.id
    unrelated_payment_id = unrelated_payment.id

    response = client.delete(f"/api/credit-payments/{cp1.id}")

    assert response.status_code == 204
    assert db.query(CreditPayment).filter(CreditPayment.id == cp1.id).first() is None
    assert db.query(Transaction).filter(Transaction.id == linked_id).first() is None
    assert db.query(Transaction).filter(Transaction.id == unrelated_owner_id).first() is not None
    assert db.query(Transaction).filter(Transaction.id == unrelated_payment_id).first() is not None


def test_delete_credit_payment_is_owner_scoped(api):
    client, db, current, user1, user2 = api
    card = _card(user2.id, "acc-other")
    db.add(card)
    db.commit()
    db.refresh(card)
    cp = _payment(user2.id, card)
    db.add(cp)
    db.commit()
    db.refresh(cp)
    tx = _tx(user2.id, cp.id, "other owner statement row")
    db.add(tx)
    db.commit()
    tx_id = tx.id

    current["user"] = user1
    response = client.delete(f"/api/credit-payments/{cp.id}")

    assert response.status_code == 404
    assert db.query(CreditPayment).filter(CreditPayment.id == cp.id).first() is not None
    assert db.query(Transaction).filter(Transaction.id == tx_id).first() is not None


def test_credit_payment_overlap_check_is_date_range_based(api):
    client, db, current, user1, user2 = api
    card = _card(user1.id, "acc-card")
    db.add(card)
    db.commit()
    db.refresh(card)

    existing = _payment(user1.id, card)
    db.add(existing)
    db.commit()
    db.refresh(existing)

    response = client.get(
        "/api/credit-payments/check-overlap",
        params={
            "account_id": card.id,
            "period_from": "2026-07-20",
            "period_to": "2026-08-05",
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] == 1
    assert body["matches"][0]["id"] == existing.id
    assert body["matches"][0]["name"] == "2026.07 - Bonus"
    assert body["matches"][0]["period_from"] == "2026-07-01"
    assert body["matches"][0]["period_to"] == "2026-07-26"


def test_credit_payment_overlap_is_scoped_and_rejects_reversed_ranges(api):
    client, db, current, user1, user2 = api
    card = _card(user1.id, "acc-card")
    other = _card(user1.id, "acc-other-card")
    db.add_all([card, other])
    db.commit()
    db.refresh(card)
    db.refresh(other)
    db.add(_payment(user1.id, card))
    db.commit()

    adjacent = client.get(
        "/api/credit-payments/check-overlap",
        params={
            "account_id": card.id,
            "period_from": "2026-07-27",
            "period_to": "2026-08-26",
        },
    )
    different_card = client.get(
        "/api/credit-payments/check-overlap",
        params={
            "account_id": other.id,
            "period_from": "2026-07-01",
            "period_to": "2026-07-26",
        },
    )
    reversed_range = client.get(
        "/api/credit-payments/check-overlap",
        params={
            "account_id": card.id,
            "period_from": "2026-08-01",
            "period_to": "2026-07-01",
        },
    )

    assert adjacent.json()["count"] == 0
    assert different_card.json()["count"] == 0
    assert reversed_range.status_code == 400


def test_credit_payment_create_and_update_reject_overlapping_ranges(api):
    client, db, current, user1, user2 = api
    card = _card(user1.id, "acc-card")
    db.add(card)
    db.commit()
    db.refresh(card)
    payload = {
        "account_id": card.id,
        "period_year": 2026,
        "period_month": 7,
        "period_from": "2026-07-01",
        "period_to": "2026-07-26",
        "cutover_date": "2026-07-26",
        "payment_date": "2026-08-05",
        "total_amount": 1000,
        "minimum_amount": 100,
        "currency": "TRY",
    }
    existing = client.post("/api/credit-payments/", json=payload)
    assert existing.status_code == 201

    duplicate = client.post("/api/credit-payments/", json=payload)
    assert duplicate.status_code == 409
    assert "overlapping date range" in duplicate.json()["detail"]
    assert db.query(CreditPayment).count() == 1

    august = payload | {
        "period_month": 8,
        "period_from": "2026-07-27",
        "period_to": "2026-08-26",
        "cutover_date": "2026-08-26",
        "payment_date": "2026-09-05",
    }
    second = client.post("/api/credit-payments/", json=august)
    assert second.status_code == 201
    overlapping_update = client.patch(
        f"/api/credit-payments/{second.json()['id']}",
        json={"period_from": "2026-07-26"},
    )
    assert overlapping_update.status_code == 409
