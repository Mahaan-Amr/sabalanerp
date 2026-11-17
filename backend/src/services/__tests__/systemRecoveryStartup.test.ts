import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';

test('recovery startup keeps pending and unreadable journals closed for the restricted runtime', async () => {
  const coordination = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-recovery-startup-'));
  const previousCoordination = process.env.RECOVERY_COORDINATION_DIR;
  const previousUrl = process.env.DATABASE_URL;
  process.env.RECOVERY_COORDINATION_DIR = coordination;
  process.env.DATABASE_URL = 'postgresql://sabalan_application_runtime:fixture@localhost/sabalanerp';
  try {
    const { RESTORE_JOURNAL_PATH, readRestoreJournal } = await import('../systemRecoveryEngine');
    const { initializeSystemRecovery } = await import('../systemRecoveryLifecycle');
    const { getRecoveryRuntimeState } = await import('../recoveryRuntime');
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
