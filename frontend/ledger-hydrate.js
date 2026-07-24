// ledger-hydrate.js — Shared pre-mount data hydration for the read-only /
// aggregator pages (Dashboard + Reports, Backup & Export) and any page whose
// math reads the static window.LEDGER / *_DATA placeholders.
//
// Why pre-mount + in-place: these apps destructure their data at module scope
// (e.g. `const { TX } = window.LEDGER`) BEFORE React mounts, and their memos do
// not list TX in their dependency arrays. So we must (a) fill the data BEFORE
// the first render, and (b) mutate the EXISTING container objects/arrays in
// place — never reassign — so the references captured at module scope stay
// pointing at the now-populated data.
//
// Usage on a page:
//   1. include this AFTER the per-module API clients it needs
//      (spending-data.js, budgets-data.js, accounts-data.js, recurring-data.js,
//       categories-data.js, currencies-data.js) and AFTER data.js.
//   2. gate the app mount:  HL_HYDRATE.all().finally(() => render());
(function () {
  const state = { errors: {}, loaded: {} };

  // ── In-place fillers (preserve the reference other modules captured) ──────
  function fillArray(arr, rows) {
    if (!Array.isArray(arr)) return;
    arr.length = 0;
    (rows || []).forEach(r => arr.push(r));
  }
  function fillObject(obj, next) {
    if (!obj || !next) return;
    Object.keys(obj).forEach(k => delete obj[k]);
    Object.keys(next).forEach(k => { obj[k] = next[k]; });
  }

  function markLoaded(name) {
    state.loaded[name] = true;
    delete state.errors[name];
  }

  function markError(name, err) {
    state.errors[name] = (err && err.message) || String(err || 'Failed to load');
  }

  function clearReportData() {
    if (window.LEDGER && Array.isArray(window.LEDGER.TX)) fillArray(window.LEDGER.TX, []);
    if (window.BUDGETS_DATA && window.BUDGETS_DATA.BUDGETS) fillObject(window.BUDGETS_DATA.BUDGETS, {});
    if (window.ACCOUNTS_DATA && Array.isArray(window.ACCOUNTS_DATA.ACCOUNTS)) fillArray(window.ACCOUNTS_DATA.ACCOUNTS, []);
    if (window.INVESTMENTS_DATA && Array.isArray(window.INVESTMENTS_DATA.HOLDINGS)) fillArray(window.INVESTMENTS_DATA.HOLDINGS, []);
    if (window.RECURRING_DATA && Array.isArray(window.RECURRING_DATA.RECURRING)) fillArray(window.RECURRING_DATA.RECURRING, []);
    if (window.CREDIT_PAYMENTS_DATA && Array.isArray(window.CREDIT_PAYMENTS_DATA.RECORDS)) fillArray(window.CREDIT_PAYMENTS_DATA.RECORDS, []);
  }

  // ── Per-source hydrators (each a no-op when its client/placeholder is absent) ──
  async function hydrateCats() {
    if (window.HL_CATEGORIES_API && window.HL_CATEGORIES_API.hydrateLedgerCats) {
      await window.HL_CATEGORIES_API.hydrateLedgerCats();   // mutates LEDGER.CATS in place
    }
  }

  async function hydratePayers() {
    if (window.HL_MEMBERS_API && window.HL_MEMBERS_API.hydrateLedgerPayers) {
      await window.HL_MEMBERS_API.hydrateLedgerPayers();   // mutates LEDGER.PAYERS in place
    }
  }

  async function hydrateFx() {
    if (!(window.HL_CURRENCIES_API && window.LEDGER && window.LEDGER.FX)) return;
    const rows = await window.HL_CURRENCIES_API.list();
    if (!rows.length) return;
    const fx = {};
    rows.forEach(c => {
      if (!c.code) return;
      fx[String(c.code).toUpperCase()] = { toTRY: c.toTRY, toUSD: c.toUSD };
    });
    if (!fx.TRY) fx.TRY = { toTRY: 1, toUSD: fx.USD ? 1 / fx.USD.toTRY : null };
    fillObject(window.LEDGER.FX, fx);   // ACCOUNTS_DATA.FX shares this same reference
  }

  async function hydrateTx() {
    if (!(window.HL_SPENDING_API && window.LEDGER && Array.isArray(window.LEDGER.TX))) return;
    const pageSize = 200;
    let offset = 0;
    const rows = [];
    while (true) {
      const page = await window.HL_SPENDING_API.list({ limit: pageSize, offset });
      rows.push.apply(rows, page);
      if (page.length < pageSize) break;
      offset += pageSize;
    }
    fillArray(window.LEDGER.TX, rows);
  }

  async function hydrateBudgets() {
    if (!(window.HL_BUDGETS_API && window.BUDGETS_DATA)) return;
    fillObject(window.BUDGETS_DATA.BUDGETS, await window.HL_BUDGETS_API.list());
  }

  async function hydrateAccounts() {
    if (!(window.HL_ACCOUNTS_API && window.ACCOUNTS_DATA)) return;
    fillArray(window.ACCOUNTS_DATA.ACCOUNTS, await window.HL_ACCOUNTS_API.list());
  }

  async function hydrateInvestments() {
    if (!(window.HL_INVESTMENTS_API && window.INVESTMENTS_DATA && Array.isArray(window.INVESTMENTS_DATA.HOLDINGS))) return;
    fillArray(window.INVESTMENTS_DATA.HOLDINGS, await window.HL_INVESTMENTS_API.list());
  }

  async function hydrateRecurring() {
    if (!(window.HL_RECURRING_API && window.RECURRING_DATA)) return;
    const bills = await window.HL_RECURRING_API.list();
    let subs = [];
    if (window.HL_SUBSCRIPTIONS_API) {
      try { subs = await window.HL_SUBSCRIPTIONS_API.list(); } catch (e) { /* keep bills only */ }
    }
    fillArray(window.RECURRING_DATA.RECURRING, bills.concat(subs));
  }

  async function hydrateCreditPayments() {
    if (!(window.HL_CREDIT_PAYMENTS_API && window.CREDIT_PAYMENTS_DATA)) return;
    const recs = await window.HL_CREDIT_PAYMENTS_API.list();
    // Attach a card label from the (already-hydrated) accounts list for calendar display.
    const accts = (window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.ACCOUNTS) || [];
    const byId = {};
    accts.forEach(a => { byId[a._dbId] = a; byId[a.id] = a; });
    const labeled = recs.map(r => {
      const c = byId[r.accountId] || byId[r.accountKey];
      const label = c ? (c.name + (c.number && c.number !== '–' ? ' ' + c.number : '')) : null;
      return Object.assign({}, r, { cardLabel: label });
    });
    fillArray(window.CREDIT_PAYMENTS_DATA.RECORDS, labeled);
  }

  // Run every available hydrator. CATS + FX go first because recurring rows
  // derive their TRY/USD amounts from LEDGER.FX at map time. Report-owned live
  // data is cleared before any API call, so failed calls render as missing data
  // instead of leaking the sample rows from data.js.
  async function all() {
    clearReportData();
    state.errors = {};
    state.loaded = {};
    const guard = (name, fn) => fn()
      .then(() => markLoaded(name))
      .catch(e => {
        markError(name, e);
        console.warn('[hydrate] ' + name + ' failed:', (e && e.message) || e);
      });
    await Promise.all([guard('categories', hydrateCats), guard('currencies', hydrateFx), guard('payers', hydratePayers)]);
    await Promise.all([
      guard('transactions', hydrateTx),
      guard('budgets', hydrateBudgets),
      guard('accounts', hydrateAccounts),
      guard('investments', hydrateInvestments),
      guard('recurring', hydrateRecurring),
    ]);
    // After accounts so credit-payment rows can resolve their card label.
    await guard('credit-payments', hydrateCreditPayments);
  }

  window.HL_HYDRATE = {
    all, hydrateCats, hydrateFx, hydratePayers, hydrateTx, hydrateBudgets, hydrateAccounts, hydrateInvestments, hydrateRecurring,
    hydrateCreditPayments, clearReportData, state,
  };
})();
