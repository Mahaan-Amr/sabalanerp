import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  activateDeploymentMaintenance,
  deactivateDeploymentMaintenance,
  readDeploymentMaintenance,
} from '../deploymentMaintenance';

const run = async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-deployment-maintenance-'));
  try {
    const active = await activateDeploymentMaintenance(root, {
      deploymentId: 'deploy-1',
      releaseId: 'release-1',
      message: 'سامانه در حال به‌روزرسانی است.',
      activatedAt: new Date('2026-08-11T08:00:00.000Z'),
    });
    assert.equal(active.deploymentId, 'deploy-1');
    assert.deepEqual(await readDeploymentMaintenance(root), active);

    await assert.rejects(
      deactivateDeploymentMaintenance(root, 'deploy-2'),
      (error: any) => error.code === 'DEPLOYMENT_MAINTENANCE_NOT_OWNED',
    );
    assert.equal((await readDeploymentMaintenance(root))?.deploymentId, 'deploy-1');

    await deactivateDeploymentMaintenance(root, 'deploy-1');
    assert.equal(await readDeploymentMaintenance(root), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log('deployment maintenance tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
