import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { customerFinanceFixture } from './customerFinanceFixture';
import { readCustomerWorkspace, recordCustomerAccountOperation, recordCustomerWorkspaceTreasury } from '../accountingCustomerWorkspace';
import { listPostedTrialBalance } from '../accountingLedgerPrismaRepository';
import { attributeCustomerOpening } from '../accountingCustomerOpeningAttribution';
import { recordCustomerReceiptPrisma, transitionReceivableCheckPrisma, provisionCustomerAccountingProfile, createControlTransferPolicyPrisma, recognizeCustomerSalePrisma, createReceivableCheckPrisma, createAccountingTaxRulePrisma } from '../accountingCustomerTreasuryPrisma';
import { hashCustomerTreasuryEvidence } from '../accountingCustomerTreasury';
import { createAccountingSupplyChainApplication, hashSupplyChainEvidence } from '../accountingSupplyChain';
import { createAccountingSupplyChainPrismaRepository } from '../accountingSupplyChainPrismaRepository';
import { createSupplyChainLedgerPosting } from '../accountingSupplyChainPosting';
import { createAccountingLedgerApplication, hashAccountingEvidence, IRR_ROUNDING_RULE_V1 } from '../accountingLedgerFoundation';
import { createAccountingLedgerPrismaRepository } from '../accountingLedgerPrismaRepository';

