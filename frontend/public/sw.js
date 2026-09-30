const CACHE = 'pravia-shell-v2';
const SHELL = ['/offline.html', '/manifest.webmanifest', '/icons/pravia-192.png', '/icons/pravia-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'SHOW_PRAVIA_NOTIFICATION') {
    const payload = event.data.payload || {};
    event.waitUntil(self.registration.showNotification(payload.title || 'PRAVIA OS', {
      body: payload.body || '',
      icon: '/icons/pravia-192.png',
      badge: '/icons/favicon-32.png',
      tag: payload.tag || undefined,
      renotify: false,
      data: { url: payload.url || '/configuracion/notificaciones' },
    }));
  }
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data?.json() || {}; } catch { payload = { body: event.data?.text() || '' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'PRAVIA OS', {
    body: payload.body || '', icon: '/icons/pravia-192.png', badge: '/icons/favicon-32.png',
    tag: payload.tag || undefined, renotify: false,
    data: { url: payload.url || '/configuracion/notificaciones' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/configuracion/notificaciones', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => client.url.startsWith(self.location.origin));
    if (existing) { await existing.focus(); existing.navigate(target); return; }
    await self.clients.openWindow(target);
  }));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
  }
});
