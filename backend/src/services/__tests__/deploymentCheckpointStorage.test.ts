import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertRemoteCheckpointFingerprint,
  FilesystemRemoteCheckpointStore,
  ensureLocalCapacity,
  estimateCheckpointCapacity,
  type CheckpointObject,
} from '../deploymentCheckpointStorage';

const run = async () => {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'sabalan-remote-checkpoint-'));
  try {
    const source = path.join(root, 'source.sabrec');
    await fs.promises.writeFile(source, 'verified-checkpoint');
    const store = new FilesystemRemoteCheckpointStore(root);
    await store.assertAvailable(1);
    const partialPath = path.join(root, 'release-1', 'deployment-1.sabrec.uploading');
    await fs.promises.mkdir(path.dirname(partialPath), { recursive: true });
    await fs.promises.writeFile(partialPath, 'verified');
    const uploaded = await store.uploadVerified(source, 'release-1/deployment-1.sabrec');
    assert.equal(await fs.promises.readFile(uploaded.objectPath, 'utf8'), 'verified-checkpoint');
    assert.deepEqual(await assertRemoteCheckpointFingerprint(uploaded.objectPath, uploaded.fingerprint), uploaded.fingerprint);
    await fs.promises.appendFile(uploaded.objectPath, '-changed');
    await assert.rejects(
      () => assertRemoteCheckpointFingerprint(uploaded.objectPath, uploaded.fingerprint),
      (error: any) => error?.code === 'DEPLOYMENT_REMOTE_FINGERPRINT_MISMATCH',
    );
    await fs.promises.writeFile(uploaded.objectPath, 'verified-checkpoint');
    const metadataPath = path.join(root, 'release-1', 'deployment-1.sabrec.json');
    await fs.promises.writeFile(metadataPath, JSON.stringify({ checksum: uploaded.checksum }));
    assert.equal((await store.readMetadata('release-1/deployment-1.sabrec.json')).checksum, uploaded.checksum);

    const expectedChecksumPath = path.join(root, 'expected-checksum.sabrec');
    await fs.promises.writeFile(expectedChecksumPath, 'verified-checkpoint');
    const expectedChecksumUpload = await store.uploadVerified(
      expectedChecksumPath,
      'release-2/deployment-2.sabrec',
      uploaded.checksum,
    );
    assert.equal(expectedChecksumUpload.checksum, uploaded.checksum);
    await assert.rejects(
      () => store.uploadVerified(expectedChecksumPath, 'release-3/deployment-3.sabrec', 'not-the-source-checksum'),
      (error: any) => error?.code === 'DEPLOYMENT_REMOTE_CHECKSUM_MISMATCH',
    );

    const capacity = estimateCheckpointCapacity({ databaseBytes: 100, protectedFilesBytes: 100, dockerWorkingBytes: 0, headroomBytes: 0 });
    assert.equal(capacity.checkpointBytes, 230);
    assert.equal(capacity.requiredLocalBytes, 480);
    await assert.rejects(() => store.uploadVerified(source, '../escaped.sabrec'), (error: any) => error?.code === 'DEPLOYMENT_REMOTE_KEY_UNSAFE');

    const localRoot = path.join(root, 'local');
    const remoteRoot = path.join(root, 'remote');
    await fs.promises.mkdir(localRoot);
    await fs.promises.mkdir(remoteRoot);
    const artifacts: CheckpointObject[] = [];
    for (const [index, validRemote] of [false, true, true, true].entries()) {
      const id = `deployment-${index}`;
      const archivePath = path.join(localRoot, `${id}.sabrec`);
      const metadataPath = `${archivePath}.json`;
      const remotePath = path.join(remoteRoot, `${id}.sabrec`);
      await fs.promises.writeFile(archivePath, `local-${id}`);
      await fs.promises.writeFile(metadataPath, '{}');
      await fs.promises.writeFile(remotePath, `remote-${id}`);
      const checksum = await (await import('../recoveryCrypto')).sha256File(remotePath);
      await fs.promises.writeFile(`${remotePath}.json`, JSON.stringify({ id, deploymentId: id, checksum: validRemote ? checksum : 'stale', remoteVerified: true }));
      artifacts.push({ id, archivePath, metadataPath, remotePath, checksum, size: 4096, createdAt: new Date(2026, 0, index + 1).toISOString(), remoteVerified: true });
    }
    const localStats = await fs.promises.statfs(localRoot);
    await ensureLocalCapacity({
      root: localRoot,
      requiredBytes: localStats.bavail * localStats.bsize + 1,
      artifacts,
      activeDeploymentId: 'new-deployment',
      auditPath: path.join(localRoot, 'audit.jsonl'),
    }).catch((error: any) => {
      assert.equal(error.code, 'DEPLOYMENT_LOCAL_CAPACITY_INSUFFICIENT');
    });
    assert.equal(fs.existsSync(artifacts[0].archivePath), true, 'stale remote proof must protect the local checkpoint');
    assert.equal(fs.existsSync(artifacts[1].archivePath), false, 'a freshly reverified remote checkpoint may be pruned');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  console.log('deployment checkpoint storage tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
