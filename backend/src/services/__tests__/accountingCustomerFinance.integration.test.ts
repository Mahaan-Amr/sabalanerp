import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { customerFinanceFixture } from './customerFinanceFixture';
import { readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';
import { listPostedTrialBalance } from '../accountingLedgerPrismaRepository';
import { attributeCustomerOpening } from '../accountingCustomerOpeningAttribution';
import { recordCustomerReceiptPrisma, transitionReceivableCheckPrisma } from '../accountingCustomerTreasuryPrisma';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
test('legacy cheque receipts with unknown component lineage cannot be newly allocated by guessing a source share', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const legacy = await recordCustomerReceiptPrisma(f.db, { profileId: before.profile!.id, bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId,
      amountRials: 100n, occurredAt: f.common.occurredAt, financialAccountId: f.financial.id, bankAccountLedgerId: f.bank.id, customerAdvanceLedgerId: f.advance.id,
      source: { type: 'CHECK_INSTRUMENT', id: 'legacy-unlinked-check', version: 1, payload: { reference: 'legacy source awaiting reconciliation' } }, idempotencyKey: randomUUID(), correlationId: randomUUID(), actor: f.actor });
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: legacy.id,
      allocations: [{ openItemId: before.openItems[0].id, amountRials: 100n }], idempotencyKey: randomUUID() }), /چکی قدیمی/);
    assert.equal(await f.db.accountingSettlementAllocation.count(), 0);
  } finally { await f.close(); }
});
test('refunding before a later consumption reversal cannot spend historical consumed receipt or independent credit', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    for (const kind of ['receipt', 'credit'] as const) {
      const id = await f.customer();
      await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
      if (kind === 'receipt') await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 100n, allocations: [], financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
      else await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'CREDIT', amountRials: 100n, idempotencyKey: randomUUID() });
      const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
      const debt = before.openItems.find(row => row.kind === 'RECEIVABLE')!;
      const source = kind === 'receipt' ? { receiptId: before.receipts[0].id } : { creditItemId: before.openItems.find(row => row.kind === 'CREDIT')!.id };
      const allocation = await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, ...source, kind: 'ALLOCATION', occurredAt: new Date('2026-10-02'), amountRials: 0n, allocations: [{ openItemId: debt.id, amountRials: 100n }], idempotencyKey: randomUUID() });
      await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'REVERSE_ALLOCATION', occurredAt: new Date('2026-10-04'), amountRials: 0n, allocations: [], allocationId: allocation.id, idempotencyKey: randomUUID() });
      const refund = { ...f.common, ...source, kind: 'REFUND' as const, occurredAt: new Date('2026-10-03'), amountRials: 100n, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() };
      await assert.rejects(recordCustomerAccountOperation(f.db, id, refund), /مصرف یا برگشت مصرف/);
      await recordCustomerAccountOperation(f.db, id, { ...refund, occurredAt: new Date('2026-10-04'), idempotencyKey: randomUUID() });
      assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).netBalanceRials, 100n);
    }
  } finally { await f.close(); }
});
test('new openings always require review and refunds cannot precede their source or cheque collection', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'OPENING', amountRials: 100n, idempotencyKey: randomUUID() }), /بررسی هویت/);
    assert.equal(await f.db.accountingCustomerProfile.count(), 0, 'rejected review must not provision an identity');
    const bank = await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 100n, allocations: [], financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    const refund = { ...f.common, kind: 'REFUND' as const, amountRials: 20n, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, occurredAt: new Date('2026-09-30'), idempotencyKey: randomUUID() };
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...refund, receiptId: bank.id }), /منشأ قطعی/);
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'CREDIT', amountRials: 30n, idempotencyKey: randomUUID() });
    const credit = (await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).openItems[0];
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...refund, creditItemId: credit.id, idempotencyKey: randomUUID() }), /منشأ قطعی/);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 60n, allocations: [], idempotencyKey: randomUUID(), parts: [{ key: 'cheque', kind: 'CHECK', amountRials: 60n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id,
      check: { serialNumber: 'collection-date', bankName: 'آزمون', dueAt: f.common.occurredAt } }] });
    const cheque = (await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).receipts.find(row => row.componentKind === 'CHECK')!;
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, occurredAt: new Date('2026-10-02'), kind: 'CHECK_SETTLE', amountRials: 60n, unpaidRials: 0n, receiptId: cheque.id, expectedSequence: 1, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() });
    const vouchers = await f.db.accountingLedgerVoucher.count();
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...refund, receiptId: cheque.id, occurredAt: f.common.occurredAt, idempotencyKey: randomUUID() }), /بخش وصول‌شده/);
    assert.equal(await f.db.accountingLedgerVoucher.count(), vouchers);
    await recordCustomerAccountOperation(f.db, id, { ...refund, receiptId: cheque.id, occurredAt: new Date('2026-10-02'), idempotencyKey: randomUUID() });
    const after = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(after.receipts.find(row => row.id === cheque.id)?.refundableRials, 40n);
  } finally { await f.close(); }
});
test('competing allocation and refund cannot consume the same credit; cancellation reopens original debts and isolates later activity', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'CREDIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const credit = before.openItems.find(row => row.kind === 'CREDIT')!; const debt = before.openItems.find(row => row.kind === 'RECEIVABLE')!;
    const competing = await Promise.allSettled([
      recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n, creditItemId: credit.id, allocations: [{ openItemId: debt.id, amountRials: 100n }], idempotencyKey: randomUUID() }),
      recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'REFUND', amountRials: 100n, creditItemId: credit.id, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() }),
    ]);
    assert.equal(competing.filter(row => row.status === 'fulfilled').length, 1);
    const afterRace = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(afterRace.standaloneCreditRials, 0n);
    const other = await f.customer();
    const receipt = await recordCustomerWorkspaceTreasury(f.db, other, { ...f.common, kind: 'RECEIPT', amountRials: 100n, allocations: [], financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, other, { ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: receipt.id, allocations: [{ openItemId: debt.id, amountRials: 1n }], idempotencyKey: randomUUID() }), /دو مشتری/);
    await recordCustomerAccountOperation(f.db, other, { ...f.common, kind: 'DEBIT', amountRials: 60n, idempotencyKey: randomUUID() });
    const ownDebt = (await readCustomerWorkspace(f.db, { id: other, asOf: new Date(), userId: f.actor.id })).openItems[0];
    await recordCustomerWorkspaceTreasury(f.db, other, { ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: receipt.id, allocations: [{ openItemId: ownDebt.id, amountRials: 60n }], idempotencyKey: randomUUID() });
    const cancel = { ...f.common, kind: 'CANCEL_RECEIPT' as const, amountRials: 0n, expectedAmountRials: 100n, receiptId: receipt.id, allocations: [], idempotencyKey: randomUUID() };
    await recordCustomerWorkspaceTreasury(f.db, other, cancel);
    const cancelled = await readCustomerWorkspace(f.db, { id: other, asOf: new Date(), userId: f.actor.id, openingBasisAt: f.common.occurredAt });
    assert.equal(cancelled.debitOpenRials, 60n); assert.equal(cancelled.receipts[0].effectiveAmountRials, 0n);
    assert.equal(cancelled.activityItems.length, 1);
    const reviewed = { ...f.common, kind: 'OPENING' as const, amountRials: 60n, idempotencyKey: randomUUID(), openingReview: { expectedSnapshotHash: cancelled.openingSnapshotHash!, identityConfirmed: true, totalConfirmed: true,
      lines: [{ key: 'existing', kind: 'RECEIVABLE' as const, amountRials: 60n, existingSourceIds: [`item:${ownDebt.id}`], reference: 'مانده مبنای تأییدشده' }] } };
    await recordCustomerAccountOperation(f.db, other, reviewed);
    await recordCustomerAccountOperation(f.db, other, { ...f.common, occurredAt: new Date('2026-10-02'), kind: 'DEBIT', amountRials: 20n, idempotencyKey: randomUUID() });
    const later = await readCustomerWorkspace(f.db, { id: other, asOf: new Date(), userId: f.actor.id });
    assert.equal(later.netBalanceRials, 80n); assert.equal(later.openingReview?.totalRials.toString(), '60');
  } finally { await f.close(); }
});
test('confirmed source plans commit atomically, reject changed parent identities, and preserve independent refund limits', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 150n, idempotencyKey: randomUUID() });
    const receiptCommand = { ...f.common, kind: 'RECEIPT' as const, amountRials: 300n, idempotencyKey: randomUUID(), allocations: [], parts: [
      { key: 'cash', kind: 'CASH' as const, amountRials: 100n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id },
      { key: 'cheque', kind: 'CHECK' as const, amountRials: 200n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id, check: { serialNumber: 'combined', bankName: 'آزمون', dueAt: f.common.occurredAt } },
    ] };
    await recordCustomerWorkspaceTreasury(f.db, id, receiptCommand);
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...receiptCommand, parts: receiptCommand.parts.map(row => ({ ...row, key: `${row.key}-changed` })) }), /کلید فرمان/);
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const debt = before.openItems[0]; const cash = before.receipts.find(row => row.componentKind === 'CASH')!; const cheque = before.receipts.find(row => row.componentKind === 'CHECK')!;
    const plan = { ...f.common, kind: 'ALLOCATION' as const, amountRials: 0n, allocations: [], idempotencyKey: randomUUID(), sourceAllocations: [
      { receiptId: cash.id, allocations: [{ openItemId: debt.id, amountRials: 100n }] },
      { receiptId: cheque.id, allocations: [{ openItemId: debt.id, amountRials: 51n }] },
    ] };
    const vouchers = await f.db.accountingLedgerVoucher.count();
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, plan), /مانده قلم باز/);
    assert.equal(await f.db.accountingSettlementAllocation.count(), 0); assert.equal(await f.db.accountingLedgerVoucher.count(), vouchers);
    plan.sourceAllocations[1].allocations[0].amountRials = 50n;
    const saved = await recordCustomerWorkspaceTreasury(f.db, id, plan);
    assert.deepEqual(await recordCustomerWorkspaceTreasury(f.db, id, plan), saved);
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...plan, sourceAllocations: plan.sourceAllocations.slice(1) }), /کلید فرمان/);
    const after = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(after.debitOpenRials, 0n); assert.equal(after.unallocatedCreditRials, 150n); assert.equal(after.refundableRials, 0n);
    await assert.rejects(transitionReceivableCheckPrisma(f.db, { checkId: cheque.checkInstrumentId!, nextStatus: 'RETURNED', occurredAt: f.common.occurredAt, evidence: {}, actor: f.actor }), /فرمان هماهنگ/);
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'CREDIT', amountRials: 90n, idempotencyKey: randomUUID() });
    const withCredit = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const credit = withCredit.openItems.find(row => row.kind === 'CREDIT')!;
    const refund = { ...f.common, kind: 'REFUND' as const, amountRials: 90n, creditItemId: credit.id, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() };
    await recordCustomerAccountOperation(f.db, id, refund);
    assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).standaloneCreditRials, 0n);
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...refund, amountRials: 1n, idempotencyKey: randomUUID() }), /بستانکاری قابل استرداد/);
  } finally { await f.close(); }
});

