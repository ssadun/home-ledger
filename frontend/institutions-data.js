// institutions-data.js — Financial Institutions API client (banks/providers + logos).
//
// These used to live in localStorage as a client-persisted config section, which
// meant a logo uploaded in one browser was invisible everywhere else. They now
// persist to the backend `financial_institutions` table.
//
// Two consumers, two shapes:
//   • config-app.jsx wants a LIST of { id, key, name, shortName, swift, logo } rows.
//   • accounts-data.js / accounts-components.jsx / import.jsx want the keyed MAP
//     window.ACCOUNTS_DATA.FINANCIAL_INSTITUTIONS = { key: {name, shortName, swift, logo} }.
// hydrate() fills that map IN PLACE — accounts-components.jsx and import.jsx
// destructure it at module load, so replacing the object would leave them holding
// a stale reference.
(function () {
  const api = () => (window.HL_AUTH && window.HL_AUTH.apiFetch);
  const LEGACY_KEY = 'hl-cfg-financial-institutions-data';
  const MIGRATED_KEY = 'hl-cfg-financial-institutions-data.migrated';

  function fromApi(row) {
    return {
      id: row.id,
      key: row.key,
      name: row.name || '',
      shortName: row.short_name ?? row.shortName ?? '',
      swift: row.swift || '',
      logo: row.logo || '',
    };
  }

  function toApi(item) {
    const shortName = item.shortName ?? item.short_name ?? '';
    return {
      key: item.key,
      name: item.name,
      short_name: shortName,
      swift: item.swift || null,
      logo: item.logo || null,
    };
  }

  async function list() {
    const res = await api()('/api/institutions/', { method: 'GET' });
    if (!res.ok) throw new Error('Failed to load institutions (' + res.status + ')');
    return (await res.json()).map(fromApi);
  }

  async function create(item) {
    const res = await api()('/api/institutions/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errText(res, 'create institution'));
    return fromApi(await res.json());
  }

  async function update(id, item) {
    const res = await api()('/api/institutions/' + id, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toApi(item)),
    });
    if (!res.ok) throw new Error(await errText(res, 'update institution'));
    return fromApi(await res.json());
  }

  async function remove(id) {
    const res = await api()('/api/institutions/' + id, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(await errText(res, 'delete institution'));
    return true;
  }

  async function errText(res, what) {
    let msg = 'Failed to ' + what + ' (' + res.status + ')';
    try { const j = await res.json(); if (j && j.detail) msg = j.detail; } catch (e) { /* non-JSON body */ }
    return msg;
  }

  // ── One-time migration of logos uploaded before this moved to the DB ────────
  // Those logos exist ONLY in this browser's localStorage, so push them up before
  // the map is replaced by server data or they are lost. Only fills gaps: an
  // institution that already has a logo on the server is left alone, so running
  // this from a second browser can't clobber the first one's work.
  // The old key is renamed rather than deleted — a hand-recoverable backup.
  async function migrateLegacyLogos(serverRows) {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null'); }
    catch (e) { return serverRows; }
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return serverRows;

    const byKey = {};
    serverRows.forEach(r => { byKey[r.key] = r; });
    let changed = false;

    for (const key of Object.keys(saved)) {
      const local = saved[key] || {};
      if (!local.logo) continue;                       // only logos are unrecoverable
      const row = byKey[key];
      try {
        if (!row) {
          // An institution the user added locally; recreate it wholesale.
          const made = await create({ key, name: local.name || key, shortName: local.shortName || local.name || key, swift: local.swift, logo: local.logo });
          byKey[key] = made;
          changed = true;
        } else if (!row.logo) {
          byKey[key] = await update(row.id, { ...row, logo: local.logo });
          changed = true;
        }
      } catch (e) {
        console.warn('[institutions] could not migrate logo for "' + key + '":', e.message);
        return serverRows;   // leave the legacy key in place so it can be retried
      }
    }

    try {
      localStorage.setItem(MIGRATED_KEY, localStorage.getItem(LEGACY_KEY));
      localStorage.removeItem(LEGACY_KEY);
    } catch (e) { /* quota/unavailable — harmless, migration is idempotent */ }

    if (changed) console.info('[institutions] migrated local logos to the database.');
    return Object.values(byKey);
  }

  // Fill ACCOUNTS_DATA.FINANCIAL_INSTITUTIONS in place from the server (running the
  // legacy-logo migration first). Resolves to the row list. Callers that render
  // logos should re-render once this settles.
  async function hydrate() {
    let rows = await list();
    rows = await migrateLegacyLogos(rows);
    const map = window.ACCOUNTS_DATA && window.ACCOUNTS_DATA.FINANCIAL_INSTITUTIONS;
    if (map) {
      Object.keys(map).forEach(k => { delete map[k]; });
      rows.forEach(r => { map[r.key] = { name: r.name, shortName: r.shortName, swift: r.swift, logo: r.logo || undefined }; });
    }
    return rows;
  }

  window.HL_INSTITUTIONS_API = { list, create, update, remove, hydrate, fromApi, toApi };
})();
