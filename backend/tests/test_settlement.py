"""Tests for the card-payment settlement resolver (services/settlement.py) and its
wiring into the /api/import/confirm path (import_transactions() in bank_import.py).

Scope: Group 2 of plans/UPCOMING_DUE_RECONCILE.md — the resolver + import-confirm
wiring only. Calendar merge, relink protection, minimum-payment parsing, and the
transaction-detail-modal correction flow are later groups and are not tested here.
"""

import pytest
from datetime import date, timedelta
from types import SimpleNamespace

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Account, Base, CreditPayment, Transaction, User
from app.services.bank_import import import_transactions
from app.services.settlement import (
    backfill,
    resolve_bill,
    resolve_card_account,
    settlement_state,
)


def _db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    db = sessionmaker(bind=engine)()
    user = User(
        email="settle@example.com",
        username="settle",
        full_name="Settle User",
        hashed_password="x",
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return db, user


def _card(owner_id, key="acc-card", number=None):
    card = Account(
        owner_id=owner_id,
        account_key=key,
        name="Bonus",
        type="credit",
        currency="TRY",
        number=number,
    )
    return card


def _bank(owner_id, key="acc-bank"):
    return Account(
        owner_id=owner_id,
        account_key=key,
        name="Garanti Hesap",
        type="bank",
        currency="TRY",
    )


def _bill(owner_id, card, payment_date, total_amount=1000.0, minimum_amount=0.0):
    return CreditPayment(
        owner_id=owner_id,
        account_id=card.id,
        account_key=card.account_key,
        name="2026.08 - Bonus",
        period_year=2026,
        period_month=8,
        cutover_date=payment_date - timedelta(days=5),
        payment_date=payment_date,
        total_amount=total_amount,
        minimum_amount=minimum_amount,
        currency="TRY",
    )


# ── resolve_card_account ──────────────────────────────────────────────────────────

def test_resolve_card_account_matches_digits_in_description():
    db, user = _db()
    try:
        other = _card(user.id, key="acc-other", number="5555 **** **** 2222")
        target = _card(user.id, key="acc-target", number="4870 **** **** 1011")
        db.add_all([other, target])
        db.commit()

        resolved = resolve_card_account("KREDİ KARTI BORCU 1011", [other, target])
        assert resolved is target
    finally:
        db.close()


def test_resolve_card_account_falls_back_to_single_credit_card():
    db, user = _db()
    try:
        only = _card(user.id)
        bank = _bank(user.id)
        db.add_all([only, bank])
        db.commit()

        # No digits in the description at all — still resolves via the
        # single-credit-card-in-the-household fallback.
        resolved = resolve_card_account("K.Kartı Ödeme", [only, bank])
        assert resolved is only
    finally:
        db.close()


def test_resolve_card_account_returns_none_when_ambiguous():
    db, user = _db()
    try:
        first = _card(user.id, key="acc-1", number="1111 **** **** 1111")
        second = _card(user.id, key="acc-2", number="2222 **** **** 2222")
        db.add_all([first, second])
        db.commit()

        # Digits present but match neither card, and more than one credit card
        # exists — nothing to safely fall back to.
        resolved = resolve_card_account("KREDİ KARTI BORCU 9999", [first, second])
        assert resolved is None
    finally:
        db.close()


def test_resolve_card_account_returns_none_with_no_credit_accounts():
    db, user = _db()
    try:
        bank = _bank(user.id)
        db.add(bank)
        db.commit()
        assert resolve_card_account("K.Kartı Ödeme", [bank]) is None
    finally:
        db.close()


# ── resolve_bill window boundaries ────────────────────────────────────────────────
# resolve_bill() matches CreditPayment.payment_date in [tx_date-5, tx_date+3] days.
# Solved for tx_date relative to a fixed due date: tx_date must fall in
# [due-3, due+5] to resolve — a settling payment from 3 days before the due date
# (early, rare) up to 5 days after it (late, the common case).

def test_resolve_bill_resolves_at_lower_boundary_due_minus_3():
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due)
        db.add(cp)
        db.commit()

        resolved = resolve_bill(db, user.id, card, due - timedelta(days=3))
        assert resolved is not None
        assert resolved.id == cp.id
    finally:
        db.close()


