// accounts-data.js — Accounts API client (banks, cards, wallets, cash, overdraft, invest).
// Replaces the former static sample list. Config maps (ACCOUNT_TYPES, CC_TYPES,
// DEBIT_TYPES) stay static; ACCOUNTS is hydrated from the backend on mount.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  const ACCOUNT_TYPES = {
    bank:      { label: 'Bank Account',      icon: 'landmark',     color: 'var(--accent)' },
    overdraft: { label: 'Overdraft Account', icon: 'alert-circle', color: 'var(--coral)' },
    credit:    { label: 'Credit Card',       icon: 'credit-card',  color: 'var(--orange)' },
    debit:     { label: 'Debit Card',        icon: 'wallet-cards', color: 'var(--sky)' },
    wallet:    { label: 'Digital Wallet',    icon: 'smartphone',   color: 'var(--lavender)' },
    cash:      { label: 'Cash',              icon: 'banknote',     color: 'var(--green)' },
    invest:    { label: 'Investment',        icon: 'trending-up',  color: 'var(--emerald)' },
    pension:   { label: 'Retirement Plan',   icon: 'piggy-bank',   color: 'var(--lime)' },
  };

  const CC_TYPES = {
    visa:       { label: 'Visa', icon: 'credit-card' },
    mastercard: { label: 'MasterCard', icon: 'credit-card' },
    troy:       { label: 'Troy', icon: 'credit-card' },
  };

  const DEBIT_TYPES = {
    electron:  { label: 'Visa Electron', icon: 'wallet-cards' },
    maestro:   { label: 'Maestro', icon: 'wallet-cards' },
    troy:      { label: 'Troy', icon: 'wallet-cards' },
  };

  // Financial institutions — drives the Accounts "Institution" picker.
  // Managed via Configuration → Financial Institutions; each has a name + SWIFT/BIC
  // code + optional logo, and persists to the backend `financial_institutions` table.
  // This literal is only the BOOTSTRAP shape shown before the API answers: pages that
  // render institutions call window.HL_INSTITUTIONS_API.hydrate(), which refills the
  // map below in place (see institutions-data.js). Logos live only on the server.
  const FINANCIAL_INSTITUTIONS = {
    garanti:     { name: 'Garanti BBVA',      swift: 'TGBATRIS' },
    isbank:      { name: 'İş Bankası',         swift: 'ISBKTRIS' },
    ziraat:      { name: 'Ziraat Bankası',     swift: 'TCZBTR2A' },
    vakifbank:   { name: 'VakıfBank',          swift: 'TVBATR2A' },
    yapikredi:   { name: 'Yapı Kredi',         swift: 'YAPITRIS' },
    akbank:      { name: 'Akbank',             swift: 'AKBKTRIS' },
    qnb:         { name: 'QNB Finansbank',     swift: 'FNNBTRIS' },
    denizbank:   { name: 'DenizBank',          swift: 'DENITRIS' },
    halkbank:    { name: 'Halkbank',           swift: 'TRHBTR2A' },
    burgan:      { name: 'Burgan Bank',        swift: 'TEKFTRIS' },
    garantiemek: { name: 'Garanti BBVA Emeklilik', swift: '' },
  };

  // FX rates (same as data.js)
  const FX = window.LEDGER ? window.LEDGER.FX : { TRY: { toTRY: 1 }, USD: { toTRY: 39.2 }, EUR: { toTRY: 42.6 } };

  // ── Backend ↔ frontend mappers ──
  function fromApi(row) {
    return {
      id: row.account_key || ('acc-' + row.id),   // stable string id used for linking + React keys
      _dbId: row.id,                                // numeric id for API calls
      name: row.name,
      owner: row.holder || 'Sadun',
      type: row.type || 'bank',
      cur: row.currency,
      balance: row.balance != null ? row.balance : 0,
      number: row.number || '–',
      institution: row.institution || '–',
      primary: !!row.is_primary,
      showInPaymentMethod: !!row.show_in_payment_method,
      limit: row.credit_limit != null ? row.credit_limit : undefined,
      iban: cleanIban(row.iban) || null,   // legacy rows may still carry spacing
      linked: row.linked_key || undefined,
      ccType: row.cc_type || undefined,
      isPrepaid: !!row.is_prepaid,
      debitType: row.debit_type || undefined,
      cardName: row.card_name || undefined,
      cardMedium: row.card_medium || undefined,
      validityMonth: row.validity_month || undefined,
      validityYear: row.validity_year || undefined,
      statementCutoff: row.statement_cutoff ? row.statement_cutoff : undefined,  // treat 0/null as "no cutoff"
      paymentDue: row.payment_due || undefined,
      pension: row.pension || undefined,   // BES figures; only for type === 'pension'
    };
  }

  function toApi(item) {
    return {
      name: item.name,
      holder: item.owner || null,
      type: item.type || 'bank',
      currency: item.cur || 'TRY',
      balance: Number(item.balance) || 0,
      number: item.number || null,
      institution: item.institution || null,
      is_primary: !!item.primary,
      show_in_payment_method: !!item.showInPaymentMethod,
      credit_limit: item.limit ? Number(item.limit) : null,   // empty/0 → null, never a stray 0
      iban: cleanIban(item.iban) || null,
      linked_key: item.linked || null,
      cc_type: item.ccType || null,
      is_prepaid: !!item.isPrepaid,
      debit_type: item.debitType || null,
      card_name: item.cardName || null,
      card_medium: item.cardMedium || null,
      validity_month: item.validityMonth || null,
      validity_year: item.validityYear || null,
      statement_cutoff: item.statementCutoff ? Number(item.statementCutoff) : null,   // empty/0 → null
      payment_due: item.paymentDue || null,
      pension: item.pension || null,
    };
  }

  async function list() {
    const res = await api()('/api/accounts/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load accounts (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  // Surface the API's own `detail` rather than a bare status code — the per-type
  // unique-identity check (409) explains WHICH account already holds the IBAN /
  // card number, and that text is the whole value of the error.
  async function errText(res, what) {
    let msg = 'Failed to ' + what + ' (' + res.status + ')';
    try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch (e) { /* non-JSON body */ }
    return msg;
  }

  async function create(item) {
    const res = await api()('/api/accounts/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errText(res, 'create account'));
    return fromApi(await res.json());
  }

  async function update(dbId, item) {
    const res = await api()('/api/accounts/' + dbId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errText(res, 'update account'));
    return fromApi(await res.json());
  }

  async function remove(dbId) {
    const res = await api()('/api/accounts/' + dbId, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete account (' + res.status + ')');
    return true;
  }

  // ── IBAN / account-number normalization ───────────────────────────────────
  // One canonical IBAN form: no spacing, upper-case, capped at the 26 characters
  // a Turkish IBAN has. The same account reaches the app spaced ("TR65 0006 …"
  // from a Garanti statement) and unspaced ("TR8100125…" from ON), and the
  // duplicate check, the statement→account match and the derived account number
  // all compare raw strings.
  // Shape is enforced, not just spacing: a Turkish IBAN is two country LETTERS
  // followed by 24 DIGITS, so letters are only accepted in the first two slots
  // and everything after them must be numeric ("TR65ABCD…" keeps "TR65").
  function cleanIban(v) {
    const raw = String(v == null ? '' : v).replace(/[^0-9A-Za-z]/g, '').toUpperCase();
    const cc = raw.slice(0, 2).replace(/[^A-Z]/g, '');
    return (cc + raw.slice(cc.length).replace(/\D/g, '')).slice(0, 26);
  }

  // An account number is digits only.
  function cleanAccountNo(v) {
    return String(v == null ? '' : v).replace(/\D/g, '');
  }

  // A CARD number keeps its mask ("4870 **** **** 1011"), so digits, spaces and
  // the masking asterisk are all it may contain — letters are still rejected.
  // Capped at 19 digits + the 3 group spaces of the longest real card number.
  function cleanCardNo(v) {
    return String(v == null ? '' : v).replace(/[^0-9* ]/g, '').replace(/\s{2,}/g, ' ').slice(0, 22);
  }

  // A Turkish IBAN is TR + 2 check + 5 bank + 1 reserved + 16 account digits, so
  // its tail identifies the account. The app shows the LAST 6 as the account
  // number — the same tail the import wizard's dropdown labels use.
  function accountNoFromIban(iban) {
    const clean = cleanIban(iban);
    return /^TR\d{24}$/.test(clean) ? clean.slice(-6) : '';
  }

  // Normalizes a stored card number's masking so every screen (Accounts,
  // Payment Method picker, Credit Payments) shows the same pattern regardless
  // of how it was typed or extracted from an import — first/last groups stay
  // verbatim, every group between them is fully masked (e.g. "4870 75** ****
  // 1011" -> "4870 **** **** 1011").
  function maskCardNumber(raw) {
    if (!raw || raw === '–') return raw;
    const groups = raw.trim().split(/\s+/);
    return groups.map((g, i) => (i === 0 || i === groups.length - 1) ? g : '*'.repeat(g.length)).join(' ');
  }

  // These three maps have no backend table; edits from the Configuration screens
  // persist to localStorage (see config-app.jsx persistClientSection). Apply any
  // saved override here so edits survive reload and propagate to every page that
  // reads window.ACCOUNTS_DATA (Accounts, pickers, …).
  // Merged, not replaced: a saved override wins per key, but keys shipped later
  // still appear. Without the merge, anyone who had ever edited Account Types would
  // never see a newly added default (e.g. "pension") — it would be silently missing
  // from the picker with no way to discover it. Trade-off: a default the user
  // deleted comes back; that is the better failure of the two.
  function withOverrides(sectionId, base) {
    try {
      const saved = JSON.parse(localStorage.getItem('hl-cfg-' + sectionId + '-data') || 'null');
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) return { ...base, ...saved };
    } catch (e) { /* corrupt/absent override → fall back to defaults */ }
    return base;
  }

  // ACCOUNTS starts empty and is hydrated by the page via list(); ACCOUNT_ACTIVITY
  // kept empty (per-account mini-activity will derive from real transactions in the
  // Dashboard/Reports pass). Guarded reads across other pages get [] / {} for now.
  window.ACCOUNTS_DATA = {
    ACCOUNT_TYPES:          withOverrides('account-types', ACCOUNT_TYPES),
    CC_TYPES:               withOverrides('cc-types', CC_TYPES),
    DEBIT_TYPES:            withOverrides('debit-types', DEBIT_TYPES),
    // No withOverrides(): institutions come from the DB via HL_INSTITUTIONS_API.hydrate().
    FINANCIAL_INSTITUTIONS,
    ACCOUNTS: [], ACCOUNT_ACTIVITY: {}, FX,
  };
  window.HL_ACCOUNTS_API = {
    list, create, update, remove, fromApi, toApi, maskCardNumber,
    cleanIban, cleanAccountNo, cleanCardNo, accountNoFromIban,
  };
})();
