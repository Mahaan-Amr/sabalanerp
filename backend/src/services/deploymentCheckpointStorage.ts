import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sha256File } from './recoveryCrypto';
import { hasHealthyIndependentCheckpointDrill, hasHealthyRemoteRecoveryPoint, planLocalCheckpointCleanup, planRemoteCheckpointRetention, type LocalCheckpointArtifact } from './deploymentCheckpointPolicy';
import { readOnlineCheckpointDirectory, assertOnlineCheckpointDirectoryUnchanged, removeVerifiedOnlineCheckpointDirectory, type OnlineDirectoryEvidence } from './onlineCheckpointDirectory';

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
  restoreVerified?: boolean;
  sourceMachineUuidSha256?: string;
  sourceKernelBootIdSha256?: string;
  releaseId?: string;
  lastDrill?: unknown;
  onlineDirectoryEvidence?: OnlineDirectoryEvidence;
  localVerified?: boolean;
  manifestReadable?: boolean;
  compatibility?: { local?: { compatible?: boolean } };
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

type CheckpointRangeCopier = (sourcePath: string, temporaryPath: string, start: number) => Promise<void>;

type FilesystemRemoteCheckpointStoreOptions = {
  maxTransientUploadRetries?: number;
  retryDelayMs?: number;
  copyRange?: CheckpointRangeCopier;
  readChecksum?: (filePath: string) => Promise<string>;
};

const transientRemoteStorageCodes = new Set(['EIO', 'ESTALE', 'ENOTCONN', 'ECONNRESET', 'ETIMEDOUT']);

const remoteCheckpointChecksum = async (filePath: string): Promise<string> => {
  const hash = createHash('sha256');
  // Larger bounded reads let SSHFS pipeline requests across a high-latency link.
  // Every byte still participates in the independently read-back checksum.
  for await (const chunk of fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 })) {
    hash.update(chunk);
  }
  return hash.digest('hex');
};

