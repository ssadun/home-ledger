// Service worker registration is DISABLED for development so the browser always
// loads the latest files on a normal refresh (no stale cache, no PWA caching).
// Also proactively unregister any service worker left over from a previous build
// and clear its caches, so existing browsers heal on the next page load.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    regs.forEach(function (reg) { reg.unregister(); });
  });
  if (window.caches && caches.keys) {
    caches.keys().then(function (keys) {
      keys.forEach(function (k) { caches.delete(k); });
    });
  }
}
