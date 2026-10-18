import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { compileProtectedBridgeMigration } from '../protectedBridgeMigrations';

test('protected bootstrap accepts only the reviewed complete SQL bytes, including original comments and line endings', () => {
  for (const name of ['20261014120000_hr_vehicle_assignment_plans', '20261014140000_online_deployment_control']) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'));
    assert.equal(compileProtectedBridgeMigration(name, bytes).name, name);
    for (const position of [0, Math.floor(bytes.length / 2), bytes.length - 1]) {
      const changed = Buffer.from(bytes); changed[position] ^= 1;
      assert.throws(() => compileProtectedBridgeMigration(name, changed), /SQL_IDENTITY_MISMATCH/);
    }
    for (const changed of [Buffer.concat([bytes, Buffer.from('\nDROP TABLE users;')]), bytes.subarray(0, bytes.length - 1),
      Buffer.from(bytes.toString().replace(/\n/g, '\r\n'))]) {
      assert.throws(() => compileProtectedBridgeMigration(name, changed), /SQL_IDENTITY_MISMATCH/);
    }
  }
  for (const name of ['toString', '__proto__', '20261014140001_other', '../20261014140000_online_deployment_control']) {
    assert.throws(() => compileProtectedBridgeMigration(name, Buffer.from('CREATE TABLE arbitrary (id text)')), /MIGRATION_UNSUPPORTED/);
  }
});

test('the seven new accounting migrations have no implicit protected bridge authority', () => {
  const names = [
    '20261014150000_customer_opening_review',
    '20261014151000_customer_credit_settlement_source',
    '20261014152000_customer_receipt_components',
    '20261014153000_customer_receipt_adjustments',
    '20261014154000_customer_check_bank_outcomes',
    '20261014155000_customer_command_and_attribution',
    '20261014160000_customer_legacy_receipt_resolution',
  ];
  for (const name of names) {
    const bytes = fs.readFileSync(path.resolve(__dirname, '../../../prisma/migrations', name, 'migration.sql'));
    assert.throws(() => compileProtectedBridgeMigration(name, bytes), /MIGRATION_UNSUPPORTED/);
  }
});
