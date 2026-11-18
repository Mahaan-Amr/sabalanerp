import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';

const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const sourceTarget = new URL(sourceDatabaseUrl);
assert.equal(sourceTarget.hostname, '127.0.0.1');
assert.equal(sourceTarget.port, '55432');
assert.equal(sourceTarget.pathname, '/sabalanerp');

const run = async () => {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl, schemaOnly: true, referenceDataTables: ["departments", "products"] });
  const client = database.client();
  try {
    const migrations = await client.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const name of ['20261118120000_personal_pickup_source', '20261118120100_personal_pickup_dispatch']) {
      assert.ok(migrations.some(row => row.migration_name === name), `Missing pickup migration ${name}`);
    }
    for (const scenario of ['personalLoadingPickup.integration.test.ts', 'dispatchPickupVerification.integration.test.ts']) {
      execFileSync(process.execPath, [require.resolve('tsx/cli'), `src/services/__tests__/${scenario}`], {
        cwd: path.join(repositoryRoot, 'backend'), env: { ...process.env, DATABASE_URL: database.databaseUrl },
        stdio: 'inherit', timeout: 120_000,
      });
    }
    console.log(`Personal pickup candidate passed in ${database.databaseName} with ${migrations.length} applied migrations.`);
  } finally {
    await client.$disconnect();
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        await database.cleanup();
        break;
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('still has sessions or prepared transactions')
          || attempt === 11) throw error;
        // A full-data clone can trigger autovacuum after the test clients disconnect.
        await new Promise(resolve => setTimeout(resolve, 5_000));
      }
    }
    console.log(`Temporary database ${database.databaseName} removed.`);
  }
};

run().catch(error => { console.error(error); process.exitCode = 1; });
