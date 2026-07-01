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
    """
    # Strip everything but letters/digits so interleaved spaces or stray
    # watermark punctuation ("TE ŞE-KKÜR") can't break the keyword match.
    f = re.sub(r"[^A-Z0-9]", "", _fold(description))
    if "TESEKKUR" in f:
        return "income", "credit-card-payment"
    if "DEVIR" in f:
        return "expense", "debt"
    return None, None


def _normalize_row(date: str, description: str, amount: float, balance=None, raw=None,
                   currency="TRY", etiket=None, source=None) -> dict:
    type_override, category_override = _cc_classify(description)
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
                _acc(current_source)["iban"] = val
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
        ))

    # Ad Soyad bölüm başlığından sonra görüldüyse, kimliği olmayan kayıtlara da uygula.
    for rec in accounts.values():
        if rec["holder"] is None:
            rec["holder"] = holder

    return rows, list(accounts.values())


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


def parse_bank_file(content: bytes, filename: str, bank_hint: str = "auto") -> dict:
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

    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    errors = []
    rows = []

    accounts: list[dict] = []      # algılanan hesap/kart kimlikleri (Garanti export yolu)

    if ext == "pdf":
        # Önce metni çıkar: Garanti kredi kartı ekstresi serbest metin formatındadır
        # (tablo yok), bu yüzden tablo tabanlı _parse_pdf onu okuyamaz.
        text = _extract_pdf_text(content)
        if text and _is_garanti_cc_pdf(text):
            rows, accounts = _parse_garanti_cc_pdf(text)
            bank_detected = "garanti (kredi kartı PDF)"
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
) -> dict:
    """
    Parse edilmiş satırları Transaction tablosuna yazar.
    skip_duplicates=True ise aynı tarih+tutar+açıklama olan kayıtları atlar.

    credit_payment_id / default_payment_method / default_category_key:
    when importing a credit-card statement, tag every created spending with the
    statement record and the card, falling back to the per-row values when present.
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
