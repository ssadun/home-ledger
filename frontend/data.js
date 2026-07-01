// data.js — Home Ledger sample data: categories, FX rates, transactions.
(function () {
  // ── FX rates (base = TRY). TCMB bulletin 2026/108, 15.06.2026 (Döviz Satış). ──
  const FX = {
    TRY: { toTRY: 1,        toUSD: 1 / 46.2765 },
    USD: { toTRY: 46.2765,  toUSD: 1 },
    EUR: { toTRY: 53.7123,  toUSD: 1.1607 },
  };

  // ── Categories: Lucide icon + accent color (CSS var) ─────────────────────
  const CATS = {
    salary:        { label: 'Salary',        icon: 'banknote',        color: 'var(--green)',     kind: 'income'  },
    freelance:     { label: 'Freelance',     icon: 'laptop',          color: 'var(--emerald)',   kind: 'income'  },
    interest:      { label: 'Interest',      icon: 'trending-up',     color: 'var(--mint)',      kind: 'income'  },
    rent:          { label: 'Rent',          icon: 'home',            color: 'var(--coral)',     kind: 'expense' },
    groceries:     { label: 'Groceries',     icon: 'shopping-cart',   color: 'var(--lime)',      kind: 'expense' },
    dining:        { label: 'Dining',        icon: 'utensils-crossed',color: 'var(--orange)',    kind: 'expense' },
    transport:     { label: 'Transport',     icon: 'car-front',       color: 'var(--sky)',       kind: 'expense' },
    utilities:     { label: 'Utilities',     icon: 'zap',             color: 'var(--yellow)',    kind: 'expense' },
    subscriptions: { label: 'Subscriptions', icon: 'repeat',          color: 'var(--fuchsia)',   kind: 'expense' },
    entertainment: { label: 'Entertainment', icon: 'clapperboard',    color: 'var(--lavender)',  kind: 'expense' },
    health:        { label: 'Health',        icon: 'heart-pulse',     color: 'var(--rose)',      kind: 'expense' },
    shopping:      { label: 'Shopping',      icon: 'shopping-bag',     color: 'var(--pink)',      kind: 'expense' },
    travel:        { label: 'Travel',        icon: 'plane',            color: 'var(--accent)',    kind: 'expense' },
    education:     { label: 'Education',     icon: 'graduation-cap',   color: 'var(--steel)',     kind: 'expense' },
    gifts:         { label: 'Gifts',         icon: 'gift',             color: 'var(--rose)',      kind: 'expense' },
    'wire-transfer': { label: 'Wire Transfer', icon: 'send',             color: 'var(--sky)',       kind: 'transfer' },
    'credit-card-payment': { label: 'Credit Card Payment', icon: 'credit-card', color: 'var(--orange)', kind: 'transfer' },
    debt:          { label: 'Debt',          icon: 'trending-down',    color: 'var(--red)',       kind: 'expense' },
  };

  const PAYERS = ['Sadun', 'Handan'];

  // ── Transactions ─────────────────────────────────────────────────────────
  // Columns: date, payer, category, description, type, currency, amount, payingFor, paymentMethod
  // payingFor = beneficiary: 'Shared', a person, or '–' (N/A, e.g. income).
  // paymentMethod = 'credit-card', 'debit-card', or 'cash'
  const raw = [
    ['2026-05-30','Sadun','salary',       'May salary — Trendyol payroll',          'income', 'TRY', 142500,  '–', 'credit-card'],
    ['2026-05-29','Handan','dining',       'Dinner at Karaköy Lokantası',            'expense','TRY', 2840,    'Shared', 'debit-card'],
    ['2026-05-29','Sadun','groceries',     'Migros weekly shop',                     'expense','TRY', 3215.40, 'Shared', 'credit-card'],
    ['2026-05-28','Sadun','subscriptions', 'GitHub Copilot + Cursor Pro annual',     'expense','USD', 40,      'Sadun', 'credit-card'],
    ['2026-05-28','Handan','transport',    'Uber to Sabiha Gökçen',                  'expense','TRY', 685,     'Handan', 'debit-card'],
    ['2026-05-27','Sadun','freelance',     'Landing page build — Acme retainer',     'income', 'USD', 1800,    '–', 'debit-card'],
    ['2026-05-27','Handan','health',       'Pharmacy — prescription + vitamins',     'expense','TRY', 1120.75, 'Handan', 'cash'],
    ['2026-05-26','Sadun','utilities',     'İSKİ water bill',                        'expense','TRY', 430.10,  'Shared', 'credit-card'],
    ['2026-05-26','Handan','shopping',     'Zara — spring jacket',                   'expense','EUR', 89.95,   'Handan', 'credit-card'],
    ['2026-05-25','Sadun','entertainment', 'Spotify Family + Netflix',               'expense','TRY', 379,     'Shared', 'credit-card'],
    ['2026-05-25','Handan','groceries',    'BİM run',                                'expense','TRY', 612.30,  'Shared', 'cash'],
    ['2026-05-24','Sadun','dining',        'Brunch — Mums Cafe Cihangir',            'expense','TRY', 1450,    'Shared', 'debit-card'],
    ['2026-05-23','Handan','travel',       'Pegasus flights IST→AYT (x2)',           'expense','TRY', 4980,    'Shared', 'credit-card'],
    ['2026-05-22','Sadun','transport',     'Shell — fuel',                           'expense','TRY', 2200,    'Shared', 'debit-card'],
    ['2026-05-22','Handan','education',    'Coursera — Data Science specialization', 'expense','USD', 49,      'Handan', 'credit-card'],
    ['2026-05-21','Sadun','subscriptions', 'iCloud 2TB + YouTube Premium',           'expense','TRY', 289,     'Shared', 'credit-card'],
    ['2026-05-20','Handan','gifts',        "Anniversary gift — leather wallet",      'expense','EUR', 120,     'Sadun', 'cash'],
    ['2026-05-20','Sadun','interest',      'Vakıfbank deposit interest',             'income', 'TRY', 3870.55, '–', 'credit-card'],
    ['2026-05-19','Handan','dining',       'Lunch — Kronotrop',                      'expense','TRY', 540,     'Handan', 'cash'],
    ['2026-05-18','Sadun','groceries',     'CarrefourSA',                            'expense','TRY', 1875.20, 'Shared', 'debit-card'],
    ['2026-05-17','Handan','health',       'Dental cleaning — Dr. Yılmaz',           'expense','TRY', 2600,    'Handan', 'debit-card'],
    ['2026-05-16','Sadun','shopping',      'Apple Store — USB-C cables & adapter',   'expense','USD', 78.50,   'Sadun', 'credit-card'],
    ['2026-05-15','Handan','utilities',    'Enerjisa electricity bill',              'expense','TRY', 1240.65, 'Shared', 'credit-card'],
    ['2026-05-14','Sadun','entertainment', 'Concert tickets — Zorlu PSM',            'expense','TRY', 1900,    'Shared', 'debit-card'],
    ['2026-05-13','Handan','transport',    'İstanbulkart top-up',                    'expense','TRY', 300,     'Handan', 'cash'],
    ['2026-05-12','Sadun','freelance',     'Logo & brand kit — Nordic client',       'income', 'EUR', 650,     '–', 'debit-card'],
    ['2026-05-11','Handan','groceries',    'Macrocenter — specialty items',          'expense','TRY', 2310.90, 'Shared', 'credit-card'],
    ['2026-05-10','Sadun','dining',        'Takeout — Yemeksepeti',                  'expense','TRY', 415,     'Shared', 'cash'],
    ['2026-05-09','Handan','subscriptions','Notion + Figma Pro',                     'expense','USD', 27,      'Handan', 'credit-card'],
    ['2026-05-08','Sadun','utilities',     'Türk Telekom fiber internet',            'expense','TRY', 759,     'Shared', 'debit-card'],
    ['2026-05-06','Handan','shopping',     'IKEA — desk lamp & storage',             'expense','TRY', 3490,    'Shared', 'credit-card'],
    ['2026-05-05','Sadun','health',        'Gym membership — MAC quarterly',         'expense','TRY', 4200,    'Sadun', 'debit-card'],
    ['2026-05-03','Handan','dining',       'Dinner — Neolokal',                      'expense','EUR', 185,     'Shared', 'credit-card'],
    ['2026-05-01','Sadun','rent',          'May rent — Kadıköy flat',                'expense','TRY', 32000,   'Shared', 'debit-card'],
    // ── April 2026 (for month picker) ──
    ['2026-04-30','Sadun','salary',        'April salary — Trendyol payroll',        'income', 'TRY', 142500,  '–', 'debit-card'],
    ['2026-04-28','Handan','groceries',    'Migros weekly shop',                     'expense','TRY', 2980.10, 'Shared', 'credit-card'],
    ['2026-04-25','Sadun','rent',          'April rent — Kadıköy flat',              'expense','TRY', 32000,   'Shared', 'credit-card'],
    ['2026-04-22','Handan','travel',       'Train to Eskişehir weekend',             'expense','TRY', 1240,    'Shared', 'debit-card'],
    ['2026-04-18','Sadun','freelance',     'API integration — Acme retainer',        'income', 'USD', 1500,    '–', 'credit-card'],
    ['2026-04-12','Handan','shopping',     'Mango — spring wardrobe',                'expense','EUR', 156.40,  'Handan', 'debit-card'],
    // ── June 2026 (for month picker) ──
    ['2026-06-02','Handan','dining',         'Coffee & pastry — Petra',                'expense',  'TRY', 285,     'Handan', 'cash'],
    ['2026-06-01','Sadun','rent',            'June rent — Kadıköy flat',               'expense',  'TRY', 32000,   'Shared', 'credit-card'],
    // ── Wire Transfer samples ──
    ['2026-06-05','Sadun','wire-transfer',   'EFT to Handan — shared expenses pool',   'expense',  'TRY', 15000,   'Handan', 'debit-card'],
    ['2026-05-31','Sadun','wire-transfer',   'SWIFT — Nordic client invoice payment',  'income',   'USD', 2400,    '–',      'debit-card'],
    ['2026-05-24','Handan','wire-transfer',  'Havale — Anneme destek ödemesi',         'expense',  'TRY', 5000,    'Handan', 'debit-card'],
    ['2026-04-15','Sadun','wire-transfer',   'Bank transfer — savings account top-up', 'expense',  'TRY', 20000,   'Sadun',  'debit-card'],
  ];

  const TX = raw.map((r, i) => {
    const [date, payer, cat, desc, type, cur, amt, payingFor, paymentMethod] = r;
    const tryV = +(amt * FX[cur].toTRY).toFixed(2);
    const usdV = +(amt * FX[cur].toUSD).toFixed(2);
    return { id: 'tx-' + (1000 + i), date, payer, cat, desc, type, cur, amt, payingFor, paymentMethod, tryV, usdV };
  });

  // App-wide "today" — the ledger's narrative current date. The preview runtime
  // clock is unreliable, so all pages read "current month/year" from here rather
  // than new Date(), keeping every month-stepper in sync.
  const TODAY = new Date('2026-06-15T00:00:00');
  const CURRENT_YEAR = TODAY.getFullYear();
  const CURRENT_MONTH = TODAY.getMonth(); // 0-indexed (June = 5)

  window.LEDGER = { FX, CATS, PAYERS, TX, TODAY, CURRENT_YEAR, CURRENT_MONTH };
})();
