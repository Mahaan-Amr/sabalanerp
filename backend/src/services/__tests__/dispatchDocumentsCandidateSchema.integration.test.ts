import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { assertDispatchDocumentsMigrationTarget, createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';

const repositoryRoot = path.resolve(process.cwd(), '..');
const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const sourceUrl = new URL(sourceDatabaseUrl);
assert.equal(sourceUrl.pathname, '/sabalanerp');
const checkUrl = new URL(sourceUrl);
checkUrl.pathname = '/sabalanerp_dispatchdocs_0123456789abcdef';
assertDispatchDocumentsMigrationTarget(checkUrl.toString(), 'sabalanerp_dispatchdocs_0123456789abcdef');

const fingerprint = async (client: PrismaClient) => {
  const migrations = await client.$queryRaw<Array<{ migration_name: string; checksum: string }>>`
    SELECT migration_name, checksum FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`;
  const tables = await client.$queryRaw`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`;
  const counts = await client.$queryRaw`SELECT
    (SELECT count(*)::text FROM users) AS users,
    (SELECT count(*)::text FROM personnel) AS personnel,
    (SELECT count(*)::text FROM performance_evaluations) AS evaluations,
    (SELECT count(*)::text FROM performance_export_receipts) AS exports`;
  return { migrations, digest: createHash('sha256').update(JSON.stringify({ migrations, tables, counts })).digest('hex') };
};

const main = async () => {
  const source = new PrismaClient({ datasources: { db: { url: sourceDatabaseUrl } } });
  try {
    const before = await fingerprint(source);
    const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl, schemaOnly: true,
      referenceDataTables: ['hr_workspace_catalogs', 'hr_feature_catalogs', 'hr_responsibility_type_catalogs',
        'performance_disclosure_revision'] });
    const client = database.client();
    try {
      const candidate = await fingerprint(client);
      const expected = readdirSync(path.join(repositoryRoot, 'backend/prisma/migrations'), { withFileTypes: true })
        .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      assert.deepEqual(candidate.migrations.map(row => row.migration_name), expected);
      for (const migration of before.migrations) {
        assert.deepEqual(candidate.migrations.find(row => row.migration_name === migration.migration_name), migration);
      }
      if (process.env.PERFORMANCE_ACCEPTANCE_INJECT_MIGRATION_FAILURE === '1') {
        await assert.rejects(client.$transaction(async (tx) => {
          await tx.$executeRawUnsafe('CREATE TABLE performance_acceptance_failed_migration_probe(id text primary key)');
          await tx.$executeRawUnsafe('INSERT INTO performance_acceptance_missing_migration_table(id) VALUES (\'fail\')');
        }));
        const [rollback] = await client.$queryRaw<Array<{ present: string | null }>>`
          SELECT to_regclass('performance_acceptance_failed_migration_probe')::text AS present`;
        assert.equal(rollback.present, null, 'an interrupted transactional migration must leave no partial schema');
        console.log('PERFORMANCE_FAILURE_INJECTION:migration:PASS');
        console.log(`PERFORMANCE_FAILURE_RECOVERY:${JSON.stringify({ contract: 'PERSONNEL_PERFORMANCE_FAILURE_RECOVERY_V1', scenarios: [
          { name: 'migration', injected: true, failClosed: true, lostAcknowledgedWrites: 0 },
        ] })}`);
      }
      console.log(JSON.stringify({ database: database.databaseName, sourceMigrations: before.migrations.length,
        candidateMigrations: candidate.migrations.length,
        candidateMigrationHash: createHash('sha256').update(JSON.stringify(candidate.migrations)).digest('hex'),
        applied: candidate.migrations.filter(row => !before.migrations.some(old => old.migration_name === row.migration_name)).map(row => row.migration_name) }));
      let failures = 0;
      for (const suite of ['personnelPerformanceFoundation', 'personnelPerformanceDisclosure',
        'personnelPerformanceOperations', 'personnelPerformancePrivacy']) {
        try {
          execFileSync(process.execPath, [require.resolve('tsx/cli'), `src/services/__tests__/${suite}.integration.test.ts`], {
            cwd: path.join(repositoryRoot, 'backend'), env: { ...process.env, DATABASE_URL: database.databaseUrl },
            stdio: 'inherit', timeout: 120_000,
          });
          console.log(`PASS ${suite}`);
        } catch { failures++; console.error(`FAIL ${suite}`); }
      }
      assert.equal(failures, 0, 'Candidate-schema HR suites failed; see individual results.');
    } finally {
      await client.$disconnect();
      await database.cleanup();
      const after = await fingerprint(source);
      assert.deepEqual(after, before, 'Source migration history, table inventory or sampled row counts changed.');
      console.log(`Source preservation fingerprint unchanged: ${after.digest}; temporary clone removed.`);
    }
  } finally { await source.$disconnect(); }
};

main().catch(error => { console.error(error); process.exitCode = 1; });
