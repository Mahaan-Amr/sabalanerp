import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { ChildProcess } from 'node:child_process';

export type NativeRecoveryLedgerRow = {
  id: string; migration_name: string; checksum: string;
  finished_at: string | null; rolled_back_at: string | null;
  applied_steps_count: number; logs_bytes: number; logs_sha256: string;
  full_row_sha256: string; protected_bridge_logs: string | null;
};

/** The standalone original authenticates these private source bytes. A digest
 * supplied here is a comparison binding, never proof of its own provenance. */
export type NativeRecoveryLedgerExpectation = {
  format: 'sabalan-native-complete-ledger439-expectation/v1';
  sourceReceiptSha256: string;
  ledgerRows: NativeRecoveryLedgerRow[];
  sourceCatalog: { applicationCommit: string; migrationFiles: Array<{ name: string; sha256: string; bytes: number }> };
};

const pending = [
  '20261014140000_online_deployment_control', '20261019010000_customer_semantic_barrier',
  '20261019020000_hr_versioned_file_cleanup', '20261020010000_online_realtime_completion',
  '20261020093000_online_serving_epochs',
];
const hex = /^[a-f0-9]{64}$/;
const rowKeys = ['id', 'migration_name', 'checksum', 'finished_at', 'rolled_back_at',
  'applied_steps_count', 'logs_bytes', 'logs_sha256', 'full_row_sha256', 'protected_bridge_logs'] as const;
const sha = (raw: string | Buffer) => createHash('sha256').update(raw).digest('hex');

export function validateNativeRecoveryExpectation(expected: NativeRecoveryLedgerExpectation) {
  assert.equal(expected.format, 'sabalan-native-complete-ledger439-expectation/v1');
  assert.match(expected.sourceReceiptSha256, hex);
  assert.equal(expected.ledgerRows.length, 440);
  assert.equal(expected.sourceCatalog.applicationCommit, '45cab522a285b878b60f537d09d0962912bba096');
  assert.equal(expected.sourceCatalog.migrationFiles.length, 444);
  const catalog = new Map<string, string>();
  for (const file of expected.sourceCatalog.migrationFiles) {
    assert.match(file.name, /^\d{12,14}_[a-zA-Z0-9_]+$/); assert.match(file.sha256, hex);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
    assert.ok(!catalog.has(file.name)); catalog.set(file.name, file.sha256);
  }
  const ids = new Set<string>(), active = new Set<string>();
  let rolledBack = 0;
  for (const row of expected.ledgerRows) {
    assert.deepEqual(Object.keys(row).sort(), [...rowKeys].sort());
    assert.ok(typeof row.id === 'string' && row.id.length > 0 && !ids.has(row.id)); ids.add(row.id);
    assert.match(row.migration_name, /^\d{12,14}_[a-zA-Z0-9_]+$/);
    for (const key of ['checksum', 'logs_sha256', 'full_row_sha256'] as const) assert.match(row[key], hex);
    assert.ok(Number.isSafeInteger(row.applied_steps_count) && row.applied_steps_count >= 0);
    assert.ok(Number.isSafeInteger(row.logs_bytes) && row.logs_bytes >= 0);
    assert.ok(row.finished_at === null || typeof row.finished_at === 'string');
    assert.ok(row.rolled_back_at === null || typeof row.rolled_back_at === 'string');
    assert.ok(row.protected_bridge_logs === null || typeof row.protected_bridge_logs === 'string');
    if (row.rolled_back_at !== null) {
      rolledBack += 1;
      assert.equal(row.migration_name, '20260720000100_security_report_attendance_operations');
    } else {
      assert.notEqual(row.finished_at, null); assert.ok(!active.has(row.migration_name));
      active.add(row.migration_name); assert.equal(catalog.get(row.migration_name), row.checksum);
    }
  }
  assert.equal(active.size, 439); assert.equal(rolledBack, 1);
  assert.deepEqual([...catalog.keys()].filter(name => !active.has(name)).sort(), pending);
}

