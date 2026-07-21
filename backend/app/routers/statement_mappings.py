from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import StatementMapping, User
from app.schemas import StatementMappingOut, StatementMappingCreate, StatementMappingUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/statement-mappings", tags=["statement-mappings"])


# Default Etiket → category_key mappings (mirror bank_import._ETIKET_CATEGORY, but
# with the human-readable tag text so the config UI is legible). Seeded on first run.
DEFAULT_STATEMENT_MAPPINGS = [
    ("tr", "Para Transferi",   "wire-transfer"),
    ("tr", "Kart Ödemesi",     "credit-card-payment"),
    ("tr", "Faiz / Komisyon",  "interest"),
    ("tr", "Telekomünikasyon", "utilities"),
    ("tr", "Ulaşım",           "transport"),
    ("tr", "Döviz Al / Sat",   "wire-transfer"),
    ("tr", "Maaş",             "salary"),
    ("tr", "Market",           "groceries"),
    ("tr", "Yeme / İçme",      "dining"),
    ("tr", "Akaryakıt",        "transport"),
    ("tr", "Giyim / Aksesuar", "shopping"),
    ("tr", "Eğlence / Hobi",   "entertainment"),
    ("tr", "Sağlık / Bakım",   "health"),
    ("tr", "Elektronik",       "shopping"),
    ("tr", "Ev / Dekorasyon",  "shopping"),
    ("tr", "Kişisel Hizmet",   "shopping"),
    # Garanti tags pension contributions AND ordinary insurance premiums with this
    # one label, so it maps to the safer of the two. A real BES contribution is
    # caught earlier by the "G.E. <sözleşme no>" description rule in _cc_classify,
    # which runs before the Etiket map. See CLAUDE.md → Retirement plans (BES).
    ("tr", "Emeklilik / Sigorta", "insurance"),
]


def seed_default_statement_mappings(db: Session) -> None:
    """Populate the shared statement_mappings table on first run if it is empty."""
    if db.query(StatementMapping).first():
        return
    for lang, etiket, category_key in DEFAULT_STATEMENT_MAPPINGS:
        db.add(StatementMapping(lang=lang, etiket=etiket, category_key=category_key, is_default=True))
    db.commit()


def ensure_statement_mapping(db: Session, lang: str, etiket: str, category_key: str) -> None:
    """Backfill one default mapping added after the initial seed (idempotent).

    seed_default_statement_mappings() only fires on an empty table, so a new entry in
    DEFAULT_STATEMENT_MAPPINGS would never reach an existing DB without this. Mirrors
    ensure_category(). Matching is on (lang, etiket): a mapping the user has re-pointed
    at a different category keeps their choice; one they deleted does come back.
    """
    exists = (
        db.query(StatementMapping)
        .filter(StatementMapping.lang == lang, StatementMapping.etiket == etiket)
        .first()
    )
    if exists:
        return
    db.add(StatementMapping(lang=lang, etiket=etiket, category_key=category_key, is_default=True))
    db.commit()


@router.get("/", response_model=List[StatementMappingOut])
def list_statement_mappings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(StatementMapping).order_by(StatementMapping.id).all()


@router.post("/", response_model=StatementMappingOut, status_code=201)
def create_statement_mapping(
    payload: StatementMappingCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = StatementMapping(
        lang=payload.lang or "tr",
        etiket=payload.etiket,
        category_key=payload.category_key,
        is_default=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{mapping_id}", response_model=StatementMappingOut)
def update_statement_mapping(
    mapping_id: int,
    payload: StatementMappingUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(StatementMapping).filter(StatementMapping.id == mapping_id).first()
    if not row:
        raise HTTPException(404, "Eşleştirme bulunamadı")
    for field, value in payload.model_dump(exclude_none=True).items():
        setattr(row, field, value)
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{mapping_id}", status_code=204)
def delete_statement_mapping(mapping_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    row = db.query(StatementMapping).filter(StatementMapping.id == mapping_id).first()
    if not row:
        raise HTTPException(404, "Eşleştirme bulunamadı")
    db.delete(row)
    db.commit()
