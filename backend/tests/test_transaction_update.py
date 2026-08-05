from datetime import date

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import Base, Transaction, User
from app.routers import transactions
from app.schemas import TransactionUpdate
from app.services.auth import get_current_user


def test_transaction_update_accepts_and_persists_a_date():
    assert TransactionUpdate.model_validate({"date": "2026-07-24"}).date == date(2026, 7, 24)

    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    db = Session()
    user = User(
        email="transaction-update@example.com",
        username="transaction-update",
        full_name="Transaction Update",
        hashed_password="x",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    tx = Transaction(
        owner_id=user.id,
        type="expense",
        amount=100,
        currency="TRY",
        description="Imported transaction",
        date=date(2026, 7, 23),
        payment_method="acc-1",
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    app = FastAPI()
    app.include_router(transactions.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    try:
        response = TestClient(app).patch(
            f"/api/transactions/{tx.id}",
            json={"date": "2026-07-24"},
        )

        assert response.status_code == 200
        assert response.json()["date"] == "2026-07-24"
        db.expire_all()
        assert db.get(Transaction, tx.id).date == date(2026, 7, 24)
    finally:
        db.close()
