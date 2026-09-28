import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { readDeploymentDrillMetadata } from '../deploymentDrillMetadata';

const checkpoint = (createdAt: string) => ({ deploymentId: 'test-checkpoint', createdAt, remoteVerified: true });
const runOwner = (root: string) => spawnSync(process.execPath,
  [require.resolve('tsx/cli'), path.resolve(__dirname, '../../scripts/deployment-drill-preflight.ts')], {
    env: { ...process.env, DEPLOYMENT_REMOTE_MOUNT: root }, encoding: 'utf8', timeout: 20_000,
  });

test('remote EIO and permission failures abort instead of becoming an empty store', async () => {
  for (const code of ['EIO', 'EACCES']) {
    await assert.rejects(readDeploymentDrillMetadata('/remote', {
      readdir: async () => { throw Object.assign(new Error('sensitive host information'), { code }); },
      readFile: async () => '',
    }), (error: any) => error.code === 'DEPLOYMENT_REMOTE_STORE_UNAVAILABLE'
      && !error.message.includes('sensitive'));
  }
});

test('a failed nested directory aborts the complete inventory', async () => {
  await assert.rejects(readDeploymentDrillMetadata('/remote', {
    readdir: async (directory) => {
      if (directory === '/remote') return [{ name: 'nested', isDirectory: () => true } as fs.Dirent];
      throw Object.assign(new Error('unavailable'), { code: 'EIO' });
    }, readFile: async () => '',
  }), (error: any) => error.code === 'DEPLOYMENT_REMOTE_STORE_UNAVAILABLE');
});

test('unreadable sidecars cannot conceal a previous checkpoint', async () => {
  await assert.rejects(readDeploymentDrillMetadata('/remote', {
    readdir: async () => [{ name: 'checkpoint.sabrec.json', isDirectory: () => false, isFile: () => true } as fs.Dirent],
    readFile: async () => { throw Object.assign(new Error('unavailable'), { code: 'EIO' }); },
  }), (error: any) => error.code === 'DEPLOYMENT_REMOTE_METADATA_INVALID');
});

test('the real preflight owner preserves first deployment and rejects inaccessible or invalid inventory', async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sabalan-drill-preflight-'));
  try {
    const empty = runOwner(root);
    assert.equal(empty.status, 0, empty.stderr);
    assert.equal(JSON.parse(empty.stdout).reason, 'NO_PREVIOUS_REMOTE_CHECKPOINT');

    const absent = runOwner(path.join(root, 'missing'));
    assert.equal(absent.status, 1);
    assert.equal(JSON.parse(absent.stderr).code, 'DEPLOYMENT_REMOTE_STORE_UNAVAILABLE');

    await fs.promises.writeFile(path.join(root, 'checkpoint.sabrec.json'), '{broken');
    const corrupt = runOwner(root);
    assert.equal(corrupt.status, 1);
    assert.equal(JSON.parse(corrupt.stderr).code, 'DEPLOYMENT_REMOTE_METADATA_INVALID');

    await fs.promises.writeFile(path.join(root, 'checkpoint.sabrec.json'), JSON.stringify(checkpoint('not-a-date')));
    assert.equal(JSON.parse(runOwner(root).stderr).code, 'DEPLOYMENT_REMOTE_METADATA_INVALID');

    const recent = checkpoint(new Date().toISOString());
    await fs.promises.writeFile(path.join(root, 'checkpoint.sabrec.json'), JSON.stringify(recent));
    const initial = runOwner(root);
    assert.equal(initial.status, 0, initial.stderr);
    assert.equal(JSON.parse(initial.stdout).decision.reason, 'INITIAL_CHECKPOINT_GRACE');

    const old = checkpoint(new Date(Date.now() - 150 * 86400_000).toISOString());
    await fs.promises.writeFile(path.join(root, 'checkpoint.sabrec.json'), JSON.stringify(old));
    assert.equal(JSON.parse(runOwner(root).stderr).code, 'DEPLOYMENT_DRILL_OVERDUE');

    const withDrill = { ...old, lastDrill: { status: 'HEALTHY', completedAt: new Date().toISOString() } };
    await fs.promises.writeFile(path.join(root, 'checkpoint.sabrec.json'), JSON.stringify(withDrill));
    assert.equal(JSON.parse(runOwner(root).stderr).code, 'DEPLOYMENT_REHEARSAL_OVERDUE');

    await fs.promises.writeFile(path.join(root, 'checkpoint.sabrec.json'), JSON.stringify({
      ...withDrill, lastRehearsal: { status: 'HEALTHY', completedAt: new Date().toISOString() },
    }));
    const healthy = runOwner(root);
    assert.equal(healthy.status, 0, healthy.stderr);
    assert.equal(JSON.parse(healthy.stdout).checkpoint, old.deploymentId);
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
});
