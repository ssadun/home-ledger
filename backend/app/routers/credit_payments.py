from typing import List, Optional
from datetime import date as date_type
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import CreditPayment, Account, Transaction, User
from app.schemas import CreditPaymentCreate, CreditPaymentUpdate, CreditPaymentOut
from app.services.auth import get_current_user
from app.services.ocr import save_upload
from app.services.bank_import import parse_bank_file, import_transactions

router = APIRouter(prefix="/api/credit-payments", tags=["credit-payments"])

MONTHS = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ── helpers ─────────────────────────────────────────────────────────────────────

def _minus_one_month(d: date_type) -> date_type:
    """First fallback for a statement window start: same day, previous month."""
    year = d.year - 1 if d.month == 1 else d.year
    month = 12 if d.month == 1 else d.month - 1
    # Clamp the day so e.g. Mar 31 → Feb 28.
    day = min(d.day, [31, 29 if year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
                      else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1])
    return date_type(year, month, day)


def _card_refs(rec: CreditPayment) -> list[str]:
    """A spending references its card via Transaction.payment_method, which may hold
    either the numeric account id (current picker) or the 'acc-N' account_key."""
    refs = []
    if rec.account_id is not None:
        refs.append(str(rec.account_id))
    if rec.account_key:
        refs.append(rec.account_key)
    return refs


def _compute_name(db: Session, rec: CreditPayment) -> str:
    card = None
    if rec.account_id is not None:
        card = db.query(Account).filter(Account.id == rec.account_id).first()
    label = (card.card_name or card.name) if card else "Card"
    yy = rec.period_year or 0
    mm = rec.period_month or 0
    return f"{yy:04d}.{mm:02d} - {label}"


def _period_start(db: Session, rec: CreditPayment) -> Optional[date_type]:
    """Statement window start = day after the previous record's cutover for the same
    card; otherwise one month before this record's cutover."""
    if not rec.cutover_date:
        return None
    prev = (
        db.query(CreditPayment)
        .filter(
            CreditPayment.owner_id == rec.owner_id,
            CreditPayment.account_key == rec.account_key,
            CreditPayment.id != rec.id,
            CreditPayment.cutover_date.isnot(None),
            CreditPayment.cutover_date < rec.cutover_date,
        )
        .order_by(CreditPayment.cutover_date.desc())
        .first()
    )
    if prev and prev.cutover_date:
        return prev.cutover_date
    return _minus_one_month(rec.cutover_date)


def _relink_spendings(db: Session, rec: CreditPayment) -> None:
    """Recompute which spendings belong to this statement (card + cutover window)."""
    # Detach any previously-linked rows so a changed window doesn't keep stale links.
    db.query(Transaction).filter(
        Transaction.owner_id == rec.owner_id,
        Transaction.credit_payment_id == rec.id,
    ).update({Transaction.credit_payment_id: None}, synchronize_session=False)

    refs = _card_refs(rec)
    start = _period_start(db, rec)
    if refs and rec.cutover_date and start is not None:
        db.query(Transaction).filter(
            Transaction.owner_id == rec.owner_id,
            Transaction.payment_method.in_(refs),
            Transaction.date > start,
            Transaction.date <= rec.cutover_date,
        ).update({Transaction.credit_payment_id: rec.id}, synchronize_session=False)
    db.commit()


def _serialize(db: Session, rec: CreditPayment) -> CreditPaymentOut:
    rec.linked_count = (
        db.query(Transaction)
        .filter(Transaction.credit_payment_id == rec.id)
        .count()
    )
    return CreditPaymentOut.model_validate(rec)


def _get_owned(db: Session, cp_id: int, user: User) -> CreditPayment:
    rec = db.query(CreditPayment).filter(
        CreditPayment.id == cp_id, CreditPayment.owner_id == user.id
    ).first()
    if not rec:
        raise HTTPException(404, "Ekstre kaydı bulunamadı")
    return rec


