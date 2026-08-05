"""
Banka ekstre import servisi.

Desteklenen bankalar:
  - Garanti BBVA   → XLS/XLSX/CSV
  - ON (Burgan)    → XLS/XLSX/CSV
  - TEB            → PDF / HTML tabanlı XLS
  - QNB Finansbank → PDF hesap hareketleri
  - Odea Bank      → PDF/XLSX hesap hareketleri
  - Generic        → Akıllı kolon tahmini (diğer bankalar için fallback)

Her parser normalize edilmiş şu formata çıktı üretir:
  {
    date: str (YYYY-MM-DD),
    description: str,
    amount: float,         # pozitif = gelir, negatif = gider
    type: "income"|"expense",
    currency: "TRY"|"USD"|"EUR",
    balance: float|None,
    raw: dict              # orijinal satır (debug için)
  }
"""

import io
import csv
import re
import unicodedata
from datetime import datetime
from html.parser import HTMLParser
from typing import Optional
from sqlalchemy.orm import Session
from app.models import Transaction

try:
    import pandas as pd
    PANDAS_OK = True
except ImportError:
    PANDAS_OK = False


# ─────────────────────────────────────────────────────────────────────────────
# Yardımcı fonksiyonlar
# ─────────────────────────────────────────────────────────────────────────────

# Türkçe ay adları (PDF ekstrelerinde "02 Haziran 2026" gibi yazılır).
TURKISH_MONTHS = {
    "ocak": 1, "şubat": 2, "subat": 2, "mart": 3, "nisan": 4, "mayıs": 5, "mayis": 5,
    "haziran": 6, "temmuz": 7, "ağustos": 8, "agustos": 8, "eylül": 9, "eylul": 9,
    "ekim": 10, "kasım": 11, "kasim": 11, "aralık": 12, "aralik": 12,
}
_TR_MONTH_DATE_RE = re.compile(r"^(\d{1,2})\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})$")


