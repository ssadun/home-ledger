from typing import List, Optional
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Statement, Account, Transaction, User
from app.schemas import StatementCreate, StatementUpdate, StatementOut
from app.services.auth import get_current_user
from app.services.ocr import save_upload

router = APIRouter(prefix="/api/statements", tags=["statements"])


# ── helpers ─────────────────────────────────────────────────────────────────────

def _account_refs(rec: Statement) -> list[str]:
    """Every `Transaction.payment_method` value that means "this statement's account".

    Imports write the account_key ("acc-12"); the manual picker may store the bare
    numeric id, so both are matched — same convention as CreditPayment._card_refs.
    """
    refs = []
    if rec.account_id is not None:
        refs.append(str(rec.account_id))
    if rec.account_key:
        refs.append(rec.account_key)
    return refs


def _compute_name(db: Session, rec: Statement) -> str:
    """Standard record name: "YYYY.MM - Account Name"."""
    acc = None
    if rec.account_id is not None:
        acc = db.query(Account).filter(Account.id == rec.account_id).first()
    label = acc.name if acc else "Account"
    yy = rec.period_year or 0
    mm = rec.period_month or 0
    return f"{yy:04d}.{mm:02d} - {label}"


def _relink_transactions(db: Session, rec: Statement) -> None:
    """Recompute which movements belong to this statement (account + period window).

    Credit-card spendings are excluded (`credit_payment_id IS NULL`): a card line
    already belongs to a CreditPayment, and a statement must never claim it.
    """
    # Detach previously-linked rows first so a changed window doesn't keep stale links.
    db.query(Transaction).filter(
        Transaction.owner_id == rec.owner_id,
        Transaction.statement_id == rec.id,
    ).update({Transaction.statement_id: None}, synchronize_session=False)

    refs = _account_refs(rec)
    if refs and rec.period_from and rec.period_to:
        db.query(Transaction).filter(
            Transaction.owner_id == rec.owner_id,
            Transaction.payment_method.in_(refs),
            Transaction.credit_payment_id.is_(None),
            Transaction.date >= rec.period_from,
            Transaction.date <= rec.period_to,
        ).update({Transaction.statement_id: rec.id}, synchronize_session=False)
    db.commit()


def _serialize(db: Session, rec: Statement) -> StatementOut:
    rec.linked_count = (
        db.query(Transaction)
        .filter(Transaction.statement_id == rec.id)
        .count()
    )
    return StatementOut.model_validate(rec)


def _get_owned(db: Session, st_id: int, user: User) -> Statement:
    rec = db.query(Statement).filter(
        Statement.id == st_id, Statement.owner_id == user.id
    ).first()
    if not rec:
        raise HTTPException(404, "Ekstre kaydı bulunamadı")
    return rec


def _backfill_account_key(db: Session, rec: Statement, owner_id: int) -> None:
    if rec.account_id is not None and not rec.account_key:
        acc = db.query(Account).filter(
            Account.id == rec.account_id, Account.owner_id == owner_id
        ).first()
        if acc:
            rec.account_key = acc.account_key


# ── CRUD ────────────────────────────────────────────────────────────────────────

@router.get("/", response_model=List[StatementOut])
def list_statements(
    account_id: Optional[int] = None,
    year: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Statement).filter(Statement.owner_id == current_user.id)
    if account_id is not None:
        q = q.filter(Statement.account_id == account_id)
    if year is not None:
        q = q.filter(Statement.period_year == year)
    recs = q.order_by(
        Statement.period_year.desc().nullslast(),
        Statement.period_month.desc().nullslast(),
        Statement.id.desc(),
    ).all()
    return [_serialize(db, r) for r in recs]


@router.post("/", response_model=StatementOut, status_code=201)
def create_statement(
    payload: StatementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = Statement(**payload.model_dump(), owner_id=current_user.id)
    _backfill_account_key(db, rec, current_user.id)
    rec.name = _compute_name(db, rec)
    db.add(rec)
    db.commit()
    db.refresh(rec)
    _relink_transactions(db, rec)
    db.refresh(rec)
    return _serialize(db, rec)


@router.patch("/{st_id}", response_model=StatementOut)
def update_statement(
    st_id: int,
    payload: StatementUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rec = _get_owned(db, st_id, current_user)
    data = payload.model_dump(exclude_none=True)
    for field, value in data.items():
        setattr(rec, field, value)
    if "account_id" in data and not payload.account_key:
        rec.account_key = None
        _backfill_account_key(db, rec, current_user.id)
    rec.name = _compute_name(db, rec)
    db.commit()
    db.refresh(rec)
    if {"account_id", "account_key", "period_from", "period_to"} & set(data.keys()):
        _relink_transactions(db, rec)
        db.refresh(rec)
    return _serialize(db, rec)


@router.delete("/{st_id}", status_code=204)
def delete_statement(st_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete the record and its file. The movements themselves survive — they are
    ordinary Account Activity rows and only lose their statement link."""
    rec = _get_owned(db, st_id, current_user)
    db.query(Transaction).filter(
        Transaction.owner_id == current_user.id,
        Transaction.statement_id == rec.id,
    ).update({Transaction.statement_id: None}, synchronize_session=False)
    if rec.file_path:
        try:
            Path(rec.file_path).unlink(missing_ok=True)
        except OSError:
            pass
    db.delete(rec)
    db.commit()


# ── Document attachment ─────────────────────────────────────────────────────────

@router.post("/{st_id}/file")
async def attach_file(
    st_id: int,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Store the uploaded statement as this record's attachment.

    Nothing is imported here — the import wizard has already written the rows and
    only needs the original document archived against the record it created.
    """
    rec = _get_owned(db, st_id, current_user)
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("xls", "xlsx", "csv", "pdf"):
        raise HTTPException(400, "Desteklenen formatlar: XLS, XLSX, CSV, PDF")

    content = await file.read()
    safe = Path(filename).name if filename else f"statement.{ext}"
    stored_name = f"{current_user.id}_st{rec.id}_{safe}"
    path = save_upload(content, stored_name)

    # Replacing a document leaves the previous file orphaned on disk otherwise.
    if rec.file_path and rec.file_path != path:
        try:
            Path(rec.file_path).unlink(missing_ok=True)
        except OSError:
            pass

    rec.file_path = path
    rec.file_filename = filename or stored_name
    rec.file_mime = file.content_type
    db.commit()
    db.refresh(rec)
    return _serialize(db, rec)


@router.get("/{st_id}/file")
def download_file(st_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rec = _get_owned(db, st_id, current_user)
    if not rec.file_path or not Path(rec.file_path).exists():
        raise HTTPException(404, "Ekstre dosyası bulunamadı")
    return FileResponse(
        rec.file_path,
        filename=rec.file_filename or Path(rec.file_path).name,
        media_type=rec.file_mime or "application/octet-stream",
    )
