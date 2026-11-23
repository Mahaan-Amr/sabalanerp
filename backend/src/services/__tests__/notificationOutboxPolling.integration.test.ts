import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

const sourceUrl = process.env.ONLINE_DEPLOYMENT_TEST_DATABASE_URL;

test('local PostgreSQL outbox idle cost, delivery latency, recovery and authorization',
  { skip: !sourceUrl, timeout: 240_000 }, async (t) => {
    const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
      sourceDatabaseUrl: sourceUrl!, migrateEmptySchema: true });
    const database = new PrismaClient({ datasources: { db: { url: temporary.databaseUrl } },
      log: [{ emit: 'event', level: 'query' }] });
    const concurrent = temporary.client();
    const coordination = await mkdtemp(path.join(os.tmpdir(), 'sabalan-outbox-qa-'));
    process.env.DATABASE_URL = temporary.databaseUrl;
    process.env.RECOVERY_COORDINATION_DIR = coordination;
    const { disconnectDatabase } = await import('../../lib/prisma');
    const { initializeRecoveryRuntime } = await import('../recoveryRuntime');
    const { stopBackgroundJobs } = await import('../backgroundJobLifecycle');
    const { deliverPendingNotificationOutbox, publishNotificationEvent, startNotificationOutboxDelivery } =
      await import('../notificationService');
    let stopDelivery: (() => void) | undefined;
    try {
      initializeRecoveryRuntime();
      const idle = { reads: 0, writes: 0 };
      let measureIdle = true;
      database.$on('query', ({ query }) => {
        if (!measureIdle || !query.includes('"notification_outbox"')) return;
        if (query.startsWith('SELECT ')) idle.reads += 1;
        if (query.startsWith('UPDATE ')) idle.writes += 1;
      });
      for (let tick = 0; tick < 60; tick += 1) {
        const result = await deliverPendingNotificationOutbox(database, () => assert.fail('empty queue delivered'),
          new Date(Date.now() + tick * 1_000));
        assert.equal(result.businessCode, 'PERFORMANCE_NOTIFICATION_OUTBOX_EMPTY');
      }
      measureIdle = false;

      const user = await database.user.create({ data: { email: 'outbox-qa@example.invalid', username: 'outbox-qa',
        password: 'not-used', firstName: 'آزمون', lastName: 'اعلان', role: 'ADMIN' } });
      const enqueue = async (key: string, scope: { workspace?: string; feature?: string } = {}) => {
        const event = await publishNotificationEvent(database, { type: 'HR_DUTY_ASSIGNED',
          deduplicationKey: key, referenceId: key, recipientIds: [user.id], ...scope });
        assert.ok(event);
        return event;
      };
      const fixture = await enqueue('warmup');
      assert.equal((await deliverPendingNotificationOutbox(database, () => undefined)).delivered, 1);
      assert.equal(await database.notification.count({ where: { eventId: fixture.id } }), 1);

      const startedAt = new Map<string, number>();
      const latencies = new Map<string, number>();
      stopDelivery = startNotificationOutboxDelivery(database, (_userId, row) => {
        const key = row.referenceId || '';
        const start = startedAt.get(key);
        assert.ok(start !== undefined);
        assert.ok(!latencies.has(key));
        latencies.set(key, performance.now() - start);
      });
      // Observe the actual one-second worker, sampling from just after a tick
      // to just before the next over three consecutive intervals.
      const phases = [30, 150, 270, 390, 510, 630, 750, 870];
      const offsets = [0, 1_000, 2_000].flatMap((cycle) => phases.map(phase => cycle + phase));
      await Promise.all(offsets.map(async (offset, index) => {
        await delay(offset);
        const key = `latency-${index}`;
        startedAt.set(key, performance.now());
        await enqueue(key);
      }));
      for (let attempt = 0; attempt < 70 && latencies.size < offsets.length; attempt += 1) await delay(100);
      stopDelivery();
      await stopBackgroundJobs(5_000);
      assert.equal(latencies.size, offsets.length);
      const sorted = [...latencies.values()].sort((a, b) => a - b);
      const p95Ms = Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1]);
      t.diagnostic(JSON.stringify({ idleReadsPer60Ticks: idle.reads, idleWritesPer60Ticks: idle.writes,
        latencySamples: sorted.length, publicationToRealtimeCallbackP95Ms: p95Ms }));

      const interrupted = await enqueue('expired');
      await database.notificationOutbox.update({ where: { eventId: interrupted.id }, data: {
        status: 'PROCESSING', claimedAt: new Date(Date.now() - 6 * 60_000), attempts: 1,
      } });
      const caughtUp: string[] = [];
      const receive = (_userId: string, row: { referenceId: string | null }) => { caughtUp.push(row.referenceId!); };
      await Promise.all([deliverPendingNotificationOutbox(database, receive), deliverPendingNotificationOutbox(concurrent, receive)]);
      assert.deepEqual(caughtUp, ['expired']);
      await enqueue('expired');
      await database.notificationOutbox.update({ where: { eventId: interrupted.id }, data: { status: 'PENDING' } });
      await deliverPendingNotificationOutbox(database, receive);
      assert.deepEqual(caughtUp, ['expired']);
      assert.equal(await database.notification.count({ where: { eventId: interrupted.id } }), 1);
      assert.equal(await database.notificationDeliveryAttempt.count({ where: {
        notification: { eventId: interrupted.id }, channel: 'REALTIME', status: 'DELIVERED',
      } }), 1);

      // ADMIN normally has this feature. An explicit `none` removes it, even
      // from a notice that was already published while the feature was active.
      const { FEATURES, FEATURE_WORKSPACE_MAP } = await import('../../middleware/feature');
      const feature = FEATURES.SUPPORT_SECURITY_INCIDENT_HANDLE;
      const workspace = FEATURE_WORKSPACE_MAP[feature];
      const scope = { feature, workspace };
      await enqueue('permitted', scope);
      await deliverPendingNotificationOutbox(database, receive);
      const revoked = await enqueue('revoked', scope);
      await database.featurePermission.create({ data: { userId: user.id, workspace, feature, permissionLevel: 'none' } });
      await deliverPendingNotificationOutbox(database, receive);
      assert.deepEqual(caughtUp, ['expired', 'permitted']);
      assert.equal((await database.notificationOutbox.findUniqueOrThrow({ where: { eventId: revoked.id } })).status, 'PROCESSED');
      assert.equal(idle.reads, 60);
      assert.equal(idle.writes, 0);
    } finally {
      stopDelivery?.();
      await stopBackgroundJobs(5_000);
      await Promise.allSettled([disconnectDatabase(), database.$disconnect(), concurrent.$disconnect()]);
      await temporary.cleanup();
      await rm(coordination, { recursive: true, force: true });
    }
  });
