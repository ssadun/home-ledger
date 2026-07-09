import json
from datetime import date, timedelta

from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

from app.config import settings
from app.models import (
    Account, CreditPayment, PushSubscription, ReminderSnooze, RecurringExpense, User,
)

# Snooze durations offered by the notification action buttons, in days. The
# /api/push/snooze route rejects anything not in this allowlist.
SNOOZE_DAYS_ALLOWED = {1, 3, 7}

_CURRENCY_SYMBOL = {"TRY": "₺", "USD": "$", "EUR": "€"}


def _fmt_amount(amount: float, currency: str) -> str:
    """Human-friendly money string, e.g. ``₺172,102.39`` — currency symbol +
    grouped thousands. Falls back to ``172,102.39 GBP`` for symbol-less codes."""
    value = f"{amount or 0:,.2f}"
    symbol = _CURRENCY_SYMBOL.get((currency or "").upper())
    return f"{symbol}{value}" if symbol else f"{value} {currency}".strip()


def send_to_user(
    db: Session, user: User, title: str, body: str, url: str,
    item_type: str = None, item_id: int = None,
) -> dict:
    """Push a notification to every subscription this user has. Returns a summary
    ``{"total", "sent", "failed", "removed", "errors"}`` so callers (e.g. the
    /test endpoint) can surface delivery failures instead of reporting a blind
    success. One bad endpoint never stops the others.

    When ``item_type``/``item_id`` are given, the payload carries the item's
    identity (`type`/`id`) so the service worker can offer Snooze action buttons,
    plus a per-item ``tag`` (``"recurring-12"``) so distinct reminders no longer
    collapse onto the shared ``"home-ledger"`` tag."""
    subs = db.query(PushSubscription).filter(PushSubscription.owner_id == user.id).all()
    data = {"title": title, "body": body, "url": url}
    if item_type and item_id is not None:
        data["type"] = item_type
        data["id"] = item_id
        data["tag"] = f"{item_type}-{item_id}"
    payload = json.dumps(data)
    result = {"total": len(subs), "sent": 0, "failed": 0, "removed": 0, "errors": []}
    for sub in subs:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub.endpoint,
                    "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
                },
                data=payload,
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": f"mailto:{settings.VAPID_CLAIMS_EMAIL}"},
            )
            result["sent"] += 1
        except WebPushException as ex:
            status_code = getattr(ex.response, "status_code", None)
            result["failed"] += 1
            result["errors"].append(f"push service returned {status_code}")
            if status_code in (404, 410):
                # Browser expired/removed this subscription — stop trying it.
                db.delete(sub)
                db.commit()
                result["removed"] += 1
        except Exception as ex:
            # Network failure, DNS, timeout, etc. — record it (a silent swallow
            # here is what once hid a broken-DNS outage where nothing delivered)
            # but keep going so other devices/users still get their reminders.
            result["failed"] += 1
            result["errors"].append(f"{type(ex).__name__}: {ex}")
    return result


def _snooze_for(db: Session, owner_id: int, item_type: str, item_id: int):
    """The active snooze row for this exact item, or ``None``."""
    return db.query(ReminderSnooze).filter(
        ReminderSnooze.owner_id == owner_id,
        ReminderSnooze.item_type == item_type,
        ReminderSnooze.item_id == item_id,
    ).first()


def run_due_date_check(db: Session) -> dict:
    """Daily job body: for each user, push a reminder for any recurring bill/
    subscription or credit-card statement whose due date lands exactly on
    today + that user's notify_lead_days.

    Two-phase, so per-item snoozes are respected:
      1. Normally-due items are sent — unless a snooze row exists for that item,
         in which case the snooze re-fire owns it and we skip here.
      2. Any snooze whose ``snoozed_until <= today`` is re-sent, then its row is
         deleted (``<=`` so a day the scan didn't run never strands a snooze)."""
    today = date.today()
    sent = {"recurring": 0, "credit": 0}

    users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
    for user in users:
        target = today + timedelta(days=user.notify_lead_days or 0)

        # Phase 1 — normally-due items, skipping any that are being snoozed.
        recs = db.query(RecurringExpense).filter(
            RecurringExpense.owner_id == user.id,
            RecurringExpense.is_active == True,  # noqa: E712
            RecurringExpense.next_due == target,
        ).all()
        for rec in recs:
            if _snooze_for(db, user.id, "recurring", rec.id):
                continue
            title, body, url = build_recurring_message(rec, user)
            send_to_user(db, user, title=title, body=body, url=url,
                         item_type="recurring", item_id=rec.id)
            sent["recurring"] += 1

        cps = db.query(CreditPayment).filter(
            CreditPayment.owner_id == user.id,
            CreditPayment.payment_date == target,
        ).all()
        for cp in cps:
            if _snooze_for(db, user.id, "credit", cp.id):
                continue
            title, body, url = build_credit_message(db, cp, user)
            send_to_user(db, user, title=title, body=body, url=url,
                         item_type="credit", item_id=cp.id)
            sent["credit"] += 1

        # Phase 2 — snooze re-fires that have come due.
        due_snoozes = db.query(ReminderSnooze).filter(
            ReminderSnooze.owner_id == user.id,
            ReminderSnooze.snoozed_until <= today,
        ).all()
        for snooze in due_snoozes:
            if snooze.item_type == "recurring":
                rec = db.query(RecurringExpense).filter(
                    RecurringExpense.id == snooze.item_id,
                    RecurringExpense.owner_id == user.id,
                ).first()
                if rec is not None:
                    title, body, url = build_recurring_message(rec, user)
                    send_to_user(db, user, title=title, body=body, url=url,
                                 item_type="recurring", item_id=rec.id)
                    sent["recurring"] += 1
            elif snooze.item_type == "credit":
                cp = db.query(CreditPayment).filter(
                    CreditPayment.id == snooze.item_id,
                    CreditPayment.owner_id == user.id,
                ).first()
                if cp is not None:
                    title, body, url = build_credit_message(db, cp, user)
                    send_to_user(db, user, title=title, body=body, url=url,
                                 item_type="credit", item_id=cp.id)
                    sent["credit"] += 1
            # One-shot: delete whether or not the item still exists (a deleted item
            # should not keep the row around forever).
            db.delete(snooze)
        db.commit()

    return sent


