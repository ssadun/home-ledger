// Registers sw.js only if the user has opted into push notifications (the
// "hl-notify-enabled" flag set by push.js) — otherwise this stays a no-op dev
// default so a normal refresh always loads the latest files (no stale cache).
// Also proactively unregisters any service worker left over from before this
// opt-in existed, so existing browsers heal on the next page load.
(function () {
  if (!('serviceWorker' in navigator)) return;

  var wantsSW = false;
  try { wantsSW = localStorage.getItem('hl-notify-enabled') === '1'; } catch (e) {}

  if (wantsSW) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
  } else {
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (reg) { reg.unregister(); });
    });
    if (window.caches && caches.keys) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) { caches.delete(k); });
      });
    }
  }
})();
