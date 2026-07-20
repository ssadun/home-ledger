// account-tx-data.js — Home Ledger Account Activity data layer.
// Bank/card statement imports are stored in the backend `transactions` table
// tagged `note == "banka_import"`, with `payment_method` holding the account
// name. This module fetches those rows and maps them into the shape the
// Account Activity table renders. (Formerly a static, empty sample seed.)
(function () {
  const { FX } = window.LEDGER;

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

  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  // Only imported bank-account movements belong here. Card statements are linked
  // to a Credit Payment (credit_payment_id) and shown on the Credit Payments
  // screen, so they're excluded.
  function isBankImport(tx) {
    return tx && tx.note === 'banka_import' && !tx.credit_payment_id;
  }

  // Map the backend transaction's category into one of the ACCT_TX_TYPES keys so
  // the Type column/filter stays meaningful. Falls back to deposit/withdrawal by
  // direction when the category doesn't map to a specific movement type.
  const CATEGORY_TX_TYPE = {
    'salary': 'salary',
    'wire-transfer': 'transfer',
    'credit-card-payment': 'payment',
    'debt': 'payment',
    'interest': 'interest',
    'bank-fee': 'fee',
    'fee': 'fee',
    'refund': 'refund',
  };
  function guessTxType(tx) {
    const key = (tx.category_key || '').toLowerCase();
    if (CATEGORY_TX_TYPE[key]) return CATEGORY_TX_TYPE[key];
    return tx.type === 'income' ? 'deposit' : 'withdrawal';
  }

  // Backend transaction → Account Activity row. `accounts` is the hydrated list
  // (from HL_ACCOUNTS_API) used to resolve payment_method → an account.
  function toRow(tx, accounts) {
    // Imports store the account_key (e.g. "acc-6") in payment_method — that's the
    // frontend account `id`. Match on it first, then fall back to a name match.
    const pm = tx.payment_method;
    const acc = (accounts || []).find(a => a.id === pm)
      || (accounts || []).find(a => a.name && a.name === pm)
      || null;
    const cur = tx.currency || 'TRY';
    const amt = Math.abs(Number(tx.amount) || 0);
    const tryV = tx.amount_try != null
      ? Number(tx.amount_try)
      : +(amt * ((FX[cur] || FX.TRY).toTRY)).toFixed(2);
    return {
      id: 'tx-' + tx.id,
      _dbId: tx.id,
      date: tx.date,
      accountId: acc ? acc.id : null,
      accountName: acc ? acc.name : (tx.payment_method || '—'),
      accountType: acc ? acc.type : null,
      txType: guessTxType(tx),
      direction: tx.type === 'income' ? 'incoming' : 'outgoing',
      desc: tx.description || '',
      amt, cur, tryV,
    };
  }

  // Fetch imported bank-account activity for a given month (1-based) + year.
  // The page is month-scoped, so we let the backend filter by period (avoids the
  // 200-row page cap spanning a whole year).
  async function listActivity({ year, month, accounts }) {
    const apiFetch = api();
    if (!apiFetch) throw new Error('Not authenticated');
    const res = await apiFetch('/api/transactions/?year=' + year + '&month=' + month + '&limit=200', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load account activity (' + res.status + ')');
    const data = await res.json();
    return data
      .filter(isBankImport)
      .map(tx => toRow(tx, accounts))
      // A card statement dump that never became a Credit Payment (interim) would
      // otherwise leak in — keep this screen to bank-type money locations.
      .filter(r => r.accountType !== 'credit');
  }

  // Most recent imported movements for a single account, across all months —
  // powers the Accounts detail modal's mini "Recent Activity" list. Matching a
  // single account only needs [account] to resolve payment_method → accountId.
  async function listRecentForAccount(account, limit = 5) {
    const apiFetch = api();
    if (!apiFetch) throw new Error('Not authenticated');
    const res = await apiFetch('/api/transactions/?limit=200', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load account activity (' + res.status + ')');
    const data = await res.json();
    return data
      .filter(isBankImport)
      .map(tx => toRow(tx, [account]))
      .filter(r => r.accountId === account.id)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
      .slice(0, limit);
  }

  async function remove(dbId) {
    const apiFetch = api();
    const res = await apiFetch('/api/transactions/' + dbId, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete transaction (' + res.status + ')');
    return true;
  }

  // ACCT_TX kept as an empty default for any guarded reads; real rows are loaded
  // per-month by the page via HL_ACCT_TX_API.listActivity().
  window.ACCT_TX_DATA = { ACCT_TX: [], ACCT_TX_TYPES };
  window.HL_ACCT_TX_API = { listActivity, listRecentForAccount, remove, toRow, isBankImport };
})();
