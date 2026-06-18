// Registers the Hyper Ledger service worker for PWA / installable support.
// Registered at scope "/" so it controls every page in the app.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(function (err) {
      console.warn('Service worker registration failed:', err);
    });
  });
}
