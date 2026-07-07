import json
from datetime import date, timedelta

from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

from app.config import settings
from app.models import CreditPayment, PushSubscription, RecurringExpense, User


def send_to_user(db: Session, user: User, title: str, body: str, url: str) -> dict:
    """Push a notification to every subscription this user has. Returns a summary
    ``{"total", "sent", "failed", "removed", "errors"}`` so callers (e.g. the
    /test endpoint) can surface delivery failures instead of reporting a blind
    success. One bad endpoint never stops the others."""
    subs = db.query(PushSubscription).filter(PushSubscription.owner_id == user.id).all()
    payload = json.dumps({"title": title, "body": body, "url": url})
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


def run_due_date_check(db: Session) -> dict:
    """Daily job body: for each user, push a reminder for any recurring bill/
    subscription or credit-card statement whose due date lands exactly on
    today + that user's notify_lead_days."""
    today = date.today()
    sent = {"recurring": 0, "credit": 0}

    users = db.query(User).filter(User.is_active == True).all()  # noqa: E712
    for user in users:
        target = today + timedelta(days=user.notify_lead_days or 0)
        when = "today" if not user.notify_lead_days else f"in {user.notify_lead_days} day(s)"

        recs = db.query(RecurringExpense).filter(
            RecurringExpense.owner_id == user.id,
            RecurringExpense.is_active == True,  # noqa: E712
            RecurringExpense.next_due == target,
        ).all()
        for rec in recs:
            currency = rec.currency.value if rec.currency else ""
            send_to_user(
                db, user,
                title=f"{rec.name} due {when}",
                body=f"{rec.amount} {currency}".strip(),
                url="/Recurring.html" if rec.kind != "subscription" else "/Subscriptions.html",
            )
            sent["recurring"] += 1

        cps = db.query(CreditPayment).filter(
            CreditPayment.owner_id == user.id,
            CreditPayment.payment_date == target,
        ).all()
        for cp in cps:
            currency = cp.currency.value if cp.currency else ""
            send_to_user(
                db, user,
                title=f"{cp.name or 'Credit card payment'} due {when}",
                body=f"{cp.total_amount} {currency}".strip(),
                url="/Credit Payments.html",
            )
            sent["credit"] += 1

    return sent
