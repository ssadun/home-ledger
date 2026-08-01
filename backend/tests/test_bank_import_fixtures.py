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
GARANTI_CC_MONTHS = {
    "26.01-BonusCardEkstre.pdf": (114, 41423.37, 137609.04),
    "26.02-BonusCardEkstre.pdf": (73, 77643.41, 119696.32),
    "26.03-BonusCardEkstre.pdf": (53, 156104.99, 61240.01),
    "26.04-BonusCardEkstre.pdf": (100, 53948.50, 108639.06),
    "26.05-BonusCardEkstre.pdf": (82, 106512.18, 100530.90),
    "26.06-BonusCardEkstre.pdf": (107, 249396.93, 233352.38),
}
GARANTI_DONEMICI = "26.07-Donemici Islemler - TL.pdf"
GARANTI_DONEMICI_BONUS = "garanti-bonus-Donemici Islemler - TL.pdf"
ON_BURGAN = "on-Hesap Hareketleri-tl.pdf"
ON_BURGAN_FULL = "ON TL Hesap Hareketleri.pdf"
MIDAS = "Midas_Ekstre_Mayıs_2026.pdf"
MIDAS_JULY = "Midas_Ekstre_Temmuz_2026.pdf"
GARANTI_TL = "garanti-tl-hesaphareketleri.pdf"
GARANTI_USD = "garanti-usd-hesaphareketleri.pdf"
QNB_KAZANDIRAN = "qnb_kazandiran_hesap_hareketleri.pdf"
ODEA_PDF = "odeabank-usd vadeli.pdf"
ODEA_XLSX = "odebank Hesap Hareketleri Tablo usd vadeli.xlsx"


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

    @pytest.mark.parametrize("needle,etiket,category_key", [
        ("DM PETROL", "Akaryakıt", "transport"),
        ("SBX İST ALLIANZ", "Cafe & Restaurant", "dining"),
        ("PARIBUCINEVERSE", "DİĞER HARCAMALARINIZ", "entertainment"),
        ("PASSO", "Eğlence", "entertainment"),
    ])
    def test_section_tag_and_description_mapping(self, res, needle, etiket, category_key):
        row = find_row(res["rows"], needle)
        assert row["etiket"] == etiket
        assert row["category_key"] == category_key

    def test_description_keyword_can_classify_before_card_default(self, res):
        row = find_row(res["rows"], "ARÇELİK PAZA")
        assert row["category_key"] == "shopping"


@pytest.mark.parametrize("filename,expected", GARANTI_CC_MONTHS.items())
def test_all_bonus_statement_totals_remain_golden(parse_sample, filename, expected):
    rows, income, expense = expected
    result = parse_sample(filename)
    assert result["total_rows"] == rows
    assert result["income_total"] == pytest.approx(income)
    assert result["expense_total"] == pytest.approx(expense)


@pytest.mark.parametrize("filename,rows,income,expense", [
    (GARANTI_DONEMICI, 49, 173483.36, 114855.15),
    (GARANTI_DONEMICI_BONUS, 30, 0.0, 71571.59),
])
def test_all_bonus_interim_totals_remain_golden(parse_sample, filename, rows, income, expense):
    result = parse_sample(filename)
    assert result["total_rows"] == rows
    assert result["income_total"] == pytest.approx(income)
    assert result["expense_total"] == pytest.approx(expense)


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


class TestOnBurganFullAccount:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(ON_BURGAN_FULL)

    def test_header_balance_is_account_closing_balance(self, res):
        assert res["bank_detected"] == "on_burgan (hesap hareketleri PDF)"
        acc = res["accounts"][0]
        assert acc["iban"] == "TR810012502002025673300377"
        assert acc["number"] == "300377"
        assert acc["currency"] == "TRY"
        assert acc["balance"] == pytest.approx(9623.39)

    def test_totals_and_range(self, res):
        assert res["total_rows"] == 522
        assert res["income_total"] == pytest.approx(12367087.73)
        assert res["expense_total"] == pytest.approx(12369964.34)
        assert res["date_range"] == {"from": "2025-06-30", "to": "2026-07-09"}


