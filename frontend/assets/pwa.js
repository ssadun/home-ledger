// Registers sw.js only if the user has opted into push notifications (the
// "hl-notify-enabled" flag set by push.js) — otherwise this stays a no-op dev
// default so a normal refresh always loads the latest files (no stale cache).
// Also proactively unregisters any service worker left over from before this
// opt-in existed, so existing browsers heal on the next page load — UNLESS a
// live push subscription exists, in which case the worker is kept (and the flag
// re-set) so we never silently break notifications.
(function () {
  if (!('serviceWorker' in navigator)) return;

  var wantsSW = false;
  try { wantsSW = localStorage.getItem('hl-notify-enabled') === '1'; } catch (e) {}

  if (wantsSW) {
    navigator.serviceWorker.register('/sw.js').catch(function () {});
    return;
  }

  // Notifications not flagged locally — the dev default is to tear the service
  // worker (and caches) down so a refresh always loads the latest files. But a
  // browser can be genuinely subscribed to push while this local flag is missing
  // (cleared site data, an older opt-in, a reload race, or another tab). Unregis-
  // tering there silently kills the push subscription, so pushes arrive at the
  // browser with no worker to display them. Check for a live subscription first;
  // if one exists, KEEP the worker and heal the divergent flag instead.
  navigator.serviceWorker.getRegistrations().then(function (regs) {
    Promise.all(regs.map(function (reg) {
      return reg.pushManager.getSubscription().then(function (sub) {
        if (sub) {
          try { localStorage.setItem('hl-notify-enabled', '1'); } catch (e) {}
          return true; // subscribed → keep this worker
        }
        return reg.unregister().then(function () { return false; }, function () { return false; });
      }, function () { return false; });
    })).then(function (kept) {
      var anyKept = kept.some(function (k) { return k; });
      if (!anyKept && window.caches && caches.keys) {
        caches.keys().then(function (keys) {
          keys.forEach(function (k) { caches.delete(k); });
        });
      }
    });
  });
})();
