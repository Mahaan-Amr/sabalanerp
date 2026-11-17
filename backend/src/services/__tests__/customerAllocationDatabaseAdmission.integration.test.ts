import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('a confirmed grouped child cannot commit while durable admission is closed', { skip: !url, timeout: 240_000 }, async () => {
  const require = createRequire(path.resolve(process.cwd(), 'src/services/__tests__/customerAllocationDatabaseAdmission.integration.test.ts'));
  const compatibilityPath = require.resolve('../customerSemanticCompatibility');
  const compatibility = require(compatibilityPath);
  const entry = require.cache[compatibilityPath]!;
  entry.exports = { ...compatibility, requireCustomerSourceSharesWithin: async (
    tx: import('@prisma/client').Prisma.TransactionClient,
    operation?: import('../customerSemanticCompatibility').CustomerSourceShareOperation,
  ) => {
    if (operation !== 'grouped-allocation') await compatibility.requireCustomerSourceSharesWithin(tx, operation);
  } };
  try {
    const { customerFinanceFixture } = require('./customerFinanceFixture') as typeof import('./customerFinanceFixture');
    const { recordCustomerAccountOperation, recordCustomerWorkspaceTreasury, readCustomerWorkspace } =
      require('../accountingCustomerWorkspace') as typeof import('../accountingCustomerWorkspace');
    const { prepareAdmittedCustomerAllocationIntent } =
      require('../accountingCustomerAllocationIntent') as typeof import('../accountingCustomerAllocationIntent');
    const f = await customerFinanceFixture(url!);
    try {
      const triggers = await f.db.$queryRaw<Array<{ name: string }>>`
        SELECT tgname AS name FROM pg_trigger WHERE tgrelid = 'public.accounting_settlement_allocations'::regclass
          AND tgname = 'require_active_grouped_allocation_child'`;
      assert.equal(triggers.length, 1);
      const customer = await f.customer();
      await recordCustomerAccountOperation(f.db, customer, { ...f.common, kind: 'DEBIT', amountRials: 1n, idempotencyKey: randomUUID() });
      const debt = (await readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id }))
        .openItems.find(row => row.kind === 'RECEIVABLE')!;
      const receipt = await recordCustomerWorkspaceTreasury(f.db, customer, { ...f.common, kind: 'RECEIPT', amountRials: 1n,
        financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() });
      const command = { ...f.common, kind: 'ALLOCATION' as const, amountRials: 0n, allocations: [], idempotencyKey: randomUUID(),
        sourceAllocations: [{ receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 1n }] }] };
      await prepareAdmittedCustomerAllocationIntent(f.db, customer, command);
      const before = await Promise.all([f.db.accountingSettlementAllocation.count(), f.db.accountingLedgerVoucher.count()]);
      await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, command), { code: 'CUSTOMER_SOURCE_SHARES_CLOSED' });
      assert.deepEqual(await Promise.all([f.db.accountingSettlementAllocation.count(), f.db.accountingLedgerVoucher.count()]), before);
      assert.equal((await f.db.accountingCustomerAllocationIntent.findUniqueOrThrow({ where: { idempotencyKey: command.idempotencyKey } })).state, 'PENDING');
    } finally { await f.close(); }
  } finally { entry.exports = compatibility; }
});