def _parse_turkish_date(value: str) -> Optional[str]:
    """
    Türk bankalarında yaygın tarih formatlarını YYYY-MM-DD'ye çevirir.
    Örnekler: 15.03.2024  /  15/03/2024  /  2024-03-15  /  15-03-2024
              02 Haziran 2026  (PDF kredi kartı ekstresi)
    """
    if not value or not isinstance(value, str):
        return None
    value = value.strip()
    patterns = [
        ("%d.%m.%Y", r"\d{2}\.\d{2}\.\d{4}"),
        ("%d/%m/%Y", r"\d{2}/\d{2}/\d{4}"),
        ("%Y-%m-%d", r"\d{4}-\d{2}-\d{2}"),
        ("%d-%m-%Y", r"\d{2}-\d{2}-\d{4}"),
        ("%d.%m.%y", r"\d{2}\.\d{2}\.\d{2}"),
    ]
    for fmt, pattern in patterns:
        if re.match(pattern, value):
            try:
                return datetime.strptime(value, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
    # Türkçe ay adlı format: "02 Haziran 2026"
    m = _TR_MONTH_DATE_RE.match(value)
    if m:
        month = TURKISH_MONTHS.get(m.group(2).lower())
        if month:
            try:
                return datetime(int(m.group(3)), month, int(m.group(1))).strftime("%Y-%m-%d")
            except ValueError:
                return None
    return None


def _parse_amount(value) -> Optional[float]:
    """
    Türkçe / İngilizce sayı formatlarını float'a çevirir.
    1.234,56  →  1234.56
    1,234.56  →  1234.56
    -1.234,56 →  -1234.56
    """
    if value is None:
        return None
    s = str(value).strip().replace(" ", "").replace("\xa0", "")
    if not s or s in ("-", ""):
        return None
    has_dot = "." in s
    has_comma = "," in s
    if has_dot and has_comma:
        # Her ikisi de varsa: en sağdaki ayırıcı ondalıktır
        if s.rindex(",") > s.rindex("."):
            s = s.replace(".", "").replace(",", ".")   # Türkçe: 1.234,56
        else:
            s = s.replace(",", "")                       # İngilizce: 1,234.56
    elif has_comma:
        # Tek virgül: sonrasında 1-2 hane varsa ondalık (900,00), değilse binlik
        dec = s.rsplit(",", 1)[-1]
        s = s.replace(",", ".") if len(dec) in (1, 2) else s.replace(",", "")
    # sadece nokta veya düz sayı → olduğu gibi bırak (4203.36)
    try:
        return float(s)
    except ValueError:
        return None


def _detect_currency(text: str) -> str:
    text = str(text).upper()
    if "USD" in text or "$" in text or "DOLAR" in text:
        return "USD"
    if "EUR" in text or "€" in text or "EURO" in text:
        return "EUR"
    return "TRY"


# Diacritic fold so Turkish-cased keywords match regardless of İ/ı/Ş/Ü/… casing.
_TR_FOLD = str.maketrans({
    "ı": "i", "İ": "i", "ş": "s", "Ş": "s", "ğ": "g", "Ğ": "g",
    "ü": "u", "Ü": "u", "ö": "o", "Ö": "o", "ç": "c", "Ç": "c", "â": "a",
})


def _fold(s: str) -> str:
    return (s or "").translate(_TR_FOLD).upper()


def _cc_classify(description: str) -> tuple[Optional[str], Optional[str]]:
    """Credit-card statement lines whose meaning the sign-based rule gets wrong.
    Returns (type_override, category_key_override).

    - "ÖDEMENİZ İÇİN TEŞEKKÜR EDERİZ" (your payment) → income, category "Credit Card Payment"
      A payment credits the card (reduces the debt), so it is booked as income.
    - "ÖNCEKİ DÖNEMDEN DEVİR EDİLEN TUTAR" (balance carried over) → expense, category "Debt"
    - "…VIRMAN…" (internal account transfer) → category "Wire Transfer" (type kept
      as-is: a virman may be incoming or outgoing per its sign). Valid for every import.
    - "KESİNTİ VE EKLERİ" (bank deductions & additions) → category "Commission" (type
      kept per its sign). Valid for every import; wins over the Etiket/Diğer rules so
      these fee lines aren't left as a generic "Other" tag.
    - "G.E. <sözleşme no>" (Garanti Emeklilik) → category "Retirement". A BES
      contribution charged to a credit card; the description carries the contract
      number, which is what links it back to the pension Account (see _BES_CONTRIB_RE).
    """
    # Strip everything but letters/digits so interleaved spaces or stray
    # watermark punctuation ("TE ŞE-KKÜR") can't break the keyword match.
    f = re.sub(r"[^A-Z0-9]", "", _fold(description))
    if "TESEKKUR" in f:
        return "income", "credit-card-payment"
    if "DEVIR" in f:
        return "expense", "debt"
    if "VIRMAN" in f:
        return None, "wire-transfer"
    if "KESINTIVEEKLERI" in f:
        return None, "commission"
    # Runs BEFORE the Etiket map, which is what makes this beat the card's
    # "Emeklilik / Sigorta" tag — that tag also covers ordinary insurance premiums
    # (e.g. "HEPİYİ SİGORTA"), so only this description shape means a BES payment.
    if _BES_CONTRIB_RE.match(_fold(description)):
        return None, "retirement"
    return None, None


# A BES contribution as it posts on a Garanti card statement:
#   "G.E. 17943452 İSTANBUL"  →  Garanti Emeklilik + the BES contract number.
# Anchored at the start and requiring 6+ digits so it can't fire on unrelated
# merchant names. Group 1 is the contract number, used to link the charge to a
# pension Account (Account.pension["contract_no"]).
_BES_CONTRIB_RE = re.compile(r"^G\.?\s?E\.?\s+(\d{6,})\b")


def bes_contract_of(description: str) -> Optional[str]:
    """Contract number from a card line's description, or None if it isn't a BES charge."""
    m = _BES_CONTRIB_RE.match(_fold(description))
    return m.group(1) if m else None


# "Diğer" / "Other" as a whole word (folded). Word-bounded so it won't fire on
# BROTHER/OTHERS etc. Used only for bank-account statements (see _normalize_row).
_DIGER_RE = re.compile(r"\b(DIGER|OTHER)\b")


# Statement mapping keys are matched against Garanti's structured "Etiket" column
# when present. Account statements commonly have no such column; for those rows,
# the same mapping text is matched as a normalized phrase inside the description.
# Keys are diacritic-folded and stripped of every non-alphanumeric char so slash /
# spacing variants ("Faiz / Komisyon", "Faiz/Komisyon") all collapse to one key.
# "Diğer" is intentionally absent: on BANK statements it falls to the _DIGER_RE
# transfer rule, on CARD statements it stays a plain expense. "Para Çekme" (ATM
# withdrawal) is likewise left to the sign-based default.
_ETIKET_CATEGORY = {
    "maas":                 "salary",              # Maaş
    "paratransferi":        "wire-transfer",       # Para Transferi
    "kartodemesi":          "credit-card-payment", # Kart Ödemesi
    "faizkomisyon":         "interest",            # Faiz / Komisyon
    "telekomunikasyon":     "utilities",           # Telekomünikasyon
    "ulasim":               "transport",           # Ulaşım
    "dovizalsat":           "wire-transfer",       # Döviz Al / Sat
    "market":               "groceries",           # Market
    "supermarket":          "groceries",           # Süpermarket
    "yemeicme":             "dining",              # Yeme / İçme
    "caferestaurant":       "dining",              # Cafe & Restaurant
    "fastfood":             "dining",              # Fast Food
    "pastane":              "dining",              # Pastane
    "sbx":                  "dining",
    "sbux":                 "dining",
    "starbucks":            "dining",
    "akaryakit":            "transport",           # Akaryakıt
    "giyimaksesuar":        "shopping",            # Giyim / Aksesuar
    "eglencehobi":          "entertainment",       # Eğlence / Hobi
    "eglence":              "entertainment",       # Tam ekstre bölüm başlığı
    "paribucineverse":      "entertainment",
    "passo":                "entertainment",
    "saglikbakim":          "health",              # Sağlık / Bakım
    "elektronik":           "shopping",            # Elektronik
    "bilgisayar":           "shopping",            # Tam ekstre bölüm başlığı
    "arcelik":              "shopping",
    "evdekorasyon":         "shopping",            # Ev / Dekorasyon
    "kisiselhizmet":        "shopping",            # Kişisel Hizmet
    # Covers BOTH pension contributions and ordinary insurance premiums
    # ("HEPİYİ SİGORTA"), so it maps to the safer of the two. Real BES payments are
    # claimed earlier by _cc_classify's "G.E. <sözleşme no>" rule.
    "emekliliksigorta":     "insurance",           # Emeklilik / Sigorta
}


def _etiket_key(etiket: str) -> str:
    """Turkish-safe lowercase key used by every statement mapping lookup.

    Mapping dotted/dotless I before case-folding makes I/İ/ı/i converge to ``i``.
    The stored description and tag remain untouched; only this search shadow is
    stripped of accents, whitespace, and punctuation.
    """
    value = unicodedata.normalize("NFKC", etiket or "").translate(_TR_FOLD).casefold()
    value = "".join(
        char for char in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(char)
    )
    return re.sub(r"[^a-z0-9]", "", value)


def _statement_words(value: str) -> str:
    """Canonical lowercase text with token boundaries retained for short keys."""
    folded = unicodedata.normalize("NFKC", value or "").translate(_TR_FOLD).casefold()
    folded = "".join(
        char for char in unicodedata.normalize("NFKD", folded)
        if not unicodedata.combining(char)
    )
    return re.sub(r"[^a-z0-9]+", " ", folded).strip()


def _etiket_keys(etiket: str) -> list[str]:
    """Lookup keys for one UI mapping row; commas separate alternate tags."""
    return [key for key in (_etiket_key(part) for part in (etiket or "").split(",")) if key]


# Runtime rules loaded from Configuration → Statement Value Mapping. Each
# comma-separated alias becomes one flat rule. None means use the bootstrap map.
_ETIKET_RUNTIME: Optional[list[dict]] = None


def _mapping_rules() -> list[dict]:
    source = _ETIKET_RUNTIME
    if source is None:
        source = [
            {"key": key, "category_key": category_key, "match_scope": "both",
             "priority": 100, "mapping_id": 0, "words": key}
            for key, category_key in _ETIKET_CATEGORY.items()
        ]
    # Compatibility for callers/tests that replace the runtime table with a dict.
    if isinstance(source, dict):
        source = [
            {"key": _etiket_key(key), "category_key": category_key,
             "match_scope": "both", "priority": 100, "mapping_id": 0,
             "words": _statement_words(key)}
            for key, category_key in source.items()
        ]
    return sorted(
        source,
        key=lambda rule: (
            -int(rule.get("priority", 100)),
            -len(rule.get("key", "")),
            int(rule.get("mapping_id", 0)),
        ),
    )


def load_etiket_map(db) -> None:
    """Refresh the runtime Etiket→category map from the statement_mappings table.
    Once loaded, the DB is authoritative (deletions take effect); on any failure we
    keep the previous map / hardcoded fallback so imports never break."""
    global _ETIKET_RUNTIME
    try:
        from app.models import StatementMapping
        rules: list[dict] = []
        rows = (
            db.query(StatementMapping)
            .filter(StatementMapping.is_active.is_(True))
            .order_by(StatementMapping.priority.desc(), StatementMapping.id.asc())
            .all()
        )
        for row in rows:
            if row.etiket and row.category_key:
                for alias in (part.strip() for part in row.etiket.split(",")):
                    key = _etiket_key(alias)
                    if not key:
                        continue
                    rules.append({
                        "key": key,
                        "words": _statement_words(alias),
                        "category_key": row.category_key,
                        "match_scope": row.match_scope or "both",
                        "priority": row.priority if row.priority is not None else 100,
                        "mapping_id": row.id,
                    })
        _ETIKET_RUNTIME = rules
    except Exception:
        pass  # keep whatever we had; statement mapping falls back to _ETIKET_CATEGORY


def _statement_mapping_category(etiket: str = "", description: str = "") -> Optional[str]:
    """Map statement text to a category_key.

    Tag and description candidates share one priority order. Higher priority wins;
    ties prefer the longer normalized keyword and then the older mapping id. Tag
    rules still require an exact match, while description rules use controlled
    contains matching. This lets a specific merchant rule override a broad bank
    section tag without making every transaction in that section use the merchant
    category.
    """
    if not etiket and not description:
        return None
    rules = _mapping_rules()
    tag_key = _etiket_key(etiket) if etiket else ""
    desc_words = _statement_words(description)
    desc_tokens = desc_words.split()
    for rule in rules:
        key = rule["key"]
        if not key:
            continue
        if (
            tag_key
            and rule["match_scope"] in {"tag", "both"}
            and key == tag_key
        ):
            return rule["category_key"]
        if not desc_words or rule["match_scope"] not in {"description", "both"}:
            continue
        rule_words = rule.get("words") or key
        if " " in rule_words:
            matched = bool(re.search(
                rf"(?:^|\s){re.escape(rule_words)}(?:$|\s)", desc_words
            ))
        elif len(key) <= 4:
            matched = key in desc_tokens
        else:
            # Long keys may sit inside one gateway-prefixed token, but must not
            # concatenate across punctuation-separated tokens. This prevents a
            # rule such as KOLAYPASSO matching "PAYNKOLAY/PASSO" accidentally.
            matched = any(key in token for token in desc_tokens)
        if matched:
            return rule["category_key"]
    return None


def _normalize_row(date: str, description: str, amount: float, balance=None, raw=None,
                   currency="TRY", etiket=None, source=None, account_type=None) -> dict:
    type_override, category_override = _cc_classify(description)
    # Garanti's "Etiket" column is a structured category tag — trust it when the
    # description-based rules above didn't already classify the row. Account
    # statements without Etiket fall back to matching the mapping text in the
    # description. Only sets the category; direction still follows the amount sign.
    if category_override is None:
        category_override = _statement_mapping_category(etiket, description)
    # Non-card statements default to Wire Transfer only after special rules and
    # Statement Value Mapping have failed. Card statements keep their own fallback:
    # unknown credit/debit expenses become Shopping below, while card income stays
    # unclassified.
    if category_override is None and account_type == "bank" and _DIGER_RE.search(_fold(description)):
        category_override = "wire-transfer"
    if category_override is None and account_type and account_type not in {"credit", "debit"}:
        category_override = "wire-transfer"
    # Ordinary credit/debit-card expenses use Shopping only after special rules,
    # exact statement tags, and description keywords have all failed.
    if category_override is None and account_type in {"credit", "debit"} and amount < 0:
        category_override = "shopping"
    return {
        "date": date,
        "description": (description or "").strip()[:200],
        "amount": round(abs(amount), 2),
        "type": type_override or ("income" if amount > 0 else "expense"),
        "category_key": category_override,
        "currency": currency,
        "balance": balance,
        "etiket": (etiket or "").strip() or None,   # Türkçe kategori etiketi (Garanti export)
        "source": (source or "").strip() or None,   # kaynak kart/hesap referansı (per-card mapping)
        "raw": raw or {},
    }


# ─────────────────────────────────────────────────────────────────────────────
# Garanti BBVA parser
# ─────────────────────────────────────────────────────────────────────────────
# Garanti Excel'i genellikle şu yapıda gelir:
#   İlk birkaç satır: banka başlık bilgisi (hesap no, dönem vb.)
#   Kolon başlıkları: Tarih | İşlem | Borç | Alacak | Bakiye
#   veya:             Tarih | Açıklama | Tutar | Bakiye  (tek tutar kolonu)

GARANTI_DATE_COLS    = ["tarih", "date", "işlem tarihi", "islem tarihi"]
GARANTI_DESC_COLS    = ["açıklama", "aciklama", "işlem", "islem", "açıklamalar", "description"]
GARANTI_DEBIT_COLS   = ["borç", "borc", "çıkış", "cikis", "harcama", "debit"]
GARANTI_CREDIT_COLS  = ["alacak", "giriş", "giris", "tahsilat", "credit"]
GARANTI_AMOUNT_COLS  = ["tutar", "amount", "miktar"]
GARANTI_BALANCE_COLS = ["bakiye", "balance", "kalan"]


def _find_col(cols: list[str], candidates: list[str]) -> Optional[str]:
    cols_lower = {c.lower().strip(): c for c in cols}
    for c in candidates:
        if c in cols_lower:
            return cols_lower[c]
    # Partial match
    for c in candidates:
        for col in cols_lower:
            if c in col:
                return cols_lower[col]
    return None


def _parse_garanti(df) -> list[dict]:
    rows = []
    cols = list(df.columns)

    date_col    = _find_col(cols, GARANTI_DATE_COLS)
    desc_col    = _find_col(cols, GARANTI_DESC_COLS)
    debit_col   = _find_col(cols, GARANTI_DEBIT_COLS)
    credit_col  = _find_col(cols, GARANTI_CREDIT_COLS)
    amount_col  = _find_col(cols, GARANTI_AMOUNT_COLS)
    balance_col = _find_col(cols, GARANTI_BALANCE_COLS)

    if not date_col or not desc_col:
        return []

    for _, row in df.iterrows():
        date_raw = str(row.get(date_col, "")).strip()
        date = _parse_turkish_date(date_raw)
        if not date:
            continue

        desc = str(row.get(desc_col, "")).strip()

        # Borç/Alacak ayrı kolonlarda mı?
        if debit_col and credit_col:
            debit  = _parse_amount(row.get(debit_col))  or 0
            credit = _parse_amount(row.get(credit_col)) or 0
            amount = credit - debit  # alacak pozitif, borç negatif
        elif amount_col:
            amount = _parse_amount(row.get(amount_col)) or 0
        else:
            continue

        if amount == 0:
            continue

        balance = _parse_amount(row.get(balance_col)) if balance_col else None
        currency = _detect_currency(desc)
        rows.append(_normalize_row(date, desc, amount, balance, dict(row), currency))

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# ON Burgan parser
# ─────────────────────────────────────────────────────────────────────────────
# ON (Burgan Bank) Excel genellikle şu yapıda:
#   İlk satır(lar): başlık
#   Kolonlar: Tarih | Valör | Açıklama | Borç | Alacak | Bakiye
#   veya CSV:  date,valör,açıklama,borç,alacak,bakiye

ON_DATE_COLS    = ["tarih", "date", "işlem tarihi", "islem tarihi"]
ON_DESC_COLS    = ["açıklama", "aciklama", "işlem açıklaması", "islem aciklamasi", "description"]
ON_DEBIT_COLS   = ["borç", "borc", "çıkış tutarı", "cikis tutari", "debit"]
ON_CREDIT_COLS  = ["alacak", "giriş tutarı", "giris tutari", "credit"]
ON_BALANCE_COLS = ["bakiye", "balance"]


def _parse_on_burgan(df) -> list[dict]:
    # ON formatı Garanti ile çok benzer, aynı mantığı kullanabiliriz
    # Sadece kolon adları farklı olabilir
    rows = []
    cols = list(df.columns)

    date_col    = _find_col(cols, ON_DATE_COLS)
    desc_col    = _find_col(cols, ON_DESC_COLS)
    debit_col   = _find_col(cols, ON_DEBIT_COLS)
    credit_col  = _find_col(cols, ON_CREDIT_COLS)
    balance_col = _find_col(cols, ON_BALANCE_COLS)

    if not date_col or not desc_col:
        return []

    for _, row in df.iterrows():
        date_raw = str(row.get(date_col, "")).strip()
        date = _parse_turkish_date(date_raw)
        if not date:
            continue

        desc = str(row.get(desc_col, "")).strip()

        debit  = _parse_amount(row.get(debit_col))  or 0 if debit_col else 0
        credit = _parse_amount(row.get(credit_col)) or 0 if credit_col else 0
        amount = credit - debit

        if amount == 0:
            continue

        balance = _parse_amount(row.get(balance_col)) if balance_col else None
        currency = _detect_currency(desc)
        rows.append(_normalize_row(date, desc, amount, balance, dict(row), currency))

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Generic / akıllı fallback parser
# ─────────────────────────────────────────────────────────────────────────────
# Kolon adlarını tahmin eder. Türk bankalarının büyük çoğunluğu
# Tarih / Açıklama / Borç / Alacak / Bakiye formatını kullanır.

def _parse_generic(df) -> list[dict]:
    """Garanti ve ON parserleri üst üste çalıştır, ilk başarılıyı döndür."""
    result = _parse_garanti(df)
    if result:
        return result
    result = _parse_on_burgan(df)
    if result:
        return result

    # Son çare: sayısal kolon + tarih benzeri kolon kombinasyonu dene
    cols = list(df.columns)
    date_col = None
    for col in cols:
        sample = df[col].dropna().head(5).astype(str)
        if sample.apply(lambda x: bool(_parse_turkish_date(x))).mean() > 0.6:
            date_col = col
            break

    if not date_col:
        return []

    # Sayısal kolonları bul
    numeric_cols = [c for c in cols if c != date_col and pd.to_numeric(df[c], errors="coerce").notna().mean() > 0.5]
    desc_col = next((c for c in cols if c != date_col and c not in numeric_cols), None)

    if not numeric_cols:
        return []

    amount_col = numeric_cols[0]
    rows = []
    for _, row in df.iterrows():
        date = _parse_turkish_date(str(row.get(date_col, "")))
        if not date:
            continue
        amount = _parse_amount(row.get(amount_col))
        if not amount:
            continue
        desc = str(row.get(desc_col, "")) if desc_col else ""
        rows.append(_normalize_row(date, desc, amount, None, dict(row)))

    return rows


# ─────────────────────────────────────────────────────────────────────────────
# PDF parser (temel — metin tabanlı PDF için)
# ─────────────────────────────────────────────────────────────────────────────

def _extract_pdf_text(content: bytes) -> str:
    """PDF'in tüm metnini çıkar (pdfplumber). Başarısızsa boş döner."""
    try:
        import pdfplumber
        parts = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        return "\n".join(parts)
    except Exception:
        return ""


def _parse_pdf(content: bytes) -> list[dict]:
    """
    PDF'den tablo çıkar.
    Metin tabanlı PDF → pdfplumber ile.
    Taranmış PDF → Tesseract OCR ile (daha yavaş).
    """
    try:
        import pdfplumber
        rows = []
        with pdfplumber.open(io.BytesIO(content)) as pdf:
            for page in pdf.pages:
                tables = page.extract_tables()
                for table in tables:
                    if not table:
                        continue
                    # İlk satır genellikle başlık
                    headers = [str(h).lower().strip() if h else "" for h in table[0]]
                    df = pd.DataFrame(table[1:], columns=table[0])
                    df.columns = [str(c).strip() for c in df.columns]
                    parsed = _parse_generic(df)
                    rows.extend(parsed)
        return rows
    except ImportError:
        # pdfplumber yok, Tesseract ile dene
        return _parse_pdf_ocr(content)
    except Exception:
        return _parse_pdf_ocr(content)


def _parse_pdf_ocr(content: bytes) -> list[dict]:
    """Taranmış PDF için OCR fallback."""
    try:
        from PIL import Image
        import pytesseract
        import fitz  # PyMuPDF

        doc = fitz.open(stream=content, filetype="pdf")
        all_text = ""
        for page in doc:
            pix = page.get_pixmap(dpi=200)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            all_text += pytesseract.image_to_string(img, lang="tur+eng") + "\n"

        return _parse_text_lines(all_text)
    except Exception:
        return []


def _parse_text_lines(text: str) -> list[dict]:
    """OCR metninden satır satır işlem çıkarmaya çalışır."""
    rows = []
    pattern = re.compile(
        r"(\d{2}[.\-/]\d{2}[.\-/]\d{2,4})"   # tarih
        r".{0,5}"
        r"(.{5,60}?)"                           # açıklama
        r"\s+"
        r"([\d.,]+)"                            # tutar
    )
    for match in pattern.finditer(text):
        date = _parse_turkish_date(match.group(1))
        if not date:
            continue
        desc = match.group(2).strip()
        amount = _parse_amount(match.group(3))
        if amount:
            rows.append(_normalize_row(date, desc, amount, None, {"raw_match": match.group(0)}))
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# Garanti BBVA kredi kartı ekstresi (PDF — Bonus Card / Platinum)
# ─────────────────────────────────────────────────────────────────────────────
# Bu ekstreler metin tabanlıdır ama tablo olarak değil serbest metin olarak gelir.
# Her işlem satırı: "<gg Ay yyyy> <açıklama> [Bonus(TL)] <Tutar(TL)[+/-]>"
#   sonek +  → ödeme/iade (alacak → gelir)
#   sonek -  → iade (alacak → gelir)
#   soneksiz → harcama (gider)
# Tutar her zaman satırdaki SON "1.234,56" biçimli sayıdır (öncesindeki küçük sayı
# Bonus kolonudur). "BONUS …" ile başlayan satırlar bonus özetidir, atlanır.

# Türk lirası tutar kalıbı: 1.234.567,89 (zorunlu ,dd ondalık → hesap/kart no'larını eler)
_TR_AMOUNT_RE = re.compile(r"(\d{1,3}(?:\.\d{3})*,\d{2})\s*([+-]?)")
# pdfplumber bazı ekstrelerde "boşluk" filigranını metne karıştırır (ör. "bboosslluukk").
_WATERMARK_RE = re.compile(r"[bB]+[oO]+[sşSŞ]+[lL]+[uU]+[kK]+")
_CC_LINE_RE = re.compile(r"^(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4})\s+(.+)$")

# Standalone category headings in billed Bonus statements. They apply to every
# following movement until another heading. The PDF has no Etiket column, so the
# parser carries the raw heading into each row and lets Statement Value Mapping
# resolve it exactly. Higher-level statement headings reset the active category.
_GARANTI_CC_SECTION_TAGS = {
    _etiket_key(label): label for label in (
        "Akaryakıt", "Cafe & Restaurant", "Süpermarket", "Fast Food",
        "Eğitim", "Eğlence", "Optik & Saat", "Pastane", "Saat/Mücevherat",
        "Ulaşım", "Kozmetik", "Seyahat", "Spor Giyim", "Bilgisayar",
        "Eczane", "Otomotiv", "RentACar", "Sağlık",
        "Ev Tekstil & Dekorasyon", "DİĞER HARCAMALARINIZ",
        "YURT DIŞI HARCAMALARINIZ",
    )
}
_GARANTI_CC_SECTION_RESETS = {
    _etiket_key(label) for label in (
        "BONUS HARCAMALARINIZ",
        "BONUS PROGRAM ORTAKLARI'NDA YAPTIĞINIZ HARCAMALAR",
        "BONUS PROGRAM ORTAKLARI DIŞI HARCAMALARINIZ",
        "BONUS PLATINUM SAHİBİ OLDUĞUNUZ İÇİN EKSTRA BONUS KAZANDIĞINIZ İŞLEMLER",
    )
}


def _garanti_cc_section_tag(line: str) -> Optional[str]:
    """Return a canonical raw Bonus section label, or None for ordinary text."""
    compact = " ".join((line or "").split()).strip()
    return _GARANTI_CC_SECTION_TAGS.get(_etiket_key(compact))


def _garanti_cc_resets_section(line: str) -> bool:
    """Recognize a Bonus group heading even when the PDF appends helper copy."""
    key = _etiket_key(" ".join((line or "").split()))
    return any(key.startswith(reset_key) for reset_key in _GARANTI_CC_SECTION_RESETS)


def _is_garanti_cc_pdf(text: str) -> bool:
    head = text[:3000].lower()
    return ("hesap kesim tarihi" in head or "dönem borcunuz" in head
            or ("bonus" in head and "son ödeme tarihi" in head))


def _parse_garanti_cc_pdf(text: str) -> tuple[list[dict], list[dict]]:
    """Garanti kredi kartı PDF ekstresini işlem satırlarına ve kart kimliğine çevirir."""
    rows: list[dict] = []

    # Kart kimliği (oluştur-akışı için): kart no + sahip adı.
    card = None
    mcard = re.search(r"Kart Numaras[ıi]\s+([\d][\d* ]+[\d])", text)
    if mcard:
        card = re.sub(r"\s+", " ", mcard.group(1)).strip()
    holder = None
    mh = re.search(r"Say[ıi]n\s+([^\n]+)", text)
    if mh:
        holder = re.split(r"\s{2,}", mh.group(1).strip())[0].strip()

    # Ekstre özeti: son ödeme tarihi (Son Ödeme Tarihi) + dönem borcu (Dönem Borcunuz).
    # Bunlar kart hesabına "actual pay date" olarak işlenir ve tek bir
    # "Credit Card Payment" harcama kaydı oluşturmak için kullanılır.
    payment_due = None
    mpd = re.search(
        r"Son[ \t]+Ödeme[ \t]+Tarihi[:\s]+(\d{1,2}\s+[A-Za-zÇĞİÖŞÜçğıöşü]+\s+\d{4})",
        text,
    )
    if mpd:
        payment_due = _parse_turkish_date(mpd.group(1))
    statement_total = None
    mtot = re.search(r"Dönem[ \t]+Borcunuz\s+(\d{1,3}(?:\.\d{3})*,\d{2})", text)
    if mtot:
        statement_total = _parse_amount(mtot.group(1))

    active_section_tag = None
    for raw in text.splitlines():
        line = _WATERMARK_RE.sub(" ", raw).strip()
        section_tag = _garanti_cc_section_tag(line)
        if section_tag:
            active_section_tag = section_tag
            continue
        if _garanti_cc_resets_section(line):
            active_section_tag = None
            continue
        m = _CC_LINE_RE.match(line)
        if not m:
            continue
        date = _parse_turkish_date(m.group(1))
        if not date:
            continue
        rest = m.group(2).strip()
        amts = list(_TR_AMOUNT_RE.finditer(rest))
        if not amts:
            continue
        last = amts[-1]
        value = _parse_amount(last.group(1))
        if not value:
            continue
        desc = rest[:amts[0].start()].strip()
        # "BONUS …" satırları bonus kampanya/özet detayıdır, gerçek harcama değil.
        if desc.upper().startswith("BONUS"):
            continue
        # sonekli (+/-) → alacak/iade (gelir, pozitif); soneksiz → harcama (gider, negatif)
        signed = value if last.group(2) in ("+", "-") else -value
        rows.append(_normalize_row(
            date, desc, signed, currency="TRY", etiket=active_section_tag,
            source=card, account_type="credit",
        ))

    accounts: list[dict] = []
    if card:
        accounts.append({
            "source": card, "type": "credit", "number": card, "card_number": card,
            "iban": None, "branch": None, "holder": holder,
            "currency": "TRY", "institution": "garanti",
            "payment_due": payment_due, "total": statement_total,
        })
    return rows, accounts


# ─────────────────────────────────────────────────────────────────────────────
# Garanti BBVA "Dönemiçi İşlemler" (dönem içi işlem listesi — PDF)
# ─────────────────────────────────────────────────────────────────────────────
# Bu, tam ekstre değil, kartın dönem-içi (henüz kesilmemiş) işlem dökümüdür.
# Tam ekstrenin (_parse_garanti_cc_pdf) aksine gerçek bir TABLO olarak gelir:
#   Tarih | İşlem | Etiket | Bonus | Tutar (TL)
# ve tarihler "23/07/2026" (gg/aa/yyyy) biçimindedir, Türkçe ay adı değil.
# İşlem tutarı YALNIZCA "Tutar (TL)" kolonudur; "Bonus" kolonu puan hareketidir
# (bazen pdfplumber bonus'u tutar hizasına kaydırır — Tutar boşsa satır bonus-only
# demektir ve TL harcaması yoktur, atlanır). Böylece toplam, ekstredeki
# "Toplam TL Harcama Tutarı" ile birebir tutar.
_DONEMICI_CARD_RE   = re.compile(r"(\d{4}\s+\*{2,4}\s+\*{2,4}\s+\d{4})")
_DONEMICI_HOLDER_RE = re.compile(r"Say[ıi]n\s+([^\n,]+)")
# Başlık özet satırı: "… 71.571,59 TL 26.06.2026 06.07.2026"
#                       (dönem borcu)   (hesap kesim) (son ödeme)
_DONEMICI_SUMMARY_RE = re.compile(
    r"(\d{1,3}(?:\.\d{3})*,\d{2})\s*TL\s+(\d{2}\.\d{2}\.\d{4})\s+(\d{2}\.\d{2}\.\d{4})"
)
_DONEMICI_CUR_RE = re.compile(r"D[öo]nemi[çc]i\s+[İIi]şlemler\s*-\s*([A-Za-z]{2,3})")


def _is_garanti_donemici_pdf(text: str) -> bool:
    """Garanti 'Dönemiçi İşlemler' dökümü mü? (diakritikten bağımsız)."""
    return "DONEMICI ISLEMLER" in _fold(text)


def _parse_garanti_donemici_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    """Garanti 'Dönemiçi İşlemler' PDF'ini işlem satırları + kart kimliğine çevirir.

    Serbest metin değil gerçek tablo olduğundan pdfplumber.extract_tables ile okunur.
    İşlem tutarı yalnızca 'Tutar (TL)' kolonundan alınır (bkz. yukarıdaki not).
    """
    rows: list[dict] = []

    card = None
    m = _DONEMICI_CARD_RE.search(text)
    if m:
        card = re.sub(r"\s+", " ", m.group(1)).strip()
    holder = None
    mh = _DONEMICI_HOLDER_RE.search(text)
    if mh:
        holder = " ".join(mh.group(1).split())

    payment_due = None
    statement_total = None
    ms = _DONEMICI_SUMMARY_RE.search(text)
    if ms:
        statement_total = _parse_amount(ms.group(1))
        payment_due = _parse_turkish_date(ms.group(3))   # son ödeme tarihi

    mcur = _DONEMICI_CUR_RE.search(text)
    currency = _detect_currency(mcur.group(1)) if mcur else "TRY"

    try:
        import pdfplumber
    except ImportError:
        return rows, []

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table:
                    continue
                # Başlık satırını (Tarih … Tutar) ve Tutar kolon indeksini bul.
                header_idx = None
                amount_i = None
                for i, r in enumerate(table):
                    folded = [_fold(str(c or "")) for c in r]
                    joined = " ".join(folded)
                    if "TARIH" in joined and "TUTAR" in joined:
                        header_idx = i
                        for k, c in enumerate(folded):
                            if "TUTAR" in c:
                                amount_i = k
                        break
                if header_idx is None or amount_i is None:
                    continue
                for r in table[header_idx + 1:]:
                    cells = [str(c or "").strip() for c in r]
                    if not cells:
                        continue
                    date = _parse_turkish_date(cells[0])
                    if not date:
                        continue
                    amount = _parse_amount(cells[amount_i]) if amount_i < len(cells) else None
                    if not amount:            # Tutar boş → bonus-only satır, TL harcaması yok
                        continue
                    desc = " ".join(cells[1].split()) if len(cells) > 1 else ""
                    # Etiket hücresi satır sarması ile bölünebilir ("Emeklilik/\nSigorta")
                    # → boşlukları sadeleştir ve "/" çevresini kapat ("Emeklilik/Sigorta").
                    etiket = " ".join(cells[2].split()) if len(cells) > 2 else ""
                    etiket = re.sub(r"\s*/\s*", " / ", etiket)
                    rows.append(_normalize_row(
                        date, desc, amount, currency=currency, etiket=etiket, source=card,
                        account_type="credit",
                    ))

    accounts: list[dict] = []
    if card:
        accounts.append({
            "source": card, "type": "credit", "number": card, "card_number": card,
            "iban": None, "branch": None, "holder": holder,
            "currency": currency, "institution": "garanti",
            "payment_due": payment_due, "total": statement_total,
            # Dönem-içi döküm gerçek (kesilmiş) ekstre değildir; "total" cari dönem
            # yürüyen toplamıdır, kesin borç değil. Bu yüzden frontend bundan
            # Credit Payment kaydı ÜRETMEZ (bkz. import.jsx CP-oluşturma döngüsü).
            "interim": True,
        })
    return rows, accounts


# ─── Garanti BBVA "Hesap Hareketleri" (vadesiz hesap dökümü — PDF) ────────────
# Kredi kartı değil, vadesiz mevduat hesabının hareket dökümüdür. Gerçek bir
# TABLO olarak gelir:  Tarih | Açıklama | Etiket | Tutar | Bakiye
# Tutar "+2.102,90 TL" / "-188.146,94 TL" biçimindedir (işaret önekte, "TL" soneki).
# Genel tablo yolu bu soneki temizleyemediği için tüm satırlar 0 tutarla elenir;
# bu yüzden ayrı bir parser gerekir. Hesap kimliği (IBAN / hesap no / şube) de
# çıkarılır ki import sihirbazı satırları doğru hesaba eşleştirebilsin.
_HESAP_HOLDER_RE = re.compile(r"Say[ıi]n\s+([^,\n]+)")
_HESAP_NO_RE     = re.compile(r"Hesap Numaras[ıi]\s*:\s*(\d[\d\s-]*\d)")
_HESAP_IBAN_RE   = re.compile(r"IBAN\s*:\s*(TR\d[\dA-Z ]+\d)")
_HESAP_SUBE_RE   = re.compile(r"Şube\s*:\s*([^\n]+)")
_HESAP_BALANCE_RE = re.compile(
    r"(?<!Kullanılabilir )Bakiye\s*:\s*(-?[\d.]+,\d{2})\s*(TL|TRY|USD|EUR)",
    re.IGNORECASE,
)
_HESAP_AVAILABLE_BALANCE_RE = re.compile(
    r"Kullanılabilir Bakiye\s*:\s*(-?[\d.]+,\d{2})\s*(TL|TRY|USD|EUR)",
    re.IGNORECASE,
)


def _is_garanti_hesap_pdf(text: str) -> bool:
    """Garanti vadesiz hesap hareketleri dökümü mü? (diakritikten bağımsız).

    'Hesap Hareketleri' başka bankalarda da (ör. ON Burgan) geçtiği için
    Garanti imzası (garantibbva / 'Hesap Numarası') ile birlikte aranır.
    """
    f = _fold(text)
    return "HESAP HAREKETLERI" in f and ("GARANTIBBVA" in f or "HESAP NUMARASI" in f)


def _parse_garanti_hesap_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    """Garanti 'Hesap Hareketleri' PDF'ini işlem satırları + hesap kimliğine çevirir."""
    rows: list[dict] = []

    holder = None
    mh = _HESAP_HOLDER_RE.search(text)
    if mh:
        holder = " ".join(mh.group(1).split())
    account_no = None
    mno = _HESAP_NO_RE.search(text)
    if mno:
        account_no = _account_no_from_hesap(mno.group(1))
    iban = None
    mib = _HESAP_IBAN_RE.search(text)
    if mib:
        iban = _clean_iban(mib.group(1))
    branch = None
    msu = _HESAP_SUBE_RE.search(text)
    if msu:
        branch = " ".join(msu.group(1).split())

    balance_match = _HESAP_BALANCE_RE.search(text)
    available_match = _HESAP_AVAILABLE_BALANCE_RE.search(text)
    statement_balance = _parse_amount(balance_match.group(1)) if balance_match else None
    available_balance = _parse_amount(available_match.group(1)) if available_match else None
    file_currency = _detect_currency(
        (balance_match.group(2) if balance_match else None)
        or (available_match.group(2) if available_match else None)
        or "TRY"
    )

    try:
        import pdfplumber
    except ImportError:
        return rows, []

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table:
                    continue
                # Başlık satırını ve kolon indekslerini bul.
                header_idx = date_i = amount_i = balance_i = None
                desc_i = etiket_i = None
                for i, r in enumerate(table):
                    di = _match_idx(r, GARANTI_DATE_COLS)
                    ai = _match_idx(r, GARANTI_AMOUNT_COLS)
                    if di is not None and ai is not None:
                        header_idx = i
                        date_i, amount_i = di, ai
                        desc_i = _match_idx(r, GARANTI_DESC_COLS)
                        etiket_i = _match_idx(r, GARANTI_ETIKET_COLS)
                        balance_i = _match_idx(r, GARANTI_BALANCE_COLS)
                        break
                if header_idx is None:
                    continue
                for r in table[header_idx + 1:]:
                    cells = [str(c or "").strip() for c in r]
                    if not cells or date_i >= len(cells) or amount_i >= len(cells):
                        continue
                    date = _parse_turkish_date(cells[date_i])
                    if not date:
                        continue
                    tutar_cell = cells[amount_i]
                    currency = _detect_currency(tutar_cell)
                    # İşaret önekli, para birimi sonekli tutar: "+2.102,90 TL".
                    amount = _parse_amount(re.sub(r"[^\d.,+-]", "", tutar_cell))
                    if not amount:
                        continue
                    file_currency = currency
                    desc = " ".join(cells[desc_i].split()) if (desc_i is not None and desc_i < len(cells)) else ""
                    etiket = " ".join(cells[etiket_i].split()) if (etiket_i is not None and etiket_i < len(cells)) else ""
                    balance = (
                        _parse_amount(re.sub(r"[^\d.,+-]", "", cells[balance_i]))
                        if balance_i is not None and balance_i < len(cells)
                        else None
                    )
                    rows.append(_normalize_row(
                        date, desc, amount, balance, currency=currency, etiket=etiket,
                        source=iban or account_no, account_type="bank",
                    ))

    accounts: list[dict] = []
    if account_no or iban:
        account = {
            "source": iban or account_no, "type": "bank", "number": account_no,
            "card_number": None, "iban": iban, "branch": branch, "holder": holder,
            "currency": file_currency, "institution": "garanti",
            "balance": statement_balance,
            "available_balance": available_balance,
        }
        if statement_balance is not None and available_balance is not None:
            credit_limit = round(float(available_balance) - float(statement_balance), 2)
            if credit_limit > 0:
                account["bank_subtype"] = "overdraft"
                account["credit_limit"] = credit_limit
        accounts.append(account)
    return rows, accounts


# ─── ON (Burgan Bank) "Hesap Hareketleri" (vadesiz hesap dökümü — PDF) ────────
# Tablo:  Tarih | Açıklama | Tutar | Bakiye  (başlık yalnızca 1. sayfada; sonraki
# sayfalar başlıksız devam eder ve pdfplumber kimi satırlara None dolgu ekler).
# Tutarlar Türkçe ÜÇ ondalıklı biçimdedir: "-160.643,550", "185.000,000" ve
# önemlisi "1,000" = 1.0 (bin değil!). Paylaşılan _parse_amount ",ddd"yi binlik
# sanıp yanlış okuduğu için ON'a özel üç-ondalıklı bir çözümleyici gerekir.
_ON_IBAN_RE   = re.compile(r"(TR\d{24})")
_ON_HOLDER_RE = re.compile(r"Ad Soyad\s*:\s*(.+?)\s+TCKN")
_ON_CUR_RE    = re.compile(r"[\d.]+,\d{3}\s*(TRY|USD|EUR)")
_ON_HEADER_BALANCE_RE = re.compile(r"IBAN\s+Bakiye\s+TR\d{24}\s+(-?[\d.]+,\d{3})\s*(TRY|USD|EUR)", re.IGNORECASE)
_ON_DATE_RE   = re.compile(r"^\d{2}\.\d{2}\.\d{4}$")
# ON tutar hücresi: isteğe bağlı '-', binlik '.', zorunlu ',ddd' ondalık.
_ON_AMOUNT_RE = re.compile(r"^-?\d{1,3}(?:\.\d{3})*,\d{3}$")


def _is_on_burgan_pdf(text: str) -> bool:
    """ON / Burgan Bank hesap hareketleri dökümü mü? (diakritikten bağımsız)."""
    f = _fold(text)
    return "BURGAN" in f or "ON HESAP VIRMAN" in f


def _parse_on_amount(cell: str) -> Optional[float]:
    """ON üç-ondalıklı Türkçe tutarını float'a çevirir ("1.234,560" → 1234.56)."""
    s = (cell or "").strip()
    if not _ON_AMOUNT_RE.match(s):
        return None
    try:
        return float(s.replace(".", "").replace(",", "."))
    except ValueError:
        return None


def _parse_on_burgan_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    """ON (Burgan) 'Hesap Hareketleri' PDF'ini işlem satırları + hesap kimliğine çevirir."""
    rows: list[dict] = []

    iban = None
    mib = _ON_IBAN_RE.search(text)
    if mib:
        iban = _clean_iban(mib.group(1))
    holder = None
    mh = _ON_HOLDER_RE.search(text)
    if mh:
        holder = " ".join(mh.group(1).split())
    mcur = _ON_CUR_RE.search(text)
    currency = mcur.group(1).replace("TRY", "TRY") if mcur else "TRY"
    statement_balance = None
    mhb = _ON_HEADER_BALANCE_RE.search(" ".join((text or "").split()))
    if mhb:
        statement_balance = _parse_on_amount(mhb.group(1))
        currency = mhb.group(2).replace("TRY", "TRY")

    try:
        import pdfplumber
    except ImportError:
        return rows, []

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                for raw in table or []:
                    # None dolguyu ve boş hücreleri at → [tarih, açıklama, tutar, bakiye].
                    cells = [str(c).strip() for c in raw if c is not None and str(c).strip()]
                    if len(cells) < 4 or not _ON_DATE_RE.match(cells[0]):
                        continue                      # başlık/altbilgi/devam parçası
                    date = _parse_turkish_date(cells[0])
                    # Tutar = sondan bir önceki, Bakiye = son (üç-ondalıklı sayı hücreleri).
                    amount = _parse_on_amount(cells[-2])
                    balance = _parse_on_amount(cells[-1])
                    if amount is None:
                        continue
                    desc = " ".join(" ".join(cells[1:-2]).split())
                    rows.append(_normalize_row(
                        date, desc, amount, balance=balance, currency=currency,
                        source=iban, account_type="bank",
                    ))

    accounts: list[dict] = []
    if iban:
        accounts.append({
            "source": iban, "type": "bank", "number": None, "card_number": None,
            "iban": iban, "branch": None, "holder": holder,
            "currency": currency, "balance": statement_balance, "institution": "burgan",
        })
    return rows, accounts


# ─── QNB Finansbank "Hesap Hareketleri" (vadesiz hesap dökümü — PDF) ────────
# Tablo: İşlem Tarihi | Kanal* | İşlem Açıklaması | Tutar | Bakiye
# Tutarlar İngilizce ayraçlıdır: "1,414,000.00", "-1,264,001.00". Paylaşılan
# _parse_amount bunu doğru okur; ayrı parserın asıl görevi QNB künyesini
# (IBAN/sahip/şube/hesap adı) çıkarıp satırları banka hesabı olarak işaretlemektir.
_QNB_IBAN_RE   = re.compile(r"Iban\s*:\s*(TR[\dA-Z ]{24,35})", re.IGNORECASE)
_QNB_HOLDER_RE = re.compile(r"Ad\s+Soyad\s*:\s*([^\n]+?)(?:\s+Hesap\s+Ad[ıi]\s*:|\n)", re.IGNORECASE)
_QNB_BRANCH_RE = re.compile(r"Şube\s*:\s*([^\n]+)", re.IGNORECASE)
_QNB_ACCOUNT_NAME_RE = re.compile(r"Hesap\s+Ad[ıi]\s*:\s*([^\n]+?)(?:\s+Tckn/Ykn\s*:|\n)", re.IGNORECASE)


def _is_qnb_pdf(text: str) -> bool:
    """QNB Finansbank hesap hareketleri dökümü mü? (diakritikten bağımsız)."""
    f = _fold(text)
    return "HESAP HAREKETLERI" in f and "QNB" in f and "IBAN" in f


def _qnb_field(text: str, rx: re.Pattern) -> Optional[str]:
    m = rx.search(text)
    return " ".join(m.group(1).split()) if m else None


def _parse_qnb_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    """QNB 'Hesap Hareketleri' PDF'ini işlem satırları + hesap kimliğine çevirir."""
    rows: list[dict] = []

    iban = _clean_iban(_qnb_field(text, _QNB_IBAN_RE))
    holder = _qnb_field(text, _QNB_HOLDER_RE)
    branch = _qnb_field(text, _QNB_BRANCH_RE)
    account_name = _qnb_field(text, _QNB_ACCOUNT_NAME_RE)
    currency = _detect_currency(account_name or text)
    last_balance = None

    try:
        import pdfplumber
    except ImportError:
        return rows, []

    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table:
                    continue
                header_idx = date_i = desc_i = amount_i = balance_i = None
                for i, r in enumerate(table):
                    folded = [_fold(str(c or "")) for c in r]
                    joined = " ".join(folded)
                    if "ISLEM TARIHI" in joined and "TUTAR" in joined and "BAKIYE" in joined:
                        header_idx = i
                        for k, c in enumerate(folded):
                            if "ISLEM TARIHI" in c:
                                date_i = k
                            elif "ISLEM ACIKLAMASI" in c:
                                desc_i = k
                            elif c == "TUTAR":
                                amount_i = k
                            elif c == "BAKIYE":
                                balance_i = k
                        break
                if header_idx is None or None in (date_i, desc_i, amount_i):
                    continue
                for r in table[header_idx + 1:]:
                    cells = [str(c or "").strip() for c in r]
                    if date_i >= len(cells) or amount_i >= len(cells):
                        continue
                    date = _parse_turkish_date(cells[date_i])
                    if not date:
                        continue
                    amount = _parse_amount(cells[amount_i])
                    if amount is None:
                        continue
                    balance = _parse_amount(cells[balance_i]) if (balance_i is not None and balance_i < len(cells)) else None
                    if balance is not None:
                        last_balance = balance
                    desc = " ".join(cells[desc_i].split()) if desc_i < len(cells) else ""
                    row = _normalize_row(
                        date, desc, amount, balance=balance, currency=currency,
                        source=iban, account_type="bank",
                        raw={"row": cells},
                    )
                    if row["category_key"] is None and "ISLEMLERI" in _fold(desc):
                        row["category_key"] = "wire-transfer"
                    rows.append(row)

    accounts: list[dict] = []
    if iban:
        accounts.append({
            "source": iban, "type": "bank", "number": None, "card_number": None,
            "iban": iban, "branch": branch, "holder": holder,
            "currency": currency, "balance": last_balance, "institution": "qnb",
        })
    return rows, accounts


# ─── Odea Bank "Hesap Hareketleri" (vadeli/vadesiz hesap dökümü — PDF/XLSX) ─
# Odea'nın PDF ve XLSX çıktısı aynı grid'i kullanır:
#   Ad Soyad/Ünvan | SADUN SEVİNGEN
#   IBAN           | TR430014600000594423600003
#   Tarih Aralığı  | 29.06.2026 Pzt - 29.07.2026 Çrş
#   Tarih | İşlem | Tutar(USD) | Bakiye(USD)
# Tarih hücresi saat de taşır ("29.07.2026 14:30"); işlem açıklaması PDF'de
# satır kırılabilir. Tutar işaret önekli Türkçe 2-ondalıklıdır: "+30.000,00".
_ODEA_HOLDER_RE = re.compile(r"Ad\s+Soyad/[ÜU]nvan\s*:\s*([^\n]+)", re.IGNORECASE)
_ODEA_IBAN_RE   = re.compile(r"IBAN\s*:\s*(TR[\dA-Z ]{24,35})", re.IGNORECASE)


def _odea_cell_text(value) -> str:
    text = " ".join(str(value or "").split())
    return re.sub(r"(?<=\d)-\s+(?=\d)", "-", text)


def _parse_odea_date(value: str) -> Optional[str]:
    m = re.search(r"\d{2}\.\d{2}\.\d{4}", str(value or ""))
    return _parse_turkish_date(m.group(0)) if m else None


def _odea_currency_from_headers(cells: list) -> str:
    joined = " ".join(_odea_cell_text(c) for c in cells)
    m = re.search(r"\((TRY|TL|USD|EUR)\)", joined, re.IGNORECASE)
    return _detect_currency(m.group(1)) if m else "TRY"


def _is_odea_grid(grid: list[list]) -> bool:
    head = _fold(" ".join(str(c or "") for row in (grid or [])[:20] for c in row))
    return (
        "HESAP HAREKETLERI" in head
        and "AD SOYAD/UNVAN" in head
        and "TARIH ARALIGI" in head
        and "IBAN" in head
        and re.search(r"TUTAR\s*\(", head) is not None
        and re.search(r"BAKIYE\s*\(", head) is not None
    )


def _is_odea_pdf(text: str) -> bool:
    """Odea hesap hareketleri dökümü mü? İçerik bankayı yazmadığı için grid imzası kullanılır."""
    return _is_odea_grid([[line] for line in (text or "").splitlines()[:40]])


def _parse_odea_grid(grid: list[list]) -> tuple[list[dict], list[dict]]:
    """Odea PDF/XLSX tablo grid'ini işlem satırları + hesap kimliğine çevirir."""
    rows: list[dict] = []
    holder = None
    iban = None
    currency = "TRY"
    idx: dict = {}
    last_balance = None

    for raw in grid or []:
        cells = ["" if c is None else str(c) for c in raw]
        if not any(str(c).strip() for c in cells):
            continue
        col0 = _fold(cells[0])

        if col0 == "AD SOYAD/UNVAN":
            val = next((_odea_cell_text(c) for c in cells[1:] if _odea_cell_text(c)), "")
            holder = val or holder
            continue
        if col0 == "IBAN":
            val = next((_odea_cell_text(c) for c in cells[1:] if _odea_cell_text(c)), "")
            iban = _clean_iban(val) or iban
            continue

        joined = " ".join(_fold(c) for c in cells)
        if (
            "TARIH" in joined
            and re.search(r"TUTAR\s*\(", joined) is not None
            and re.search(r"BAKIYE\s*\(", joined) is not None
        ):
            idx = {
                "date": _match_idx(cells, ["tarih"]),
                "desc": _match_idx(cells, ["işlem", "islem"]),
                "amount": _match_idx(cells, ["tutar"]),
                "balance": _match_idx(cells, ["bakiye"]),
            }
            currency = _odea_currency_from_headers(cells)
            continue

        if not idx or None in (idx.get("date"), idx.get("desc"), idx.get("amount")):
            continue

        def _cell(i):
            return cells[i].strip() if (i is not None and i < len(cells)) else ""

        date = _parse_odea_date(_cell(idx["date"]))
        if not date:
            continue
        amount = _parse_amount(re.sub(r"[^\d.,+-]", "", _cell(idx["amount"])))
        if amount is None:
            continue
        balance = _parse_amount(re.sub(r"[^\d.,+-]", "", _cell(idx["balance"]))) if idx.get("balance") is not None else None
        if balance is not None:
            last_balance = balance
        desc = _odea_cell_text(_cell(idx["desc"]))
        rows.append(_normalize_row(
            date, desc, amount, balance=balance, currency=currency,
            source=iban, account_type="bank", raw={"row": cells},
        ))

    accounts: list[dict] = []
    if iban:
        accounts.append({
            "source": iban, "type": "bank", "number": None, "card_number": None,
            "iban": iban, "branch": None, "holder": holder,
            "currency": currency, "balance": last_balance, "institution": "odea",
        })
    return rows, accounts


def _parse_odea_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    rows: list[dict] = []
    holder = _odea_cell_text(_qnb_field(text, _ODEA_HOLDER_RE) or "")
    iban = _clean_iban(_qnb_field(text, _ODEA_IBAN_RE))
    try:
        import pdfplumber
    except ImportError:
        return rows, []

    grids: list[list] = []
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                grids.extend(table or [])
    rows, accounts = _parse_odea_grid(grids)
    if iban:
        for row in rows:
            if not row.get("source"):
                row["source"] = iban
        if not accounts and rows:
            currency = rows[0].get("currency") or "TRY"
            balance = next((r.get("balance") for r in reversed(rows) if r.get("balance") is not None), None)
            accounts.append({
                "source": iban, "type": "bank", "number": None, "card_number": None,
                "iban": iban, "branch": None, "holder": holder or None,
                "currency": currency, "balance": balance, "institution": "odea",
            })
    for acc in accounts:
        if not acc.get("holder") and holder:
            acc["holder"] = holder
        if not acc.get("iban") and iban:
            acc["iban"] = iban
            acc["source"] = iban
    return rows, accounts


# ─── TEB "Dijital Hesap Cüzdanı" (vadesiz hesap cüzdanı — PDF) ───────────────
# 1. sayfa "Etiket: Değer" künye bloğu (IBAN, hesap/müşteri no, şube, para kodu,
# bakiye) + gerçek bir tablo başlığı:
#     Sıra No | Tarih | Açıklama | İşlem Tutarı | Bakiye
# 2. sayfa tamamen mevzuat metnidir (işlem içermez).
#
# DİKKAT — şu an YALNIZCA HESAP KİMLİĞİ çözümlenir, işlem satırları değil.
# Eldeki üç örnek cüzdanın üçü de yeni açılmış/hareketsiz hesaplara ait: tablo
# başlığı var, gövde satırı yok, "Bakiye: 0,00". Dolayısıyla satır biçiminin
# doğrulanamayan yanları var — "İşlem Tutarı" işareti nasıl taşıyor (önek '-/+'
# mı, yoksa yön yalnızca Bakiye farkından mı okunuyor), ondalık basamak sayısı,
# uzun açıklamaların satıra bölünüp bölünmediği. Bunları tahmin edip yanlış
# yönde işlem üretmektense satır üretmiyoruz; hareketli bir cüzdan örneği
# geldiğinde _parse_teb_pdf'e gövde çözümlemesi eklenecek (bkz. CLAUDE.md).
_TEB_IBAN_RE    = re.compile(r"IBAN\s*:\s*(TR\d{24})")
_TEB_NO_RE      = re.compile(r"Hesap Numaras[ıi]\s*:\s*(\d+)")
_TEB_HOLDER_RE  = re.compile(r"M[üu]şteri Ad[ıi]\s*-\s*Soyad[ıi]\s*:\s*([^\n]+)")
_TEB_SUBE_RE    = re.compile(r"Şube\s*:\s*([^\n]+)")
_TEB_CUR_RE     = re.compile(r"Para Kodu\s*:\s*([A-Za-z]{2,3})")
_TEB_BALANCE_RE = re.compile(r"Bakiye\s*:\s*(-?[\d.]*\d,\d{2})")
# Gövde satırı: "1  21/07/2026  AÇIKLAMA  -1.234,56  2.345,67" (Sıra No + tarih).
_TEB_ROW_RE     = re.compile(r"^\s*\d+\s+\d{2}/\d{2}/\d{4}\s")


def _is_teb_pdf(text: str) -> bool:
    """TEB 'Dijital Hesap Cüzdanı' dökümü mü? (diakritikten bağımsız).

    'Dijital Hesap Cüzdanı' tek başına başka bankalarda da geçebileceği için
    TEB ünvanı ile birlikte aranır.
    """
    f = _fold(text)
    return "DIJITAL HESAP CUZDANI" in f and "TURK EKONOMI BANKASI" in f


def _teb_field(text: str, rx: re.Pattern) -> Optional[str]:
    """Künye bloğundan tek satırlık bir alanı boşlukları sadeleştirerek okur."""
    m = rx.search(text)
    return " ".join(m.group(1).split()) if m else None


def _teb_has_movements(text: str) -> bool:
    """Cüzdanda gerçekten hareket var mı? (tablo gövdesinde Sıra No + tarih satırı)."""
    return any(_TEB_ROW_RE.match(ln) for ln in text.splitlines())


def _parse_teb_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    """TEB 'Dijital Hesap Cüzdanı' PDF'ini hesap kimliğine çevirir.

    İşlem satırı üretmez — gerekçe için yukarıdaki bölüm başlığına bakın.
    """
    rows: list[dict] = []

    iban       = _clean_iban(_teb_field(text, _TEB_IBAN_RE))
    account_no = _teb_field(text, _TEB_NO_RE)
    holder     = _teb_field(text, _TEB_HOLDER_RE)
    branch     = _teb_field(text, _TEB_SUBE_RE)
    # "Para Kodu: TL" → TRY; USD/EUR cüzdanlar için _detect_currency devreye girer.
    currency   = _detect_currency(_teb_field(text, _TEB_CUR_RE) or "TL")
    balance    = _parse_amount(_teb_field(text, _TEB_BALANCE_RE) or "")

    accounts: list[dict] = []
    if iban or account_no:
        accounts.append({
            "source": iban or account_no, "type": "bank", "number": account_no,
            "card_number": None, "iban": iban, "branch": branch, "holder": holder,
            "currency": currency, "balance": balance, "institution": "teb",
        })
    return rows, accounts


# ─── TEB İnternet Şubesi "Hesap Hareketlerim" (HTML tabanlı XLS) ──────
# TEB bu dışa aktarımı eski Excel ikili biçimiyle değil, UTF-8 HTML'i
# `.xls` uzantısıyla indirir. Bu nedenle xlrd dosyayı açamaz. Standart
# kütüphanedeki HTMLParser ile tablo hücrelerini okuyarak ek bağımlılık istemeyiz.


class _TebHtmlTableParser(HTMLParser):
    """Collect every HTML table row as a whitespace-normalized cell list."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row_stack: list[dict] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        tag = tag.lower()
        if tag == "tr":
            self._row_stack.append({"cells": [], "cell": None})
        elif tag in {"td", "th"} and self._row_stack:
            self._row_stack[-1]["cell"] = []

    def handle_data(self, data: str) -> None:
        # Nested layout tables are present. Keep feeding an outer cell while an
        # inner row is active; only the inner row is useful, but this preserves
        # correct parser state until the outer </td> arrives.
        for row in self._row_stack:
            if row["cell"] is not None:
                row["cell"].append(data)

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in {"td", "th"} and self._row_stack:
            row = self._row_stack[-1]
            if row["cell"] is not None:
                row["cells"].append(" ".join("".join(row["cell"]).split()))
                row["cell"] = None
        elif tag == "tr" and self._row_stack:
            row = self._row_stack.pop()
            if row["cells"]:
                self.rows.append(row["cells"])


def _decode_teb_html(content: bytes) -> str:
    """Decode TEB's disguised HTML spreadsheet without corrupting Turkish text."""
    for encoding in ("utf-8-sig", "cp1254", "iso-8859-9"):
        try:
            return content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return content.decode("latin-1", errors="replace")


def _is_teb_html_export(content: bytes) -> bool:
    text = _decode_teb_html(content)
    folded = _fold(text)
    return (
        ("<HTML" in text.upper() or "<HEAD" in text.upper())
        and "HESAP HAREKETLERIM" in folded
        and "TURK EKONOMI BANKASI" in folded
    )


def _parse_teb_html_export(content: bytes) -> tuple[list[dict], list[dict]]:
    parser = _TebHtmlTableParser()
    parser.feed(_decode_teb_html(content))

    metadata: dict[str, str] = {}
    header_index: Optional[int] = None
    for index, cells in enumerate(parser.rows):
        folded = [_fold(cell) for cell in cells]
        if len(cells) == 2 and folded[0] in {
            "SUBE", "HESAP", "IBAN", "HESAP TURU", "HESAP SAHIBI", "BAKIYE",
        }:
            metadata[folded[0]] = cells[1]
        if {"TARIH", "ACIKLAMA", "TUTAR", "BAKIYE"}.issubset(set(folded)):
            header_index = index

    iban = _clean_iban(metadata.get("IBAN"))
    account_no = re.sub(r"\D", "", metadata.get("HESAP", "")) or None
    account_type = metadata.get("HESAP TURU", "")
    currency = _detect_currency(account_type)
    balance = _parse_amount(metadata.get("BAKIYE"))
    source = iban or account_no

    accounts: list[dict] = []
    if source:
        accounts.append({
            "source": source, "type": "bank", "number": account_no,
            "card_number": None, "iban": iban, "branch": metadata.get("SUBE"),
            "holder": metadata.get("HESAP SAHIBI"), "currency": currency,
            "balance": balance, "institution": "teb",
        })

    rows: list[dict] = []
    if header_index is None:
        return rows, accounts

    headers = [_fold(cell) for cell in parser.rows[header_index]]
    date_idx = headers.index("TARIH")
    desc_idx = headers.index("ACIKLAMA")
    amount_idx = headers.index("TUTAR")
    balance_idx = headers.index("BAKIYE")
    needed = max(date_idx, desc_idx, amount_idx, balance_idx)

    for cells in parser.rows[header_index + 1:]:
        if len(cells) <= needed:
            continue
        date = _parse_turkish_date(cells[date_idx])
        amount = _parse_amount(cells[amount_idx])
        if not date or amount in (None, 0):
            continue
        raw = dict(zip(parser.rows[header_index], cells))
        rows.append(_normalize_row(
            date, cells[desc_idx], amount,
            balance=_parse_amount(cells[balance_idx]), raw=raw,
            currency=currency, source=source, account_type="bank",
        ))
    return rows, accounts


# ─────────────────────────────────────────────────────────────────────────────
# Garanti BBVA "export" parser (hesap hareketleri + kredi kartı ekstresi)
# ─────────────────────────────────────────────────────────────────────────────
# Bu dosyalar tek bir sayfada birden fazla bölüm içerebilir (ör. ana kart +
# sanal kart) ve başlık satırı 14. satıra kadar gecikebilir. Bu yüzden pandas
# tek-başlık modeli yerine ham hücre ızgarası üzerinde durum makinesi ile yürünür.

GARANTI_ETIKET_COLS = ["etiket", "kategori", "label", "tag"]
_CARD_TITLE_RE = re.compile(r"(\d[\d* ]+\d)\s*numaral", re.IGNORECASE)


def _match_idx(cells: list, candidates: list[str]) -> Optional[int]:
    """Başlık satırındaki hücrelerde aday adı ara, kolon indeksini döndür."""
    # Türkçe "İ" küçültüldüğünde birleşik nokta üretir ("İşlem" → "i̇şlem"),
    # bu yüzden lower'dan önce normalize et.
    low = [str(c).replace("İ", "i").replace("I", "ı").lower().strip() for c in cells]
    for cand in candidates:                  # tam eşleşme önce
        for i, c in enumerate(low):
            if c == cand:
                return i
    for cand in candidates:                  # sonra kısmi eşleşme
        for i, c in enumerate(low):
            if cand in c:
                return i
    return None


def _load_raw_grid(content: bytes, ext: str) -> Optional[list[list]]:
    """Tüm hücreleri başlık varsayımı olmadan list-of-list olarak yükle."""
    if ext == "csv":
        for enc in ("utf-8", "cp1254", "iso-8859-9", "latin-1"):
            try:
                text = content.decode(enc)
                return [list(r) for r in csv.reader(io.StringIO(text))]
            except Exception:
                continue
        return None
    engine = "xlrd" if ext == "xls" else "openpyxl"
    try:
        df = pd.read_excel(io.BytesIO(content), engine=engine, header=None, dtype=str)
        return df.where(pd.notna(df), None).values.tolist()
    except Exception:
        return None


def _is_garanti_export(grid: list[list]) -> bool:
    """İlk ~20 satırda Garanti export imzası var mı?"""
    head = " ".join(
        str(c).lower() for row in grid[:20] for c in row if c is not None
    )
    return (
        "garantibbva" in head
        or ("numaral" in head and "kart" in head)
        or "tutar(tl)" in head
        or ("açıklama" in head and "dekont" in head)
    )


def _account_no_from_hesap(val: str) -> Optional[str]:
    """`Hesap` değerinden hesap numarasını çıkar (ör. "440 - 9059576 USD" → "9059576")."""
    nums = re.findall(r"\d+", val or "")
    return max(nums, key=len) if nums else None


def _money_from_cell(value) -> Optional[float]:
    """Parse a money cell that may carry a currency suffix ("33.896,30 TL")."""
    return _parse_amount(re.sub(r"[^\d.,+-]", "", str(value or "")))


_IBAN_TR_RE = re.compile(r"TR\d{24}")


def _clean_iban(value) -> Optional[str]:
    """IBAN'ın tek biçimi: boşluksuz, büyük harf, en fazla 26 karakter.

    Aynı hesap Garanti ekstresinde "TR65 0006 2000 …", ON dökümünde bitişik
    gelir; kimlik eşleştirmesi ve tekrar kontrolü ham dizeyi karşılaştırdığı
    için tek bir biçime indirgenir.
    """
    clean = re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()[:26]
    return clean or None


def _account_no_from_iban(iban: Optional[str]) -> Optional[str]:
    """26 haneli TR IBAN'ının son 6 hanesi hesap numarası olarak kullanılır.

    Yapı: TR + 2 kontrol + 5 banka + 1 rezerve + 16 hesap numarası. Bu 16 hanenin
    baş tarafı sıfır dolgusudur, bu yüzden hesabı ayırt eden son 6 hane alınır —
    içe aktarma sihirbazının hesap etiketleriyle de aynı kuyruk. Ekstre hesap
    numarasını ayrıca basmıyorsa (ör. ON Burgan dökümü yalnızca IBAN yazar)
    kimlik bu yolla tamamlanır.
    """
    clean = _clean_iban(iban) or ""
    return clean[-6:] if _IBAN_TR_RE.fullmatch(clean) else None


def _normalize_account_identity(accounts: list[dict]) -> list[dict]:
    """Kimlik kayıtlarını tek biçime getir: boşluksuz IBAN + dolu hesap numarası.

    Tüm çözümleyiciler için tek noktadan uygulanır (`parse_bank_file`), böylece
    yeni bir banka formatı eklendiğinde ayrıca hatırlanması gerekmez.
    """
    for acc in accounts or []:
        if acc.get("iban"):
            acc["iban"] = _clean_iban(acc["iban"])
        if not (acc.get("number") or "").strip():
            derived = _account_no_from_iban(acc.get("iban"))
            if derived:
                acc["number"] = derived
    return accounts


def _account_source_key(value) -> str:
    return re.sub(r"[^0-9A-Za-z]", "", str(value or "")).upper()


def _fill_account_balances_from_rows(accounts: list[dict], rows: list[dict]) -> list[dict]:
    """If the statement prints running balances but no account-level balance, expose one.

    The import wizard treats account.balance as the statement's closing balance and
    writes it directly to Accounts. This fallback lets any parser with row balances
    avoid net-delta reconciliation when the statement already tells us the balance.
    Parser-specific header balances, when present, stay authoritative.
    """
    if not accounts or not rows:
        return accounts
    by_source: dict[str, dict] = {}
    for row in rows:
        if row.get("balance") is None:
            continue
        key = _account_source_key(row.get("source"))
        if key and key not in by_source:
            by_source[key] = row
    first_with_balance = next((r for r in rows if r.get("balance") is not None), None)
    for acc in accounts:
        if acc.get("balance") is not None:
            continue
        keys = [
            _account_source_key(acc.get("source")),
            _account_source_key(acc.get("iban")),
            _account_source_key(acc.get("number")),
        ]
        row = next((by_source[k] for k in keys if k and k in by_source), None)
        if row is None and len(accounts) == 1:
            row = first_with_balance
        if row is not None:
            acc["balance"] = row.get("balance")
    return accounts


def _parse_garanti_export(grid: list[list]) -> tuple[list[dict], list[dict]]:
    """
    Garanti hesap hareketleri / kredi kartı ekstresini parse eder.
    Tek sayfada birden fazla kart bölümü ve gecikmiş başlık satırlarını destekler.
    Her satır kaynak kart/hesap referansı (`source`) ve `etiket` ile etiketlenir.

    İki değer döndürür:
      rows     — normalize edilmiş işlem satırları
      accounts — algılanan her kaynak için hesap kimliği
                 ({source, type, number, card_number, iban, branch, holder,
                   currency, institution}). Frontend bunu eşleşmeyen kaynaklar için
                 "hesabı oluştur" akışında kullanır.
    """
    rows: list[dict] = []
    current_source: Optional[str] = None
    current_currency = "TRY"
    idx: dict = {}            # aktif kolon haritası (boşsa henüz başlık görülmedi)

    holder: Optional[str] = None          # dosya-düzeyi "Ad Soyad" (tüm bölümlere uygulanır)
    accounts: dict = {}                   # source → kimlik kaydı (ekleme sırası korunur)

    def _acc(source: str) -> dict:
        """Kaynak için kimlik kaydını al/oluştur."""
        rec = accounts.get(source)
        if rec is None:
            rec = {
                "source": source, "type": None, "number": None, "card_number": None,
                "iban": None, "branch": None, "holder": holder,
                "currency": current_currency, "institution": "garanti",
            }
            accounts[source] = rec
        return rec

    for raw in grid:
        cells = [("" if c is None else str(c)) for c in raw]
        joined = " ".join(cells).strip()
        if not joined:
            continue
        col0 = cells[0].strip() if cells else ""

        # Ad Soyad — dosya-düzeyi hesap sahibi (kart/hesap bölümünden önce gelir).
        if col0.replace(" ", "").lower() in ("adsoyad", "adısoyadı", "adisoyadi"):
            val = next((c.strip() for c in cells[1:] if c.strip()), "")
            if val:
                holder = " ".join(val.split())   # fazla boşlukları temizle
            continue

        # Kart başlığı (ör. "4870 **** **** 1011 Numaralı Kart ... Ekstre Bilgileri")
        m = _CARD_TITLE_RE.search(joined)
        if m and ("kart" in joined.lower() or "ekstre" in joined.lower()):
            current_source = m.group(1).strip()
            current_currency = _detect_currency(joined)
            idx = {}
            rec = _acc(current_source)
            rec["type"] = "credit"
            rec["card_number"] = current_source
            rec["number"] = current_source
            rec["currency"] = current_currency
            continue

        # Hesap metadata satırı (ör. ["Hesap", "440 - 9059576 USD"])
        if col0.lower() == "hesap":
            val = next((c.strip() for c in cells[1:] if c.strip()), "")
            if val:
                current_source = val
                current_currency = _detect_currency(val)
                rec = _acc(current_source)
                rec["type"] = "bank"
                rec["number"] = _account_no_from_hesap(val)
                rec["currency"] = current_currency
            continue

        # IBAN satırı (ör. ["IBAN", "TR65 0006 2000 4400 0009 0595 76"])
        if col0.upper() == "IBAN":
            val = next((c.strip() for c in cells[1:] if c.strip()), "")
            if val and current_source:
                _acc(current_source)["iban"] = _clean_iban(val)
            continue

        # Şube satırı (ör. ["Şube", "İÇERENKÖY"])
        if col0.replace(" ", "").lower() in ("şube", "sube"):
            val = next((c.strip() for c in cells[1:] if c.strip()), "")
            if val and current_source:
                _acc(current_source)["branch"] = " ".join(val.split())
            continue

        # Hesap üst bilgisi: kredili mevduat hesaplarında iki değer basılır.
        #   Bakiye                = gerçek hesap bakiyesi
        #   Kullanılabilir Bakiye = gerçek bakiye + kredili hesap limiti
        # Import sonrası Account.balance her zaman gerçek "Bakiye" olmalı; limit
        # ayrı credit_limit alanına yazılır.
        meta_key = re.sub(r"[^A-Z0-9]", "", _fold(col0))
        if meta_key in ("BAKIYE", "KULLANILABILIRBAKIYE") and current_source:
            val = next((c.strip() for c in cells[1:] if c.strip()), "")
            amount_meta = _money_from_cell(val)
            if amount_meta is not None:
                rec = _acc(current_source)
                if meta_key == "BAKIYE":
                    rec["balance"] = amount_meta
                else:
                    rec["available_balance"] = amount_meta
            continue

        # Başlık satırı: "Tarih" + bir açıklama/tutar adayı içeriyor mu?
        di = _match_idx(cells, GARANTI_DATE_COLS)
        ai = _match_idx(cells, GARANTI_AMOUNT_COLS)
        desc_i = _match_idx(cells, GARANTI_DESC_COLS)
        if di is not None and (desc_i is not None or ai is not None):
            idx = {
                "date": di,
                "desc": desc_i,
                "etiket": _match_idx(cells, GARANTI_ETIKET_COLS),
                "amount": ai,
                "balance": _match_idx(cells, GARANTI_BALANCE_COLS),
            }
            continue

        # Veri satırı (aktif başlık ve tutar kolonu gerekli)
        if not idx or idx.get("amount") is None:
            continue

        def _cell(i):
            return cells[i].strip() if (i is not None and i < len(cells)) else ""

        date = _parse_turkish_date(_cell(idx["date"]))
        if not date:
            continue
        amount = _parse_amount(_cell(idx["amount"]))
        if not amount:            # boş/0 Tutar (ör. yalnızca bonus satırları) → atla
            continue
        balance = _parse_amount(_cell(idx["balance"])) if idx["balance"] is not None else None
        rows.append(_normalize_row(
            date, _cell(idx["desc"]), amount, balance, dict(enumerate(cells)),
            currency=current_currency, etiket=_cell(idx["etiket"]), source=current_source,
            account_type=(accounts.get(current_source) or {}).get("type"),
        ))

    # Ad Soyad bölüm başlığından sonra görüldüyse, kimliği olmayan kayıtlara da uygula.
    for rec in accounts.values():
        if rec["holder"] is None:
            rec["holder"] = holder
        balance = rec.get("balance")
        available = rec.get("available_balance")
        if rec.get("type") == "bank" and balance is not None and available is not None:
            limit = round(float(available) - float(balance), 2)
            if limit > 0:
                rec["bank_subtype"] = "overdraft"
                rec["credit_limit"] = limit

    return rows, list(accounts.values())


# ─────────────────────────────────────────────────────────────────────────────
# Midas (Menkul Değerler) portföy ekstresi (PDF)
# ─────────────────────────────────────────────────────────────────────────────
# Midas ekstresi bir aracı kurum hesap özetidir: banka işlem listesi değil,
# "PORTFÖY ÖZETİ" tablosu (elde tutulan menkul kıymetler) içerir. Bu yüzden
# işlem (Transaction) değil, yatırım (Investment) kaydı üretir.
#   Tablo kolonları: Sermaye Piyasası Aracı | Adet | Hisse Başı Ort. Maliyet |
#                    Kâr/Zarar | Toplam Değeri
#   Örn: "ALTIN.S1 - Altın Sertifikası •..." | 97 | 80,83 TRY | -44,22 TRY | 7795,89 TRY

# Bir hücre metninden ilk sayıyı çeker. Sıra önemli: önce binlik+ondalık
# (7.795,89), sonra ondalık (80,83), en son düz tam sayı (4328) — aksi halde
# "4328" gibi ayraçsız sayılarda ilk alternatif yanlışça "432"yi yakalar.
_MIDAS_NUM_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})+,\d+|-?\d+,\d+|-?\d+(?:\.\d+)?")


