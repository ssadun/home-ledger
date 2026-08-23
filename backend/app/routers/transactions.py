import uuid
from datetime import date
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from sqlalchemy.orm import Session
from sqlalchemy import extract, func, text
from app.database import get_db
from app.models import Transaction, ExchangeRate, CreditPayment, Statement, User
from app.schemas import TransactionCreate, TransactionOut, TransactionUpdate
from app.services.auth import get_current_user
from app.services.ocr import save_upload, extract_text_from_image, parse_receipt
from app.services.prepaid import apply_transaction as apply_prepaid, transaction_state as prepaid_transaction_state

router = APIRouter(prefix="/api/transactions", tags=["transactions"])


def _attach_statement_labels(db: Session, txs: List[Transaction]) -> List[Transaction]:
    """Set a transient (non-persisted) `statement_label` on each row, derived
    from its linked CreditPayment.name or Statement.name (see
    services/statement_naming.py). Batched to avoid one query per row."""
    cp_ids = {t.credit_payment_id for t in txs if t.credit_payment_id is not None}
    st_ids = {t.statement_id for t in txs if t.statement_id is not None}
    cp_names = {}
    st_names = {}
    if cp_ids:
        cp_names = dict(
            db.query(CreditPayment.id, CreditPayment.name)
            .filter(CreditPayment.id.in_(cp_ids)).all()
        )
    if st_ids:
        st_names = dict(
            db.query(Statement.id, Statement.name)
            .filter(Statement.id.in_(st_ids)).all()
        )
    for t in txs:
        label = None
        if t.credit_payment_id is not None:
            label = cp_names.get(t.credit_payment_id)
        elif t.statement_id is not None:
            label = st_names.get(t.statement_id)
        t.statement_label = label
    return txs


def ensure_transaction_settlement_columns(db: Session) -> None:
    """Add the card-payment settlement link columns to an existing SQLite database.

    settles_credit_payment_id / settles_account_key record that THIS bank
    transaction pays off a CreditPayment — the opposite direction from
    credit_payment_id ("spending ON this card"), which the CreditPayment delete
    cascade bulk-deletes. Kept on separate columns so that cascade never touches
    a real bank movement. Fresh databases get both via Base.metadata.create_all();
    this idempotent migration backfills an existing one.
    """
    if db.bind.dialect.name != "sqlite":
        return
    cols = {row[1] for row in db.execute(text("PRAGMA table_info(transactions)")).fetchall()}
    if "settles_credit_payment_id" not in cols:
        db.execute(text("ALTER TABLE transactions ADD COLUMN settles_credit_payment_id INTEGER"))
    if "settles_account_key" not in cols:
        db.execute(text("ALTER TABLE transactions ADD COLUMN settles_account_key VARCHAR"))
    db.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_tx_settles_cp ON transactions(settles_credit_payment_id)"
    ))
    db.commit()


def _apply_rates(tx: Transaction, db: Session):
    """Otomatik kur dönüşümü uygula.

    Bir para biriminin kendine dönüşümü (TRY→TRY, USD→USD) kur tablosundan
    BAĞIMSIZ olarak her zaman bilinir; sadece çapraz dönüşümler bir ExchangeRate
    satırı gerektirir. Bu yüzden self-conversion'ı rate_row kontrolünün DIŞINDA
    yazıyoruz — aksi halde o tarihe ait TCMB kuru DB'de yoksa (ör. eski/ileri
    tarihli banka ekstresi içe aktarımı) TRY işlemler bile amount_try=None kalır
    ve panolarda ₺0 görünürler.
    """
    rate_row = db.query(ExchangeRate).filter(ExchangeRate.date <= tx.date).order_by(ExchangeRate.date.desc()).first()
    usd_try = rate_row.usd_try if rate_row else None
    eur_try = rate_row.eur_try if rate_row else None
    if usd_try:
        tx.exchange_rate = usd_try

    if tx.currency == "TRY":
        tx.amount_try = tx.amount
        if usd_try:
            tx.amount_usd = tx.amount / usd_try
    elif tx.currency == "USD":
        tx.amount_usd = tx.amount
        if usd_try:
            tx.amount_try = tx.amount * usd_try
    elif tx.currency == "EUR" and eur_try:
        tx.amount_try = tx.amount * eur_try
        if usd_try:
            tx.amount_usd = tx.amount_try / usd_try


@router.get("/", response_model=List[TransactionOut])
def list_transactions(
    year: Optional[int] = None,
    month: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    type: Optional[str] = None,
    category_id: Optional[int] = None,
    category_key: Optional[str] = None,
    q_desc: Optional[str] = None,
    payer: Optional[str] = None,
    credit_payment_id: Optional[int] = None,
    statement_id: Optional[int] = None,
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
    # Arbitrary date-range filter (Spending's editable Period range, up to 12
    # months) -- independent of year/month above, which stay for callers that
    # still want a single calendar month/year (Account Activity, Recurring, …).
    if date_from:
        q = q.filter(Transaction.date >= date_from)
    if date_to:
        q = q.filter(Transaction.date <= date_to)
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
    if credit_payment_id is not None:
        q = q.filter(Transaction.credit_payment_id == credit_payment_id)
    if statement_id is not None:
        q = q.filter(Transaction.statement_id == statement_id)
    rows = q.order_by(Transaction.date.desc()).offset(offset).limit(limit).all()
    return _attach_statement_labels(db, rows)


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
    return _attach_statement_labels(db, [tx])[0]


@router.get("/{tx_id}", response_model=TransactionOut)
def get_transaction(tx_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    tx = db.query(Transaction).filter(Transaction.id == tx_id, Transaction.owner_id == current_user.id).first()
    if not tx:
        raise HTTPException(404, "İşlem bulunamadı")
    return _attach_statement_labels(db, [tx])[0]


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
    before = prepaid_transaction_state(tx)
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(tx, field, value)
    _apply_rates(tx, db)
    apply_prepaid(db, current_user.id, before, direction=-1)
    apply_prepaid(db, current_user.id, tx)
    db.commit()
    db.refresh(tx)
    return _attach_statement_labels(db, [tx])[0]


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
