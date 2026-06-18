"""
Fiş / fatura OCR servisi.
Tesseract (ücretsiz, offline) kullanır — Türkçe dil paketi gerekli.
"""
import re
import os
from pathlib import Path
from PIL import Image
import pytesseract


UPLOAD_DIR = Path("uploads")
UPLOAD_DIR.mkdir(exist_ok=True)


def extract_text_from_image(image_path: str) -> str:
    """Resimden ham metin çıkar (TR + EN)."""
    img = Image.open(image_path)
    # Preprocessing: grayscale + slight contrast boost
    img = img.convert("L")
    text = pytesseract.image_to_string(img, lang="tur+eng")
    return text


def parse_receipt(text: str) -> dict:
    """
    Ham OCR metninden fatura bilgilerini çıkarmaya çalışır.
    Dönen dict: { amount, date, merchant, currency, raw }
    """
    result = {"raw": text, "amount": None, "date": None, "merchant": None, "currency": "TRY"}

    # Amount patterns (Turkish receipts: 1.234,56 or 1234.56 or 1234,56)
    amount_patterns = [
        r"TOPLAM[:\s]*([0-9.,]+)",
        r"TUTAR[:\s]*([0-9.,]+)",
        r"ÖDENECEK[:\s]*([0-9.,]+)",
        r"TOTAL[:\s]*([0-9.,]+)",
        r"\*\s*([0-9]{1,6}[.,][0-9]{2})\s*(?:TL|₺)?",
    ]
    for pattern in amount_patterns:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            raw_amount = match.group(1).replace(".", "").replace(",", ".")
            try:
                result["amount"] = float(raw_amount)
                break
            except ValueError:
                continue

    # Date patterns
    date_patterns = [
        r"(\d{2})[./\-](\d{2})[./\-](\d{4})",
        r"(\d{4})[./\-](\d{2})[./\-](\d{2})",
    ]
    for pattern in date_patterns:
        match = re.search(pattern, text)
        if match:
            result["date"] = match.group(0)
            break

    # Currency detection
    if re.search(r"\$|USD|DOLAR", text, re.IGNORECASE):
        result["currency"] = "USD"
    elif re.search(r"€|EUR|EURO", text, re.IGNORECASE):
        result["currency"] = "EUR"

    # Merchant: first non-empty line often contains merchant name
    lines = [l.strip() for l in text.splitlines() if l.strip()]
    if lines:
        result["merchant"] = lines[0][:60]

    return result


def save_upload(file_bytes: bytes, filename: str) -> str:
    path = UPLOAD_DIR / filename
    with open(path, "wb") as f:
        f.write(file_bytes)
    return str(path)
