/* The Pit's service worker: it shows the alerts the engine pushes and opens the app on a tap. It caches nothing, on
   purpose (the page versions its own files with ?v=); it exists for push alone. */
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('push', e => {
  let m = {};
  try { m = e.data ? e.data.json() : {}; } catch (err) { m = { body: e.data ? e.data.text() : '' }; }
  const opts = { body: m.body || '', data: { url: m.url || './#now' }, icon: 'icons/icon-smoker-192.png', badge: 'icons/icon-smoker-192.png' };
  if (m.tag) opts.tag = String(m.tag);
  e.waitUntil(self.registration.showNotification(m.title || 'The Pit', opts));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || './#now', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus();
    return self.clients.openWindow(url);
  }));
});
