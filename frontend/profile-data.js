// profile-data.js — client for the signed-in user's own profile (/api/auth/me).
//
// Distinct from members-data.js on purpose: that one is the ADMIN client for the
// Configuration → Members screen and can address any member by id. Everything
// here is scoped to "me" by the JWT, and the backend refuses to set role/active
// through these routes, so the Profile page can never escalate a privilege.
(function () {
  const api = (path, opts) => window.HL_AUTH.apiFetch(path, opts);

  async function readErr(res, fallback) {
    const data = await res.json().catch(() => ({}));
    return data.detail || fallback;
  }

  // GET the full profile. Note this is the SAME endpoint auth.js calls at login,
  // which now returns username/role/language/avatar_url as well — the cached
  // `hl-user` blob from an older session simply lacks those keys.
  async function get() {
    const res = await api('/api/auth/me');
    if (!res.ok) throw new Error(await readErr(res, 'Could not load your profile.'));
    return res.json();
  }

  async function update(patch) {
    const res = await api('/api/auth/me', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await readErr(res, 'Could not save your profile.'));
    return res.json();
  }

  async function changePassword(currentPassword, newPassword) {
    const res = await api('/api/auth/me/password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
    });
    if (!res.ok) throw new Error(await readErr(res, 'Could not change your password.'));
    return res.json();
  }

  // Multipart upload. Deliberately NO Content-Type header — the browser has to
  // set it itself so the multipart boundary is included; hardcoding
  // 'multipart/form-data' produces a body FastAPI cannot parse.
  async function uploadAvatar(file) {
    const body = new FormData();
    body.append('file', file);
    const res = await api('/api/auth/me/avatar', { method: 'POST', body });
    if (!res.ok) throw new Error(await readErr(res, 'Could not upload the picture.'));
    return res.json();
  }

  async function deleteAvatar() {
    const res = await api('/api/auth/me/avatar', { method: 'DELETE' });
    if (!res.ok) throw new Error(await readErr(res, 'Could not remove the picture.'));
    return res.json();
  }

  // Keep the cached `hl-user` blob (written by auth.js at login) in step, so the
  // sidebar avatar and any other consumer see an edit without a re-login.
  function syncSession(profile) {
    try {
      const token = window.HL_AUTH.getToken();
      if (token) window.HL_AUTH.setSession(token, profile);
    } catch (e) { /* storage disabled — the page still has the live value */ }
    window.dispatchEvent(new CustomEvent('hl-profile-change', { detail: profile }));
  }

  // Initials for the no-picture fallback: first letters of the first two words,
  // falling back to the username, then the email local part.
  function initials(profile) {
    const src = (profile && (profile.full_name || profile.username || (profile.email || '').split('@')[0])) || '';
    const parts = String(src).trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  // Deterministic colour for the initials avatar, so a given person is always the
  // same colour everywhere without storing one. Uses theme tokens rather than
  // literals so it follows light/dark.
  const AVATAR_TOKENS = [
    '--accent', '--lavender', '--green', '--orange', '--sky',
    '--pink', '--emerald', '--gold', '--fuchsia', '--coral',
  ];
  function avatarColor(profile) {
    const key = String((profile && (profile.username || profile.email || profile.id)) || '');
    let h = 0;
    for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
    return `var(${AVATAR_TOKENS[h % AVATAR_TOKENS.length]})`;
  }

  window.HL_PROFILE_API = {
    get, update, changePassword, uploadAvatar, deleteAvatar,
    syncSession, initials, avatarColor,
    LANGUAGES: [
      { value: 'en', label: 'English' },
      { value: 'tr', label: 'Türkçe' },
    ],
  };
})();