def test_resolve_bill_resolves_at_upper_boundary_due_plus_5():
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due)
        db.add(cp)
        db.commit()

        resolved = resolve_bill(db, user.id, card, due + timedelta(days=5))
        assert resolved is not None
        assert resolved.id == cp.id
    finally:
        db.close()


def test_resolve_bill_does_not_resolve_just_outside_lower_boundary():
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due)
        db.add(cp)
        db.commit()

        assert resolve_bill(db, user.id, card, due - timedelta(days=4)) is None
    finally:
        db.close()


def test_resolve_bill_does_not_resolve_just_outside_upper_boundary():
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due)
        db.add(cp)
        db.commit()

        assert resolve_bill(db, user.id, card, due + timedelta(days=6)) is None
    finally:
        db.close()


def test_resolve_bill_two_bills_far_apart_do_not_cross_claim():
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        early_due = date(2026, 7, 5)
        late_due = date(2026, 8, 5)
        early_cp = _bill(user.id, card, early_due)
        late_cp = _bill(user.id, card, late_due)
        db.add_all([early_cp, late_cp])
        db.commit()

        resolved = resolve_bill(db, user.id, card, late_due + timedelta(days=1))
        assert resolved is not None
        assert resolved.id == late_cp.id
    finally:
        db.close()


def test_resolve_bill_returns_none_without_account_or_date():
    db, user = _db()
    try:
        assert resolve_bill(db, user.id, None, date(2026, 8, 5)) is None
        card = _card(user.id)
        db.add(card)
        db.commit()
        assert resolve_bill(db, user.id, card, None) is None
    finally:
        db.close()


# ── amount is never the matching gate ─────────────────────────────────────────────

def test_wrong_amount_right_card_and_window_still_links():
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due, total_amount=1000.0)
        db.add(cp)
        db.commit()

        # A partial payment far from the statement total — still resolves, because
        # resolve_bill() never looks at the transaction amount at all.
        resolved = resolve_bill(db, user.id, card, due + timedelta(days=1))
        assert resolved is not None
        assert resolved.id == cp.id
    finally:
        db.close()


def test_right_amount_no_card_resolution_does_not_link():
    db, user = _db()
    try:
        bank = _bank(user.id)
        db.add(bank)
        db.commit()
        # No credit-card account exists in the household at all, so
        # resolve_card_account() can't produce an account for resolve_bill() to use
        # — regardless of how well the amount would have matched a bill.
        assert resolve_card_account("KREDİ KARTI BORCU", [bank]) is None
    finally:
        db.close()


# ── settlement_state ───────────────────────────────────────────────────────────────

def _cp(total_amount, minimum_amount):
    return SimpleNamespace(total_amount=total_amount, minimum_amount=minimum_amount)


def test_settlement_state_unpaid():
    assert settlement_state(_cp(1000, 100), 0) == "unpaid"
    assert settlement_state(_cp(1000, 100), None) == "unpaid"


def test_settlement_state_under_minimum():
    assert settlement_state(_cp(1000, 200), 50) == "under-minimum"


def test_settlement_state_partial():
    assert settlement_state(_cp(1000, 200), 500) == "partial"


def test_settlement_state_paid():
    assert settlement_state(_cp(1000, 200), 1000) == "paid"
    assert settlement_state(_cp(1000, 200), 1200) == "paid"


def test_settlement_state_collapses_to_partial_when_minimum_unparsed():
    # minimum_amount == 0 must never read as "under-minimum" — a payment of 50
    # against an unparsed minimum is "partial", not "Below Minimum".
    assert settlement_state(_cp(1000, 0), 50) == "partial"
    assert settlement_state(_cp(1000, None), 50) == "partial"


def test_settlement_state_never_paid_against_unparsed_total():
    # total_amount unparsed (0/None) means "paid" can never be claimed, even for a
    # large payment — there is nothing trustworthy to compare it against.
    assert settlement_state(_cp(0, 0), 5000) == "partial"
    assert settlement_state(_cp(None, None), 5000) == "partial"


# ── backfill() idempotency ─────────────────────────────────────────────────────────

