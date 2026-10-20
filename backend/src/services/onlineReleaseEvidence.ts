import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { completeProtectedPrivateQualificationPrerequisite,completeOnlinePrivateQualificationPrerequisite } from './deploymentGates';
import { assertOnlineQualificationProof, type OnlineQualificationBinding } from './onlineQualificationEvidence';
export { assertOnlineQualificationProof } from './onlineQualificationEvidence';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
function fail(): never { throw new Error('ONLINE_RELEASE_EVIDENCE_UNPROVEN'); }
const digest = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value: any, keys: string[]) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.prototype.hasOwnProperty.call(value, key));
const identity = (value: fs.BigIntStats) => [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs,
  value.uid, value.mode, value.nlink].map(String).join(':');
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
function boundedRead(fd: number, size: bigint) {
  const bytes = Buffer.alloc(Number(size)); let offset = 0;
  while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, null); if (!count) fail(); offset += count; }
  if (fs.readSync(fd, Buffer.alloc(1), 0, 1, null) !== 0) fail(); return bytes;
}
export type OnlineRetainedRoot = Readonly<{ live: string; store: string; liveDevice: string; liveInode: string;
  storeDevice: string; storeInode: string; baselineSha256: string }>;
export type OnlineReleaseManifest = Readonly<{ format: 'sabalan-online-release-manifest/v1'; releaseId: string;
  sourceCommit: string; image: string; runtimeBundleSha256: string; generation: number; database: { name: string; systemIdentifier: string };
  roots: readonly OnlineRetainedRoot[]; ephemeralRoots: readonly string[] }>;
type Descriptor = { file: string; bytes: number; sha256: string };
const scopes = ['release-gates', 'compatible-migrations', 'coherent-independent-restore', 'browser-24-hours',
  'single-worker-and-completion', 'current-domain'] as const;

/** Fixed file names and immutable registry hashes are supplied by the accepted
 * release controller. This verifier neither creates acceptance nor treats a
 * report's phase/boolean as evidence: all referenced bytes must be present and
 * match the immutable acceptance chain before native admission can be minted. */