const defaultCopyRange: CheckpointRangeCopier = async (sourcePath, temporaryPath, start) => {
  const { pipeline } = await import('node:stream/promises');
  await pipeline(
    fs.createReadStream(sourcePath, { start }),
    fs.createWriteStream(temporaryPath, { flags: start ? 'a' : 'wx', mode: 0o600 }),
  );
};

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
  constructor(
    private readonly root: string,
    private readonly options: FilesystemRemoteCheckpointStoreOptions = {},
  ) {}

  async assertAvailable(requiredBytes: number) {
    await fs.promises.access(this.root, fs.constants.R_OK | fs.constants.W_OK);
    // Incomplete remote objects are custody, not age-based garbage. Only the
    // backup storage owner may retire them after proving the original operation closed.
    const stats = await fs.promises.statfs(this.root);
    const availableBytes = stats.bavail * stats.bsize;
    if (availableBytes < requiredBytes) {
      throw Object.assign(new Error(`Remote checkpoint storage needs ${requiredBytes} bytes but only ${availableBytes} are available.`), {
        code: 'DEPLOYMENT_REMOTE_CAPACITY_INSUFFICIENT',
      });
    }
    return { availableBytes };
  }

  private async readRemoteDirectory(directory: string) {
    for (let retry = 0; ; retry += 1) {
      try {
        return await fs.promises.readdir(directory, { withFileTypes: true });
      } catch (error: any) {
        if (!transientRemoteStorageCodes.has(error?.code) || retry >= 3) throw error;
        // Restart the complete listing after a transient SSHFS failure. An
        // unreadable directory must still abort checkpoint preparation.
        await new Promise(resolve => setTimeout(resolve, Math.min((this.options.retryDelayMs ?? 3_000) * 2 ** retry, 30_000)));
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
    const maxTransientUploadRetries = this.options.maxTransientUploadRetries ?? 20;
    const retryDelayMs = this.options.retryDelayMs ?? 3_000;
    const copyRange = this.options.copyRange ?? defaultCopyRange;
    let transientUploadRetries = 0;
    while (true) {
      try {
        let uploadedBytes = await fs.promises.stat(temporary).then((stat) => stat.size).catch((error: any) => {
          if (error?.code === 'ENOENT') return 0;
          throw error;
        });
        if (uploadedBytes > sourceStat.size) {
          await fs.promises.rm(temporary, { force: true });
          uploadedBytes = 0;
        }
        if (uploadedBytes >= sourceStat.size) break;
        await copyRange(sourcePath, temporary, uploadedBytes);
      } catch (error: any) {
        if (!transientRemoteStorageCodes.has(error?.code) || transientUploadRetries >= maxTransientUploadRetries) throw error;
        transientUploadRetries += 1;
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      }
    }
    const readBackChecksum = async () => {
      for (let retry = 0; ; retry += 1) {
        try {
          return await (this.options.readChecksum ?? remoteCheckpointChecksum)(temporary);
        } catch (error: any) {
          if (!transientRemoteStorageCodes.has(error?.code) || retry >= 3) throw error;
          // Restart the whole hash after a broken handle, including close errors.
          // An interrupted or partially read stream can never prove this archive.
          await new Promise(resolve => setTimeout(resolve, Math.min(retryDelayMs * 2 ** retry, 30_000)));
        }
      }
    };
    const [sourceChecksum, uploadedChecksum, stat] = await Promise.all([
      expectedChecksum ? Promise.resolve(expectedChecksum) : sha256File(sourcePath),
      readBackChecksum(),
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
    const remoteEvidence = new Map<string, string>();
    for (const artifact of input.artifacts) {
      if (!artifact.remoteVerified || !artifact.remotePath) continue;
      try {
        const [remoteChecksum, remoteBytes, remoteStat] = await Promise.all([
          sha256File(artifact.remotePath),
          fs.promises.readFile(`${artifact.remotePath}.json`, 'utf8'),
          fs.promises.stat(artifact.remotePath),
        ]);
        const remoteSidecar = JSON.parse(remoteBytes);
        if (remoteChecksum === artifact.checksum
          && remoteSidecar.checksum === artifact.checksum
          && remoteSidecar.size === artifact.size && remoteStat.size === artifact.size
          && artifact.releaseId && remoteSidecar.releaseId === artifact.releaseId
          && (remoteSidecar.deploymentId === artifact.id || remoteSidecar.id === artifact.id)
          && remoteSidecar.remoteVerified === true && !remoteSidecar.active && !remoteSidecar.incidentOpen
          && hasHealthyIndependentCheckpointDrill(remoteSidecar)) {
          reverifiedRemoteIds.add(artifact.id);
          remoteEvidence.set(`${artifact.remotePath}.json`, remoteBytes);
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
      for (const [file, expected] of remoteEvidence) {
        if (await fs.promises.readFile(file, 'utf8') !== expected) throw new Error('DEPLOYMENT_LOCAL_CAPACITY_RECOVERY_EVIDENCE_CHANGED');
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
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error('DEPLOYMENT_RETENTION_INVENTORY_UNSAFE');
    if (entry.isDirectory()) files.push(...await findMetadataFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.sabrec.json')) files.push(absolute);
  }
  return files;
};

const appendRetentionAudit = async (root: string, entry: Record<string, unknown>) => {
  const handle = await fs.promises.open(path.join(root, 'retention-audit.jsonl'), 'a', 0o600);
  try {
    await handle.writeFile(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
    await handle.sync();
  } finally { await handle.close(); }
};

const hasRetentionEvent = async (root: string, artifact: Pick<CheckpointObject, 'id' | 'checksum'>, event: string) => {
  let bytes: string;
  try { bytes = await fs.promises.readFile(path.join(root, 'retention-audit.jsonl'), 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
  return bytes.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line))
    .some(entry => entry.id === artifact.id && entry.checksum === artifact.checksum && entry.event === event);
};

const checkpointArchivePresent = async (root: string, file: string, artifact: CheckpointObject) => {
  if (!path.resolve(file).startsWith(`${root}${path.sep}`)) throw new Error('DEPLOYMENT_RETENTION_PATH_UNSAFE');
  const parent = await fs.promises.realpath(path.dirname(file));
  if (parent !== root && !parent.startsWith(`${root}${path.sep}`)) throw new Error('DEPLOYMENT_RETENTION_PATH_UNSAFE');
  try {
    const stat = await fs.promises.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('DEPLOYMENT_RETENTION_PATH_UNSAFE');
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
      || !await hasRetentionEvent(root, artifact, 'RETENTION_INTENT')) throw error;
    return false;
  }
};

/** Protective input only: absence/unreadable local evidence never means no holds. */
export const readLocalCheckpointRetentionHolds = async (root: string): Promise<string[]> => {
  const holds = new Set<string>();
  for (const file of await findMetadataFiles(root)) {
    const before = await fs.promises.lstat(file, {bigint:true});
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size > 8n*1024n*1024n) throw new Error('DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_INVALID');
    const raw = await fs.promises.readFile(file), after = await fs.promises.lstat(file,{bigint:true});
    for (const key of ['dev','ino','size','mtimeNs','ctimeNs'] as const) if (before[key]!==after[key]) throw new Error('DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_CHANGED');
    const metadata=JSON.parse(raw.toString());if(typeof metadata.id!=='string'||!/^[a-zA-Z0-9_-]{1,160}$/.test(metadata.id))throw new Error('DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_INVALID');
    if(metadata.active===true||metadata.incidentOpen===true)holds.add(metadata.id);
  }
  return [...holds].sort();
};

export const enforceFilesystemRemoteRetention = async (root: string, activeDeploymentId: string, localRoot?: string,
  options: { mode?: 'apply' | 'inspect'; protectedCheckpointIds?: string[] } = {}) => {
  const localHolds = new Set<string>(options.protectedCheckpointIds ?? []);
  const localEvidence = new Map<string, string>();
  if (localRoot) {
    for (const file of await findMetadataFiles(localRoot)) {
      // Unreadable local evidence could conceal a hold on a remote copy.
      const bytes = await fs.promises.readFile(file, 'utf8');
      localEvidence.set(file, bytes);
      const metadata = JSON.parse(bytes) as CheckpointObject;
      if (!metadata.id) throw new Error('DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_INVALID');
      if (metadata.active || metadata.incidentOpen) localHolds.add(metadata.id);
    }
  }
  const inventory: Array<CheckpointObject & { releaseId: string; remotePath: string }> = [];
  const metadataSnapshots = new Map<string, string>();
  for (const metadataPath of await findMetadataFiles(root)) {
    try {
      const contents = await fs.promises.readFile(metadataPath, 'utf8');
      const metadata = JSON.parse(contents) as CheckpointObject & { releaseId: string; remotePath: string };
      if (metadata.id && metadata.releaseId && metadata.remotePath && metadata.remoteVerified && Number.isFinite(new Date(metadata.createdAt).getTime())) {
        // Sidecars keep the production mount locator; the backup owner uses
        // its own fixed repository root. Never execute an absolute locator.
        const relative = path.relative(root, metadataPath).slice(0, -5);
        if (!metadataPath.endsWith('.sabrec.json') || path.basename(metadata.remotePath) !== path.basename(relative)
          || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('DEPLOYMENT_RETENTION_PATH_UNSAFE');
        const archivePath = path.join(root, relative);
        inventory.push({ ...metadata, metadataPath, remotePath: archivePath, archivePath });
        metadataSnapshots.set(metadataPath, contents);
      }
    } catch {
      // Unreadable metadata is protected from automatic pruning.
    }
  }
  // ONLINE points carry several ciphertexts, immutable image graphs and future
  // WAL dependencies. Never reinterpret a directory as a legacy archive.
  for (const entry of await fs.promises.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || !/^online-[a-f0-9]{64}$/.test(entry.name)) continue;
    try {
      const point = await readOnlineCheckpointDirectory(root, path.join(root, entry.name));
      const metadata = point.metadata as CheckpointObject & { releaseId: string; remotePath: string };
      inventory.push({ ...metadata, remotePath: point.directory, archivePath: point.directory,
        metadataPath: point.metadataPath, onlineDirectoryEvidence: point.evidence });
      metadataSnapshots.set(point.metadataPath, await fs.promises.readFile(point.metadataPath, 'utf8'));
    } catch {
      // Unknown, live-changing, uncertified or damaged material stays protected.
    }
  }
  if (new Set(inventory.map(artifact => artifact.id)).size !== inventory.length) {
    throw new Error('DEPLOYMENT_RETENTION_DUPLICATE_ID');
  }
  const plan = planRemoteCheckpointRetention(inventory.map((artifact) => ({
    id: artifact.id,
    releaseId: artifact.releaseId,
    createdAt: new Date(artifact.createdAt),
    size: artifact.size,
    remoteVerified: artifact.remoteVerified,
    restoreVerified: artifact.restoreVerified === true,
    checksum: artifact.checksum,
    sourceMachineUuidSha256: artifact.sourceMachineUuidSha256,
    sourceKernelBootIdSha256: artifact.sourceKernelBootIdSha256,
    lastDrill: artifact.lastDrill,
    onlineDirectoryEvidence: artifact.onlineDirectoryEvidence,
    active: artifact.id === activeDeploymentId || artifact.active === true,
    incidentOpen: artifact.incidentOpen === true || localHolds.has(artifact.id),
  })));
  const audit: Array<Record<string, unknown>> = [];
  const resolvedRoot = path.resolve(root);
  const realRoot = await fs.promises.realpath(root);
  const verifyContainedFile = async (file: string) => {
    const resolved = await fs.promises.realpath(file);
    const stat = await fs.promises.lstat(file);
    if (!resolved.startsWith(`${realRoot}${path.sep}`) || !stat.isFile() || stat.isSymbolicLink()) {
      throw Object.assign(new Error('Checkpoint retention path is unsafe.'), { code: 'DEPLOYMENT_REMOTE_RETENTION_PATH_UNSAFE' });
    }
    return stat;
  };
  const replacements = inventory.filter(artifact => plan.keepIds.includes(artifact.id)
    && hasHealthyRemoteRecoveryPoint({ ...artifact, createdAt: new Date(artifact.createdAt), active: !!artifact.active, incidentOpen: !!artifact.incidentOpen }) && artifact.remoteVerified)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt)).slice(0, 2);
  const fingerprints = new Map<string, RemoteCheckpointFingerprint>();
  if (plan.deleteIds.length) {
    if (replacements.length !== 2 || new Set(replacements.map(point => point.id)).size !== 2) throw new Error('DEPLOYMENT_RETENTION_REPLACEMENTS_MISSING');
    for (const artifact of replacements) {
      if (artifact.onlineDirectoryEvidence) {
        await assertOnlineCheckpointDirectoryUnchanged(artifact.onlineDirectoryEvidence);
        continue;
      }
      const stat = await verifyContainedFile(artifact.remotePath);
      await verifyContainedFile(artifact.metadataPath);
      if (stat.size !== artifact.size || await remoteCheckpointChecksum(artifact.remotePath) !== artifact.checksum) {
        throw Object.assign(new Error('A retained checkpoint failed verification.'), { code: 'DEPLOYMENT_RETENTION_REPLACEMENT_INVALID' });
      }
      fingerprints.set(artifact.id, { size: stat.size, mtimeMs: stat.mtimeMs });
    }
  }
  for (const id of options.mode === 'inspect' ? [] : plan.deleteIds) {
    if (localRoot) {
      const currentFiles = await findMetadataFiles(localRoot);
      if (currentFiles.length !== localEvidence.size) throw new Error('DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_CHANGED');
      for (const file of currentFiles) {
        if (await fs.promises.readFile(file, 'utf8') !== localEvidence.get(file)) {
          throw new Error('DEPLOYMENT_RETENTION_LOCAL_EVIDENCE_CHANGED');
        }
      }
    }
    const artifact = inventory.find((candidate) => candidate.id === id);
    if (!artifact) continue;
    const archivePresent = artifact.onlineDirectoryEvidence ? true : await checkpointArchivePresent(realRoot, artifact.archivePath, artifact);
    for (const candidate of [artifact.metadataPath]) {
      if (!path.resolve(candidate).startsWith(`${resolvedRoot}${path.sep}`)) {
        throw Object.assign(new Error('Remote retention candidate escaped its configured root.'), { code: 'DEPLOYMENT_REMOTE_RETENTION_PATH_UNSAFE' });
      }
      await verifyContainedFile(candidate);
    }
    const current = JSON.parse(await fs.promises.readFile(artifact.metadataPath, 'utf8'));
    if (current.active || current.incidentOpen || current.id !== artifact.id || current.checksum !== artifact.checksum) {
      throw new Error('DEPLOYMENT_RETENTION_EVIDENCE_CHANGED');
    }
    for (const replacement of replacements) {
      if (await fs.promises.readFile(replacement.metadataPath, 'utf8') !== metadataSnapshots.get(replacement.metadataPath)) {
        throw new Error('DEPLOYMENT_RETENTION_REPLACEMENT_EVIDENCE_CHANGED');
      }
      if (replacement.onlineDirectoryEvidence) await assertOnlineCheckpointDirectoryUnchanged(replacement.onlineDirectoryEvidence);
      else await assertRemoteCheckpointFingerprint(replacement.remotePath, fingerprints.get(replacement.id));
    }
    await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: 'RETENTION_INTENT' });
    if (artifact.onlineDirectoryEvidence) {
      await removeVerifiedOnlineCheckpointDirectory(artifact.onlineDirectoryEvidence);
      await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: 'RETENTION_ARCHIVE_REMOVED' });
      await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: 'RETENTION_COMPLETED' });
      audit.push({ id, releaseId: artifact.releaseId, checksum: artifact.checksum, size: artifact.size,
        reason: 'TWO_VERIFIED_COMPLETE_RECOVERY_POINTS', result: 'DELETED' });
      continue;
    }
    if (archivePresent) await fs.promises.unlink(artifact.archivePath);
    // Persist retirement before removing the sidecar that links this remote point
    // to its local copy. A crash after sidecar removal must remain recoverable.
    await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: 'RETENTION_ARCHIVE_REMOVED' });
    await fs.promises.unlink(artifact.metadataPath);
    await appendRetentionAudit(root, { id, checksum: artifact.checksum, event: 'RETENTION_COMPLETED' });
    audit.push({ id, releaseId: artifact.releaseId, checksum: artifact.checksum, size: artifact.size, reason: 'TWO_VERIFIED_COMPLETE_RECOVERY_POINTS', result: 'DELETED' });
  }
  const retainedPoints = replacements.map(artifact => ({
    id: artifact.id, checksum: artifact.checksum, size: artifact.size, createdAt: artifact.createdAt,
    remotePath: artifact.remotePath, fingerprint: fingerprints.get(artifact.id),
    metadataPath: artifact.metadataPath,
    metadataSha256: createHash('sha256').update(metadataSnapshots.get(artifact.metadataPath)!).digest('hex'),
    onlineDirectoryEvidence: artifact.onlineDirectoryEvidence,
  }));
  return {
    plan, audit, retainedPoints,
    protectionEvidence: inventory.map(artifact => ({
      id: artifact.id, metadataPath: artifact.metadataPath,
    })),
  };
};

