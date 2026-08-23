from datetime import date

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import Account, Base, CreditPayment, Statement, Transaction, User
from app.routers import transactions
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
    user1 = User(email="stlabel1@example.com", username="stlabel1", full_name="One", hashed_password="x")
    user2 = User(email="stlabel2@example.com", username="stlabel2", full_name="Two", hashed_password="x")
    db.add_all([user1, user2])
    db.commit()
    db.refresh(user1)
    db.refresh(user2)
    current = {"user": user1}

    app = FastAPI()
    app.include_router(transactions.router)

    def override_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = lambda: current["user"]
    client = TestClient(app)
    try:
        yield client, db, current, user1, user2
    finally:
        db.close()


def test_statement_id_filter_and_label_are_returned(api):
    client, db, current, user1, user2 = api

    st = Statement(owner_id=user1.id, name="26-08 GARANTI-ELMA-9945", period_year=2026, period_month=8)
    other_st = Statement(owner_id=user1.id, name="26-07 GARANTI-ELMA-9945", period_year=2026, period_month=7)
    cp = CreditPayment(owner_id=user1.id, name="26-08 BONUS-1011", period_year=2026, period_month=8)
    db.add_all([st, other_st, cp])
    db.commit()
    db.refresh(st)
    db.refresh(other_st)
    db.refresh(cp)

    linked = Transaction(
        owner_id=user1.id, type="expense", amount=100, currency="TRY",
        description="Linked to statement", date=date(2026, 8, 5),
        statement_id=st.id,
    )
    unrelated = Transaction(
        owner_id=user1.id, type="expense", amount=50, currency="TRY",
        description="Different statement", date=date(2026, 7, 5),
        statement_id=other_st.id,
    )
    card_spend = Transaction(
        owner_id=user1.id, type="expense", amount=75, currency="TRY",
        description="Card spend", date=date(2026, 8, 10),
        credit_payment_id=cp.id,
    )
    db.add_all([linked, unrelated, card_spend])
    db.commit()

    response = client.get("/api/transactions/", params={"statement_id": st.id, "limit": 200})
    assert response.status_code == 200
    body = response.json()
    assert [row["description"] for row in body] == ["Linked to statement"]
    assert body[0]["statement_id"] == st.id
    assert body[0]["statement_label"] == "26-08 GARANTI-ELMA-9945"

    # A credit-card spending's label is derived from its CreditPayment, not a Statement.
    cp_response = client.get("/api/transactions/", params={"credit_payment_id": cp.id, "limit": 200})
    assert cp_response.status_code == 200
    cp_body = cp_response.json()
    assert cp_body[0]["statement_label"] == "26-08 BONUS-1011"
    assert cp_body[0]["statement_id"] is None


def test_statement_id_filter_does_not_leak_another_owners_data(api):
    client, db, current, user1, user2 = api

    st_owner1 = Statement(owner_id=user1.id, name="26-08 GARANTI-ELMA-9945", period_year=2026, period_month=8)
    st_owner2 = Statement(owner_id=user2.id, name="26-08 ODEA-KIRAZ-1234", period_year=2026, period_month=8)
    db.add_all([st_owner1, st_owner2])
    db.commit()
    db.refresh(st_owner1)
    db.refresh(st_owner2)

    tx_owner2 = Transaction(
        owner_id=user2.id, type="expense", amount=200, currency="TRY",
        description="Other owner's row", date=date(2026, 8, 6),
        statement_id=st_owner2.id,
    )
    db.add(tx_owner2)
    db.commit()

    # user1 (the overridden current user) must not see user2's row even when
    # querying by user2's own statement id.
    response = client.get("/api/transactions/", params={"statement_id": st_owner2.id, "limit": 200})
    assert response.status_code == 200
    assert response.json() == []


def test_get_and_create_transaction_include_statement_label(api):
    client, db, current, user1, user2 = api

    st = Statement(owner_id=user1.id, name="26-08 GARANTI-ELMA-9945", period_year=2026, period_month=8)
    db.add(st)
    db.commit()
    db.refresh(st)

    tx = Transaction(
        owner_id=user1.id, type="expense", amount=100, currency="TRY",
        description="Linked", date=date(2026, 8, 5), statement_id=st.id,
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    response = client.get(f"/api/transactions/{tx.id}")
    assert response.status_code == 200
    assert response.json()["statement_label"] == "26-08 GARANTI-ELMA-9945"

    # A newly-created transaction has no statement link yet, so the field is null
    # rather than absent.
    create_response = client.post(
        "/api/transactions/",
        json={
            "type": "expense", "amount": 20, "currency": "TRY",
            "description": "Fresh", "date": "2026-08-07",
        },
    )
    assert create_response.status_code == 201
    assert create_response.json()["statement_label"] is None
    assert create_response.json()["statement_id"] is None
