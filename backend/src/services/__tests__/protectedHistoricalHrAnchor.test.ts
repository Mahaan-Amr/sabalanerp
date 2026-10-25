import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { verifyHistoricalHrRestoreAnchor, verifyCurrentHistoricalHrCheckpoint } from '../protectedHistoricalHrAnchor';
import { inspectHistoricalProtectedBridgeMigration } from '../protectedBridgeMigrations';
import fs from 'node:fs';
import path from 'node:path';

const sha = (v: Buffer) => createHash('sha256').update(v).digest('hex');
const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const raw = (v: unknown) => Buffer.from(JSON.stringify(canonical(v)));
const keys = generateKeyPairSync('ed25519');
const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const now = new Date('2026-10-24T00:01:00.000Z');

function fixture() {
  const checkpoint = { id: 'operation_123', deploymentId: 'operation_123', releaseId: 'release_123', checksum: 'a'.repeat(64), size: 1234,
    sourceMachineUuidSha256: 'b'.repeat(64), sourceKernelBootIdSha256: 'c'.repeat(64),
    sourceDatabase: { name: 'source_db', oid: '123', systemIdentifier: '456' },
    localVerified: true, remoteVerified: true, manifestReadable: true,
    manifest: { format: 'sabalan-recovery', packageType: 'COMPLETE', components: [{ path: 'database/main.dump', size: 1000, sha256: 'd'.repeat(64) }] } };
  const hr = { id: 'native_old_id', migration_name: '20261014120000_hr_vehicle_assignment_plans',
    checksum: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289',
    finished_at: '2026-10-14T12:01:00.000Z', started_at: '2026-10-14T12:00:00.000Z', rolled_back_at: null, logs: null, applied_steps_count: 1 };
  const history = [hr, ...Array.from({ length: 438 }, (_, index) => ({ ...hr, id: 'old_' + index,
    migration_name: '20260101000000_fixture_' + index, checksum: 'e'.repeat(64) }))];
  const business = { ok: true, restoredDatabase: { name: 'restore_db', oid: '321', systemIdentifier: '654' },
    drill: { format: 'sabalan-independent-checkpoint-drill/v1', status: 'HEALTHY', phase: 'COMPLETE',
      operationId: 'drill-operation_123-123', checkpointId: checkpoint.id, releaseId: checkpoint.releaseId, checksum: checkpoint.checksum,
      size: checkpoint.size, packageType: 'COMPLETE', sourceMachineUuidSha256: checkpoint.sourceMachineUuidSha256,
      recoveryMachineUuidSha256: 'f'.repeat(64), sourceKernelBootIdSha256: checkpoint.sourceKernelBootIdSha256,
      recoveryKernelBootIdSha256: '1'.repeat(64), startedAt: '2026-10-24T00:00:00.000Z', completedAt: '2026-10-24T00:00:30.000Z',
      stagedPostgresRestore: true, stagedSqliteIntegrity: true, verifiedFiles: true, verifiedApplicationPayloads: true, verifiedBusinessData: true } };
  const artifacts = { checkpointRaw: raw(checkpoint), historyRaw: raw(history), hrRowRaw: raw(hr), businessRaw: raw(business),
    originalRaw: Buffer.alloc(0) };
  artifacts.originalRaw = raw({ pid: 42, code: 0, pipesClosed: true, naturalClosureObserved: true, interrupted: false,
    observationFault: null, sourceSha256: '2'.repeat(64), stdoutRawBase64: artifacts.businessRaw.toString('base64'),
    stdoutSha256: sha(artifacts.businessRaw), stderrRawBase64: '', stderrSha256: sha(Buffer.alloc(0)) });
  const decision = { format: 'sabalan-historical-hr-restore/v1', purpose: 'VERIFIED_HISTORICAL_INSPECTION', nativeExecutionClaimed: false,
    deploymentId: checkpoint.deploymentId, releaseId: checkpoint.releaseId, checkpointChecksum: checkpoint.checksum,
    intendedOwner: { deploymentId: 'deployment_B123', releaseId: 'release_B123' },
    checkpointMetadataSha256: sha(artifacts.checkpointRaw), databaseDumpSha256: 'd'.repeat(64),
    sourceDatabase: checkpoint.sourceDatabase, restoredDatabase: business.restoredDatabase,
    nativeHistorySha256: sha(artifacts.historyRaw), nativeHistoryRows: history.length, nativeAppliedRows: 439,
    hrRowSha256: sha(artifacts.hrRowRaw), restoreOriginalSha256: sha(artifacts.originalRaw), businessEvidenceSha256: sha(artifacts.businessRaw),
    issuedAt: '2026-10-24T00:00:40.000Z', expiresAt: '2026-10-24T00:05:40.000Z' };
  const signed = (value = decision) => raw({ format: 'sabalan-signed-historical-hr-restore/v1', decision: value,
    signature: sign(null, Buffer.concat([Buffer.from('sabalan-historical-hr-restore/v1\n'), raw(value)]), keys.privateKey).toString('base64') });
  return { artifacts, decision, signed };
}

