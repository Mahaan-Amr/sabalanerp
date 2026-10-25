import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { verifyRestoredQaHistoricalDecision, assertRestoredQaHistoricalAnchor, withRestoredQaHistoricalAnchor } from '../protectedRestoredQaHrAnchor';
import { verifyHistoricalHrRestoreAnchor } from '../protectedHistoricalHrAnchor';
import { inspectRestoredQaProtectedBridgeMigration } from '../protectedBridgeMigrations';
import fs from 'node:fs';
import path from 'node:path';

const canonical = (v: any): any => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const raw = (v: unknown) => Buffer.from(JSON.stringify(canonical(v)));
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const keys = generateKeyPairSync('ed25519'), publicKey = Buffer.from(keys.publicKey.export({ type: 'spki', format: 'pem' }) as string);
const acceptedAt = '2026-10-24T00:01:00.000Z';
function fixture() {
  const sourceDatabase = { name: 'production_source', oid: '123', systemIdentifier: '456' }, targetDatabase = { name: 'qa_restored', oid: '321', systemIdentifier: '654' };
  const hr = { id: 'old_hr', migration_name: '20261014120000_hr_vehicle_assignment_plans',
    checksum: 'c0dea142d206b5538fd81c98961aaf86926c999cdd8fb722e0aab3d72ab23289', logs: null, rolled_back_at: null };
  const history = [hr, ...Array.from({ length: 438 }, (_, i) => ({ ...hr, id: 'old_' + i, migration_name: '20260101000000_fixture_' + i })),
    { ...hr, id: 'old_rollback', migration_name: '20260720000100_security_report_attendance_operations', rolled_back_at: '2026-10-23T00:00:00Z' }];
  const proof = { format: 'sabalan-private-native-complete-ledger439-proof/v1', database: targetDatabase, sourceReceiptSha256: 'a'.repeat(64),
    nativeRowsCompared: 440, activeRows: 439, rollbackRows: 1, sourceCatalogMigrations: 444,
    pendingMigrations: ['20261014140000_online_deployment_control', '20261019010000_customer_semantic_barrier', '20261019020000_hr_versioned_file_cleanup', '20261020010000_online_realtime_completion', '20261020093000_online_serving_epochs'],
    rawHistoryJson: JSON.stringify(history), rawHistorySha256: sha(JSON.stringify(history)), hrBridgeRowJson: JSON.stringify(hr), hrBridgeRowSha256: sha(JSON.stringify(hr)),
    sourceAuthorityAuthenticated: false, cleanupPending: true, productionAdmission: false,
    originalRestore: { format: 'sabalan-owned-native-recovery-command/v1', originalPid: 1234, code: 0, signal: null,
      stdoutEof: true, stderrEof: true, killed: false, stdoutBytes: 0, stderrBytes: 0, stdoutSha256: sha(''), stderrSha256: sha('') } };
  const checkpoint = { id: 'capture_A123', deploymentId: 'capture_A123', releaseId: 'release_A123', checksum: 'b'.repeat(64),
    sourceDatabase, localVerified: true, remoteVerified: true, manifestReadable: true,
    manifest: { format: 'sabalan-recovery', packageType: 'COMPLETE', components: [
      { path: 'database/main.dump', size: 100, sha256: 'c'.repeat(64) }, { path: 'inquiry/inquiry.db', size: 50, sha256: 'd'.repeat(64) }] } };
  const context = { proof, payloadRoot: '/private/original/validate-123/payload', manifest: checkpoint.manifest,
    businessDataProof: [{ table: 'accounting_fixture', rows: 1, sha256: 'e'.repeat(64) }], inquiryBusinessProof: { sha256: 'f'.repeat(64) } };
  const checkpointRaw = raw(checkpoint);
  const decision = { format: 'sabalan-restored-qa-historical-hr/v1', purpose: 'RESTORED_QA',
    intendedOwner: { deploymentId: 'qa_deploy_B123', releaseId: 'qa_release_B123' }, sourceDatabase, targetDatabase,
    sourceCheckpoint: { deploymentId: checkpoint.deploymentId, releaseId: checkpoint.releaseId, checksum: checkpoint.checksum,
      metadataSha256: sha(checkpointRaw), manifestSha256: sha(raw(checkpoint.manifest)), databaseDumpSha256: 'c'.repeat(64) },
    sourceReceiptSha256: proof.sourceReceiptSha256, nativeProofSha256: sha(raw(proof)),
    businessDataProofSha256: sha(raw(context.businessDataProof)), inquiryBusinessProofSha256: sha(raw(context.inquiryBusinessProof)),
    outerOwnerPhase: 'CALLBACK_ACTIVE', cleanupPending: true, independentPointHealthy: false, productionAdmission: false,
    issuedAt: '2026-10-24T00:00:40.000Z', expiresAt: '2026-10-24T00:05:40.000Z' };
  const signed = (v = decision) => raw({ format: 'sabalan-signed-restored-qa-historical-hr/v1', decision: v,
    signature: sign(null, Buffer.concat([Buffer.from('sabalan-restored-qa-historical-hr/v1\n'), raw(v)]), keys.privateKey).toString('base64') });
  return { checkpointRaw, context, decision, signed };
}

