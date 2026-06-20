// account-tx-data.js — Home Ledger sample account-sourced transactions.
// These represent records imported from bank/card statements.
(function () {
  const { FX } = window.LEDGER;
  const { ACCOUNTS } = window.ACCOUNTS_DATA;

  // Transaction types for account records
  const ACCT_TX_TYPES = {
    eft:        { label: 'EFT',             icon: 'send',          color: 'var(--sky)' },
    swift:      { label: 'SWIFT',           icon: 'globe',         color: 'var(--accent)' },
    havale:     { label: 'Havale',          icon: 'arrow-right-left', color: 'var(--lavender)' },
    deposit:    { label: 'Deposit',         icon: 'arrow-down-left', color: 'var(--green)' },
    withdrawal: { label: 'Withdrawal',      icon: 'arrow-up-right', color: 'var(--coral)' },
    fee:        { label: 'Bank Fee',        icon: 'receipt',       color: 'var(--red)' },
    interest:   { label: 'Interest',        icon: 'trending-up',   color: 'var(--mint)' },
    payment:    { label: 'Card Payment',    icon: 'credit-card',   color: 'var(--orange)' },
    refund:     { label: 'Refund',          icon: 'rotate-ccw',    color: 'var(--emerald)' },
    salary:     { label: 'Salary',          icon: 'banknote',      color: 'var(--green)' },
    transfer:   { label: 'Internal Transfer', icon: 'repeat',      color: 'var(--steel)' },
  };

  // Raw account transaction records
  const raw = [
    // ── June 2026 ──
    ['2026-06-05', 'acc-1',  'eft',        'outgoing', 'EFT to Handan — shared expenses pool',        15000,    'TRY', 'acc-3',  'Completed'],
    ['2026-06-02', 'acc-6',  'payment',    'outgoing', 'Bonus Card — automatic monthly payment',       12480,    'TRY', 'acc-1',  'Completed'],
    ['2026-06-01', 'acc-1',  'eft',        'outgoing', 'June rent — Kadıköy flat (landlord EFT)',      32000,    'TRY', null,     'Completed'],
    // ── May 2026 ──
    ['2026-05-31', 'acc-5',  'swift',      'incoming', 'SWIFT — Nordic client invoice payment',         2400,    'USD', null,     'Completed'],
    ['2026-05-30', 'acc-1',  'salary',     'incoming', 'May salary — Trendyol payroll',                142500,   'TRY', null,     'Completed'],
    ['2026-05-29', 'acc-6',  'payment',    'outgoing', 'Migros weekly shop — POS purchase',             3215.40, 'TRY', null,     'Completed'],
    ['2026-05-28', 'acc-6',  'payment',    'outgoing', 'GitHub Copilot + Cursor Pro annual',            1568,    'TRY', null,     'Completed'],
    ['2026-05-27', 'acc-5',  'swift',      'incoming', 'Acme retainer — landing page build',            1800,    'USD', null,     'Completed'],
    ['2026-05-26', 'acc-6',  'payment',    'outgoing', 'İSKİ water bill — auto pay',                   430.10,  'TRY', null,     'Completed'],
    ['2026-05-26', 'acc-7',  'payment',    'outgoing', 'Zara — spring jacket (POS)',                    3831.87, 'TRY', null,     'Completed'],
    ['2026-05-25', 'acc-6',  'payment',    'outgoing', 'Spotify Family + Netflix',                      379,     'TRY', null,     'Completed'],
    ['2026-05-24', 'acc-3',  'havale',     'outgoing', 'Havale — Anneme destek ödemesi',                5000,    'TRY', null,     'Completed'],
    ['2026-05-23', 'acc-7',  'payment',    'outgoing', 'Pegasus flights IST→AYT (x2)',                  4980,    'TRY', null,     'Completed'],
    ['2026-05-22', 'acc-13', 'payment',    'outgoing', 'Shell — fuel (POS debit)',                      2200,    'TRY', null,     'Completed'],
    ['2026-05-21', 'acc-6',  'payment',    'outgoing', 'iCloud 2TB + YouTube Premium',                  289,     'TRY', null,     'Completed'],
    ['2026-05-20', 'acc-2',  'interest',   'incoming', 'Vakıfbank deposit interest — May',               3870.55, 'TRY', null,     'Completed'],
    ['2026-05-18', 'acc-13', 'payment',    'outgoing', 'CarrefourSA grocery (POS debit)',                1875.20, 'TRY', null,     'Completed'],
    ['2026-05-17', 'acc-14', 'payment',    'outgoing', 'Dental cleaning — Dr. Yılmaz (POS debit)',      2600,    'TRY', null,     'Completed'],
    ['2026-05-16', 'acc-6',  'payment',    'outgoing', 'Apple Store — USB-C cables & adapter',           3077.20, 'TRY', null,     'Completed'],
    ['2026-05-15', 'acc-7',  'payment',    'outgoing', 'Enerjisa electricity bill — auto pay',           1240.65, 'TRY', null,     'Completed'],
    ['2026-05-14', 'acc-13', 'payment',    'outgoing', 'Zorlu PSM concert tickets (POS debit)',          1900,    'TRY', null,     'Completed'],
    ['2026-05-12', 'acc-4',  'swift',      'incoming', 'Logo & brand kit — Nordic client EUR',           650,     'EUR', null,     'Completed'],
    ['2026-05-11', 'acc-7',  'payment',    'outgoing', 'Macrocenter — specialty items',                  2310.90, 'TRY', null,     'Completed'],
    ['2026-05-09', 'acc-7',  'payment',    'outgoing', 'Notion + Figma Pro subscription',                1058.40, 'TRY', null,     'Completed'],
    ['2026-05-08', 'acc-13', 'payment',    'outgoing', 'Türk Telekom fiber internet (auto debit)',       759,     'TRY', null,     'Completed'],
    ['2026-05-06', 'acc-7',  'payment',    'outgoing', 'IKEA — desk lamp & storage (POS)',               3490,    'TRY', null,     'Completed'],
    ['2026-05-05', 'acc-13', 'payment',    'outgoing', 'Gym membership — MAC (POS debit)',               4200,    'TRY', null,     'Completed'],
    ['2026-05-03', 'acc-7',  'payment',    'outgoing', 'Neolokal dinner (POS)',                          7881,    'TRY', null,     'Completed'],
    ['2026-05-01', 'acc-1',  'eft',        'outgoing', 'May rent — Kadıköy flat (landlord EFT)',         32000,   'TRY', null,     'Completed'],
    ['2026-05-01', 'acc-1',  'fee',        'outgoing', 'Vakıfbank monthly account maintenance fee',      89.90,   'TRY', null,     'Completed'],
    ['2026-05-01', 'acc-3',  'fee',        'outgoing', 'İş Bankası monthly account maintenance fee',     74.50,   'TRY', null,     'Completed'],
    // ── April 2026 ──
    ['2026-04-30', 'acc-1',  'salary',     'incoming', 'April salary — Trendyol payroll',               142500,   'TRY', null,     'Completed'],
    ['2026-04-25', 'acc-1',  'eft',        'outgoing', 'April rent — Kadıköy flat (landlord EFT)',       32000,   'TRY', null,     'Completed'],
    ['2026-04-18', 'acc-5',  'swift',      'incoming', 'API integration — Acme retainer',                1500,    'USD', null,     'Completed'],
    ['2026-04-15', 'acc-1',  'transfer',   'outgoing', 'Internal transfer — savings account top-up',     20000,   'TRY', 'acc-2',  'Completed'],
    ['2026-04-10', 'acc-2',  'interest',   'incoming', 'Garanti BBVA deposit interest — April',          4120.30, 'TRY', null,     'Completed'],
    ['2026-04-05', 'acc-1',  'fee',        'outgoing', 'EFT commission fee',                             29.90,   'TRY', null,     'Completed'],
    ['2026-04-03', 'acc-7',  'refund',     'incoming', 'Trendyol order refund — wrong size',             459.90,  'TRY', null,     'Completed'],
  ];

  const ACCT_TX = raw.map((r, i) => {
    const [date, accountId, txType, direction, desc, amt, cur, counterpartyAcct, status] = r;
    const account = ACCOUNTS.find(a => a.id === accountId) || {};
    const counterparty = counterpartyAcct ? ACCOUNTS.find(a => a.id === counterpartyAcct) : null;
    const tryV = +(amt * (FX[cur] || FX.TRY).toTRY).toFixed(2);
    return {
      id: 'atx-' + (1000 + i),
      date, accountId, txType, direction, desc, amt, cur,
      counterpartyAcct, counterpartyName: counterparty ? counterparty.name : null,
      status,
      accountName: account.name || '—',
      accountInstitution: account.institution || '—',
      accountOwner: account.owner || '—',
      tryV,
    };
  });

  window.ACCT_TX_DATA = { ACCT_TX, ACCT_TX_TYPES };
})();
