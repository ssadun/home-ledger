from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import inspect, text
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Account, FinancialInstitution, User
from app.schemas import (
    FinancialInstitutionOut,
    FinancialInstitutionCreate,
    FinancialInstitutionUpdate,
)
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/institutions", tags=["institutions"])


# Seeded on first run. Mirrors the former hardcoded FINANCIAL_INSTITUTIONS map in
# frontend/accounts-data.js, which is now only a bootstrap fallback for when the
# API hasn't answered yet.
DEFAULT_INSTITUTIONS = [
    ("garanti",     "Garanti BBVA",             "Garanti",       "TGBATRIS"),
    ("isbank",      "İş Bankası",               "İş Bankası",    "ISBKTRIS"),
    ("ziraat",      "Ziraat Bankası",           "Ziraat",        "TCZBTR2A"),
    ("vakifbank",   "VakıfBank",                "VakıfBank",     "TVBATR2A"),
    ("yapikredi",   "Yapı Kredi",               "Yapı Kredi",    "YAPITRIS"),
    ("akbank",      "Akbank",                   "Akbank",        "AKBKTRIS"),
    ("qnb",         "QNB Finansbank",           "QNB",           "FNNBTRIS"),
    ("denizbank",   "DenizBank",                "DenizBank",     "DENITRIS"),
    ("halkbank",    "Halkbank",                 "Halkbank",      "TRHBTR2A"),
    ("burgan",      "Burgan Bank",              "Burgan",        "TEKFTRIS"),
    ("teb",         "TEB Türk Ekonomi Bankası",  "TEB",           "TEBUTRIS"),
    ("garantiemek", "Garanti BBVA Emeklilik",   "Garanti Emek",  ""),
]

# A logo is stored inline as a data: URI, so cap it: SQLite copes, but every page
# load ships the whole table to the browser. ~256 KB of base64 ≈ a 190 KB image,
# far above what a 34px chip needs.
MAX_LOGO_CHARS = 262_144


def seed_default_institutions(db: Session) -> None:
    """Populate the shared financial_institutions table on first run if it is empty."""
    if db.query(FinancialInstitution).first():
        return
    for key, name, short_name, swift in DEFAULT_INSTITUTIONS:
        db.add(FinancialInstitution(key=key, name=name, short_name=short_name, swift=swift or None, is_default=True))
    db.commit()


def ensure_institution(db: Session, key: str, name: str, swift: str = None, short_name: str = None) -> None:
    """Backfill one default added after the initial seed (idempotent).

    seed_default_institutions() only fires on an empty table. Matched on `key`, so a
    renamed or re-logoed institution keeps the user's edits; a deleted one comes back.
    """
    if db.query(FinancialInstitution).filter(FinancialInstitution.key == key).first():
        return
    db.add(FinancialInstitution(
        key=key,
        name=name,
        short_name=(short_name or name).strip(),
        swift=swift or None,
        is_default=True,
    ))
    db.commit()


def ensure_short_name_column(db: Session) -> None:
    """Add/backfill financial_institutions.short_name on existing DBs.

    create_all() only creates missing tables, not new columns. This idempotent
    helper keeps existing installations working without a manual restart-time
    migration step.
    """
    cols = {c["name"] for c in inspect(db.bind).get_columns("financial_institutions")}
    if "short_name" not in cols:
        db.execute(text("ALTER TABLE financial_institutions ADD COLUMN short_name VARCHAR"))
        db.commit()
    changed = False
    for row in db.query(FinancialInstitution).all():
        if row.short_name and row.short_name.strip():
            continue
        row.short_name = (row.name or row.key or "").strip()
        changed = True
    if changed:
        db.commit()


