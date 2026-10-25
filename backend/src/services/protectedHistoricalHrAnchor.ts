import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyOnlineRecoveryCertificate } from './onlineCheckpointDirectory';
import { hasHealthyIndependentCheckpointDrill } from './deploymentCheckpointPolicy';
import { ONLINE_QUALIFICATION_PUBLIC_KEY } from './onlineQualificationProvenance';

const domain = 'sabalan-historical-hr-restore/v1';
const sha = (raw: Buffer) => createHash('sha256').update(raw).digest('hex');
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const same = (a: unknown, b: unknown) => JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v: any, keys: string[]) => v && !Array.isArray(v) && same(Object.keys(v).sort(), [...keys].sort());
function need(v: unknown): asserts v { if (!v) throw Error('PROTECTED_HR_AUTHENTICATED_RESTORE_REQUIRED'); }
const db = (v: any) => exact(v, ['name', 'oid', 'systemIdentifier'])
  && [v.name, v.oid, v.systemIdentifier].every(value => typeof value === 'string') && /^[A-Za-z0-9_]{1,63}$/.test(v.name)
  && /^[1-9][0-9]*$/.test(v.oid) && /^[1-9][0-9]*$/.test(v.systemIdentifier);
const hrName = '20261014120000_hr_vehicle_assignment_plans';
const hrChecksum = 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289';
export type HistoricalHrRestoreArtifacts = {
  checkpointRaw: Buffer; historyRaw: Buffer; hrRowRaw: Buffer; businessRaw: Buffer; originalRaw: Buffer;
};
function immutable<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) immutable(child); Object.freeze(value); }
  return value;
}

/** Data-only verifier. A caller key never confers live inspection custody.
 * A signer must own the genuine independent COMPLETE restore and its original
 * channels; there is intentionally no certificate issuer in this module.
 */
