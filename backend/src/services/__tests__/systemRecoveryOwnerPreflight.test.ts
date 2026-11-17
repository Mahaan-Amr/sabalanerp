import assert from 'node:assert/strict';
import test from 'node:test';
import { preflightRecoveryOwnerRequest } from '../systemRecoveryOwnerPreflight';

const id = 'cm12345678901234567890123';
const sha = 'a'.repeat(64);
const request = { format: 'sabalan-system-recovery-owner/v1', operationId: id, requestId: 'b'.repeat(64),
  actorId: 'admin', action: 'RESTORE', packageType: 'COMPLETE', passphrase: 'private-test-passphrase-123',
  checksum: 'c'.repeat(64), approvedById: 'second', approvalExpiresAt: new Date(Date.now() + 60_000).toISOString(),
  confirmationPhrase: 'RESTORE SABALAN ERP' } as const;

function fixture(change: { expired?: boolean; inactive?: boolean; unbound?: boolean } = {}) {
  const mutations: any[] = [];
  const operation = { id, packageType: 'COMPLETE', source: 'UPLOADED', status: 'RESTORING', progress: 0,
    encryptedSha256: request.checksum, storageName: id + '.sbr', approvedById: 'second',
    approvalExpiresAt: new Date(request.approvalExpiresAt), expiresAt: new Date(Date.now() + (change.expired ? -60_000 : 60_000)) };
  const tx: any = {
    recoveryAuditEvent: {
      findMany: async () => change.unbound ? [] : [{ packageChecksum: request.checksum,
        details: { requestId: request.requestId, sealedSha256: sha, action: 'RESTORE', packageType: 'COMPLETE' } }],
      create: async (args: any) => { mutations.push({ audit: args.data }); },
    },
    recoveryOperation: {
      findUnique: async () => operation,
      updateMany: async (args: any) => { mutations.push({ operation: args }); return { count: 1 }; },
    },
    user: {
      findUnique: async ({ where }: any) => ({ id: where.id, role: 'ADMIN', isActive: !(change.inactive && where.id === 'admin'), erasedAt: null }),
      count: async () => 2,
    },
  };
  const prisma: any = { $transaction: async (work: (db: any) => Promise<any>) => work(tx) };
  return { prisma, mutations };
}

test('valid current second-admin approval is admitted without claiming or mutating the operation', async () => {
  const { prisma, mutations } = fixture();
  assert.equal((await preflightRecoveryOwnerRequest(prisma, { request, sealedSha256: sha })).admissible, true);
  assert.deepEqual(mutations, []);
});

for (const [name, change, status] of [
  ['expired', { expired: true }, 'EXPIRED'], ['inactive actor', { inactive: true }, 'FAILED'],
] as const) test(`bound ${name} requests terminate only pending control metadata`, async () => {
  const { prisma, mutations } = fixture(change);
  assert.equal((await preflightRecoveryOwnerRequest(prisma, { request, sealedSha256: sha })).admissible, false);
  assert.equal(mutations[0].operation.data.status, status);
  assert.equal(mutations[0].operation.where.progress, 0);
  assert.equal(mutations[0].operation.where.status, 'RESTORING');
  assert.equal(mutations[1].audit.eventType, 'OWNER_REQUEST_REJECTED');
  assert.equal(JSON.stringify(mutations).includes(request.passphrase), false);
});

test('an envelope without exactly bound request audit cannot mutate an operation', async () => {
  const { prisma, mutations } = fixture({ unbound: true });
  const result = await preflightRecoveryOwnerRequest(prisma, { request, sealedSha256: sha });
  assert.equal(result.admissible, false);
  assert.deepEqual(mutations, []);
});
