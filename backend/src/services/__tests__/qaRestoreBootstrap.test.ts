import assert from 'node:assert/strict';
import test from 'node:test';
import { assertQaRestoreBootstrap } from '../qaRestoreBootstrap';

const migrations = ['20250917200442_first_migtration', '20260909100000_performance_retention_erasure'];
const emptyCounts = { users: 0, sales_contracts: 0, accounting_financial_records: 0,
  dispatch_document_artifacts: 0, performance_encrypted_payloads: 0, performance_erasure_operations: 0 };

test('admits a fully migrated empty-data QA target so canonical safety replay can query erasure operations', () => {
  assert.deepEqual(assertQaRestoreBootstrap(migrations, migrations, emptyCounts), { migrations: 2, erasureOperations: 0 });
});

test('refuses a missing migration, an unreviewed migration, or any existing business data', () => {
  assert.throws(() => assertQaRestoreBootstrap(migrations, migrations.slice(0, 1), emptyCounts), /QA_RESTORE_BOOTSTRAP_SCHEMA_INCOMPLETE/);
  assert.throws(() => assertQaRestoreBootstrap(migrations, [...migrations, 'other'], emptyCounts), /QA_RESTORE_BOOTSTRAP_SCHEMA_INCOMPLETE/);
  assert.throws(() => assertQaRestoreBootstrap(migrations, migrations, { ...emptyCounts, performance_erasure_operations: 1 }), /QA_RESTORE_TARGET_NOT_EMPTY/);
  assert.throws(() => assertQaRestoreBootstrap(migrations, migrations, { ...emptyCounts, users: 1 }), /QA_RESTORE_TARGET_NOT_EMPTY/);
});