class TestStatementMappingFallback:
    def test_comma_separated_mapping_tags_are_alternates(self):
        from app.services import bank_import

        assert bank_import._etiket_keys("Market, Yeme / İçme,  EFT ") == [
            "market",
            "yemeicme",
            "eft",
        ]

    @pytest.mark.parametrize("value", ["I", "İ", "ı", "i"])
    def test_all_turkish_i_forms_share_one_lowercase_key(self, value):
        from app.services import bank_import

        assert bank_import._etiket_key(value) == "i"

    @pytest.mark.parametrize("value,expected", [
        ("Eğlence / Hobi", "eglencehobi"),
        ("SAĞLIK / BAKIM", "saglikbakim"),
        ("Kişisel Hizmet", "kisiselhizmet"),
        ("DİĞER HARCAMALARINIZ", "digerharcamalariniz"),
    ])
    def test_mapping_keys_are_turkish_safe_lowercase(self, value, expected):
        from app.services import bank_import

        assert bank_import._etiket_key(value) == expected

    def test_structured_etiket_wins_over_description(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", {
            "MARKET": "groceries",
            "PARACEKME": "withdrawal",
        })

        row = bank_import._normalize_row(
            "2026-07-26",
            "ATM PARA ÇEKME",
            -100,
            etiket="Market",
            account_type="bank",
        )

        assert row["category_key"] == "groceries"

    def test_description_is_used_when_etiket_is_missing(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [{
            "key": "paracekme", "words": "para cekme",
            "category_key": "withdrawal", "match_scope": "both",
            "priority": 100, "mapping_id": 1,
        }])

        row = bank_import._normalize_row(
            "2026-07-26",
            "ATM PARA ÇEKME SN:12345",
            -100,
            account_type="bank",
        )

        assert row["etiket"] is None
        assert row["category_key"] == "withdrawal"

    def test_description_is_used_when_etiket_has_no_exact_mapping(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [
            {"key": "paribucineverse", "category_key": "entertainment",
             "match_scope": "description", "priority": 200, "mapping_id": 1},
        ])
        row = bank_import._normalize_row(
            "2026-07-26", "IYZICO/PARIBUCINEVERSE.", -100,
            etiket="Diğer", account_type="credit",
        )
        assert row["category_key"] == "entertainment"

    def test_higher_priority_description_overrides_broad_etiket(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [
            {"key": "caferestaurant", "category_key": "dining",
             "match_scope": "both", "priority": 100, "mapping_id": 1},
            {"key": "sbx", "category_key": "coffee",
             "match_scope": "description", "priority": 200, "mapping_id": 2},
        ])
        assert bank_import._statement_mapping_category(
            etiket="Cafe & Restaurant", description="SBX İST ALLIANZ TOWER"
        ) == "coffee"

    def test_higher_priority_etiket_still_wins_over_description(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [
            {"key": "caferestaurant", "category_key": "dining",
             "match_scope": "both", "priority": 100, "mapping_id": 1},
            {"key": "sbx", "category_key": "coffee",
             "match_scope": "description", "priority": 50, "mapping_id": 2},
        ])
        assert bank_import._statement_mapping_category(
            etiket="Cafe & Restaurant", description="SBX İST ALLIANZ TOWER"
        ) == "dining"

    def test_priority_then_longest_keyword_is_deterministic(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [
            {"key": "passo", "category_key": "entertainment",
             "match_scope": "description", "priority": 200, "mapping_id": 2},
            {"key": "kolaypasso", "category_key": "shopping",
             "match_scope": "description", "priority": 200, "mapping_id": 3},
            {"key": "paynkolay", "category_key": "dining",
             "match_scope": "description", "priority": 100, "mapping_id": 1},
        ])
        assert bank_import._statement_mapping_category(
            description="PAYNKOLAY/PASSO ETKINLIK"
        ) == "entertainment"

    def test_short_keyword_requires_token_boundary(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [
            {"key": "sbx", "category_key": "dining",
             "match_scope": "description", "priority": 200, "mapping_id": 1},
        ])
        assert bank_import._statement_mapping_category(description="MOBİL:SBX İST") == "dining"
        assert bank_import._statement_mapping_category(description="ASBXSHOP") is None

    @pytest.mark.parametrize("account_type", ["credit", "debit"])
    def test_unmatched_card_expense_defaults_to_shopping(self, monkeypatch, account_type):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [])
        row = bank_import._normalize_row(
            "2026-07-26", "UNKNOWN MERCHANT", -100, account_type=account_type,
        )
        assert row["category_key"] == "shopping"

    def test_card_income_does_not_default_to_shopping(self, monkeypatch):
        from app.services import bank_import

        monkeypatch.setattr(bank_import, "_ETIKET_RUNTIME", [])
        row = bank_import._normalize_row(
            "2026-07-26", "UNKNOWN REFUND", 100, account_type="credit",
        )
        assert row["category_key"] is None


# --------------------------------------------------------------------------
# QNB Finansbank Kazandıran checking account — _parse_qnb_pdf
# --------------------------------------------------------------------------

