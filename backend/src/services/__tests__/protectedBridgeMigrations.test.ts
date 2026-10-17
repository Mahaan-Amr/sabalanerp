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
