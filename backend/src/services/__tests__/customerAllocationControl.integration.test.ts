import assert from 'node:assert/strict';
import test from 'node:test';
import { PrismaClient } from '@prisma/client';
import { requireCustomerSourceSharesWithin } from '../customerSemanticCompatibility';
import path from 'node:path';
import { createTemporaryConcurrencyDatabase } from './shipmentStatementConcurrency/database';

test('migration-owned allocation control is closed and cannot be opened by the application', async () => {
  const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
  if (!url) return;
  const temporary = await createTemporaryConcurrencyDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'), sourceDatabaseUrl: url, migrateEmptySchema: true });
  const db: PrismaClient = temporary.client();
  try {
    const rows = await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM customer_allocation_release_control WHERE id = 'grouped-allocation'`;
    assert.deepEqual(rows.map(row => row.state), ['CLOSED']);
    await assert.rejects(db.$transaction(tx => requireCustomerSourceSharesWithin(tx, 'grouped-allocation')),
      { code: 'CUSTOMER_SOURCE_SHARES_CLOSED' });
    await assert.rejects(db.$executeRaw`UPDATE customer_allocation_release_control SET state = 'ACTIVE' WHERE id = 'grouped-allocation'`);
    await assert.rejects(db.$executeRaw`DELETE FROM customer_allocation_release_control WHERE id = 'grouped-allocation'`);
    assert.deepEqual((await db.$queryRaw<Array<{ state: string }>>`SELECT state FROM customer_allocation_release_control WHERE id = 'grouped-allocation'`).map(row => row.state), ['CLOSED']);
  } finally { await db.$disconnect(); await temporary.cleanup(); }
});
