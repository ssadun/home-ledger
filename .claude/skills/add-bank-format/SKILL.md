---
name: add-bank-format
description: Scaffold a new bank/card statement parser in backend/app/services/bank_import.py, following the project's documented 5-step recipe (detector → parser → dispatch wiring → account-identity emission → CLAUDE.md registry update). Use when the user wants to add support for a new bank export, a new PDF statement layout, or a new spreadsheet/CSV format for the importer.
---

# Add Bank Format

Scaffolds a new statement parser for `backend/app/services/bank_import.py`, matching the exact
recipe already documented in `CLAUDE.md` under **"Adding a new statement format"**. That section
is the source of truth — re-read it before starting in case it has changed.

**This skill writes code.** Confirm the target bank/format name and statement type (PDF vs
spreadsheet/CSV, bank account vs credit card vs investment) with the user before generating files
if it isn't already clear from the request.

## Before you start

1. Read `CLAUDE.md`'s "Supported Bank Import Formats" section — it lists every existing detector,
   parser, and their dispatch order. Do not duplicate an existing format.
2. Ask the user (or infer from a sample statement/screenshot if provided) for:
   - Bank/product name (e.g. `akbank`, `isbank`)
   - File type: PDF (free text vs real table) or spreadsheet/CSV
   - Statement kind: bank account (`type: "bank"`), credit card (`type: "credit"`), or investment
     (`kind: "investments"`, like the Midas path)
   - A unique text signature to detect it (e.g. a header phrase, bank name string)
   - Date format and amount format (Turkish `1.234,56` 2-decimal is the default via
     `_parse_amount`; 3-decimal statements need a dedicated parser like `_parse_on_amount`)

## Step 1 — Detector

Add `_is_<name>_pdf(text: str) -> bool` (or a grid/column-signature check for spreadsheets) near
the other detectors in `bank_import.py`. **Make it specific enough not to shadow another bank** —
e.g. `HESAP HAREKETLERI` alone is ambiguous; Garanti's detector also requires `GARANTIBBVA`.
Match on `_fold(text)` output so diacritics/casing don't matter:

```python
def _is_<name>_pdf(text: str) -> bool:
    """<Bank> <statement kind> ekstresi mi? (diakritikten bağımsız)."""
    return "<UNIQUE SIGNATURE>" in _fold(text)
```

## Step 2 — Parser

Add `_parse_<name>_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]` returning
`(rows, accounts)`. Reuse existing helpers — don't reinvent them:

- `_parse_turkish_date()` for dates
- `_parse_amount()` for standard 2-decimal Turkish amounts, or write a dedicated variant if the
  statement uses 3-decimal grouping (see `_parse_on_amount` for the ON/Burgan precedent)
- `_fold()` for diacritic-insensitive matching
- `_normalize_row(..., account_type=...)` to apply the shared classification rules (virman →
  `wire-transfer`, `KESİNTİ VE EKLERİ` → `commission`, bank-only "diğer" → `wire-transfer`,
  Etiket map lookup via `_etiket_category()`)
- **Never Title/upper/lower-case the transaction description** — preserve the bank's original
  text verbatim (see the casing rule in CLAUDE.md).
- For real tables (not free text), use `pdfplumber.open(io.BytesIO(content)).pages[i].extract_tables()`
  like `_parse_garanti_donemici_pdf` does; for free-text statements, regex over `text` like
  `_parse_garanti_cc_pdf` does.

```python
def _parse_<name>_pdf(content: bytes, text: str) -> tuple[list[dict], list[dict]]:
    """<Bank> <statement kind> PDF'ini işlem satırları + hesap/kart kimliğine çevirir."""
    rows: list[dict] = []
    accounts: list[dict] = []

    # TODO: extract account/card identity (IBAN, card number, holder name)

    # TODO: extract + normalize transaction rows

    return rows, accounts
```

## Step 3 — Wire into dispatch

In `parse_bank_file()`'s PDF branch, add the new format **in priority order** — after any format
whose signature could be a false-positive superset, before any generic fallback:

```python
if not rows and text and _is_<name>_pdf(text):
    rows, accounts = _parse_<name>_pdf(content, text)
    bank_detected = "<name> (<statement kind> PDF)"
```

For spreadsheet/CSV formats, add a branch to the column-signature `if/elif` chain instead (see
the `garanti`/`on_burgan` auto-detect block for the pattern).

## Step 4 — Account-identity emission

Every row of `accounts` must carry enough identity for the frontend to match/create the right
account: IBAN + branch/account-no for banks, masked card number for cards. Set `"interim": true`
if this is a non-billed/in-period dump (like Garanti Dönemiçi) so the frontend skips Credit
Payment creation for it.

## Step 5 — Update the registry (same commit)

Add a row to the appropriate table in `CLAUDE.md` under **"Supported Bank Import Formats"**
(PDF parsers table or spreadsheet/CSV table) — dispatch position, detector, signature, layout,
date format, amount format, and quirks. This table is documented as the project's living format
catalogue; an undocumented parser is considered incomplete.

Then run `graphify update .` so the knowledge graph reflects the new symbols.

## After scaffolding

Tell the user to:
1. Fill in the extraction logic against a real (anonymized) sample statement.
2. Add a manual test import via the `/api/import/preview` endpoint before wiring `/confirm`.
3. Consider asking the `bank-import-reviewer` subagent (if installed) to check the new parser
   against the casing/virman/commission/Etiket rules.
