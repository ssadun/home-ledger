"""Shared record-naming logic for Statement and CreditPayment records.

Both models compute a fresh `name` on every create/update from their linked
Account + period fields. This used to be two separate, near-identical
`_compute_name()` helpers (routers/statements.py, routers/credit_payments.py);
they now both delegate here so the format only has to change in one place.

Format — "YY-MM LABEL":
- CreditPayment (always a credit-card statement -- Statements independently
  reject `credit` accounts, see routers/statements.py): "YY-MM ÜRÜN-SON4"
  where ÜRÜN is the first word of the card Account's `name` (e.g. "Bonus
  Platinum" -> "BONUS") and SON4 is the last 4 digits of the card `number`.
  Example: "26-08 BONUS-1011".
  NOTE: this intentionally reads `Account.name` (the card PRODUCT name), never
  `Account.card_name` (the name printed on the physical card, e.g. the
  cardholder's own name) -- using card_name was the original bug this format
  change fixes; see CLAUDE.md's Statements section.
- Statement (bank/overdraft/debit/wallet/cash/invest/pension accounts):
  "YY-MM KURUM-HESAP-SON4" -- FinancialInstitution.short_name (falling back to
  the raw `Account.institution` string, or omitted entirely when unset) plus
  Account.name plus the last 4 digits of Account.number.
  Example: "26-08 GARANTI-ELMA-9945".

Uses plain Python `.upper()` for the Turkish label text, matching the fold
rule used elsewhere in the app (bank_import.py's _fold(): `ı`/`i`/`I` all
normalize together, not to the dotted `İ`).

An account whose `number` carries no digits at all (e.g. the "–" unknown
placeholder) simply omits the SON4 suffix -- see CLAUDE.md's risk note on
label ambiguity for accounts that share a name.
"""
from typing import Optional

from sqlalchemy.orm import Session

from app.models import Account, CreditPayment, FinancialInstitution, Statement


def _last4(number: Optional[str]) -> str:
    """Last 4 digits of an account/card number, ignoring masking characters
    (*, spaces, dashes). Returns "" when the number has no digits at all."""
    digits = "".join(ch for ch in (number or "") if ch.isdigit())
    return digits[-4:] if digits else ""


def _first_word(name: Optional[str]) -> str:
    words = (name or "").strip().split()
    return words[0].upper() if words else ""


def compute_statement_name(db: Session, rec) -> str:
    """Standard record name for a Statement or a CreditPayment: "YY-MM LABEL"."""
    acc = None
    if rec.account_id is not None:
        acc = db.query(Account).filter(Account.id == rec.account_id).first()

    yy = (rec.period_year or 0) % 100
    mm = rec.period_month or 0
    prefix = f"{yy:02d}-{mm:02d}"

    is_card = isinstance(rec, CreditPayment)
    if not acc:
        return f"{prefix} {'Card' if is_card else 'Account'}"

    last4 = _last4(acc.number)
    if is_card:
        product = _first_word(acc.name) or "CARD"
        label = f"{product}-{last4}" if last4 else product
    else:
        inst_label = None
        if acc.institution:
            inst = db.query(FinancialInstitution).filter(
                FinancialInstitution.name == acc.institution
            ).first()
            inst_label = (inst.short_name if inst and inst.short_name else acc.institution)
        parts = []
        if inst_label:
            parts.append(inst_label.strip().upper())
        acct_label = (acc.name or "").strip().upper()
        if acct_label:
            parts.append(acct_label)
        base = "-".join(parts) if parts else "ACCOUNT"
        label = f"{base}-{last4}" if last4 else base

    return f"{prefix} {label}"


def backfill_statement_names(db: Session) -> None:
    """One-time (but idempotent/re-runnable) migration of existing CreditPayment
    and Statement rows to the new "YY-MM LABEL" name format. Safe to call on
    every startup, same as the app's other ensure_*/normalize_* backfills --
    a record whose name is already correct is simply written back unchanged."""
    changed = False
    for rec in db.query(CreditPayment).all():
        new_name = compute_statement_name(db, rec)
        if rec.name != new_name:
            rec.name = new_name
            changed = True
    for rec in db.query(Statement).all():
        new_name = compute_statement_name(db, rec)
        if rec.name != new_name:
            rec.name = new_name
            changed = True
    if changed:
        db.commit()
