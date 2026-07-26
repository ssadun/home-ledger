// local-holidays-data.js — Local Holidays API client (Configuration page).
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  function fromApi(row) {
    return {
      id: row.id,
      country: row.country || 'TR',
      date: row.date || '',
      name: row.name || '',
      isHalfDay: !!row.is_half_day,
      affectsDueDates: row.affects_due_dates !== false,
      active: row.is_active !== false,
    };
  }

  function toApi(item) {
    return {
      country: (item.country || 'TR').trim().toUpperCase(),
      date: item.date,
      name: item.name,
      is_half_day: !!item.isHalfDay,
      affects_due_dates: item.affectsDueDates !== false,
      is_active: item.active !== false,
    };
  }

  async function list() {
    const res = await api()('/api/local-holidays/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load local holidays (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/local-holidays/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to create local holiday (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/local-holidays/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error('Failed to update local holiday (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/local-holidays/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete local holiday (' + res.status + ')');
    return true;
  }

  window.HL_LOCAL_HOLIDAYS_API = { list, create, update, remove, fromApi, toApi };
})();
