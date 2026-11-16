import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';

const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=2&pool_timeout=10';
const sourceTarget = new URL(sourceDatabaseUrl);
assert.equal(sourceTarget.hostname, '127.0.0.1');
assert.equal(sourceTarget.port, '55432');
assert.equal(sourceTarget.pathname, '/sabalanerp');

const run = async () => {
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const client = database.client();
  try {
    const migrations = await client.$queryRaw<Array<{ migration_name: string }>>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    for (const name of ['20261116100000_customer_pickup_driver_source', '20261116100100_customer_pickup_dispatch']) {
      assert.ok(migrations.some(row => row.migration_name === name), `Missing pickup migration ${name}`);
    }
    execFileSync(process.execPath, [require.resolve('tsx/cli'), 'src/services/__tests__/dispatchPickupVerification.integration.test.ts'], {
      cwd: path.join(repositoryRoot, 'backend'), env: { ...process.env, DATABASE_URL: database.databaseUrl },
      stdio: 'inherit', timeout: 120_000,
    });
    console.log(`Pickup candidate passed in ${database.databaseName} with ${migrations.length} applied migrations.`);
  } finally {
    await client.$disconnect();
    try {
      await database.cleanup();
    } catch (error) {
      if (!(error instanceof Error) || !error.message.includes('still has sessions or prepared transactions')) throw error;
      // The child Prisma process can release its final PostgreSQL session after exit.
      await new Promise(resolve => setTimeout(resolve, 5_000));
      await database.cleanup();
    }
    console.log(`Temporary database ${database.databaseName} removed.`);
  }
};

run().catch(error => { console.error(error); process.exitCode = 1; });
