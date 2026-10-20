import { withHealthyDrill } from './deploymentCheckpointDrill.fixture';
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
    const enumerationRoot = path.join(root, 'remote-enumeration');
    await fs.promises.mkdir(path.join(enumerationRoot, 'empty-historical-directory'), { recursive: true });
    const protectedArchive = path.join(enumerationRoot, 'protected.sabrec');
    await fs.promises.writeFile(protectedArchive, 'retained-checkpoint');
    const originalReaddir = fs.promises.readdir;
    let enumerationAttempts = 0;
    try {
      (fs.promises as any).readdir = async (directory: string, options: any) => {
        if (directory === enumerationRoot && ++enumerationAttempts === 1) {
          throw Object.assign(new Error('transient SSHFS directory read'), { code: 'EIO' });
        }
        return originalReaddir(directory, options);
      };
      await new FilesystemRemoteCheckpointStore(enumerationRoot, { retryDelayMs: 1 }).assertAvailable(1);
      assert.equal(enumerationAttempts, 2, 'a transient directory error must retry the complete listing');
      assert.equal(await fs.promises.readFile(protectedArchive, 'utf8'), 'retained-checkpoint');
      enumerationAttempts = 0;
      (fs.promises as any).readdir = async (directory: string, options: any) => {
        if (directory === enumerationRoot) {
          enumerationAttempts += 1;
          throw Object.assign(new Error('persistent SSHFS directory failure'), { code: 'EIO' });
        }
        return originalReaddir(directory, options);
      };
      await assert.rejects(
        () => new FilesystemRemoteCheckpointStore(enumerationRoot, { retryDelayMs: 1 }).assertAvailable(1),
        (error: any) => error.code === 'EIO',
      );
      assert.equal(enumerationAttempts, 4, 'persistent directory failure must abort after three retries');
      enumerationAttempts = 0;
      (fs.promises as any).readdir = async (directory: string, options: any) => {
        if (directory === enumerationRoot) {
          enumerationAttempts += 1;
          throw Object.assign(new Error('directory permission denied'), { code: 'EACCES' });
        }
        return originalReaddir(directory, options);
      };
      await assert.rejects(
        () => new FilesystemRemoteCheckpointStore(enumerationRoot, { retryDelayMs: 1 }).assertAvailable(1),
        (error: any) => error.code === 'EACCES',
      );
      assert.equal(enumerationAttempts, 1, 'permission failures must not be hidden by storage retries');
      assert.equal(await fs.promises.readFile(protectedArchive, 'utf8'), 'retained-checkpoint');
    } finally {
      fs.promises.readdir = originalReaddir;
    }
    const partialPath = path.join(root, 'release-1', 'deployment-1.sabrec.uploading');
    await fs.promises.mkdir(path.dirname(partialPath), { recursive: true });
    await fs.promises.writeFile(partialPath, 'verified');
    const uploaded = await store.uploadVerified(source, 'release-1/deployment-1.sabrec');
    assert.equal(await fs.promises.readFile(uploaded.objectPath, 'utf8'), 'verified-checkpoint');

    let transientCopyAttempts = 0;
    const transientStore = new FilesystemRemoteCheckpointStore(root, {
      retryDelayMs: 1,
      copyRange: async (sourcePath, temporaryPath, start) => {
        transientCopyAttempts += 1;
        const sourceBytes = await fs.promises.readFile(sourcePath);
        if (transientCopyAttempts === 1) {
          await fs.promises.writeFile(temporaryPath, sourceBytes.subarray(start, start + 8), {
            flag: start ? 'a' : 'wx',
            mode: 0o600,
          });
          throw Object.assign(new Error('simulated SSHFS disconnect'), { code: 'EIO' });
        }
        await fs.promises.writeFile(temporaryPath, sourceBytes.subarray(start), {
          flag: start ? 'a' : 'wx',
          mode: 0o600,
        });
      },
    });
    const transientUpload = await transientStore.uploadVerified(source, 'release-transient/deployment-transient.sabrec');
    assert.equal(await fs.promises.readFile(transientUpload.objectPath, 'utf8'), 'verified-checkpoint');
    assert.equal(transientCopyAttempts, 2, 'a transient remote write must resume inside the same deployment attempt');
    const hashFile = (await import('../recoveryCrypto')).sha256File;
    let transientReadAttempts = 0;
    const transientReadStore = new FilesystemRemoteCheckpointStore(root, {
      retryDelayMs: 1,
      readChecksum: async filePath => {
        transientReadAttempts += 1;
        if (transientReadAttempts === 1) {
          throw Object.assign(new Error('simulated remote read close failure'), { code: 'EIO' });
        }
        return hashFile(filePath);
      },
    });
    const recoveredRead = await transientReadStore.uploadVerified(source, 'release-read/deployment-read.sabrec');
    assert.equal(recoveredRead.checksum, uploaded.checksum);
    assert.equal(transientReadAttempts, 2, 'a transient read must retry a complete checksum, never accept partial verification');
    let persistentReadAttempts = 0;
    const persistentReadStore = new FilesystemRemoteCheckpointStore(root, {
      retryDelayMs: 1,
      readChecksum: async () => {
        persistentReadAttempts += 1;
        throw Object.assign(new Error('persistent remote read failure'), { code: 'EIO' });
      },
    });
    await assert.rejects(
      () => persistentReadStore.uploadVerified(source, 'release-read-failed/deployment-read-failed.sabrec'),
      (error: any) => error?.code === 'EIO',
    );
    assert.equal(persistentReadAttempts, 4, 'persistent verification failure must stop after three retries');
    assert.equal(fs.existsSync(path.join(root, 'release-read-failed/deployment-read-failed.sabrec')), false);
    let corruptReadAttempts = 0;
    const corruptReadStore = new FilesystemRemoteCheckpointStore(root, {
      retryDelayMs: 1,
      readChecksum: async () => { corruptReadAttempts += 1; return 'corrupt-checksum'; },
    });
    await assert.rejects(
      () => corruptReadStore.uploadVerified(source, 'release-read-corrupt/deployment-read-corrupt.sabrec'),
      (error: any) => error?.code === 'DEPLOYMENT_REMOTE_CHECKSUM_MISMATCH',
    );
    assert.equal(corruptReadAttempts, 1, 'checksum corruption must fail immediately');
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
    for (const [index, validRemote] of [false, true, true, true, true, true].entries()) {
      const id = `deployment-${index}`;
      const archivePath = path.join(localRoot, `${id}.sabrec`);
      const metadataPath = `${archivePath}.json`;
      const remotePath = path.join(remoteRoot, `${id}.sabrec`);
      await fs.promises.writeFile(archivePath, `local-${id}`);
      await fs.promises.writeFile(metadataPath, '{}');
      await fs.promises.writeFile(remotePath, `remote-${id}`);
      const checksum = await (await import('../recoveryCrypto')).sha256File(remotePath);
      const point = { id, releaseId: id, deploymentId: id, archivePath, metadataPath, remotePath, checksum,
        size: (await fs.promises.stat(remotePath)).size, createdAt: new Date(2026, 0, index + 1).toISOString(), remoteVerified: true };
      const remote = index <= 3 ? withHealthyDrill(point) : { ...point, localVerified: true, restoreVerified: true,
        manifestReadable: true, compatibility: { local: { compatible: true } } };
      await fs.promises.writeFile(`${remotePath}.json`, JSON.stringify({ ...remote, checksum: validRemote ? checksum : 'stale' }));
      artifacts.push(point);
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
    assert.equal(fs.existsSync(artifacts[1].archivePath), false, 'an older independently healthy checkpoint may be pruned after two healthy replacements');
    for (const index of [2, 3, 4, 5]) assert.equal(fs.existsSync(artifacts[index].archivePath), true,
      'keep two healthy points and protect newly uploaded points without independent restore');
  } finally {
    await fs.promises.rm(root, { recursive: true, force: true });
  }
  console.log('deployment checkpoint storage tests passed');
};

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