def apply_snooze(db: Session, owner_id: int, item_type: str, item_id: int, days: int) -> date:
    """Upsert a one-shot snooze for an item owned by ``owner_id``, re-firing in
    ``days`` days. Validates ``item_type``, the ``days`` allowlist, and that the
    item actually belongs to the owner. Returns the ``snoozed_until`` date."""
    if item_type not in ("recurring", "credit"):
        raise ValueError(f"unknown item_type: {item_type!r}")
    if days not in SNOOZE_DAYS_ALLOWED:
        raise ValueError(f"days not allowed: {days!r}")

    model = RecurringExpense if item_type == "recurring" else CreditPayment
    owned = db.query(model).filter(model.id == item_id, model.owner_id == owner_id).first()
    if owned is None:
        raise ValueError(f"{item_type} {item_id} not found for this user")

    snoozed_until = date.today() + timedelta(days=days)
    snooze = _snooze_for(db, owner_id, item_type, item_id)
    if snooze is None:
        snooze = ReminderSnooze(
            owner_id=owner_id, item_type=item_type, item_id=item_id,
            snoozed_until=snoozed_until,
        )
        db.add(snooze)
    else:
        snooze.snoozed_until = snoozed_until
    db.commit()
    return snoozed_until


def build_credit_message(db: Session, cp: CreditPayment, user: User):
    """Compose ``(title, body, url)`` for a credit-card statement's due reminder,
    e.g. ``2026.06 - SADUN SEVINGEN - Due - ₺172,102.39`` / ``Upcoming Due: Garanti
    Bonus Platinum``. Shared by the daily scan and the /test-credit preview so the
    two never drift."""
    acct = db.query(Account).filter(Account.id == cp.account_id).first() if cp.account_id else None
    currency = cp.currency.value if cp.currency else ""
    # "2026.06" statement period.
    period = f"{cp.period_year}.{cp.period_month:02d}" if cp.period_year and cp.period_month else ""
    # Who owes it: the card's holder label, else the account owner's name.
    holder = ((acct.holder if acct and acct.holder else user.full_name) or "").upper()
    # Card name: prefer the Account, else strip the "YYYY.MM - " prefix off cp.name.
    card = (acct and (acct.card_name or acct.name)) or (
        (cp.name or "").split(" - ", 1)[-1] if cp.name else "Credit card"
    )
    due_label = "Due" if not user.notify_lead_days else f"Due in {user.notify_lead_days}d"
    headline = " - ".join(
        p for p in (period, holder, due_label, _fmt_amount(cp.total_amount, currency)) if p
    )
    return headline, f"Upcoming Due: {card}", "/Credit Payments.html"


def build_recurring_message(rec: RecurringExpense, user: User):
    """Compose ``(title, body, url)`` for a recurring bill / subscription reminder,
    e.g. ``Netflix - SADUN - Due - ₺149.99`` / ``Upcoming Subscription: Istanbul CC``.
    Shared by the daily scan and the /test-recurring preview so they never drift."""
    currency = rec.currency.value if rec.currency else ""
    payer = (rec.payer or "").upper()
    due_label = "Due" if not user.notify_lead_days else f"Due in {user.notify_lead_days}d"
    headline = " - ".join(
        p for p in (rec.name, payer, due_label, _fmt_amount(rec.amount, currency)) if p
    )
    kind_label = "Subscription" if rec.kind == "subscription" else "Bill"
    body = f"Upcoming {kind_label}" + (f": {rec.source}" if rec.source else "")
    url = "/Subscriptions.html" if rec.kind == "subscription" else "/Recurring.html"
    return headline, body, url


def send_recurring_preview(db: Session, user: User):
    """Push the user's most recent recurring item as a reminder, ignoring its due
    date — previews the real notification format on demand. Returns the
    ``send_to_user`` summary, or ``None`` if the user has no recurring items."""
    rec = (
        db.query(RecurringExpense)
        .filter(RecurringExpense.owner_id == user.id)
        .order_by(RecurringExpense.id.desc())
        .first()
    )
    if rec is None:
        return None
    title, body, url = build_recurring_message(rec, user)
    return send_to_user(db, user, title=title, body=body, url=url,
                        item_type="recurring", item_id=rec.id)


def send_credit_preview(db: Session, user: User):
    """Push the user's most recent credit-card statement as a reminder, ignoring
    its due date — previews the real notification format on demand. Returns the
    ``send_to_user`` summary, or ``None`` if the user has no statements."""
    cp = (
        db.query(CreditPayment)
        .filter(CreditPayment.owner_id == user.id)
        .order_by(CreditPayment.id.desc())
        .first()
    )
    if cp is None:
        return None
    title, body, url = build_credit_message(db, cp, user)
    return send_to_user(db, user, title=title, body=body, url=url,
                        item_type="credit", item_id=cp.id)
