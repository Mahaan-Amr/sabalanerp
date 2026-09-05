import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { latestPolicy } from '../notificationService';

const policy = {
  id: 'policy-1',
  eventType: 'ACCOUNTING_CONTRACT_CORRECTION_EDITED',
  version: 1,
  enabled: true,
  mandatory: false,
  titleTemplate: 'title',
  messageTemplate: 'message',
  priority: 'NORMAL',
  channels: ['IN_APP'],
  recipientResolvers: ['DIRECT_USER'],
  batching: 'IMMEDIATE',
  createdById: null,
  changeReason: null,
  createdAt: new Date('2026-09-01T00:00:00.000Z')
};

let storedPolicy: typeof policy | null = null;
const database = {
  notificationPolicyVersion: {
    findFirst: async () => {
      await Promise.resolve();
      return storedPolicy;
    },
    create: async () => {
      await Promise.resolve();
      if (storedPolicy) {
        const duplicate = new Error('Unique constraint failed') as Error & { code: string };
        duplicate.code = 'P2002';
        throw duplicate;
      }
      storedPolicy = policy;
      return policy;
    },
    upsert: async () => {
      if (!storedPolicy) storedPolicy = policy;
      return storedPolicy;
    }
  }
} as unknown as Prisma.TransactionClient;

const run = async () => {
  const results = await Promise.all([
    latestPolicy(database, 'ACCOUNTING_CONTRACT_CORRECTION_EDITED'),
    latestPolicy(database, 'ACCOUNTING_CONTRACT_CORRECTION_EDITED'),
    latestPolicy(database, 'ACCOUNTING_CONTRACT_CORRECTION_EDITED')
  ]);

  assert.deepEqual(results.map((result) => result.id), ['policy-1', 'policy-1', 'policy-1']);
  console.log('notification policy concurrency test passed');
};

run();
