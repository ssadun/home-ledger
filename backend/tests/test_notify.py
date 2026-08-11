"""Tests for services/notify.py's paid-bill reminder skip (Group 8 of
plans/UPCOMING_DUE_RECONCILE.md, Step 10). Scope: run_due_date_check() must not
push a reminder for a CreditPayment whose settlement_state is already "paid",
in both Phase 1 (normal due-date fire) and Phase 2 (snooze re-fire). Recurring
items have no settlement concept and are untouched by this change.
"""

import json
from datetime import date, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import (
    Base, CreditPayment, PushSubscription, ReminderSnooze, Transaction,
    TransactionType, User,
)
from app.services import notify as notify_module


def _db():
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    user = User(
        email="notify@example.com", username="notify", full_name="Notify User",
        hashed_password="x", is_active=True, notify_lead_days=0,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add(PushSubscription(owner_id=user.id, endpoint="https://push.example/ep1", p256dh="k", auth="a"))
    db.commit()
    return db, user


def _bill(owner_id, due, total=1000.0):
    return CreditPayment(
        owner_id=owner_id, name="2026.08 - Bonus", period_year=2026, period_month=8,
        payment_date=due, total_amount=total, minimum_amount=0.0, currency="TRY",
    )


def _fake_webpush(sent_tags):
    def _fn(**kwargs):
        sent_tags.append(json.loads(kwargs["data"]).get("tag"))
    return _fn


def test_run_due_date_check_skips_fully_paid_bill(monkeypatch):
    """Phase 1: a bill due today with a fully-settling expense transaction must
    not be pushed; an otherwise-identical unpaid bill due the same day must."""
    db, user = _db()
    try:
        today = date.today()
        paid_cp = _bill(user.id, today, total=1000.0)
        unpaid_cp = _bill(user.id, today, total=1000.0)
        db.add_all([paid_cp, unpaid_cp])
        db.commit()
        db.refresh(paid_cp)
        db.refresh(unpaid_cp)

        db.add(Transaction(
            owner_id=user.id, type=TransactionType.expense, amount=1000.0,
            currency="TRY", date=today, description="KREDİ KARTI BORCU",
            category_key="credit-card-payment",
            settles_credit_payment_id=paid_cp.id,
        ))
        db.commit()

        sent_tags = []
        monkeypatch.setattr(notify_module, "webpush", _fake_webpush(sent_tags))

        result = notify_module.run_due_date_check(db)

        assert result["credit"] == 1
        assert "credit-%d" % unpaid_cp.id in sent_tags
        assert "credit-%d" % paid_cp.id not in sent_tags
    finally:
        db.close()


def test_run_due_date_check_skips_paid_bill_on_snooze_refire(monkeypatch):
    """Phase 2: a snoozed reminder whose bill has since been fully settled must
    not re-fire — a paid bill's snooze should not nag the user either."""
    db, user = _db()
    try:
        today = date.today()
        # Due date is well in the past so Phase 1 doesn't fire it directly;
        # the snooze re-fire in Phase 2 is what's under test.
        paid_cp = _bill(user.id, today - timedelta(days=10), total=500.0)
        db.add(paid_cp)
        db.commit()
        db.refresh(paid_cp)

        db.add(Transaction(
            owner_id=user.id, type=TransactionType.expense, amount=500.0,
            currency="TRY", date=today, description="KREDİ KARTI BORCU",
            category_key="credit-card-payment",
            settles_credit_payment_id=paid_cp.id,
        ))
        db.add(ReminderSnooze(
            owner_id=user.id, item_type="credit", item_id=paid_cp.id,
            snoozed_until=today,
        ))
        db.commit()

        sent_tags = []
        monkeypatch.setattr(notify_module, "webpush", _fake_webpush(sent_tags))

        result = notify_module.run_due_date_check(db)

        assert result["credit"] == 0
        assert "credit-%d" % paid_cp.id not in sent_tags
        # Snooze row is one-shot: deleted whether or not it re-fired.
        remaining = db.query(ReminderSnooze).filter(ReminderSnooze.item_id == paid_cp.id).all()
        assert remaining == []
    finally:
        db.close()


def test_cp_is_paid_true_only_when_settlement_state_paid():
    """Unit-level sanity check on the SQL SUM shape _cp_is_paid uses, independent
    of the full daily-scan flow above."""
    db, user = _db()
    try:
        today = date.today()
        cp = _bill(user.id, today, total=1000.0)
        db.add(cp)
        db.commit()
        db.refresh(cp)

        # No settling transaction yet -> unpaid.
        assert notify_module._cp_is_paid(db, cp) is False

        # Partial settlement -> still not "paid".
        db.add(Transaction(
            owner_id=user.id, type=TransactionType.expense, amount=400.0,
            currency="TRY", date=today, description="KREDİ KARTI BORCU",
            category_key="credit-card-payment",
            settles_credit_payment_id=cp.id,
        ))
        db.commit()
        assert notify_module._cp_is_paid(db, cp) is False

        # Top up to the full amount -> now "paid".
        db.add(Transaction(
            owner_id=user.id, type=TransactionType.expense, amount=600.0,
            currency="TRY", date=today, description="KREDİ KARTI BORCU",
            category_key="credit-card-payment",
            settles_credit_payment_id=cp.id,
        ))
        db.commit()
        assert notify_module._cp_is_paid(db, cp) is True
    finally:
        db.close()
