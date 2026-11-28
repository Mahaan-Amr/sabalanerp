import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import { completeRollbackDeploymentGateReport } from './deploymentGates';

export const firstRoleCutoverPurpose = 'first-database-role-cutover';
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const catalogLimit = 4 * 1024 * 1024;
const receiptLimit = 12 * 1024 * 1024;
const deploymentIdPattern = /^[A-Za-z0-9_-]{1,160}$/;
const unavailable = () => { throw new Error('First-role cutover evidence is missing or changed.'); };

export type FirstRoleCutoverBinding = {
  beforeSha256: string;
  stagedSha256: string;
  migrationSha256: string;
  beforeEnvironmentSha256: string;
  afterEnvironmentSha256: string;
};
type Catalogs = { beforeBytes: Buffer; stagedBytes: Buffer };

export function validateFirstRoleCutoverBinding(input: unknown): FirstRoleCutoverBinding {
  const value = input as FirstRoleCutoverBinding | null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'afterEnvironmentSha256,beforeEnvironmentSha256,beforeSha256,migrationSha256,stagedSha256'
    || value.beforeEnvironmentSha256 === value.afterEnvironmentSha256
    || !Object.values(value).every(hash => typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash))) {
    return unavailable();
  }
  return { beforeSha256: value.beforeSha256, stagedSha256: value.stagedSha256, migrationSha256: value.migrationSha256,
    beforeEnvironmentSha256: value.beforeEnvironmentSha256, afterEnvironmentSha256: value.afterEnvironmentSha256 };
}

async function readPrivateFile(file: string, limit: number) {
  const uid = process.getuid?.();
  if (uid === undefined || !path.isAbsolute(file) || await fs.realpath(file) !== file) return unavailable();
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.uid !== BigInt(uid) || before.nlink !== 1n
      || (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > BigInt(limit)) return unavailable();
    const bytes = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const named = await fs.lstat(file, { bigint: true });
    for (const key of ['dev', 'ino', 'mode', 'uid', 'nlink', 'size', 'mtimeNs', 'ctimeNs'] as const) {
      if (before[key] !== after[key] || before[key] !== named[key]) return unavailable();
    }
    if (BigInt(bytes.length) !== before.size) return unavailable();
    return bytes;
  } finally { await handle.close(); }
}

export function readFirstRoleCutoverCredential(file: string) {
  return readPrivateFile(file, 43);
}

export async function readFirstRoleRollbackGateProof(input: {
  coordinationDir: string; deploymentId: string; releaseId: string; targetCommit: string;
  checkpointSha256: string; restoreRecordedAt: string;
}) {
  const bytes = await readPrivateFile(path.join(input.coordinationDir, 'deployment-report.json'), catalogLimit);
  const report = JSON.parse(bytes.toString('utf8'));
  if (!completeRollbackDeploymentGateReport(report)
    || report.deploymentId !== input.deploymentId || report.releaseId !== input.releaseId
    || report.targetCommit !== input.targetCommit || !Number.isFinite(Date.parse(report.createdAt))
    || !Number.isFinite(Date.parse(input.restoreRecordedAt))
    || Date.parse(report.createdAt) < Date.parse(input.restoreRecordedAt)
    || Date.parse(report.createdAt) > Date.now()) return unavailable();
  const readiness = report.gates.find((gate: { name: string }) => gate.name === 'backend-readiness').details;
  const checkpoint = report.gates.find((gate: { name: string }) => gate.name === 'checkpoint-manifest').details;
  if (readiness?.firstRoleRuntime !== 'restored' || readiness?.authenticatedRuntimeSessions !== true
    || typeof readiness?.firstRoleRuntimeAddress !== 'string' || !isIP(readiness.firstRoleRuntimeAddress)
    || checkpoint?.checksum !== input.checkpointSha256 || checkpoint?.releaseId !== input.releaseId
    || checkpoint?.remoteReadBack !== true) return unavailable();
  return { reportSha256: digest(bytes), runtimeAddress: readiness.firstRoleRuntimeAddress as string };
}

export const firstRoleOpenIntentName = 'first-role-cutover-open-intent.json';

const firstRoleArchivedIntentName = (deploymentId: string) => {
  if (!deploymentIdPattern.test(deploymentId)) return unavailable();
  return `first-role-cutover-open-intent-${deploymentId}.json`;
};

export async function retainFirstRoleOpenIntent(reportDir: string, intent: Record<string, string>, requireExisting: boolean,
  allowArchived = false) {
  const file = path.join(reportDir, firstRoleOpenIntentName);
  const bytes = Buffer.from(`${JSON.stringify(intent)}\n`);
  try {
    if (!(await readPrivateFile(file, 16_384)).equals(bytes)) return unavailable();
    return file;
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
    if (allowArchived) {
      const archived = path.join(reportDir, firstRoleArchivedIntentName(intent.deploymentId));
      if (!(await readPrivateFile(archived, 16_384)).equals(bytes)) return unavailable();
      return archived;
    }
    if (requireExisting) throw error;
  }
  if (await fs.realpath(reportDir) !== reportDir) return unavailable();
  const temp = path.join(reportDir, `.first-role-cutover-intent-${randomUUID()}`);
  try {
    const handle = await fs.open(temp, 'wx', 0o400);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temp, file);
    const directory = await fs.open(reportDir, 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await fs.rm(temp, { force: true }); }
  return file;
}

