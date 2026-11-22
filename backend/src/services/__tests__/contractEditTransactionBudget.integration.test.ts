import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { updateContract } from '../contractService';
import { buildLegacyContractMigrationPlan, CURRENT_CONTRACT_PRODUCT_POLICY_V3 } from '../contractProductGraphMigration';

test('ordinary edit survives five seconds of database work and rolls back without partial changes', async () => {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '55432');
  assert.equal(url.pathname, '/sabalanerp');
  const database = new PrismaClient({ datasources: { db: { url: url.toString() } } });
  const rollback = Symbol('delayed ordinary edit rollback');
  try {
    const actor = await database.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true } });
    const candidates = await database.salesContract.findMany({ where: {
      status: 'DRAFT', isInactive: false, partnerKind: null, firstFinancialRecordAt: null,
      productGraphState: { isNot: null },
    }, take: 100 });
    const financial = await database.accountingFinancialRecord.findMany({
      where: { contractId: { in: candidates.map(row => row.id) } }, select: { contractId: true },
    });
    const source = candidates.find(row => !financial.some(record => record.contractId === row.id) &&
      buildLegacyContractMigrationPlan({ id: row.id, totalAmount: row.totalAmount,
        contractData: row.contractData }, 1, CURRENT_CONTRACT_PRODUCT_POLICY_V3, true).ok);
    assert(source, 'Existing local database needs an editable ordinary contract');
    let attempts = 0;
    const client = new Proxy(database, { get(target, property) {
      if (property === '$transaction') return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>,
        options?: { maxWait?: number; timeout?: number }) => {
        attempts++;
        return database.$transaction(async tx => {
          await tx.$executeRaw`SELECT pg_sleep(5.2)`;
          const result = await work(tx);
          const saved = await tx.salesContract.findUniqueOrThrow({ where: { id: source.id } });
          assert.equal(saved.notes, 'Delayed edit regression');
          assert.equal(saved.totalAmount?.toString(), source.totalAmount?.toString());
          assert(result);
          throw rollback;
        }, options);
      };
      return Reflect.get(target, property);
    } });
    await assert.rejects(updateContract(source.id, { notes: 'Delayed edit regression' }, actor.id, client),
      error => error === rollback);
    assert.equal(attempts, 1);
    assert.deepEqual(await database.salesContract.findUniqueOrThrow({ where: { id: source.id } }), source);
  } finally {
    await database.$disconnect();
  }
});
