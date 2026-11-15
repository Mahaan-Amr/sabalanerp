import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { enforceTwoNewestLocalCheckpoints } from '../deploymentCheckpointStorage';

const fixture = async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-two-local-'));
  const local = path.join(base, 'local');
  const remote = path.join(base, 'remote');
  await fs.mkdir(local);
  await fs.mkdir(remote);
  const add = async (id: string, day: number, incidentOpen = false) => {
    const archivePath = path.join(local, `${id}.sabrec`);
    const remotePath = path.join(remote, `${id}.sabrec`);
    const bytes = Buffer.from(`complete-${id}`);
    const checksum = createHash('sha256').update(bytes).digest('hex');
    await fs.writeFile(archivePath, bytes);
    await fs.writeFile(remotePath, bytes);
    const metadata = { id, archivePath, metadataPath: `${archivePath}.json`, remotePath,
      size: bytes.length, checksum, createdAt: `2026-11-${String(day).padStart(2, '0')}T00:00:00Z`,
      localVerified: true, remoteVerified: true, restoreVerified: true, incidentOpen,
      manifest: { packageType: 'COMPLETE' } };
    await fs.writeFile(`${archivePath}.json`, JSON.stringify(metadata));
    await fs.writeFile(`${remotePath}.json`, JSON.stringify(metadata));
    return { archivePath, remotePath };
  };
  return { base, local, remote, add };
};

test('retains the two newest complete local archives and removes the older local copy only', async () => {
  const value = await fixture();
  try {
    const oldest = await value.add('oldest', 10);
    const second = await value.add('second', 12);
    const latest = await value.add('latest', 14);
    const result = await enforceTwoNewestLocalCheckpoints(value.local, value.remote, 'latest');
    assert.deepEqual(result, { deletedIds: ['oldest'], heldIds: [] });
    await assert.rejects(fs.stat(oldest.archivePath), { code: 'ENOENT' });
    await fs.stat(oldest.remotePath);
    await fs.stat(second.archivePath);
    await fs.stat(latest.archivePath);
  } finally { await fs.rm(value.base, { recursive: true, force: true }); }
});

test('refuses pruning when a retained remote archive cannot be verified', async () => {
  const value = await fixture();
  try {
    const oldest = await value.add('oldest', 10);
    await value.add('second', 12);
    const latest = await value.add('latest', 14);
    await fs.writeFile(latest.remotePath, 'corrupted');
    await assert.rejects(enforceTwoNewestLocalCheckpoints(value.local, value.remote, 'latest'),
      /DEPLOYMENT_TWO_LOCAL_REPLACEMENT_INVALID/);
    await fs.stat(oldest.archivePath);
  } finally { await fs.rm(value.base, { recursive: true, force: true }); }
});

test('preserves an older incident hold and reports it', async () => {
  const value = await fixture();
  try {
    const oldest = await value.add('oldest', 10, true);
    await value.add('second', 12);
    await value.add('latest', 14);
    const result = await enforceTwoNewestLocalCheckpoints(value.local, value.remote, 'latest');
    assert.deepEqual(result, { deletedIds: [], heldIds: ['oldest'] });
    await fs.stat(oldest.archivePath);
  } finally { await fs.rm(value.base, { recursive: true, force: true }); }
});

test('completes a previously journaled local archive removal', async () => {
  const value = await fixture();
  try {
    const oldest = await value.add('oldest', 10);
    await value.add('second', 12);
    await value.add('latest', 14);
    const metadata = JSON.parse(await fs.readFile(`${oldest.archivePath}.json`, 'utf8'));
    await fs.writeFile(path.join(value.local, 'retention-audit.jsonl'),
      JSON.stringify({ id: 'oldest', checksum: metadata.checksum, event: 'RETENTION_INTENT' }) + '\n');
    await fs.unlink(oldest.archivePath);
    const result = await enforceTwoNewestLocalCheckpoints(value.local, value.remote, 'latest');
    assert.deepEqual(result.deletedIds, ['oldest']);
    await assert.rejects(fs.stat(`${oldest.archivePath}.json`), { code: 'ENOENT' });
  } finally { await fs.rm(value.base, { recursive: true, force: true }); }
});
