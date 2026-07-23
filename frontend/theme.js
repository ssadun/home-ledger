// ═══════════════════════════════════════════════════════════════════════════
// theme.js — light/dark theme switch for Home Ledger.
//
// Loaded SYNCHRONOUSLY in <head>, before the stylesheets, on every page. That
// placement is the whole point: the persisted theme is written onto <html> in
// the first parse pass, so the very first frame paints in the right theme and
// there is no light-to-dark flash. Moving this to the bottom of <body> (where
// menu.js lives) would reintroduce the flash.
//
// Theme is a plain attribute on the root element — `data-theme="dark|light"` —
// which styles/tokens.css and styles/login.css select on. Dark is the default
// for anyone who has never touched the toggle.
// ═══════════════════════════════════════════════════════════════════════════
(function () {
  var KEY = 'hl-theme';
  var DEFAULT = 'dark';

  // Keeps the mobile browser chrome in step with the page background.
  var META_BG = { dark: '#0d0f14', light: '#f5f7fb' };

  // localStorage throws in private mode / when storage is blocked; a theme
  // preference is never worth breaking the page for, so fall back to default.
  function stored() {
    try {
      var v = localStorage.getItem(KEY);
      return v === 'light' || v === 'dark' ? v : null;
    } catch (e) {
      return null;
    }
  }

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', META_BG[theme] || META_BG.dark);
  }

  function set(theme) {
    if (theme !== 'light' && theme !== 'dark') return;
    try {
      localStorage.setItem(KEY, theme);
    } catch (e) {
      /* preference just won't persist */
    }
    apply(theme);
    // Lets React screens re-render anything that reads a colour from JS
    // (nav.jsx item colours, chart series) without polling.
    window.dispatchEvent(new CustomEvent('hl-theme-change', { detail: theme }));
  }

  // The Tweaks harness on seven pages (dashboard, spending, budgets, recurring,
  // subscriptions, accounts, account-tx) lets a designer override --accent live.
  // Those pages did it with style.setProperty on <html>, which writes an INLINE
  // custom property — and an inline property outranks EVERY selector, including
  // :root[data-theme="light"]. The result was the accent frozen at the dark
  // theme's blue in light mode, e.g. today's calendar date badge staying
  // #4f8ef7 while its label went light. So a stock value must be REMOVED, not
  // re-written, letting the theme's own token win again.
  var STOCK_ACCENT = '#4f8ef7';

  function accent(value) {
    var el = document.documentElement;
    if (value && String(value).toLowerCase() !== STOCK_ACCENT) {
      el.style.setProperty('--accent', value);
    } else {
      el.style.removeProperty('--accent');
    }
  }

  apply(stored() || DEFAULT);

  window.HL_THEME = {
    get: function () {
      return document.documentElement.getAttribute('data-theme') || DEFAULT;
    },
    set: set,
    toggle: function () {
      set(this.get() === 'dark' ? 'light' : 'dark');
    },
    accent: accent,
  };
})();
