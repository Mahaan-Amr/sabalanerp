import fs from 'node:fs';
import path from 'node:path';
import { sha256File } from './recoveryCrypto';
import { planLocalCheckpointCleanup, planRemoteCheckpointRetention, type LocalCheckpointArtifact } from './deploymentCheckpointPolicy';

export type CheckpointObject = {
  id: string;
  archivePath: string;
  metadataPath: string;
  size: number;
  checksum: string;
  createdAt: string;
  remoteVerified: boolean;
  remotePath?: string;
  active?: boolean;
  incidentOpen?: boolean;
};

export interface RemoteCheckpointStore {
  assertAvailable(requiredBytes: number): Promise<{ availableBytes: number }>;
  uploadVerified(sourcePath: string, objectKey: string, expectedChecksum?: string): Promise<{
    objectPath: string;
    checksum: string;
    size: number;
    fingerprint: RemoteCheckpointFingerprint;
  }>;
  readMetadata(objectKey: string): Promise<Record<string, unknown>>;
}

export type RemoteCheckpointFingerprint = { size: number; mtimeMs: number };

export const readRemoteCheckpointFingerprint = async (remotePath: string): Promise<RemoteCheckpointFingerprint> => {
  const stat = await fs.promises.stat(remotePath);
  if (!stat.isFile()) throw Object.assign(new Error('Remote checkpoint is not a regular file.'), { code: 'DEPLOYMENT_REMOTE_OBJECT_INVALID' });
  return { size: stat.size, mtimeMs: stat.mtimeMs };
};

export const assertRemoteCheckpointFingerprint = async (
  remotePath: string,
  expected: RemoteCheckpointFingerprint | undefined,
) => {
  if (!expected || !Number.isFinite(expected.size) || !Number.isFinite(expected.mtimeMs)) {
    throw Object.assign(new Error('Remote checkpoint fingerprint is missing.'), { code: 'DEPLOYMENT_REMOTE_FINGERPRINT_MISSING' });
  }
  const actual = await readRemoteCheckpointFingerprint(remotePath);
  if (actual.size !== expected.size || actual.mtimeMs !== expected.mtimeMs) {
    throw Object.assign(new Error('Remote checkpoint fingerprint changed after pre-mutation verification.'), {
      code: 'DEPLOYMENT_REMOTE_FINGERPRINT_MISMATCH',
    });
  }
  return actual;
};

const safeObjectKey = (value: string) => {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!normalized || normalized.split('/').includes('..')) {
    throw Object.assign(new Error('Remote checkpoint object key is unsafe.'), { code: 'DEPLOYMENT_REMOTE_KEY_UNSAFE' });
  }
  return normalized;
};

export class FilesystemRemoteCheckpointStore implements RemoteCheckpointStore {
  constructor(private readonly root: string) {}

  async assertAvailable(requiredBytes: number) {
    await fs.promises.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
    await this.removeExpiredIncompleteUploads(this.root);
    const stats = await fs.promises.statfs(this.root);
    const availableBytes = stats.bavail * stats.bsize;
    if (availableBytes < requiredBytes) {
      throw Object.assign(new Error(`Remote checkpoint storage needs ${requiredBytes} bytes but only ${availableBytes} are available.`), {
        code: 'DEPLOYMENT_REMOTE_CAPACITY_INSUFFICIENT',
      });
    }
    return { availableBytes };
  }