def test_backfill_resolves_then_is_idempotent_on_repeat_runs():
    db, user = _db()
    try:
        card = _card(user.id)
        bank = _bank(user.id)
        db.add_all([card, bank])
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due)
        db.add(cp)
        db.commit()

        tx = Transaction(
            owner_id=user.id,
            type="expense",
            amount=550,
            currency="TRY",
            description="KREDİ KARTI BORCU",
            date=due + timedelta(days=1),
            category_key="credit-card-payment",
            payment_method=bank.account_key,
        )
        db.add(tx)
        db.commit()
        db.refresh(tx)

        first = backfill(db, user.id)
        assert first["resolved"] == 1
        assert first["unresolved"] == 0
        assert first["already_resolved"] == 1

        db.refresh(tx)
        assert tx.settles_credit_payment_id == cp.id
        assert tx.settles_account_key == card.account_key

        second = backfill(db, user.id)
        assert second["resolved"] == 0
        assert second["already_resolved"] == 1

        db.refresh(tx)
        assert tx.settles_credit_payment_id == cp.id
        assert tx.settles_account_key == card.account_key
    finally:
        db.close()


def test_backfill_never_resolves_the_card_statements_own_income_echo():
    """A card statement's own "payment received" line (e.g. "ÖDEMENİZ İÇİN
    TEŞEKKÜR EDERİZ"/"Cep Şube Ödeme") is legitimately classified income +
    credit-card-payment (see bank_import.py's _cc_classify) — it is NOT a
    settling transaction, since only an expense can pay off a bill. Regression
    for a real-data bug: without the type==expense guard, backfill() linked
    both the real bank-side expense AND this income echo to the same bill,
    exactly doubling paid_total."""
    db, user = _db()
    try:
        card = _card(user.id)
        bank = _bank(user.id)
        db.add_all([card, bank])
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due, total_amount=550)
        db.add(cp)
        db.commit()

        expense_tx = Transaction(
            owner_id=user.id,
            type="expense",
            amount=550,
            currency="TRY",
            description="K.Kartı Ödeme 4870 **** **** 1011",
            date=due,
            category_key="credit-card-payment",
            payment_method=bank.account_key,
        )
        income_echo_tx = Transaction(
            owner_id=user.id,
            type="income",
            amount=550,
            currency="TRY",
            description="ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ",
            date=due,
            category_key="credit-card-payment",
            payment_method=card.account_key,
        )
        db.add_all([expense_tx, income_echo_tx])
        db.commit()
        db.refresh(expense_tx)
        db.refresh(income_echo_tx)

        result = backfill(db, user.id)
        assert result["resolved"] == 1
        # The income echo is excluded at the query level (type == expense), not
        # counted as a failed-to-resolve candidate.
        assert result["unresolved"] == 0

        db.refresh(expense_tx)
        db.refresh(income_echo_tx)
        assert expense_tx.settles_credit_payment_id == cp.id
        assert income_echo_tx.settles_credit_payment_id is None
    finally:
        db.close()


def test_backfill_leaves_unresolvable_rows_untouched_and_retries_them():
    db, user = _db()
    try:
        bank = _bank(user.id)
        db.add(bank)
        db.commit()
        # No credit-card account exists at all, so this row can never resolve.
        tx = Transaction(
            owner_id=user.id,
            type="expense",
            amount=100,
            currency="TRY",
            description="K.Kartı Ödeme",
            date=date(2026, 8, 6),
            category_key="credit-card-payment",
            payment_method=bank.account_key,
        )
        db.add(tx)
        db.commit()

        first = backfill(db, user.id)
        assert first["resolved"] == 0
        assert first["unresolved"] == 1
        assert first["already_resolved"] == 0

        second = backfill(db, user.id)
        assert second["resolved"] == 0
        assert second["unresolved"] == 1
        assert second["already_resolved"] == 0

        db.refresh(tx)
        assert tx.settles_credit_payment_id is None
        assert tx.settles_account_key is None
    finally:
        db.close()


# ── import-confirm wiring (Step 4) ──────────────────────────────────────────────────

