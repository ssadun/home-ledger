// currencies-data.js — Currencies API client (used by the Configuration page).
// Maps between the backend CurrencyRate row and the config-app item shape
// { id, code, toTRY, toUSD, asOf, source, history: [{date, toTRY, toUSD, source, note}] }.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  function fromApi(row) {
    return {
      id: row.id,
      code: row.code,
      toTRY: row.to_try,
      toUSD: row.to_usd,
      asOf: row.as_of || null,
      source: row.source || null,
      history: Array.isArray(row.history) ? row.history : [],
    };
  }

  function toApi(item) {
    return {
      code: item.code,
      to_try: item.toTRY != null ? Number(item.toTRY) : null,
      to_usd: item.toUSD != null ? Number(item.toUSD) : null,
      as_of: item.asOf || null,
      source: item.source || null,
      history: Array.isArray(item.history) ? item.history : [],
    };
  }

  async function list() {
    const res = await api()('/api/currencies/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load currencies (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/currencies/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to create currency (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/currencies/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to update currency (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/currencies/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete currency (' + res.status + ')');
    return true;
  }

  window.HL_CURRENCIES_API = { list, create, update, remove, fromApi, toApi };
})();