def _is_midas_pdf(text: str) -> bool:
    low = text.lower()
    return "midas menkul" in low[:1500] or (
        "portföy özeti" in low and "hesap ekstresi" in low[:2000]
    )


def _midas_num(cell) -> Optional[float]:
    """'80,83 TRY' / '7.795,89 TRY' / '9291.31' → float (para birimi ekini atar)."""
    m = _MIDAS_NUM_RE.search(str(cell or ""))
    return _parse_amount(m.group(0)) if m else None


def _midas_quantity(cell) -> Optional[float]:
    """Midas quantity cells use decimal comma with variable precision: '0,083898174'."""
    m = _MIDAS_NUM_RE.search(str(cell or ""))
    if not m:
        return None
    s = m.group(0)
    if "," in s:
        s = s.replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _midas_asset_type(ticker: str, name: str) -> str:
    """Sembol/isimden varlık türü tahmini (kullanıcı review'da değiştirebilir)."""
    t = (ticker or "").upper()
    n = _fold(name)
    if "ALTIN" in t or "ALTIN" in n or "GUMUS" in n:
        return "gold"
    if t.endswith(".F") or "PORTFOY" in n or "FON" in n:
        return "fund"
    return "stock"


def _midas_platform(currency: Optional[str]) -> str:
    """Keep Midas' TRY and USD portfolios in separate investment accounts."""
    cur = (currency or "").upper()
    if cur == "USD":
        return "Midas NASDAQ"
    if cur == "TRY":
        return "Midas BIST & TEFAS"
    return f"Midas {cur}".strip()


