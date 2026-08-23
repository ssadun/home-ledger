from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Account, Base, CreditPayment, FinancialInstitution, Statement, User,
)
from app.services.statement_naming import (
    backfill_statement_names,
    compute_statement_name,
)


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    return Session()


def _user(db):
    u = User(email="stmt@example.com", username="stmt", full_name="Stmt User", hashed_password="x")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def test_credit_payment_name_uses_product_first_word_and_last4():
    db = _db()
    user = _user(db)
    card = Account(
        owner_id=user.id, account_key="acc-card", name="Bonus Platinum",
        type="credit", currency="TRY", number="4870 **** **** 1011",
        card_name="SADUN SEVINGEN",  # printed cardholder name -- must NOT be used
    )
    db.add(card)
    db.commit()
    db.refresh(card)

    cp = CreditPayment(owner_id=user.id, account_id=card.id, period_year=2026, period_month=8)
    assert compute_statement_name(db, cp) == "26-08 BONUS-1011"


def test_statement_name_uses_institution_short_name_and_account_name():
    db = _db()
    user = _user(db)
    db.add(FinancialInstitution(key="garanti", name="Garanti BBVA", short_name="Garanti"))
    acc = Account(
        owner_id=user.id, account_key="acc-elma", name="Elma",
        type="bank", currency="TRY", number="TR810012502002025673309945",
        institution="Garanti BBVA",
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)

    st = Statement(owner_id=user.id, account_id=acc.id, period_year=2026, period_month=8)
    assert compute_statement_name(db, st) == "26-08 GARANTI-ELMA-9945"


def test_statement_name_without_institution_falls_back_to_account_name_only():
    db = _db()
    user = _user(db)
    acc = Account(
        owner_id=user.id, account_key="acc-debit", name="Debit Card",
        type="debit", currency="TRY",
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)

    st = Statement(owner_id=user.id, account_id=acc.id, period_year=2026, period_month=7)
    assert compute_statement_name(db, st) == "26-07 DEBIT CARD"


def test_statement_name_omits_son4_when_number_has_no_digits():
    db = _db()
    user = _user(db)
    acc = Account(
        owner_id=user.id, account_key="acc-nonum", name="Wallet",
        type="wallet", currency="TRY", number="–",
    )
    db.add(acc)
    db.commit()
    db.refresh(acc)

    st = Statement(owner_id=user.id, account_id=acc.id, period_year=2026, period_month=3)
    assert compute_statement_name(db, st) == "26-03 WALLET"


def test_year_2000_rolls_over_to_two_digit_prefix():
    db = _db()
    user = _user(db)
    acc = Account(owner_id=user.id, account_key="acc-y2k", name="Old Account", type="bank", currency="TRY")
    db.add(acc)
    db.commit()
    db.refresh(acc)

    st = Statement(owner_id=user.id, account_id=acc.id, period_year=2000, period_month=1)
    assert compute_statement_name(db, st) == "00-01 OLD ACCOUNT"


def test_compute_name_falls_back_when_account_is_missing():
    db = _db()
    user = _user(db)
    cp = CreditPayment(owner_id=user.id, account_id=None, period_year=2026, period_month=5)
    assert compute_statement_name(db, cp) == "26-05 Card"
    st = Statement(owner_id=user.id, account_id=None, period_year=2026, period_month=5)
    assert compute_statement_name(db, st) == "26-05 Account"


def test_backfill_rewrites_legacy_names_and_is_idempotent():
    db = _db()
    user = _user(db)
    card = Account(
        owner_id=user.id, account_key="acc-card", name="Bonus",
        type="credit", currency="TRY", number="1234567890121011",
    )
    acc = Account(
        owner_id=user.id, account_key="acc-bank", name="Elma",
        type="bank", currency="TRY",
    )
    db.add_all([card, acc])
    db.commit()
    db.refresh(card)
    db.refresh(acc)

    cp = CreditPayment(
        owner_id=user.id, account_id=card.id, account_key=card.account_key,
        name="2026.08 - Bonus", period_year=2026, period_month=8,
    )
    st = Statement(
        owner_id=user.id, account_id=acc.id, account_key=acc.account_key,
        name="2026.08 - Elma", period_year=2026, period_month=8,
    )
    db.add_all([cp, st])
    db.commit()

    backfill_statement_names(db)
    db.refresh(cp)
    db.refresh(st)
    assert cp.name == "26-08 BONUS-1011"
    assert st.name == "26-08 ELMA"

    # Idempotent: a second run recomputes to the exact same values and leaves
    # every other field untouched (only a real drift would trigger a rewrite).
    backfill_statement_names(db)
    db.refresh(cp)
    db.refresh(st)
    assert cp.name == "26-08 BONUS-1011"
    assert st.name == "26-08 ELMA"
