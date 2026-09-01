import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { registeredNotificationEventTypes } from '../notificationPolicy';
import { latestPolicy } from '../notificationService';

process.env.DATABASE_URL ??= 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public';

const rollback = new Error('ROLLBACK_NOTIFICATION_POLICY_CONCURRENCY_TEST');

test('concurrent publishers atomically create one default policy version', async () => {
  const prisma = new PrismaClient();
  try {
    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const existingTypes = new Set(
          (await tx.notificationPolicyVersion.findMany({ select: { eventType: true }, distinct: ['eventType'] }))
            .map(({ eventType }) => eventType)
        );
        const unusedType = registeredNotificationEventTypes().find((type) => !existingTypes.has(type));
        assert.ok(unusedType, 'the test database needs one registered event without a stored policy');

        const policies = await Promise.all([
          latestPolicy(tx, unusedType),
          latestPolicy(tx, unusedType),
          latestPolicy(tx, unusedType)
        ]);

        assert.equal(new Set(policies.map(({ id }) => id)).size, 1);
        throw rollback;
      }),
      (error) => error === rollback
    );
  } finally {
    await prisma.$disconnect();
  }
});