def normalize_institution_names(db: Session) -> None:
    """Strip stray whitespace from institution key/name/swift, and from every
    `accounts.institution` that references one (idempotent, runs at startup).

    An Account points at its institution by DISPLAY NAME, and the Accounts form
    saves that name trimmed. So an institution stored as `"TEB Türk Ekonomi
    Bankası "` can never be matched by an account holding `"TEB Türk Ekonomi
    Bankası"`: the picker treats the account's value as an unknown institution
    and appends it as an extra, identical-looking option that comes back on
    every save — the user can never select "the right one" because both entries
    render the same text. Fix it at the source rather than papering over it in
    the picker.
    """
    changed = False
    taken = {i.key for i in db.query(FinancialInstitution).all()}
    for row in db.query(FinancialInstitution).all():
        for field in ("key", "name", "short_name", "swift"):
            value = getattr(row, field)
            if not isinstance(value, str) or value == value.strip():
                continue
            cleaned = value.strip()
            # `key` is unique — never trim one into a collision with another row.
            if field == "key" and (not cleaned or cleaned in taken):
                continue
            if field == "key":
                taken.discard(value)
                taken.add(cleaned)
            setattr(row, field, cleaned or None)
            changed = True
    for acc in db.query(Account).filter(Account.institution.isnot(None)).all():
        if acc.institution != acc.institution.strip():
            acc.institution = acc.institution.strip()
            changed = True
    if changed:
        db.commit()


def _check_logo(logo):
    if logo and len(logo) > MAX_LOGO_CHARS:
        raise HTTPException(
            413, f"Logo too large ({len(logo)} chars, max {MAX_LOGO_CHARS}). Use a smaller image."
        )


@router.get("/", response_model=List[FinancialInstitutionOut])
def list_institutions(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(FinancialInstitution).order_by(FinancialInstitution.id).all()


@router.post("/", response_model=FinancialInstitutionOut, status_code=201)
def create_institution(
    payload: FinancialInstitutionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _check_logo(payload.logo)
    key = (payload.key or "").strip()
    if not key:
        raise HTTPException(400, "Kurum anahtarı (key) zorunludur")
    short_name = (payload.short_name or "").strip()
    if not short_name:
        raise HTTPException(400, "Short Name is required")
    if db.query(FinancialInstitution).filter(FinancialInstitution.key == key).first():
        raise HTTPException(409, f"'{key}' anahtarlı kurum zaten var")
    # Trim the name: accounts reference an institution by name and store it
    # trimmed, so a padded name here would never match. See
    # normalize_institution_names().
    row = FinancialInstitution(
        key=key,
        name=(payload.name or "").strip(),
        short_name=short_name,
        swift=(payload.swift or "").strip() or None,
        logo=payload.logo or None,
        is_default=False,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@router.patch("/{inst_id}", response_model=FinancialInstitutionOut)
def update_institution(
    inst_id: int,
    payload: FinancialInstitutionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(FinancialInstitution).filter(FinancialInstitution.id == inst_id).first()
    if not row:
        raise HTTPException(404, "Kurum bulunamadı")
    _check_logo(payload.logo)
    data = payload.model_dump(exclude_unset=True)
    # Same trimming rule as create_institution() — a padded name silently breaks
    # the name-based match from accounts.institution.
    for field in ("key", "name", "short_name", "swift"):
        if isinstance(data.get(field), str):
            data[field] = data[field].strip()
    if "short_name" in data and not data["short_name"]:
        raise HTTPException(400, "Short Name is required")
    if "key" in data and data["key"] and data["key"] != row.key:
        clash = (
            db.query(FinancialInstitution)
            .filter(FinancialInstitution.key == data["key"], FinancialInstitution.id != inst_id)
            .first()
        )
        if clash:
            raise HTTPException(409, f"'{data['key']}' anahtarlı kurum zaten var")
    old_name = row.name
    for field, value in data.items():
        # "" clears the logo / swift; None means "not sent", so leave it alone.
        setattr(row, field, value if value != "" else None)
    # Accounts store the institution's display NAME, so a rename here would leave
    # them pointing at a name no longer in the picker (and the Accounts form would
    # show it as an extra, unmatched entry). Carry the rename across.
    if row.name and old_name and row.name != old_name:
        db.query(Account).filter(Account.institution == old_name).update(
            {Account.institution: row.name}, synchronize_session=False
        )
    db.commit()
    db.refresh(row)
    return row


@router.delete("/{inst_id}", status_code=204)
def delete_institution(
    inst_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = db.query(FinancialInstitution).filter(FinancialInstitution.id == inst_id).first()
    if not row:
        raise HTTPException(404, "Kurum bulunamadı")
    db.delete(row)
    db.commit()
