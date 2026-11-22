// Private pages, RSC, API responses and submissions always use the network.
// Versioned public assets are retained by the release router, not this worker.
const LEGACY_PRIVATE_CACHES = ['sabalan-security-v1', 'sabalan-static-v1', 'sabalan-dynamic-v1'];

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil((async () => {
  await Promise.all(LEGACY_PRIVATE_CACHES.map(name => caches.delete(name)));
  await self.clients.claim();
})()));

function notificationTarget(value) {
  try {
    const target = new URL(typeof value === 'string' ? value : '/dashboard', self.location.origin);
    if (target.origin === self.location.origin && !target.username && !target.password
      && (target.pathname === '/dashboard' || target.pathname.startsWith('/dashboard/'))) return target.href;
  } catch { /* Malformed legacy notification data uses the authenticated landing page. */ }
  return new URL('/dashboard', self.location.origin).href;
}

self.addEventListener('push', event => {
  let data;
  try { data = event.data?.json(); } catch { data = undefined; }
  event.waitUntil(self.registration.showNotification('سبلان ERP', {
    body: 'یک اعلان جدید در سبلان دارید.',
    icon: '/brand/logo-project.png',
    data: { url: notificationTarget(data?.url) },
    tag: 'sabalan-privacy-safe-notification',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = notificationTarget(event.notification.data?.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(client => client.url === target && 'focus' in client);
    if (existing) return existing.focus();
    // Never navigate a different tab: it may contain an unsaved old-build form.
    return self.clients.openWindow(target);
  })());
});
