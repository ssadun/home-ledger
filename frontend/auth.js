// auth.js — JWT token management for Home Ledger.
// Stores token in localStorage so it persists across page reloads.
// All pages (except Login.html) should call HL_AUTH.requireAuth() on load.

(function () {
  const TOKEN_KEY = 'hl-token';
  const USER_KEY  = 'hl-user';

  function getToken()  { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
  function getUser()   { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch (e) { return null; } }

  function setSession(token, user) {
    try {
      localStorage.setItem(TOKEN_KEY, token);
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } catch (e) {}
  }

  function clearSession() {
    try {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) {}
  }

  // Redirect to Login if no token is present.
  function requireAuth() {
    if (!getToken()) {
      window.location.href = '/Login.html';
    }
  }

  // Call the backend /api/auth/login with username+password.
  // Returns { ok: true, token, user } or { ok: false, error }.
  async function login(username, password) {
    const body = new URLSearchParams({ username, password });
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        return { ok: false, error: data.detail || 'Invalid credentials' };
      }
      const data = await res.json();
      const token = data.access_token;
      // Fetch the current user profile
      const meRes = await fetch('/api/auth/me', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const user = meRes.ok ? await meRes.json() : {};
      setSession(token, user);
      return { ok: true, token, user };
    } catch (err) {
      return { ok: false, error: 'Could not reach the server. Please try again.' };
    }
  }

  function logout() {
    clearSession();
    window.location.href = '/Login.html';
  }

  // Return an Authorization header object for fetch calls.
  function authHeader() {
    const token = getToken();
    return token ? { Authorization: 'Bearer ' + token } : {};
  }

  // Convenience: authenticated fetch wrapper.
  async function apiFetch(path, opts = {}) {
    const token = getToken();
    const res = await fetch(path, {
      ...opts,
      headers: {
        ...(opts.headers || {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
      },
    });
    if (res.status === 401) {
      clearSession();
      window.location.href = '/Login.html';
      throw new Error('Unauthorized');
    }
    return res;
  }

  window.HL_AUTH = { getToken, getUser, setSession, clearSession, requireAuth, login, logout, authHeader, apiFetch };
})();
