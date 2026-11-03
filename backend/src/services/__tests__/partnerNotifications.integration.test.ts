import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createPartnerInAppGateway } from '../partnerSales/notifications/gateway';
import { registerPartnerNotificationAccess, resolvePartnerNotificationAction, type PartnerNotificationAccess } from '../partnerSales/notifications/access';
import { filterCurrentlyAuthorizedNotifications } from '../notificationAuthorization';
import { partnerNotificationsTestDatabaseUrl } from './partnerNotificationsTestDatabase';

const load = createRequire(resolve(__dirname, '../../../../packages/partner-sales-contracts/package.json'));
const contract: typeof import('../../../../packages/partner-sales-contracts') = load('@sabalanerp/partner-sales-contracts');

test('concurrent delivery is durable, private, and stale notification links cannot restore scope', async () => {
  const database = new PrismaClient({ datasources: { db: { url: partnerNotificationsTestDatabaseUrl() } } });
  const prefix = `partner-notification-327-${randomUUID()}`;
  let userId = '';
  try {
    const user = await database.user.create({ data: {
      email: `${prefix}@example.invalid`, username: prefix, password: 'not-a-login-secret',
      firstName: 'Notification', lastName: 'Fixture', role: 'ADMIN',
    } });
    userId = user.id;
    const notification = contract.SafeNotificationSchema.parse({
      schemaVersion: 1, notificationId: prefix, correlationId: prefix,
      kind: 'INQUIRY_PENDING', recipientEvidenceId: `${prefix}-recipient`,
      projectionEvidenceId: `${prefix}-projection`, notBefore: '2026-08-01T00:00:00.000Z',
    });
    let authorized = true;
    const access: PartnerNotificationAccess = {
      async lockAndAuthorize() { return authorized ? { notification, type: 'SUBMITTED', recipientUserId: user.id } : null; },
      async canRead() { return authorized; },
      async resolveAction() { return authorized ? '/dashboard/sales/partner-inquiries' : null; },
    };
    const gateway = createPartnerInAppGateway(contract, database, access);
    const attempts = await Promise.all(Array.from({ length: 8 }, () => gateway.enqueue(notification)));
    assert.ok(attempts.every(result => result.ok));
    assert.equal(new Set(attempts.map(result => result.ok && result.value.deliveryId)).size, 1);
    const rows = await database.notification.findMany({ where: { userId }, include: { event: true } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].referenceId, null);
    assert.equal(rows[0].actionUrl, '/dashboard/personal/notifications');
    assert.equal(rows[0].message, 'یک استعلام برای پاسخ‌گویی به شما ارجاع شد.');
    assert.deepEqual(await filterCurrentlyAuthorizedNotifications(database, user, rows), []);
    registerPartnerNotificationAccess(access);
    assert.equal((await filterCurrentlyAuthorizedNotifications(database, user, rows)).length, 1);
    assert.equal(await resolvePartnerNotificationAction(database, user.id, rows[0].id), '/dashboard/sales/partner-inquiries');
    const changedIntent = await gateway.enqueue({ ...notification, correlationId: 'another-cause' });
    assert.equal(changedIntent.ok ? '' : changedIntent.error.code, 'IDEMPOTENCY_CONFLICT');
    for (const reason of ['reassigned', 'grant-revoked', 'customer-transferred']) {
      authorized = false;
      assert.deepEqual(await filterCurrentlyAuthorizedNotifications(database, user, rows), [], reason);
      assert.equal(await resolvePartnerNotificationAction(database, user.id, rows[0].id), null, reason);
      assert.equal((await gateway.enqueue(notification)).ok, false, reason);
    }
    assert.equal(await database.notification.count({ where: { userId } }), 1);
    authorized = true;
    await database.user.update({ where: { id: userId }, data: { isActive: false } });
    assert.equal(await resolvePartnerNotificationAction(database, user.id, rows[0].id), null, 'DB user deactivation overrides a stale authenticated principal');
    assert.equal((await gateway.enqueue(notification)).ok, false);
  } finally {
    if (userId) {
      const rows = await database.notification.findMany({ where: { userId }, select: { eventId: true } });
      await database.notificationEvent.deleteMany({ where: { id: { in: rows.flatMap(row => row.eventId ? [row.eventId] : []) } } });
      await database.user.delete({ where: { id: userId } });
    }
    await database.$disconnect();
  }
});
