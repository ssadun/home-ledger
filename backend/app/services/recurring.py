import calendar
from datetime import date, timedelta
from typing import Optional, Set

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from app.models import LocalHoliday, RecurringExpense
from app.services.prepaid import apply_recurring_occurrences


def _monthly_target_day(year: int, month: int, day_of_month: Optional[int]) -> int:
    dim = calendar.monthrange(year, month)[1]
    if day_of_month is None or day_of_month == -1:
        return dim
    return min(day_of_month, dim)


def _advance_once(anchor: date, frequency: str, day_of_month: Optional[int]) -> date:
    if frequency == "daily":
        return anchor + timedelta(days=1)
    if frequency == "weekly":
        return anchor + timedelta(days=7)
    nxt = anchor + relativedelta(months=1)
    day = _monthly_target_day(nxt.year, nxt.month, day_of_month)
    return date(nxt.year, nxt.month, day)


def _holiday_dates(db: Session) -> Set[date]:
    return {
        row[0] for row in db.query(LocalHoliday.date).filter(
            LocalHoliday.is_active == True,  # noqa: E712
            LocalHoliday.affects_due_dates == True,  # noqa: E712
        ).all()
    }


def _is_non_working_day(d: date, holidays: Set[date]) -> bool:
    return d.weekday() >= 5 or d in holidays


def _apply_business_day_rule(d: date, rule: str, holidays: Set[date]) -> date:
    if rule == "defer":
        while _is_non_working_day(d, holidays):
            d += timedelta(days=1)
    elif rule == "advance":
        while _is_non_working_day(d, holidays):
            d -= timedelta(days=1)
    return d


def _monthly_anchor_for(base: date, day_of_month: Optional[int]) -> date:
    day = _monthly_target_day(base.year, base.month, day_of_month)
    return date(base.year, base.month, day)


def compute_next_due(rec: RecurringExpense, db: Session, from_date: Optional[date] = None) -> Optional[date]:
    """Compute the next effective due date from the record's own schedule.

    Monthly records use ``day_of_month`` applied to the current month, then shift
    for weekends/local holidays according to ``weekend_rule``. If that effective
    date already passed, the following occurrence is used. This intentionally
    does not trust a client-provided ``next_due`` value.
    """
    if (rec.status or "active") != "active":
        return rec.next_due
    today = from_date or date.today()
    base = max(today, rec.start_date) if rec.start_date else today
    holidays = _holiday_dates(db)
    frequency = rec.frequency or "monthly"

    if frequency == "daily":
        anchor = rec.next_due or rec.start_date or today
        if anchor < base:
            anchor = base
        effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
        while effective < base:
            anchor += timedelta(days=1)
            effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
    elif frequency == "weekly":
        anchor = rec.next_due or rec.start_date or today
        while anchor < base:
            anchor += timedelta(days=7)
        effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
        while effective < base:
            anchor += timedelta(days=7)
            effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
    else:
        anchor = _monthly_anchor_for(base, rec.day_of_month)
        effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
        guard = 0
        while effective < base and guard < 120:
            anchor = _advance_once(anchor, "monthly", rec.day_of_month)
            effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
            guard += 1

    if rec.end_date and effective > rec.end_date:
        return None
    return effective


def refresh_next_due(rec: RecurringExpense, db: Session, from_date: Optional[date] = None) -> None:
    rec.next_due = compute_next_due(rec, db, from_date=from_date)


def roll_forward_due_dates(db: Session, owner_id: Optional[int] = None) -> int:
    """Advance ``next_due`` for active recurring items whose due date has
    already passed, stepping by ``frequency``/``day_of_month`` (and applying
    ``weekend_rule``) until it lands on or after today. ``next_due`` was
    historically written once at creation time and never revisited, so any
    item whose last occurrence had already passed silently stopped appearing
    in the calendar / subscriptions list / due-date push scan. Month math
    advances from the un-deferred anchor date each step (not the
    weekend-adjusted one) so a deferred last-day-of-month due date can't
    skip a month. Items past ``end_date`` are left alone rather than
    advanced beyond their lifetime."""
    today = date.today()
    q = db.query(RecurringExpense).filter(
        RecurringExpense.status == "active",
        RecurringExpense.next_due.isnot(None),
        RecurringExpense.next_due < today,
    )
    if owner_id is not None:
        q = q.filter(RecurringExpense.owner_id == owner_id)

    updated = 0
    holidays = _holiday_dates(db)
    for rec in q.all():
        anchor = rec.next_due
        effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
        guard = 0
        occurrences = 0
        while effective < today and guard < 1000:
            anchor = _advance_once(anchor, rec.frequency or "monthly", rec.day_of_month)
            if rec.end_date and anchor > rec.end_date:
                break
            effective = _apply_business_day_rule(anchor, rec.weekend_rule or "none", holidays)
            guard += 1
            occurrences += 1
        if effective != rec.next_due:
            rec.next_due = effective
            updated += 1
            # Each step above is one due date that came and went, so a prepaid card
            # funding this item is drawn down once per occurrence. Safe to do on every
            # read path: we only ever advance a `next_due` that is in the past, and the
            # advance leaves it in the future, so an occurrence is counted exactly once.
            apply_recurring_occurrences(db, rec, occurrences)

    # Correct future monthly dates that were previously saved from the modal's
    # start date instead of the record's payment day.
    normalize_q = db.query(RecurringExpense).filter(
        RecurringExpense.status == "active",
        RecurringExpense.frequency == "monthly",
    )
    if owner_id is not None:
        normalize_q = normalize_q.filter(RecurringExpense.owner_id == owner_id)
    for rec in normalize_q.all():
        if rec.next_due and rec.next_due < today:
            continue
        expected = compute_next_due(rec, db, from_date=today)
        if expected != rec.next_due:
            rec.next_due = expected
            updated += 1

    if updated:
        db.commit()
    return updated
