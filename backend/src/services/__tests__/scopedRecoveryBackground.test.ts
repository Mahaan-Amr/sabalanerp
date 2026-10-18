import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('an unowned or late background binding cannot replace ordinary recovery admission', async () => {
  const parent = await fs.realpath(os.tmpdir());
  const directory = await fs.mkdtemp(path.join(parent, 'sabalan-scoped-background-'));
  const previous = process.env.RECOVERY_COORDINATION_DIR;
  process.env.RECOVERY_COORDINATION_DIR = directory;
  try {
    const runtime = await import('../recoveryRuntime');
    assert.throws(() => runtime.bindScopedRecoveryBackgroundOwner(undefined as never), /SCOPED_BACKGROUND_OWNER_UNPROVEN/);
    runtime.initializeRecoveryRuntime();
    runtime.setRecoveryRuntimeState('MAINTENANCE');
    let effects = 0;
    assert.equal(await runtime.withRecoveryBackgroundWrite(async () => ++effects), undefined);
    assert.equal(effects, 0);
    assert.throws(() => runtime.bindScopedRecoveryBackgroundOwner(undefined as never), /SCOPED_BACKGROUND_OWNER_UNPROVEN/);
    runtime.setRecoveryRuntimeState('NORMAL');
    assert.equal(await runtime.withRecoveryBackgroundWrite(async () => ++effects), 1);
    await runtime.waitForActiveWrites(1000);
  } finally {
    if (previous === undefined) delete process.env.RECOVERY_COORDINATION_DIR;
    else process.env.RECOVERY_COORDINATION_DIR = previous;
    assert.equal(path.dirname(await fs.realpath(directory)), parent);
    await fs.rm(directory, { recursive: true });
  }
});
