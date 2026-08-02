from typing import List, Optional
from datetime import date as date_type
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from app.database import get_db
from app.models import (
    Account, Asset, AssetValuation, Investment, InvestmentHolding,
    Statement, Transaction, User,
)
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


def _range_overlap(start_a: Optional[date_type], end_a: Optional[date_type], start_b: Optional[date_type], end_b: Optional[date_type]) -> bool:
    if not start_a or not end_a or not start_b or not end_b:
        return False
    return start_a <= end_b and end_a >= start_b


def _overlap_matches(
    db: Session,
    owner_id: int,
    account_id: Optional[int],
    account_key: Optional[str],
    period_from: Optional[date_type],
    period_to: Optional[date_type],
    exclude_id: Optional[int] = None,
) -> list[Statement]:
    if period_from is None or period_to is None:
        return []
    if period_from > period_to:
        raise HTTPException(400, "Statement period start must not be after its end.")
    account_refs = []
    if account_id is not None:
        account_refs.append(Statement.account_id == account_id)
    if account_key:
        account_refs.append(Statement.account_key == account_key)
    if not account_refs:
        return []
    q = db.query(Statement).filter(
        Statement.owner_id == owner_id,
        or_(*account_refs),
    )
    if exclude_id is not None:
        q = q.filter(Statement.id != exclude_id)
    return [
        rec for rec in q.all()
        if _range_overlap(period_from, period_to, rec.period_from, rec.period_to)
    ]


def _reject_overlap(matches: list[Statement]) -> None:
    if matches:
        raise HTTPException(
            409,
            "This account already has a statement covering an overlapping date range.",
        )


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


def _validate_statement_account(
    db: Session,
    owner_id: int,
    account_id: Optional[int],
    account_key: Optional[str],
) -> None:
    """Allow Statements for owned accounts except credit cards.

    Credit-card statements belong to Card Payments because they carry cutover and
    payment due dates. Debit cards have no due date and remain valid Statements.
    """
    if account_id is None and not account_key:
        return
    owned = db.query(Account).filter(Account.owner_id == owner_id)
    account = (
        owned.filter(Account.id == account_id).first()
        if account_id is not None
        else owned.filter(Account.account_key == account_key).first()
    )
    if not account:
        raise HTTPException(404, "Hesap bulunamadı")
    if account.type == "credit":
        raise HTTPException(
            400,
            "Credit card statements must be entered through Card Payments.",
        )


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


@router.get("/check-overlap")
def check_statement_overlap(
    account_id: Optional[int] = None,
    account_key: Optional[str] = None,
    period_from: Optional[date_type] = None,
    period_to: Optional[date_type] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    matches = [
        {
                "id": rec.id,
                "name": rec.name,
                "account_id": rec.account_id,
                "account_key": rec.account_key,
                "period_from": rec.period_from.isoformat() if rec.period_from else None,
                "period_to": rec.period_to.isoformat() if rec.period_to else None,
        }
        for rec in _overlap_matches(
            db, current_user.id, account_id, account_key, period_from, period_to
        )
    ]
    return {"count": len(matches), "matches": matches}


@router.post("/", response_model=StatementOut, status_code=201)
def create_statement(
    payload: StatementCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _validate_statement_account(
        db, current_user.id, payload.account_id, payload.account_key
    )
    rec = Statement(**payload.model_dump(), owner_id=current_user.id)
    _backfill_account_key(db, rec, current_user.id)
    _reject_overlap(_overlap_matches(
        db, current_user.id, rec.account_id, rec.account_key,
        rec.period_from, rec.period_to,
    ))
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
    _validate_statement_account(
        db,
        current_user.id,
        data.get("account_id", rec.account_id),
        data.get("account_key", rec.account_key),
    )
    next_account_id = data.get("account_id", rec.account_id)
    next_account_key = data.get("account_key", rec.account_key)
    if "account_id" in data and not payload.account_key:
        account = db.query(Account).filter(
            Account.id == next_account_id, Account.owner_id == current_user.id
        ).first()
        next_account_key = account.account_key if account else None
    _reject_overlap(_overlap_matches(
        db, current_user.id, next_account_id, next_account_key,
        data.get("period_from", rec.period_from),
        data.get("period_to", rec.period_to),
        exclude_id=rec.id,
    ))
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
    """Delete a statement and the imported data owned by its account kind.

    Bank/overdraft statements own their linked Account Activity movements. An
    investment statement is a current portfolio snapshot, so deleting it clears
    that account's canonical holdings and legacy Investment rows together.
    Other statement-capable account kinds keep the previous unlink-only behavior.
    """
    rec = _get_owned(db, st_id, current_user)
    account = None
    if rec.account_id is not None:
        account = db.query(Account).filter(
            Account.id == rec.account_id,
            Account.owner_id == current_user.id,
        ).first()

    linked_transactions = db.query(Transaction).filter(
        Transaction.owner_id == current_user.id,
        Transaction.statement_id == rec.id,
    )
    if account and account.type in {"bank", "overdraft"}:
        linked_transactions.delete(synchronize_session=False)
    else:
        linked_transactions.update(
            {Transaction.statement_id: None}, synchronize_session=False
        )

    if account and account.type == "invest":
        assets = db.query(Asset).filter(
            Asset.owner_id == current_user.id,
            Asset.type == "investment",
            or_(
                Asset.account_id == account.id,
                func.lower(Asset.name) == (account.name or "").strip().lower(),
            ),
        ).all()
        asset_ids = [asset.id for asset in assets]
        if asset_ids:
            db.query(InvestmentHolding).filter(
                InvestmentHolding.owner_id == current_user.id,
                InvestmentHolding.asset_id.in_(asset_ids),
            ).delete(synchronize_session=False)
            db.query(AssetValuation).filter(
                AssetValuation.asset_id.in_(asset_ids),
                AssetValuation.source == "holdings",
            ).delete(synchronize_session=False)
        db.query(Investment).filter(
            Investment.owner_id == current_user.id,
            func.lower(Investment.platform) == (account.name or "").strip().lower(),
        ).delete(synchronize_session=False)
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
