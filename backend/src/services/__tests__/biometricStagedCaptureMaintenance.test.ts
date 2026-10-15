import assert from 'node:assert/strict';
import test, { mock } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('biometric expiry worker skips protected modes and participates in write drain', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'biometric-maintenance-'));
  process.env.RECOVERY_COORDINATION_DIR = directory;
  const runtime = await import('../recoveryRuntime');
  const worker = await import('../biometricStagedCaptureMaintenance');
  let tick!: () => Promise<void>;
  let writes = 0;
  let release!: () => void;
  const holding = new Promise<void>(resolve => { release = resolve; });
  const prisma = { biometricConnectorChallenge: { updateMany: async () => { writes++; await holding; return { count: 1 }; } } } as never;
  mock.method(globalThis, 'setInterval', (callback: any) => { tick = callback; return { unref() {} } as any; });
  mock.method(globalThis, 'clearInterval', () => {});
  let stop: (() => void) | undefined;
  try {
    runtime.setRecoveryRuntimeState('READ_ONLY');
    stop = worker.startBiometricStagedCaptureMaintenance(prisma);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(writes, 0);
    runtime.setRecoveryRuntimeState('MAINTENANCE');
    await tick();
    assert.equal(writes, 0);
    runtime.setRecoveryRuntimeState('NORMAL');
    fs.writeFileSync(path.join(directory, 'deployment-maintenance.json'), JSON.stringify({ mode: 'MAINTENANCE' }));
    await tick();
    assert.equal(writes, 0);
    fs.unlinkSync(path.join(directory, 'deployment-maintenance.json'));
    const admitted = tick();
    assert.equal(writes, 1);
    await assert.rejects(runtime.waitForActiveWrites(1), /Active writes did not drain/);
    runtime.setRecoveryRuntimeState('MAINTENANCE');
    await tick();
    assert.equal(writes, 1);
    release();
    await admitted;
    await runtime.waitForActiveWrites(1);
    await tick();
    assert.equal(writes, 1);
  } finally {
    release(); stop?.(); mock.restoreAll();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('biometric-maintenance-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