def _midas_summary(text: str) -> dict:
    """Ekstre başlığından nakit bakiye / toplam portföy değeri / dönem çıkarır."""
    out = {"cash": None, "total": None, "currency": None, "period_from": None, "period_to": None}
    m = re.search(r"Nakit Bakiye\s*:\s*([\d.,]+)\s*([A-Z]{3})?", text)
    if m:
        out["cash"] = _parse_amount(m.group(1))
        if m.group(2):
            out["currency"] = m.group(2)
    m = re.search(r"Toplam Portföy Değeri\s*:\s*([\d.,]+)\s*([A-Z]{3})?", text)
    if m:
        out["total"] = _parse_amount(m.group(1))
        if m.group(2):
            out["currency"] = m.group(2)
    m = re.search(r"(\d{2}/\d{2}/\d{2})\s*-\s*(\d{2}/\d{2}/\d{2})", text)
    if m:
        out["period_from"] = m.group(1)
        out["period_to"] = m.group(2)
    return out


def _parse_midas_holdings(content: bytes) -> list[dict]:
    """PORTFÖY ÖZETİ tablosunu yatırım (Investment) kayıtlarına çevirir."""
    holdings: list[dict] = []
    try:
        import pdfplumber
    except ImportError:
        return holdings
    with pdfplumber.open(io.BytesIO(content)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables():
                if not table:
                    continue
                # Başlık satırını bul (Adet + Maliyet kolonları).
                header_idx = None
                for i, r in enumerate(table):
                    joined = _fold(" ".join(str(c or "") for c in r))
                    if "ADET" in joined and "MALIYET" in joined:
                        header_idx = i
                        break
                if header_idx is None:
                    continue
                for r in table[header_idx + 1:]:
                    cells = [str(c or "").strip() for c in r]
                    if not cells or not cells[0]:
                        continue
                    name_cell = cells[0]
                    folded = _fold(name_cell)
                    # Dipnot (*) ve toplam satırlarını atla.
                    if name_cell.startswith("*") or "TOPLAM" in folded:
                        continue
                    qty = _midas_quantity(cells[1]) if len(cells) > 1 else None
                    if qty is None:
                        continue
                    avg = _midas_num(cells[2]) if len(cells) > 2 else None
                    total = _midas_num(cells[-1]) if len(cells) >= 2 else None
                    ticker = re.split(r"\s+-\s+", name_cell, 1)[0].strip()
                    # Sondaki kısaltma imlerini ("•...", "...") temizle.
                    disp_name = name_cell.rstrip(" .•·").strip()
                    cur = _detect_currency(cells[2] if len(cells) > 2 else name_cell)
                    holdings.append({
                        "ticker": ticker,
                        "name": disp_name,
                        "platform": "Midas",
                        "asset_type": _midas_asset_type(ticker, disp_name),
                        "currency": cur or "TRY",
                        "amount": qty,
                        "purchase_price": avg,
                        "current_value": total,
                    })
    return holdings


# ─────────────────────────────────────────────────────────────────────────────
# BES "Birikim Özeti" (bireysel emeklilik) ekstresi (PDF)
# ─────────────────────────────────────────────────────────────────────────────
# Bir emeklilik şirketi birikim özetidir: işlem listesi değil, sözleşme birikimi
# + fon dağılımı. Bu yüzden Transaction değil, "pension" tipli bir Account ve
# fon başına Investment kaydı üretir.

# BES tutarları binlik ayracı "." ve ondalık ayracı "," ile yazılır; tam sayı
# tutarlarda ondalık kısım hiç yoktur ("17.020 TL" = 17020). Ortak _parse_amount
# bunu 17.02 olarak okur (3 haneli ",ddd" / ".ddd" belirsizliği), bu yüzden BES'in
# kendi çözümleyicisi var — ON/Burgan'ın _parse_on_amount'u ile aynı gerekçe.
_BES_AMOUNT_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*(?:,\d+)?")


def _parse_bes_amount(value) -> Optional[float]:
    """'17.020 TL' → 17020.0 · '54.529,05 TL' → 54529.05 · '-485,41 TL' → -485.41."""
    m = _BES_AMOUNT_RE.search(str(value or "").strip())
    if not m:
        return None
    s = m.group(0).replace(".", "").replace(",", ".")
    try:
        return float(s)
    except ValueError:
        return None


def _bes_amounts(line: str, limit: int = 8) -> list[float]:
    """Bir satırdaki tüm tutarları sırayla döndürür."""
    out = []
    for m in _BES_AMOUNT_RE.finditer(line or ""):
        v = _parse_bes_amount(m.group(0))
        if v is not None:
            out.append(v)
        if len(out) >= limit:
            break
    return out


def _is_bes_pdf(text: str) -> bool:
    f = _fold(text)
    return "BES BIRIKIM OZETI" in f and ("SOZLESME NO" in f or "DEVLET KATKISI" in f)


def _bes_field(text: str, label: str) -> Optional[str]:
    """
    'Sözleşme No :17943452' → '17943452' (etiket eşleşmesi aksan/boşluk duyarsız).

    Sayfa iki sütunlu dizildiği için bir satırda birden fazla "etiket : değer"
    çifti bulunabilir ve önceki değer bir sonraki etikete yapışır:
        "Ödeyeceğiniz Tutar : 10.000 TL Hak Ediş Oranınız : % 0"
    Bu yüzden satır ":" ile parçalanır ve etiket parça SONUNDA aranır.
    """
    want = re.sub(r"[^A-Z0-9]", "", _fold(label))
    for line in text.split("\n"):
        parts = re.split(r"\s*:\s*", line)
        for i in range(len(parts) - 1):
            if re.sub(r"[^A-Z0-9]", "", _fold(parts[i])).endswith(want):
                return parts[i + 1].strip()
    return None


def _bes_date_field(text: str, label: str) -> Optional[str]:
    """Tarih alanı: değerin ilk kelimesini alır (kalanı komşu sütunun etiketidir)."""
    raw = _bes_field(text, label)
    return _parse_turkish_date(raw.split()[0]) if raw and raw.split() else None


def _bes_values_after(text: str, label: str, n: int) -> list[float]:
    """
    Başlık satırının ALTINDAKİ satırdan ilk n tutarı çeker. Bu bölümde etiketler ve
    değerler ayrı satırlardadır:
        Birikiminiz Devlet Katkısı          <- etiketler
        46.807,66 TL 7.721,39 TL            <- değerler
    """
    want = re.sub(r"[^A-Z0-9]", "", _fold(label))
    lines = text.split("\n")
    for i, line in enumerate(lines):
        if re.sub(r"[^A-Z0-9]", "", _fold(line)).startswith(want) and i + 1 < len(lines):
            vals = _bes_amounts(lines[i + 1], limit=n)
            if len(vals) >= n:
                return vals[:n]
    return []


# "Fon Performansları" bloğundaki bir fon satırı. Bu blok metin katmanında düz ve
# satır bazlıdır; "Fon Dağılımınız" tablosu ise pdfplumber'da iç içe geçmiş
# hücreler halinde çıktığı için tercih edilmez.
#   "ALTIN KATILIM EYF %40,17 26.06.2013 %6837,4 %-10,7"
_BES_FUND_RE = re.compile(
    r"^(?P<name>.+?EYF)\s+%(?P<pct>[\d,]+)\s+(?P<since>\d{2}\.\d{2}\.\d{4})"
    r"\s+%(?P<ret_all>-?[\d,]+)\s+%(?P<ret_own>-?[\d,]+)\s*$"
)
# Katkı payı hedef dağılımı: aynı satırda ikinci bir "AD %oran" çifti olarak gelir.
#   "ALTIN KATILIM EYF %40,17 ALTIN KATILIM EYF %45"
_BES_TARGET_RE = re.compile(r"^(?P<name>.+?EYF)\s+%[\d,]+\s+(?P=name)\s+%(?P<pct>[\d,]+)\s*$")


def _bes_pct(s: str) -> Optional[float]:
    try:
        return float(str(s).replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def _parse_bes_funds(text: str) -> list[dict]:
    """'Fon Performansları' bloğundan fonları çıkarır; devlet katkısı fonlarını işaretler."""
    funds: list[dict] = []
    state_block = False
    for raw in text.split("\n"):
        line = " ".join(raw.split())
        folded = _fold(line)
        # "DEVLET KATKISI FON ADI" başlığı devlet katkısı fonlarını açar; sonraki
        # düz "FON ADI" başlığı tekrar katılımcı fonlarına döner. Sayfada bu iki
        # başlık çifti iki kez geçer (fon dağılımı + fon performansları), bu yüzden
        # bayrağın sıfırlanması şart — yoksa tüm fonlar devlet katkısı sanılır.
        if "FON ADI" in folded:
            state_block = "DEVLET KATKISI" in folded
            continue
        m = _BES_FUND_RE.match(line)
        if not m:
            continue
        pct = _bes_pct(m.group("pct"))
        if pct is None:
            continue
        name = m.group("name").strip()
        if any(f["name"] == name for f in funds):
            continue
        funds.append({
            "name": name,
            "pct": pct,
            "state": state_block,
            "since": _parse_turkish_date(m.group("since")),
            "return_since_launch": _bes_pct(m.group("ret_all")),
            "return_since_contract": _bes_pct(m.group("ret_own")),
        })
    return funds


def _parse_bes_targets(text: str) -> dict:
    """Katkı payı hedef fon dağılımı ({fon adı: yüzde}); okunamazsa boş döner."""
    out = {}
    for raw in text.split("\n"):
        m = _BES_TARGET_RE.match(" ".join(raw.split()))
        if m:
            pct = _bes_pct(m.group("pct"))
            if pct is not None:
                out[m.group("name").strip()] = pct
    return out


def _parse_bes_pdf(text: str) -> tuple[dict, list[dict]]:
    """
    BES birikim özetini (özet sözlüğü, fon listesi) olarak çözer.

    Fon tutarları yüzdelerden hesaplanır: katılımcı fonları "Birikiminiz",
    devlet katkısı fonları "Devlet Katkısı" havuzu üzerinden. Yuvarlama artığı en
    büyük fona eklenir, böylece fonların toplamı her zaman toplam birikime eşittir.
    """
    total = None
    vals = _bes_values_after(text, "Toplam Birikiminiz", 1)
    if vals:
        total = vals[0]

    own = state = None
    pair = _bes_values_after(text, "Birikiminiz Devlet Katkısı", 2)
    if pair:
        own, state = pair[0], pair[1]

    paid = state_paid = None
    quad = _bes_values_after(text, "Ödenen Toplam Tutar", 4)
    if quad:
        paid, state_paid = quad[0], quad[2]

    if total is None and own is not None and state is not None:
        total = round(own + state, 2)

    vesting = (_bes_field(text, "Hak Ediş Oranınız") or "").replace("%", "").strip()

    summary = {
        "provider": "Garanti BBVA Emeklilik",
        "contract_no": (_bes_field(text, "Sözleşme No") or "").strip() or None,
        "plan": (_bes_field(text, "Plan Adı") or "").strip() or None,
        "participant": (_bes_field(text, "Katılımcı Adı Soyadı") or "").strip() or None,
        "start_date": _bes_date_field(text, "Sözleşme Yürürlük Tarihi"),
        "total": total,
        "own_savings": own,
        "state_contribution": state,
        "total_paid": paid,
        "state_paid_in": state_paid,
        "pending": _parse_bes_amount(_bes_field(text, "Provizyonda Bekleyen Tutar") or ""),
        "next_payment_date": _bes_date_field(text, "Bir Sonraki Ödeme Tarihi"),
        "next_payment_amount": _parse_bes_amount(_bes_field(text, "Ödeyeceğiniz Tutar") or ""),
        "vesting_pct": _bes_pct(vesting.split()[0]) if vesting.split() else None,
        "report_date": _bes_date_field(text, "Rapor Tarihi"),
    }
    targets = _parse_bes_targets(text)
    if targets:
        summary["target_allocation"] = targets

    funds = _parse_bes_funds(text)
    for f in funds:
        pool = state if f["state"] else own
        f["value"] = round(pool * f["pct"] / 100.0, 2) if pool is not None else None

    # Yuvarlama artığını en büyük fona ver → fonların toplamı = toplam birikim.
    priced = [f for f in funds if f.get("value") is not None]
    if priced and total is not None:
        drift = round(total - sum(f["value"] for f in priced), 2)
        if drift:
            max(priced, key=lambda f: f["value"])["value"] += drift

    return summary, funds


# ─────────────────────────────────────────────────────────────────────────────
# Ana parse fonksiyonu
# ─────────────────────────────────────────────────────────────────────────────

def _load_dataframe(content: bytes, ext: str):
    """Bytes'dan pandas DataFrame yükle. Başlık satırını akıllıca bul."""
    if ext == "csv":
        for enc in ("utf-8", "cp1254", "iso-8859-9", "latin-1"):
            try:
                df = pd.read_csv(io.BytesIO(content), encoding=enc, sep=None, engine="python")
                return df
            except Exception:
                continue
        return None

    # XLS / XLSX
    engine = "xlrd" if ext == "xls" else "openpyxl"
    # İlk 5 satırı tara, kolon başlıklarını bul
    for skip in range(0, 8):
        try:
            df = pd.read_excel(io.BytesIO(content), engine=engine, skiprows=skip, header=0)
            # En az 3 dolu kolon varsa bu satır başlık olabilir
            non_null = df.columns.notna().sum()
            has_data = len(df.dropna(how="all")) > 2
            if non_null >= 3 and has_data:
                # Sütun adlarını temizle
                df.columns = [str(c).strip() for c in df.columns]
                return df
        except Exception:
            continue
    return None


def parse_bank_file(content: bytes, filename: str, bank_hint: str = "auto", db=None) -> dict:
    """
    Ana giriş noktası. Dosyayı parse eder, önizleme döndürür.

    Dönen yapı:
    {
        bank_detected: str,
        total_rows: int,
        income_total: float,
        expense_total: float,
        date_range: { from, to },
        rows: [ normalize edilmiş satırlar ],
        errors: [ varsa uyarılar ]
    }
    """
    if not PANDAS_OK:
        return {"error": "pandas kütüphanesi eksik. 'pip install pandas openpyxl xlrd' çalıştırın."}

    # Refresh the Etiket→category map from the DB so the importer honours edits made
    # in Configuration → Statement Value Mapping (falls back to hardcoded on failure).
    if db is not None:
        load_etiket_map(db)

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    errors = []
    rows = []

    accounts: list[dict] = []      # algılanan hesap/kart kimlikleri (Garanti export yolu)

    if ext == "pdf":
        # Önce metni çıkar: Garanti kredi kartı ekstresi serbest metin formatındadır
        # (tablo yok), bu yüzden tablo tabanlı _parse_pdf onu okuyamaz.
        text = _extract_pdf_text(content)
        # Midas aracı kurum ekstresi → işlem değil, PORTFÖY ÖZETİ (yatırımlar).
        if text and _is_midas_pdf(text):
            holdings = _parse_midas_holdings(content)
            summary = _midas_summary(text)
            platform = _midas_platform(summary.get("currency"))
            for holding in holdings:
                holding["platform"] = platform
            return {
                "kind": "investments",
                "bank_detected": "Midas (portföy)",
                "total_rows": len(holdings),
                "investments": holdings,
                "portfolio": summary,
                "rows": [],
                "accounts": [],
                "errors": [] if holdings else ["Portföyde kayıt bulunamadı."],
            }
        # BES birikim özeti → işlem değil, emeklilik hesabı + fon dağılımı.
        # Garanti markalı olduğu için kart/hesap çözümleyicilerinden ÖNCE gelmeli.
        if text and _is_bes_pdf(text):
            summary, funds = _parse_bes_pdf(text)
            return {
                "kind": "pension",
                "bank_detected": "Garanti BBVA Emeklilik (BES)",
                "total_rows": len(funds),
                "pension": summary,
                "funds": funds,
                "rows": [],
                "accounts": [],
                "errors": [] if funds else ["Fon dağılımı okunamadı."],
            }
        # TEB dijital hesap cüzdanı → şimdilik yalnızca hesap kimliği (işlem yok).
        # Kendi dalında erken döner: satır üretmediği için aşağıdaki "if not rows"
        # zincirine bırakılsa jenerik tablo/OCR yoluna düşer ve TEB künyesi
        # yerine çöp satırlar üretirdi.
        if text and _is_teb_pdf(text):
            _, accounts = _parse_teb_pdf(content, text)
            _normalize_account_identity(accounts)
            # `has_movements` distinguishes "hesap gerçekten hareketsiz" from
            # "hareket var ama çözümleyicimiz yok" — arayüz metnini buna göre
            # seçer, böylece yerelleştirilmiş dize arayüze sızmaz.
            moved = _teb_has_movements(text)
            if not accounts:
                notes = ["Hesap künyesi okunamadı."]
            elif moved:
                notes = ["TEB cüzdanında hesap hareketi görünüyor, ancak işlem "
                         "satırı çözümleyicisi henüz yok — yalnızca hesap tanımlandı."]
            else:
                notes = ["Cüzdanda hesap hareketi yok — yalnızca hesap tanımlandı."]
            return {
                "kind": "identity",
                "bank_detected": "teb (dijital hesap cüzdanı PDF)",
                "total_rows": 0,
                "income_total": 0.0,
                "expense_total": 0.0,
                "date_range": {"from": None, "to": None},
                "rows": [],
                "accounts": accounts,
                "has_movements": moved,
                "errors": notes,
            }
        if text and _is_garanti_cc_pdf(text):
            rows, accounts = _parse_garanti_cc_pdf(text)
            bank_detected = "garanti (kredi kartı PDF)"
        if not rows and text and _is_garanti_donemici_pdf(text):
            rows, accounts = _parse_garanti_donemici_pdf(content, text)
            bank_detected = "garanti (dönemiçi işlemler PDF)"
        if not rows and text and _is_garanti_hesap_pdf(text):
            rows, accounts = _parse_garanti_hesap_pdf(content, text)
            bank_detected = "garanti (hesap hareketleri PDF)"
        if not rows and text and _is_on_burgan_pdf(text):
            rows, accounts = _parse_on_burgan_pdf(content, text)
            bank_detected = "on_burgan (hesap hareketleri PDF)"
        if not rows and text and _is_qnb_pdf(text):
            rows, accounts = _parse_qnb_pdf(content, text)
            bank_detected = "qnb (hesap hareketleri PDF)"
        if not rows and text and _is_odea_pdf(text):
            rows, accounts = _parse_odea_pdf(content, text)
            bank_detected = "odea (hesap hareketleri PDF)"
        if not rows:
            rows = _parse_pdf(content)
            bank_detected = bank_hint if bank_hint != "auto" else "pdf"
    else:
        # TEB'in `.xls` dosyası gerçekte HTML'dir; xlrd'ye göndermeden önce
        # imzayı yakala ve tabloyu kendi ayrıştırıcımızla oku.
        teb_html = _is_teb_html_export(content)
        if teb_html:
            rows, accounts = _parse_teb_html_export(content)
            bank_detected = "teb (hesap hareketleri XLS)"
        else:
            rows, accounts = [], []
            bank_detected = None

        # Önce Garanti çok-bölümlü export imzasını dene (ham ızgara üzerinden).
        # Bu format gecikmiş başlık + birden fazla kart bölümü içerdiğinden
        # standart tek-başlık DataFrame yolu onu okuyamaz.
        grid = _load_raw_grid(content, ext) if not teb_html and bank_hint in ("auto", "garanti", "odea") else None
        if not rows and grid and _is_garanti_export(grid):
            rows, accounts = _parse_garanti_export(grid)
        if not rows and grid and _is_odea_grid(grid):
            rows, accounts = _parse_odea_grid(grid)
            bank_detected = "odea"

        if rows or teb_html:
            bank_detected = bank_detected or "garanti"
        else:
            df = _load_dataframe(content, ext)
            if df is None:
                return {"error": "Dosya okunamadı. Format desteklenmiyor olabilir."}

            # Boş satırları at
            df = df.dropna(how="all")

            if bank_hint == "garanti":
                rows = _parse_garanti(df)
                bank_detected = "garanti"
            elif bank_hint in ("on_burgan", "on", "burgan"):
                rows = _parse_on_burgan(df)
                bank_detected = "on_burgan"
            elif bank_hint == "odea":
                rows, accounts = _parse_odea_grid(grid or [])
                bank_detected = "odea"
            else:
                # Otomatik algıla
                cols_str = " ".join(str(c).lower() for c in df.columns)
                if "garanti" in cols_str or ("borç" in cols_str and "alacak" in cols_str):
                    rows = _parse_garanti(df)
                    bank_detected = "garanti (otomatik)"
                elif "burgan" in cols_str or "on bank" in cols_str:
                    rows = _parse_on_burgan(df)
                    bank_detected = "on_burgan (otomatik)"
                else:
                    rows = _parse_generic(df)
                    bank_detected = "generic"

    if not rows:
        errors.append("İşlem satırı bulunamadı. Banka formatını manuel seçmeyi deneyin.")

    # IBAN'ı boşluksuz biçime indirge; hesap numarası basmayan formatlarda
    # numarayı IBAN'ın son 6 hanesinden türet.
    _normalize_account_identity(accounts)
    _fill_account_balances_from_rows(accounts, rows)

    income_total  = sum(r["amount"] for r in rows if r["type"] == "income")
    expense_total = sum(r["amount"] for r in rows if r["type"] == "expense")
    dates = [r["date"] for r in rows if r["date"]]

    return {
        "bank_detected": bank_detected,
        "total_rows": len(rows),
        "income_total": round(income_total, 2),
        "expense_total": round(expense_total, 2),
        "date_range": {
            "from": min(dates) if dates else None,
            "to":   max(dates) if dates else None,
        },
        "rows": rows,
        "accounts": accounts,     # algılanan hesap/kart kimlikleri (eşleşmeyen → oluştur akışı)
        "errors": errors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Veritabanına kayıt
# ─────────────────────────────────────────────────────────────────────────────

def import_transactions(
    db: Session,
    owner_id: int,
    rows: list[dict],
    skip_duplicates: bool = True,
    credit_payment_id: int | None = None,
    default_payment_method: str | None = None,
    default_category_key: str | None = None,
    source_filename: str | None = None,
) -> dict:
    """
    Parse edilmiş satırları Transaction tablosuna yazar.
    skip_duplicates=True ise aynı hesap+tarih+tür+tutar+para birimi+açıklama
    olan kayıtları atlar. Eşleşme dönemden bağımsızdır.

    credit_payment_id / default_payment_method / default_category_key:
    when importing a credit-card statement, tag every created spending with the
    statement record and the card, falling back to the per-row values when present.

    source_filename: the original uploaded statement's filename, stamped onto every
    row it creates so the UI can show provenance (e.g. Account Activity's detail modal).
    """
    from datetime import date as date_type
    from app.models import Account, Transaction as Tx, TransactionType, Currency
    from app.routers.transactions import _apply_rates

    imported = 0
    skipped = 0
    errors = []
    # Resolve every payment-method reference in one owner-scoped query. Frontend
    # normally sends account_key; unique legacy display names are supported too.
    owned_accounts = db.query(Account).filter(Account.owner_id == owner_id).all()
    account_type_by_ref = {
        account.account_key: account.type
        for account in owned_accounts
        if account.account_key
    }
    name_counts: dict[str, int] = {}
    for account in owned_accounts:
        if account.name:
            name_counts[account.name] = name_counts.get(account.name, 0) + 1
    for account in owned_accounts:
        if account.name and name_counts.get(account.name) == 1:
            account_type_by_ref[account.name] = account.type
    # Map every supported account reference to one stable identity. Without the
    # account in the key, two unrelated statements can suppress one another when
    # they happen to contain the same dated amount.
    account_identity_by_ref: dict[str, str] = {}
    for account in owned_accounts:
        identity = f"account:{account.id}"
        account_identity_by_ref[str(account.id)] = identity
        if account.account_key:
            account_identity_by_ref[account.account_key] = identity
        if account.name and name_counts.get(account.name) == 1:
            account_identity_by_ref[account.name] = identity

    def account_identity(value: str | None) -> str | None:
        if not value:
            return None
        return account_identity_by_ref.get(value, f"ref:{value}")

    def enum_value(value):
        return value.value if hasattr(value, "value") else str(value)

    def transaction_key(tx_date, amount, tx_type, currency, description, payment_method):
        return (
            tx_date,
            round(float(amount or 0), 2),
            enum_value(tx_type),
            enum_value(currency or "TRY"),
            (description or "").strip(),
            account_identity(payment_method),
        )

    # Counts, rather than a set, preserve legitimate repeated purchases with the
    # same fields. A re-import consumes the existing occurrences one by one.
    existing_counts: dict[tuple, int] = {}
    if skip_duplicates:
        parsed_dates = []
        for row in rows:
            try:
                parsed_dates.append(date_type.fromisoformat(row["date"]))
            except Exception:
                continue
        if parsed_dates:
            existing_rows = db.query(
                Tx.date, Tx.amount, Tx.type, Tx.currency,
                Tx.description, Tx.payment_method,
            ).filter(
                Tx.owner_id == owner_id,
                Tx.date.in_(set(parsed_dates)),
            ).all()
            for tx in existing_rows:
                key = transaction_key(
                    tx.date, tx.amount, tx.type, tx.currency,
                    tx.description, tx.payment_method,
                )
                existing_counts[key] = existing_counts.get(key, 0) + 1

    imported_indices = []
    skipped_indices = []
    for row_index, row in enumerate(rows):
        try:
            tx_date = date_type.fromisoformat(row["date"])
            raw_amount = float(row["amount"])
            desc    = row.get("description", "")
            # Credit-card statement lines (payment / carried-over debt) are
            # reclassified here too — the final authority — so every import path
            # books them correctly even if the row arrived mistyped.
            type_override, cat_override = _cc_classify(desc)
            # type may be explicit (from the review wizard) or derived from the sign
            # of the parsed amount (positive = income, negative = expense).
            row_type = type_override or row.get("type") or ("income" if raw_amount >= 0 else "expense")
            tx_type = TransactionType.income if row_type == "income" else TransactionType.expense
            # Store magnitude only — direction lives in `type`, matching how the
            # Spending module persists transactions (positive amount + type).
            amount = abs(raw_amount)
            currency = row.get("currency", "TRY")
            payment_method = row.get("payment_method") or default_payment_method
            category_key = cat_override or row.get("category_key") or default_category_key
            if (
                not category_key
                and tx_type == TransactionType.expense
                and account_type_by_ref.get(payment_method) in {"credit", "debit"}
            ):
                category_key = "shopping"
            if (
                not category_key
                and payment_method
                and account_type_by_ref.get(payment_method) not in {None, "credit", "debit"}
            ):
                category_key = "wire-transfer"

            dedupe_key = transaction_key(
                tx_date, amount, tx_type, currency, desc, payment_method
            )
            if skip_duplicates and existing_counts.get(dedupe_key, 0) > 0:
                existing_counts[dedupe_key] -= 1
                skipped += 1
                skipped_indices.append(row_index)
                continue

            tx = Tx(
                owner_id=owner_id,
                type=tx_type,
                amount=amount,
                currency=currency,
                description=desc,
                date=tx_date,
                category_key=category_key,
                payment_method=payment_method,
                payer=row.get("payer"),
                paying_for=row.get("paying_for"),
                credit_payment_id=credit_payment_id,
                source_filename=source_filename,
                note="banka_import",
            )
            _apply_rates(tx, db)
            db.add(tx)
            imported += 1
            imported_indices.append(row_index)

        except Exception as e:
            errors.append(f"Satır atlandı: {row.get('date')} — {e}")

    db.commit()
    return {
        "imported": imported,
        "skipped": skipped,
        "imported_indices": imported_indices,
        "skipped_indices": skipped_indices,
        "errors": errors,
    }


def import_investments(
    db: Session,
    owner_id: int,
    holdings: list[dict],
    upsert: bool = True,
    note: str = "midas_import",
    replace: bool = False,
    sync_holdings: bool = False,
    portfolio: Optional[dict] = None,
) -> dict:
    """
    Parse edilmiş Midas portföy satırlarını Investment tablosuna yazar.

    upsert=True ise aynı platform + sembol (name'in başındaki ticker) olan kayıt
    güncellenir (adet + maliyet), yoksa yeni oluşturulur. Böylece ekstre yeniden
    içe aktarıldığında portföy çift kayıt üretmez.

    replace=True ise, bu platformun listede OLMAYAN kayıtları silinir. BES fon
    dağılımı eksiksiz dönem verisidir: bir sonraki ekstrede kaldırılan bir fon
    ortalıkta kalırsa fonların toplamı hesap bakiyesini tutmaz. Midas yolu bunu
    kullanmaz (varsayılan False) — orada ekstre tüm portföyü içermeyebilir.
    """
    from app.models import Account, Investment as Inv
    from app.services.assets import delete_investment_holding, record_asset_valuation_from_holdings, sync_investment_holding

    created = 0
    updated = 0
    removed = 0
    accounts_created = 0
    accounts_updated = 0
    errors = []
    seen: dict[str, set] = {}
    platform_meta: dict[str, dict] = {}
    touched: list[Inv] = []
    current_unit_prices: dict[tuple[str, str], float] = {}

    for h in holdings:
        try:
            name = (h.get("name") or "").strip()
            if not name:
                continue
            ticker = (h.get("ticker") or name.split(" - ")[0]).strip()
            platform = (h.get("platform") or "Midas").strip()
            amount = float(h.get("amount") or 0)
            currency = h.get("currency") or "TRY"
            asset_type = h.get("asset_type") or "stock"
            price = h.get("purchase_price")
            price = float(price) if price is not None else None
            current_value = h.get("current_value")
            current_value = float(current_value) if current_value is not None else None
            meta = platform_meta.setdefault(platform, {"currency": currency, "value": 0.0})
            meta["currency"] = meta.get("currency") or currency
            if current_value is not None:
                meta["value"] += current_value
                if amount:
                    current_unit_prices[(platform, name)] = current_value / amount
            elif price is not None:
                meta["value"] += amount * price

            existing = None
            if upsert and ticker:
                # Sembolle eşleştir: name "TICKER - Ad" biçiminde saklanır.
                existing = (
                    db.query(Inv)
                    .filter(
                        Inv.owner_id == owner_id,
                        Inv.platform == platform,
                        Inv.name.like(ticker + "%"),
                    )
                    .first()
                )

            if existing:
                existing.amount = amount
                if price is not None:
                    existing.purchase_price = price
                existing.asset_type = asset_type or existing.asset_type
                existing.currency = currency
                touched.append(existing)
                updated += 1
            else:
                inv = Inv(
                    owner_id=owner_id,
                    name=name,
                    platform=platform,
                    asset_type=asset_type,
                    currency=currency,
                    amount=amount,
                    purchase_price=price,
                    note=note,
                )
                db.add(inv)
                db.flush()
                touched.append(inv)
                created += 1

            seen.setdefault(platform, set()).add(name)

        except Exception as e:
            errors.append(f"{h.get('name')}: {e}")

    if replace:
        for platform, names in seen.items():
            for stale in (
                db.query(Inv)
                .filter(Inv.owner_id == owner_id, Inv.platform == platform)
                .all()
            ):
                if stale.name not in names:
                    if sync_holdings:
                        delete_investment_holding(db, stale)
                    db.delete(stale)
                    removed += 1

    if sync_holdings:
        for platform, meta in platform_meta.items():
            rows = (
                db.query(Account)
                .filter(Account.owner_id == owner_id, Account.type == "invest")
                .all()
            )
            acc = next(
                (a for a in rows
                 if (a.name or "").strip().casefold() == platform.strip().casefold()),
                None,
            )
            if acc is None:
                institution = (
                    "Midas Menkul Değerler A.Ş."
                    if platform.casefold().startswith("midas")
                    else platform
                )
                acc = Account(
                    owner_id=owner_id,
                    type="invest",
                    name=platform,
                    institution=institution,
                    currency=(portfolio or {}).get("currency") or meta.get("currency") or "TRY",
                    balance=0.0,
                )
                db.add(acc)
                db.flush()
                acc.account_key = f"acc-{acc.id}"
                accounts_created += 1
            else:
                accounts_updated += 1
            acc.name = platform
            acc.institution = acc.institution or platform
            acc.currency = (portfolio or {}).get("currency") or meta.get("currency") or acc.currency
            if portfolio and len(platform_meta) == 1 and portfolio.get("total") is not None:
                acc.balance = float(portfolio["total"])
            else:
                acc.balance = round(float(meta.get("value") or 0), 2)

        for inv in touched:
            holding = sync_investment_holding(db, inv)
            unit = current_unit_prices.get((inv.platform or "", inv.name or ""))
            if unit is not None:
                holding.current_price = round(unit, 8)
                holding.price_source = "import"

        asset_ids = set()
        from app.models import Asset
        for platform in seen:
            asset = (
                db.query(Asset)
                .filter(Asset.owner_id == owner_id, Asset.name == platform)
                .first()
            )
            if asset:
                asset_ids.add(asset.id)
        for asset_id in asset_ids:
            asset = db.query(Asset).filter(Asset.id == asset_id).first()
            if asset:
                record_asset_valuation_from_holdings(db, asset)

    db.commit()
    return {
        "created": created,
        "updated": updated,
        "removed": removed,
        "accounts_created": accounts_created,
        "accounts_updated": accounts_updated,
        "accounts": list(seen.keys()) if sync_holdings else [],
        "errors": errors,
    }


def import_pension(
    db: Session,
    owner_id: int,
    pension: dict,
    funds: list[dict],
) -> dict:
    """
    BES birikim özetini "pension" tipli bir Account + fon başına Investment yazar.

    Hesap, sözleşme numarasıyla eşleştirilir (aynı sözleşmenin her ay yeniden içe
    aktarılması yeni hesap açmaz, mevcut olanı günceller). Fonlar platform ==
    hesap adı ile bağlanır — Midas holdings ile aynı mekanizma — ve replace=True
    ile yazılır, çünkü fon dağılımı eksiksiz dönem verisidir.
    """
    from app.models import Account

    contract = (pension.get("contract_no") or "").strip()
    if not contract:
        return {"error": "Sözleşme numarası okunamadı", "created": 0, "updated": 0}

    rows = (
        db.query(Account)
        .filter(Account.owner_id == owner_id, Account.type == "pension")
        .all()
    )
    # `number` is the pension account's unique key (routers/accounts.UNIQUE_FIELD), so
    # match on it too — a plan added by hand through the Accounts form has the contract
    # in `number` but no `pension` blob yet, and matching only the blob would open a
    # second account carrying the same contract number.
    acc = next(
        (a for a in rows
         if (a.pension or {}).get("contract_no") == contract or (a.number or "").strip() == contract),
        None,
    )

    name = (pension.get("plan") or pension.get("provider") or "BES").strip()
    total = pension.get("total")
    created_account = acc is None

    if acc is None:
        acc = Account(
            owner_id=owner_id,
            type="pension",
            name=name,
            holder=None,
            currency="TRY",
            institution=pension.get("provider"),
            number=contract,
        )
        db.add(acc)
        db.flush()                      # id gerekli: account_key "acc-{id}"
        acc.account_key = f"acc-{acc.id}"

    acc.name = name
    acc.institution = pension.get("provider") or acc.institution
    acc.number = contract
    if total is not None:
        acc.balance = total
    # Keep the statement's OWN printed percentages alongside the figures. They can't
    # be re-derived from the fund values alone: a participant fund's share is of
    # "Birikiminiz" while the devlet katkısı fund's is of its own pool, so dividing
    # by the plan total would show 34,48% where the statement prints 40,17%.
    acc.pension = {
        **pension,
        "allocation": {f["name"]: f.get("pct") for f in funds if f.get("name")},
        "state_funds": [f["name"] for f in funds if f.get("name") and f.get("state")],
    }
    db.commit()
    db.refresh(acc)
    db.commit()

    inv_rows = [
        {
            "ticker": f["name"],
            "name": f["name"],
            "platform": acc.name,
            "asset_type": "fund",
            "currency": "TRY",
            "amount": f.get("value") or 0,
            "purchase_price": None,
        }
        for f in funds
        if f.get("name")
    ]
    inv = import_investments(
        db, owner_id, inv_rows, upsert=True, note="bes_import", replace=True, sync_holdings=False
    )

    return {
        "account_created": created_account,
        "account_key": acc.account_key,
        "account_name": acc.name,
        "balance": acc.balance,
        "funds_created": inv["created"],
        "funds_updated": inv["updated"],
        "funds_removed": inv["removed"],
        "errors": inv["errors"],
    }
