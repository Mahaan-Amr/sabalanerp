import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { prisma, disconnectDatabase } from '../lib/prisma';

const fail = (code: string): never => { throw Object.assign(new Error(code), { code }); };
const required = (key: string) => {
  const value = process.env[key];
  if (!value || value.length > 256) fail('PROTECTED_MIGRATION_OWNER_REQUIRED');
  return value!;
};

async function main() {
  const verifyCurrent = process.argv.length === 3 && process.argv[2] === '--verify-current';
  if (!verifyCurrent && process.argv.length !== 2) fail('PROTECTED_MIGRATION_ARGUMENTS_UNSUPPORTED');
  const authority = verifyCurrent ? null : {
    owner: Object.freeze({ deploymentId: required('DEPLOYMENT_ID'), releaseId: required('DEPLOYMENT_RELEASE_ID'),
      leaseToken: required('DEPLOYMENT_LEASE_TOKEN') }),
    migrations: await import('../services/protectedBridgeMigrations'),
  };
  if (authority) await authority.migrations.assertProtectedBridgeMigrationAuthority(prisma, authority.owner);
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
  const pending = [...files].filter(([name]) => !applied.has(name)).sort(([a], [b]) => a.localeCompare(b));
  if (!authority) {
    if (pending.length) fail('PROTECTED_MIGRATION_CURRENT_LEDGER_INCOMPLETE');
    console.log(JSON.stringify({ protectedMigrationLedgerCurrent: true, appliedCount: applied.size }));
    return;
  }
  const { owner, migrations } = authority;
  const { protectedCurrentReleaseNames, compileProtectedCurrentRelease, applyProtectedCurrentRelease,
    assertProtectedBridgeMigrationAuthority } = migrations;
  // The entire pinned current release is compiled before the first DDL.
  // The old Oct14 migration is historical native history on the retained
  // production state; it is not retroactively given a bridge receipt.
  if (pending.some(([name]) => !protectedCurrentReleaseNames.includes(name))) fail('PROTECTED_CURRENT_RELEASE_SET_UNPROVEN');
  const release = compileProtectedCurrentRelease(protectedCurrentReleaseNames.map(name => {
    const bytes = files.get(name);
    if (!bytes) fail('PROTECTED_CURRENT_RELEASE_SET_UNPROVEN');
    return [name, bytes!] as const;
  }));
  const result = await applyProtectedCurrentRelease(prisma, owner, release, applied);
  console.log(JSON.stringify({ protectedCurrentRelease: result }));
  await assertProtectedBridgeMigrationAuthority(prisma, owner);
  console.log(JSON.stringify({ protectedMigrationsCompleted: true, pendingCount: pending.length }));
}

main().catch((error: any) => {
  console.error(JSON.stringify({ ok: false, code: error?.code || 'PROTECTED_MIGRATION_FAILED' }));
  process.exitCode = 1;
}).finally(disconnectDatabase);
