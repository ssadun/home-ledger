import asyncio
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.models import Base, CurrencyRate
from app.services import tcmb


@pytest.fixture()
def db():
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Session = sessionmaker(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = Session()
    try:
        yield session
    finally:
        session.close()


def test_refresh_currency_rates_uses_previous_tcmb_day(db, monkeypatch):
    async def fake_fetch(target):
        assert target == date(2026, 7, 28)
        return date(2026, 7, 28), {"USD": 42.0, "EUR": 49.56}

    monkeypatch.setattr(tcmb, "fetch_tcmb_rates_with_date", fake_fetch)

    result = asyncio.run(tcmb.refresh_currency_rates_from_previous_tcmb(db, today=date(2026, 7, 29)))
    assert result["updated"] is True
    assert result["date"] == date(2026, 7, 28)

    rows = {r.code: r for r in db.query(CurrencyRate).all()}
    assert rows["TRY"].to_try == pytest.approx(1)
    assert rows["TRY"].to_usd == pytest.approx(1 / 42.0)
    assert rows["TRY"].as_of == date(2026, 7, 28)
    assert rows["USD"].to_try == pytest.approx(42.0)
    assert rows["USD"].to_usd == pytest.approx(1)
    assert rows["EUR"].to_try == pytest.approx(49.56)
    assert rows["EUR"].to_usd == pytest.approx(49.56 / 42.0)

    asyncio.run(tcmb.refresh_currency_rates_from_previous_tcmb(db, today=date(2026, 7, 29)))
    db.refresh(rows["USD"])
    assert len(rows["USD"].history) == 1
