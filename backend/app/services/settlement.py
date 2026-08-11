"""Card-payment settlement resolver.

Links a bank-account transaction classified ``category_key == "credit-card-payment"``
(a "K.Kartı Ödeme"/"KREDİ KARTI BORCU"/"KKBO"/Garanti "Kart Ödemesi" line) to the
``CreditPayment`` bill it actually pays off, via ``Transaction.settles_credit_payment_id``
/ ``settles_account_key`` (see the columns' docstring in ``models.py`` — deliberately
separate from ``credit_payment_id``, which means "spending ON this card").

Matching is **keyword → category → card account → bill (date window)**. Amount is
never part of the matching key — a partial payment is common (4 of 7 historical
months in the source data were partial, 2 split across two same-day transactions),
so amount is only ever used to *label* the resulting state via ``settlement_state()``.
"""

import re
from datetime import date as date_type, timedelta
from typing import Optional

from sqlalchemy import or_
from sqlalchemy.orm import Session

from app.models import Account, CreditPayment, Transaction, TransactionType


# Any run of 4+ digits in a description — a bank rarely prints the full card
# number on a settlement line, but the last 4 (what the household actually
# recognizes a card by) sometimes appear. This is a HINT only: a description
# with no digits, or digits that don't match a known card, is not an error —
# the caller falls back to the single-card household case, then gives up.
_DIGIT_RUN_RE = re.compile(r"\d{4,}")


def _card_last4(number: Optional[str]) -> Optional[str]:
    """Last 4 digits of a card's stored (possibly masked) number, e.g.
    "4870 **** **** 1011" -> "1011". None if too short to mean anything."""
    digits = re.sub(r"\D", "", number or "")
    return digits[-4:] if len(digits) >= 4 else None


def resolve_card_account(desc: str, accounts: list[Account]) -> Optional[Account]:
    """Which credit-card Account a settlement description's bank line pays off.

    ``accounts`` is the household's already-loaded Account rows (the same shape
    ``import_transactions()`` in bank_import.py already builds as ``owned_accounts``
    — a plain list of ORM rows, not a dict keyed by reference).

    Card digits found in the description are a hint, never the primary/required
    signal. When none resolve to a known card, fall back to the single credit-card
    account in the household if there is exactly one — the common case where there
    is nothing to disambiguate. Otherwise return None so the caller can leave the
    transaction unresolved (import wizard prompt, later group) rather than guess.
    """
    credit_accounts = [a for a in accounts if getattr(a, "type", None) == "credit"]
    if not credit_accounts:
        return None

    digit_runs = _DIGIT_RUN_RE.findall(desc or "")
    if digit_runs:
        for account in credit_accounts:
            last4 = _card_last4(getattr(account, "number", None))
            if last4 and any(last4 in run for run in digit_runs):
                return account

    if len(credit_accounts) == 1:
        return credit_accounts[0]
    return None


def resolve_bill(
    db: Session, owner_id: int, account: Optional[Account], tx_date: Optional[date_type]
) -> Optional[CreditPayment]:
    """Nearest CreditPayment for ``account`` whose payment_date falls in
    [tx_date - 5, tx_date + 3] days — i.e. relative to the bill's own due date, a
    settling transaction from 3 days *before* it (an early payment, rare) up to
    5 days *after* it (the common case — payments typically post a few days late).

    Deliberately asymmetric, and deliberately NOT the cutover-window pattern
    ``_relink_spendings()`` uses in credit_payments.py — that one matches spendings
    ON a card against its statement PERIOD; this matches a bank PAYMENT against a
    bill's DUE DATE, a different real-world event with a different tolerance.
    """
    if account is None or tx_date is None:
        return None
    window_start = tx_date - timedelta(days=5)
    window_end = tx_date + timedelta(days=3)

    refs = []
    if getattr(account, "id", None) is not None:
        refs.append(CreditPayment.account_id == account.id)
    if getattr(account, "account_key", None):
        refs.append(CreditPayment.account_key == account.account_key)
    if not refs:
        return None

    candidates = (
        db.query(CreditPayment)
        .filter(
            CreditPayment.owner_id == owner_id,
            or_(*refs),
            CreditPayment.payment_date.isnot(None),
            CreditPayment.payment_date >= window_start,
            CreditPayment.payment_date <= window_end,
        )
        .all()
    )
    if not candidates:
        return None
    return min(candidates, key=lambda cp: abs((cp.payment_date - tx_date).days))