test('zero-transfer opening keeps reviewed history and later attribution never reposts; stale confirmations and closed periods reject', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 30n, idempotencyKey: randomUUID() });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id, openingBasisAt: f.common.occurredAt });
    const command = { ...f.common, kind: 'OPENING' as const, amountRials: 30n, idempotencyKey: randomUUID(), openingReview: {
      expectedSnapshotHash: before.openingSnapshotHash!, identityConfirmed: true, totalConfirmed: true,
      lines: [{ key: 'unattributed', kind: 'RECEIVABLE' as const, amountRials: 30n, reference: 'مدرک مانده معتبر', existingSourceIds: [before.openingSources[0].id] }],
    } };
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...command, openingReview: { ...command.openingReview, expectedSnapshotHash: 'expired' } }), /نسخه بررسی/);
    const vouchers = await f.db.accountingLedgerVoucher.count();
    const saved = await recordCustomerAccountOperation(f.db, id, command);
    assert.equal(saved.voucherId, null); assert.equal(await f.db.accountingLedgerVoucher.count(), vouchers);
    assert.deepEqual(await recordCustomerAccountOperation(f.db, id, command), saved);
    const reviewed = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const attribution = { lineKey: 'unattributed', expectedSequence: 0, expectedSnapshotHash: reviewed.openingSnapshotHash!, reason: 'تطبیق مستند فاقد قرارداد', reference: 'نامه تطبیق', confirmed: true, idempotencyKey: randomUUID(), actor: f.actor };
    const attributed = await attributeCustomerOpening(f.db, id, attribution);
    assert.deepEqual(await attributeCustomerOpening(f.db, id, attribution), attributed);
    await assert.rejects(attributeCustomerOpening(f.db, id, { ...attribution, idempotencyKey: randomUUID() }), /انتساب این قلم تغییر/);
    assert.equal(await f.db.accountingLedgerVoucher.count(), vouchers);
    assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).netBalanceRials, 30n);
    await f.db.accountingPostingPeriod.update({ where: { id: f.common.periodId }, data: { status: 'HARD_CLOSED' } });
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'CREDIT', amountRials: 1n, idempotencyKey: randomUUID() }), /دوره/);
  } finally { await f.close(); }
});
test('reviewed customer opening transfers only the unposted share of the confirmed total', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 30n, idempotencyKey: randomUUID() });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id, openingBasisAt: f.common.occurredAt });
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'OPENING', amountRials: 100n, idempotencyKey: randomUUID(),
      openingReview: { expectedSnapshotHash: before.openingSnapshotHash, identityConfirmed: true, totalConfirmed: true,
        lines: [{ key: 'unattributed', kind: 'RECEIVABLE', amountRials: 100n, reference: 'مانده کل تأییدشده', existingSourceIds: [`item:${before.openItems[0].id}`] }] } } as any);
    const after = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(after.netBalanceRials, 100n);
    assert.equal(after.activityItems.find(item => item.sourceKind === 'OPENING')?.originalRials, 70n);
  } finally { await f.close(); }
});

