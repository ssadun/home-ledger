// statement-mappings-data.js — Statement Value Mapping API client (Configuration page).
// Maps between the backend StatementMapping row and the config-app item shape
// { id, lang, etiket, category_key }. Drives the importer's Etiket→category rule.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  function fromApi(row) {
    return {
      id: row.id,
      lang: row.lang || 'tr',
      etiket: row.etiket || '',
      category_key: row.category_key || '',
    };
  }

  function toApi(item) {
    return {
      lang: item.lang || 'tr',
      etiket: item.etiket,
      category_key: item.category_key,
    };
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
    if (!res.ok) throw new Error('Failed to create statement mapping (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/statement-mappings/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to update statement mapping (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/statement-mappings/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete statement mapping (' + res.status + ')');
    return true;
  }

  window.HL_STATEMENT_MAPPINGS_API = { list, create, update, remove, fromApi, toApi };
})();
