import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertNativeRecoveryDatabaseQuiet, inspectNativeRecoveryLedger, nativeRecoveryLedgerQuery,
  observeNativeRecoveryOriginal, recoveryDatabaseObservationQuery, validateNativeRecoveryExpectation,
  type NativeRecoveryLedgerExpectation } from '../nativeRecoveryLedgerProof';

const sha = (text: string) => createHash('sha256').update(text).digest('hex');
const db = { name: 'sabalan_checkpoint_verify_abcdef012345', oid: '123', systemIdentifier: '456' };
function fixture() {
  // These are deliberately synthetic comparison values, never production or
  // PostgreSQL execution evidence. Real PostgreSQL coverage belongs to the drill.
  const pending = ['20261014140000_online_deployment_control', '20261019010000_customer_semantic_barrier',
    '20261019020000_hr_versioned_file_cleanup', '20261020010000_online_realtime_completion', '20261020093000_online_serving_epochs'];
  const names = ['20261014120000_hr_vehicle_assignment_plans', '20260720000100_security_report_attendance_operations',
    ...Array.from({ length: 437 }, (_, i) => `20260101000000_fixture_${i}`)];
  const rows = [...names, names[1]].map((name, i) => ({ id: `synthetic-${i}`, migration_name: name, checksum: sha(name),
    finished_at: i === 439 ? null : '2026-10-24 01:02:03.123456+00', rolled_back_at: i === 439 ? '2026-10-24 02:03:04.123456+00' : null,
    applied_steps_count: i === 439 ? 0 : 1, logs_bytes: 0, logs_sha256: sha(''), full_row_sha256: sha('opaque PG-native row:' + i), protected_bridge_logs: null }));
  const expected: NativeRecoveryLedgerExpectation = { format: 'sabalan-native-complete-ledger439-expectation/v1', sourceReceiptSha256: sha('synthetic source'),
    ledgerRows: rows, sourceCatalog: { applicationCommit: '45cab522a285b878b60f537d09d0962912bba096',
      migrationFiles: [...names, ...pending].map(name => ({ name, sha256: sha(name), bytes: 1 })) } };
  const actual = { database: db, ledger: structuredClone(rows), rawHistoryJson: '[\n' + rows.map(row => JSON.stringify(row)).join(',\n') + '\n]',
    hrBridgeRowJson: '{ "id":"synthetic-0", "migration_name":"' + names[0] + '", "checksum":"' + sha(names[0]) + '", "logs":null }' };
  return { expected, actual };
}
async function inspect(value = fixture()) {
  const queries: string[] = [];
  const client = { $executeRawUnsafe: async (sql: string) => { queries.push(sql); },
    $queryRawUnsafe: async <T>(sql: string) => { assert.equal(sql, nativeRecoveryLedgerQuery); return [{ value: JSON.stringify(value.actual) }] as T; } };
  return { proof: await inspectNativeRecoveryLedger(client, value.expected, db), queries };
}
test('native comparison preserves the exact private raw history/HR strings and stays explicitly partial', async () => {
  const f = fixture(), { proof, queries } = await inspect(f);
  assert.equal(proof.rawHistoryJson, f.actual.rawHistoryJson); assert.equal(proof.rawHistorySha256, sha(f.actual.rawHistoryJson));
  assert.equal(proof.hrBridgeRowJson, f.actual.hrBridgeRowJson); assert.equal(proof.hrBridgeRowSha256, sha(f.actual.hrBridgeRowJson));
  assert.equal(proof.sourceAuthorityAuthenticated, false); assert.equal(proof.cleanupPending, true); assert.equal(proof.productionAdmission, false);
  assert.equal(proof.nativeRowsCompared, 440); assert.equal(proof.pendingMigrations.length, 5);
  assert.deepEqual(queries, ['SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY', 'SET LOCAL statement_timeout=10000', 'SET LOCAL lock_timeout=1000']);
  assert.ok(nativeRecoveryLedgerQuery.includes("sha256(convert_to(to_jsonb(_prisma_migrations)::text,'UTF8'))"));
  assert.ok(nativeRecoveryLedgerQuery.includes('row_to_json(h)::text'));
});
test('native whole-row identity rejects timestamp, NULL-log, checksum, missing and substituted rows', async () => {
  for (const key of ['id', 'checksum', 'finished_at', 'rolled_back_at', 'full_row_sha256', 'logs_sha256', 'protected_bridge_logs'] as const) {
    const f = fixture(); (f.actual.ledger[0] as any)[key] = key === 'protected_bridge_logs' ? '' : 'changed';
    await assert.rejects(inspect(f));
  }
  for (const mutation of ['missing', 'duplicate', 'foreign-db', 'hr-row']) {
    const f = fixture();
    if (mutation === 'missing') f.actual.ledger.pop();
    else if (mutation === 'duplicate') f.actual.ledger[439] = structuredClone(f.actual.ledger[0]);
    else if (mutation === 'foreign-db') f.actual.database = { ...db, oid: '999' };
    else f.actual.hrBridgeRowJson = f.actual.hrBridgeRowJson.replace('synthetic-0', 'substitute');
    await assert.rejects(inspect(f));
  }
});
test('expected source selection cannot omit rollback history or change catalog/pending/checksums', () => {
  for (const mutation of ['rollback', 'count', 'catalog', 'pending', 'checksum', 'duplicate']) {
    const { expected } = fixture();
    if (mutation === 'rollback') expected.ledgerRows[439].migration_name = '20260720000100_other';
    else if (mutation === 'count') expected.ledgerRows.pop();
    else if (mutation === 'catalog') expected.sourceCatalog.migrationFiles.pop();
    else if (mutation === 'pending') expected.sourceCatalog.migrationFiles[443].name = '20261020093000_other';
    else if (mutation === 'checksum') expected.sourceCatalog.migrationFiles[0].sha256 = 'f'.repeat(64);
    else expected.ledgerRows[439].id = expected.ledgerRows[0].id;
    assert.throws(() => validateNativeRecoveryExpectation(expected));
  }
});
test('strict retirement demands exact OID, full stats visibility and absolutely quiet SQL', () => {
  const quiet = { ...db, visible: true, sessions: 0, transactions: 0, prepared: 0 };
  assertNativeRecoveryDatabaseQuiet(quiet, db);
  for (const key of ['visible', 'name', 'oid', 'systemIdentifier', 'sessions', 'transactions', 'prepared']) {
    const value = { ...quiet, [key]: key === 'visible' ? false : key === 'sessions' || key === 'transactions' || key === 'prepared' ? 1 : 'changed' };
    assert.throws(() => assertNativeRecoveryDatabaseQuiet(value, db));
  }
  assert.throws(() => recoveryDatabaseObservationQuery('sabalanerp'));
  assert.throws(() => recoveryDatabaseObservationQuery(db.name + "';DROP DATABASE sabalanerp;--"));
});
const run = promisify(execFile);
test('finite real original success exposes its actual PID and both EOFs', async () => {
  const command = run(process.execPath, ['-e', 'process.stdout.write("finite");process.stderr.write("diagnostic")'], { encoding: 'buffer' });
  const result = await observeNativeRecoveryOriginal(command);
  assert.equal(result.original.originalPid, command.child.pid); assert.equal(result.original.code, 0);
  assert.equal(result.original.stdoutEof, true); assert.equal(result.original.stderrEof, true);
  assert.equal(result.original.stdoutSha256, sha('finite')); assert.equal(result.original.stderrSha256, sha('diagnostic'));
});
test('finite real original exit 7 remains negative with genuine closure evidence', async () => {
  await assert.rejects(observeNativeRecoveryOriginal(run(process.execPath, ['-e', 'process.stderr.write("negative");process.exitCode=7'], { encoding: 'buffer' })),
    (error: any) => error.code === 'RECOVERY_NATIVE_ORIGINAL_UNQUALIFIED' && error.nativeRecoveryOriginal.code === 7
      && error.nativeRecoveryOriginal.stdoutEof && error.nativeRecoveryOriginal.stderrEof);
});
test('an early observation rejection retains the same real original to natural close', async () => {
  const command = run(process.execPath, ['-e', 'setTimeout(()=>{},120)'], { encoding: 'buffer' });
  const rejected = Object.assign(Promise.reject(new Error('observation fault')), { child: command.child });
  const start = Date.now();
  await assert.rejects(observeNativeRecoveryOriginal(rejected), (error: any) => error.nativeRecoveryOriginal.originalPid === command.child.pid
    && error.nativeRecoveryOriginal.code === 0 && error.nativeRecoveryOriginal.stdoutEof && error.nativeRecoveryOriginal.stderrEof);
  assert.ok(Date.now() - start >= 80); await command;
});
test('falsy observation rejections remain sticky after the same real original closes normally', async () => {
  for (const failure of [null, undefined]) {
    const command = run(process.execPath, ['-e', 'setTimeout(()=>{},80)'], { encoding: 'buffer' });
    const rejected = Object.assign(Promise.reject(failure), { child: command.child });
    await assert.rejects(observeNativeRecoveryOriginal(rejected), (error: any) => error.code === 'RECOVERY_NATIVE_ORIGINAL_UNQUALIFIED'
      && error.nativeRecoveryOriginal.originalPid === command.child.pid && error.nativeRecoveryOriginal.code === 0
      && error.nativeRecoveryOriginal.stdoutEof && error.nativeRecoveryOriginal.stderrEof);
    await command;
  }
});