test('bank fee is a company expense and does not reduce or duplicate the customer receipt', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    const command = { ...f.common, kind: 'RECEIPT', amountRials: 100n, idempotencyKey: randomUUID(), allocations: [],
      parts: [{ key: 'bank', kind: 'BANK', amountRials: 100n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id,
        feeRials: 1n, feeLedgerAccountId: f.cost.id }] };
    const result = await recordCustomerWorkspaceTreasury(f.db, id, command as any);
    assert.deepEqual(await recordCustomerWorkspaceTreasury(f.db, id, command as any), result);
    const account = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(account.netBalanceRials, -100n);
    assert.equal(account.receipts.length, 1);
    const trial = await listPostedTrialBalance(f.db, { bookId: f.book.id, fiscalYearId: f.year.id });
    const bank = trial.find(row => row.accountId === f.bank.id)!;
    assert.equal(BigInt(bank.debitRials.toString()) - BigInt(bank.creditRials.toString()), 99n);
    assert.equal(BigInt(trial.find(row => row.accountId === f.cost.id)!.debitRials.toString()), 1n);
  } finally { await f.close(); }
});

test('partial cheque nonpayment reopens only invalid consumption and preserves the cash component', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 250n, idempotencyKey: randomUUID() });
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 300n, idempotencyKey: randomUUID(), allocations: [], parts: [
      { key: 'cash', kind: 'CASH', amountRials: 100n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id },
      { key: 'check', kind: 'CHECK', amountRials: 200n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id,
        check: { serialNumber: 'partial-200', bankName: 'بانک آزمون', dueAt: new Date('2026-10-01') } },
    ] });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const debt = before.openItems[0];
    const cash = before.receipts.find(row => row.componentKind === 'CASH')!;
    const check = before.receipts.find(row => row.componentKind === 'CHECK')!;
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', receiptId: cash.id, amountRials: 0n,
      idempotencyKey: randomUUID(), allocations: [{ openItemId: debt.id, amountRials: 100n }] });
    const allocation = await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', receiptId: check.id, amountRials: 0n,
      idempotencyKey: randomUUID(), allocations: [{ openItemId: debt.id, amountRials: 150n }] });
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'CHECK_DEPOSIT', receiptId: check.id, amountRials: 0n,
      expectedSequence: 1, financialAccountId: f.financial.id, collectionLedgerId: f.collection.id, idempotencyKey: randomUUID(), allocations: [] } as any);
    const settlement = { ...f.common, kind: 'CHECK_SETTLE', receiptId: check.id, amountRials: 60n, unpaidRials: 140n,
      expectedSequence: 2, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID(), allocations: [],
      reversals: [{ allocationId: (allocation as { id: string }).id, lines: [{ openItemId: debt.id, amountRials: 90n }] }] };
    const saved = await recordCustomerWorkspaceTreasury(f.db, id, settlement as any);
    assert.deepEqual(await recordCustomerWorkspaceTreasury(f.db, id, settlement as any), saved);
    const after = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(after.receipts.find(row => row.id === cash.id)?.allocatedRials, 100n);
    assert.equal(after.receipts.find(row => row.id === check.id)?.effectiveAmountRials, 60n);
    assert.equal(after.receipts.find(row => row.id === check.id)?.allocatedRials, 60n);
    assert.equal(after.unallocatedCreditRials, 0n);
    assert.equal(after.openItems[0].remainingRials, 90n);
    assert.equal(after.netBalanceRials, 90n);
    assert.equal(after.movements.at(-1)?.balance, '90');
  } finally { await f.close(); }
});

