// import-data.js — Sample bank statement documents for the import flow.
// Each document carries a detected account number (matched to an account) and
// transaction rows that each contain a date. Categories are guessed on parse.
(function () {
  // Raw rows: [date, description, amount(signed), currency]
  const DOCUMENTS = [
    {
      id: 'doc-csv-1',
      fileName: 'vakifbank_hesap_ekstresi_2026-05.csv',
      format: 'csv',
      size: '4.2 KB',
      institution: 'Vakıfbank',
      accountNumber: '****3847',
      period: 'May 2026',
      rows: [
        ['2026-05-30', 'TRENDYOL MAAS ODEMESI',           142500.00, 'TRY'],
        ['2026-05-28', 'GITHUB COPILOT/CURSOR ABONELIK',    -1568.00, 'TRY'],
        ['2026-05-26', 'ISKI SU FATURASI',                   -430.10, 'TRY'],
        ['2026-05-22', 'SHELL AKARYAKIT KADIKOY',           -2200.00, 'TRY'],
        ['2026-05-20', 'VADESIZ FAIZ TAHAKKUKU',            3870.55, 'TRY'],
        ['2026-05-12', 'EFT GELEN - H. YILMAZ',             5000.00, 'TRY'],
      ],
    },
    {
      id: 'doc-xls-1',
      fileName: 'is_bankasi_ekstre_2026_05.xlsx',
      format: 'excel',
      size: '11.8 KB',
      institution: 'İş Bankası',
      accountNumber: '****9214',
      period: 'May 2026',
      rows: [
        ['2026-05-29', 'KARAKOY LOKANTASI',                 -2840.00, 'TRY'],
        ['2026-05-28', 'UBER BV AMSTERDAM',                  -685.00, 'TRY'],
        ['2026-05-27', 'ECZANE + VITAMIN',                  -1120.75, 'TRY'],
        ['2026-05-25', 'BIM BIRLESIK MAGAZALAR',             -612.30, 'TRY'],
        ['2026-05-17', 'OZEL DIS KLINIGI DR YILMAZ',        -2600.00, 'TRY'],
        ['2026-05-13', 'ISTANBULKART DOLUM',                 -300.00, 'TRY'],
      ],
    },
    {
      id: 'doc-pdf-1',
      fileName: 'garanti_bonus_kart_ekstresi.pdf',
      format: 'pdf',
      size: '92 KB',
      institution: 'Garanti BBVA',
      accountNumber: '****2290',
      period: 'May 2026',
      rows: [
        ['2026-05-29', 'MIGROS MMM HAFTALIK',               -3215.40, 'TRY'],
        ['2026-05-25', 'SPOTIFY + NETFLIX',                  -379.00, 'TRY'],
        ['2026-05-24', 'MUMS CAFE CIHANGIR',                -1450.00, 'TRY'],
        ['2026-05-21', 'APPLE.COM/BILL ICLOUD+YT',           -289.00, 'TRY'],
        ['2026-05-14', 'ZORLU PSM BILET',                   -1900.00, 'TRY'],
        ['2026-05-06', 'IKEA UMRANIYE',                     -3490.00, 'TRY'],
      ],
    },
    {
      id: 'doc-pdf-2',
      fileName: 'wise_statement_usd_may.pdf',
      format: 'pdf',
      size: '64 KB',
      institution: 'Wise',
      accountNumber: '****7731',
      period: 'May 2026',
      rows: [
        ['2026-05-27', 'ACME CORP - INVOICE 0042',          1800.00, 'USD'],
        ['2026-05-16', 'APPLE STORE - CABLES',               -78.50, 'USD'],
        ['2026-05-09', 'NOTION + FIGMA',                     -27.00, 'USD'],
        ['2026-05-04', 'CARD TOP-UP FROM TRY',               500.00, 'USD'],
      ],
    },
  ];

  // ── Lightweight category guesser (keyword → CATS key) ──
  const RULES = [
    [/maas|payroll|salary/i,                'salary'],
    [/faiz|interest/i,                      'interest'],
    [/invoice|acme|retainer|freelance/i,    'freelance'],
    [/kira|rent/i,                          'rent'],
    [/migros|bim|carrefour|market|magaza/i, 'groceries'],
    [/lokanta|cafe|restaurant|yemek/i,      'dining'],
    [/uber|shell|akaryakit|istanbulkart|taksi|fuel/i, 'transport'],
    [/su |elektrik|fatura|iski|enerji/i,    'utilities'],
    [/spotify|netflix|icloud|abonelik|notion|figma|copilot|cursor/i, 'subscriptions'],
    [/psm|bilet|sinema|konser/i,            'entertainment'],
    [/eczane|klinik|dis|saglik|vitamin/i,   'health'],
    [/ikea|apple|zara|magaza|store/i,       'shopping'],
    [/ucak|flight|tren|otel|travel/i,       'travel'],
    [/wire|havale|eft|transfer|swift|bank transfer/i, 'wire-transfer'],
  ];

  function guessCategory(desc, isIncome) {
    for (const [re, key] of RULES) if (re.test(desc)) return key;
    return isIncome ? 'salary' : 'shopping';
  }

  // Tidy raw bank descriptions into title-ish case for display
  function tidyDesc(raw) {
    return raw.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
  }

  window.IMPORT_DATA = { DOCUMENTS, guessCategory, tidyDesc };
})();
