from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import StatementMapping, User
from app.schemas import StatementMappingOut, StatementMappingCreate, StatementMappingUpdate
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/statement-mappings", tags=["statement-mappings"])

MATCH_SCOPES = {"tag", "description", "both"}


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
        db.add(StatementMapping(
            lang=lang, etiket=etiket, category_key=category_key,
            match_scope="both", priority=100, is_active=True, is_default=True,
        ))
    db.commit()


def ensure_statement_mapping_columns(db: Session) -> None:
    """Add rule-control columns to existing SQLite databases.

    Fresh databases receive them through SQLAlchemy metadata. This project does not
    use Alembic, so the live SQLite database needs an idempotent startup migration.
    """
    if db.bind.dialect.name != "sqlite":
        return
    cols = {row[1] for row in db.execute(text("PRAGMA table_info(statement_mappings)")).fetchall()}
    if "match_scope" not in cols:
        db.execute(text("ALTER TABLE statement_mappings ADD COLUMN match_scope VARCHAR DEFAULT 'both'"))
    if "priority" not in cols:
        db.execute(text("ALTER TABLE statement_mappings ADD COLUMN priority INTEGER DEFAULT 100"))
    if "is_active" not in cols:
        db.execute(text("ALTER TABLE statement_mappings ADD COLUMN is_active BOOLEAN DEFAULT 1"))
    db.execute(text("UPDATE statement_mappings SET match_scope = 'both' WHERE match_scope IS NULL OR match_scope = ''"))
    db.execute(text("UPDATE statement_mappings SET priority = 100 WHERE priority IS NULL"))
    db.execute(text("UPDATE statement_mappings SET is_active = 1 WHERE is_active IS NULL"))
    db.execute(text(
        "CREATE INDEX IF NOT EXISTS ix_statement_mappings_rule_order "
        "ON statement_mappings (lang, is_active, priority, id)"
    ))
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
    db.add(StatementMapping(
        lang=lang, etiket=etiket, category_key=category_key,
        match_scope="both", priority=100, is_active=True, is_default=True,
    ))
    db.commit()


def _canonical_term(value: str) -> str:
    # Local import avoids a router -> service import during module initialization.
    from app.services.bank_import import _etiket_key
    return _etiket_key(value)


def _terms(value: str) -> list[str]:
    return [part.strip() for part in (value or "").split(",") if part.strip()]


def _scopes_overlap(left: str, right: str) -> bool:
    return left == right or "both" in {left, right}


def _validate_rule(db: Session, *, lang: str, etiket: str, match_scope: str,
                   priority: int, exclude_id: int | None = None) -> tuple[str, str, int]:
    lang = (lang or "tr").strip().lower()
    etiket = (etiket or "").strip()
    match_scope = (match_scope or "both").strip().lower()
    if not etiket or not _terms(etiket):
        raise HTTPException(400, "Statement tag or keyword is required.")
    if match_scope not in MATCH_SCOPES:
        raise HTTPException(400, "Applies To must be Tag, Description, or Both.")
    try:
        priority = int(priority)
    except (TypeError, ValueError):
        raise HTTPException(400, "Priority must be an integer.")
    if priority < 0 or priority > 1000:
        raise HTTPException(400, "Priority must be between 0 and 1000.")

    incoming = {_canonical_term(term) for term in _terms(etiket)}
    incoming.discard("")
    for row in db.query(StatementMapping).filter(StatementMapping.lang == lang).all():
        if exclude_id is not None and row.id == exclude_id:
            continue
        if not _scopes_overlap(match_scope, row.match_scope or "both"):
            continue
        overlap = incoming.intersection(_canonical_term(term) for term in _terms(row.etiket))
        if overlap:
            duplicate = sorted(overlap)[0]
            raise HTTPException(409, f"Normalized mapping value '{duplicate}' already exists in mapping #{row.id}.")
    return lang, etiket, priority


def _append_aliases(row: StatementMapping, aliases: list[str], reserved: set[str]) -> bool:
    existing = {_canonical_term(term) for term in _terms(row.etiket)}
    additions = [
        alias for alias in aliases
        if _canonical_term(alias) not in existing and _canonical_term(alias) not in reserved
    ]
    if not additions:
        return False
    row.etiket = ", ".join(_terms(row.etiket) + additions)
    reserved.update(_canonical_term(alias) for alias in additions)
    return True


def ensure_statement_mapping_aliases(db: Session) -> None:
    """Backfill Bonus tag/merchant aliases without changing user category choices."""
    changed = False
    groups = [
        ("Yeme / İçme", ["Cafe & Restaurant", "Fast Food", "Pastane"]),
        ("Market", ["Süpermarket"]),
        ("Eğlence / Hobi", ["Eğlence"]),
        ("Elektronik", ["Bilgisayar"]),
    ]
    rows = db.query(StatementMapping).filter(StatementMapping.lang == "tr").all()
    existing_keys = {
        _canonical_term(term)
        for row in rows
        for term in _terms(row.etiket)
    }
    for base, aliases in groups:
        base_key = _canonical_term(base)
        row = next((candidate for candidate in rows
                    if base_key in {_canonical_term(term) for term in _terms(candidate.etiket)}), None)
        own_keys = {_canonical_term(term) for term in _terms(row.etiket)} if row else set()
        if row and _append_aliases(row, aliases, existing_keys - own_keys):
            changed = True
            existing_keys.update(_canonical_term(alias) for alias in aliases)

    description_rules = [
        ("SBX, SBUX, STARBUCKS", "dining", 200),
        ("PARIBUCINEVERSE, PASSO", "entertainment", 200),
        ("ARÇELİK", "shopping", 200),
    ]
    for etiket, category_key, priority in description_rules:
        if any(_canonical_term(term) in existing_keys for term in _terms(etiket)):
            continue
        db.add(StatementMapping(
            lang="tr", etiket=etiket, category_key=category_key,
            match_scope="description", priority=priority,
            is_active=True, is_default=True,
        ))
        existing_keys.update(_canonical_term(term) for term in _terms(etiket))
        changed = True
    if changed:
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
    lang, etiket, priority = _validate_rule(
        db, lang=payload.lang, etiket=payload.etiket,
        match_scope=payload.match_scope, priority=payload.priority,
    )
    row = StatementMapping(
        lang=lang,
        etiket=etiket,
        category_key=payload.category_key,
        match_scope=payload.match_scope,
        priority=priority,
        is_active=payload.is_active,
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
    values = payload.model_dump(exclude_none=True)
    lang, etiket, priority = _validate_rule(
        db,
        lang=values.get("lang", row.lang),
        etiket=values.get("etiket", row.etiket),
        match_scope=values.get("match_scope", row.match_scope or "both"),
        priority=values.get("priority", row.priority if row.priority is not None else 100),
        exclude_id=row.id,
    )
    values.update({"lang": lang, "etiket": etiket, "priority": priority})
    for field, value in values.items():
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