export function verifyHistoricalHrRestoreAnchor(certificate: Buffer, publicKey: Buffer,
  artifacts: HistoricalHrRestoreArtifacts, acceptedAt: string) {
  for (const [name, raw] of Object.entries(artifacts)) need(Buffer.isBuffer(raw) && raw.length > 0
    && raw.length <= (name === 'checkpointRaw' ? 16 * 1024 * 1024 : 2 * 1024 * 1024));
  const envelope = JSON.parse(certificate.toString('utf8'));
  need(exact(envelope, ['format', 'decision', 'signature']));
  const v = verifyOnlineRecoveryCertificate(certificate, publicKey, domain, 'sabalan-signed-historical-hr-restore/v1', acceptedAt);
  need(exact(v, ['format', 'purpose', 'nativeExecutionClaimed', 'deploymentId', 'releaseId', 'intendedOwner', 'checkpointChecksum',
    'checkpointMetadataSha256', 'databaseDumpSha256', 'sourceDatabase', 'restoredDatabase', 'nativeHistorySha256',
    'nativeHistoryRows', 'nativeAppliedRows', 'hrRowSha256', 'restoreOriginalSha256', 'businessEvidenceSha256', 'issuedAt', 'expiresAt'])
    && v.purpose === 'VERIFIED_HISTORICAL_INSPECTION' && v.nativeExecutionClaimed === false
    && [v.deploymentId, v.releaseId].every((s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(s))
    && exact(v.intendedOwner, ['deploymentId', 'releaseId'])
    && [v.intendedOwner.deploymentId, v.intendedOwner.releaseId].every((s: unknown) => typeof s === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(s))
    && [v.checkpointChecksum, v.checkpointMetadataSha256, v.databaseDumpSha256, v.nativeHistorySha256,
      v.hrRowSha256, v.restoreOriginalSha256, v.businessEvidenceSha256].every(hex)
    && db(v.sourceDatabase) && db(v.restoredDatabase) && !same(v.sourceDatabase, v.restoredDatabase)
    && v.nativeAppliedRows === 439 && Number.isSafeInteger(v.nativeHistoryRows) && v.nativeHistoryRows >= 439 && v.nativeHistoryRows <= 1024);
  const hashes = { checkpointRaw: v.checkpointMetadataSha256, historyRaw: v.nativeHistorySha256,
    hrRowRaw: v.hrRowSha256, businessRaw: v.businessEvidenceSha256, originalRaw: v.restoreOriginalSha256 };
  for (const name of Object.keys(hashes) as Array<keyof HistoricalHrRestoreArtifacts>) need(sha(artifacts[name]) === hashes[name]);
  const checkpoint = JSON.parse(artifacts.checkpointRaw.toString()), history = JSON.parse(artifacts.historyRaw.toString()),
    hr = JSON.parse(artifacts.hrRowRaw.toString()), business = JSON.parse(artifacts.businessRaw.toString()), original = JSON.parse(artifacts.originalRaw.toString());
  need(checkpoint.id === v.deploymentId && checkpoint.deploymentId === v.deploymentId && checkpoint.releaseId === v.releaseId
    && checkpoint.checksum === v.checkpointChecksum && same(checkpoint.sourceDatabase, v.sourceDatabase)
    && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.manifestReadable === true
    && checkpoint.manifest?.format === 'sabalan-recovery' && checkpoint.manifest.packageType === 'COMPLETE'
    && Array.isArray(checkpoint.manifest.components) && checkpoint.manifest.components.length <= 250000);
  const paths = new Set<string>();
  for (const row of checkpoint.manifest.components) {
    need(typeof row.path === 'string' && !row.path.startsWith('/') && !/[\\\0]/.test(row.path)
      && row.path.split('/').every((part: string) => part && part !== '.' && part !== '..') && !paths.has(row.path)
      && hex(row.sha256) && Number.isSafeInteger(row.size) && row.size >= 0); paths.add(row.path);
  }
  const dump = checkpoint.manifest.components.filter((row: any) => row.path === 'database/main.dump');
  need(dump.length === 1 && dump[0].size > 0 && dump[0].sha256 === v.databaseDumpSha256
    && business.ok === true && same(business.restoredDatabase, v.restoredDatabase)
    && hasHealthyIndependentCheckpointDrill({ ...checkpoint, lastDrill: business.drill })
    && Date.parse(business.drill.completedAt) <= Date.parse(v.issuedAt));
  need(Number.isSafeInteger(original.pid) && original.pid > 0 && original.code === 0 && original.pipesClosed === true
    && original.naturalClosureObserved === true && original.interrupted === false && original.observationFault === null
    && hex(original.sourceSha256) && original.stdoutRawBase64 === artifacts.businessRaw.toString('base64')
    && original.stdoutSha256 === v.businessEvidenceSha256 && original.stderrRawBase64 === '' && original.stderrSha256 === sha(Buffer.alloc(0)));
  need(Array.isArray(history) && history.length === v.nativeHistoryRows);
  const applied = history.filter((row: any) => row.rolled_back_at === null), names = new Set<string>();
  need(applied.length === v.nativeAppliedRows);
  for (const row of applied) {
    need(typeof row.id === 'string' && row.id.length > 0 && typeof row.migration_name === 'string'
      && /^\d{14}_[A-Za-z0-9_]+$/.test(row.migration_name) && !names.has(row.migration_name) && hex(row.checksum)
      && typeof row.finished_at === 'string' && Number.isFinite(Date.parse(row.finished_at))
      && typeof row.started_at === 'string' && Number.isFinite(Date.parse(row.started_at))
      && Number.isInteger(row.applied_steps_count) && row.applied_steps_count > 0); names.add(row.migration_name);
  }
  need(hr.migration_name === hrName && hr.checksum === hrChecksum && hr.logs === null && hr.rolled_back_at === null
    && applied.filter((row: any) => row.migration_name === hrName).length === 1
    && same(applied.find((row: any) => row.migration_name === hrName), hr));
  return immutable({ decision: v, checkpoint, history, hr, restoreOriginalSha256: v.restoreOriginalSha256 });
}

const pin = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.mode, s.nlink].map(String).join(':');
function read(file: string, maximum: number, mode: number) {
  need(fs.realpathSync(file) === file);
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    need(before.isFile() && before.uid === 0n && before.nlink === 1n && (before.mode & 0o777n) === BigInt(mode)
      && before.size > 0n && before.size <= BigInt(maximum));
    const raw = fs.readFileSync(fd);
    need(pin(before) === pin(fs.fstatSync(fd, { bigint: true })) && pin(before) === pin(fs.lstatSync(file, { bigint: true })));
    return { raw, pin: pin(before), sha256: sha(raw) };
  } finally { fs.closeSync(fd); }
}
declare const anchorBrand: unique symbol;
export type HistoricalHrRestoreAnchor = Readonly<{ [anchorBrand]: true }>;
type Snapshot = { accepted: ReturnType<typeof verifyHistoricalHrRestoreAnchor>; files: Map<string, ReturnType<typeof read>> };
const anchors = new WeakMap<HistoricalHrRestoreAnchor, Snapshot>();

/** Fixed-key, private operation-specific custody. Missing proof refuses the
 * inspection; metadata.restoreVerified alone is never independent evidence.
 */
