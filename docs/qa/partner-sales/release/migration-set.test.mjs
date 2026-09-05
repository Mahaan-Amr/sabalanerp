import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  fingerprintMigrationEntries,
  fingerprintRepositoryMigrations,
} from './migration-set.mjs';

test('fingerprint is ordered and changes for migration identity or content', () => {
  const first = fingerprintMigrationEntries([
    { name: '002_second', checksum: 'b'.repeat(64) },
    { name: '001_first', checksum: 'a'.repeat(64) },
  ]);
  const reordered = fingerprintMigrationEntries([...first.entries].reverse());
  const changed = fingerprintMigrationEntries([
    first.entries[0],
    { ...first.entries[1], checksum: 'c'.repeat(64) },
  ]);

  assert.equal(first.count, 2);
  assert.equal(first.sha256, reordered.sha256);
  assert.notEqual(first.sha256, changed.sha256);
  assert.deepEqual(first.entries.map(entry => entry.name), ['001_first', '002_second']);
});

test('repository fingerprint hashes the exact migration.sql bytes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'sabalan-migrations-'));
  try {
    const migrations = path.join(root, 'backend', 'prisma', 'migrations');
    await mkdir(path.join(migrations, '001_first'), { recursive: true });
    await mkdir(path.join(migrations, '002_second'), { recursive: true });
    await writeFile(path.join(migrations, '001_first', 'migration.sql'), 'SELECT 1;\n');
    await writeFile(path.join(migrations, '002_second', 'migration.sql'), 'SELECT 2;\n');

    const result = await fingerprintRepositoryMigrations(root);
    assert.equal(result.count, 2);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);

    await writeFile(path.join(migrations, '002_second', 'migration.sql'), 'SELECT 3;\n');
    assert.notEqual((await fingerprintRepositoryMigrations(root)).sha256, result.sha256);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