test('signed FULL independent restore binds original native HR row and prior history, without claiming execution', () => {
  const f = fixture();
  const accepted = verifyHistoricalHrRestoreAnchor(f.signed(), Buffer.from(publicKey), f.artifacts, now.toISOString());
  assert.equal(accepted.decision.nativeExecutionClaimed, false);
  assert.equal(accepted.decision.nativeAppliedRows, 439);
  assert.notEqual(accepted.decision.intendedOwner.deploymentId, accepted.checkpoint.deploymentId);
});

test('unsigned, missing, mixed, non-independent or non-FULL restore evidence fails closed', () => {
  const f = fixture();
  assert.throws(() => verifyHistoricalHrRestoreAnchor(Buffer.alloc(0), Buffer.from(publicKey), f.artifacts, now.toISOString()));
  for (const key of Object.keys(f.artifacts) as Array<keyof typeof f.artifacts>) {
    assert.throws(() => verifyHistoricalHrRestoreAnchor(f.signed(), Buffer.from(publicKey), { ...f.artifacts, [key]: Buffer.from('{}') }, now.toISOString()));
  }
  for (const mutation of [
    (d: any) => { d.nativeExecutionClaimed = true; }, (d: any) => { d.purpose = 'APPLY'; },
    (d: any) => { d.restoredDatabase = d.sourceDatabase; }, (d: any) => { d.databaseDumpSha256 = '3'.repeat(64); },
    (d: any) => { d.nativeAppliedRows = 444; }, (d: any) => { d.issuedAt = '2026-10-24T00:02:00.000Z'; },
    (d: any) => { d.extraAuthority = true; },
    (d: any) => { delete d.intendedOwner; }, (d: any) => { d.intendedOwner.extra = 'authority'; },
  ]) { const d = structuredClone(f.decision); mutation(d); assert.throws(() => verifyHistoricalHrRestoreAnchor(f.signed(d), Buffer.from(publicKey), f.artifacts, now.toISOString())); }
});

