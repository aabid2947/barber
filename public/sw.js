// Quevix Push Notification Service Worker

self.addEventListener('install', function(event) {
  console.log('[Quevix SW] Installed');
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[Quevix SW] Activated');
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  console.log('[Quevix SW] Push received');
  let data = { title: 'Quevix', body: 'You have a notification' };
  try {
    if (event.data) {
      data = event.data.json();
    }
  } catch (e) {
    console.error('[Quevix SW] Failed to parse push data:', e);
  }

  const options = {
    body: data.body || 'You have a notification',
    icon: data.icon || undefined,
    badge: data.badge || undefined,
    vibrate: [200, 100, 200],
    tag: data.tag || 'quevix-notification',
    renotify: true,
    data: data,
  };

  event.waitUntil(
    self.registration.showNotification(data.title || 'Quevix', options)
  );
});

self.addEventListener('notificationclick', function(event) {
  console.log('[Quevix SW] Notification clicked');
  event.notification.close();

  const urlToOpen = event.notification.data && event.notification.data.url
    ? event.notification.data.url
    : '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var client = clientList[i];
        if (client.url.includes(urlToOpen) && 'focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(urlToOpen);
      }
    })
  );
});
