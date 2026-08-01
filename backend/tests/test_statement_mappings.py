from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.database import get_db
from app.models import Account, Base, StatementMapping, Transaction, User
from app.routers import statement_mappings
from app.services.auth import get_current_user
from app.services.bank_import import import_transactions


def _memory_session():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    return engine, sessionmaker(bind=engine)()


def test_existing_sqlite_table_gets_rule_columns():
    engine = create_engine("sqlite://", poolclass=StaticPool)
    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE statement_mappings (
                id INTEGER PRIMARY KEY,
                lang VARCHAR,
                etiket VARCHAR NOT NULL,
                category_key VARCHAR NOT NULL,
                is_default BOOLEAN
            )
        """))
        conn.execute(text("""
            INSERT INTO statement_mappings (id, lang, etiket, category_key, is_default)
            VALUES (1, 'tr', 'Market', 'groceries', 1)
        """))
    db = sessionmaker(bind=engine)()
    try:
        statement_mappings.ensure_statement_mapping_columns(db)
        row = db.execute(text(
            "SELECT match_scope, priority, is_active FROM statement_mappings WHERE id = 1"
        )).first()
        assert tuple(row) == ("both", 100, 1)
    finally:
        db.close()


def test_normalized_duplicate_is_rejected_but_disjoint_scopes_are_allowed():
    _, db = _memory_session()
    user = User(email="mapping@example.com", username="mapping", hashed_password="x")
    db.add_all([
        user,
        StatementMapping(
            lang="tr", etiket="Akaryakıt", category_key="fuel",
            match_scope="tag", priority=100, is_active=True,
        ),
    ])
    db.commit()
    db.refresh(user)

    app = FastAPI()
    app.include_router(statement_mappings.router)
    app.dependency_overrides[get_db] = lambda: db
    app.dependency_overrides[get_current_user] = lambda: user
    client = TestClient(app)
    try:
        duplicate = client.post("/api/statement-mappings/", json={
            "lang": "tr", "etiket": "AKARYAKIT", "category_key": "transport",
            "match_scope": "both", "priority": 200, "is_active": True,
        })
        assert duplicate.status_code == 409
        assert "akaryakit" in duplicate.json()["detail"]

        allowed = client.post("/api/statement-mappings/", json={
            "lang": "tr", "etiket": "AKARYAKIT", "category_key": "transport",
            "match_scope": "description", "priority": 200, "is_active": True,
        })
        assert allowed.status_code == 201
        assert allowed.json()["match_scope"] == "description"
    finally:
        db.close()


def test_bonus_alias_backfill_groups_tags_and_separates_description_rules():
    _, db = _memory_session()
    statement_mappings.seed_default_statement_mappings(db)
    statement_mappings.ensure_statement_mapping_aliases(db)

    dining_tag = db.query(StatementMapping).filter(
        StatementMapping.etiket.contains("Yeme / İçme")
    ).one()
    assert {part.strip() for part in dining_tag.etiket.split(",")} >= {
        "Yeme / İçme", "Cafe & Restaurant", "Fast Food", "Pastane",
    }
    assert dining_tag.category_key == "dining"

    merchant = db.query(StatementMapping).filter(
        StatementMapping.etiket.contains("SBX")
    ).one()
    assert merchant.category_key == "dining"
    assert merchant.match_scope == "description"
    assert merchant.priority == 200
    db.close()


def test_confirm_defaults_unmatched_owned_credit_and_debit_expenses_to_shopping():
    _, db = _memory_session()
    user = User(email="cards@example.com", username="cards", hashed_password="x")
    db.add(user)
    db.commit()
    db.refresh(user)
    db.add_all([
        Account(owner_id=user.id, account_key="credit-1", name="Bonus", type="credit", currency="TRY"),
        Account(owner_id=user.id, account_key="debit-1", name="Debit", type="debit", currency="TRY"),
    ])
    db.commit()

    result = import_transactions(db, user.id, [
        {"date": "2026-07-01", "description": "UNKNOWN CREDIT MERCHANT", "amount": 10,
         "type": "expense", "currency": "TRY", "payment_method": "credit-1"},
        {"date": "2026-07-02", "description": "UNKNOWN DEBIT MERCHANT", "amount": 20,
         "type": "expense", "currency": "TRY", "payment_method": "debit-1"},
        {"date": "2026-07-03", "description": "UNKNOWN CARD REFUND", "amount": 30,
         "type": "income", "currency": "TRY", "payment_method": "credit-1"},
    ], skip_duplicates=False)

    assert result["imported"] == 3
    rows = {row.description: row for row in db.query(Transaction).all()}
    assert rows["UNKNOWN CREDIT MERCHANT"].category_key == "shopping"
    assert rows["UNKNOWN DEBIT MERCHANT"].category_key == "shopping"
    assert rows["UNKNOWN CARD REFUND"].category_key is None
    db.close()