export const enforceLocalCheckpointRetention = async (
  root: string, remoteRoot: string, activeDeploymentId: string,
  remoteRetention: Awaited<ReturnType<typeof enforceFilesystemRemoteRetention>>,
) => {
  const points = remoteRetention.retainedPoints;
  if (points.length !== 2 || new Set(points.map(point => point.id)).size !== 2) return { deletedIds: [] };
  const localRoot = await fs.promises.realpath(root);
  const independentRoot = await fs.promises.realpath(remoteRoot);
  const cutoff = Math.min(...points.map(point => Date.parse(point.createdAt)));
  const candidates: CheckpointObject[] = [];
  for (const file of await findMetadataFiles(root)) {
    try {
      const value = JSON.parse(await fs.promises.readFile(file, 'utf8')) as CheckpointObject;
      if (value.id && value.id !== activeDeploymentId && !value.active && !value.incidentOpen
        && !remoteRetention.plan.keepIds.includes(value.id)
        && value.remoteVerified && value.releaseId && hasHealthyIndependentCheckpointDrill({ ...value, releaseId: value.releaseId })
        && Date.parse(value.createdAt) < cutoff && !points.some(point => point.id === value.id)) {
        candidates.push({ ...value, metadataPath: file });
      }
    } catch { /* Unreadable evidence is protected. */ }
  }
  if (!candidates.length) return { deletedIds: [] };
  for (const point of points) {
    const metadataFile = await fs.promises.realpath(point.metadataPath);
    if (!metadataFile.startsWith(`${independentRoot}${path.sep}`)
      || createHash('sha256').update(await fs.promises.readFile(point.metadataPath)).digest('hex') !== point.metadataSha256) {
      throw new Error('DEPLOYMENT_LOCAL_RETENTION_REPLACEMENT_EVIDENCE_CHANGED');
    }
    if (point.onlineDirectoryEvidence) {
      await assertOnlineCheckpointDirectoryUnchanged(point.onlineDirectoryEvidence);
      continue;
    }
    const remoteFile = await fs.promises.realpath(point.remotePath);
    const stat = await fs.promises.lstat(point.remotePath);
    if (!remoteFile.startsWith(`${independentRoot}${path.sep}`) || !stat.isFile() || stat.isSymbolicLink() || stat.size !== point.size) {
      throw new Error('DEPLOYMENT_LOCAL_RETENTION_REPLACEMENT_INVALID');
    }
    if (point.fingerprint) await assertRemoteCheckpointFingerprint(point.remotePath, point.fingerprint);
    else {
      if (await remoteCheckpointChecksum(point.remotePath) !== point.checksum) throw new Error('DEPLOYMENT_LOCAL_RETENTION_REPLACEMENT_INVALID');
      point.fingerprint = { size: stat.size, mtimeMs: stat.mtimeMs };
    }
  }
  const deletedIds: string[] = [];
  for (const artifact of candidates) {
    const archivePresent = await checkpointArchivePresent(localRoot, artifact.archivePath, artifact);
    for (const file of [artifact.metadataPath]) {
      const realFile = await fs.promises.realpath(file);
      const stat = await fs.promises.lstat(file);
      if (!realFile.startsWith(`${localRoot}${path.sep}`) || !stat.isFile() || stat.isSymbolicLink()) {
        throw new Error('DEPLOYMENT_LOCAL_RETENTION_PATH_UNSAFE');
      }
    }
    const current = JSON.parse(await fs.promises.readFile(artifact.metadataPath, 'utf8'));
    if (current.active || current.incidentOpen || current.id !== artifact.id || current.checksum !== artifact.checksum) {
      throw new Error('DEPLOYMENT_LOCAL_RETENTION_EVIDENCE_CHANGED');
    }
    const remoteEvidence = remoteRetention.protectionEvidence.find(point => point.id === artifact.id)
      || (artifact.remotePath && await hasRetentionEvent(independentRoot, artifact, 'RETENTION_ARCHIVE_REMOVED')
        ? { id: artifact.id, metadataPath: `${artifact.remotePath}.json` } : undefined);
    if (!remoteEvidence) throw new Error('DEPLOYMENT_LOCAL_RETENTION_REMOTE_EVIDENCE_MISSING');
    try {
      const remotePath = await fs.promises.realpath(remoteEvidence.metadataPath);
      if (!remotePath.startsWith(`${independentRoot}${path.sep}`)
        || (await fs.promises.lstat(remoteEvidence.metadataPath)).isSymbolicLink()) {
        throw new Error('DEPLOYMENT_LOCAL_RETENTION_REMOTE_EVIDENCE_UNSAFE');
      }
      const remote = JSON.parse(await fs.promises.readFile(remoteEvidence.metadataPath, 'utf8'));
      if (remote.id !== artifact.id || remote.checksum !== artifact.checksum) {
        throw new Error('DEPLOYMENT_LOCAL_RETENTION_REMOTE_EVIDENCE_CHANGED');
      }
      if (remote.active || remote.incidentOpen) continue;
    } catch (error) {
      // Absence is expected only for an archive actually pruned by this operation.
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT'
        || (!remoteRetention.audit.some(entry => entry.id === artifact.id && entry.result === 'DELETED')
          && !await hasRetentionEvent(independentRoot, artifact, 'RETENTION_ARCHIVE_REMOVED'))) throw error;
    }
    for (const point of points) {
      if (createHash('sha256').update(await fs.promises.readFile(point.metadataPath)).digest('hex') !== point.metadataSha256) {
        throw new Error('DEPLOYMENT_LOCAL_RETENTION_REPLACEMENT_EVIDENCE_CHANGED');
      }
      if (point.onlineDirectoryEvidence) await assertOnlineCheckpointDirectoryUnchanged(point.onlineDirectoryEvidence);
      else await assertRemoteCheckpointFingerprint(point.remotePath, point.fingerprint);
    }
    await appendRetentionAudit(root, { id: artifact.id, checksum: artifact.checksum, event: 'RETENTION_INTENT' });
    if (archivePresent) await fs.promises.unlink(artifact.archivePath);
    await fs.promises.unlink(artifact.metadataPath);
    await appendRetentionAudit(root, { id: artifact.id, checksum: artifact.checksum, event: 'RETENTION_COMPLETED' });
    deletedIds.push(artifact.id);
  }
  return { deletedIds };
};
