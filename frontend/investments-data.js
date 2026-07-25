// investments-data.js — Investments (portfolio) API client + asset-type metadata.
// Holdings live under an Accounts-page account of type "invest": a holding's
// `platform` matches the invest account's name (e.g. "Midas"). Records are also
// created by the Midas portfolio import (import.jsx → /api/import/confirm-investments).
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);
  const FX = () => (window.LEDGER && window.LEDGER.FX) || null;

  // Asset type → Lucide icon + accent color + label. Keys match the backend
  // Investment.asset_type vocabulary (stock, fund, gold, crypto, deposit, usd).
  const ASSET_TYPES = {
    stock:   { label: 'Stock',     icon: 'trending-up', color: 'var(--accent)'   },
    fund:    { label: 'Fund',      icon: 'layers',      color: 'var(--lavender)' },
    gold:    { label: 'Gold',      icon: 'gem',         color: 'var(--yellow)'   },
    crypto:  { label: 'Crypto',    icon: 'bitcoin',     color: 'var(--orange)'   },
    deposit: { label: 'Deposit',   icon: 'piggy-bank',  color: 'var(--green)'    },
    usd:     { label: 'FX / Cash', icon: 'banknote',    color: 'var(--emerald)'  },
  };

  // Cost basis = quantity × unit cost when a unit price is known; otherwise the
  // amount is already the invested value (deposits, cash positions).
  function costBasisOf(qty, price) {
    return price != null && price !== '' ? qty * price : qty;
  }

  function withConverted(item) {
    const fx = FX();
    item.costBasis = +costBasisOf(item.qty, item.price).toFixed(2);
    if (fx && fx[item.cur]) {
      item.tryValue = +(item.costBasis * fx[item.cur].toTRY).toFixed(2);
      item.usdValue = +(item.costBasis * fx[item.cur].toUSD).toFixed(2);
    } else {
      item.tryValue = item.costBasis;
      item.usdValue = item.costBasis;
    }
    return item;
  }

  function fromApi(row) {
    return withConverted({
      id: row.id,
      name: row.name || '',
      platform: row.platform || '',
      assetType: row.asset_type || 'stock',
      cur: row.currency || 'TRY',
      qty: Number(row.amount) || 0,
      price: row.purchase_price != null ? Number(row.purchase_price) : null,
      purchaseDate: row.purchase_date || null,
      note: row.note || '',
      updatedAt: row.updated_at || null,
    });
  }
  function fromHolding(row) {
    const current = row.current_price != null ? Number(row.current_price) : null;
    const avg = row.average_cost != null ? Number(row.average_cost) : null;
    return withConverted({
      id: row.legacy_investment_id || ('h-' + row.id),
      holdingId: row.id,
      assetId: row.asset_id,
      legacyId: row.legacy_investment_id || null,
      name: row.name || '',
      platform: '',
      assetType: row.asset_class || 'stock',
      cur: row.currency || 'TRY',
      qty: Number(row.quantity) || 0,
      price: avg,
      currentPrice: current,
      priceAsOf: row.price_as_of || '',
      priceSource: row.price_source || '',
      note: row.note || '',
      updatedAt: row.updated_at || null,
    });
  }
  function toHolding(item) {
    return {
      asset_id: item.assetId,
      legacy_investment_id: item.legacyId || null,
      symbol: (item.name || '').split(' - ')[0],
      name: item.name,
      asset_class: item.assetType || 'stock',
      currency: item.cur || 'TRY',
      quantity: Number(item.qty) || 0,
      average_cost: (item.price === '' || item.price == null) ? null : Number(item.price),
      current_price: (item.currentPrice === '' || item.currentPrice == null) ? null : Number(item.currentPrice),
      price_as_of: item.priceAsOf || null,
      price_source: item.priceSource || null,
      note: item.note || null,
      is_active: true,
    };
  }

  function toApi(item) {
    return {
      name: item.name,
      platform: item.platform || null,
      asset_type: item.assetType || 'stock',
      currency: item.cur || 'TRY',
      amount: Number(item.qty) || 0,
      purchase_price: (item.price === '' || item.price == null) ? null : Number(item.price),
      purchase_date: item.purchaseDate || null,
      note: item.note || null,
    };
  }

  async function list() {
    const res = await api()('/api/investments/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load investments (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }
  // Holdings for one invest account, matched by platform == account name.
  async function listForAccount(accountName) {
    if (window.HL_AUTH && window.HL_AUTH.apiFetch) {
      const platform = typeof accountName === 'object' ? accountName.name : accountName;
      const params = typeof accountName === 'object' && accountName._dbId
        ? '?account_id=' + encodeURIComponent(accountName._dbId)
        : '?legacy_platform=' + encodeURIComponent(platform || '');
      try {
        const res = await api()('/api/holdings/' + params, { method: 'GET' });
        if (res.ok) {
          const rows = (await res.json()).map(fromHolding);
          if (rows.length) return rows;
        }
      } catch (e) {}
    }
    const key = String((typeof accountName === 'object' ? accountName.name : accountName) || '').trim().toLowerCase();
    return (await list()).filter(h => (h.platform || '').trim().toLowerCase() === key);
  }
  async function create(item) {
    const res = await api()('/api/investments/', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to create investment (' + res.status + ')');
    return fromApi(await res.json());
  }
  async function update(id, item) {
    if (item.holdingId && !item.legacyId) {
      const res = await api()('/api/holdings/' + item.holdingId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toHolding(item)),
      });
      if (!res.ok) throw new Error('Failed to update holding (' + res.status + ')');
      return fromHolding(await res.json());
    }
    // The backend PATCH schema accepts name/amount/purchase_price/note only;
    // asset_type/currency/platform are fixed at create time (or by the import).
    const res = await api()('/api/investments/' + id, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: item.name,
        amount: Number(item.qty) || 0,
        purchase_price: (item.price === '' || item.price == null) ? null : Number(item.price),
        note: item.note || null,
      }),
    });
    if (!res.ok) throw new Error('Failed to update investment (' + res.status + ')');
    const legacy = fromApi(await res.json());
    if (item.holdingId) {
      const hres = await api()('/api/holdings/' + item.holdingId, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(toHolding({ ...item, legacyId: legacy.id, assetId: item.assetId })),
      });
      if (hres.ok) return fromHolding(await hres.json());
    }
    return legacy;
  }
  async function remove(id) {
    if (String(id).startsWith('h-')) {
      const hid = String(id).slice(2);
      const res = await api()('/api/holdings/' + hid, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete holding (' + res.status + ')');
      return true;
    }
    const res = await api()('/api/investments/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete investment (' + res.status + ')');
    return true;
  }

  window.INVESTMENTS_DATA = { HOLDINGS: [], ASSET_TYPES, costBasisOf };
  window.HL_INVESTMENTS_API = { list, listForAccount, create, update, remove };
})();
