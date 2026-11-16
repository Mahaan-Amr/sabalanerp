import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { customerFinanceFixture } from './customerFinanceFixture';
import { cancelCustomerAllocationIntent, prepareCustomerAllocationIntent, readCustomerAllocationIntent, readCustomerAllocationIntentByCommand, reconcileCustomerAllocationIntent } from '../accountingCustomerAllocationIntent';
import { readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
test('ordinary receipt allocation and reversal preserve the exact debt balance', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const customer = await f.customer();
    const read = () => readCustomerWorkspace(f.db, { id: customer, asOf: new Date(), userId: f.actor.id });
    await recordCustomerAccountOperation(f.db, customer, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const debt = (await read()).openItems.find(row => row.kind === 'RECEIVABLE')!;
    const receipt = await recordCustomerWorkspaceTreasury(f.db, customer, {
      ...f.common, kind: 'RECEIPT', amountRials: 100n, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID(),
    });
    const allocation = await recordCustomerWorkspaceTreasury(f.db, customer, {
      ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 1n }], idempotencyKey: randomUUID(),
    });
    assert.equal((await read()).openItems.find(row => row.id === debt.id)?.remainingRials, 99n);
    await recordCustomerWorkspaceTreasury(f.db, customer, {
      ...f.common, kind: 'REVERSE_ALLOCATION', amountRials: 0n, allocationId: allocation.id, allocations: [], idempotencyKey: randomUUID(),
    });
    assert.equal((await read()).openItems.find(row => row.id === debt.id)?.remainingRials, 100n);
  } finally { await f.close(); }
});

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
    await assert.rejects(prepareCustomerAllocationIntent(f.db, customer, { ...first, idempotencyKey: 'not-a-browser-command' }), { code: 'INVALID_ALLOCATION_INTENT' });
    await assert.rejects(prepareCustomerAllocationIntent(f.db, customer, { ...first, allocationId: 'unrelated-reversal' }), { code: 'INVALID_ALLOCATION_INTENT' });
    assert.equal(await f.db.accountingCustomerAllocationIntent.count(), 0);
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
    // A synthetic parent isolates the atomic binding from the closed financial writer.
    const result = { allocationIds: ['synthetic'] };
    const parent = { profileId: row.profileId, kind: 'ALLOCATION', createdBy: row.ownerId,
      commandHash: row.commandHash, idempotencyKey: row.idempotencyKey, result };
    await assert.rejects(f.db.accountingCustomerAllocationIntent.update({ where: { id: row.id }, data: { state: 'COMMITTED', result } }),
      /ALLOCATION_INTENT_RESULT_UNPROVEN/);
    await assert.rejects(f.db.$transaction(async tx => {
      await tx.accountingCustomerCommand.create({ data: parent });
      throw new Error('abort parent transaction');
    }), /abort parent transaction/);
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, winner), { status: 'PENDING' });
    await f.db.accountingCustomerCommand.create({ data: parent });
    assert.deepEqual(await cancelCustomerAllocationIntent(f.db, customer, winner), { status: 'COMMITTED', result });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, winner), { status: 'COMMITTED', result: { allocationIds: ['synthetic'] } });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...winner, reference: 'different evidence' }), { status: 'UNKNOWN' });
    await assert.rejects(f.db.accountingCustomerAllocationIntent.update({ where: { id: row.id }, data: { state: 'CANCELED', result: undefined } }), /ALLOCATION_INTENT_EVIDENCE_IMMUTABLE/);
    const canceled = makeCommand();
    await prepareCustomerAllocationIntent(f.db, customer, canceled);
    assert.deepEqual(await cancelCustomerAllocationIntent(f.db, customer, { ...canceled, reference: 'wrong command' }), { status: 'UNKNOWN' });
    assert.deepEqual(await cancelCustomerAllocationIntent(f.db, customer, { ...canceled, actor: { ...f.actor, id: 'another-user' } }), { status: 'UNKNOWN' });
    assert.deepEqual(await cancelCustomerAllocationIntent(f.db, customer, canceled), { status: 'CANCELED' });
    assert.deepEqual(await cancelCustomerAllocationIntent(f.db, customer, canceled), { status: 'CANCELED' });
    const canceledRow = await f.db.accountingCustomerAllocationIntent.findUniqueOrThrow({ where: { idempotencyKey: canceled.idempotencyKey } });
    await assert.rejects(f.db.accountingCustomerCommand.create({ data: {
      ...parent, idempotencyKey: canceledRow.idempotencyKey, commandHash: canceledRow.commandHash,
    } }), /ALLOCATION_INTENT_COMMAND_MISMATCH/);
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, canceled), { status: 'CANCELED' });
    assert.deepEqual(await readCustomerAllocationIntentByCommand(f.db, customer, { ...canceled, actor: { ...f.actor, id: 'another-user' } }), { status: 'UNKNOWN' });
    const competing = makeCommand();
    await prepareCustomerAllocationIntent(f.db, customer, competing);
    const competingRow = await f.db.accountingCustomerAllocationIntent.findUniqueOrThrow({ where: { idempotencyKey: competing.idempotencyKey } });
    const [post, cancel] = await Promise.allSettled([
      f.db.accountingCustomerCommand.create({ data: { ...parent, idempotencyKey: competingRow.idempotencyKey, commandHash: competingRow.commandHash } }),
      cancelCustomerAllocationIntent(f.db, customer, competing),
    ]);
    assert.equal(cancel.status, 'fulfilled');
    assert.deepEqual(cancel.value, post.status === 'fulfilled' ? { status: 'COMMITTED', result } : { status: 'CANCELED' });
    if (post.status === 'rejected') assert.match(String(post.reason), /ALLOCATION_INTENT_COMMAND_MISMATCH/);
    const orphan = makeCommand();
    await prepareCustomerAllocationIntent(f.db, customer, orphan);
    const manager = { id: 'reconciliation-manager', profile: 'ACCOUNTING_MANAGER' as const };
    const pending = await f.db.accountingCustomerAllocationIntent.findUniqueOrThrow({ where: { idempotencyKey: orphan.idempotencyKey } });
    assert.deepEqual(await readCustomerAllocationIntent(f.db, customer, manager), { status: 'BLOCKED', reconciliationId: pending.id });
    const resolution = { intentId: pending.id, reason: 'مالک درخواست دیگر به خزانه دسترسی ندارد.', actor: manager };
    await assert.rejects(reconcileCustomerAllocationIntent(f.db, customer, { ...resolution, actor: f.actor }), { code: 'ACCOUNTING_WRITE_FORBIDDEN' });
    assert.deepEqual(await reconcileCustomerAllocationIntent(f.db, await f.customer(), resolution), { status: 'UNKNOWN' });
    assert.deepEqual(await reconcileCustomerAllocationIntent(f.db, customer, resolution), { status: 'CANCELED' });
    assert.deepEqual(await reconcileCustomerAllocationIntent(f.db, customer, resolution), { status: 'CANCELED' });
    const audit = await f.db.accountingLedgerAuditEntry.findMany({ where: { entityId: pending.id } });
    assert.equal(audit.length, 1);
    assert.equal(audit[0].actorId, manager.id);
    assert.equal(audit[0].reason, resolution.reason);
  } finally { await f.close(); }
});
