import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { compileProtectedBootstrapSource } from '../protectedBootstrapMigrations';

test('bootstrap freezes all historical bytes and excludes the two owned bridge steps', () => {
  const directory = path.resolve(__dirname, '../../../prisma/migrations');
  const files = compileProtectedBootstrapSource(directory);
  assert.equal(files.length, 425);
  assert.ok(files.every(row => !row.name.startsWith('2026101412') && !row.name.startsWith('2026101414')));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'sabalan-bootstrap-source-test-'));
  try {
    for (const row of fs.readdirSync(directory, { withFileTypes: true }).filter(row => row.isDirectory())) {
      fs.mkdirSync(path.join(staging, row.name));
      fs.copyFileSync(path.join(directory, row.name, 'migration.sql'), path.join(staging, row.name, 'migration.sql'));
    }
    assert.equal(compileProtectedBootstrapSource(staging).length, 425);
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
