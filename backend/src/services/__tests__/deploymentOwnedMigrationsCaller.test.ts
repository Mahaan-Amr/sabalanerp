import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { runDeploymentOwnedMigrations, persistHistoricalInspection, validateHistoricalInspectionPublication } from '../../scripts/deployment-owned-migrations';

const hr = '20261014120000_hr_vehicle_assignment_plans';
const names = [hr, '20261014140000_online_deployment_control', '20261019010000_customer_semantic_barrier',
  '20261019020000_hr_versioned_file_cleanup', '20261020010000_online_realtime_completion', '20261020093000_online_serving_epochs'];
const sha = (v: Buffer | string) => createHash('sha256').update(v).digest('hex');
const files = () => new Map(names.map(name => [name, Buffer.from(fs.readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n'))]));
function adapter(initial: string[] = [hr]) {
  const catalog = files(), calls: string[] = [];
  const row = (name: string, logs: string | null) => ({ id: 'native_' + name, migration_name: name,
    checksum: sha(catalog.get(name)!), started_at: '2026-10-24T00:00:00.000Z', finished_at: '2026-10-24T00:00:01.000Z',
    rolled_back_at: null, applied_steps_count: 1, logs });
  const native = initial.map(name => row(name, name === hr ? null : JSON.stringify({ format: 'sabalan-protected-bridge/v1',
    sqlSha256: sha(catalog.get(name)!), catalogSha256: 'a'.repeat(64) })));
  const runtime = {
    async assertAuthority() { calls.push('authority'); },
    async readHistory(excludeNativeIds: readonly string[]) { return JSON.stringify(native.filter(value => !excludeNativeIds.includes(value.id))
      .sort((a, b) => a.migration_name.localeCompare(b.migration_name))); },
    async inspectHistoricalHr(name: string) { calls.push('inspect:' + name); return { classification: 'VERIFIED_HISTORICAL_INSPECTION', phase: native.length }; },
    async persistInspection(_receipt: unknown) { calls.push('persist'); return { file: '/private/operation-inspection.json', sha256: 'b'.repeat(64) }; },
    async apply(name: string) {
      const exists = native.some(value => value.migration_name === name && value.rolled_back_at === null); calls.push((exists ? 'validate:' : 'ddl:') + name);
      if (!exists) native.push({ ...row(name, JSON.stringify({ format: 'sabalan-protected-bridge/v1', sqlSha256: sha(catalog.get(name)!), catalogSha256: 'a'.repeat(64) })), id: 'new_native_' + name });
      return { applied: !exists, checksum: sha(catalog.get(name)!) };
    },
  };
  return { catalog, native, runtime, calls };
}

test('all already-applied owned history and durable explicit HR inspection precede pending DDL', async () => {
  const a = adapter([hr, names[1], names[4]]);
  const result = await runDeploymentOwnedMigrations(a.catalog, a.runtime);
  const ddl = a.calls.findIndex(value => value.startsWith('ddl:'));
  assert.ok(ddl > a.calls.indexOf('persist'));
  assert.ok(ddl > a.calls.indexOf('validate:' + names[1]));
  assert.ok(ddl > a.calls.indexOf('validate:' + names[4]));
  assert.ok(!a.calls.includes('validate:' + hr));
  assert.equal(result.pendingCount, 3);
  assert.equal(result.steps.length, 3);
  assert.equal(result.history.priorProjectionUnchanged, true);
  assert.ok(!Object.prototype.hasOwnProperty.call(result, 'financialSchemaQualified'));
});

test('unsupported later pending SQL refuses before any validation action or DDL', async () => {
  const a = adapter(); a.catalog.set('20261231000000_unreviewed', Buffer.from('DROP TABLE users;'));
  await assert.rejects(runDeploymentOwnedMigrations(a.catalog, a.runtime), /MIGRATION_UNSUPPORTED/);
  assert.deepEqual(a.calls, ['authority']);
});

test('failed inspection publication and invalid existing owned history never fall back to DDL', async () => {
  const a = adapter(); a.runtime.persistInspection = async () => { throw Error('DISK_FULL'); };
  await assert.rejects(runDeploymentOwnedMigrations(a.catalog, a.runtime), /DISK_FULL/);
  assert.ok(!a.calls.some(value => value.startsWith('ddl:')));
  const b = adapter([hr, names[1]]); b.runtime.apply = async () => { throw Error('OWNED_RECEIPT_DRIFT'); };
  await assert.rejects(runDeploymentOwnedMigrations(b.catalog, b.runtime), /OWNED_RECEIPT_DRIFT/);
  assert.ok(!b.calls.some(value => value.startsWith('ddl:')));
});

test('a zero-pending retry still freshly inspects NULL HR and validates all other five owned receipts', async () => {
  const a = adapter(names); const result = await runDeploymentOwnedMigrations(a.catalog, a.runtime);
  assert.equal(result.pendingCount, 0); assert.equal(result.steps.length, 0);
  assert.equal(a.calls.filter(value => value.startsWith('inspect:')).length, 1);
  assert.equal(a.calls.filter(value => value.startsWith('validate:')).length, 5);
  assert.ok(a.calls.includes('persist'));
});

test('non-NULL HR history uses only the strict normal applier, and changed original history refuses completion', async () => {
  const a = adapter(names); a.native[0].logs = '{}';
  a.runtime.apply = async () => { throw Error('STRICT_NORMAL_HR_REFUSAL'); };
  await assert.rejects(runDeploymentOwnedMigrations(a.catalog, a.runtime), /STRICT_NORMAL_HR_REFUSAL/);
  assert.ok(!a.calls.some(value => value.startsWith('inspect:')));
  const b = adapter(), apply = b.runtime.apply;
  b.runtime.apply = async name => { const result = await apply(name); b.native[0].id = 'changed_original_id'; return result; };
  await assert.rejects(runDeploymentOwnedMigrations(b.catalog, b.runtime), /NEW_NATIVE_ROWS_UNPROVEN/);
  const c = adapter(), applyC = c.runtime.apply;
  c.runtime.apply = async name => { const result = await applyC(name); c.native[0].logs = '{}'; return result; };
  await assert.rejects(runDeploymentOwnedMigrations(c.catalog, c.runtime), /PRIOR_HISTORY_CHANGED/);
});

test('an untouched old rolled-back row with the same pending migration name survives the exact prior-history projection', async () => {
  const a = adapter();
  const old = { ...a.native[0], id: 'original_rolled_back_id', migration_name: names[1],
    checksum: sha(a.catalog.get(names[1])!), rolled_back_at: '2026-10-23T00:00:00.000Z', logs: null };
  a.native.push(old as any); const original = JSON.stringify(old);
  const result = await runDeploymentOwnedMigrations(a.catalog, a.runtime);
  assert.equal(result.pendingCount, 5); assert.equal(result.steps.length, 5);
  assert.equal(result.history.before.rows, 2); assert.equal(result.history.after.rows, 7);
  assert.equal(result.history.priorProjectionUnchanged, true);
  assert.equal(JSON.stringify(a.native.find(value => value.id === old.id)), original);
  assert.equal(a.native.filter(value => value.migration_name === names[1]).length, 2);
});

test('Linux root publication is immutable, exact-retry idempotent and creates a new leaf for changed owned phase',
  { skip: process.platform !== 'linux' || process.getuid?.() !== 0 }, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-owned-inspection-')); fs.chmodSync(directory, 0o700);
    const owner = { deploymentId: 'deployment_test_123', releaseId: 'release_test_123' };
    const receipt = { format: 'sabalan-verified-historical-inspection/v1', classification: 'VERIFIED_HISTORICAL_INSPECTION',
      ...owner, nativeExecutionClaimed: false, originalLogsIsNull: true, checkpointChecksum: 'a'.repeat(64),
      baselineCheckpoint: { independentlyRestored: true },
      currentCheckpoint: { ...owner, checksum: 'a'.repeat(64), independentRestoreClaimed: false }, ownedExtensions: [] as string[] };
    try {
      const first = persistHistoricalInspection(receipt, owner, directory), before = fs.readFileSync(first.file), inode = fs.statSync(first.file).ino;
      assert.equal(fs.statSync(first.file).mode & 0o777, 0o400);
      assert.deepEqual(persistHistoricalInspection(receipt, owner, directory), first);
      assert.equal(fs.statSync(first.file).ino, inode);
      const following = persistHistoricalInspection({ ...receipt, ownedExtensions: ['owned_extension'] }, owner, directory);
      assert.notEqual(following.file, first.file); assert.deepEqual(fs.readFileSync(first.file), before);
      fs.chmodSync(first.file, 0o600); fs.writeFileSync(first.file, Buffer.alloc(before.length)); fs.chmodSync(first.file, 0o400);
      assert.throws(() => persistHistoricalInspection(receipt, owner, directory), /ARTIFACT_CHANGED/);
    } finally { fs.rmSync(directory, { recursive: true, force: true }); }
  });

test('publication preserves explicit partial QA classification and refuses production relabelling or future cleanup', () => {
  const owner = { deploymentId: 'deployment_qa_123', releaseId: 'release_qa_123' };
  const qa = { format: 'sabalan-verified-historical-inspection/v1', classification: 'VERIFIED_RESTORED_QA_HISTORICAL_INSPECTION',
    ...owner, originalLogsIsNull: true, nativeExecutionClaimed: false, checkpointChecksum: 'a'.repeat(64),
    currentCheckpoint: { ...owner, checksum: 'a'.repeat(64), independentRestoreClaimed: false },
    baselineCheckpoint: { independentlyRestored: false }, inspectionTarget: 'RESTORED_QA', productionAdmission: false,
    independentPointHealthy: false, cleanupPending: true, outerOwnerPhase: 'CALLBACK_ACTIVE', restoreOriginalKind: 'PG_RESTORE_CHILD',
    sourceDatabase: { name: 'production', oid: '123', systemIdentifier: '456' },
    database: { name: 'restored_qa', oid: '321', systemIdentifier: '654' }, sourceReceiptSha256: 'b'.repeat(64), nativeProofSha256: 'c'.repeat(64) };
  assert.doesNotThrow(() => validateHistoricalInspectionPublication(qa, owner));
  for (const mutate of [
    (v: any) => { v.classification = 'VERIFIED_HISTORICAL_INSPECTION'; }, (v: any) => { v.productionAdmission = true; },
    (v: any) => { v.independentPointHealthy = true; }, (v: any) => { v.cleanupPending = false; },
    (v: any) => { v.outerOwnerPhase = 'CLOSED'; }, (v: any) => { v.database = v.sourceDatabase; },
  ]) { const changed = structuredClone(qa); mutate(changed); assert.throws(() => validateHistoricalInspectionPublication(changed, owner)); }
});

test('production prerequisite refusal occurs after full compile and BEFORE inspection or any DDL',async()=>{
 for(const reason of ['MISSING_FINANCIAL_CERT','FORGED_ACCEPTANCE','SOURCE_DB_CHANGED','CURRENT_CHECKPOINT_CHANGED']){
  const a=adapter();const runtime={...a.runtime,async assertQualifiedPending(){throw Error(reason);}};
  await assert.rejects(runDeploymentOwnedMigrations(a.catalog,runtime),new RegExp(reason));assert.deepEqual(a.calls,['authority']);
 }
});
