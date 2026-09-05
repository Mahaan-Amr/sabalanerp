import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const sha256 = value => createHash('sha256').update(value).digest('hex');

export function fingerprintMigrationEntries(entries) {
  const ordered = [...entries]
    .map(({ name, checksum }) => ({ name, checksum }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const payload = [
    'sabalan-prisma-migration-set/v1',
    ...ordered.map(({ name, checksum }) => `${name}\0${checksum}`),
    '',
  ].join('\n');
  return { count: ordered.length, sha256: sha256(payload), entries: ordered };
}

export async function fingerprintRepositoryMigrations(repositoryRoot) {
  const migrationsRoot = path.join(repositoryRoot, 'backend', 'prisma', 'migrations');
  const directories = (await readdir(migrationsRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort();
  const entries = await Promise.all(directories.map(async name => ({
    name,
    checksum: sha256(await readFile(path.join(migrationsRoot, name, 'migration.sql'))),
  })));
  return fingerprintMigrationEntries(entries);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const repositoryRoot = path.resolve(process.argv[2] || fileURLToPath(new URL('../../../..', import.meta.url)));
  const result = await fingerprintRepositoryMigrations(repositoryRoot);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
