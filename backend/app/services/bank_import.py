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

def _parse_turkish_date(value: str) -> Optional[str]:
    """
    Türk bankalarında yaygın tarih formatlarını YYYY-MM-DD'ye çevirir.
    Örnekler: 15.03.2024  /  15/03/2024  /  2024-03-15  /  15-03-2024
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
    # Türkçe format: nokta binlik ayırıcı, virgül ondalık
    if re.search(r"\d\.\d{3},", s) or (s.count(",") == 1 and s.count(".") > 0 and s.index(",") > s.rindex(".")):
        s = s.replace(".", "").replace(",", ".")
    else:
        # İngilizce format veya sadece virgül
        s = s.replace(",", "")
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


def _normalize_row(date: str, description: str, amount: float, balance=None, raw=None, currency="TRY") -> dict:
    return {
        "date": date,
        "description": (description or "").strip()[:200],
        "amount": round(abs(amount), 2),
        "type": "income" if amount > 0 else "expense",
        "currency": currency,
        "balance": balance,
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

    if ext == "pdf":
        rows = _parse_pdf(content)
        bank_detected = bank_hint if bank_hint != "auto" else "pdf"
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
        "errors": errors,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Veritabanına kayıt
# ─────────────────────────────────────────────────────────────────────────────

def import_transactions(db: Session, owner_id: int, rows: list[dict], skip_duplicates: bool = True) -> dict:
    """
    Parse edilmiş satırları Transaction tablosuna yazar.
    skip_duplicates=True ise aynı tarih+tutar+açıklama olan kayıtları atlar.
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
            # type may be explicit (from the review wizard) or derived from the sign
            # of the parsed amount (positive = income, negative = expense).
            row_type = row.get("type") or ("income" if raw_amount >= 0 else "expense")
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
                category_key=row.get("category_key"),
                payment_method=row.get("payment_method"),
                payer=row.get("payer"),
                paying_for=row.get("paying_for"),
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
