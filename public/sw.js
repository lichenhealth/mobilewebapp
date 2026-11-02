/* Lichen service worker — Web Push only (2026-07-22).
   Deliberately minimal: no offline caching, no fetch handler (so it never
   interferes with the network or the app's own routing). Its only jobs are to
   receive push messages and route taps back into the app. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = { title: 'Lichen', body: event.data && event.data.text() }; }
  const title = data.title || 'Lichen';
  const options = {
    body: data.body || '',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: data.tag || undefined,      // collapse repeats of the same thing
    data: { link: data.link || '/' },
  };
  // The HOME-SCREEN ICON's number (founder 2026-11-02): send-push includes the
  // member's live unread-bell count as `badge`, and a closed PWA only updates
  // its icon through push — so set it here. Best-effort: older payloads carry
  // no count, unsupported platforms lack the API; the notification still shows.
  const tasks = [self.registration.showNotification(title, options)];
  if (typeof data.badge === 'number' && 'setAppBadge' in self.navigator) {
    tasks.push(
      (data.badge > 0
        ? self.navigator.setAppBadge(data.badge)
        : self.navigator.clearAppBadge()
      ).catch(() => {})
    );
  }
  event.waitUntil(Promise.all(tasks));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const link = (event.notification.data && event.notification.data.link) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // Focus an existing tab and navigate it; otherwise open a new one.
      for (const client of clients) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) { try { client.navigate(link); } catch (e) {} }
          return;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(link);
    })
  );
});
