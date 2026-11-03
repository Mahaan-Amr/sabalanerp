self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(self.registration.showNotification(
    data.title || 'سبلان ERP',
    {
      body: 'یک اعلان جدید در سبلان دارید.',
      icon: '/brand/logo-project.png',
      data: { url: typeof data.url === 'string' && data.url.startsWith('/') ? data.url : '/dashboard' },
      tag: 'sabalan-privacy-safe-notification',
      renotify: true,
    },
  ));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/dashboard';
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => 'focus' in client);
    if (existing) {
      await existing.navigate(target);
      return existing.focus();
    }
    return clients.openWindow(target);
  })());
});
