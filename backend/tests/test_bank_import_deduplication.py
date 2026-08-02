from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, Transaction, User
from app.services.bank_import import import_transactions


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    user = User(
        email="dedupe@example.com",
        username="dedupe",
        full_name="Dedupe User",
        hashed_password="x",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    first = Account(
        owner_id=user.id,
        account_key="acc-first",
        name="First Account",
        type="bank",
        currency="TRY",
    )
    second = Account(
        owner_id=user.id,
        account_key="acc-second",
        name="Second Account",
        type="credit",
        currency="TRY",
    )
    db.add_all([first, second])
    db.commit()
    return db, user, first, second


def _row(account_key, description="MARKET"):
    return {
        "date": "2026-04-01",
        "amount": 100,
        "type": "expense",
        "currency": "TRY",
        "description": description,
        "payment_method": account_key,
    }


def test_import_deduplicates_by_transaction_identity_not_statement_period():
    db, user, first, second = _db()
    try:
        db.add(Transaction(
            owner_id=user.id,
            type="expense",
            amount=100,
            currency="TRY",
            description="MARKET",
            date=date(2026, 4, 1),
            payment_method=first.account_key,
        ))
        db.commit()

        result = import_transactions(db, user.id, [
            _row(first.account_key),
            _row(first.account_key, "CAFE"),
            _row(second.account_key),
        ])

        assert result["imported"] == 2
        assert result["skipped"] == 1
        assert result["imported_indices"] == [1, 2]
        assert result["skipped_indices"] == [0]
        assert db.query(Transaction).count() == 3
    finally:
        db.close()


def test_import_duplicate_counts_preserve_repeated_real_transactions():
    db, user, first, _ = _db()
    try:
        db.add(Transaction(
            owner_id=user.id,
            type="expense",
            amount=100,
            currency="TRY",
            description="MARKET",
            date=date(2026, 4, 1),
            payment_method=str(first.id),
        ))
        db.commit()

        result = import_transactions(
            db, user.id,
            [_row(first.account_key), _row(first.account_key)],
        )

        assert result["imported"] == 1
        assert result["skipped"] == 1
        assert result["imported_indices"] == [1]
        assert db.query(Transaction).count() == 2
    finally:
        db.close()