const url = process.env.ACCOUNTING_LEDGER_TEST_DATABASE_URL;
test('historical partial cheque collection preserves the bank share and only settles the remaining instrument asset', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 200n, idempotencyKey: randomUUID() });
    const profile = (await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).profile!;
    const check = await createReceivableCheckPrisma(f.db, { profileId: profile.id, legalEntityId: f.book.legalEntityId, serialNumber: 'legacy-partial', bankName: 'آزمون', amountRials: 200n,
      dueAt: f.common.occurredAt, occurredAt: f.common.occurredAt, evidence: { reference: 'رسید تاریخی' }, actor: f.actor });
    const app = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(f.db), { now: () => new Date(), nextReference: () => randomUUID() });
    const post = async (version: number, date: Date, entries: Array<{ accountId: string; value: bigint; debit: boolean; partyId?: string; financialAccountId?: string }>) => {
      const payload = { reference: 'سند تاریخی قابل تطبیق', checkId: check.id, version };
      const source = { type: 'CHECK_INSTRUMENT', id: check.id, version, payload, hash: hashAccountingEvidence(payload) };
      const draft = await app.createManualDraft({ bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId, documentDate: date, occurredAt: date, source, actor: f.actor,
        description: 'سند تاریخی ابزار', idempotencyKey: randomUUID(), correlationId: randomUUID(), lines: entries.map(entry => ({ accountId: entry.accountId, partyId: entry.partyId, financialAccountId: entry.financialAccountId,
          debitRials: entry.debit ? entry.value : 0n, creditRials: entry.debit ? 0n : entry.value, dimensions: [], description: 'سابقه معتبر ابزار', evidence: source,
          originalAmount: entry.value.toString(), originalCurrency: 'IRR', rawAmountBeforeRounding: entry.value.toString(), roundingRuleVersion: IRR_ROUNDING_RULE_V1 })) });
      return app.postVoucher({ voucherId: draft.id, actor: f.actor, reason: f.common.reason });
    };
    const received = await post(1, f.common.occurredAt, [{ accountId: f.checks.id, value: 200n, debit: true, partyId: profile.accountingPartyId }, { accountId: f.advance.id, value: 200n, debit: false, partyId: profile.accountingPartyId }]);
    // Legacy fixture predates structured receipt-to-instrument linkage.
    const receipt = await f.db.accountingTreasuryTransaction.create({ data: { profileId: profile.id, financialAccountId: f.financial.id, kind: 'CUSTOMER_RECEIPT', direction: 'INBOUND', amountRials: '200',
      sourceType: 'CHECK_INSTRUMENT', sourceId: check.id, sourceVersion: 1, sourceHash: received.source.hash, postedVoucherId: received.id, occurredAt: f.common.occurredAt, idempotencyKey: randomUUID(), createdBy: f.actor.id } });
    const partial = await post(2, new Date('2026-10-02'), [{ accountId: f.bank.id, value: 60n, debit: true, financialAccountId: f.financial.id }, { accountId: f.checks.id, value: 60n, debit: false, partyId: profile.accountingPartyId }]);
    await f.db.accountingCheckInstrumentEvent.create({ data: { checkInstrumentId: check.id, sequence: 2, eventType: 'DEPOSITED', occurredAt: new Date('2026-10-02'), actorId: f.actor.id,
      ledgerVoucherId: partial.id, evidence: { kind: 'CHECK_SETTLE', amountRials: '60', assetLedgerId: f.checks.id }, evidenceHash: 'verified-historical-outcome' } });
    await f.db.accountingCheckInstrument.update({ where: { id: check.id }, data: { status: 'DEPOSITED', clearedRials: '60' } });
    const resolve = { ...f.common, kind: 'RESOLVE_RECEIPT' as const, receiptId: receipt.id, expectedAmountRials: 200n, amountRials: 200n, occurredAt: new Date('2026-10-03'), allocations: [], idempotencyKey: randomUUID(),
      parts: [{ key: 'partial', kind: 'CHECK' as const, existingCheckId: check.id, amountRials: 200n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id }], resolvedShares: [{ partKey: 'partial', allocations: [], refunds: [] }] };
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, resolve), /معین بانکیِ بخش وصول‌شده/);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...resolve, parts: [{ ...resolve.parts[0], collectedLedgerAccountId: f.bank.id }] });
    const reconciled = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(reconciled.refundableRials, 60n);
    await assert.rejects(transitionReceivableCheckPrisma(f.db, { checkId: check.id, nextStatus: 'CLEARED', occurredAt: new Date('2026-10-04'), evidence: { reference: 'تلاش مسیر مستقل' }, actor: f.actor }), /فرمان هماهنگ/);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'CHECK_SETTLE', receiptId: reconciled.receipts[0].id, amountRials: 140n, unpaidRials: 0n, expectedSequence: 2,
      bankLedgerId: f.bank.id, financialAccountId: f.financial.id, occurredAt: new Date('2026-10-04'), allocations: [], idempotencyKey: randomUUID() });
    const balance = await listPostedTrialBalance(f.db, { bookId: f.book.id, fiscalYearId: f.year.id });
    const custody = balance.find(row => row.accountId === f.checks.id)!;
    assert.equal(BigInt(custody.debitRials.toString()) - BigInt(custody.creditRials.toString()), 0n);
    assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).refundableRials, 200n);
  } finally { await f.close(); }
});
test('legacy resolution retains original corrections and forbids assigning past refunds to uncollected checks or spending before review', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    const original = await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 320n, allocations: [], financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'CORRECT_RECEIPT', receiptId: original.id, expectedAmountRials: 320n, amountRials: 300n, occurredAt: new Date('2026-10-02'), allocations: [], idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'REFUND', receiptId: original.id, amountRials: 50n, occurredAt: new Date('2026-10-03'), financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const check = await createReceivableCheckPrisma(f.db, { legalEntityId: f.book.legalEntityId, profileId: before.profile!.id, serialNumber: 'old-custody', sayadId: '9876543210987654', bankName: 'آزمون', dueAt: f.common.occurredAt, amountRials: 200n, occurredAt: f.common.occurredAt, evidence: { reference: 'مدرک ابزار' }, actor: f.actor });
    const command = { ...f.common, kind: 'RESOLVE_RECEIPT' as const, receiptId: original.id, expectedAmountRials: 300n, amountRials: 300n, occurredAt: new Date('2026-10-10'), allocations: [], idempotencyKey: randomUUID(),
      parts: [{ key: 'bank', kind: 'BANK' as const, amountRials: 100n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id },
        { key: 'check', kind: 'CHECK' as const, existingCheckId: check.id, amountRials: 200n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id }],
      resolvedShares: [{ partKey: 'bank', allocations: [], refunds: [] }, { partKey: 'check', allocations: [], refunds: [{ refundId: before.refunds[0].id, amountRials: 50n }] }] };
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, command), /فاقد وصول مستند/);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...command, resolvedShares: [{ partKey: 'bank', allocations: [], refunds: [{ refundId: before.refunds[0].id, amountRials: 50n }] }, { partKey: 'check', allocations: [], refunds: [] }] });
    const after = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(after.netBalanceRials, -250n); assert.equal(after.receiptHistory[0].amountRials, 320n); assert.equal(after.receiptHistory[0].adjustments[0].deltaRials, -20n);
    assert.equal(after.movements.at(-1)!.balance, '-250'); assert.ok(after.movements.some(row => row.label === 'اصلاح دریافت' && row.debit === '20'));
    const cheque = after.receipts.find(row => row.checkInstrumentId === check.id)!;
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, occurredAt: new Date('2026-10-05'), kind: 'CHECK_ENDORSE', receiptId: cheque.id,
      amountRials: 0n, expectedSequence: 1, allocations: [], supplierPartyId: 'irrelevant-before-date-check', idempotencyKey: randomUUID() }), /از تاریخ تطبیق/);
    const collectedCustomer = await f.customer();
    const historicalReceipt = await recordCustomerWorkspaceTreasury(f.db, collectedCustomer, { ...f.common, kind: 'RECEIPT', amountRials: 80n, financialAccountId: f.financial.id, bankLedgerId: f.bank.id, allocations: [], idempotencyKey: randomUUID() });
    await recordCustomerAccountOperation(f.db, collectedCustomer, { ...f.common, kind: 'REFUND', receiptId: historicalReceipt.id, amountRials: 50n, occurredAt: new Date('2026-10-03'), financialAccountId: f.financial.id, bankLedgerId: f.bank.id, idempotencyKey: randomUUID() });
    const historical = await readCustomerWorkspace(f.db, { id: collectedCustomer, asOf: new Date(), userId: f.actor.id });
    // Persist the already-imported historical instrument; this is fixture evidence, not a status command under test.
    const collectedCheck = await f.db.accountingCheckInstrument.create({ data: { legalEntityId: f.book.legalEntityId, profileId: historical.profile!.id, direction: 'RECEIVABLE', serialNumber: 'legacy-collected', bankName: 'آزمون',
      amountRials: '80', clearedRials: '80', dueAt: f.common.occurredAt, status: 'CLEARED', evidenceHash: 'historical-import', createdBy: f.actor.id,
      events: { create: [{ sequence: 1, eventType: 'RECEIVED', occurredAt: f.common.occurredAt, actorId: f.actor.id, evidence: { reference: 'رسید قدیمی' }, evidenceHash: 'historical-import' },
        { sequence: 2, eventType: 'CLEARED', occurredAt: new Date('2026-10-02'), actorId: f.actor.id, evidence: { reference: 'وصول بانکی قدیمی' }, evidenceHash: 'historical-import', ledgerVoucherId: historical.receipts[0].postedVoucherId }] } } });
    await recordCustomerWorkspaceTreasury(f.db, collectedCustomer, { ...f.common, kind: 'RESOLVE_RECEIPT', receiptId: historicalReceipt.id, expectedAmountRials: 80n, amountRials: 80n, occurredAt: new Date('2026-10-10'), allocations: [], idempotencyKey: randomUUID(),
      parts: [{ key: 'collected', kind: 'CHECK', existingCheckId: collectedCheck.id, amountRials: 80n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id }],
      resolvedShares: [{ partKey: 'collected', allocations: [], refunds: [{ refundId: historical.refunds[0].id, amountRials: 50n }] }] });
    const collectedResult = await readCustomerWorkspace(f.db, { id: collectedCustomer, asOf: new Date(), userId: f.actor.id });
    assert.equal(collectedResult.refundableRials, 30n); assert.equal(collectedResult.netBalanceRials, -30n);
    assert.equal(collectedResult.receipts[0].checkInstrumentId, collectedCheck.id);
  } finally { await f.close(); }
});
test('endorsement and recipient return preserve customer allocation and allow another endorsement cycle', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 100n, idempotencyKey: randomUUID() });
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'RECEIPT', amountRials: 200n, allocations: [], idempotencyKey: randomUUID(), parts: [{ key: 'check', kind: 'CHECK', amountRials: 200n,
      financialAccountId: f.financial.id, ledgerAccountId: f.checks.id, check: { serialNumber: 'endorsed', sayadId: '1234567890123456', bankName: 'آزمون', dueAt: f.common.occurredAt } }] });
    const account = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    const receiptId = account.receipts[0].id;
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', receiptId, amountRials: 0n, allocations: [{ openItemId: account.openItems[0].id, amountRials: 100n }], idempotencyKey: randomUUID() });
    const supplier = await f.db.accountingParty.create({ data: { legalEntityId: f.book.legalEntityId, sourceKind: 'TEST_SUPPLIER', sourceId: 'supplier', displayName: 'تأمین‌کننده', activeFrom: f.year.startsAt,
      roles: { create: { role: 'SUPPLIER', effectiveFrom: f.year.startsAt, createdBy: f.actor.id } } } });
    await f.db.accountingSupplyChainPostingRule.create({ data: { bookId: f.book.id, accountRole: 'SUPPLIER_ADVANCE', accountId: f.receivable.id, version: 1, effectiveFrom: f.year.startsAt, createdBy: f.actor.id } });
    await f.db.accountingSupplyChainPostingRule.createMany({ data: [{ bookId: f.book.id, accountRole: 'SUPPLIER_PAYABLE', accountId: f.advance.id, version: 1, effectiveFrom: f.year.startsAt, createdBy: f.actor.id },
      { bookId: f.book.id, accountRole: 'PURCHASE_EXPENSE', accountId: f.cost.id, version: 1, effectiveFrom: f.year.startsAt, createdBy: f.actor.id }] });
    const supplierOwner = createAccountingSupplyChainApplication(createAccountingSupplyChainPrismaRepository(f.db), { now: () => f.common.occurredAt,
      post: createSupplyChainLedgerPosting(f.db), resolveEvidence: async item => item });
    const supplierEvidence = (type: string) => { const payload = { supplierPartyId: supplier.id, reference: 'مدرک آزمون خدمت' }; return { type, id: randomUUID(), version: 1, payload, hash: hashSupplyChainEvidence(payload) }; };
    const invoice = await supplierOwner.recognizeSupplierInvoice({ bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId, documentDate: f.common.occurredAt, dueDate: f.common.occurredAt,
      supplierPartyId: supplier.id, supplierInvoiceNumber: 'S-1', actor: f.actor, idempotencyKey: randomUUID(), correlationId: randomUUID(), evidence: supplierEvidence('SUPPLIER_INVOICE'),
      lines: [{ id: 'service', kind: 'SERVICE', description: 'خدمت تأییدشده', quantity: '1', unit: 'SERVICE', unitPriceRials: 150n, grossRials: 150n, discountRials: 0n, attributableFreightRials: 0n,
        recoverableTaxRials: 0n, nonRecoverableTaxRials: 0n, deductionRials: 0n, retentionRials: 0n, roundingRials: 0n, acceptedServiceEvidence: supplierEvidence('SERVICE_ACCEPTANCE') }] });
    assert.equal(invoice.kind, 'POSTED');
    await assert.rejects(supplierOwner.assignCustomerCheck({ bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId, documentDate: f.common.occurredAt,
      sayadId: '1234567890123456', amountRials: 200n, supplierPartyId: supplier.id, financialAccountId: f.financial.id, dueDate: f.common.occurredAt,
      sourceCustomerPaymentId: receiptId, idempotencyKey: randomUUID(), receiptEvidence: supplierEvidence('CUSTOMER_PAYMENT_STATUS'), endorsementEvidence: supplierEvidence('TREASURY_CUSTOMER_CHECK_ENDORSEMENT'),
      actor: f.actor, allocations: [] }), /پرونده مالی مشتری/);
    const endorse = { ...f.common, kind: 'CHECK_ENDORSE' as const, receiptId, expectedSequence: 1, supplierPartyId: supplier.id, amountRials: 0n, allocations: [{ openItemId: invoice.openItemId!, amountRials: 150n }], idempotencyKey: randomUUID() };
    await recordCustomerWorkspaceTreasury(f.db, id, endorse);
    await recordCustomerWorkspaceTreasury(f.db, id, endorse);
    let current = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(current.netBalanceRials, -100n); assert.equal(current.receipts[0].allocatedRials, 100n); assert.equal(current.treasuryChecks[0].status, 'ENDORSED');
    const supplierCheck = await f.db.accountingPayableCheck.findFirstOrThrow();
    await assert.rejects(supplierOwner.transitionCheck({ checkId: supplierCheck.id, to: 'RETURNED', bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId, documentDate: f.common.occurredAt,
      actor: f.actor, evidence: supplierEvidence('TREASURY_CHECK_STATUS'), reason: f.common.reason }), /پرونده مالی مشتری/);
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'CHECK_RECIPIENT_RETURN', receiptId, expectedSequence: 2, amountRials: 0n, allocations: [], idempotencyKey: randomUUID() });
    current = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(current.netBalanceRials, -100n); assert.equal(current.receipts[0].allocatedRials, 100n); assert.equal(current.treasuryChecks[0].status, 'RECEIVED');
    assert.equal(current.treasuryChecks[0].unpaidRials.toString(), '0');
    const supplierAllocations = await f.db.accountingSupplierAllocation.findMany({ where: { openItemId: invoice.openItemId } });
    assert.equal(supplierAllocations.reduce((sum, row) => sum + BigInt(row.amountRials.toString()), 0n), 0n, 'recipient return reopens the original payable');
    await recordCustomerWorkspaceTreasury(f.db, id, { ...endorse, expectedSequence: 3, idempotencyKey: randomUUID() });
    assert.equal(await f.db.accountingPayableCheck.count(), 1);
    assert.equal(await f.db.accountingSupplierSettlementTransaction.count(), 3);
  } finally { await f.close(); }
});
test('legacy receipt resolution keeps its economic balance and explicitly restores consumed cash and cheque shares', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'DEBIT', amountRials: 200n, idempotencyKey: randomUUID() });
    const profile = (await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).profile!;
    const legacy = await recordCustomerReceiptPrisma(f.db, { profileId: profile.id, bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId,
      amountRials: 300n, occurredAt: f.common.occurredAt, financialAccountId: f.financial.id, bankAccountLedgerId: f.bank.id, customerAdvanceLedgerId: f.advance.id,
      source: { type: 'CUSTOMER_ARCHIVE_RECEIPT', id: randomUUID(), version: 1, payload: { reference: 'رسید تاریخی با عنوان منبع قدیمی' } }, idempotencyKey: randomUUID(), correlationId: randomUUID(), actor: f.actor });
    const ledger = createAccountingLedgerApplication(createAccountingLedgerPrismaRepository(f.db), { now: () => new Date(), nextReference: () => randomUUID() });
    await assert.rejects(ledger.reverseVoucher({ voucherId: legacy.postedVoucherId!, actor: { ...f.actor, profile: 'ACCOUNTING_MANAGER' }, idempotencyKey: randomUUID(), reason: f.common.reason,
      targetFiscalYearId: f.year.id, targetPeriodId: f.common.periodId, documentDate: f.common.occurredAt }), /پرونده مالی مشتری/);
    const initial = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    await recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: initial.receipts[0].id, allocations: [{ openItemId: initial.openItems[0].id, amountRials: 150n }], idempotencyKey: randomUUID() });
    const command = { ...f.common, kind: 'RESOLVE_RECEIPT' as const, receiptId: initial.receipts[0].id, expectedAmountRials: 300n, amountRials: 300n, allocations: [], idempotencyKey: randomUUID(),
      parts: [{ key: 'cash', kind: 'BANK' as const, amountRials: 100n, financialAccountId: f.financial.id, ledgerAccountId: f.bank.id },
        { key: 'cheque', kind: 'CHECK' as const, amountRials: 200n, financialAccountId: f.financial.id, ledgerAccountId: f.checks.id, check: { serialNumber: 'legacy-split', bankName: 'آزمون', dueAt: f.common.occurredAt } }],
      resolvedShares: [{ partKey: 'cash', allocations: [{ openItemId: initial.openItems[0].id, amountRials: 100n }], refunds: [] }, { partKey: 'cheque', allocations: [{ openItemId: initial.openItems[0].id, amountRials: 50n }], refunds: [] }],
    };
    await recordCustomerWorkspaceTreasury(f.db, id, command);
    await recordCustomerWorkspaceTreasury(f.db, id, command);
    const after = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(after.netBalanceRials, -100n);
    assert.equal(after.receipts.length, 2);
    assert.equal(after.receipts.find(row => row.componentKind === 'CHECK')!.allocatedRials, 50n);
    assert.equal(after.receipts.find(row => row.componentKind === 'BANK')!.allocatedRials, 100n);
    assert.equal(after.refundableRials, 0n);
    assert.equal(await f.db.accountingCustomerReceiptResolution.count(), 1);
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...command, reason: 'اطلاعات متفاوت برای همان کلید' }), /کلید/);
    await assert.rejects(recordCustomerWorkspaceTreasury(f.db, id, { ...f.common, kind: 'ALLOCATION', amountRials: 0n, receiptId: initial.receipts[0].id, allocations: [{ openItemId: initial.openItems[0].id, amountRials: 1n }], idempotencyKey: randomUUID() }), /تطبیق/);
  } finally { await f.close(); }
});
test('reviewed opening prevents historical sale recognition even for an unattributed balance', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    const customerId = id.slice('customer:'.length);
    const snapshot = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id, openingBasisAt: f.common.occurredAt });
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'OPENING', amountRials: 200n, idempotencyKey: randomUUID(), openingReview: {
      expectedSnapshotHash: snapshot.openingSnapshotHash!, identityConfirmed: true, totalConfirmed: true,
      lines: [{ key: 'unmatched', kind: 'RECEIVABLE', amountRials: 200n, existingSourceIds: [], reference: 'مانده معتبر؛ انتساب در حال بررسی' }],
    } });
    await provisionCustomerAccountingProfile(f.db, { legalEntityId: f.book.legalEntityId, relationshipId: 'historic-contract', relationshipVersion: 1,
      partySourceId: customerId, displayName: 'مشتری', approvedAt: f.common.occurredAt, evidence: { contractId: 'historic-contract' }, actor: f.actor });
    const manager = { ...f.actor, profile: 'ACCOUNTING_MANAGER' as const };
    const policy = await createControlTransferPolicyPrisma(f.db, { contractId: 'historic-contract', version: 1, carriage: 'CONTRACTUAL_EXCEPTION', recognitionPoint: 'EXPLICIT_EXCEPTION',
      exceptionReason: 'شرط اقتصادی تأییدشده برای آزمون', exceptionTerms: [{ productRowId: 'row', quantity: '1', netRials: '300', costRials: '0' }],
      exceptionOccurredAt: new Date('2026-09-30'), effectiveFrom: new Date('2026-01-01'), actor: manager });
    const evidence = { id: policy.id, version: 1, type: 'CONTRACTUAL_EXCEPTION', occurredAt: new Date('2026-09-30'), contractId: 'historic-contract', contractVersion: 1, productRows: [{ id: 'row', quantity: '1' }] };
    const count = await f.db.accountingLedgerVoucher.count();
    const command: Parameters<typeof recognizeCustomerSalePrisma>[1] = { bookId: f.book.id, fiscalYearId: f.year.id, periodId: f.common.periodId, contractId: 'historic-contract', contractVersion: 1,
      partySourceId: customerId, partyDisplayName: 'مشتری', commercialInvoiceNumber: 'old-300-paid-100', transferredAt: new Date('2026-10-03'), dueAt: f.common.occurredAt,
      policy: { id: policy.id, version: 1, carriage: 'CONTRACTUAL_EXCEPTION', recognitionPoint: 'EXPLICIT_EXCEPTION' }, evidence: { ...evidence, hash: hashCustomerTreasuryEvidence(evidence) },
      lines: [{ id: 'row', productRowId: 'row', description: 'فاکتور قدیمی', quantity: '1', netRials: 300n, taxRials: 0n, costRials: 0n,
        taxRule: { id: 'exempt', version: 1, citation: 'قاعده معافیت آزمون', rateBasisPoints: 0, exempt: true } }],
      accounts: { receivable: f.rule.receivableAccountId, revenue: f.rule.revenueAccountId, outputTax: f.rule.outputTaxAccountId, inventory: f.rule.inventoryAccountId, cost: f.rule.costAccountId },
      postingRule: { id: f.rule.id, version: 1 }, actor: f.actor, idempotencyKey: randomUUID(), correlationId: randomUUID(),
    };
    await assert.rejects(recognizeCustomerSalePrisma(f.db, command), /تاریخ مبنای افتتاحیه/);
    assert.equal(await f.db.accountingLedgerVoucher.count(), count);
    assert.equal(await f.db.accountingCommercialCustomerInvoice.count(), 0);
    assert.equal(await f.db.accountingTaxOutboxMessage.count(), 0);
    assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).netBalanceRials, 200n);
    await f.db.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', customerId, contractId: command.contractId,
      amount: '300', systemInvoiceNumber: command.commercialInvoiceNumber, systemInvoiceDate: new Date('2026-09-30'), createdBy: f.actor.id } });
    const futurePolicy = await createControlTransferPolicyPrisma(f.db, { contractId: command.contractId, version: 2, carriage: 'CONTRACTUAL_EXCEPTION', recognitionPoint: 'EXPLICIT_EXCEPTION',
      exceptionReason: 'فروش مستقل پس از تاریخ مبنای مشتری', exceptionTerms: [{ productRowId: 'row', quantity: '1', netRials: '300', costRials: '0' }], exceptionOccurredAt: new Date('2026-10-03'), effectiveFrom: new Date('2026-10-02'), actor: manager });
    const futureEvidence = { ...evidence, id: futurePolicy.id, version: 2, occurredAt: new Date('2026-10-03') };
    const futureCommand = { ...command, policy: { ...command.policy, id: futurePolicy.id, version: 2 }, evidence: { ...futureEvidence, hash: hashCustomerTreasuryEvidence(futureEvidence) }, idempotencyKey: randomUUID(), correlationId: randomUUID() };
    await assert.rejects(recognizeCustomerSalePrisma(f.db, futureCommand), /شماره فاکتور/);
    const newNumber = 'new-post-opening';
    await assert.rejects(recognizeCustomerSalePrisma(f.db, { ...futureCommand, commercialInvoiceNumber: newNumber }), /فاکتور جدید و مستقل/);
    const newRecord = await f.db.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', customerId, contractId: command.contractId, amount: '300',
      systemInvoiceNumber: newNumber, systemInvoiceDate: new Date('2026-10-03'), financiallyApprovedAt: new Date('2026-10-03'), financiallyApprovedBy: f.actor.id, createdBy: f.actor.id } });
    await createAccountingTaxRulePrisma(f.db, { legalEntityId: f.book.legalEntityId, code: 'exempt', version: 1, effectiveFrom: f.year.startsAt, citation: 'قاعده معافیت آزمون', invoiceType: 'SALE', invoicePattern: 'ORIGINAL', exempt: true, exemptionReason: 'معافیت فقط برای آزمون یکپارچه', rateBasisPoints: 0, allocationRule: 'PER_LINE', roundingRule: 'HALF_UP_IRR', actor: manager });
    const approved = { ...futureCommand, commercialInvoiceNumber: newNumber, financialRecordId: newRecord.id };
    assert.equal((await recognizeCustomerSalePrisma(f.db, approved)).kind, 'POSTED');
    assert.equal((await recognizeCustomerSalePrisma(f.db, approved)).kind, 'POSTED');
    assert.equal((await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id })).netBalanceRials, 500n);
  } finally { await f.close(); }
});
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

