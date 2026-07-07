// categories-data.js — Categories API client (used by the Configuration page).
// Maps between the backend Category row and the config-app item shape
// { id, key, label, icon, color, kind }.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  function fromApi(row) {
    return {
      id: row.id,
      key: row.key || '',
      label: row.name,
      icon: row.icon || 'circle',
      color: row.color || 'var(--lavender)',
      kind: row.kind || (row.type === 'income' ? 'income' : 'expense'),
    };
  }

  function toApi(item) {
    return {
      key: item.key,
      name: item.label,
      icon: item.icon,
      color: item.color,
      kind: item.kind || 'expense',
    };
  }

  async function list() {
    const res = await api()('/api/categories/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load categories (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  // Surface the backend's `detail` (e.g. the duplicate-key 409 message) so the
  // caller's alert is actionable instead of a bare status code.
  async function errMsg(res, fallback) {
    let msg = fallback + ' (' + res.status + ')';
    try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch (_) {}
    return msg;
  }

  async function create(item) {
    const res = await api()('/api/categories/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errMsg(res, 'Failed to create category'));
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/categories/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errMsg(res, 'Failed to update category'));
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/categories/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete category (' + res.status + ')');
    return true;
  }

  // Rebuild window.LEDGER.CATS (the global icon/color/label lookup other pages read)
  // from the DB, mutating the existing object in place so references stay valid.
  async function hydrateLedgerCats() {
    if (!(window.LEDGER && window.LEDGER.CATS)) return;
    try {
      const cats = await list();
      const dict = window.LEDGER.CATS;
      Object.keys(dict).forEach(k => delete dict[k]);
      cats.forEach(c => {
        if (!c.key) return;
        dict[c.key] = { label: c.label, icon: c.icon, color: c.color, kind: c.kind };
      });
    } catch (e) { /* keep static fallback on failure */ }
  }

  window.HL_CATEGORIES_API = { list, create, update, remove, fromApi, toApi, hydrateLedgerCats };
})();