# ── CRUD ────────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[CreditPaymentOut])
def list_credit_payments(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    recs = (
        db.query(CreditPayment)
        .filter(CreditPayment.owner_id == current_user.id)
        .order_by(CreditPayment.payment_date.desc().nullslast(), CreditPayment.id.desc())
        .all()
    )
    return [_serialize(db, r) for r in recs]


@router.post("/", response_model=CreditPaymentOut, status_code=201)
def create_credit_payment(
    payload: CreditPaymentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = CreditPayment(**payload.model_dump(), owner_id=current_user.id)
    # Backfill account_key from the account when only the id was supplied.
    if rec.account_id is not None and not rec.account_key:
        card = db.query(Account).filter(
            Account.id == rec.account_id, Account.owner_id == current_user.id
        ).first()
        if card:
            rec.account_key = card.account_key
    rec.name = _compute_name(db, rec)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    _relink_spendings(db, rec)
    db.refresh(rec)
    return _serialize(db, rec)


@router.patch("/{cp_id}", response_model=CreditPaymentOut)
def update_credit_payment(
    cp_id: int,
    payload: CreditPaymentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = _get_owned(db, cp_id, current_user)
    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        setattr(rec, field, value)
    if rec.account_id is not None and "account_id" in data and not payload.account_key:
        card = db.query(Account).filter(
            Account.id == rec.account_id, Account.owner_id == current_user.id
        ).first()
        if card:
            rec.account_key = card.account_key
    rec.name = _compute_name(db, rec)
    db.commit()
    db.refresh(rec)
    # Re-link if anything affecting the window changed.
    if {"account_id", "account_key", "cutover_date"} & set(data.keys()):
        _relink_spendings(db, rec)
        db.refresh(rec)
    return _serialize(db, rec)


@router.delete("/{cp_id}", status_code=204)
def delete_credit_payment(cp_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = _get_owned(db, cp_id, current_user)
    # Detach linked spendings (keep the transactions themselves).
    db.query(Transaction).filter(
        Transaction.owner_id == current_user.id,
        Transaction.credit_payment_id == rec.id,
    ).update({Transaction.credit_payment_id: None}, synchronize_session=False)
    # Remove the stored statement file.
    if rec.statement_path:
        try:
            Path(rec.statement_path).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(rec)
    db.commit()


# ── Statement attachment ─────────────────────────────────────────────────────────

@router.post("/{cp_id}/statement/preview")
async def preview_statement(
    cp_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store the uploaded statement as the record's attachment and return parsed
    rows for review (nothing is written to transactions yet)."""
    rec = _get_owned(db, cp_id, current_user)
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("xls", "xlsx", "csv", "pdf"):
        raise HTTPException(400, "Desteklenen formatlar: XLS, XLSX, CSV, PDF")

    content = await file.read()
    safe = Path(filename).name if filename else f"statement.{ext}"
    stored_name = f"{current_user.id}_cp{rec.id}_{safe}"
    path = save_upload(content, stored_name)

    rec.statement_path = path
    rec.statement_filename = filename or stored_name
    rec.statement_mime = file.content_type
    db.commit()

    result = parse_bank_file(content=content, filename=filename, bank_hint="auto", db=db)
    return result


@router.post("/{cp_id}/statement/confirm")
def confirm_statement(
    cp_id: int,
    payload: dict,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Save reviewed statement rows as spendings tagged to this record + card."""
    rec = _get_owned(db, cp_id, current_user)
    rows = payload.get("rows", [])
    skip_duplicates = payload.get("skip_duplicates", True)
    if not rows:
        raise HTTPException(400, "İçe aktarılacak işlem yok")

    card_ref = _card_refs(rec)[0] if _card_refs(rec) else None
    result = import_transactions(
        db=db,
        owner_id=current_user.id,
        rows=rows,
        skip_duplicates=skip_duplicates,
        credit_payment_id=rec.id,
        default_payment_method=card_ref,
        # The parser tags the payment line as "credit-card-payment"; any row it
        # leaves uncategorized (ordinary purchases) defaults to "shopping".
        default_category_key="shopping",
        source_filename=rec.statement_filename,
    )
    # Pull in any pre-existing spendings in the window too.
    _relink_spendings(db, rec)
    db.refresh(rec)
    result["record"] = _serialize(db, rec).model_dump()
    return result


@router.get("/{cp_id}/statement")
def download_statement(cp_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = _get_owned(db, cp_id, current_user)
    if not rec.statement_path or not Path(rec.statement_path).exists():
        raise HTTPException(404, "Ekstre dosyası bulunamadı")
    return FileResponse(
        rec.statement_path,
        filename=rec.statement_filename or Path(rec.statement_path).name,
        media_type=rec.statement_mime or "application/octet-stream",
    )
