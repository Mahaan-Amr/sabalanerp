import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProtectedBootstrapSource } from '../protectedBootstrapMigrations';
import baseline from '../protectedBootstrapBaseline.json';
import { protectedBridgeMigrationNames } from '../protectedBridgeMigrations';

test('bootstrap freezes all historical bytes and excludes the two owned bridge steps', () => {
  const directory = path.resolve(__dirname, '../../../prisma/migrations');
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-bootstrap-source-test-'));
  try {
    // Exercise the reviewed historical prefix independently of newer source
    // migrations. New source is not permission to broaden bootstrap authority.
    for (const name of [...baseline.migrations.map(row => row.name), ...protectedBridgeMigrationNames]) {
      fs.mkdirSync(path.join(staging, name));
      fs.copyFileSync(path.join(directory, name, 'migration.sql'), path.join(staging, name, 'migration.sql'));
    }
    const files = compileProtectedBootstrapSource(staging);
    assert.equal(files.length, 425);
    assert.ok(files.every(row => !row.name.startsWith('2026101412') && !row.name.startsWith('2026101414')));
    const file = path.join(staging, files[0].name, 'migration.sql');
    fs.appendFileSync(file, '\n-- changed historical identity');
    assert.throws(() => compileProtectedBootstrapSource(staging), /SQL_IDENTITY_MISMATCH/);
    fs.writeFileSync(file, files[0].bytes);
    fs.mkdirSync(path.join(staging, '29990101000000_unreviewed'));
    assert.throws(() => compileProtectedBootstrapSource(staging), /SOURCE_UNSUPPORTED/);
  } finally {
    assert.equal(path.dirname(staging), os.tmpdir());
    assert.ok(path.basename(staging).startsWith('sabalan-bootstrap-source-test-'));
    fs.rmSync(staging, { recursive: true });
  }
});

test('new accounting migrations cannot silently enter the reviewed bootstrap prefix', () => {
  const directory = path.resolve(__dirname, '../../../prisma/migrations');
  assert.throws(() => compileProtectedBootstrapSource(directory), /SOURCE_UNSUPPORTED/);
});
