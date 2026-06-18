// members-data.js — Members API client (used by the Configuration page).
// Members reuse the backend Users table; maps between a User row and the
// config-app item shape { id, name, username, password, role, active }.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);

  function fromApi(row) {
    return {
      id: row.id,
      name: row.name || '',
      username: row.username || '',
      password: '',                       // never returned by the backend
      role: row.role || 'user',
      active: row.active !== false,
    };
  }

  // Build the create/update body. Password is only sent when the user typed one
  // (so an edit that leaves the masked field blank keeps the existing password).
  function toApi(item, { withPassword } = {}) {
    const body = {
      name: item.name,
      username: item.username,
      role: item.role || 'user',
      active: item.active !== false,
    };
    if (withPassword && item.password) body.password = item.password;
    return body;
  }

  async function list() {
    const res = await api()('/api/members/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load members (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const body = toApi(item, { withPassword: true });
    if (!body.password) throw new Error('Password is required');
    const res = await api()('/api/members/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error('Failed to create member (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/members/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item, { withPassword: true })),
    });
    if (!res.ok) throw new Error('Failed to update member (' + res.status + ')');
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/members/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error('Failed to delete member (' + res.status + ')');
    return true;
  }

  window.HL_MEMBERS_API = { list, create, update, remove, fromApi, toApi };
})();
