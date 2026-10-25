import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { verifyOnlineRecoveryCertificate } from './onlineCheckpointDirectory';
import { ONLINE_QUALIFICATION_PUBLIC_KEY } from './onlineQualificationProvenance';
import { assertActiveStrictRestoreProof } from './systemRecoveryEngine';

const domain = 'sabalan-restored-qa-historical-hr/v1';
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const encode = (v: unknown) => Buffer.from(JSON.stringify(canonical(v)));
const sha = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const equal = (a: unknown, b: unknown) => encode(a).equals(encode(b));
const hex = (v: unknown) => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const exact = (v: any, keys: string[]) => v && !Array.isArray(v) && equal(Object.keys(v).sort(), [...keys].sort());
function need(v: unknown): asserts v { if (!v) throw Error('RESTORED_QA_HISTORICAL_SCOPE_UNPROVEN'); }
const database = (v: any) => exact(v, ['name', 'oid', 'systemIdentifier'])
  && [v.name, v.oid, v.systemIdentifier].every(s => typeof s === 'string')
  && /^[A-Za-z0-9_]{1,63}$/.test(v.name) && /^[1-9][0-9]*$/.test(v.oid) && /^[1-9][0-9]*$/.test(v.systemIdentifier);
const owner = (v: any) => exact(v, ['deploymentId', 'releaseId'])
  && [v.deploymentId, v.releaseId].every(s => typeof s === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(s));
const pending = ['20261014140000_online_deployment_control', '20261019010000_customer_semantic_barrier',
  '20261019020000_hr_versioned_file_cleanup', '20261020010000_online_realtime_completion', '20261020093000_online_serving_epochs'];
function freeze<T>(v: T): T { if (v && typeof v === 'object') { for (const child of Object.values(v)) freeze(child); Object.freeze(v); } return v; }

/** Pure partial-restore data verifier. This cannot create a live callback
 * token or a production/healthy-independent recovery decision. In particular,
 * completed pg_restore is not completion of the still-live outer owner.
 */