class TestQnbKazandiranAccount:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(QNB_KAZANDIRAN)

    def test_totals(self, res):
        assert res["bank_detected"] == "qnb (hesap hareketleri PDF)"
        assert res["total_rows"] == 6
        assert res["income_total"] == pytest.approx(3945882.67)
        assert res["expense_total"] == pytest.approx(2529294.78)
        assert res["date_range"] == {"from": "2026-06-26", "to": "2026-07-26"}

    def test_account_identity(self, res):
        assert len(res["accounts"]) == 1
        acc = res["accounts"][0]
        assert acc["type"] == "bank"
        assert acc["iban"] == "TR550011100000000166539691"
        assert acc["number"] == "539691"
        assert acc["branch"] == "ATAŞE***"
        assert acc["holder"] == "SADUN SEVİNGEN"
        assert acc["currency"] == "TRY"
        assert acc["balance"] == pytest.approx(1416587.89)
        assert acc["institution"] == "qnb"

    def test_english_amount_separators_and_balance(self, res):
        row = find_row(res["rows"], "Gönderen: SADUN SEVİNGEN")
        assert row["date"] == "2026-07-24"
        assert row["amount"] == pytest.approx(1414000.0)
        assert row["type"] == "income"
        assert row["balance"] == pytest.approx(1414001.0)

    def test_bank_transfer_categories_and_source(self, res):
        assert {r["source"] for r in res["rows"]} == {"TR550011100000000166539691"}
        assert {r["currency"] for r in res["rows"]} == {"TRY"}
        assert {r["category_key"] for r in res["rows"]} == {"wire-transfer"}


# --------------------------------------------------------------------------
# Odea Bank USD time-deposit account — same account in PDF and XLSX
# --------------------------------------------------------------------------

class TestOdeaUsdTimeDeposit:
    @staticmethod
    @pytest.fixture(scope="class", params=[ODEA_PDF, ODEA_XLSX])
    def res(parse_sample, request):
        return parse_sample(request.param)

    def test_totals(self, res):
        assert res["bank_detected"] in {
            "odea (hesap hareketleri PDF)",
            "odea",
        }
        assert res["total_rows"] == 1
        assert res["income_total"] == pytest.approx(30000.0)
        assert res["expense_total"] == pytest.approx(0.0)
        assert res["date_range"] == {"from": "2026-07-29", "to": "2026-07-29"}

    def test_account_identity_matches_across_formats(self, res):
        assert len(res["accounts"]) == 1
        acc = res["accounts"][0]
        assert acc["type"] == "bank"
        assert acc["iban"] == "TR430014600000594423600003"
        assert acc["number"] == "600003"
        assert acc["holder"] == "SADUN SEVİNGEN"
        assert acc["currency"] == "USD"
        assert acc["balance"] == pytest.approx(30000.0)
        assert acc["institution"] == "odea"

    def test_transaction_row(self, res):
        row = res["rows"][0]
        assert row["date"] == "2026-07-29"
        assert row["description"] == "9990-5944236-353 Vadeli Hesap Açılışı"
        assert row["amount"] == pytest.approx(30000.0)
        assert row["type"] == "income"
        assert row["currency"] == "USD"
        assert row["balance"] == pytest.approx(30000.0)
        assert row["source"] == "TR430014600000594423600003"


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
            "currency": "TRY",
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


class TestMidasJulyPortfolio:
    @staticmethod
    @pytest.fixture(scope="class")
    def res(parse_sample):
        return parse_sample(MIDAS_JULY)

    def test_us_portfolio_summary(self, res):
        assert res["kind"] == "investments"
        assert res["total_rows"] == 8
        assert res["portfolio"]["cash"] == pytest.approx(67.21)
        assert res["portfolio"]["total"] == pytest.approx(624.27)
        assert res["portfolio"]["currency"] == "USD"

    def test_fractional_share_quantity_keeps_decimal_comma(self, res):
        by_ticker = {h["ticker"]: h for h in res["investments"]}
        assert by_ticker["LMT"]["currency"] == "USD"
        assert by_ticker["LMT"]["amount"] == pytest.approx(0.083898174)
        assert by_ticker["LMT"]["purchase_price"] == pytest.approx(585.41)
        assert by_ticker["LMT"]["current_value"] == pytest.approx(48.89)


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


class TestGarantiOverdraftExportHeader:
    def test_real_balance_wins_over_available_balance(self):
        from app.services.bank_import import _normalize_account_identity, _parse_garanti_export

        rows, accounts = _parse_garanti_export([
            ["Ad Soyad", "SADUN SEVİNGEN", None, None, None, None],
            ["Hesap", "440 - 6659945 TL", None, None, None, None],
            ["IBAN", "TR19 0006 2000 4400 0006 6599 45", None, None, None, None],
            ["Şube", "İÇERENKÖY", None, None, None, None],
            ["Bakiye", "33.896,30 TL", None, None, None, None],
            ["Kullanılabilir Bakiye", "183.896,30 TL", None, None, None, None],
            ["Tarih", "Açıklama", "Etiket", "Tutar", "Bakiye", "Dekont No"],
            ["28/07/2026", "MİDAS MENKUL DEĞERLER", "Para Transferi", "-45000", "33896.3", "dekont"],
        ])
        _normalize_account_identity(accounts)

        assert len(rows) == 1
        acc = accounts[0]
        assert acc["balance"] == pytest.approx(33896.3)
        assert acc["available_balance"] == pytest.approx(183896.3)
        assert acc["bank_subtype"] == "overdraft"
        assert acc["credit_limit"] == pytest.approx(150000.0)
        assert acc["iban"] == "TR190006200044000006659945"


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
