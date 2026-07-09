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
    data: { url: data.url || '/Dashboard.html', type: data.type, id: data.id },
  };
  // When the push carries an item identity, offer Snooze action buttons. These
  // render on Android Chrome / desktop Chromium; iOS Safari PWA ignores them and
  // just shows the reminder (tapping the body still opens the app).
  if (data.type && data.id != null) {
    options.actions = [
      { action: 'snooze-1', title: 'Snooze 1d' },
      { action: 'snooze-7', title: 'Snooze 1w' },
    ];
  }
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const nData = event.notification.data || {};
  const url = nData.url || '/Dashboard.html';

  // Snooze action buttons: postpone this specific reminder without opening a
  // window. The SW has no JWT, so we authenticate to the backend by this device's
  // push endpoint (an unguessable capability) — see POST /api/push/snooze.
  if (event.action && event.action.indexOf('snooze-') === 0) {
    const days = parseInt(event.action.split('-')[1], 10);
    event.waitUntil(
      (async () => {
        try {
          const sub = await self.registration.pushManager.getSubscription();
          if (!sub || nData.type == null || nData.id == null) return;
          await fetch('/api/push/snooze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: sub.endpoint, type: nData.type, id: nData.id, days }),
          });
        } catch (e) { /* best-effort — a failed snooze just leaves the reminder as-is */ }
      })()
    );
    return;
  }

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