def test_import_confirm_links_credit_card_payment_row_regardless_of_amount():
    db, user = _db()
    try:
        card = _card(user.id)
        bank = _bank(user.id)
        db.add_all([card, bank])
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due, total_amount=1000.0)
        db.add(cp)
        db.commit()

        # 137.50 has nothing to do with the bill's 1000 total — proves amount is
        # not part of the matching key, only the card + date window is.
        row = {
            "date": (due + timedelta(days=2)).isoformat(),
            "amount": 137.50,
            "type": "expense",
            "currency": "TRY",
            "description": "KREDİ KARTI BORCU",
            "payment_method": bank.account_key,
            "category_key": "credit-card-payment",
        }
        result = import_transactions(db, user.id, [row], skip_duplicates=False)
        assert result["imported"] == 1

        tx = db.query(Transaction).filter(Transaction.owner_id == user.id).one()
        assert tx.settles_credit_payment_id == cp.id
        assert tx.settles_account_key == card.account_key
    finally:
        db.close()


def test_import_confirm_never_links_an_income_credit_card_payment_row():
    """Regression: a card statement's own income "payment received" line
    (category_key credit-card-payment, type income) must never resolve at
    import time either — only the bank-side expense leg can pay off a bill."""
    db, user = _db()
    try:
        card = _card(user.id)
        db.add(card)
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due, total_amount=1000.0)
        db.add(cp)
        db.commit()

        row = {
            "date": due.isoformat(),
            "amount": 1000.0,
            "type": "income",
            "currency": "TRY",
            "description": "ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ",
            "payment_method": card.account_key,
            "category_key": "credit-card-payment",
        }
        result = import_transactions(db, user.id, [row], skip_duplicates=False)
        assert result["imported"] == 1

        tx = db.query(Transaction).filter(Transaction.owner_id == user.id).one()
        assert tx.settles_credit_payment_id is None
        assert tx.settles_account_key is None
    finally:
        db.close()


def test_import_confirm_uses_settles_account_key_when_provided_skipping_resolve_card_account():
    db, user = _db()
    try:
        # Two credit cards — resolve_card_account() alone couldn't disambiguate,
        # but an explicit settles_account_key on the row bypasses it entirely.
        card_a = _card(user.id, key="acc-a", number="1111 **** **** 1111")
        card_b = _card(user.id, key="acc-b", number="2222 **** **** 2222")
        bank = _bank(user.id)
        db.add_all([card_a, card_b, bank])
        db.commit()
        due = date(2026, 8, 5)
        cp_b = _bill(user.id, card_b, due, total_amount=1000.0)
        db.add(cp_b)
        db.commit()

        row = {
            "date": (due + timedelta(days=1)).isoformat(),
            "amount": 400,
            "type": "expense",
            "currency": "TRY",
            "description": "KREDİ KARTI BORCU",
            "payment_method": bank.account_key,
            "category_key": "credit-card-payment",
            "settles_account_key": card_b.account_key,
        }
        result = import_transactions(db, user.id, [row], skip_duplicates=False)
        assert result["imported"] == 1

        tx = db.query(Transaction).filter(Transaction.owner_id == user.id).one()
        assert tx.settles_credit_payment_id == cp_b.id
        assert tx.settles_account_key == card_b.account_key
    finally:
        db.close()


def test_import_confirm_unresolvable_row_imports_unchanged_no_errors():
    """Purely additive: a row that can't resolve a card/bill behaves exactly as it
    did before settlement resolution existed — both new columns stay None, no
    exceptions, normal import counts."""
    db, user = _db()
    try:
        bank = _bank(user.id)
        db.add(bank)
        db.commit()
        # category_key == credit-card-payment, but no credit-card account exists
        # anywhere in the household, so resolve_card_account() can't produce one.
        row = {
            "date": "2026-08-06",
            "amount": 250,
            "type": "expense",
            "currency": "TRY",
            "description": "K.Kartı Ödeme",
            "payment_method": bank.account_key,
            "category_key": "credit-card-payment",
        }
        result = import_transactions(db, user.id, [row], skip_duplicates=False)
        assert result["imported"] == 1
        assert result["errors"] == []

        tx = db.query(Transaction).filter(Transaction.owner_id == user.id).one()
        assert tx.settles_credit_payment_id is None
        assert tx.settles_account_key is None
    finally:
        db.close()