// The digest is PostgreSQL's native JSONB row representation, including IDs,
// timestamps, NULL logs and rollback records. Never round-trip it through JS dates.
export const nativeRecoveryLedgerQuery = `SELECT json_build_object(
  'database', json_build_object('name', current_database(), 'oid', (SELECT oid::text FROM pg_database WHERE datname=current_database()), 'systemIdentifier', (SELECT system_identifier::text FROM pg_control_system())),
  'ledger', (SELECT coalesce(json_agg(t ORDER BY migration_name,id),'[]'::json) FROM
    (SELECT id,migration_name,checksum,finished_at::text,rolled_back_at::text,applied_steps_count,
      octet_length(coalesce(logs,'')) AS logs_bytes,
      encode(sha256(convert_to(coalesce(logs,''),'UTF8')),'hex') AS logs_sha256,
      encode(sha256(convert_to(to_jsonb(_prisma_migrations)::text,'UTF8')),'hex') AS full_row_sha256,
      CASE WHEN migration_name IN ('20261014120000_hr_vehicle_assignment_plans','20261014140000_online_deployment_control') AND octet_length(coalesce(logs,''))<=65536 THEN logs ELSE NULL END AS protected_bridge_logs
    FROM public._prisma_migrations) t),
  'rawHistoryJson', (SELECT coalesce(json_agg(h ORDER BY migration_name,id),'[]'::json)::text FROM public._prisma_migrations h),
  'hrBridgeRowJson', (SELECT row_to_json(h)::text FROM public._prisma_migrations h WHERE migration_name='20261014120000_hr_vehicle_assignment_plans' AND finished_at IS NOT NULL AND rolled_back_at IS NULL)
)::text AS value`;

type ReadClient = {
  $executeRawUnsafe(query: string): Promise<unknown>;
  $queryRawUnsafe<T>(query: string): Promise<T>;
};
export type NativeRecoveryDatabaseIdentity = { name: string; oid: string; systemIdentifier: string };

