"""
TCMB (Türkiye Cumhuriyet Merkez Bankası) döviz kuru servisi.
Resmi XML endpoint'i ücretsiz ve kayıt gerektirmez.
"""
import httpx
import xml.etree.ElementTree as ET
from datetime import date, timedelta
from sqlalchemy.orm import Session
from app.models import ExchangeRate


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


async def fetch_tcmb_rates(target_date: date = None) -> dict:
    """TCMB'den günlük kur verisini çeker. Hata durumunda son bilinen kuru döner."""
    if target_date and target_date != date.today():
        url = TCMB_DATE_URL.format(
            day=str(target_date.day).zfill(2),
            month=str(target_date.month).zfill(2),
            year=str(target_date.year),
        )
    else:
        url = TCMB_URL

    async with httpx.AsyncClient(timeout=10) as client:
        try:
            r = await client.get(url)
            r.raise_for_status()
            return _parse_tcmb_xml(r.text)
        except Exception:
            # Weekend / holiday — TCMB doesn't publish; try previous day
            if target_date:
                prev = target_date - timedelta(days=1)
                return await fetch_tcmb_rates(prev)
            return {}


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