export async function archiveFirstRoleOpenIntent(file: string, deploymentId: string) {
  const reportDir = path.dirname(file);
  const archived = path.join(reportDir, firstRoleArchivedIntentName(deploymentId));
  if (file === archived) return;
  if (path.basename(file) !== firstRoleOpenIntentName) return unavailable();
  try {
    await fs.lstat(archived);
    return unavailable();
  } catch (error: any) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.rename(file, archived);
  const directory = await fs.open(reportDir, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export async function readFirstRoleRollbackPublicProof(input: {
  reportDir: string; intentFile: string; deploymentId: string; releaseId: string; targetCommit: string;
  openedAfter: string; expectedHosts: [string, string]; allowStale?: boolean;
}) {
  if (!deploymentIdPattern.test(input.deploymentId) || input.expectedHosts[0] === input.expectedHosts[1]
    || input.expectedHosts.some(host => !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(host))) return unavailable();
  const bytes = await readPrivateFile(path.join(input.reportDir, `first-role-rollback-public-${input.deploymentId}.json`), 16_384);
  const proof = JSON.parse(bytes.toString('utf8'));
  const observedAt = Date.parse(proof?.observedAt);
  const openedAfter = Date.parse(input.openedAfter);
  const age = Date.now() - observedAt;
  if (proof?.format !== 'sabalan-first-role-rollback-public/v1' || proof.deploymentId !== input.deploymentId
    || proof.releaseId !== input.releaseId || proof.targetCommit !== input.targetCommit
    || proof.intentSha256 !== digest(await readPrivateFile(input.intentFile, 16_384))
    || !Number.isFinite(observedAt) || !Number.isFinite(openedAfter) || observedAt < openedAfter || age < 0
    || (!input.allowStale && age > 60_000) || !Array.isArray(proof.origins) || proof.origins.length !== 2
    || input.expectedHosts.some((host, index) => proof.origins[index]?.origin !== `https://${host}`
      || proof.origins[index].httpStatus !== 200 || proof.origins[index].tlsVerified !== true)) return unavailable();
  return digest(bytes);
}

function requireCatalogDigests(catalogs: Catalogs, binding: FirstRoleCutoverBinding) {
  if (catalogs.beforeBytes.length > catalogLimit || catalogs.stagedBytes.length > catalogLimit
    || digest(catalogs.beforeBytes) !== binding.beforeSha256 || digest(catalogs.stagedBytes) !== binding.stagedSha256) {
    return unavailable();
  }
  return catalogs;
}

const recordFile = (directory: string, deploymentId: string) => {
  if (!path.isAbsolute(directory) || !deploymentIdPattern.test(deploymentId)) return unavailable();
  return path.join(directory, `first-role-cutover-${deploymentId}.json`);
};

export async function hasRetainedFirstRoleCutoverEvidence(input: {
  reportDir: string; coordinationDir: string; deploymentId: string;
}) {
  if (!deploymentIdPattern.test(input.deploymentId)) return false;
  for (const directory of [input.reportDir, input.coordinationDir]) {
    try {
      await fs.lstat(recordFile(directory, input.deploymentId));
      return true;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  return false;
}

/** Save the original reviewed bytes independently in the host report and checkpointed coordination paths. */
export async function retainFirstRoleCutoverEvidence(input: {
  sourceDir: string; reportDir: string; coordinationDir: string; deploymentId: string; binding: FirstRoleCutoverBinding;
}) {
  const directories = [input.reportDir, input.coordinationDir];
  for (const directory of directories) {
    recordFile(directory, input.deploymentId);
    await fs.mkdir(directory, { recursive: true });
    if (await fs.realpath(directory) !== directory) return unavailable();
  }
  const [reports, coordination] = await Promise.all(directories.map(directory => fs.stat(directory)));
  if (reports.dev === coordination.dev && reports.ino === coordination.ino) return unavailable();
  const catalogs = requireCatalogDigests({
    beforeBytes: await readPrivateFile(path.join(input.sourceDir, 'legacy-catalog.json'), catalogLimit),
    stagedBytes: await readPrivateFile(path.join(input.sourceDir, 'staged-catalog.json'), catalogLimit),
  }, input.binding);
  const record = Buffer.from(JSON.stringify({
    binding: input.binding,
    before: catalogs.beforeBytes.toString('base64'),
    staged: catalogs.stagedBytes.toString('base64'),
  }));
  for (const directory of directories) {
    const file = recordFile(directory, input.deploymentId);
    try {
      const handle = await fs.open(file, 'wx', 0o400);
      try { await handle.writeFile(record); await handle.sync(); } finally { await handle.close(); }
    } catch (error: any) {
      if (error?.code !== 'EEXIST' || !(await readPrivateFile(file, receiptLimit)).equals(record)) throw error;
    }
    const parent = await fs.open(directory, 'r');
    try { await parent.sync(); } finally { await parent.close(); }
  }
}

export async function readRetainedFirstRoleCutoverEvidence(input: {
  reportDir: string; coordinationDir: string; deploymentId: string; binding: FirstRoleCutoverBinding;
}) {
  const report = await readPrivateFile(recordFile(input.reportDir, input.deploymentId), receiptLimit);
  const coordination = await readPrivateFile(recordFile(input.coordinationDir, input.deploymentId), receiptLimit);
  if (!report.equals(coordination)) return unavailable();
  const record = JSON.parse(report.toString('utf8'));
  if (JSON.stringify(validateFirstRoleCutoverBinding(record.binding)) !== JSON.stringify(input.binding)
    || typeof record.before !== 'string' || typeof record.staged !== 'string') return unavailable();
  return requireCatalogDigests({
    beforeBytes: Buffer.from(record.before, 'base64'), stagedBytes: Buffer.from(record.staged, 'base64'),
  }, input.binding);
}
