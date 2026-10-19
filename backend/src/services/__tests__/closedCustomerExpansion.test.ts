import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileClosedCustomerExpansion } from '../closedCustomerExpansion';
import { compileProtectedBridgeMigration } from '../protectedBridgeMigrations';

const names = [
  '20261014150000_customer_opening_review',
  '20261014151000_customer_credit_settlement_source',
  '20261014152000_customer_receipt_components',
  '20261014153000_customer_receipt_adjustments',
  '20261014154000_customer_check_bank_outcomes',
  '20261014155000_customer_command_and_attribution',
  '20261014160000_customer_legacy_receipt_resolution',
  '20261019010000_customer_semantic_barrier',
];
const source = () => names.map(name => ({ name,
  bytes: fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql')) }));

test('closed financial expansion requires the complete ordered byte-exact batch before producing a rehearsal program', () => {
  const files = source();
  const program = compileClosedCustomerExpansion(files);
  assert.equal(program.migrations.length, 8);
  assert.equal(program.productionAdmission, false);
  assert.match(program.sql, /^DO \$closed_customer_expansion\$/);
  assert.ok(Object.isFrozen(program) && Object.isFrozen(program.migrations));
  for (const input of [files.slice(0, 7), [...files].reverse(), [...files, files[0]],
    files.map((file, index) => index === 7 ? { ...file, bytes: Buffer.concat([file.bytes, Buffer.from('\n')]) } : file)]) {
    assert.throws(() => compileClosedCustomerExpansion(input), /CUSTOMER_EXPANSION_SOURCE_UNPROVEN/);
  }
  for (const file of files) assert.throws(() => compileProtectedBridgeMigration(file.name, file.bytes), /MIGRATION_UNSUPPORTED/);
});
