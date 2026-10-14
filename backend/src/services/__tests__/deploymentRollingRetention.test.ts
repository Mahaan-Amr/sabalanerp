import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planRemoteCheckpointRetention } from '../deploymentCheckpointPolicy';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { enforceFilesystemRemoteRetention, enforceLocalCheckpointRetention } from '../deploymentCheckpointStorage';

test('a third complete verified checkpoint retires the oldest while keeping two recovery points', () => {
  const artifacts = [1, 2, 3].map(value => ({
    id: `backup-${value}`, releaseId: `release-${value}`, size: 100,
    createdAt: new Date(`2026-10-0${value}T00:00:00Z`), remoteVerified: true,
    restoreVerified: true, active: value === 3, incidentOpen: false,
  }));
  const plan = planRemoteCheckpointRetention(artifacts);
  assert.deepEqual(plan.deleteIds, ['backup-1']);
  assert.deepEqual(plan.keepIds.sort(), ['backup-2', 'backup-3']);
});

test('incomplete backups and incident evidence stay protected outside the normal two-point limit', () => {
  const base = { releaseId: 'release', size: 100, createdAt: new Date('2026-01-01'), remoteVerified: true, active: false, incidentOpen: false };
  const plan = planRemoteCheckpointRetention([
    { ...base, id: 'incomplete' },
    { ...base, id: 'incident', restoreVerified: true, incidentOpen: true },
    { ...base, id: 'first', restoreVerified: true, createdAt: new Date('2026-01-02') },
    { ...base, id: 'second', restoreVerified: true, createdAt: new Date('2026-01-03') },
  ]);
  assert.deepEqual(plan.deleteIds, []);
});

test('remote cleanup verifies replacement bytes before deleting any old checkpoint', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-retention-'));
  try {
    for (const value of [1, 2, 3]) {
      const archive = path.join(root, `backup-${value}.sabrec`);
      const bytes = Buffer.from(`checkpoint-${value}`);
      await fs.writeFile(archive, bytes);
      await fs.writeFile(`${archive}.json`, JSON.stringify({
        id: `backup-${value}`, releaseId: `release-${value}`, remotePath: archive, size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'),
        createdAt: `2026-10-0${value}T00:00:00Z`, remoteVerified: true, restoreVerified: true,
      }));
    }
    await fs.appendFile(path.join(root, 'backup-3.sabrec'), 'corrupt');
    await assert.rejects(enforceFilesystemRemoteRetention(root, 'backup-3'));
    assert.equal(await fs.readFile(path.join(root, 'backup-1.sabrec'), 'utf8'), 'checkpoint-1');
    await fs.writeFile(path.join(root, 'backup-3.sabrec'), 'checkpoint-3');
    const result = await enforceFilesystemRemoteRetention(root, 'backup-3');
    assert.deepEqual(result.plan.deleteIds, ['backup-1']);
    await assert.rejects(fs.stat(path.join(root, 'backup-1.sabrec')), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('obsolete local copies are retired only after two independent replacements are proven', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sabalan-local-retention-'));
  try {
    const local = path.join(root, 'local'); const remote = path.join(root, 'remote');
    await fs.mkdir(local); await fs.mkdir(remote);
    for (const value of [1, 2, 3]) {
      const id = `backup-${value}`; const bytes = Buffer.from(`checkpoint-${value}`);
      const metadata = { id, releaseId: id, createdAt: `2026-10-0${value}T00:00:00Z`, size: bytes.length,
        checksum: createHash('sha256').update(bytes).digest('hex'), remoteVerified: true, restoreVerified: true,
        remotePath: path.join(remote, `${id}.sabrec`), archivePath: path.join(local, `${id}.sabrec`) };
      await fs.writeFile(metadata.archivePath, bytes); await fs.writeFile(metadata.remotePath, bytes);
      await fs.writeFile(`${metadata.archivePath}.json`, JSON.stringify(metadata));
      await fs.writeFile(`${metadata.remotePath}.json`, JSON.stringify(metadata));
    }
    const heldMetadata = path.join(local, 'backup-1.sabrec.json');
    const held = JSON.parse(await fs.readFile(heldMetadata, 'utf8'));
    await fs.writeFile(heldMetadata, JSON.stringify({ ...held, incidentOpen: true }));
    const protectedPlan = await enforceFilesystemRemoteRetention(remote, 'backup-3', local);
    assert.deepEqual(protectedPlan.plan.deleteIds, []);
    await fs.writeFile(heldMetadata, '{broken');
    await assert.rejects(enforceFilesystemRemoteRetention(remote, 'backup-3', local));
    assert.equal(await fs.readFile(path.join(remote, 'backup-1.sabrec'), 'utf8'), 'checkpoint-1');
    await fs.writeFile(heldMetadata, JSON.stringify(held));
    const retained = await enforceFilesystemRemoteRetention(remote, 'backup-3', local);
    await enforceLocalCheckpointRetention(local, remote, 'backup-3', retained);
    await assert.rejects(fs.stat(path.join(local, 'backup-1.sabrec')), { code: 'ENOENT' });
    assert.equal(await fs.readFile(path.join(local, 'backup-2.sabrec'), 'utf8'), 'checkpoint-2');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
