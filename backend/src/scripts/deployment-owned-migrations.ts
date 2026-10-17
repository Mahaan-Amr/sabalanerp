import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma, disconnectDatabase } from '../lib/prisma';
import { assertProtectedBridgeMigrationAuthority, compileProtectedBridgeMigration, applyProtectedBridgeMigration } from '../services/protectedBridgeMigrations';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const required = (key: string) => {
  const value = process.env[key];
  if (!value || value.length > 256) fail('PROTECTED_MIGRATION_OWNER_REQUIRED');
  return value!;
};

async function main() {
  if (process.argv.length !== 2) fail('PROTECTED_MIGRATION_ARGUMENTS_UNSUPPORTED');
  const owner = Object.freeze({ deploymentId: required('DEPLOYMENT_ID'), releaseId: required('DEPLOYMENT_RELEASE_ID'),
    leaseToken: required('DEPLOYMENT_LEASE_TOKEN') });
  await assertProtectedBridgeMigrationAuthority(prisma, owner);
  const directory = path.resolve(__dirname, '../../prisma/migrations');
  const files = new Map(fs.readdirSync(directory, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => {
    if (!/^\d{14}_[a-zA-Z0-9_]+$/.test(entry.name)) fail('PROTECTED_MIGRATION_SOURCE_NAME_INVALID');
    return [entry.name, fs.readFileSync(path.join(directory, entry.name, 'migration.sql'))] as const;
  }));
  const history = await prisma.$queryRaw<Array<{ name: string; checksum: string; finished: Date | null; rolledBack: Date | null }>>`
    SELECT migration_name AS name,checksum,finished_at AS finished,rolled_back_at AS "rolledBack" FROM public._prisma_migrations`;
  const applied = new Set<string>();
  for (const row of history) {
    if (row.rolledBack) continue;
    const bytes = files.get(row.name);
    if (!row.finished || applied.has(row.name) || !bytes || createHash('sha256').update(bytes).digest('hex') !== row.checksum) {
      fail('PROTECTED_MIGRATION_HISTORY_REQUIRES_INSPECTION');
    }
    applied.add(row.name);
  }
  // Compile EVERY pending file before the first DDL. An unreviewed later file
  // cannot cause a partially completed bridge followed by an unsafe fallback.
  const pending = [...files].filter(([name]) => !applied.has(name)).sort(([a], [b]) => a.localeCompare(b));
  for (const [name, bytes] of pending) compileProtectedBridgeMigration(name, bytes);
  for (const [name, bytes] of pending) {
    const result = await applyProtectedBridgeMigration(prisma, owner, name, bytes);
    console.log(JSON.stringify({ migration: name, ...result }));
  }
  await assertProtectedBridgeMigrationAuthority(prisma, owner);
  console.log(JSON.stringify({ protectedMigrationsCompleted: true, pendingCount: pending.length }));
}

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROTECTED_MIGRATION_FAILED' }));
  process.exitCode = 1;
}).finally(disconnectDatabase);
