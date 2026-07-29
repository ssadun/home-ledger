// asset-domain-data.js — Assets, holdings, and net-worth API client.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);
  const FX = () => (window.LEDGER && window.LEDGER.FX) || { TRY: { toTRY: 1 }, USD: { toTRY: 1 }, EUR: { toTRY: 1 } };

  const ASSET_TYPES = {
    liquid: { label: 'Liquid Assets (Bank Accounts, Cash)', icon: 'landmark', color: 'var(--green)' },
    physical: { label: 'Physical Assets (House, Land, Vehicle, Precious Metals)', icon: 'home', color: 'var(--sky)' },
    investment: { label: 'Investment Assets (Stocks, Funds, Stock Market Investments)', icon: 'trending-up', color: 'var(--emerald)' },
    retirement: { label: 'Retirement Securities (Private Pension Systems (BES), Pension Funds)', icon: 'piggy-bank', color: 'var(--lime)' },
    other: { label: 'Other Assets', icon: 'box', color: 'var(--steel)' },
  };
  const LEGACY_ASSET_TYPES = {
    cash: 'liquid',
    bank_account: 'liquid',
    real_estate: 'physical',
    vehicle: 'physical',
    gold: 'physical',
    precious_metals: 'physical',
    collectible: 'physical',
    crypto: 'investment',
    business: 'other',
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
  const PHYSICAL_SUBTYPES = {
    house: 'House / Apartment',
    land: 'Land',
    vehicle: 'Vehicle',
    precious_metals: 'Precious Metals',
    collectible: 'Collectible',
    other: 'Other Physical Asset',
  };
  const PHYSICAL_SUBTYPE_ICONS = {
    house: 'house',
    land: 'map',
    vehicle: 'car-front',
    precious_metals: 'coins',
    collectible: 'gem',
    other: 'box',
  };

  function toTRY(v, cur) {
    const rate = (FX()[cur] || FX().TRY || { toTRY: 1 }).toTRY || 1;
    return +(Number(v || 0) * rate).toFixed(2);
  }
  function normalizeAssetType(type) {
    const key = String(type || '').trim();
    return ASSET_TYPES[key] ? key : (LEGACY_ASSET_TYPES[key] || 'other');
  }
  function latestValue(row) {
    const v = row.latest_valuation;
    if (!v) return null;
    return { id: v.id, value: Number(v.value) || 0, cur: v.currency || 'TRY', tryValue: v.value_try != null ? Number(v.value_try) : toTRY(v.value, v.currency), date: v.valued_at, source: v.source || 'manual', note: v.note || '' };
  }
  function fromAsset(row) {
    return {
      id: row.id, accountId: row.account_id || null, name: row.name || '', type: normalizeAssetType(row.type), subtype: row.subtype || '',
      cur: row.currency || 'TRY', ownership: row.ownership_percentage != null ? Number(row.ownership_percentage) : 100,
      liquidity: row.liquidity || 'short_term', valuationMode: row.valuation_mode || 'manual',
      institution: row.institution || '', desc: row.description || '', include: row.include_in_net_worth !== false,
      active: row.is_active !== false, acquiredAt: row.acquired_at || '', acquisitionCost: row.acquisition_cost != null ? Number(row.acquisition_cost) : null,
      latest: latestValue(row), createdAt: row.created_at, updatedAt: row.updated_at,
    };
  }
  function toAsset(item) {
    return {
      account_id: item.accountId || null, name: item.name, type: normalizeAssetType(item.type), subtype: item.subtype || null,
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
  async function listPhysicalAssets() { return (await json(await api()('/api/assets/physical'), 'Failed to load physical assets')).map(fromAsset); }
  async function createPhysicalAsset(item) { return fromAsset(await json(await api()('/api/assets/physical', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toAsset({ ...item, type: 'physical', valuationMode: 'manual', accountId: null })) }), 'Failed to create physical asset')); }
  async function updatePhysicalAsset(id, item) { return fromAsset(await json(await api()('/api/assets/physical/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toAsset({ ...item, type: 'physical', valuationMode: 'manual', accountId: null })) }), 'Failed to update physical asset')); }
  async function removePhysicalAsset(id) { await json(await api()('/api/assets/physical/' + id, { method: 'DELETE' }), 'Failed to delete physical asset'); return true; }
  async function createAsset(item) { return fromAsset(await json(await api()('/api/assets/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toAsset(item)) }), 'Failed to create asset')); }
  async function updateAsset(id, item) { return fromAsset(await json(await api()('/api/assets/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(toAsset(item)) }), 'Failed to update asset')); }
  async function removeAsset(id) { await json(await api()('/api/assets/' + id, { method: 'DELETE' }), 'Failed to delete asset'); return true; }
  async function addValuation(assetId, item) {
    return json(await api()('/api/assets/' + assetId + '/valuations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: Number(item.value) || 0, currency: item.cur || 'TRY', valued_at: item.date, source: item.source || 'manual', note: item.note || null }),
    }), 'Failed to add valuation');
  }
  async function addPhysicalValuation(assetId, item) {
    return json(await api()('/api/assets/physical/' + assetId + '/valuations', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ value: Number(item.value) || 0, currency: item.cur || 'TRY', valued_at: item.date, source: item.source || 'manual', note: item.note || null }),
    }), 'Failed to add physical asset valuation');
  }
  async function summary() { return json(await api()('/api/net-worth/summary'), 'Failed to load net worth'); }

  window.HL_ASSET_DOMAIN = {
    ASSET_TYPES, LIQUIDITY, VALUATION_MODE, PHYSICAL_SUBTYPES, PHYSICAL_SUBTYPE_ICONS,
    listAssets, createAsset, updateAsset, removeAsset, addValuation,
    listPhysicalAssets, createPhysicalAsset, updatePhysicalAsset, removePhysicalAsset, addPhysicalValuation,
    summary, toTRY,
  };
})();
