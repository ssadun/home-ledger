"""Golden fixtures for the bank-statement importer.

One sample per format in the CLAUDE.md registry. These lock in the values a
real statement currently produces — row counts, totals, account identity, and
the classification rules that are easy to break silently (Turkish amount
parsing, Etiket→category precedence, virman/Diğer handling, description casing).

Run them inside the backend image (pdfplumber/pandas live there):

    docker run --rm --network nas \
      -v /volume1/docker/resolv.conf:/etc/resolv.conf:ro \
      -v "$PWD":/src -w /src home-ledger-backend:latest \
      sh -c "pip install -q -r requirements-dev.txt && python -m pytest backend/tests"
"""
import pytest

GARANTI_CC = "26.01-BonusCardEkstre.pdf"
ON_BURGAN = "on-Hesap Hareketleri-tl.pdf"
MIDAS = "Midas_Ekstre_Mayıs_2026.pdf"
GARANTI_TL = "garanti-tl-hesaphareketleri.pdf"
GARANTI_USD = "garanti-usd-hesaphareketleri.pdf"


def find_row(rows, needle):
    """First row whose description contains `needle` (fails loudly if absent)."""
    for row in rows:
        if needle in (row.get("description") or ""):
            return row
    raise AssertionError(f"no row matching {needle!r} in {len(rows)} rows")


# --------------------------------------------------------------------------
# Garanti credit-card statement (full ekstre) — _parse_garanti_cc_pdf
# --------------------------------------------------------------------------

class TestGarantiCreditCard:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(GARANTI_CC)

    def test_totals(self, res):
        assert res["bank_detected"] == "garanti (kredi kartı PDF)"
        assert res["total_rows"] == 114
        assert len(res["rows"]) == 114
        assert res["income_total"] == pytest.approx(41423.37)
        assert res["expense_total"] == pytest.approx(137609.04)
        assert res["date_range"] == {"from": "2025-12-26", "to": "2026-01-25"}

    def test_card_identity(self, res):
        assert len(res["accounts"]) == 1
        acc = res["accounts"][0]
        assert acc["type"] == "credit"
        assert acc["number"] == "4870 75** **** 1011"
        assert acc["card_number"] == acc["number"]
        assert acc["iban"] is None
        assert acc["holder"] == "SADUN SEVİNGEN"
        assert acc["currency"] == "TRY"
        assert acc["institution"] == "garanti"

    def test_creates_a_credit_payment(self, res):
        """A billed ekstre carries the cycle figures and is NOT interim."""
        acc = res["accounts"][0]
        assert acc["payment_due"] == "2026-02-05"
        assert acc["total"] == pytest.approx(178313.25)
        assert not acc.get("interim")

    def test_payment_line_is_income(self, res):
        row = find_row(res["rows"], "ÖDEMENİZ İÇİN TEŞEKKÜR")
        assert row["type"] == "income"
        assert row["category_key"] == "credit-card-payment"
        assert row["amount"] == pytest.approx(31664.0)

    def test_pension_contribution_tagged_retirement(self, res):
        """`G.E. <contract no>` beats the Emeklilik/Sigorta Etiket → insurance."""
        row = find_row(res["rows"], "G.E. 0000017943452")
        assert row["category_key"] == "retirement"
        assert row["type"] == "expense"
        assert row["amount"] == pytest.approx(7020.0)

    def test_description_casing_is_preserved(self, res):
        assert find_row(res["rows"], "Microsoft*Xbox Game Pa")["description"] == (
            "Microsoft*Xbox Game Pa"
        )

    def test_every_row_is_tagged_with_the_card(self, res):
        assert {r["source"] for r in res["rows"]} == {"4870 75** **** 1011"}
        assert {r["currency"] for r in res["rows"]} == {"TRY"}


# --------------------------------------------------------------------------
# ON / Burgan checking account — _parse_on_burgan_pdf (+ _parse_on_amount)
# --------------------------------------------------------------------------

