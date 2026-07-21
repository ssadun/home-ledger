import uuid
from datetime import date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import extract, func
from app.database import get_db
from app.models import Transaction, ExchangeRate, User
from app.schemas import TransactionCreate, TransactionOut, TransactionUpdate
from app.services.auth import get_current_user
from app.services.ocr import save_upload, extract_text_from_image, parse_receipt
from app.services.prepaid import apply_transaction as apply_prepaid, snapshot as prepaid_snapshot

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _apply_rates(tx: Transaction, db: Session):
    """Otomatik kur dönüşümü uygula."""
    rate_row = db.query(ExchangeRate).filter(ExchangeRate.date <= tx.date).order_by(ExchangeRate.date.desc()).first()
    if rate_row and rate_row.usd_try:
        tx.exchange_rate = rate_row.usd_try
        if tx.currency == "TRY":
            tx.amount_try = tx.amount
            tx.amount_usd = tx.amount / rate_row.usd_try
        elif tx.currency == "USD":
            tx.amount_usd = tx.amount
            tx.amount_try = tx.amount * rate_row.usd_try
        elif tx.currency == "EUR" and rate_row.eur_try:
            tx.amount_try = tx.amount * rate_row.eur_try
            tx.amount_usd = tx.amount_try / rate_row.usd_try


@router.get("/", response_model=List[TransactionOut])
def list_transactions(
    year: Optional[int] = None,
    month: Optional[int] = None,
    type: Optional[str] = None,
    category_id: Optional[int] = None,
    category_key: Optional[str] = None,
    q_desc: Optional[str] = None,
    payer: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(Transaction).filter(Transaction.owner_id == current_user.id)
    if year:
        q = q.filter(extract("year", Transaction.date) == year)
    if month:
        q = q.filter(extract("month", Transaction.date) == month)
    if type:
        q = q.filter(Transaction.type == type)
    if category_id:
        q = q.filter(Transaction.category_id == category_id)
    if category_key:
        q = q.filter(Transaction.category_key == category_key)
    if q_desc:
        # Substring match on the bank's verbatim description. Drives the pension
        # account's Contributions list, which finds a BES charge by its contract
        # number ("G.E. 17943452 İSTANBUL").
        q = q.filter(Transaction.description.contains(q_desc))
    if payer:
        q = q.filter(Transaction.payer == payer)
    return q.order_by(Transaction.date.desc()).offset(offset).limit(limit).all()


@router.post("/", response_model=TransactionOut, status_code=201)
def create_transaction(
    payload: TransactionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tx = Transaction(**payload.model_dump(), owner_id=current_user.id)
    _apply_rates(tx, db)
    db.add(tx)
    apply_prepaid(db, current_user.id, tx)
    db.commit()
    db.refresh(tx)
    return tx


@router.get("/{tx_id}", response_model=TransactionOut)
def get_transaction(tx_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.owner_id == current_user.id).first()
    if not tx:
        raise HTTPException(404, "İşlem bulunamadı")
    return tx


@router.patch("/{tx_id}", response_model=TransactionOut)
def update_transaction(
    tx_id: int,
    payload: TransactionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.owner_id == current_user.id).first()
    if not tx:
        raise HTTPException(404, "İşlem bulunamadı")
    # Capture the pre-image before the in-place mutation: the card, amount, currency or
    # direction may all change, so the old prepaid effect has to be undone from the old
    # values and the new one applied from the new ones.
    before = prepaid_snapshot(tx)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(tx, field, value)
    _apply_rates(tx, db)
    apply_prepaid(db, current_user.id, before, direction=-1)
    apply_prepaid(db, current_user.id, tx)
    db.commit()
    db.refresh(tx)
    return tx


@router.delete("/{tx_id}", status_code=204)
def delete_transaction(tx_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.owner_id == current_user.id).first()
    if not tx:
        raise HTTPException(404, "İşlem bulunamadı")
    apply_prepaid(db, current_user.id, tx, direction=-1)
    db.delete(tx)
    db.commit()


@router.post("/ocr/upload")
async def upload_receipt(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fiş/fatura yükle → OCR ile tutar/tarih/merchant çıkar → önizleme döndür."""
    if not file.content_type.startswith("image/"):
        raise HTTPException(400, "Sadece resim dosyaları desteklenir (JPG, PNG, WEBP)")
    
    ext = file.filename.rsplit(".", 1)[-1] if "." in file.filename else "jpg"
    filename = f"{current_user.id}_{uuid.uuid4().hex}.{ext}"
    content = await file.read()
    path = save_upload(content, filename)
    
    raw_text = extract_text_from_image(path)
    parsed = parse_receipt(raw_text)
    parsed["receipt_path"] = path
    return parsed
