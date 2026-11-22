import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { measureDeploymentCapacity } from '../../scripts/deployment-capacity.mjs';

test('preflight budgets checkpoint, restore staging, image working space and headroom', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-capacity-'));
  try {
    await fs.writeFile(path.join(root, 'source'), Buffer.alloc(1000));
    const result = await measureDeploymentCapacity([root], 2000);
    assert.equal(result.sourceBytes, 1000);
    assert.equal(result.localBytes, 1073746224);
    assert.equal(result.remoteBytes, 1208);
  } finally { await fs.rm(root, { force: true, recursive: true }); }
});