export async function inspectNativeRecoveryLedger(client: ReadClient, expected: NativeRecoveryLedgerExpectation,
  database: NativeRecoveryDatabaseIdentity) {
  validateNativeRecoveryExpectation(expected);
  await client.$executeRawUnsafe('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.$executeRawUnsafe('SET LOCAL statement_timeout=10000');
  await client.$executeRawUnsafe('SET LOCAL lock_timeout=1000');
  const rows = await client.$queryRawUnsafe<Array<{ value: string }>>(nativeRecoveryLedgerQuery);
  assert.equal(rows.length, 1); assert.ok(Buffer.byteLength(rows[0].value) <= 8 * 1024 * 1024);
  const actual = JSON.parse(rows[0].value) as { database: NativeRecoveryDatabaseIdentity;
    ledger: NativeRecoveryLedgerRow[]; rawHistoryJson: string; hrBridgeRowJson: string };
  assert.deepEqual(actual.database, database); assert.equal(actual.ledger.length, 440);
  const selected = new Map(expected.ledgerRows.map(row => [row.id, row]));
  const observedIds = new Set<string>();
  for (const row of actual.ledger) {
    assert.ok(!observedIds.has(row.id)); observedIds.add(row.id);
    const original = selected.get(row.id); assert.ok(original, 'RESTORED_NATIVE_LEDGER_ROW_UNKNOWN');
    assert.deepEqual(Object.keys(row).sort(), [...rowKeys].sort());
    for (const key of rowKeys) assert.deepEqual(row[key], original[key], `RESTORED_NATIVE_LEDGER_${key}_CHANGED`);
  }
  assert.equal(typeof actual.rawHistoryJson, 'string'); assert.equal(JSON.parse(actual.rawHistoryJson).length, 440);
  assert.equal(typeof actual.hrBridgeRowJson, 'string');
  const hr = JSON.parse(actual.hrBridgeRowJson);
  assert.equal(hr.migration_name, '20261014120000_hr_vehicle_assignment_plans');
  const hrExpected = expected.ledgerRows.filter(row => row.migration_name === hr.migration_name && row.rolled_back_at === null);
  assert.equal(hrExpected.length, 1); assert.equal(hr.id, hrExpected[0].id); assert.equal(hr.checksum, hrExpected[0].checksum);
  return {
    format: 'sabalan-private-native-complete-ledger439-proof/v1' as const,
    database, sourceReceiptSha256: expected.sourceReceiptSha256,
    nativeRowsCompared: 440, activeRows: 439, rollbackRows: 1,
    sourceCatalogMigrations: 444, pendingMigrations: [...pending],
    rawHistoryJson: actual.rawHistoryJson, rawHistorySha256: sha(actual.rawHistoryJson),
    hrBridgeRowJson: actual.hrBridgeRowJson, hrBridgeRowSha256: sha(actual.hrBridgeRowJson),
    sourceAuthorityAuthenticated: false, cleanupPending: true, productionAdmission: false,
  };
}

export type NativeRecoveryOriginal = {
  format: 'sabalan-owned-native-recovery-command/v1'; originalPid: number | null;
  code: number | null; signal: NodeJS.Signals | null;
  stdoutEof: boolean; stderrEof: boolean; killed: boolean;
  stdoutBytes: number; stderrBytes: number; stdoutSha256: string; stderrSha256: string;
};

/** Retains the promisified execFile's SAME original handle even when its promise
 * rejects before close. Callers receive honest negative closure evidence. */
export async function observeNativeRecoveryOriginal(execution: Promise<{ stdout: Buffer; stderr: Buffer }> & { child: ChildProcess }) {
  const child = execution.child;
  const closed = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(resolve =>
    child.once('close', (code, signal) => resolve({ code, signal })));
  let result: { stdout: Buffer; stderr: Buffer } | undefined, failure: unknown;
  let observationFailed = false;
  try { result = await execution; } catch (error) { observationFailed = true; failure = error; }
  const end = await closed;
  const failedOutput = failure as { stdout?: Buffer; stderr?: Buffer } | undefined;
  const stdout = result?.stdout ?? failedOutput?.stdout ?? Buffer.alloc(0);
  const stderr = result?.stderr ?? failedOutput?.stderr ?? Buffer.alloc(0);
  const original: NativeRecoveryOriginal = {
    format: 'sabalan-owned-native-recovery-command/v1', originalPid: child.pid ?? null,
    code: end.code, signal: end.signal, stdoutEof: child.stdout?.readableEnded === true,
    stderrEof: child.stderr?.readableEnded === true, killed: child.killed,
    stdoutBytes: stdout.length, stderrBytes: stderr.length, stdoutSha256: sha(stdout), stderrSha256: sha(stderr),
  };
  if (observationFailed || original.code !== 0 || original.signal !== null || original.killed
    || !original.stdoutEof || !original.stderrEof || !original.originalPid) {
    throw Object.assign(new Error('The original recovery command failed or its closure is unproven.'), {
      code: 'RECOVERY_NATIVE_ORIGINAL_UNQUALIFIED', nativeRecoveryOriginal: original,
    });
  }
  return { stdout, stderr, original };
}

export function recoveryDatabaseObservationQuery(name: string) {
  assert.match(name, /^sabalan_checkpoint_verify_[a-f0-9]{12}$/);
  return `SELECT json_build_object('visible', current_setting('is_superuser')='on' OR pg_has_role(current_user,'pg_read_all_stats','MEMBER'),
    'name','${name}','oid',(SELECT oid::text FROM pg_database WHERE datname='${name}'),
    'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
    'sessions',(SELECT count(*) FROM pg_stat_activity WHERE datname='${name}'),
    'transactions',(SELECT count(*) FROM pg_stat_activity WHERE datname='${name}' AND (xact_start IS NOT NULL OR backend_xid IS NOT NULL)),
    'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database='${name}'))::text`;
}

export function assertNativeRecoveryDatabaseQuiet(observation: Record<string, unknown>, identity: NativeRecoveryDatabaseIdentity) {
  assert.equal(observation.visible, true);
  for (const key of ['name', 'oid', 'systemIdentifier'] as const) assert.equal(observation[key], identity[key]);
  for (const key of ['sessions', 'transactions', 'prepared']) assert.equal(observation[key], 0);
}
