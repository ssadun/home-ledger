import re
from pathlib import Path
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import or_
from sqlalchemy.orm import Session
from app.database import get_db
from app.models import Account, CreditPayment, Investment, Transaction, User
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


# ── Related records ───────────────────────────────────────────────────────────
# NOTHING in the schema points at an account with a foreign key. A transaction
# names its account in `payment_method` as a plain string (the `account_key`, e.g.
# "acc-12"), a CreditPayment carries both `account_id` and `account_key`, and an
# investment/pension account's holdings are matched by `Investment.platform ==
# account.name`. So deleting the row on its own leaves those records dangling —
# which is exactly what Account Activity renders as a movement whose Account
# column shows the raw "acc-12" key instead of a name.
#
# The helpers below are the single definition of "belongs to this account",
# shared by the pre-delete preview and by the cascade, so the numbers a user
# confirms in the dialog are the ones that actually go.

_HOLDING_TYPES = ("invest", "pension")


def _shared_names(db: Session, owner_id: int) -> set:
    """Display names held by more than one of this owner's accounts."""
    seen, shared = set(), set()
    for (name,) in db.query(Account.name).filter(Account.owner_id == owner_id).all():
        if name in seen:
            shared.add(name)
        seen.add(name)
    return shared


def _account_refs(acc: Account, shared_names: set = frozenset()) -> List[str]:
    """Every `payment_method` value that means "this account".

    Imports write `account_key`; older/manual rows may carry the account's display
    name. The Account Activity page resolves on both (`toRow` in
    `account-tx-data.js`), so the cascade has to match on both or it would leave
    behind precisely the rows that screen still shows.

    The name is dropped when a sibling account shares it — a household really does
    hold several accounts named after its owner ("Sadun Sevingen" at four banks),
    and an ambiguous name must not let one account's delete take another's rows.
    """
    refs = [acc.account_key] if acc.account_key else []
    if acc.name and acc.name not in shared_names:
        refs.append(acc.name)
    return refs


def _related_transactions(db: Session, owner_id: int, acc: Account):
    refs = _account_refs(acc, _shared_names(db, owner_id))
    if not refs:
        return db.query(Transaction).filter(Transaction.id.is_(None))
    return db.query(Transaction).filter(
        Transaction.owner_id == owner_id,
        Transaction.payment_method.in_(refs),
    )


def _related_credit_payments(db: Session, owner_id: int, acc: Account):
    match = [CreditPayment.account_id == acc.id]
    if acc.account_key:
        match.append(CreditPayment.account_key == acc.account_key)
    return db.query(CreditPayment).filter(
        CreditPayment.owner_id == owner_id, or_(*match)
    )


def _related_investments(db: Session, owner_id: int, acc: Account):
    """Holdings of an invest/pension account — BES funds and broker positions.

    Scoped to those two types on purpose: `platform` is a free-text label, so
    matching it for a bank account or a card would delete unrelated investments
    that happen to share a name.
    """
    if (acc.type or "") not in _HOLDING_TYPES or not acc.name:
        return None
    return db.query(Investment).filter(
        Investment.owner_id == owner_id, Investment.platform == acc.name
    )


def _linked_accounts(db: Session, owner_id: int, acc: Account):
    """Accounts pointing here via `linked_key` (debit→bank, overdraft→bank)."""
    if not acc.account_key:
        return None
    return db.query(Account).filter(
        Account.owner_id == owner_id,
        Account.id != acc.id,
        Account.linked_key == acc.account_key,
    )


def _get_owned(db: Session, acc_id: int, owner_id: int) -> Account:
    acc = db.query(Account).filter(
        Account.id == acc_id, Account.owner_id == owner_id
    ).first()
    if not acc:
        raise HTTPException(404, "Hesap bulunamadı")
    return acc


# ── Orphaned activity ─────────────────────────────────────────────────────────
# Declared BEFORE the `/{acc_id}` routes: FastAPI matches in declaration order and
# would otherwise try "orphans" as an int path param and 422.
#
# Scope is deliberately narrow — imported bank movements that are not part of a
# credit-card statement (`note == "banka_import"` and no `credit_payment_id`),
# i.e. exactly what the Account Activity screen lists. A manually entered
# transaction may legitimately carry a free-text `payment_method` like "cash"
# that never referred to an Account row, and must not be swept up.

