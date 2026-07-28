import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { planHiringFilesForDeletion, stagePlannedHiringFiles } from '../hrDeletionFileTransaction';
import { recoverInterruptedPersonnelErasures } from '../hrPersonnelErasureRecovery';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-hr-recovery-'));
fs.writeFileSync(path.join(root, 'evidence.pdf'), 'evidence');
const staged = stagePlannedHiringFiles(planHiringFilesForDeletion(['evidence.pdf'], 'recovery-operation', root));
const actions: string[] = [];

const tx = {
  authSession: { updateMany: async () => { actions.push('sessions'); } },
  user: { updateMany: async () => { actions.push('user'); } },
  hrDeletionFileCleanup: { deleteMany: async () => { actions.push('cleanup'); } },
  hrDeletionReceipt: { update: async ({ data }: { data: { status: string } }) => { actions.push(`receipt:${data.status}`); } },
};
const fakePrisma = {
  hrDeletionReceipt: {
    findMany: async () => [{
      id: 'receipt-1', actorUserId: 'admin-1', status: 'ACCESS_PREPARED',
      recordCounts: { accessRecovery: { users: [{ id: 'user-1', isActive: true }], sessionIds: ['session-1'] } }
    }],
    update: async () => undefined,
  },
  hrDeletionFileCleanup: { findMany: async () => staged },
  $transaction: async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
} as unknown as PrismaClient;

const run = async () => {
  assert.equal(await recoverInterruptedPersonnelErasures(fakePrisma), 1);
  assert.equal(fs.readFileSync(path.join(root, 'evidence.pdf'), 'utf8'), 'evidence');
  assert.deepEqual(actions, ['sessions', 'user', 'cleanup', 'receipt:ABORTED']);
  fs.rmSync(root, { recursive: true, force: true });
  console.log('HR Personnel erasure recovery tests passed.');
};

run().catch((error) => {
  fs.rmSync(root, { recursive: true, force: true });
  console.error(error);
  process.exit(1);
});