# ── realistic backfill snapshot (Group 9, plan Tests item) ──────────────────────────
# Reproduces the real household's actual historical settlement shape (see
# UPCOMING_DUE_RECONCILE.md's "Decided design" note and
# UPCOMING_DUE_RECONCILE_PROGRESS.md's Group 5 section): 7 monthly bills, 5 of which
# (CP1,3,5,6,7) are settled by a single bank-side expense transaction that fully pays
# the bill, and 2 of which (CP2,4) are only PARTIALLY settled by two separate
# same/near-same-date bank-side expense transactions that together fall short of the
# total. Every bill also carries the card's own income "payment received" echo line at
# the same date/amount -- this must never resolve (the exact bug Group 5 found+fixed:
# without the type==expense guard the echo doubled paid_total).
#
# This was informally verified live against the real household DB during Groups 5 and
# 7-8 (real POST /api/credit-payments/reconcile calls) but never captured as a
# permanent automated snapshot until now.

def _paid_total(db, cp_id):
    txs = (
        db.query(Transaction)
        .filter(Transaction.settles_credit_payment_id == cp_id)
        .all()
    )
    return sum(tx.amount or 0.0 for tx in txs), sorted(t.id for t in txs)


def test_backfill_realistic_snapshot_single_vs_split_settlement_and_idempotency():
    db, user = _db()
    try:
        card = _card(user.id)
        bank = _bank(user.id)
        db.add_all([card, bank])
        db.commit()

        # 7 monthly bills, 30+ days apart so none can cross-claim another's txns.
        due_dates = {
            1: date(2026, 2, 5),
            2: date(2026, 3, 5),
            3: date(2026, 4, 5),
            4: date(2026, 5, 5),
            5: date(2026, 6, 5),
            6: date(2026, 7, 5),
            7: date(2026, 8, 5),
        }
        totals = {
            1: 12000.0,
            2: 15000.0,
            3: 9000.0,
            4: 20000.0,
            5: 11000.0,
            6: 13000.0,
            7: 125000.0,
        }
        bills = {}
        for n, due in due_dates.items():
            cp = _bill(user.id, card, due, total_amount=totals[n])
            db.add(cp)
            bills[n] = cp
        db.commit()
        for cp in bills.values():
            db.refresh(cp)

        # Card's own "payment received" income echo for every bill -- same date/
        # amount as the bill total, posted on the CARD (not the bank) -- must never
        # resolve, regardless of single-vs-split settlement.
        for n, due in due_dates.items():
            db.add(
                Transaction(
                    owner_id=user.id,
                    type="income",
                    amount=totals[n],
                    currency="TRY",
                    description="\u00d6DEMEN\u0130Z\u0130 \u0130\u00c7\u0130N TE\u015eEKK\u00dcR EDER\u0130Z",
                    date=due,
                    category_key="credit-card-payment",
                    payment_method=card.account_key,
                )
            )

        # CP 1,3,5,6,7 -- single bank-side expense fully settles the bill.
        single_expense_ids = {}
        for n in (1, 3, 5, 6, 7):
            due = due_dates[n]
            tx = Transaction(
                owner_id=user.id,
                type="expense",
                amount=totals[n],
                currency="TRY",
                description="KRED\u0130 KARTI BORCU",
                date=due,
                category_key="credit-card-payment",
                payment_method=bank.account_key,
            )
            db.add(tx)
            single_expense_ids[n] = tx  # ref, id assigned after commit

        # CP 2,4 -- split across two same/near-same-date transactions, sum < total
        # (a real partial payment, not a coincidental full one).
        split_amounts = {
            2: (6000.0, 2500.0),   # sum 8500 < 15000 total -> partial
            4: (9000.0, 3000.0),   # sum 12000 < 20000 total -> partial
        }
        split_tx_refs = {}
        for n, (a1, a2) in split_amounts.items():
            due = due_dates[n]
            tx1 = Transaction(
                owner_id=user.id,
                type="expense",
                amount=a1,
                currency="TRY",
                description="K.Kart\u0131 \u00d6deme",
                date=due,
                category_key="credit-card-payment",
                payment_method=bank.account_key,
            )
            tx2 = Transaction(
                owner_id=user.id,
                type="expense",
                amount=a2,
                currency="TRY",
                description="K.Kart\u0131 \u00d6deme",
                date=due + timedelta(days=1),
                category_key="credit-card-payment",
                payment_method=bank.account_key,
            )
            db.add_all([tx1, tx2])
            split_tx_refs[n] = (tx1, tx2)

        db.commit()
        for tx in single_expense_ids.values():
            db.refresh(tx)
        for tx1, tx2 in split_tx_refs.values():
            db.refresh(tx1)
            db.refresh(tx2)

        # 5 single expenses + 2*2 split expenses = 9 resolvable rows; the 7 income
        # echoes are excluded at the query level (type == expense), not counted as
        # unresolved.
        first = backfill(db, user.id)
        assert first["resolved"] == 9
        assert first["unresolved"] == 0
        assert first["already_resolved"] == 9

        # CP 1,3,5,6,7: fully paid by their single expense.
        for n in (1, 3, 5, 6, 7):
            cp = bills[n]
            paid, tx_ids = _paid_total(db, cp.id)
            assert paid == pytest.approx(totals[n])
            assert tx_ids == sorted([single_expense_ids[n].id])
            assert settlement_state(cp, paid) == "paid"

        # CP 2,4: only partially settled -- summed paid falls short of the total.
        for n in (2, 4):
            cp = bills[n]
            tx1, tx2 = split_tx_refs[n]
            paid, tx_ids = _paid_total(db, cp.id)
            expected_sum = sum(split_amounts[n])
            assert paid == pytest.approx(expected_sum)
            assert paid < totals[n]
            assert tx_ids == sorted([tx1.id, tx2.id])
            assert settlement_state(cp, paid) == "partial"

        # Every income echo must stay unresolved across the board.
        echoes = (
            db.query(Transaction)
            .filter(Transaction.owner_id == user.id, Transaction.type == "income")
            .all()
        )
        assert len(echoes) == 7
        for echo in echoes:
            assert echo.settles_credit_payment_id is None
            assert echo.settles_account_key is None

        # Idempotent: a second run must not re-resolve, re-link, or duplicate
        # anything -- resolved goes to 0, already_resolved stays exactly 9, and
        # every previously-linked tx keeps the exact same link.
        second = backfill(db, user.id)
        assert second["resolved"] == 0
        assert second["unresolved"] == 0
        assert second["already_resolved"] == 9

        for n in (1, 3, 5, 6, 7):
            cp = bills[n]
            paid, tx_ids = _paid_total(db, cp.id)
            assert paid == pytest.approx(totals[n])
            assert tx_ids == sorted([single_expense_ids[n].id])

        for n in (2, 4):
            cp = bills[n]
            tx1, tx2 = split_tx_refs[n]
            paid, tx_ids = _paid_total(db, cp.id)
            assert paid == pytest.approx(sum(split_amounts[n]))
            assert tx_ids == sorted([tx1.id, tx2.id])

        for echo in echoes:
            db.refresh(echo)
            assert echo.settles_credit_payment_id is None
    finally:
        db.close()


def test_import_confirm_ordinary_row_never_attempts_resolution():
    """A row that isn't classified credit-card-payment must not even try to
    resolve — the settlement wiring is scoped to that one category only."""
    db, user = _db()
    try:
        card = _card(user.id)
        bank = _bank(user.id)
        db.add_all([card, bank])
        db.commit()
        due = date(2026, 8, 5)
        cp = _bill(user.id, card, due)
        db.add(cp)
        db.commit()

        row = {
            "date": (due + timedelta(days=1)).isoformat(),
            "amount": 250,
            "type": "expense",
            "currency": "TRY",
            "description": "MARKET",
            "payment_method": bank.account_key,
            "category_key": "groceries",
        }
        result = import_transactions(db, user.id, [row], skip_duplicates=False)
        assert result["imported"] == 1

        tx = db.query(Transaction).filter(Transaction.owner_id == user.id).one()
        assert tx.settles_credit_payment_id is None
        assert tx.settles_account_key is None
    finally:
        db.close()
