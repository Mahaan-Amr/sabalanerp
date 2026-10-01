import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('background expiration admits no work during either maintenance mode and participates in recovery drain', async () => {
  const parent = os.tmpdir();
  const directory = fs.mkdtempSync(path.join(parent, 'sabalan-commercial-maintenance-'));
  process.env.RECOVERY_COORDINATION_DIR = directory;
  const runtime = await import('../recoveryRuntime');
  const deployment = await import('../deploymentMaintenance');
  try {
    runtime.setRecoveryRuntimeState('READ_ONLY');
    let writes = 0;
    assert.equal(await runtime.withRecoveryBackgroundWrite(async () => ++writes), undefined);
    runtime.setRecoveryRuntimeState('MAINTENANCE');
    assert.equal(await runtime.withRecoveryBackgroundWrite(async () => ++writes), undefined);
    runtime.setRecoveryRuntimeState('NORMAL');
    await deployment.activateDeploymentMaintenance(directory, { deploymentId: 'qa-expiry-gate', releaseId: 'qa', message: 'QA', activatedAt: new Date() });
    assert.equal(await runtime.withRecoveryBackgroundWrite(async () => ++writes), undefined);
    assert.equal(writes, 0);
    await deployment.deactivateDeploymentMaintenance(directory, 'qa-expiry-gate');
    let release!: () => void;
    const holding = new Promise<void>(resolve => { release = resolve; });
    const admitted = runtime.withRecoveryBackgroundWrite(async () => { writes++; await holding; });
    runtime.setRecoveryRuntimeState('MAINTENANCE');
    await assert.rejects(runtime.waitForActiveWrites(1), /Active writes did not drain/);
    release(); await admitted; await runtime.waitForActiveWrites(1);
    assert.equal(writes, 1);
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(parent));
    assert.ok(path.basename(directory).startsWith('sabalan-commercial-maintenance-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
