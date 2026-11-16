import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { customerFinanceFixture } from './customerFinanceFixture';
import { prepareCustomerAllocationIntent, readCustomerAllocationIntent, readCustomerAllocationIntentByCommand } from '../accountingCustomerAllocationIntent';
import { readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
test('one immutable pending intent is shared across devices without admitting a financial write', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const customer = await f.customer();
    await recordCustomerAccountOperation(f.db, customer, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const account = await readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id });
    const debt = account.openItems.find(row => row.kind === 'RECEIVABLE')!;
    const makeCommand = () => ({ ...f.common, kind: 'ALLOCATION' as const, amountRials: 0n, allocations: [], idempotencyKey: randomUUID(),
      sourceAllocations: [{ creditItemId: 'synthetic-source', allocations: [{ openItemId: debt.id, amountRials: 1n }] }] });
    const first = makeCommand(), second = makeCommand();
    const before = await Promise.all([f.db.accountingLedgerVoucher.count(), f.db.accountingSettlementAllocation.count(), f.db.accountingCustomerCommand.count()]);
    const attempts = await Promise.allSettled([prepareCustomerAllocationIntent(f.db, customer, first), prepareCustomerAllocationIntent(f.db, customer, second)]);
    assert.equal(attempts.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter(row => row.status === 'rejected').length, 1);
    const winner = attempts[0].status === 'fulfilled' ? first : second;
    assert.deepEqual(await prepareCustomerAllocationIntent(f.db, customer, winner), { status: 'PENDING', idempotencyKey: winner.idempotencyKey });
    await assert.rejects(prepareCustomerAllocationIntent(f.db, customer, { ...winner, reference: 'different evidence' }),
      (error: any) => error.code === 'ALLOCATION_INTENT_MISMATCH');
    await assert.rejects(prepareCustomerAllocationIntent(f.db, customer, { ...winner, actor: { ...f.actor, id: 'another-user' } }),
      (error: any) => error.code === 'ALLOCATION_INTENT_MISMATCH');
    assert.deepEqual(await readCustomerAllocationIntent(f.db, customer, { ...f.actor, id: 'another-user' }), { status: 'BLOCKED' });
    const restored = await readCustomerAllocationIntent(f.db, customer, f.actor);
    assert.equal(restored.status, 'PENDING');
    if (restored.status !== 'PENDING') throw new Error('pending intent not found');
    assert.equal(restored.idempotencyKey, winner.idempotencyKey);
    assert.equal((restored.command as any).sourceAllocations[0].allocations[0].amountRials, '1');
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, winner), { status: 'PENDING' });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...winner, reference: 'different evidence' }), { status: 'UNKNOWN' });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...winner, actor: { ...f.actor, id: 'another-user' } }), { status: 'UNKNOWN' });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...winner, idempotencyKey: randomUUID() }), { status: 'UNKNOWN' });
    await assert.rejects(readCustomerAllocationIntentByCommand(f.db, customer, { ...winner, actor: { ...f.actor, profile: 'VIEWER' } }),
      (error: any) => error.code === 'ACCOUNTING_WRITE_FORBIDDEN');
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, customer, winner), (error: any) => error.code === 'CUSTOMER_SOURCE_SHARES_CLOSED');
    assert.deepEqual(await Promise.all([f.db.accountingLedgerVoucher.count(), f.db.accountingSettlementAllocation.count(), f.db.accountingCustomerCommand.count()]), before);
    const row = await f.db.accountingCustomerAllocationIntent.findUniqueOrThrow({ where: { idempotencyKey: winner.idempotencyKey } });
    await assert.rejects(f.db.accountingCustomerAllocationIntent.delete({ where: { id: row.id } }), /ALLOCATION_INTENT_EVIDENCE_IMMUTABLE/);
    await assert.rejects(f.db.accountingCustomerAllocationIntent.update({ where: { id: row.id }, data: { commandHash: 'a'.repeat(64) } }), /ALLOCATION_INTENT_EVIDENCE_IMMUTABLE/);
    assert.equal(await f.db.accountingCustomerAllocationIntent.count(), 1);
    // Synthetic terminal evidence tests lookup only; no financial writer is activated.
    await f.db.accountingCustomerAllocationIntent.update({ where: { id: row.id }, data: { state: 'COMMITTED', result: { allocationIds: ['synthetic'] } } });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, winner), { status: 'COMMITTED', result: { allocationIds: ['synthetic'] } });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...winner, reference: 'different evidence' }), { status: 'UNKNOWN' });
    await assert.rejects(f.db.accountingCustomerAllocationIntent.update({ where: { id: row.id }, data: { state: 'CANCELED', result: undefined } }), /ALLOCATION_INTENT_EVIDENCE_IMMUTABLE/);
    const canceled = makeCommand();
    await prepareCustomerAllocationIntent(f.db, customer, canceled);
    await f.db.accountingCustomerAllocationIntent.update({ where: { idempotencyKey: canceled.idempotencyKey }, data: { state: 'CANCELED' } });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, canceled), { status: 'CANCELED' });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...canceled, actor: { ...f.actor, id: 'another-user' } }), { status: 'UNKNOWN' });
  } finally { await f.close(); }
});