test('receipt correction preserves valid allocations and requires selected reversals for excess consumption', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    const receipt = await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 100n,
      bankLedgerId: f.bank.id, financialAccountId: f.financial.id, idempotencyKey: randomUUID(), allocations: [] });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const debt = before.openItems[0];
    const allocation = await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', receiptId: receipt.id,
      amountRials: 0n, idempotencyKey: randomUUID(), allocations: [{ openItemId: debt.id, amountRials: 60n }] });
    const correction = { ...f.common, kind: 'CORRECT_RECEIPT', receiptId: receipt.id, amountRials: 80n,
      expectedAmountRials: 100n, idempotencyKey: randomUUID(), allocations: [], reversals: [] };
    const savedCorrection = await recordCustomerWorkspaceTreasury(f.db, id, correction as any);
    assert.deepEqual(await recordCustomerWorkspaceTreasury(f.db, id, correction as any), savedCorrection);
    const corrected = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(corrected.receipts[0].allocatedRials, 60n);
    assert.equal(corrected.unallocatedCreditRials, 20n);
    assert.equal(corrected.netBalanceRials, 20n);
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...correction, amountRials: 50n, expectedAmountRials: 80n,
      idempotencyKey: randomUUID() } as any), /تخصیص/);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...correction, amountRials: 50n, expectedAmountRials: 80n, idempotencyKey: randomUUID(),
      reversals: [{ allocationId: (allocation as { id: string }).id, lines: [{ openItemId: debt.id, amountRials: 10n }] }] } as any);
    const reduced = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(reduced.receipts[0].allocatedRials, 50n);
    assert.equal(reduced.unallocatedCreditRials, 0n);
    assert.equal(reduced.openItems[0].remainingRials, 50n);
    assert.equal(reduced.netBalanceRials, 50n);
  } finally { await f.close(); }
});

