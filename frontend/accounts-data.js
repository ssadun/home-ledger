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
      limit: row.credit_limit != null ? row.credit_limit : undefined,
      iban: row.iban || null,
      linked: row.linked_key || undefined,
      ccType: row.cc_type || undefined,
      debitType: row.debit_type || undefined,
      cardName: row.card_name || undefined,
      validityMonth: row.validity_month || undefined,
      validityYear: row.validity_year || undefined,
      statementCutoff: row.statement_cutoff != null ? row.statement_cutoff : undefined,
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
      credit_limit: item.limit != null ? Number(item.limit) : null,
      iban: item.iban || null,
      linked_key: item.linked || null,
      cc_type: item.ccType || null,
      debit_type: item.debitType || null,
      card_name: item.cardName || null,
      validity_month: item.validityMonth || null,
      validity_year: item.validityYear || null,
      statement_cutoff: item.statementCutoff != null ? Number(item.statementCutoff) : null,
    };
  }

  async function list() {
    const res = await api()('/api/accounts/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load accounts (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/accounts/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to create account (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(dbId, item) {
    const res = await api()('/api/accounts/' + dbId, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to update account (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(dbId) {
    const res = await api()('/api/accounts/' + dbId, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete account (' + res.status + ')');
    return true;
  }

  // ACCOUNTS starts empty and is hydrated by the page via list(); ACCOUNT_ACTIVITY
  // kept empty (per-account mini-activity will derive from real transactions in the
  // Dashboard/Reports pass). Guarded reads across other pages get [] / {} for now.
  window.ACCOUNTS_DATA = { ACCOUNT_TYPES, CC_TYPES, DEBIT_TYPES, ACCOUNTS: [], ACCOUNT_ACTIVITY: {}, FX };
  window.HL_ACCOUNTS_API = { list, create, update, remove, fromApi, toApi };
})();
