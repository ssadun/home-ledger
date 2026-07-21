import re
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Account, User
from app.schemas import AccountCreate, AccountUpdate, AccountOut
from app.services.auth import get_current_user

router = APIRouter(prefix="/api/accounts", tags=["accounts"])


# ── Per-type unique identity ──────────────────────────────────────────────────
# Every account kind that has a real-world identifier is keyed on it, so the same
# account can't be added twice (typically by re-importing a statement the wizard
# didn't auto-match). `wallet`, `cash` and `invest` have no stable identifier and
# are deliberately exempt — a household can hold several.
UNIQUE_FIELD = {
    "bank": "iban",
    "overdraft": "iban",       # a KMH is a bank account with a credit line — same IBAN space
    "credit": "number",        # card number (masked, e.g. "4870 75** **** 1011")
    "debit": "number",
    "pension": "number",       # BES contract number
}

_FIELD_LABEL = {"iban": "IBAN", "number": "account/card number"}

# Uniqueness is scoped to the IDENTIFIER, not to the type: an IBAN is unique in the
# real world whether a `bank` or an `overdraft` row claims it, and one card number
# cannot be both a credit and a debit card. Checking per-type would let the same
# IBAN in twice under two different types.
_TYPES_BY_FIELD = {}
for _t, _f in UNIQUE_FIELD.items():
    _TYPES_BY_FIELD.setdefault(_f, []).append(_t)


def _ident(value) -> str:
    """Comparison form of an identifier: spacing/dashes and case carry no meaning.

    The same IBAN reaches us as both `TR65 0006 2000 ...` (Garanti statements) and
    `TR810012502002025673300377` (ON), so a raw string compare would miss the
    duplicate it is meant to catch.
    """
    return "".join(ch for ch in str(value or "") if ch.isalnum()).upper()


# ── Identifier normalization ──────────────────────────────────────────────────
# The Accounts form sanitizes these fields as they are typed, but the API is what
# actually guards the column: an import path, a stale browser tab or a direct call
# must not be able to store a spaced IBAN or a lettered account number.
_CARD_TYPES = ("credit", "debit")
_UNKNOWN = "–"          # the UI's "not known" placeholder for `number`


def _clean_iban(value) -> Optional[str]:
    """Boşluksuz, büyük harf, iki ülke harfi + rakam, en fazla 26 karakter."""
    raw = re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()
    cc = re.sub(r"[^A-Z]", "", raw[:2])
    return ((cc + re.sub(r"\D", "", raw[len(cc):]))[:26]) or None


def _clean_number(value, acc_type: str) -> Optional[str]:
    """Hesap numarası yalnızca rakam; kart numarası maskeyi koruyacak şekilde rakam/boşluk/yıldız."""
    raw = str(value or "").strip()
    if not raw or raw == _UNKNOWN:
        return raw or None
    if (acc_type or "") in _CARD_TYPES:
        cleaned = re.sub(r"\s{2,}", " ", re.sub(r"[^0-9* ]", "", raw)).strip()[:22]
    else:
        cleaned = re.sub(r"\D", "", raw)
    # Nothing usable left (e.g. "abc") → record it as unknown rather than storing junk.
    return cleaned or _UNKNOWN


def _normalize_identity(data: dict, acc_type: str) -> dict:
    """In-place normalize whichever of `iban`/`number` this payload carries."""
    if data.get("iban"):
        data["iban"] = _clean_iban(data["iban"])
    if "number" in data:
        data["number"] = _clean_number(data["number"], acc_type)
    return data


def _assert_unique_identity(db: Session, owner_id: int, acc_type: str, payload_values: dict, exclude_id: int = None):
    """409 if another account sharing this identifier's space already carries it.

    A blank identifier is not compared: the field is a unique key, not a required
    one, so an account may be created before its IBAN/number is known. That also
    exempts the "–" placeholder the UI writes for an unknown number.
    """
    field = UNIQUE_FIELD.get(acc_type or "")
    if not field:
        return
    ident = _ident(payload_values.get(field))
    if not ident:
        return
    q = db.query(Account).filter(
        Account.owner_id == owner_id, Account.type.in_(_TYPES_BY_FIELD[field])
    )
    if exclude_id is not None:
        q = q.filter(Account.id != exclude_id)
    for other in q.all():
        if _ident(getattr(other, field)) == ident:
            # English on purpose: this detail is rendered verbatim in the (English)
            # Accounts UI, unlike the Turkish strings the routers use for 404s.
            raise HTTPException(
                409,
                f"This {_FIELD_LABEL[field]} is already used by \"{other.name}\".",
            )


@router.get("/", response_model=List[AccountOut])
def list_accounts(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return db.query(Account).filter(Account.owner_id == current_user.id).order_by(Account.id).all()


@router.post("/", response_model=AccountOut, status_code=201)
def create_account(
    payload: AccountCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    data = _normalize_identity(payload.model_dump(), payload.type)
    _assert_unique_identity(db, current_user.id, data.get("type"), data)
    acc = Account(**data, owner_id=current_user.id)
    db.add(acc)
    db.commit()
    db.refresh(acc)
    # Stable frontend key referenced by linked_key / transactions.payment_method.
    if not acc.account_key:
        acc.account_key = f"acc-{acc.id}"
        db.commit()
        db.refresh(acc)
    return acc


@router.patch("/{acc_id}", response_model=AccountOut)
def update_account(
    acc_id: int,
    payload: AccountUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    acc = db.query(Account).filter(Account.id == acc_id, Account.owner_id == current_user.id).first()
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    data = payload.model_dump(exclude_none=True)
    # Check against the POST-EDIT identity: either the type or the identifier may be
    # changing in this same request, and an unsent field keeps its current value.
    new_type = data.get("type", acc.type)
    _normalize_identity(data, new_type)
    merged = {f: data.get(f, getattr(acc, f)) for f in ("iban", "number")}
    _assert_unique_identity(db, current_user.id, new_type, merged, exclude_id=acc.id)
    for field, value in data.items():
        setattr(acc, field, value)
    db.commit()
    db.refresh(acc)
    return acc


@router.delete("/{acc_id}", status_code=204)
def delete_account(acc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    acc = db.query(Account).filter(Account.id == acc_id, Account.owner_id == current_user.id).first()
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    db.delete(acc)
    db.commit()
