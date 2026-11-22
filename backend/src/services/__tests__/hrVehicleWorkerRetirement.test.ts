import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('retiring the HR assignment worker awaits its admitted database work', async () => {
  const parent = await fs.realpath(os.tmpdir());
  const coordination = await fs.mkdtemp(path.join(parent, 'sabalan-hr-worker-retirement-'));
  const previous = process.env.RECOVERY_COORDINATION_DIR;
  process.env.RECOVERY_COORDINATION_DIR = coordination;
  let finish!: (rows: never[]) => void;
  let entered!: () => void;
  const admitted = new Promise<void>(resolve => { entered = resolve; });
  const pending = new Promise<never[]>(resolve => { finish = resolve; });
  try {
    const {initializeRecoveryRuntime} = await import('../recoveryRuntime');
    const {startHrVehicleAssignmentMaintenance} = await import('../hrVehicleAssignmentWorker');
    const {stopBackgroundJobs} = await import('../backgroundJobLifecycle');
    initializeRecoveryRuntime();
    const database = {driverVehicleAssignmentPlan: {findMany: async () => { entered(); return pending; }}};
    const stop = startHrVehicleAssignmentMaintenance(database as any);
    await admitted;
    stop(); // Cancelling a timer must not stand in for database completion.
    let drained = false;
    const retirement = stopBackgroundJobs(1000).then(() => { drained = true; });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(drained, false);
    finish([]);
    await retirement;
    assert.equal(drained, true);
  } finally {
    finish([]);
    if (previous === undefined) delete process.env.RECOVERY_COORDINATION_DIR;
    else process.env.RECOVERY_COORDINATION_DIR = previous;
    assert.equal(path.dirname(await fs.realpath(coordination)), parent);
    await fs.rm(coordination, {recursive: true});
  }
});