test('RESTORED_QA describes a completed native restore child inside a live owner, with no independent-health or production claim', () => {
  const f = fixture(), v = verifyRestoredQaHistoricalDecision(f.signed(), publicKey, f.checkpointRaw, f.context, acceptedAt);
  assert.equal(v.decision.productionAdmission, false); assert.equal(v.decision.independentPointHealthy, false);
  assert.notDeepEqual(v.decision.sourceDatabase, v.decision.targetDatabase);
});

test('signed future cleanup, production claims, wrong source/target, failed child and changed history are refused', () => {
  for (const mutate of [
    (v: any) => { v.cleanupPending = false; }, (v: any) => { v.independentPointHealthy = true; },
    (v: any) => { v.productionAdmission = true; }, (v: any) => { v.outerOwnerPhase = 'CLOSED'; },
    (v: any) => { v.targetDatabase = v.sourceDatabase; }, (v: any) => { v.sourceDatabase.oid = '999'; },
    (v: any) => { v.expiresAt = '2026-10-24T00:00:50.000Z'; }, (v: any) => { v.extraAuthority = true; },
  ]) { const f = fixture(); mutate(f.decision); assert.throws(() => verifyRestoredQaHistoricalDecision(f.signed(), publicKey, f.checkpointRaw, f.context, acceptedAt)); }
  for (const mutate of [
    (c: any) => { c.proof.originalRestore.code = 1; }, (c: any) => { c.proof.originalRestore.stdoutEof = false; },
    (c: any) => { c.proof.rawHistoryJson += ' '; }, (c: any) => { c.proof.database.oid = '999'; },
  ]) { const f = fixture(), context = structuredClone(f.context); mutate(context); f.decision.nativeProofSha256 = sha(raw(context.proof));
    assert.throws(() => verifyRestoredQaHistoricalDecision(f.signed(), publicKey, f.checkpointRaw, context, acceptedAt)); }
});

test('data-only QA decisions and forged/copy tokens confer no live callback or production authority', () => {
  const f = fixture(); assert.throws(() => assertRestoredQaHistoricalAnchor({} as any, f.decision.intendedOwner));
  assert.throws(() => verifyHistoricalHrRestoreAnchor(f.signed(), publicKey, {
    checkpointRaw: f.checkpointRaw, historyRaw: Buffer.from(f.context.proof.rawHistoryJson), hrRowRaw: Buffer.from(f.context.proof.hrBridgeRowJson),
    businessRaw: Buffer.from('{}'), originalRaw: Buffer.from('{}'),
  }, acceptedAt));
});

test('a serialized or copied real-looking proof cannot enter the actual engine callback scope', async () => {
  const f = fixture(); let entered = false;
  for (const proof of [f.context.proof, structuredClone(f.context.proof), JSON.parse(JSON.stringify(f.context.proof))]) {
    await assert.rejects(withRestoredQaHistoricalAnchor(proof, f.decision.intendedOwner, async () => { entered = true; }));
  }
  assert.equal(entered, false);
  const database = new Proxy({}, { get() { throw Error('DATABASE_MUST_NOT_BE_REACHED'); } });
  const bytes = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations/20261014120000_hr_vehicle_assignment_plans/migration.sql'));
  await assert.rejects(inspectRestoredQaProtectedBridgeMigration(database as any,
    { ...f.decision.intendedOwner, leaseToken: 'not-an-authority' },
    '20261014120000_hr_vehicle_assignment_plans', bytes, {} as any), /RESTORED_QA_HISTORICAL_SCOPE_UNPROVEN/);
});
