// Registers sw.js unconditionally (not gated on push opt-in) so Chrome/Samsung
// Internet sees an active service worker on first visit and treats the site as
// a real installable PWA — otherwise "Add to Home Screen" just makes a bookmark
// shortcut with no distinct Android app entry (no per-app battery/notification
// controls, and push delivery rides on the browser's own background rules).
// Safe from the earlier stale-asset bug this used to guard against: sw.js has
// no `fetch` listener, so it can't intercept or cache anything — every request
// still goes straight to the network regardless of registration.
(function () {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').catch(function () {});
})();