export function verifyRestoredQaHistoricalDecision(certificate: Buffer, key: Buffer, checkpointRaw: Buffer,
  context: any, acceptedAt: string) {
  need(Buffer.isBuffer(checkpointRaw) && checkpointRaw.length > 0 && checkpointRaw.length <= 16 * 1024 * 1024);
  const envelope = JSON.parse(certificate.toString('utf8')); need(exact(envelope, ['format', 'decision', 'signature']));
  const v = verifyOnlineRecoveryCertificate(certificate, key, domain, 'sabalan-signed-restored-qa-historical-hr/v1', acceptedAt);
  need(exact(v, ['format', 'purpose', 'intendedOwner', 'sourceDatabase', 'targetDatabase', 'sourceCheckpoint',
    'sourceReceiptSha256', 'nativeProofSha256', 'businessDataProofSha256', 'inquiryBusinessProofSha256', 'outerOwnerPhase',
    'cleanupPending', 'independentPointHealthy', 'productionAdmission', 'issuedAt', 'expiresAt'])
    && v.purpose === 'RESTORED_QA' && owner(v.intendedOwner) && database(v.sourceDatabase) && database(v.targetDatabase)
    && !equal(v.sourceDatabase, v.targetDatabase) && v.outerOwnerPhase === 'CALLBACK_ACTIVE'
    && v.cleanupPending === true && v.independentPointHealthy === false && v.productionAdmission === false
    && exact(v.sourceCheckpoint, ['deploymentId', 'releaseId', 'checksum', 'metadataSha256', 'manifestSha256', 'databaseDumpSha256'])
    && owner({ deploymentId: v.sourceCheckpoint.deploymentId, releaseId: v.sourceCheckpoint.releaseId })
    && [v.sourceCheckpoint.checksum, v.sourceCheckpoint.metadataSha256, v.sourceCheckpoint.manifestSha256,
      v.sourceCheckpoint.databaseDumpSha256, v.sourceReceiptSha256, v.nativeProofSha256,
      v.businessDataProofSha256, v.inquiryBusinessProofSha256].every(hex));
  const checkpoint = JSON.parse(checkpointRaw.toString('utf8')), proof = context?.proof;
  need(checkpoint.id === v.sourceCheckpoint.deploymentId && checkpoint.deploymentId === v.sourceCheckpoint.deploymentId
    && checkpoint.releaseId === v.sourceCheckpoint.releaseId && checkpoint.checksum === v.sourceCheckpoint.checksum
    && sha(checkpointRaw) === v.sourceCheckpoint.metadataSha256 && equal(checkpoint.sourceDatabase, v.sourceDatabase)
    && checkpoint.localVerified === true && checkpoint.remoteVerified === true && checkpoint.manifestReadable === true
    && equal(checkpoint.manifest, context?.manifest) && sha(encode(context.manifest)) === v.sourceCheckpoint.manifestSha256
    && context.manifest?.format === 'sabalan-recovery' && context.manifest.packageType === 'COMPLETE'
    && Array.isArray(context.manifest.components) && context.manifest.components.length <= 250000);
  const paths = new Set<string>();
  for (const row of context.manifest.components) {
    need(typeof row.path === 'string' && !row.path.startsWith('/') && !/[\\\0]/.test(row.path)
      && row.path.split('/').every((p: string) => p && p !== '.' && p !== '..') && !paths.has(row.path)
      && hex(row.sha256) && Number.isSafeInteger(row.size) && row.size >= 0); paths.add(row.path);
  }
  const dump = context.manifest.components.filter((r: any) => r.path === 'database/main.dump');
  need(dump.length === 1 && dump[0].size > 0 && dump[0].sha256 === v.sourceCheckpoint.databaseDumpSha256
    && paths.has('inquiry/inquiry.db') && typeof context.payloadRoot === 'string' && path.posix.isAbsolute(context.payloadRoot)
    && Array.isArray(context.businessDataProof) && context.businessDataProof.length > 0 && context.businessDataProof.length <= 1024
    && context.inquiryBusinessProof && sha(encode(context.businessDataProof)) === v.businessDataProofSha256
    && sha(encode(context.inquiryBusinessProof)) === v.inquiryBusinessProofSha256 && sha(encode(proof)) === v.nativeProofSha256);
  need(exact(proof, ['format', 'database', 'sourceReceiptSha256', 'nativeRowsCompared', 'activeRows', 'rollbackRows',
    'sourceCatalogMigrations', 'pendingMigrations', 'rawHistoryJson', 'rawHistorySha256', 'hrBridgeRowJson',
    'hrBridgeRowSha256', 'sourceAuthorityAuthenticated', 'cleanupPending', 'productionAdmission', 'originalRestore'])
    && proof.format === 'sabalan-private-native-complete-ledger439-proof/v1' && equal(proof.database, v.targetDatabase)
    && proof.sourceReceiptSha256 === v.sourceReceiptSha256 && proof.nativeRowsCompared === 440 && proof.activeRows === 439
    && proof.rollbackRows === 1 && proof.sourceCatalogMigrations === 444 && equal(proof.pendingMigrations, pending)
    && proof.sourceAuthorityAuthenticated === false && proof.cleanupPending === true && proof.productionAdmission === false
    && typeof proof.rawHistoryJson === 'string' && Buffer.byteLength(proof.rawHistoryJson) <= 8 * 1024 * 1024
    && sha(proof.rawHistoryJson) === proof.rawHistorySha256 && typeof proof.hrBridgeRowJson === 'string'
    && Buffer.byteLength(proof.hrBridgeRowJson) <= 65536 && sha(proof.hrBridgeRowJson) === proof.hrBridgeRowSha256);
  const history = JSON.parse(proof.rawHistoryJson), hr = JSON.parse(proof.hrBridgeRowJson), child = proof.originalRestore;
  need(Array.isArray(history) && history.length === 440 && history.filter((r: any) => r.rolled_back_at === null).length === 439
    && hr.migration_name === '20261014120000_hr_vehicle_assignment_plans' && hr.logs === null && hr.rolled_back_at === null
    && hr.checksum === 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289'
    && history.filter((r: any) => r.id === hr.id && equal(r, hr)).length === 1
    && exact(child, ['format', 'originalPid', 'code', 'signal', 'stdoutEof', 'stderrEof', 'killed', 'stdoutBytes', 'stderrBytes', 'stdoutSha256', 'stderrSha256'])
    && child.format === 'sabalan-owned-native-recovery-command/v1' && Number.isSafeInteger(child.originalPid) && child.originalPid > 0
    && child.code === 0 && child.signal === null && child.stdoutEof === true && child.stderrEof === true && child.killed === false
    && Number.isSafeInteger(child.stdoutBytes) && child.stdoutBytes >= 0 && Number.isSafeInteger(child.stderrBytes) && child.stderrBytes >= 0
    && hex(child.stdoutSha256) && hex(child.stderrSha256));
  return freeze({ decision: v, checkpoint, hr, rawHistoryJson: proof.rawHistoryJson,
    rawHistorySha256: proof.rawHistorySha256, hrBridgeRowSha256: proof.hrBridgeRowSha256 });
}

