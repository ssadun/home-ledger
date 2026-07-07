// push.js — Web Push subscribe/unsubscribe + lead-days prefs client.
(function () {
  const ENABLED_KEY = 'hl-notify-enabled';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) outputArray[i] = rawData.charCodeAt(i);
    return outputArray;
  }

  function isSupported() {
    return 'serviceWorker' in navigator && 'PushManager' in window && !!window.isSecureContext;
  }

  async function getPublicKey() {
    const res = await fetch('/api/push/vapid-public-key');
    const data = await res.json();
    return data.public_key;
  }

  async function getPrefs() {
    try {
      const res = await window.HL_AUTH.apiFetch('/api/push/prefs');
      return res.ok ? res.json() : { notify_lead_days: 0, subscribed: false };
    } catch (e) {
      return { notify_lead_days: 0, subscribed: false };
    }
  }

  async function setLeadDays(days) {
    return window.HL_AUTH.apiFetch('/api/push/prefs', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notify_lead_days: days }),
    });
  }

  async function enable() {
    if (!isSupported()) throw new Error('Push notifications are not supported in this browser/context');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notification permission denied');
    const reg = await navigator.serviceWorker.register('/sw.js');
    const publicKey = await getPublicKey();
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
    await window.HL_AUTH.apiFetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...sub.toJSON(), user_agent: navigator.userAgent }),
    });
    try { localStorage.setItem(ENABLED_KEY, '1'); } catch (e) {}
    return true;
  }

  async function disable() {
    try {
      const reg = await navigator.serviceWorker.getRegistration('/sw.js');
      const sub = reg && (await reg.pushManager.getSubscription());
      if (sub) {
        await window.HL_AUTH.apiFetch('/api/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
    } finally {
      try { localStorage.removeItem(ENABLED_KEY); } catch (e) {}
    }
  }

  async function sendTest() {
    const res = await window.HL_AUTH.apiFetch('/api/push/test', { method: 'POST' });
    if (!res.ok) throw new Error('Could not send test notification');
    return res.json();
  }

  window.HL_PUSH = { isSupported, enable, disable, getPrefs, setLeadDays, sendTest };
})();
