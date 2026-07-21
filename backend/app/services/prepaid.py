"""Prepaid card balance upkeep.

A prepaid card (``Account.is_prepaid``) is loaded with funds rather than backed by a
credit line, so its ``balance`` is the POSITIVE amount still available and has to shrink
as it is spent — the opposite of a normal credit card, whose ``balance`` is negative
outstanding debt.

Nothing else in the app mutates ``Account.balance`` (it is otherwise a static field set
by hand or by import), so every automatic movement a user sees on a prepaid card comes
from here. Two callers drive it:

* ``routers/transactions.py`` — a spending transaction lowers the balance, an income
  transaction (a top-up) raises it, and edits/deletes reverse the previous effect.
* ``services/recurring.py`` — each recurring bill / subscription occurrence that falls
  due lowers the balance once, as ``roll_forward_due_dates`` steps past it.
"""

from types import SimpleNamespace
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Account, ExchangeRate


def _cur(value, default: str = "TRY") -> str:
    """Currency as a plain string, whether it arrives as a ``Currency`` enum or a str."""
    return getattr(value, "value", value) or default


def find_prepaid_account(db: Session, owner_id: int, account_key: Optional[str]) -> Optional[Account]:
    """The user's prepaid card referenced by ``account_key`` (the ``payment_method``
    convention shared by transactions and recurring items), or None when the payment
    method is empty, unknown, or not a prepaid card."""
    if not account_key:
        return None
    return (
        db.query(Account)
        .filter(
            Account.owner_id == owner_id,
            Account.account_key == account_key,
            Account.is_prepaid.is_(True),
        )
        .first()
    )


def _convert(db: Session, amount: float, from_cur, to_cur) -> float:
    """Convert using the most recent TCMB rate on file. With no usable rate we charge the
    nominal amount rather than silently dropping the movement to zero."""
    src, dst = _cur(from_cur), _cur(to_cur)
    if not amount or src == dst:
        return float(amount or 0.0)

    row = db.query(ExchangeRate).order_by(ExchangeRate.date.desc()).first()
    if not row or not row.usd_try:
        return float(amount)

    if src == "TRY":
        in_try = float(amount)
    elif src == "USD":
        in_try = float(amount) * row.usd_try
    elif src == "EUR" and row.eur_try:
        in_try = float(amount) * row.eur_try
    else:
        return float(amount)

    if dst == "TRY":
        return in_try
    if dst == "USD":
        return in_try / row.usd_try
    if dst == "EUR" and row.eur_try:
        return in_try / row.eur_try
    return float(amount)


def charge_in_card_currency(
    db: Session,
    account: Account,
    amount: float,
    currency,
    amount_try: Optional[float] = None,
    amount_usd: Optional[float] = None,
) -> float:
    """The charge expressed in the card's own currency. Prefers the ``amount_try`` /
    ``amount_usd`` a transaction already stores (rated at the transaction's own date, so
    more accurate than today's rate); falls back to converting for records that carry no
    pre-computed values, such as recurring items."""
    card_cur = _cur(account.currency)
    if _cur(currency) == card_cur:
        return float(amount or 0.0)
    if card_cur == "TRY" and amount_try is not None:
        return float(amount_try)
    if card_cur == "USD" and amount_usd is not None:
        return float(amount_usd)
    return _convert(db, amount, currency, card_cur)


def snapshot(tx) -> SimpleNamespace:
    """Copy the fields that determine a transaction's prepaid charge, so an update can
    undo the pre-image after the transaction has already been mutated in place."""
    return SimpleNamespace(
        payment_method=tx.payment_method,
        amount=tx.amount,
        currency=tx.currency,
        amount_try=tx.amount_try,
        amount_usd=tx.amount_usd,
        type=tx.type,
    )


def apply_transaction(db: Session, owner_id: int, tx, direction: int = 1) -> Optional[Account]:
    """Fold a transaction's effect into its prepaid card's balance; pass
    ``direction=-1`` to undo it. No-op when the payment method isn't a prepaid card.
    Accepts a ``Transaction`` or a :func:`snapshot` of one. The caller commits."""
    account = find_prepaid_account(db, owner_id, tx.payment_method)
    if account is None:
        return None

    amount = charge_in_card_currency(db, account, tx.amount, tx.currency, tx.amount_try, tx.amount_usd)
    # Spending draws the card down; income is a top-up.
    signed = amount if getattr(tx.type, "value", tx.type) == "income" else -amount
    account.balance = round((account.balance or 0.0) + direction * signed, 2)
    return account


def apply_recurring_occurrences(db: Session, rec, occurrences: int) -> Optional[Account]:
    """Draw down the prepaid card behind a recurring bill / subscription for
    ``occurrences`` due dates that have passed. No-op when the item isn't paid from a
    prepaid card. The caller commits."""
    if occurrences <= 0:
        return None
    account = find_prepaid_account(db, rec.owner_id, rec.payment_method)
    if account is None:
        return None

    amount = charge_in_card_currency(db, account, rec.amount, rec.currency)
    account.balance = round((account.balance or 0.0) - amount * occurrences, 2)
    return account
