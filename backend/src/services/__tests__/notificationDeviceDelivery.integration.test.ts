import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { deliverNotificationToDevice } from '../notificationDeviceDelivery';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

test('actual PostgreSQL device intents survive overlapping workers, accepted-but-unrecorded outcomes and digest retries',
  { skip: !process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL, timeout: 240_000 }, async () => {
    const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
      sourceDatabaseUrl: process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL!, migrateEmptySchema: true });
    const first = temporary.client(), second = temporary.client();
    let release = () => {};
    let initial: Promise<unknown> | undefined;
    try {
      const user = await first.user.create({ data: { email: 'device-intents@example.invalid', username: 'device-intents',
        password: 'not-used', firstName: 'آزمون', lastName: 'اعلان' } });
      const notifications = await Promise.all(Array.from({ length: 8 }, (_, index) => first.notification.create({ data: {
        userId: user.id, type: 'DEVICE_INTENT_QA', title: `probe-${index}`, message: 'not sent to provider',
      } })));
      const payload = JSON.stringify({ title: 'سبلان ERP', body: 'یک اعلان جدید دارید.', url: '/dashboard' });
      const base = { database: first, notificationIds: [notifications[0].id], subscriptionId: 'private-device-id', payload,
        authorize: async () => true };
      let enter!: () => void;
      const entered = new Promise<void>(resolve => { enter = resolve; });
      const pending = new Promise<void>(resolve => { release = resolve; });
      let calls = 0;
      initial = deliverNotificationToDevice({ ...base, send: async () => { calls++; enter(); await pending; } });
      await Promise.race([entered, initial.then(() => { throw new Error('Provider was not entered'); })]);
      assert.equal(await deliverNotificationToDevice({ ...base, database: second, send: async () => { calls++; } }), 'UNKNOWN');
      release();
      assert.equal(await initial, 'DELIVERED');
      assert.equal(await deliverNotificationToDevice({ ...base, send: async () => { calls++; } }), 'ALREADY_RECORDED');
      assert.equal(calls, 1);

      const ambiguous = { ...base, notificationIds: [notifications[1].id] };
      assert.equal(await deliverNotificationToDevice({ ...ambiguous, send: async () => { calls++; throw new Error('connection lost after accept'); } }), 'UNKNOWN');
      assert.equal(await deliverNotificationToDevice({ ...ambiguous, database: second, send: async () => { calls++; } }), 'UNKNOWN');
      assert.equal(calls, 2);

      // A provider accepted, but the process lost its database completion write.
      // Inject only that write failure; the durable intent is actual PostgreSQL.
      const lostReceipt = new Proxy(first, { get(target, property) {
        if (property === 'notificationDeliveryAttempt') return new Proxy(target.notificationDeliveryAttempt, { get(delegate, operation) {
          if (operation === 'updateMany') return async () => { throw new Error('completion database unavailable'); };
          return Reflect.get(delegate, operation);
        } });
        return Reflect.get(target, property);
      } });
      const lost = { ...base, notificationIds: [notifications[2].id] };
      await assert.rejects(deliverNotificationToDevice({ ...lost, database: lostReceipt, send: async () => { calls++; } }), /completion database/);
      assert.equal(await deliverNotificationToDevice({ ...lost, database: second, send: async () => { calls++; } }), 'UNKNOWN');
      assert.equal(calls, 3);

      let authorizationChecks = 0;
      assert.equal(await deliverNotificationToDevice({ ...base, notificationIds: [notifications[3].id],
        authorize: async () => ++authorizationChecks === 1, send: async () => { throw new Error('must not contact revoked device'); } }), 'SUPPRESSED');
      assert.equal(await deliverNotificationToDevice({ ...base, notificationIds: [notifications[4].id],
        send: async () => { throw Object.assign(new Error('expired endpoint'), { statusCode: 410 }); } }), 'EXPIRED');

      // A digest may include a previously ambiguous item and a new item. Only
      // the new item's intent is added; the prior outcome is never relabelled.
      assert.equal(await deliverNotificationToDevice({ ...base, notificationIds: [notifications[1].id, notifications[5].id],
        send: async () => { calls++; } }), 'UNKNOWN');
      const rows = await first.notificationDeliveryAttempt.findMany({ orderBy: { notificationId: 'asc' } });
      assert.equal(rows.length, 6);
      assert.equal(rows.find(row => row.notificationId === notifications[1].id)?.status, 'UNKNOWN');
      assert.equal(rows.find(row => row.notificationId === notifications[5].id)?.status, 'DELIVERED');
      assert.ok(rows.every(row => row.channel.startsWith('WEB_PUSH_DEVICE_V1:') && !row.error?.includes('private-device-id')));
      assert.equal(calls, 4);
      const service = execFileSync(process.execPath, ['--import', 'tsx', 'src/services/__tests__/notificationServiceDevice.fixture.ts'], {
        cwd: process.cwd(), env: { ...process.env, DATABASE_URL: temporary.databaseUrl }, encoding: 'utf8', timeout: 90_000,
      });
      assert.match(service, /NOTIFICATION_SERVICE_DEVICE_ACCEPTANCE_PASSED/);
    } finally {
      release();
      await initial?.catch(() => undefined);
      await Promise.allSettled([first.$disconnect(), second.$disconnect()]);
      await temporary.cleanup();
    }
  });
