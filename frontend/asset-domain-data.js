// asset-domain-data.js — Assets, holdings, and net-worth API client.
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
  async function summary() { return json(await api()('/api/net-worth/summary'), 'Failed to load net worth'); }

  window.HL_ASSET_DOMAIN = {
    ASSET_TYPES, LIQUIDITY, VALUATION_MODE,
    listAssets, createAsset, updateAsset, removeAsset, addValuation,
    summary, toTRY,
  };
})();