def settlement_state(cp: CreditPayment, paid: float) -> str:
    """One of "unpaid" / "under-minimum" / "partial" / "paid".

    Collapses to the 3-state set (drops "under-minimum") when ``cp.minimum_amount``
    is 0 or None — the statement parser doesn't always capture a minimum payment
    (Step 9 of the plan adds that extraction later), and it would be wrong to claim
    "Below Minimum" against an amount that was never actually parsed.

    "paid" also requires a known, positive ``total_amount`` — an unparsed total is
    just as untrustworthy a comparison point as an unparsed minimum, so a payment
    against a bill with no total on record can only ever read as partial/unpaid,
    never "paid".
    """
    paid = paid or 0.0
    total = cp.total_amount or 0.0
    minimum = cp.minimum_amount or 0.0

    if paid <= 0:
        return "unpaid"
    if total > 0 and paid >= total:
        return "paid"
    if minimum > 0:
        return "under-minimum" if paid < minimum else "partial"
    return "partial"


def backfill(db: Session, owner_id: int) -> dict:
    """Re-run the resolver over existing ``credit-card-payment`` transactions that
    don't yet carry a settlement link.

    Idempotent by construction: only rows with ``settles_credit_payment_id IS NULL``
    are considered, so a repeat run never re-decides (or corrupts) a row this
    function — or a user editing the transaction detail modal, a later group — has
    already resolved. A row that stays unresolved (no card, no matching bill) is
    retried on every call, which is intentional: it costs nothing extra and lets a
    later-added account or CreditPayment resolve retroactively without a special
    "force" flag.
    """
    accounts = db.query(Account).filter(Account.owner_id == owner_id).all()
    accounts_by_key = {a.account_key: a for a in accounts if a.account_key}

    rows = (
        db.query(Transaction)
        .filter(
            Transaction.owner_id == owner_id,
            Transaction.category_key == "credit-card-payment",
            # Only an EXPENSE can pay off a bill. The same real-world payment
            # also posts as an INCOME "credit-card-payment" row on the card's
            # own statement (e.g. "ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ"/"Cep Şube
            # Ödeme" — legitimately income+credit-card-payment by design, see
            # bank_import.py's _cc_classify). Without this filter that income
            # echo resolves to the SAME bill as its expense counterpart,
            # doubling paid_total.
            Transaction.type == TransactionType.expense,
            Transaction.settles_credit_payment_id.is_(None),
        )
        .all()
    )

    resolved = 0
    unresolved = 0
    for tx in rows:
        account = None
        if tx.settles_account_key:
            account = accounts_by_key.get(tx.settles_account_key)
        if account is None:
            account = resolve_card_account(tx.description, accounts)
        cp = resolve_bill(db, owner_id, account, tx.date) if account else None
        if account is not None and cp is not None:
            tx.settles_credit_payment_id = cp.id
            tx.settles_account_key = account.account_key
            resolved += 1
        else:
            unresolved += 1
    db.commit()

    already_resolved = (
        db.query(Transaction)
        .filter(
            Transaction.owner_id == owner_id,
            Transaction.category_key == "credit-card-payment",
            Transaction.settles_credit_payment_id.isnot(None),
        )
        .count()
    )
    return {
        "resolved": resolved,
        "unresolved": unresolved,
        "already_resolved": already_resolved,
    }
