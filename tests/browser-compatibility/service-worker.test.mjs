import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const source = await fs.readFile(new URL('../../frontend/public/sw.js', import.meta.url), 'utf8');
function worker() {
  const handlers = new Map();
  const cached = new Set(['sabalan-security-v1', 'sabalan-static-v1', 'sabalan-dynamic-v1', 'another-app-cache']);
  const notifications = [], opened = [];
  const self = {
    location: { origin: 'https://erp.example' },
    addEventListener: (event, handler) => handlers.set(event, handler),
    skipWaiting: async () => undefined,
    registration: { showNotification: async (title, options) => { notifications.push({ title, ...options }); } },
    clients: {
      claim: async () => undefined,
      matchAll: async () => [{ url: 'https://erp.example/dashboard/contracts/new', focus: async () => undefined,
        navigate: () => { throw new Error('Notification destroyed an open form'); } }],
      openWindow: async url => { opened.push(url); },
    },
  };
  vm.runInNewContext(source, { self, URL, caches: {
    keys: async () => [...cached],
    delete: async name => cached.delete(name),
    open: () => { throw new Error('Private browser cache must not be created'); },
    match: () => { throw new Error('Private cached response must not be served'); },
  } });
  const dispatch = async (type, event = {}) => {
    const waits = [];
    handlers.get(type)?.({ ...event, waitUntil: work => waits.push(work) });
    await Promise.all(waits);
  };
  return { handlers, cached, notifications, opened, dispatch };
}

test('activation removes all known private legacy caches, preserves unrelated caches and never intercepts requests', async () => {
  const runtime = worker();
  await runtime.dispatch('install'); await runtime.dispatch('activate');
  assert.deepEqual([...runtime.cached], ['another-app-cache']);
  assert.equal(runtime.handlers.has('fetch'), false, 'HTML, RSC and authenticated API use the real network');
  assert.equal(runtime.handlers.has('sync'), false, 'financial writes are never replayed by a worker');
});

test('push never displays payload secrets, and untrusted notification URLs cannot leave the application', async () => {
  for (const url of ['//evil.example/steal', 'https://evil.example/steal', 'javascript:alert(1)', '/api/auth/logout', '/dashboardish']) {
    const runtime = worker();
    await runtime.dispatch('push', { data: { json: () => ({ title: 'private customer name', body: 'private salary', url }) } });
    const notification = runtime.notifications[0];
    assert.equal(notification.title, 'سبلان ERP');
    assert.equal(notification.body, 'یک اعلان جدید در سبلان دارید.');
    assert.equal(JSON.stringify(notification).includes('private'), false);
    await runtime.dispatch('notificationclick', { notification: { data: { url }, close() {} } });
    assert.deepEqual(runtime.opened, ['https://erp.example/dashboard']);
  }
});

test('a notification opens its authorized destination without navigating another tab with an unsaved form', async () => {
  const runtime = worker();
  await runtime.dispatch('notificationclick', { notification: { data: { url: '/dashboard/personal/notifications?id=17' }, close() {} } });
  assert.deepEqual(runtime.opened, ['https://erp.example/dashboard/personal/notifications?id=17']);
});
