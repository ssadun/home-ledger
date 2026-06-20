/* Hyper Ledger — service worker (kill switch)
 * This version intentionally does NO caching. It exists only to replace any
 * previously installed service worker: on activation it deletes all caches,
 * unregisters itself, and reloads open tabs. After that, the browser talks to
 * the server directly, so a normal refresh always shows the latest files.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Drop every cache this origin ever created.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      // Remove this service worker so nothing intercepts future requests.
      await self.registration.unregister();
      // Take control of open pages and force them to reload from the network.
      const clients = await self.clients.matchAll({ type: 'window' });
      clients.forEach((client) => client.navigate(client.url));
    })()
  );
});

// Pass through every request untouched — no interception, no cache.
self.addEventListener('fetch', () => {});
