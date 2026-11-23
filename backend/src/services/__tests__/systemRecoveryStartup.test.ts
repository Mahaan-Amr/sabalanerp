import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { Prisma, PrismaClient } from '@prisma/client';

test('restricted recovery startup preserves pending owner requests and keeps restore journals closed', async () => {
  const coordination = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-recovery-startup-'));
  const previousCoordination = process.env.RECOVERY_COORDINATION_DIR;
  const previousUrl = process.env.DATABASE_URL;
  process.env.RECOVERY_COORDINATION_DIR = coordination;
  process.env.DATABASE_URL = 'postgresql://sabalan_application_runtime:fixture@localhost/sabalanerp';
  try {
    // Load after setting the fixture environment, using the same module cache as
    // the recovery engine and lifecycle so the one-shot HTTP binding stays single.
    const load = createRequire(__filename);
    const { RESTORE_JOURNAL_PATH, readRestoreJournal }: typeof import('../systemRecoveryEngine') = load('../systemRecoveryEngine');
    const { initializeSystemRecovery }: typeof import('../systemRecoveryLifecycle') = load('../systemRecoveryLifecycle');
    const { getRecoveryRuntimeState }: typeof import('../recoveryRuntime') = load('../recoveryRuntime');
    const updates: Prisma.RecoveryOperationUpdateManyArgs[] = [];
    const startupDatabase = {
      recoveryOperation: {
        updateMany: async (update: Prisma.RecoveryOperationUpdateManyArgs) => { updates.push(update); },
        findMany: async () => [],
        findFirst: async () => ({ downloadedAt: new Date() }),
      },
    } as unknown as PrismaClient;
    const ownerRequest = {
      status: 'CREATING', source: 'CREATED', progress: 0, storageName: null,
      auditEvents: { some: { eventType: 'RECOVERY_OWNER_BACKUP_REQUESTED' } },
    };
    await initializeSystemRecovery(startupDatabase);
    assert.deepEqual(updates[0]?.where, {
      status: { in: ['CREATING', 'VALIDATING', 'RESTORING'] },
      NOT: { OR: [ownerRequest, { status: 'RESTORING', progress: 0,
        auditEvents: { some: { eventType: 'RECOVERY_OWNER_HANDOFF_REQUESTED' } } }] },
    });
    const { expiresAt, ...expired } = updates[1]?.where ?? {};
    assert.deepEqual(expired, { OR: [ownerRequest, { status: 'RESTORING', progress: 0,
      auditEvents: { some: { eventType: 'RECOVERY_OWNER_HANDOFF_REQUESTED' } } }] });
    assert(typeof expiresAt === 'object' && expiresAt !== null && 'lte' in expiresAt && expiresAt.lte instanceof Date);
    assert.deepEqual(updates[1]?.data, { status: 'EXPIRED' });
    let databaseCalls = 0;
    const restrictedDatabase = new Proxy({} as PrismaClient, {
      get() {
        databaseCalls += 1;
        throw new Error('The restricted runtime must not touch recovery SQL while a journal exists.');
      },
    });

    assert.equal(await readRestoreJournal(), null);
    const pending = { operationId: 'restore-fixture', phase: 'FILES_PROMOTED' };
    await fs.writeFile(RESTORE_JOURNAL_PATH, JSON.stringify(pending));
    await initializeSystemRecovery(restrictedDatabase);
    const state = getRecoveryRuntimeState();
    assert.equal(state.mode, 'MAINTENANCE');
    assert.equal(state.operationId, pending.operationId);
    assert.deepEqual(await readRestoreJournal(), pending);

    await fs.writeFile(RESTORE_JOURNAL_PATH, '{invalid');
    await assert.rejects(readRestoreJournal(), /RECOVERY_RESTORE_JOURNAL_INVALID/);
    await initializeSystemRecovery(restrictedDatabase);
    assert.equal(getRecoveryRuntimeState().mode, 'MAINTENANCE');
    assert.equal(await fs.readFile(RESTORE_JOURNAL_PATH, 'utf8'), '{invalid');
    await fs.unlink(RESTORE_JOURNAL_PATH);
    await fs.mkdir(RESTORE_JOURNAL_PATH);
    await assert.rejects(readRestoreJournal(), /RECOVERY_RESTORE_JOURNAL_INVALID/);
    assert.equal(databaseCalls, 0);
  } finally {
    if (previousCoordination === undefined) delete process.env.RECOVERY_COORDINATION_DIR;
    else process.env.RECOVERY_COORDINATION_DIR = previousCoordination;
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    await fs.rm(coordination, { recursive: true, force: true });
  }
});
