"""
Banka ekstre import servisi.

Desteklenen bankalar:
  - Garanti BBVA   → XLS/XLSX/CSV
  - ON (Burgan)    → XLS/XLSX/CSV
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
from datetime import datetime
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


# Garanti's structured "Etiket" column (Turkish category tag) → our category_key.
# Keys are diacritic-folded and stripped of every non-alphanumeric char so slash /
# spacing variants ("Faiz / Komisyon", "Faiz/Komisyon") all collapse to one key.
# "Diğer" is intentionally absent: on BANK statements it falls to the _DIGER_RE
# transfer rule, on CARD statements it stays a plain expense. "Para Çekme" (ATM
# withdrawal) is likewise left to the sign-based default.
_ETIKET_CATEGORY = {
    "MAAS":             "salary",              # Maaş
    "PARATRANSFERI":    "wire-transfer",       # Para Transferi
    "KARTODEMESI":      "credit-card-payment", # Kart Ödemesi
    "FAIZKOMISYON":     "interest",            # Faiz / Komisyon
    "TELEKOMUNIKASYON": "utilities",           # Telekomünikasyon
    "ULASIM":           "transport",           # Ulaşım
    "DOVIZALSAT":       "wire-transfer",       # Döviz Al / Sat
    "MARKET":           "groceries",           # Market
    "YEMEICME":         "dining",              # Yeme / İçme
    "AKARYAKIT":        "transport",           # Akaryakıt
    "GIYIMAKSESUAR":    "shopping",            # Giyim / Aksesuar
    "EGLENCEHOBI":      "entertainment",       # Eğlence / Hobi
    "SAGLIKBAKIM":      "health",              # Sağlık / Bakım
    "ELEKTRONIK":       "shopping",            # Elektronik
    "EVDEKORASYON":     "shopping",            # Ev / Dekorasyon
    "KISISELHIZMET":    "shopping",            # Kişisel Hizmet
    # Covers BOTH pension contributions and ordinary insurance premiums
    # ("HEPİYİ SİGORTA"), so it maps to the safer of the two. Real BES payments are
    # claimed earlier by _cc_classify's "G.E. <sözleşme no>" rule.
    "EMEKLILIKSIGORTA": "insurance",           # Emeklilik / Sigorta
}


def _etiket_key(etiket: str) -> str:
    """Diacritic/spacing-insensitive lookup key for an Etiket tag."""
    return re.sub(r"[^A-Z0-9]", "", _fold(etiket))


# Runtime Etiket→category_key map loaded from the DB (Configuration → Statement
# Value Mapping). None until load_etiket_map() runs; the hardcoded _ETIKET_CATEGORY
# above is the bootstrap fallback used when no DB session is available (e.g. tests).
_ETIKET_RUNTIME: Optional[dict] = None


def load_etiket_map(db) -> None:
    """Refresh the runtime Etiket→category map from the statement_mappings table.
    Once loaded, the DB is authoritative (deletions take effect); on any failure we
    keep the previous map / hardcoded fallback so imports never break."""
    global _ETIKET_RUNTIME
    try:
        from app.models import StatementMapping
        m: dict[str, str] = {}
        for row in db.query(StatementMapping).all():
            if row.etiket and row.category_key:
                m[_etiket_key(row.etiket)] = row.category_key
        _ETIKET_RUNTIME = m
    except Exception:
        pass  # keep whatever we had; _etiket_category falls back to _ETIKET_CATEGORY


def _etiket_category(etiket: str) -> Optional[str]:
    """Map a Garanti Etiket tag to a category_key (diacritic/spacing-insensitive).
    Prefers the DB-loaded map when present, else the hardcoded defaults."""
    if not etiket:
        return None
    table = _ETIKET_RUNTIME if _ETIKET_RUNTIME is not None else _ETIKET_CATEGORY
    return table.get(_etiket_key(etiket))


def _normalize_row(date: str, description: str, amount: float, balance=None, raw=None,
                   currency="TRY", etiket=None, source=None, account_type=None) -> dict:
    type_override, category_override = _cc_classify(description)
    # Garanti's "Etiket" column is a structured category tag — trust it when the
    # description-based rules above didn't already classify the row. Only sets the
    # category; direction (income/expense) still follows the amount's sign.
    if category_override is None:
        category_override = _etiket_category(etiket)
    # BANK-ACCOUNT statements only: a "Diğer"/"Other" line item is a miscellaneous
    # transfer → Transfer (category wire-transfer). Scoped to account_type == "bank"
    # because on CARD statements "Diğer" is a legitimate spending tag (tolls, etc.).
    if category_override is None and account_type == "bank" and _DIGER_RE.search(_fold(description)):
        category_override = "wire-transfer"
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

    for raw in text.splitlines():
        line = _WATERMARK_RE.sub(" ", raw).strip()
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
        rows.append(_normalize_row(date, desc, signed, currency="TRY", source=card))

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

    file_currency = "TRY"

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
                header_idx = date_i = amount_i = None
                desc_i = etiket_i = None
                for i, r in enumerate(table):
                    di = _match_idx(r, GARANTI_DATE_COLS)
                    ai = _match_idx(r, GARANTI_AMOUNT_COLS)
                    if di is not None and ai is not None:
                        header_idx = i
                        date_i, amount_i = di, ai
                        desc_i = _match_idx(r, GARANTI_DESC_COLS)
                        etiket_i = _match_idx(r, GARANTI_ETIKET_COLS)
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
                    rows.append(_normalize_row(
                        date, desc, amount, currency=currency, etiket=etiket,
                        source=iban or account_no, account_type="bank",
                    ))

    accounts: list[dict] = []
    if account_no or iban:
        accounts.append({
            "source": iban or account_no, "type": "bank", "number": account_no,
            "card_number": None, "iban": iban, "branch": branch, "holder": holder,
            "currency": file_currency, "institution": "garanti",
        })
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
            "currency": currency, "institution": "burgan",
        })
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


def _midas_asset_type(ticker: str, name: str) -> str:
    """Sembol/isimden varlık türü tahmini (kullanıcı review'da değiştirebilir)."""
    t = (ticker or "").upper()
    n = _fold(name)
    if "ALTIN" in t or "ALTIN" in n or "GUMUS" in n:
        return "gold"
    if t.endswith(".F") or "PORTFOY" in n or "FON" in n:
        return "fund"
    return "stock"


def _midas_summary(text: str) -> dict:
    """Ekstre başlığından nakit bakiye / toplam portföy değeri / dönem çıkarır."""
    out = {"cash": None, "total": None, "period_from": None, "period_to": None}
    m = re.search(r"Nakit Bakiye\s*:\s*([\d.,]+)", text)
    if m:
        out["cash"] = _parse_amount(m.group(1))
    m = re.search(r"Toplam Portföy Değeri\s*:\s*([\d.,]+)", text)
    if m:
        out["total"] = _parse_amount(m.group(1))
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
                    qty = _midas_num(cells[1]) if len(cells) > 1 else None
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
        if not rows:
            rows = _parse_pdf(content)
            bank_detected = bank_hint if bank_hint != "auto" else "pdf"
    else:
        # Önce Garanti çok-bölümlü export imzasını dene (ham ızgara üzerinden).
        # Bu format gecikmiş başlık + birden fazla kart bölümü içerdiğinden
        # standart tek-başlık DataFrame yolu onu okuyamaz.
        grid = _load_raw_grid(content, ext) if bank_hint in ("auto", "garanti") else None
        rows, accounts = _parse_garanti_export(grid) if (grid and _is_garanti_export(grid)) else ([], [])

        if rows:
            bank_detected = "garanti"
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
    skip_duplicates=True ise aynı tarih+tutar+açıklama olan kayıtları atlar.

    credit_payment_id / default_payment_method / default_category_key:
    when importing a credit-card statement, tag every created spending with the
    statement record and the card, falling back to the per-row values when present.

    source_filename: the original uploaded statement's filename, stamped onto every
    row it creates so the UI can show provenance (e.g. Account Activity's detail modal).
    """
    from datetime import date as date_type
    from app.models import Transaction as Tx, TransactionType, Currency
    from app.routers.transactions import _apply_rates

    imported = 0
    skipped = 0
    errors = []

    for row in rows:
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

            if skip_duplicates:
                exists = db.query(Tx).filter(
                    Tx.owner_id == owner_id,
                    Tx.date == tx_date,
                    Tx.amount == amount,
                    Tx.type == tx_type,
                ).first()
                if exists:
                    skipped += 1
                    continue

            tx = Tx(
                owner_id=owner_id,
                type=tx_type,
                amount=amount,
                currency=currency,
                description=desc,
                date=tx_date,
                category_key=cat_override or row.get("category_key") or default_category_key,
                payment_method=row.get("payment_method") or default_payment_method,
                payer=row.get("payer"),
                paying_for=row.get("paying_for"),
                credit_payment_id=credit_payment_id,
                source_filename=source_filename,
                note="banka_import",
            )
            _apply_rates(tx, db)
            db.add(tx)
            imported += 1

        except Exception as e:
            errors.append(f"Satır atlandı: {row.get('date')} — {e}")

    db.commit()
    return {
        "imported": imported,
        "skipped": skipped,
        "errors": errors,
    }


def import_investments(
    db: Session,
    owner_id: int,
    holdings: list[dict],
    upsert: bool = True,
    note: str = "midas_import",
    replace: bool = False,
) -> dict:
    """
    Parse edilmiş Midas portföy satırlarını Investment tablosuna yazar.

    upsert=True ise aynı platform + sembol (name'in başındaki ticker) olan kayıt
    güncellenir (adet + maliyet), yoksa yeni oluşturulur. Böylece ekstre yeniden
    içe aktarıldığında portföy çift kayıt üretmez.

    replace=True ise, bu platformun listede OLMAYAN kayıtları silinir. BES fon
    dağılımı eksiksiz bir anlık görüntüdür: bir sonraki ekstrede kaldırılan bir fon
    ortalıkta kalırsa fonların toplamı hesap bakiyesini tutmaz. Midas yolu bunu
    kullanmaz (varsayılan False) — orada ekstre tüm portföyü içermeyebilir.
    """
    from app.models import Investment as Inv

    created = 0
    updated = 0
    removed = 0
    errors = []
    seen: dict[str, set] = {}

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
                updated += 1
            else:
                db.add(Inv(
                    owner_id=owner_id,
                    name=name,
                    platform=platform,
                    asset_type=asset_type,
                    currency=currency,
                    amount=amount,
                    purchase_price=price,
                    note=note,
                ))
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
                    db.delete(stale)
                    removed += 1

    db.commit()
    return {"created": created, "updated": updated, "removed": removed, "errors": errors}


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
    ile yazılır, çünkü fon dağılımı eksiksiz bir anlık görüntüdür.
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
        db, owner_id, inv_rows, upsert=True, note="bes_import", replace=True
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
