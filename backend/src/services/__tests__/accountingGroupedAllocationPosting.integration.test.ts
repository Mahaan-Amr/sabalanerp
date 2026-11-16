import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;

test('admitted grouped posting commits exact shares once and reverses independent credit', { skip: !url, timeout: 240_000 }, async () => {
  const require = createRequire(path.resolve(process.cwd(), 'src/services/__tests__/accountingGroupedAllocationPosting.integration.test.ts'));
  const compatibilityPath = require.resolve('../customerSemanticCompatibility');
  const compatibility = require(compatibilityPath);
  const moduleEntry = require.cache[compatibilityPath]!;
  // Replace admission only in this test process. The application has no test
  // switch, and every financial write uses the owned temporary database.
  moduleEntry.exports = { ...compatibility, requireCustomerSourceSharesWithin: async () => {} };
  try {
    const { customerFinanceFixture } = require('./customerFinanceFixture') as typeof import('./customerFinanceFixture');
    const { recordCustomerAccountOperation, recordCustomerWorkspaceTreasury, readCustomerWorkspace } =
      require('../accountingCustomerWorkspace') as typeof import('../accountingCustomerWorkspace');
    const { prepareAdmittedCustomerAllocationIntent, cancelCustomerAllocationIntent, readCustomerAllocationIntentByCommand } =
      require('../accountingCustomerAllocationIntent') as typeof import('../accountingCustomerAllocationIntent');
    const { allocateCustomerReceiptPrisma } = require('../accountingCustomerTreasuryPrisma') as typeof import('../accountingCustomerTreasuryPrisma');
    const f = await customerFinanceFixture(url!);
    try {
      const customer = await f.customer();
      const read = () => readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id });
      for (const [kind, amountRials] of [['DEBIT', 3n], ['CREDIT', 1n]] as const) {
        await recordCustomerAccountOperation(f.db, customer, { ...f.common, kind, amountRials, idempotencyKey: randomUUID() });
      }
      const receipt = await recordCustomerWorkspaceTreasury(f.db, customer, {
        ...f.common, kind: 'RECEIPT', amountRials: 2n, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID(),
      });
      const before = await read();
      const debt = before.openItems.find(row => row.kind === 'RECEIVABLE')!;
      const credit = before.openItems.find(row => row.kind === 'CREDIT')!;
      const command = {
        ...f.common, kind: 'ALLOCATION' as const, amountRials: 0n, allocations: [], idempotencyKey: randomUUID(),
        sourceAllocations: [
          { receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 2n }] },
          { creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: 1n }] },
        ],
      };
      await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, command), { code: 'ALLOCATION_INTENT_REQUIRED' });
      const invalid = { ...command, idempotencyKey: randomUUID(), sourceAllocations: [command.sourceAllocations[0],
        { creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: 2n }] }] };
      await prepareAdmittedCustomerAllocationIntent(f.db, customer, invalid);
      await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, invalid));
      assert.equal((await read()).debitOpenRials, 3n);
      assert.equal(await f.db.accountingSettlementAllocation.count(), 0);
      assert.deepEqual(await cancelCustomerAllocationIntent(f.db, customer, invalid), { status: 'CANCELED' });
      await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, invalid), { code: 'ALLOCATION_INTENT_NOT_PENDING' });
      await assert.rejects(f.db.$transaction(async tx => {
        // Establish the old snapshot before preparing the request on another connection.
        assert.equal(await tx.accountingCustomerAllocationIntent.count({ where: { state: 'PENDING' } }), 0);
        await prepareAdmittedCustomerAllocationIntent(f.db, customer, command);
        const key = randomUUID();
        await allocateCustomerReceiptPrisma(tx, {
          treasuryTransactionId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 1n }],
          bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId,
          customerAdvanceLedgerId: f.advance.id, receivableLedgerId: f.receivable.id,
          documentDate: f.common.occurredAt, idempotencyKey: key, correlationId: key, actor: f.actor,
        });
      }, { isolationLevel: 'Serializable', timeout: 30_000 }), /40001|serialize|write conflict/i);
      assert.equal(await f.db.accountingSettlementAllocation.count(), 0);
      await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, {
        ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: receipt.id,
        allocations: [{ openItemId: debt.id, amountRials: 1n }], idempotencyKey: randomUUID(),
      }), { code: 'ALLOCATION_INTENT_PENDING' });
      for (const source of [{ receiptId: receipt.id }, { creditItemId: credit.id }]) {
        await assert.rejects(recordCustomerAccountOperation(f.db, customer, {
          ...f.common, ...source, kind: 'REFUND', amountRials: 1n, idempotencyKey: randomUUID(),
          financialAccountId: f.financial.id, bankLedgerId: f.bank.id,
        }), { code: 'ALLOCATION_INTENT_PENDING' });
      }
      const result = await recordCustomerWorkspaceTreasury(f.db, customer, command);
      assert.deepEqual(await recordCustomerWorkspaceTreasury(f.db, customer, command), result);
      assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, command), { status: 'COMMITTED', result });
      assert.equal((await read()).debitOpenRials, 0n);
      assert.equal(await f.db.accountingSettlementAllocation.count(), 2);
      const creditShare = await f.db.accountingSettlementAllocation.findFirstOrThrow({ where: { creditItemId: credit.id } });
      await recordCustomerWorkspaceTreasury(f.db, customer, {
        ...f.common, kind: 'REVERSE_ALLOCATION', allocationId: creditShare.id, amountRials: 0n, allocations: [], idempotencyKey: randomUUID(),
      });
      const after = await read();
      assert.equal(after.debitOpenRials, 1n);
      assert.equal(after.standaloneCreditRials, 1n);

      const competing = { ...command, idempotencyKey: randomUUID(),
        sourceAllocations: [{ creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: 1n }] }] };
      await prepareAdmittedCustomerAllocationIntent(f.db, customer, competing);
      const allocationCount = await f.db.accountingSettlementAllocation.count();
      const [post, cancel] = await Promise.allSettled([
        recordCustomerWorkspaceTreasury(f.db, customer, competing),
        cancelCustomerAllocationIntent(f.db, customer, competing),
      ]);
      assert.equal(cancel.status, 'fulfilled');
      const terminal = await readCustomerAllocationIntentByCommand(f.db, customer, competing);
      if (post.status === 'fulfilled') {
        assert.deepEqual(terminal, { status: 'COMMITTED', result: post.value });
        assert.equal(await f.db.accountingSettlementAllocation.count(), allocationCount + 1);
        assert.equal((await read()).debitOpenRials, 0n);
      } else {
        assert.deepEqual(terminal, { status: 'CANCELED' });
        assert.equal(await f.db.accountingSettlementAllocation.count(), allocationCount);
        assert.equal((await read()).debitOpenRials, 1n);
        await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, competing), { code: 'ALLOCATION_INTENT_NOT_PENDING' });
      }
      assert.deepEqual(cancel.value, terminal);
    } finally { await f.close(); }
  } finally { moduleEntry.exports = compatibility; }
});