class TestOnBurganAccount:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(ON_BURGAN)

    def test_totals(self, res):
        assert res["bank_detected"] == "on_burgan (hesap hareketleri PDF)"
        assert res["total_rows"] == 44
        assert res["income_total"] == pytest.approx(1574116.07)
        assert res["expense_total"] == pytest.approx(1574116.07)
        assert res["date_range"] == {"from": "2026-06-02", "to": "2026-07-02"}

    def test_account_identity(self, res):
        assert len(res["accounts"]) == 1
        acc = res["accounts"][0]
        assert acc["type"] == "bank"
        assert acc["iban"] == "TR810012502002025673300377"
        # derived from the IBAN's last 6 digits — the statement prints no acct no
        assert acc["number"] == "300377"
        assert acc["holder"] == "SADUN SEVİNGEN"
        assert acc["currency"] == "TRY"
        assert acc["institution"] == "burgan"

    def test_three_decimal_amounts(self, res):
        """`-160.643,550` is 160643.55, not 160643550."""
        row = res["rows"][0]
        assert row["date"] == "2026-07-02"
        assert row["amount"] == pytest.approx(160643.55)
        assert row["type"] == "expense"
        assert row["balance"] == pytest.approx(185643.55)

    def test_comma_ddd_is_a_decimal_not_a_thousands_separator(self, res):
        """`1,000` is 1.0 here — the shared _parse_amount would read 1000.0."""
        row = find_row(res["rows"], "1tl aktivasyon")
        assert row["amount"] == pytest.approx(1.0)
        assert row["type"] == "expense"

    def test_virman_is_a_transfer_in_both_directions(self, res):
        virman = [r for r in res["rows"] if "Virman" in r["description"]]
        assert len(virman) == 33
        assert {r["category_key"] for r in virman} == {"wire-transfer"}
        assert {r["type"] for r in virman} == {"income", "expense"}

    def test_diger_on_a_bank_statement_is_a_transfer(self, res):
        row = find_row(res["rows"], "SN:29823351")
        assert row["category_key"] == "wire-transfer"
        assert row["type"] == "expense"
        assert row["amount"] == pytest.approx(2000.0)

    def test_running_balance_is_captured(self, res):
        assert all(r["balance"] is not None for r in res["rows"])


# --------------------------------------------------------------------------
# Midas portfolio → investments, not transactions — _parse_midas_holdings
# --------------------------------------------------------------------------

class TestMidasPortfolio:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(MIDAS)

    def test_kind_is_investments(self, res):
        assert res["kind"] == "investments"
        assert res["bank_detected"] == "Midas (portföy)"
        assert res["rows"] == []
        assert res["accounts"] == []
        assert res["total_rows"] == 3

    def test_portfolio_summary(self, res):
        assert res["portfolio"] == {
            "cash": pytest.approx(9291.31),
            "total": pytest.approx(32844.34),
            "period_from": "01/05/26",
            "period_to": "31/05/26",
        }

    def test_holdings(self, res):
        by_ticker = {h["ticker"]: h for h in res["investments"]}
        assert set(by_ticker) == {"ALTIN.S1", "GMSTR.F", "VPS"}

        gold = by_ticker["ALTIN.S1"]
        assert gold["asset_type"] == "gold"
        assert gold["platform"] == "Midas"
        assert gold["currency"] == "TRY"
        assert gold["amount"] == pytest.approx(97.0)
        assert gold["purchase_price"] == pytest.approx(80.83)
        assert gold["current_value"] == pytest.approx(7795.89)

        assert by_ticker["GMSTR.F"]["asset_type"] == "fund"
        assert by_ticker["GMSTR.F"]["current_value"] == pytest.approx(9901.5)
        assert by_ticker["VPS"]["asset_type"] == "fund"
        assert by_ticker["VPS"]["amount"] == pytest.approx(4328.0)


# --------------------------------------------------------------------------
# Garanti checking account, TL — _parse_garanti_hesap_pdf (+ Etiket map)
# --------------------------------------------------------------------------

