import assert from 'node:assert/strict';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { createTemporaryConcurrencyDatabase } from './database';

const run = async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, 'DATABASE_URL must target sabalanerp-local');
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const database = await createTemporaryConcurrencyDatabase({ repositoryRoot, sourceDatabaseUrl });
  const first = database.client();
  const second = database.client();
  try {
    const [[firstDatabase], [secondDatabase]] = await Promise.all([
      first.$queryRawUnsafe<Array<{ database: string }>>('SELECT current_database() AS database'),
      second.$queryRawUnsafe<Array<{ database: string }>>('SELECT current_database() AS database'),
    ]);
    assert.equal(firstDatabase.database, database.databaseName);
    assert.equal(secondDatabase.database, database.databaseName);
    assert.notEqual(first, second);
  } finally {
    await Promise.all([first.$disconnect(), second.$disconnect()]);
    await database.cleanup();
  }

  const source = new PrismaClient({ datasources: { db: { url: sourceDatabaseUrl } } });
  try {
    const rows = await source.$queryRawUnsafe<Array<{ exists: boolean }>>(
      'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists', database.databaseName);
    assert.equal(rows[0].exists, false, 'exact temporary concurrency database is dropped after the run');
  } finally { await source.$disconnect(); }
};

run().then(() => console.log('shipment statement temporary database lifecycle: ok'));
