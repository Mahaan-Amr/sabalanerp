import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { PrismaClient } from '@prisma/client';
import { deliverPendingNotificationOutbox } from '../notificationService';

test('sixty idle one-second polls each use one read and issue no lease writes', async () => {
  let reads = 0;
  let writes = 0;
  const database = { notificationOutbox: {
    findFirst: async () => { reads += 1; return null; },
    updateMany: async () => { writes += 1; return { count: 0 }; },
  } } as unknown as PrismaClient;
  for (let second = 0; second < 60; second += 1) {
    const result = await deliverPendingNotificationOutbox(database, () => assert.fail('no pending delivery'),
      new Date(second * 1_000));
    assert.equal(result.businessCode, 'PERFORMANCE_NOTIFICATION_OUTBOX_EMPTY');
  }
  assert.deepEqual({ reads, writes }, { reads: 60, writes: 0 });
});
