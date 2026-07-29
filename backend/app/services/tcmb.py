"""
TCMB (Türkiye Cumhuriyet Merkez Bankası) döviz kuru servisi.
Resmi XML endpoint'i ücretsiz ve kayıt gerektirmez.
"""
import httpx
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from sqlalchemy.orm import Session
from app.models import CurrencyRate, ExchangeRate


TCMB_URL = "https://www.tcmb.gov.tr/kurlar/today.xml"
TCMB_DATE_URL = "https://www.tcmb.gov.tr/kurlar/{month}{year}/{day}{month}{year}.xml"


def _parse_tcmb_xml(xml_text: str) -> dict:
    root = ET.fromstring(xml_text)
    rates = {}
    for currency in root.findall("Currency"):
        code = currency.get("Kod") or currency.get("CurrencyCode")
        forex_selling = currency.find("ForexSelling")
        if code and forex_selling is not None and forex_selling.text:
            try:
                rates[code] = float(forex_selling.text.replace(",", "."))
            except ValueError:
                pass
    return rates


def _tcmb_url(target_date: date = None) -> str:
    if target_date and target_date != date.today():
        return TCMB_DATE_URL.format(
            day=str(target_date.day).zfill(2),
            month=str(target_date.month).zfill(2),
            year=str(target_date.year),
        )
    return TCMB_URL


async def fetch_tcmb_rates_with_date(target_date: date = None, max_lookback_days: int = 14) -> tuple[date, dict]:
    """Fetch TCMB rates, walking backwards when the requested date is unpublished."""
    wanted = target_date or date.today()

    async with httpx.AsyncClient(timeout=10) as client:
        for offset in range(max_lookback_days + 1):
            day = wanted - timedelta(days=offset)
            try:
                r = await client.get(_tcmb_url(day))
                r.raise_for_status()
                rates = _parse_tcmb_xml(r.text)
                if rates:
                    return day, rates
            except httpx.HTTPStatusError as exc:
                if exc.response is not None and exc.response.status_code in {403, 404}:
                    continue
                break
            except httpx.RequestError:
                break
            except Exception:
                continue
    return wanted, {}


async def fetch_tcmb_rates(target_date: date = None) -> dict:
    """TCMB'den günlük kur verisini çeker. Hata durumunda son bilinen kuru döner."""
    _, rates = await fetch_tcmb_rates_with_date(target_date)
    return rates


def _history_entry_exists(history: list, as_of: date, source: str) -> bool:
    iso = as_of.isoformat()
    return any(isinstance(h, dict) and h.get("date") == iso and h.get("source") == source for h in history or [])


def _upsert_currency_rate(db: Session, code: str, to_try: float, to_usd: float, as_of: date, source: str, note: str) -> CurrencyRate:
    cur = db.query(CurrencyRate).filter(CurrencyRate.code == code).first()
    if not cur:
        cur = CurrencyRate(code=code, is_default=True)
        db.add(cur)
    history = list(cur.history or [])
    entry = {
        "date": as_of.isoformat(),
        "toTRY": to_try,
        "toUSD": to_usd,
        "source": source,
        "note": note,
    }
    if not _history_entry_exists(history, as_of, source):
        history.insert(0, entry)
    cur.to_try = to_try
    cur.to_usd = to_usd
    cur.as_of = as_of
    cur.source = source
    cur.history = history[:120]
    return cur


async def refresh_currency_rates_from_previous_tcmb(db: Session, today: date = None) -> dict:
    """Refresh dashboard/config FX rows from the previous published TCMB bulletin."""
    target = (today or date.today()) - timedelta(days=1)
    rate_date, rates = await fetch_tcmb_rates_with_date(target)
    usd = rates.get("USD") or rates.get("ABD DOLARI")
    eur = rates.get("EUR") or rates.get("EURO")
    if not usd:
        return {"updated": False, "date": rate_date, "reason": "USD rate unavailable"}

    source = "TCMB"
    note = "Previous-day TCMB bulletin"
    _upsert_currency_rate(db, "TRY", 1.0, 1 / usd, rate_date, source, note)
    _upsert_currency_rate(db, "USD", usd, 1.0, rate_date, source, note)
    if eur:
        _upsert_currency_rate(db, "EUR", eur, eur / usd, rate_date, source, note)
    db.commit()
    return {"updated": True, "date": rate_date, "usd_try": usd, "eur_try": eur}


def get_or_fetch_rate_sync(db: Session, target_date: date) -> ExchangeRate | None:
    """DB'den kur al, yoksa sync fallback (endpoint timeout olmadan)."""
    rate = db.query(ExchangeRate).filter(ExchangeRate.date == target_date).first()
    return rate


async def upsert_today_rate(db: Session) -> ExchangeRate:
    today = date.today()
    existing = db.query(ExchangeRate).filter(ExchangeRate.date == today).first()
    if existing:
        return existing

    rates = await fetch_tcmb_rates(today)
    usd = rates.get("USD") or rates.get("ABD DOLARI")
    eur = rates.get("EUR") or rates.get("EURO")

    record = ExchangeRate(date=today, usd_try=usd, eur_try=eur, source="TCMB")
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