test('even correctly signed artifact hashes cannot replace FULL restore, business validation or native closure', () => {
  const mutations: Array<[keyof ReturnType<typeof fixture>['artifacts'], (v: any) => void]> = [
    ['checkpointRaw', v => { v.manifest.packageType = 'PARTIAL'; }],
    ['checkpointRaw', v => { v.remoteVerified = false; }],
    ['businessRaw', v => { v.drill.verifiedBusinessData = false; }],
    ['businessRaw', v => { v.drill.recoveryMachineUuidSha256 = v.drill.sourceMachineUuidSha256; }],
    ['businessRaw', v => { v.drill.completedAt = '2026-10-24T00:02:00.000Z'; }],
    ['originalRaw', v => { v.code = 1; }], ['originalRaw', v => { v.pipesClosed = false; }],
    ['originalRaw', v => { v.interrupted = true; }], ['originalRaw', v => { v.observationFault = 'uncertain'; }],
    ['historyRaw', v => { v[0].logs = '{}'; }], ['historyRaw', v => { v[1].finished_at = null; }],
    ['hrRowRaw', v => { v.logs = '{}'; }],
  ];
  const hashFields = { checkpointRaw: 'checkpointMetadataSha256', historyRaw: 'nativeHistorySha256',
    hrRowRaw: 'hrRowSha256', businessRaw: 'businessEvidenceSha256', originalRaw: 'restoreOriginalSha256' } as const;
  for (const [key, mutate] of mutations) {
    const f = fixture(), parsed = JSON.parse(f.artifacts[key].toString()); mutate(parsed); f.artifacts[key] = raw(parsed);
    (f.decision as any)[hashFields[key]] = sha(f.artifacts[key]);
    if (key === 'businessRaw') {
      const original = JSON.parse(f.artifacts.originalRaw.toString());
      original.stdoutRawBase64 = f.artifacts.businessRaw.toString('base64'); original.stdoutSha256 = sha(f.artifacts.businessRaw);
      f.artifacts.originalRaw = raw(original); f.decision.restoreOriginalSha256 = sha(f.artifacts.originalRaw);
    }
    assert.throws(() => verifyHistoricalHrRestoreAnchor(f.signed(), Buffer.from(publicKey), f.artifacts, now.toISOString()), key);
  }
});

test('a data-only decision or fabricated token cannot reach historical inspection database work', async () => {
  const bytes = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261014120000_hr_vehicle_assignment_plans/migration.sql'));
  const database = new Proxy({}, { get() { throw Error('DATABASE_MUST_NOT_BE_REACHED'); } });
  await assert.rejects(inspectHistoricalProtectedBridgeMigration(database as any,
    { deploymentId: 'operation_123', releaseId: 'release_123', leaseToken: 'lease_123' },
    '20261014120000_hr_vehicle_assignment_plans', bytes, {} as any), /AUTHENTICATED_RESTORE_REQUIRED/);
});

test('a new current B checkpoint binds actual owner and dump without claiming an independent B drill', () => {
  const f = fixture(), accepted = verifyHistoricalHrRestoreAnchor(f.signed(), Buffer.from(publicKey), f.artifacts, now.toISOString());
  const current = JSON.parse(f.artifacts.checkpointRaw.toString());
  Object.assign(current, { id: 'deployment_B123', deploymentId: 'deployment_B123', releaseId: 'release_B123',
    checksum: '4'.repeat(64), restoreVerified: true, independentRestoreVerified: false });
  current.manifest.components[0].sha256 = '5'.repeat(64);
  const owner = accepted.decision.intendedOwner;
  const binding = verifyCurrentHistoricalHrCheckpoint(current, owner, accepted.decision.sourceDatabase);
  assert.equal(binding.checksum, current.checksum);
  assert.equal(binding.databaseDumpSha256, '5'.repeat(64));
  assert.equal(binding.independentRestoreClaimed, false);
  assert.notEqual(binding.checksum, accepted.decision.checkpointChecksum);
  for (const mutate of [
    (v: any) => { v.deploymentId = accepted.checkpoint.deploymentId; },
    (v: any) => { v.sourceDatabase.oid = '999'; }, (v: any) => { v.restoreVerified = false; },
    (v: any) => { v.remoteVerified = false; }, (v: any) => { v.localVerified = false; },
    (v: any) => { v.manifest.packageType = 'PARTIAL'; }, (v: any) => { v.manifest.components = []; },
    (v: any) => { v.manifest.components.push(v.manifest.components[0]); },
    (v: any) => { v.manifest.components[0].path = '../database/main.dump'; },
  ]) { const changed = structuredClone(current); mutate(changed); assert.throws(() => verifyCurrentHistoricalHrCheckpoint(changed, owner, accepted.decision.sourceDatabase)); }
});
