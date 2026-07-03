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
    const key = String(accountName || '').trim().toLowerCase();
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
    return fromApi(await res.json());
  }
  async function remove(id) {
    const res = await api()('/api/investments/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete investment (' + res.status + ')');
    return true;
  }

  window.INVESTMENTS_DATA = { ASSET_TYPES, costBasisOf };
  window.HL_INVESTMENTS_API = { list, listForAccount, create, update, remove };
})();
