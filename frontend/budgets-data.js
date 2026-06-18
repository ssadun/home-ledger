// budgets-data.js — Budgets API client.
// Budgets are keyed by category (one per category). The UI works with a dict
// { [cat]: { limit, start, end, id } }; the backend stores rows with category_key.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  // Status thresholds (fraction of limit spent) — unchanged from the static module.
  const WARN_AT = 0.8;   // ≥80% used → "near limit"
  const OVER_AT = 1.0;   // >100% used → "over budget"

  // category_key → backend id, populated by list(); used to decide create vs update.
  let idByCat = {};

  function rowToEntry(row) {
    return { limit: row.amount, start: row.start_date || '', end: row.end_date || '', id: row.id };
  }

  async function list() {
    const res = await api()('/api/budgets/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load budgets (' + res.status + ')');
    const rows = await res.json();
    idByCat = {};
    const dict = {};
    rows.forEach(r => {
      if (!r.category_key) return;
      idByCat[r.category_key] = r.id;
      dict[r.category_key] = rowToEntry(r);
    });
    return dict;
  }

  // Upsert a budget for a category. Returns the new entry { limit, start, end, id }.
  async function save(cat, { limit, start, end }) {
    const payload = {
      category_key: cat,
      name: cat,
      amount: Number(limit) || 0,
      start_date: start || null,
      end_date: end || null,
    };
    let res;
    if (idByCat[cat]) {
      res = await api()('/api/budgets/' + idByCat[cat], {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      res = await api()('/api/budgets/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    if (!res.ok) throw new Error('Failed to save budget (' + res.status + ')');
    const row = await res.json();
    idByCat[cat] = row.id;
    return rowToEntry(row);
  }

  async function remove(cat) {
    const id = idByCat[cat];
    if (id) {
      const res = await api()('/api/budgets/' + id, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error('Failed to delete budget (' + res.status + ')');
      delete idByCat[cat];
    }
    return true;
  }

  // BUDGETS starts empty and is hydrated by the page via list(); kept for any
  // legacy reads that expect window.BUDGETS_DATA.BUDGETS to exist.
  window.BUDGETS_DATA = { BUDGETS: {}, WARN_AT, OVER_AT };
  window.HL_BUDGETS_API = { list, save, remove };
})();