export function readOnlineReleaseEvidence(directory: string, expected: {
  manifestSha256: string; acceptanceSha256: string;
}): { manifest: OnlineReleaseManifest; acceptance: any; nativeClosures: readonly any[]; evidenceInventory: readonly {file:string;bytes:number;sha256:string}[]; browserRegistries: readonly any[]; migrationPlans: readonly any[];
 migrationHistories:readonly Readonly<{before:{rows:number;sha256:string};afterRows:number}>[]; revalidate: () => void } {
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory || fs.realpathSync(directory) !== directory
    || !digest(expected.manifestSha256) || !digest(expected.acceptanceSha256)) fail();
  const root = fs.lstatSync(directory, { bigint: true });
  if (!root.isDirectory() || root.isSymbolicLink() || (process.platform !== 'win32' && (root.mode & 0o077n) !== 0n)
    || (process.getuid && root.uid !== BigInt(process.getuid()))) fail();
  const nativeClosures=new Map<string,any>();
  const evidenceInventory=new Map<string,{file:string;bytes:number;sha256:string}>();
  const browserRegistries: any[] = [];
  const migrationPlans: any[] = [];
  const migrationHistories:Array<{before:{rows:number;sha256:string};afterRows:number}>=[];
  const pins: Array<{ file: string; identity: string; namedIdentity: string; sha256: string }> = [];
  function read(file: string, expectedHash: string, maximum = 8 * 1024 * 1024, expectedBytes?: number) {
    if (!/^[a-z0-9][a-z0-9_.-]{0,95}$/.test(file) || !digest(expectedHash)) fail();
    const target = path.join(directory, file);
    const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    try {
      const before = fs.fstatSync(fd, { bigint: true });
      const named = fs.lstatSync(target, { bigint: true });
      for (const key of ['ino', 'size', 'mtimeNs', 'ctimeNs', 'uid', 'mode', 'nlink'] as const) if (named[key] !== before[key]) fail();
      if (process.platform !== 'win32' && named.dev !== before.dev) fail();
      if (!before.isFile() || before.nlink !== 1n || before.size < 1n || before.size > BigInt(maximum)
        || (process.platform !== 'win32' && (before.mode & 0o077n) !== 0n) || (process.getuid && before.uid !== BigInt(process.getuid()))) fail();
      const bytes = boundedRead(fd, before.size);
      if (bytes.length !== Number(before.size) || (expectedBytes !== undefined && bytes.length !== expectedBytes)
        || hash(bytes) !== expectedHash || identity(before) !== identity(fs.fstatSync(fd, { bigint: true }))
        || identity(named) !== identity(fs.lstatSync(target, { bigint: true }))) fail();
      pins.push({ file: target, identity: identity(before), namedIdentity: identity(named), sha256: expectedHash });
      evidenceInventory.set(file,{file,bytes:bytes.length,sha256:expectedHash});
      return JSON.parse(bytes.toString('utf8'));
    } finally { fs.closeSync(fd); }
  }
  const manifest = read('manifest.json', expected.manifestSha256, 128 * 1024) as OnlineReleaseManifest;
  if (!exact(manifest, ['format', 'releaseId', 'sourceCommit', 'image', 'runtimeBundleSha256', 'generation', 'database', 'roots', 'ephemeralRoots'])
    || manifest.format !== 'sabalan-online-release-manifest/v1' || !/^[a-zA-Z0-9_-]{8,128}$/.test(manifest.releaseId)
    || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit) || !/^sha256:[a-f0-9]{64}$/.test(manifest.image)
    || !digest(manifest.runtimeBundleSha256) || !Number.isSafeInteger(manifest.generation) || manifest.generation < 1
    || !exact(manifest.database, ['name', 'systemIdentifier']) || typeof manifest.database.name !== 'string'
    || !/^[1-9][0-9]*$/.test(manifest.database.systemIdentifier) || !Array.isArray(manifest.roots)
    || manifest.roots.length !== 9 || !Array.isArray(manifest.ephemeralRoots) || manifest.ephemeralRoots.length !== 3) fail();
  for (const value of manifest.roots) if (!exact(value, ['live', 'store', 'liveDevice', 'liveInode', 'storeDevice', 'storeInode', 'baselineSha256'])
    || !digest(value.baselineSha256) || ![value.live, value.store].every(file => typeof file === 'string' && path.posix.isAbsolute(file) && path.posix.resolve(file) === file)
    || ![value.liveDevice, value.liveInode, value.storeDevice, value.storeInode].every(value => typeof value === 'string' && /^\d+$/.test(value))) fail();
  if (new Set(manifest.roots.map(value => value.live)).size !== 9 || new Set(manifest.roots.map(value => value.store)).size !== 9
    || new Set(manifest.ephemeralRoots).size !== 3 || manifest.ephemeralRoots.some(value => typeof value !== 'string'
      || !path.posix.isAbsolute(value) || path.posix.resolve(value) !== value)) fail();
  const acceptance = read('acceptance.json', expected.acceptanceSha256, 128 * 1024);
  if (!exact(acceptance, ['format', 'manifestSha256', 'deploymentId', 'checkpointSha256', 'qualification', 'reports'])
    || acceptance.format !== 'sabalan-online-release-acceptance/v2' || acceptance.manifestSha256 !== expected.manifestSha256
    || typeof acceptance.deploymentId !== 'string' || !acceptance.deploymentId || !digest(acceptance.checkpointSha256)
    || !exact(acceptance.reports, [...scopes])) fail();
  const qualification = acceptance.qualification;
  const qualificationKeys=['schemaSha256', 'sourceDatabase', 'proofDatabases', 'recoveryMode', 'deploymentTargetDatabase', 'captureId', 'images', 'checkpointArchiveChecksum','componentSourceCommits','runtimeCohorts','deploymentTargetImages','imageGraphs','imageArchiveReceipts'];
  if(qualification?.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE')qualificationKeys.push('qualificationCheckpoint');
  if (!exact(qualification, qualificationKeys)
    || !digest(qualification.schemaSha256) || !digest(qualification.captureId) || !digest(qualification.checkpointArchiveChecksum)
    || !exact(qualification.sourceDatabase,['name','systemIdentifier','oid'])
    || !/^[A-Za-z0-9_]{1,63}$/.test(qualification.sourceDatabase.name)
    || !/^[1-9][0-9]*$/.test(qualification.sourceDatabase.systemIdentifier)
    || !/^[1-9][0-9]*$/.test(qualification.sourceDatabase.oid)
    || !exact(qualification.deploymentTargetDatabase,['name','systemIdentifier','oid'])
    || !/^[1-9][0-9]*$/.test(qualification.deploymentTargetDatabase.oid)
    || qualification.deploymentTargetDatabase.name !== manifest.database.name
    || qualification.deploymentTargetDatabase.systemIdentifier !== manifest.database.systemIdentifier
    || !exact(qualification.images, ['backend', 'frontend', 'inquiry'])
    || !exact(qualification.componentSourceCommits,['backend','frontend','inquiry'])
    || !exact(qualification.runtimeCohorts,['compatible-migrations','coherent-independent-restore','browser-24-hours','single-worker-and-completion','current-domain'])
    || !exact(qualification.proofDatabases,['compatible-migrations','coherent-independent-restore','browser-24-hours','single-worker-and-completion','current-domain'])
    || Object.values(qualification.images).some(value => typeof value !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(value))
    || !exact(qualification.deploymentTargetImages,['backend','frontend','inquiry'])
    || !exact(qualification.imageGraphs,['backend','frontend','inquiry'])
    || !exact(qualification.imageArchiveReceipts,['backend','frontend','inquiry'])
    || qualification.deploymentTargetImages.backend !== manifest.image) fail();
  for(const role of ['backend','frontend','inquiry'] as const){
    const descriptor=qualification.imageArchiveReceipts[role];
    if(!exact(descriptor,['file','bytes','sha256'])||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<1||descriptor.bytes>1048576)fail();
    const receipt=read(descriptor.file,descriptor.sha256,1048576,descriptor.bytes);
    const graph=qualification.imageGraphs[role];
    if(!graph||['index','platform','config','rootfsDiffIds','archiveSha256','archiveBytes'].some(key=>JSON.stringify(receipt[key])!==JSON.stringify(graph[key])))fail();
  }
  const binding: OnlineQualificationBinding = { manifestSha256: expected.manifestSha256,
    checkpointSha256: acceptance.checkpointSha256, checkpointArchiveChecksum: qualification.checkpointArchiveChecksum, releaseId: manifest.releaseId, sourceCommit: manifest.sourceCommit,
    runtimeBundleSha256: manifest.runtimeBundleSha256, schemaSha256: qualification.schemaSha256, captureId: qualification.captureId,
    sourceDatabase: qualification.sourceDatabase,proofDatabases:qualification.proofDatabases,recoveryMode:qualification.recoveryMode, deploymentTargetDatabase: qualification.deploymentTargetDatabase, images: qualification.images,
    ...(qualification.qualificationCheckpoint?{qualificationCheckpoint:qualification.qualificationCheckpoint}:{}),
    deploymentTargetImages:qualification.deploymentTargetImages,imageGraphs:qualification.imageGraphs,
    componentSourceCommits:qualification.componentSourceCommits,runtimeCohorts:qualification.runtimeCohorts };
  for (const scope of scopes) {
    const descriptor: Descriptor = acceptance.reports[scope];
    if (!exact(descriptor, ['file', 'bytes', 'sha256']) || descriptor.file !== scope + '.json'
      || !Number.isSafeInteger(descriptor.bytes) || descriptor.bytes < 1 || descriptor.bytes > 8 * 1024 * 1024) fail();
    const report = read(descriptor.file, descriptor.sha256, 8 * 1024 * 1024, descriptor.bytes);
    if (scope === 'release-gates') {
      if(qualification.recoveryMode==='PROTECTED_MAINTENANCE_COMPLETE'){
        if(!completeProtectedPrivateQualificationPrerequisite(report,{releaseId:manifest.releaseId,manifestSha256:expected.manifestSha256,
          qualificationCheckpointSha256:qualification.qualificationCheckpoint?.metadataSha256,
          qualificationReports:Object.fromEntries(scopes.filter(value=>value!=='release-gates').map(scope=>[scope,acceptance.reports[scope]?.sha256]))}))fail();
      }else if (!completeOnlinePrivateQualificationPrerequisite(report,{releaseId:manifest.releaseId,manifestSha256:expected.manifestSha256,
        checkpointSha256:acceptance.checkpointSha256,captureId:qualification.captureId,
        qualificationReports:Object.fromEntries(scopes.filter(value=>value!=='release-gates').map(scope=>[scope,acceptance.reports[scope]?.sha256]))})) fail();
    } else {
      // The owned controller records the exact qualification receipt hash in
      // the immutable release identity. These are production acceptance
      // receipts, never a relabelled local diagnostic with admission=false.
      if (report.format !== 'sabalan-online-qualification/v1' || report.scope !== scope
        || report.manifestSha256 !== expected.manifestSha256 || report.releaseId !== manifest.releaseId
        || report.sourceCommit !== manifest.sourceCommit || report.image !== manifest.image
        || report.productionAdmission !== true || !Array.isArray(report.proofs) || !report.proofs.length
        || report.proofs.length > 64) fail();
      for (const proof of report.proofs) {
        if (!exact(proof, ['file', 'bytes', 'sha256']) || !Number.isSafeInteger(proof.bytes) || proof.bytes < 1
          || proof.bytes > 8 * 1024 * 1024 || !digest(proof.sha256)) fail();
        const source = read(proof.file, proof.sha256, 8 * 1024 * 1024, proof.bytes);
        assertOnlineQualificationProof(scope, source, binding);
        const originalClosures=[...source.originalNativeClosures,
          ...(scope==='browser-24-hours'?source.installedRouting.originalNativeClosures:[])];
        for(const closure of originalClosures){
          const row={runtimeId:closure.runtimeId,nativeSha256:hash(Buffer.from(closure.nativeRawBase64,'base64')),
            workSha256:hash(Buffer.from(closure.workRawBase64,'base64')),activeClaimSha256:closure.activeClaimSha256};
          const old=nativeClosures.get(row.runtimeId);if(old&&JSON.stringify(old)!==JSON.stringify(row))fail();
          nativeClosures.set(row.runtimeId,row);
        }
        if (scope === 'compatible-migrations') {
          migrationPlans.push(...source.ownedMigration.steps.map((step:any)=>step.plan));
          migrationHistories.push({before:{rows:source.originalHistory.rows,sha256:source.originalHistory.sha256},afterRows:source.history.rows});
        }
        if (scope === 'browser-24-hours') {
          browserRegistries.push(JSON.parse(Buffer.from(source.routingRegistryRawBase64,'base64').toString('utf8')));
          browserRegistries.push(JSON.parse(Buffer.from(source.installedRouting.publicationRawBase64,'base64').toString('utf8')).registry);
        }
      }
    }
  }
  const revalidate = () => {
    const current = fs.lstatSync(directory, { bigint: true });
    if (identity(current) !== identity(root)) fail();
    for (const pin of pins) {
      const fd = fs.openSync(pin.file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      try {
        const before = fs.fstatSync(fd, { bigint: true });
        if (identity(before) !== pin.identity || hash(boundedRead(fd, before.size)) !== pin.sha256
          || identity(fs.fstatSync(fd, { bigint: true })) !== pin.identity
          || identity(fs.lstatSync(pin.file, { bigint: true })) !== pin.namedIdentity) fail();
      } finally { fs.closeSync(fd); }
    }
  };
  revalidate(); return { nativeClosures:freeze([...nativeClosures.values()].sort((a,b)=>a.runtimeId.localeCompare(b.runtimeId))),
    evidenceInventory:freeze([...evidenceInventory.values()].sort((a,b)=>a.file<b.file?-1:a.file>b.file?1:0)),manifest: freeze(manifest), acceptance: freeze(acceptance), browserRegistries: freeze(browserRegistries),
    migrationPlans: freeze(migrationPlans),migrationHistories:freeze(migrationHistories), revalidate };
}