def _orphan_query(db: Session, owner_id: int):
    # Names are kept here even when shared (no `_shared_names` filter): this is the
    # set of references that still RESOLVE, and a wider set can only spare rows.
    # Ambiguity is a problem for the cascade, which deletes; not for this, which
    # decides a row still has a home.
    known = [
        ref
        for acc in db.query(Account).filter(Account.owner_id == owner_id).all()
        for ref in _account_refs(acc)
    ]
    q = db.query(Transaction).filter(
        Transaction.owner_id == owner_id,
        Transaction.note == "banka_import",
        Transaction.credit_payment_id.is_(None),
    )
    if known:
        # A NULL payment_method is orphaned too — it can never resolve to an
        # account — and `NOT IN` alone would drop those rows (NULL comparison).
        q = q.filter(or_(
            Transaction.payment_method.is_(None),
            Transaction.payment_method.notin_(known),
        ))
    return q


@router.get("/orphans")
def list_orphans(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Imported movements whose account no longer exists, grouped by dangling key."""
    rows = _orphan_query(db, current_user.id).all()
    groups: dict = {}
    for tx in rows:
        key = tx.payment_method or ""
        g = groups.setdefault(key, {"payment_method": key or None, "count": 0,
                                    "earliest": None, "latest": None})
        g["count"] += 1
        iso = tx.date.isoformat() if tx.date else None
        if iso:
            g["earliest"] = min(g["earliest"] or iso, iso)
            g["latest"] = max(g["latest"] or iso, iso)
    return {
        "count": len(rows),
        "groups": sorted(groups.values(), key=lambda g: -g["count"]),
    }


@router.delete("/orphans")
def purge_orphans(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    deleted = _orphan_query(db, current_user.id).delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


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
    acc = _get_owned(db, acc_id, current_user.id)
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


@router.get("/{acc_id}/related")
def account_related(acc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """What a delete would take with it — powers the confirmation dialog."""
    acc = _get_owned(db, acc_id, current_user.id)
    txs = _related_transactions(db, current_user.id, acc).all()
    dates = sorted(t.date.isoformat() for t in txs if t.date)
    holdings = _related_investments(db, current_user.id, acc)
    linked = _linked_accounts(db, current_user.id, acc)
    return {
        "account_id": acc.id,
        "account_key": acc.account_key,
        "transactions": {
            "count": len(txs),
            # The Account Activity subset, so the dialog can name the screen the
            # rows will disappear from.
            "imported": sum(1 for t in txs if t.note == "banka_import"),
            "earliest": dates[0] if dates else None,
            "latest": dates[-1] if dates else None,
        },
        "credit_payments": _related_credit_payments(db, current_user.id, acc).count(),
        "investments": holdings.count() if holdings is not None else 0,
        "linked_accounts": [a.name for a in linked.all()] if linked is not None else [],
    }


@router.delete("/{acc_id}")
def delete_account(acc_id: int, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Delete an account together with everything that referenced it.

    Cascading is done by hand because the references are strings, not foreign keys
    (see _account_refs). Without it the account's transactions survive as orphans
    on Account Activity, showing a raw "acc-12" key in the Account column.
    """
    acc = _get_owned(db, acc_id, current_user.id)

    statements = _related_credit_payments(db, current_user.id, acc).all()
    for cp in statements:
        # Any spending still pointing at the statement goes with it — these are
        # card lines belonging to the card being deleted, and leaving them would
        # dangle `credit_payment_id` at a row that no longer exists.
        db.query(Transaction).filter(
            Transaction.owner_id == current_user.id,
            Transaction.credit_payment_id == cp.id,
        ).delete(synchronize_session=False)
        if cp.statement_path:
            try:
                Path(cp.statement_path).unlink(missing_ok=True)
            except OSError:
                pass
        db.delete(cp)

    tx_deleted = _related_transactions(db, current_user.id, acc).delete(synchronize_session=False)

    holdings = _related_investments(db, current_user.id, acc)
    inv_deleted = holdings.delete(synchronize_session=False) if holdings is not None else 0

    # Children (a debit card or overdraft attached to this account) survive as
    # accounts in their own right — only the now-dead link is cleared.
    linked = _linked_accounts(db, current_user.id, acc)
    unlinked = linked.update({Account.linked_key: None}, synchronize_session=False) if linked is not None else 0

    db.delete(acc)
    db.commit()
    return {
        "deleted": {
            "transactions": tx_deleted,
            "credit_payments": len(statements),
            "investments": inv_deleted,
            "unlinked_accounts": unlinked,
        }
    }