  private async removeExpiredIncompleteUploads(directory: string): Promise<void> {
    const entries = await fs.promises.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await this.removeExpiredIncompleteUploads(absolute);
      else if (entry.isFile() && entry.name.endsWith('.uploading')) {
        const stat = await fs.promises.stat(absolute);
        if (Date.now() - stat.mtimeMs > 24 * 60 * 60 * 1000) await fs.promises.rm(absolute, { force: true });
      }
    }
  }

  async uploadVerified(sourcePath: string, objectKey: string, expectedChecksum?: string) {
    const destination = path.join(this.root, safeObjectKey(objectKey));
    const resolvedRoot = path.resolve(this.root);
    if (!path.resolve(destination).startsWith(`${resolvedRoot}${path.sep}`)) {
      throw Object.assign(new Error('Remote checkpoint destination escaped its configured root.'), { code: 'DEPLOYMENT_REMOTE_KEY_UNSAFE' });
    }
    await fs.promises.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.uploading`;
    const sourceStat = await fs.promises.stat(sourcePath);
    let uploadedBytes = await fs.promises.stat(temporary).then((stat) => stat.size).catch(() => 0);
    if (uploadedBytes > sourceStat.size) {
      await fs.promises.rm(temporary, { force: true });
      uploadedBytes = 0;
    }
    if (uploadedBytes < sourceStat.size) {
      const { pipeline } = await import('node:stream/promises');
      await pipeline(
        fs.createReadStream(sourcePath, { start: uploadedBytes }),
        fs.createWriteStream(temporary, { flags: uploadedBytes ? 'a' : 'wx', mode: 0o600 }),
      );
    }
    const [sourceChecksum, uploadedChecksum, stat] = await Promise.all([
      expectedChecksum ? Promise.resolve(expectedChecksum) : sha256File(sourcePath),
      sha256File(temporary),
      fs.promises.stat(temporary),
    ]);
    if (sourceChecksum !== uploadedChecksum) {
      await fs.promises.rm(temporary, { force: true });
      throw Object.assign(new Error('Remote checkpoint checksum differs from the local checkpoint.'), {
        code: 'DEPLOYMENT_REMOTE_CHECKSUM_MISMATCH',
      });
    }
    await fs.promises.rename(temporary, destination);
    return {
      objectPath: destination,
      checksum: sourceChecksum,
      size: stat.size,
      fingerprint: await readRemoteCheckpointFingerprint(destination),
    };
  }

  async readMetadata(objectKey: string) {
    const metadata = JSON.parse(await fs.promises.readFile(path.join(this.root, safeObjectKey(objectKey)), 'utf8')) as Record<string, unknown>;
    if (!metadata || typeof metadata !== 'object') {
      throw Object.assign(new Error('Remote checkpoint metadata is unreadable.'), { code: 'DEPLOYMENT_REMOTE_MANIFEST_UNREADABLE' });
    }
    return metadata;
  }
}

export const readSecret = async (name: string) => {
  const file = String(process.env[`${name}_FILE`] || '').trim();
  const value = file ? (await fs.promises.readFile(file, 'utf8')).trim() : String(process.env[name] || '').trim();
  if (value.length < 32 || /REPLACE|CHANGE_ME|UNCONFIGURED/.test(value)) {
    throw Object.assign(new Error(`${name} must be supplied by a configured secret file and contain at least 32 characters.`), {
      code: 'DEPLOYMENT_KEY_INVALID',
    });
  }
  return value;
};

export const readConfiguredFile = async (name: string) => {
  const file = String(process.env[`${name}_FILE`] || '').trim();
  if (!file) throw Object.assign(new Error(`${name}_FILE is required.`), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  const value = await fs.promises.readFile(file, 'utf8');
  if (!value.trim()) throw Object.assign(new Error(`${name}_FILE is empty.`), { code: 'DEPLOYMENT_CONFIGURATION_MISSING' });
  return value;
};

export const estimateCheckpointCapacity = (input: {
  databaseBytes: number;
  protectedFilesBytes: number;
  dockerWorkingBytes?: number;
  headroomBytes?: number;
}) => {
  const sourceBytes = input.databaseBytes + input.protectedFilesBytes;
  const checkpointBytes = Math.ceil(sourceBytes * 1.15);
  const restoreStagingBytes = Math.ceil(sourceBytes * 1.25);
  const dockerWorkingBytes = input.dockerWorkingBytes ?? 512 * 1024 ** 2;
  const headroomBytes = input.headroomBytes ?? 512 * 1024 ** 2;
  return {
    sourceBytes,
    checkpointBytes,
    requiredLocalBytes: checkpointBytes + restoreStagingBytes + dockerWorkingBytes + headroomBytes,
    requiredRemoteBytes: checkpointBytes + Math.ceil(checkpointBytes * 0.05),
  };
};

export const directorySize = async (root: string): Promise<number> => {
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    let total = 0;
    for (const entry of entries) {
      const absolute = path.join(root, entry.name);
      if (entry.isDirectory()) total += await directorySize(absolute);
      else if (entry.isFile()) total += (await fs.promises.stat(absolute)).size;
    }
    return total;
  } catch (error: any) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
};

export const ensureLocalCapacity = async (input: {
  root: string;
  requiredBytes: number;
  artifacts: CheckpointObject[];
  activeDeploymentId: string;
  auditPath: string;
}) => {
  const available = async () => {
    const stats = await fs.promises.statfs(input.root);
    return stats.bavail * stats.bsize;
  };
  let availableBytes = await available();
  const audit: Array<Record<string, unknown>> = [];
  const resolvedRoot = path.resolve(input.root);
  const safelyContained = (candidate: string) => path.resolve(candidate).startsWith(`${resolvedRoot}${path.sep}`);
  if (availableBytes < input.requiredBytes) {
    const reverifiedRemoteIds = new Set<string>();
    for (const artifact of input.artifacts) {
      if (!artifact.remoteVerified || !artifact.remotePath) continue;
      try {
        const [remoteChecksum, remoteSidecar] = await Promise.all([
          sha256File(artifact.remotePath),
          fs.promises.readFile(`${artifact.remotePath}.json`, 'utf8').then((value) => JSON.parse(value)),
        ]);
        if (remoteChecksum === artifact.checksum
          && remoteSidecar.checksum === artifact.checksum
          && (remoteSidecar.deploymentId === artifact.id || remoteSidecar.id === artifact.id)
          && remoteSidecar.remoteVerified === true) {
          reverifiedRemoteIds.add(artifact.id);
        }
      } catch {
        // A stale flag, missing object, checksum mismatch, or unreadable sidecar
        // makes this checkpoint ineligible for automatic local deletion.
      }
    }
    const artifacts: LocalCheckpointArtifact[] = input.artifacts.map((artifact) => ({
      id: artifact.id,
      createdAt: new Date(artifact.createdAt),
      size: artifact.size,
      remoteVerified: reverifiedRemoteIds.has(artifact.id),
      active: artifact.active === true
        || artifact.id === input.activeDeploymentId
        || !safelyContained(artifact.archivePath)
        || !safelyContained(artifact.metadataPath),
      incidentOpen: artifact.incidentOpen === true,
    }));
    const plan = planLocalCheckpointCleanup({
      artifacts,
      bytesNeeded: input.requiredBytes - availableBytes,
      minimumSuccessfulLocal: 2,
    });
    for (const id of plan.deleteIds) {
      const artifact = input.artifacts.find((candidate) => candidate.id === id);
      if (!artifact) continue;
      if (!safelyContained(artifact.archivePath) || !safelyContained(artifact.metadataPath)) {
        throw Object.assign(new Error('Local retention candidate escaped its configured recovery root.'), { code: 'DEPLOYMENT_LOCAL_RETENTION_PATH_UNSAFE' });
      }
      await fs.promises.rm(artifact.archivePath, { force: true });
      await fs.promises.rm(artifact.metadataPath, { force: true });
      audit.push({ id, size: artifact.size, checksum: artifact.checksum, reason: 'REMOTE_VERIFIED_RETENTION_PRUNE', result: 'DELETED' });
    }
    availableBytes = await available();
  }
  await fs.promises.mkdir(path.dirname(input.auditPath), { recursive: true });
  await fs.promises.appendFile(input.auditPath, audit.map((entry) => JSON.stringify({ at: new Date().toISOString(), ...entry })).join('\n') + (audit.length ? '\n' : ''), { encoding: 'utf8', mode: 0o600 });
  if (availableBytes < input.requiredBytes) {
    throw Object.assign(new Error(`Local checkpoint storage needs ${input.requiredBytes} bytes but only ${availableBytes} are available after safe cleanup.`), {
      code: 'DEPLOYMENT_LOCAL_CAPACITY_INSUFFICIENT',
    });
  }
  return { availableBytes, cleanup: audit };
};

const findMetadataFiles = async (root: string): Promise<string[]> => {
  const entries = await fs.promises.readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...await findMetadataFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.sabrec.json')) files.push(absolute);
  }
  return files;
};

export const enforceFilesystemRemoteRetention = async (root: string, activeDeploymentId: string) => {
  const inventory: Array<CheckpointObject & { releaseId: string; remotePath: string }> = [];
  for (const metadataPath of await findMetadataFiles(root)) {
    try {
      const metadata = JSON.parse(await fs.promises.readFile(metadataPath, 'utf8')) as CheckpointObject & { releaseId: string; remotePath: string };
      if (metadata.id && metadata.releaseId && metadata.remotePath && metadata.remoteVerified && Number.isFinite(new Date(metadata.createdAt).getTime())) {
        inventory.push({ ...metadata, metadataPath, archivePath: metadata.remotePath });
      }
    } catch {
      // Unreadable metadata is protected from automatic pruning.
    }
  }
  const plan = planRemoteCheckpointRetention(inventory.map((artifact) => ({
    id: artifact.id,
    releaseId: artifact.releaseId,
    createdAt: new Date(artifact.createdAt),
    size: artifact.size,
    remoteVerified: artifact.remoteVerified,
    active: artifact.id === activeDeploymentId || artifact.active === true,
    incidentOpen: artifact.incidentOpen === true,
  })));
  const audit: Array<Record<string, unknown>> = [];
  const resolvedRoot = path.resolve(root);
  for (const id of plan.deleteIds) {
    const artifact = inventory.find((candidate) => candidate.id === id);
    if (!artifact) continue;
    for (const candidate of [artifact.archivePath, artifact.metadataPath]) {
      if (!path.resolve(candidate).startsWith(`${resolvedRoot}${path.sep}`)) {
        throw Object.assign(new Error('Remote retention candidate escaped its configured root.'), { code: 'DEPLOYMENT_REMOTE_RETENTION_PATH_UNSAFE' });
      }
    }
    await fs.promises.rm(artifact.archivePath, { force: true });
    await fs.promises.rm(artifact.metadataPath, { force: true });
    audit.push({ id, releaseId: artifact.releaseId, checksum: artifact.checksum, size: artifact.size, reason: 'REMOTE_RELEASE_AND_MONTHLY_RETENTION', result: 'DELETED' });
  }
  if (audit.length) {
    await fs.promises.appendFile(path.join(root, 'retention-audit.jsonl'), `${audit.map((entry) => JSON.stringify({ at: new Date().toISOString(), ...entry })).join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  }
  return { plan, audit };
};
