import assert from 'node:assert/strict';
import express from 'express';
import type { AddressInfo } from 'node:net';
import notifications from '../notifications';
import dashboard, { createActionAvailabilityHandler } from '../dashboard';
import { prisma } from '../../lib/prisma';

// Exercise the registered HTTP handlers; authentication is supplied by this
// isolated harness so no database, credentials or production writes are needed.
const registeredHandler = (router: any, method: string, path: string) => {
  const route = router.stack.find((layer: any) => layer.route?.path === path && layer.route.methods[method]);
  assert.ok(route, `${method} ${path} is registered`);
  return route.route.stack.at(-1).handle;
};

const run = async () => {
  const timeout = Object.assign(new Error('Transaction already closed: private database detail'), { code: 'P2028' });
  const row = { id: 'notice', type: 'PARTNER_CUSTOMER_TRANSFER', createdAt: new Date(),
    event: { resourceType: 'PARTNER_CUSTOMER_TRANSFER', resourceId: 'transfer' } };
  const originals = { findMany: prisma.notification.findMany, findFirst: prisma.notification.findFirst,
    transaction: prisma.$transaction, update: prisma.notification.update, updateMany: prisma.notification.updateMany };
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => { unhandled.push(error); };
  let writes = 0;
  let transactions = 0;
  let failedLockReads = 0;
  let active = true;
  const tx = {
    user: { findUnique: async () => ({ isActive: active }) },
    partnerCustomerTransfer: { findUnique: async () => ({ customerId: 'customer',
      fromOwnerUserId: 'another-actor', requestedBy: 'another-actor', toProfile: { userId: 'partner' } }) },
    $queryRaw: async () => { failedLockReads += 1; throw timeout; },
  };
  (prisma.notification as any).findMany = async () => [row];
  (prisma.notification as any).findFirst = async () => row;
  (prisma as any).$transaction = async (callback: (database: unknown) => Promise<unknown>) => {
    transactions += 1;
    return callback(tx);
  };
  (prisma.notification as any).update = async () => { writes += 1; };
  (prisma.notification as any).updateMany = async () => { writes += 1; };
  process.on('unhandledRejection', onUnhandled);
  const app = express();
  app.use((req: any, _res, next) => { req.user = { id: 'actor', role: 'ADMIN' }; next(); });
  const cases = [
    ['get', '/', '/notices'], ['get', '/unread-count', '/count'], ['get', '/metadata', '/metadata'],
    ['put', '/read-all', '/read-all'], ['put', '/:id/read', '/notice/read'],
    ['delete', '/:id/read', '/notice/unread'],
  ];
  for (const [method, path, url] of cases) (app as any)[method](url, registeredHandler(notifications, method, path));
  app.get('/availability', registeredHandler(dashboard, 'get', '/route-availability'));
  app.get('/actions', createActionAvailabilityHandler(async () => { throw timeout; }));
  app.get('/ping', (_req, res) => { res.json({ ok: true }); });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [method, , url] of cases.concat([
      ['get', '', '/availability?path=/dashboard/crm/customer-transfers/transfer'],
      ['get', '', '/actions?workspace=accounting'],
    ])) {
      let response: globalThis.Response;
      try { response = await fetch(base + url, { method: method.toUpperCase(), signal: AbortSignal.timeout(1500) }); }
      catch { assert.fail(`${method} ${url}: authorization failure escaped the HTTP boundary (${unhandled.length} unhandled rejections)`); }
      assert.equal(response.status, 500, url);
      const body = await response.json() as any;
      assert.equal(body.success, false);
      assert.equal(body.data, undefined, 'failure must not grant access or expose notification data');
      assert.doesNotMatch(JSON.stringify(body), /private database detail|Transaction already closed|P2028/);
      assert.equal((await fetch(base + '/ping')).status, 200, 'backend keeps serving after failure');
    }
    assert.equal(transactions, 7, 'notification and transfer route failures reached the authorization transaction');
    assert.equal(failedLockReads, 7, 'the real Partner authorization lock read reproduced the production timeout');
    assert.equal(writes, 0, 'failed authorization cannot mark notifications read/unread');
    assert.equal(unhandled.length, 0);
    assert.equal((await fetch(base + '/availability?path=invalid')).status, 400);
    assert.equal((await fetch(base + '/actions?workspace=invalid')).status, 400);
    active = false;
    const denied = await fetch(base + '/availability?path=/dashboard/crm/customer-transfers/transfer');
    assert.equal(denied.status, 200);
    assert.equal((await denied.json() as any).data.allowed, false, 'real denial remains a denial, not a server failure');
    (prisma.notification as any).findMany = async () => [];
    assert.deepEqual(await (await fetch(base + '/count')).json(), { success: true, data: { count: 0 } });
    (prisma.notification as any).findFirst = async () => null;
    assert.equal((await fetch(base + '/notice/read', { method: 'PUT' })).status, 404);
    assert.equal(writes, 0);
    console.log('Authorization request failure HTTP regression passed (8 endpoints).');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    process.off('unhandledRejection', onUnhandled);
    Object.assign(prisma.notification, { findMany: originals.findMany, findFirst: originals.findFirst,
      update: originals.update, updateMany: originals.updateMany });
    (prisma as any).$transaction = originals.transaction;
  }
};
void run().catch(error => { console.error(error); process.exitCode = 1; });
