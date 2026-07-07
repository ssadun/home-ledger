from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.config import settings
from app.models import PushSubscription, User
from app.schemas import (
    NotifyPrefsOut, NotifyPrefsUpdate,
    PushSubscriptionCreate, PushSubscriptionOut, PushUnsubscribe,
)
from app.services.auth import get_current_user
from app.services.notify import (
    run_due_date_check, send_credit_preview, send_recurring_preview, send_to_user,
)

router = APIRouter(prefix="/api/push", tags=["push"])


@router.get("/vapid-public-key")
def get_vapid_public_key():
    return {"public_key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", response_model=PushSubscriptionOut, status_code=201)
def subscribe(
    payload: PushSubscriptionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    sub = db.query(PushSubscription).filter(PushSubscription.endpoint == payload.endpoint).first()
    if not sub:
        sub = PushSubscription(endpoint=payload.endpoint, owner_id=current_user.id)
        db.add(sub)
    sub.owner_id = current_user.id
    sub.p256dh = payload.keys.get("p256dh", "")
    sub.auth = payload.keys.get("auth", "")
    sub.user_agent = payload.user_agent
    db.commit()
    db.refresh(sub)
    return sub


@router.post("/unsubscribe", status_code=204)
def unsubscribe(
    payload: PushUnsubscribe,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == payload.endpoint,
        PushSubscription.owner_id == current_user.id,
    ).delete()
    db.commit()


@router.get("/prefs", response_model=NotifyPrefsOut)
def get_prefs(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    subscribed = db.query(PushSubscription).filter(PushSubscription.owner_id == current_user.id).count() > 0
    return NotifyPrefsOut(notify_lead_days=current_user.notify_lead_days or 0, subscribed=subscribed)


@router.patch("/prefs", response_model=NotifyPrefsOut)
def update_prefs(
    payload: NotifyPrefsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    current_user.notify_lead_days = payload.notify_lead_days
    db.commit()
    subscribed = db.query(PushSubscription).filter(PushSubscription.owner_id == current_user.id).count() > 0
    return NotifyPrefsOut(notify_lead_days=current_user.notify_lead_days or 0, subscribed=subscribed)


@router.post("/test")
def send_test_push(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Send one test notification to the current user's subscriptions — for
    verifying VAPID keys + delivery without waiting for a real due date."""
    summary = send_to_user(db, current_user, "Home Ledger", "Test notification — push is working.", "/Dashboard.html")
    if summary["total"] == 0:
        raise HTTPException(status_code=400, detail="No subscribed devices — enable notifications on this device first.")
    if summary["sent"] == 0:
        detail = summary["errors"][0] if summary["errors"] else "delivery failed"
        raise HTTPException(status_code=502, detail=f"Push delivery failed: {detail}")
    return {"ok": True, **summary}


@router.post("/test-credit")
def send_test_credit(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Preview the real credit-card due reminder: renders the user's most recent
    statement (ignoring its due date) and pushes it — so you can see the enriched
    format without waiting for the scheduled scan to match a due date."""
    summary = send_credit_preview(db, current_user)
    if summary is None:
        raise HTTPException(status_code=404, detail="No credit-card statements to preview.")
    if summary["total"] == 0:
        raise HTTPException(status_code=400, detail="No subscribed devices — enable notifications on this device first.")
    if summary["sent"] == 0:
        detail = summary["errors"][0] if summary["errors"] else "delivery failed"
        raise HTTPException(status_code=502, detail=f"Push delivery failed: {detail}")
    return {"ok": True, **summary}


@router.post("/test-recurring")
def send_test_recurring(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Preview the real recurring bill / subscription reminder: renders the user's
    most recent recurring item (ignoring its due date) and pushes it — so you can
    see the enriched format without waiting for the scheduled scan to match."""
    summary = send_recurring_preview(db, current_user)
    if summary is None:
        raise HTTPException(status_code=404, detail="No recurring items to preview.")
    if summary["total"] == 0:
        raise HTTPException(status_code=400, detail="No subscribed devices — enable notifications on this device first.")
    if summary["sent"] == 0:
        detail = summary["errors"][0] if summary["errors"] else "delivery failed"
        raise HTTPException(status_code=502, detail=f"Push delivery failed: {detail}")
    return {"ok": True, **summary}


@router.post("/run-check")
def trigger_due_date_check(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Manually trigger the daily due-date scan (normally runs on a schedule) —
    useful for verifying the date-matching logic on demand."""
    return run_due_date_check(db)
