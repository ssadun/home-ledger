// statement-mappings-data.js — Statement Value Mapping API client (Configuration page).
// Maps between the backend StatementMapping row and the config-app item shape
// { id, lang, etiket, category_key, match_scope, priority, is_active }.
// Comma-separated aliases stay grouped in the UI and are flattened by the backend.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  function fromApi(row) {
    return {
      id: row.id,
      lang: row.lang || 'tr',
      etiket: row.etiket || '',
      category_key: row.category_key || '',
      match_scope: row.match_scope || 'both',
      priority: row.priority == null ? 100 : Number(row.priority),
      is_active: row.is_active !== false,
    };
  }

  function toApi(item) {
    return {
      lang: item.lang || 'tr',
      etiket: item.etiket,
      category_key: item.category_key,
      match_scope: item.match_scope || 'both',
      priority: item.priority == null || item.priority === '' ? 100 : Number(item.priority),
      is_active: item.is_active !== false,
    };
  }

  async function errorText(res, fallback) {
    let message = fallback + ' (' + res.status + ')';
    try { const body = await res.json(); if (body && body.detail) message = body.detail; } catch (_) {}
    return message;
  }

  async function list() {
    const res = await api()('/api/statement-mappings/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load statement mappings (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/statement-mappings/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errorText(res, 'Failed to create statement mapping'));
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/statement-mappings/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errorText(res, 'Failed to update statement mapping'));
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/statement-mappings/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete statement mapping (' + res.status + ')');
    return true;
  }

  window.HL_STATEMENT_MAPPINGS_API = { list, create, update, remove, fromApi, toApi };
})();