export function openHistoricalHrRestoreAnchor(owner: { deploymentId: string; releaseId: string }): HistoricalHrRestoreAnchor {
  need(process.platform === 'linux' && process.getuid?.() === 0 && /^[A-Za-z0-9_-]{8,128}$/.test(owner.deploymentId));
  const directory = process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination', stat = fs.lstatSync(directory, { bigint: true });
  need(path.isAbsolute(directory) && fs.realpathSync(directory) === directory && stat.isDirectory() && stat.uid === 0n && (stat.mode & 0o022n) === 0n);
  const files = new Map<string, ReturnType<typeof read>>();
  const take = (suffix: string, maximum = 2 * 1024 * 1024) => {
    const file = path.join(directory, `${owner.deploymentId}-historical-hr-${suffix}.json`), value = read(file, maximum, 0o400);
    files.set(file, value); return value.raw;
  };
  const key = read(ONLINE_QUALIFICATION_PUBLIC_KEY, 4096, 0o444); files.set(ONLINE_QUALIFICATION_PUBLIC_KEY, key);
  const certificate = take('anchor'), accepted = verifyHistoricalHrRestoreAnchor(certificate, key.raw, {
    checkpointRaw: take('checkpoint', 16 * 1024 * 1024), historyRaw: take('history'), hrRowRaw: take('row'),
    businessRaw: take('business'), originalRaw: take('original'),
  }, new Date().toISOString());
  // The signed source checkpoint A belongs to its original capture operation.
  // Intended owner B is a separate planned operation; its as-yet-uncaptured
  // checkpoint is never predicted, relabelled or independently qualified here.
  need(accepted.decision.intendedOwner.deploymentId === owner.deploymentId && accepted.decision.intendedOwner.releaseId === owner.releaseId);
  const capability = Object.freeze({}) as HistoricalHrRestoreAnchor; anchors.set(capability, { accepted, files });
  return capability;
}

/** Initial acceptance's 600s signature window is not restarted during an
 * already-owned operation. Subsequent calls recheck exact file custody; the
 * transaction separately rechecks current owner/lease/checkpoint/database.
 */
export function assertHistoricalHrRestoreAnchor(anchor: HistoricalHrRestoreAnchor, owner: { deploymentId: string; releaseId: string }) {
  const state = anchors.get(anchor); need(state && state.accepted.decision.intendedOwner.deploymentId === owner.deploymentId
    && state.accepted.decision.intendedOwner.releaseId === owner.releaseId);
  for (const [file, previous] of state.files) {
    const current = read(file, file === ONLINE_QUALIFICATION_PUBLIC_KEY ? 4096 : 16 * 1024 * 1024,
      file === ONLINE_QUALIFICATION_PUBLIC_KEY ? 0o444 : 0o400);
    need(current.pin === previous.pin && current.sha256 === previous.sha256);
  }
  return state.accepted;
}

/** Data-only description of the CURRENT checkpoint B, obtained by the
 * inspector from its protected lease row. It grants no authority by itself
 * and does not claim B was the independently drilled historical point A.
 */
export function verifyCurrentHistoricalHrCheckpoint(checkpoint: any,
  owner: { deploymentId: string; releaseId: string }, sourceDatabase: unknown) {
  need(checkpoint && checkpoint.id === owner.deploymentId && checkpoint.deploymentId === owner.deploymentId
    && checkpoint.releaseId === owner.releaseId && hex(checkpoint.checksum) && db(sourceDatabase)
    && same(checkpoint.sourceDatabase, sourceDatabase) && checkpoint.localVerified === true
    && checkpoint.remoteVerified === true && checkpoint.restoreVerified === true && checkpoint.manifestReadable === true);
  const manifest = checkpoint.manifest;
  need(manifest?.format === 'sabalan-recovery' && manifest.packageType === 'COMPLETE'
    && Array.isArray(manifest.components) && manifest.components.length <= 250000);
  const paths = new Set<string>();
  for (const row of manifest.components) {
    need(typeof row.path === 'string' && !row.path.startsWith('/') && !/[\\\0]/.test(row.path)
      && row.path.split('/').every((part: string) => part && part !== '.' && part !== '..') && !paths.has(row.path)
      && hex(row.sha256) && Number.isSafeInteger(row.size) && row.size >= 0); paths.add(row.path);
  }
  const dump = manifest.components.filter((row: any) => row.path === 'database/main.dump');
  need(dump.length === 1 && dump[0].size > 0);
  return Object.freeze({ deploymentId: owner.deploymentId, releaseId: owner.releaseId, checksum: checkpoint.checksum as string,
    metadataSha256: sha(Buffer.from(JSON.stringify(canonical(checkpoint)))),
    manifestSha256: sha(Buffer.from(JSON.stringify(canonical(manifest)))), databaseDumpSha256: dump[0].sha256 as string,
    independentRestoreClaimed: false as const });
}