const pin = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.uid, s.mode, s.nlink].map(String).join(':');
function read(file: string, maximum: number, mode: number) {
  need(fs.realpathSync(file) === file); const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try { const before = fs.fstatSync(fd, { bigint: true });
    need(before.isFile() && before.uid === 0n && before.nlink === 1n && before.size > 0n && before.size <= BigInt(maximum)
      && (before.mode & 0o777n) === BigInt(mode)); const raw = fs.readFileSync(fd);
    need(pin(before) === pin(fs.fstatSync(fd, { bigint: true })) && pin(before) === pin(fs.lstatSync(file, { bigint: true })));
    return { raw, pin: pin(before), sha256: sha(raw) };
  } finally { fs.closeSync(fd); }
}
declare const qaBrand: unique symbol;
export type RestoredQaHistoricalAnchor = Readonly<{ [qaBrand]: true }>;
type State = { proof: unknown; context: ReturnType<typeof assertActiveStrictRestoreProof>;
  accepted: ReturnType<typeof verifyRestoredQaHistoricalDecision>; files: Map<string, ReturnType<typeof read>>; active: boolean };
const scopes = new WeakMap<RestoredQaHistoricalAnchor, State>();
const consumedProofs = new WeakSet<object>();

/** Only an actual ENGINE-enrolled object inside its original awaited callback
 * can enter this scope. Its lifetime never survives callback return, and it
 * grants neither FD9 nor a database lease/checkpoint by itself.
 */
export async function withRestoredQaHistoricalAnchor<T>(proof: unknown, intendedOwner: { deploymentId: string; releaseId: string },
  work: (scope: RestoredQaHistoricalAnchor) => Promise<T>): Promise<T> {
  const context = assertActiveStrictRestoreProof(proof);
  need(!consumedProofs.has(context.proof));
  consumedProofs.add(context.proof);
  need(process.platform === 'linux' && process.getuid?.() === 0 && owner(intendedOwner));
  const directory = process.env.RECOVERY_COORDINATION_DIR || '/app/recovery-coordination', dir = fs.lstatSync(directory, { bigint: true });
  need(path.isAbsolute(directory) && fs.realpathSync(directory) === directory && dir.isDirectory() && dir.uid === 0n && !(dir.mode & 0o022n));
  const certificateFile = path.join(directory, `${intendedOwner.deploymentId}-restored-qa-historical-hr-decision.json`),
    checkpointFile = path.join(directory, `${intendedOwner.deploymentId}-restored-qa-historical-hr-checkpoint.json`);
  const key = read(ONLINE_QUALIFICATION_PUBLIC_KEY, 4096, 0o444), certificate = read(certificateFile, 1024 * 1024, 0o400),
    checkpoint = read(checkpointFile, 16 * 1024 * 1024, 0o400);
  const accepted = verifyRestoredQaHistoricalDecision(certificate.raw, key.raw, checkpoint.raw, context, new Date().toISOString());
  need(equal(accepted.decision.intendedOwner, intendedOwner));
  const scope = Object.freeze({}) as RestoredQaHistoricalAnchor;
  const state: State = { proof, context, accepted, active: true,
    files: new Map([[ONLINE_QUALIFICATION_PUBLIC_KEY, key], [certificateFile, certificate], [checkpointFile, checkpoint]]) };
  scopes.set(scope, state);
  try { assertRestoredQaHistoricalAnchor(scope, intendedOwner); return await work(scope); }
  finally { state.active = false; scopes.delete(scope); }
}

export function assertRestoredQaHistoricalAnchor(scope: RestoredQaHistoricalAnchor, intendedOwner: { deploymentId: string; releaseId: string }) {
  const state = scopes.get(scope); need(state?.active && equal(state.accepted.decision.intendedOwner, intendedOwner));
  need(assertActiveStrictRestoreProof(state.proof) === state.context);
  for (const [file, previous] of state.files) {
    const current = read(file, file === ONLINE_QUALIFICATION_PUBLIC_KEY ? 4096 : 16 * 1024 * 1024,
      file === ONLINE_QUALIFICATION_PUBLIC_KEY ? 0o444 : 0o400);
    need(current.pin === previous.pin && current.sha256 === previous.sha256);
  }
  return { ...state.accepted, context: state.context };
}
