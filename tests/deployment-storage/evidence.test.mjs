import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readStorageProtection } from '../../scripts/deployment-storage.mjs';

test('checkpoint evidence preserves images and refuses corrupt metadata', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-storage-'));
  try {
    const id = `sha256:${'a'.repeat(64)}`;
    await fs.writeFile(path.join(root, 'old.sabrec.json'), JSON.stringify({ rollbackReleaseSet: { backend: id } }));
    assert.deepEqual(await readStorageProtection([root]), [id]);
    await fs.writeFile(path.join(root, 'unknown.sabrec.json'), '{}');
    await assert.rejects(readStorageProtection([root]), /EVIDENCE_INVALID/);
    await fs.unlink(path.join(root, 'unknown.sabrec.json'));
    await fs.writeFile(path.join(root, 'broken.sabrec.json'), '{');
    await assert.rejects(readStorageProtection([root]));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('a missing configured recovery inventory never means no protected images', async () => {
  await assert.rejects(readStorageProtection([path.join(os.tmpdir(), 'sabalan-storage-nonexistent', 'missing')]));
});
