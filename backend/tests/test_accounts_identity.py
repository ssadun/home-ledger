import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import Base, User
from app.routers import accounts
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
    user = User(email="u1@example.com", username="u1", full_name="User One", hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)

    app = FastAPI()
    app.include_router(accounts.router)

    def override_db():
        try:
            yield db
        finally:
            pass

    def override_user():
        return user

    app.dependency_overrides[get_db] = override_db
    app.dependency_overrides[get_current_user] = override_user
    client = TestClient(app)
    try:
        yield client
    finally:
        db.close()


BASE = {
    "holder": "Sadun",
    "currency": "TRY",
    "balance": 0,
    "institution": "Garanti BBVA",
}


@pytest.mark.parametrize("payload, missing", [
    ({"type": "bank", "name": "Salary", "iban": ""}, "IBAN"),
    ({"type": "overdraft", "name": "KMH", "iban": ""}, "IBAN"),
    ({"type": "credit", "name": "Bonus", "number": ""}, "Card number"),
    ({"type": "debit", "name": "Debit", "number": ""}, "Card number"),
    ({"type": "wallet", "name": "Wallet", "number": ""}, "Account number"),
    ({"type": "cash", "name": "   ", "institution": ""}, "Account name"),
    ({"type": "invest", "name": "Midas", "institution": ""}, "Account name and institution"),
    ({"type": "pension", "name": "Dijibes", "institution": ""}, "Account name and institution"),
])
def test_account_identity_is_required(api, payload, missing):
    client = api
    res = client.post("/api/accounts/", json={**BASE, **payload})
    assert res.status_code == 400
    assert missing in res.json()["detail"]


@pytest.mark.parametrize("first, second", [
    (
        {"type": "bank", "name": "Salary", "iban": "TR65 0006 2000 0000 0000 0000 01"},
        {"type": "overdraft", "name": "KMH", "iban": "TR650006200000000000000001"},
    ),
    (
        {"type": "credit", "name": "Bonus", "number": "4870 75** **** 1011"},
        {"type": "debit", "name": "Debit", "number": "4870 75** **** 1011"},
    ),
    (
        {"type": "wallet", "name": "Papara", "number": "123 456"},
        {"type": "wallet", "name": "Papara 2", "number": "123456"},
    ),
    (
        {"type": "cash", "name": "House Cash", "institution": ""},
        {"type": "cash", "name": " house   cash ", "institution": ""},
    ),
    (
        {"type": "invest", "name": "Midas", "institution": "Midas"},
        {"type": "invest", "name": " midas ", "institution": "midas"},
    ),
    (
        {"type": "pension", "name": "Dijibes", "institution": "Garanti BBVA Emeklilik"},
        {"type": "pension", "name": "Dijibes", "institution": " garanti bbva emeklilik "},
    ),
])
def test_account_identity_is_unique(api, first, second):
    client = api
    created = client.post("/api/accounts/", json={**BASE, **first})
    assert created.status_code == 201

    duplicate = client.post("/api/accounts/", json={**BASE, **second})
    assert duplicate.status_code == 409
    assert "already used" in duplicate.json()["detail"]


def test_bank_account_subtype_controls_interest_rate(api):
    client = api
    checking = client.post("/api/accounts/", json={
        **BASE,
        "type": "bank",
        "name": "Checking",
        "iban": "TR650006200000000000000101",
        "bank_subtype": "checking",
        "interest_rate": 18.5,
    })
    assert checking.status_code == 201
    assert checking.json()["bank_subtype"] == "checking"
    assert checking.json()["interest_rate"] == pytest.approx(0)

    missing_rate = client.post("/api/accounts/", json={
        **BASE,
        "type": "bank",
        "name": "Deposit",
        "iban": "TR650006200000000000000102",
        "bank_subtype": "deposit",
    })
    assert missing_rate.status_code == 400
    assert "Interest rate is required" in missing_rate.json()["detail"]

    deposit = client.post("/api/accounts/", json={
        **BASE,
        "type": "bank",
        "name": "Deposit",
        "iban": "TR650006200000000000000103",
        "bank_subtype": "deposit",
        "interest_rate": 42.25,
    })
    assert deposit.status_code == 201
    assert deposit.json()["bank_subtype"] == "deposit"
    assert deposit.json()["interest_rate"] == pytest.approx(42.25)