test('opening projection retains exact initial and latest invoice attribution without changing financial amounts', { skip: !url, timeout: 240_000 }, async () => {
  const f = await customerFinanceFixture(url!);
  try {
    const id = await f.customer();
    const customerId = id.slice('customer:'.length);
    const makeRecord = (number: string) => f.db.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', sourceId: randomUUID(), customerId, amount: '100', currency: 'IRR', status: 'ISSUED', createdBy: f.actor.id, systemInvoiceNumber: number, createdAt: new Date('2026-01-02') } });
    const first = await makeRecord('987'); const second = await makeRecord('988');
    const before = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id, openingBasisAt: f.common.occurredAt });
    await recordCustomerAccountOperation(f.db, id, { ...f.common, kind: 'OPENING', amountRials: 100n, idempotencyKey: randomUUID(), openingReview: {
      expectedSnapshotHash: before.openingSnapshotHash!, identityConfirmed: true, totalConfirmed: true,
      lines: [{ key: 'opening', kind: 'RECEIVABLE', amountRials: 100n, financialRecordId: first.id, existingSourceIds: [], reference: 'قلم تطبیق‌شده آزمون' }],
    } });
    let account = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(account.activityItems[0].financialRecordId, first.id);
    const vouchers = await f.db.accountingLedgerVoucher.count();
    await attributeCustomerOpening(f.db, id, { lineKey: 'opening', expectedSequence: 0, expectedSnapshotHash: account.openingSnapshotHash!, financialRecordId: second.id, reason: 'اصلاح انتساب فاکتور بدون ثبت مجدد', reference: 'نامه اصلاح', confirmed: true, idempotencyKey: randomUUID(), actor: f.actor });
    account = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(account.activityItems[0].financialRecordId, second.id);
    assert.equal(account.netBalanceRials, 100n); assert.equal(account.financialRecords.length, 2);
    await attributeCustomerOpening(f.db, id, { lineKey: 'opening', expectedSequence: 1, expectedSnapshotHash: account.openingSnapshotHash!, reason: 'حذف انتساب فاکتور برای بررسی مجدد', reference: 'نامه بررسی', confirmed: true, idempotencyKey: randomUUID(), actor: f.actor });
    account = await readCustomerWorkspace(f.db, { id, asOf: new Date(), userId: f.actor.id });
    assert.equal(account.activityItems[0].financialRecordId, null);
    assert.equal(await f.db.accountingLedgerVoucher.count(), vouchers);
  } finally { await f.close(); }
});
