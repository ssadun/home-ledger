// asset-domain-data.js — Assets, holdings, liabilities, and net-worth API client.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);
  const FX = () => (window.LEDGER && window.LEDGER.FX) || { TRY: { toTRY: 1 }, USD: { toTRY: 1 }, EUR: { toTRY: 1 } };

  const ASSET_TYPES = {
    cash: { label: 'Cash', icon: 'banknote', color: 'var(--green)' },
    bank_account: { label: 'Bank Account', icon: 'landmark', color: 'var(--accent)' },
    investment: { label: 'Investment', icon: 'trending-up', color: 'var(--emerald)' },
    real_estate: { label: 'Real Estate', icon: 'home', color: 'var(--sky)' },
    vehicle: { label: 'Vehicle', icon: 'car-front', color: 'var(--orange)' },
    crypto: { label: 'Crypto', icon: 'bitcoin', color: 'var(--yellow)' },
    retirement: { label: 'Retirement', icon: 'piggy-bank', color: 'var(--lime)' },
    business: { label: 'Business', icon: 'briefcase-business', color: 'var(--lavender)' },
    collectible: { label: 'Collectible', icon: 'gem', color: 'var(--rose)' },
    other: { label: 'Other', icon: 'box', color: 'var(--steel)' },
  };
  const LIABILITY_TYPES = {
    mortgage: { label: 'Mortgage', icon: 'home', color: 'var(--red)' },
    credit_card: { label: 'Credit Card', icon: 'credit-card', color: 'var(--orange)' },
    personal_loan: { label: 'Personal Loan', icon: 'receipt', color: 'var(--coral)' },
    vehicle_loan: { label: 'Vehicle Loan', icon: 'car-front', color: 'var(--yellow)' },
    student_loan: { label: 'Student Loan', icon: 'graduation-cap', color: 'var(--sky)' },
    overdraft: { label: 'Overdraft', icon: 'alert-circle', color: 'var(--coral)' },
    tax: { label: 'Tax', icon: 'landmark', color: 'var(--lavender)' },
    other: { label: 'Other', icon: 'circle-alert', color: 'var(--steel)' },
  };
  const LIQUIDITY = {
    immediate: 'Immediate',
    short_term: 'Short Term',
    illiquid: 'Illiquid',
  };
  const VALUATION_MODE = {
    account_balance: 'Account Balance',
    holdings: 'Holdings',
    manual: 'Manual',
  };

  function toTRY(v, cur) {
    const rate = (FX()[cur] || FX().TRY || { toTRY: 1 }).toTRY || 1;
    return +(Number(v || 0) * rate).toFixed(2);
  }
  function latestValue(row) {
    const v = row.latest_valuation;
    if (!v) return null;
    return { id: v.id, value: Number(v.value) || 0, cur: v.currency || 'TRY', tryValue: v.value_try != null ? Number(v.value_try) : toTRY(v.value, v.currency), date: v.valued_at, source: v.source || 'manual', note: v.note || '' };
  }
  function latestBalance(row) {
    const b = row.latest_balance;
    if (!b) return null;
    return { id: b.id, value: Number(b.balance) || 0, cur: b.currency || 'TRY', tryValue: b.balance_try != null ? Number(b.balance_try) : toTRY(b.balance, b.currency), date: b.balanced_at, source: b.source || 'manual', note: b.note || '' };
  }
  function fromAsset(row) {
    return {
      id: row.id, accountId: row.account_id || null, name: row.name || '', type: row.type || 'other', subtype: row.subtype || '',
      cur: row.currency || 'TRY', ownership: row.ownership_percentage != null ? Number(row.ownership_percentage) : 100,
      liquidity: row.liquidity || 'short_term', valuationMode: row.valuation_mode || 'manual',
      institution: row.institution || '', desc: row.description || '', include: row.include_in_net_worth !== false,
      active: row.is_active !== false, acquiredAt: row.acquired_at || '', acquisitionCost: row.acquisition_cost != null ? Number(row.acquisition_cost) : null,
      latest: latestValue(row), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  function toAsset(item) {
    return {
      account_id: item.accountId || null, name: item.name, type: item.type || 'other', subtype: item.subtype || null,
      currency: item.cur || 'TRY', ownership_percentage: Number(item.ownership) || 100,
      liquidity: item.liquidity || null, valuation_mode: item.valuationMode || 'manual',
      institution: item.institution || null, description: item.desc || null,
      include_in_net_worth: item.include !== false, is_active: item.active !== false,
      acquired_at: item.acquiredAt || null, acquisition_cost: item.acquisitionCost == null || item.acquisitionCost === '' ? null : Number(item.acquisitionCost),
    };
  }
  function fromLiability(row) {
    return {
      id: row.id, accountId: row.account_id || null, securedAssetId: row.secured_asset_id || null, name: row.name || '', type: row.type || 'other',
      cur: row.currency || 'TRY', originalPrincipal: row.original_principal != null ? Number(row.original_principal) : null,
      interestRate: row.interest_rate != null ? Number(row.interest_rate) : null, minimumPayment: row.minimum_payment != null ? Number(row.minimum_payment) : null,
      paymentFrequency: row.payment_frequency || '', startDate: row.start_date || '', maturityDate: row.maturity_date || '',
      include: row.include_in_net_worth !== false, active: row.is_active !== false, note: row.note || '', latest: latestBalance(row),
      createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  function toLiability(item) {
    return {
      account_id: item.accountId || null, secured_asset_id: item.securedAssetId || null, name: item.name, type: item.type || 'other',
      currency: item.cur || 'TRY', original_principal: item.originalPrincipal == null || item.originalPrincipal === '' ? null : Number(item.originalPrincipal),
      interest_rate: item.interestRate == null || item.interestRate === '' ? null : Number(item.interestRate),
      minimum_payment: item.minimumPayment == null || item.minimumPayment === '' ? null : Number(item.minimumPayment),
      payment_frequency: item.paymentFrequency || null, start_date: item.startDate || null, maturity_date: item.maturityDate || null,
      include_in_net_worth: item.include !== false, is_active: item.active !== false, note: item.note || null,
    };
  }
  async function json(res, fallback) {
    if (!res.ok) {
      let msg = fallback + ' (' + res.status + ')';
      try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch (e) {}
      throw new Error(msg);
    }
    return res.status === 204 ? null : res.json();
  }

  async function listAssets() { return (await json(await api()('/api/assets/'), 'Failed to load assets')).map(fromAsset); }
  async function createAsset(item) { return fromAsset(await json(await api()('/api/assets/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toAsset(item)) }), 'Failed to create asset')); }
  async function updateAsset(id, item) { return fromAsset(await json(await api()('/api/assets/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toAsset(item)) }), 'Failed to update asset')); }
  async function removeAsset(id) { await json(await api()('/api/assets/' + id, { method: 'DELETE' }), 'Failed to delete asset'); return true; }
  async function addValuation(assetId, item) {
    return json(await api()('/api/assets/' + assetId + '/valuations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: Number(item.value) || 0, currency: item.cur || 'TRY', valued_at: item.date, source: item.source || 'manual', note: item.note || null }),
    }), 'Failed to add valuation');
  }
  async function listLiabilities() { return (await json(await api()('/api/liabilities/'), 'Failed to load liabilities')).map(fromLiability); }
  async function createLiability(item) { return fromLiability(await json(await api()('/api/liabilities/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toLiability(item)) }), 'Failed to create liability')); }
  async function updateLiability(id, item) { return fromLiability(await json(await api()('/api/liabilities/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toLiability(item)) }), 'Failed to update liability')); }
  async function removeLiability(id) { await json(await api()('/api/liabilities/' + id, { method: 'DELETE' }), 'Failed to delete liability'); return true; }
  async function addBalance(liabilityId, item) {
    return json(await api()('/api/liabilities/' + liabilityId + '/balances', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ balance: Number(item.value) || 0, currency: item.cur || 'TRY', balanced_at: item.date, source: item.source || 'manual', note: item.note || null }),
    }), 'Failed to add balance');
  }
  async function summary() { return json(await api()('/api/net-worth/summary'), 'Failed to load net worth'); }

  window.HL_ASSET_DOMAIN = {
    ASSET_TYPES, LIABILITY_TYPES, LIQUIDITY, VALUATION_MODE,
    listAssets, createAsset, updateAsset, removeAsset, addValuation,
    listLiabilities, createLiability, updateLiability, removeLiability, addBalance,
    summary, toTRY,
  };
})();
