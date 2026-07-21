import calendar
from datetime import date, timedelta
from typing import Optional

from dateutil.relativedelta import relativedelta
from sqlalchemy.orm import Session

from app.models import RecurringExpense
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


def _apply_weekend_rule(d: date, rule: str) -> date:
    if rule == "defer":
        while d.weekday() >= 5:  # Sat=5, Sun=6
            d += timedelta(days=1)
    elif rule == "advance":
        while d.weekday() >= 5:
            d -= timedelta(days=1)
    return d


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
    for rec in q.all():
        anchor = rec.next_due
        effective = _apply_weekend_rule(anchor, rec.weekend_rule or "none")
        guard = 0
        occurrences = 0
        while effective < today and guard < 1000:
            anchor = _advance_once(anchor, rec.frequency or "monthly", rec.day_of_month)
            if rec.end_date and anchor > rec.end_date:
                break
            effective = _apply_weekend_rule(anchor, rec.weekend_rule or "none")
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

    if updated:
        db.commit()
    return updated