class TestGarantiAccountTRY:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(GARANTI_TL)

    def test_totals(self, res):
        assert res["bank_detected"] == "garanti (hesap hareketleri PDF)"
        assert res["total_rows"] == 14
        assert res["income_total"] == pytest.approx(384092.14)
        assert res["expense_total"] == pytest.approx(385273.09)
        assert res["date_range"] == {"from": "2026-06-04", "to": "2026-07-01"}

    def test_account_identity(self, res):
        acc = res["accounts"][0]
        assert acc["type"] == "bank"
        assert acc["iban"] == "TR190006200044000006659945"
        assert acc["number"] == "6659945"
        assert acc["branch"] == "İÇERENKÖY"
        assert acc["currency"] == "TRY"
        assert acc["institution"] == "garanti"

    @pytest.mark.parametrize("needle,etiket,category_key", [
        ("MICRO FOCUS TEKNOLOJI COZUMLERI- AXTRL00030001307", "Para Transferi", "wire-transfer"),
        ("K.Kartı Ödeme", "Kart Ödemesi", "credit-card-payment"),
        ("ÖD.EMR 2026 AYLIK TEDBIR", "Faiz / Komisyon", "interest"),
        ("KREDİLİ HESAP FAİZ TAHSİLATI", "Faiz / Komisyon", "interest"),
    ])
    def test_etiket_drives_category(self, res, needle, etiket, category_key):
        row = find_row(res["rows"], needle)
        assert row["etiket"] == etiket
        assert row["category_key"] == category_key

    def test_para_cekme_is_intentionally_unmapped(self, res):
        row = find_row(res["rows"], "ATM PARA ÇEKME")
        assert row["etiket"] == "Para Çekme"
        assert row["category_key"] is None
        assert row["type"] == "expense"

    def test_direction_still_follows_the_sign(self, res):
        """Same Etiket, opposite signs — the map must not fix the direction."""
        incoming = find_row(res["rows"], "SADUN SEVİNGEN-DIGER-0000350")
        outgoing = find_row(res["rows"], "SADUN SEVİNGEN--HVL-CEP ŞUBE")
        assert incoming["etiket"] == outgoing["etiket"] == "Para Transferi"
        assert incoming["type"] == "income"
        assert outgoing["type"] == "expense"

    def test_description_casing_is_preserved(self, res):
        assert find_row(res["rows"], "EFT-CEP ŞUBE")["description"] == (
            "Sadun Sevıngen--EFT-CEP ŞUBE-2300098"
        )
        assert find_row(res["rows"], "K.Kartı Ödeme")["description"] == (
            "K.Kartı Ödeme 4870 **** **** 1011"
        )


# --------------------------------------------------------------------------
# Garanti checking account, USD — same parser, foreign currency
# --------------------------------------------------------------------------

class TestGarantiAccountUSD:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(GARANTI_USD)

    def test_totals(self, res):
        assert res["bank_detected"] == "garanti (hesap hareketleri PDF)"
        assert res["total_rows"] == 2
        assert res["income_total"] == pytest.approx(3850.5)
        assert res["expense_total"] == pytest.approx(3850.5)
        assert res["date_range"] == {"from": "2026-06-25", "to": "2026-06-25"}

    def test_currency_is_usd_not_try(self, res):
        assert res["accounts"][0]["currency"] == "USD"
        assert {r["currency"] for r in res["rows"]} == {"USD"}

    def test_account_identity(self, res):
        acc = res["accounts"][0]
        assert acc["type"] == "bank"
        assert acc["iban"] == "TR650006200044000009059576"
        assert acc["number"] == "9059576"
        assert acc["institution"] == "garanti"

    def test_salary_etiket(self, res):
        row = find_row(res["rows"], "HAZİRAN AYI MAAŞ ÖDEMESİ")
        assert row["etiket"] == "Maaş"
        assert row["category_key"] == "salary"
        assert row["type"] == "income"
        assert row["amount"] == pytest.approx(3850.5)
