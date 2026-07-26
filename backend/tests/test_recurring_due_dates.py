from datetime import date

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.models import Base, LocalHoliday, RecurringExpense
from app.services.recurring import compute_next_due


def _session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    Session = sessionmaker(bind=engine)
    return Session()


def test_monthly_next_due_uses_payment_day_in_current_month():
    db = _session()
    rec = RecurringExpense(
        owner_id=1,
        name="Rent",
        amount=100,
        currency="TRY",
        status="active",
        frequency="monthly",
        day_of_month=28,
        weekend_rule="none",
        start_date=date(2026, 1, 1),
    )

    assert compute_next_due(rec, db, from_date=date(2026, 7, 26)) == date(2026, 7, 28)


def test_monthly_next_due_moves_to_next_month_when_adjusted_date_passed():
    db = _session()
    rec = RecurringExpense(
        owner_id=1,
        name="Subscription",
        amount=100,
        currency="TRY",
        status="active",
        frequency="monthly",
        day_of_month=26,
        weekend_rule="advance",
        start_date=date(2026, 1, 1),
    )

    assert compute_next_due(rec, db, from_date=date(2026, 7, 26)) == date(2026, 8, 26)


def test_monthly_next_due_defers_over_local_holiday():
    db = _session()
    db.add(LocalHoliday(country="TR", date=date(2026, 7, 27), name="Local Holiday"))
    db.commit()
    rec = RecurringExpense(
        owner_id=1,
        name="Bill",
        amount=100,
        currency="TRY",
        status="active",
        frequency="monthly",
        day_of_month=26,
        weekend_rule="defer",
        start_date=date(2026, 1, 1),
    )

    assert compute_next_due(rec, db, from_date=date(2026, 7, 26)) == date(2026, 7, 28)


def test_monthly_next_due_advances_before_local_holiday():
    db = _session()
    db.add(LocalHoliday(country="TR", date=date(2026, 8, 3), name="Local Holiday"))
    db.commit()
    rec = RecurringExpense(
        owner_id=1,
        name="Bill",
        amount=100,
        currency="TRY",
        status="active",
        frequency="monthly",
        day_of_month=3,
        weekend_rule="advance",
        start_date=date(2026, 1, 1),
    )

    assert compute_next_due(rec, db, from_date=date(2026, 7, 26)) == date(2026, 7, 31)
