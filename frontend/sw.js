/* Home Ledger — service worker.
 * Deliberately does NO caching (an earlier version caused a stale-asset bug —
 * see git history). Its only jobs are: (1) receive Web Push events and show a
 * notification, and (2) route notification clicks to the right page. There is
 * no `fetch` listener, so every request still goes straight to the network.
 */
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  const title = data.title || 'Home Ledger';
  const options = {
    body: data.body || '',
    icon: 'assets/icon-192.png',
    badge: 'assets/icon-192.png',
    vibrate: [200, 100, 200],
    renotify: true,
    tag: data.tag || 'home-ledger',
    data: { url: data.url || '/Dashboard.html' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/Dashboard.html';
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of clientsList) {
        if (client.url.includes(url) && 'focus' in client) return client.focus();
      }
      if (clientsList.length > 0 && 'navigate' in clientsList[0]) {
        await clientsList[0].navigate(url);
        return clientsList[0].focus();
      }
      return self.clients.openWindow(url);
    })()
  );
});
