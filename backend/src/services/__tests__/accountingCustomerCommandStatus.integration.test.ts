import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { customerFinanceFixture } from './customerFinanceFixture';
import { hashAccountingEvidence } from '../accountingLedgerFoundation';
import { readCustomerAllocationCommandStatus, readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
test('closed allocation reconciliation only returns the owner’s exact committed command without writes', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const customer = await f.customer();
    await recordCustomerAccountOperation(f.db, customer, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const account = await readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id });
    const debt = account.openItems.find(row => row.kind === 'RECEIVABLE')!;
    const command = { ...f.common, kind: 'ALLOCATION' as const, amountRials: 0n, allocations: [], idempotencyKey: randomUUID(),
      sourceAllocations: [{ creditItemId: 'synthetic-source', allocations: [{ openItemId: debt.id, amountRials: 1n }] }] };

    // The current guard intentionally rejects new writes; the parent record is
    // a fixture for a command committed before a later closure/rollback.
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, command), (e: any) => e.code === 'CUSTOMER_SOURCE_SHARES_CLOSED');
    const result = { id: 'synthetic-committed-command', allocationIds: ['synthetic-allocation'] };
    await f.db.accountingCustomerCommand.create({ data: { profileId: account.profile!.id, kind: command.kind,
      idempotencyKey: command.idempotencyKey, createdBy: f.actor.id, commandHash: hashAccountingEvidence({ ...command, actor: undefined }), result } });
    const before = await Promise.all([f.db.accountingCustomerCommand.count(), f.db.accountingLedgerVoucher.count(), f.db.accountingSettlementAllocation.count()]);
    assert.deepEqual(await readCustomerAllocationCommandStatus(f.db, customer, command), { status: 'COMMITTED', result });
    assert.deepEqual(await readCustomerAllocationCommandStatus(f.db, customer, { ...command, idempotencyKey: randomUUID() }), { status: 'UNKNOWN' });
    assert.deepEqual(await readCustomerAllocationCommandStatus(f.db, customer, { ...command, actor: { ...f.actor, id: 'other-accountant' } }), { status: 'UNKNOWN' });
    assert.deepEqual(await readCustomerAllocationCommandStatus(f.db, customer, { ...command, reference: 'different evidence' }), { status: 'UNKNOWN' });
    await assert.rejects(readCustomerAllocationCommandStatus(f.db, customer, { ...command, actor: { ...f.actor, profile: 'VIEWER' } }),
      (e: any) => e.code === 'ACCOUNTING_WRITE_FORBIDDEN');
    const anotherCustomer = await f.customer();
    assert.deepEqual(await readCustomerAllocationCommandStatus(f.db, anotherCustomer, command), { status: 'UNKNOWN' });
    assert.deepEqual(await Promise.all([f.db.accountingCustomerCommand.count(), f.db.accountingLedgerVoucher.count(), f.db.accountingSettlementAllocation.count()]), before);
  } finally { await f.close(); }
});