test('mixed receipt keeps cash and uncollected cheque sources separate and refuses cash refund of the cheque', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 300n, idempotencyKey: randomUUID(),
      financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], parts: [
        { key: 'cash', kind: 'CASH', amountRials: 100n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id },
        { key: 'check', kind: 'CHECK', amountRials: 200n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id,
          check: { serialNumber: 'mixed-200', bankName: 'بانک آزمون', dueAt: new Date('2026-12-01') } },
      ] } as any);
    const account = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(account.receipts.length, 2);
    const cash = account.receipts.find(row => (row as any).componentKind === 'CASH')!;
    const check = account.receipts.find(row => (row as any).componentKind === 'CHECK')!;
    assert.equal(cash.amountRials, 100n);
    assert.equal(check.amountRials, 200n);
    assert.equal(account.netBalanceRials, -300n);
    await assert.rejects(recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'REFUND', amountRials: 10n,
      receiptId: check.id, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() }), /وصول/);
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'REFUND', amountRials: 20n,
      receiptId: cash.id, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).netBalanceRials, -280n);
  } finally { await f.close(); }
});

test('standalone customer credit settles debt without creating a fictitious receipt and can be reversed', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'CREDIT', amountRials: 150n, idempotencyKey: randomUUID() });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const credit = before.openItems.find(item => item.kind === 'CREDIT')!;
    const debt = before.openItems.find(item => item.kind === 'RECEIVABLE')!;
    const command = { ...f.common, kind: 'ALLOCATION' as const, amountRials: 0n, creditItemId: credit.id,
      idempotencyKey: randomUUID(), allocations: [{ openItemId: debt.id, amountRials: 100n }] };
    const allocation = await recordCustomerWorkspaceTreasury(f.db, id, command);
    assert.deepEqual(await recordCustomerWorkspaceTreasury(f.db, id, command), allocation);
    const settled = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(settled.netBalanceRials, -50n);
    assert.equal(settled.openItems.find(item => item.kind === 'CREDIT')?.remainingRials, 50n);
    assert.equal(settled.openItems.some(item => item.kind === 'RECEIVABLE'), false);
    assert.equal(settled.receipts.length, 0);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'REVERSE_ALLOCATION', amountRials: 0n,
      allocationId: (allocation as { id: string }).id, idempotencyKey: randomUUID(), allocations: [] });
    const reversed = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(reversed.openItems.find(item => item.kind === 'CREDIT')?.remainingRials, 150n);
    assert.equal(reversed.openItems.find(item => item.kind === 'RECEIVABLE')?.remainingRials, 100n);
    assert.equal(reversed.netBalanceRials, -50n);
  } finally { await f.close(); }
});
