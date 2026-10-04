import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { approveOrdinarySales } from '../ordinaryContractLifecycle';
import { ordinaryFinancialActionsAllowed, assertOrdinaryAccountingCommercialGate } from '../ordinaryAccountingCommercialGate';
import { ordinaryContractDispatchEligible } from '../ordinaryContractDispatchEligibility';
import { customerCreditBalance, updateCustomerCreditPolicy, validateSpecialCustomerCreditPlan, consumedCustomerCredit, CustomerCreditError } from '../specialCustomerCredit';
import { hasSpecialCustomerCreditAuthorization, unpaidCustomerCredit } from '../specialCustomerCreditPolicy';
import { createDispatchRequest, decideDispatchRequest } from '../contractDispatchCredit';
import { processContractCreditReminders } from '../contractCreditReminders';
import { requestAccountingSalesContractCorrection } from '../salesContractCorrectionDuty';
import { respondToCrossWorkspaceDuty } from '../crossWorkspaceDutyModule';

const url = process.env.LOCAL_QA_DATABASE_URL;
assert.ok(url, 'Set LOCAL_QA_DATABASE_URL to the existing sabalanerp-local database');
const target = new URL(url);
assert.ok(['127.0.0.1', 'localhost'].includes(target.hostname) && target.port === '55432' && target.pathname === '/sabalanerp');
class Rollback extends Error {}
const fixture = async (run: (tx: Prisma.TransactionClient, contract: any, admin: any) => Promise<void>) => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    await assert.rejects(db.$transaction(async tx => {
      const source = await tx.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null } });
      const admin = await tx.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true } });
      const customer = await tx.crmCustomer.create({ data: { firstName: 'آزمون', lastName: randomUUID(), trustCategory: 'SPECIAL', creditLimitRials: 600 } });
      const contract = await tx.salesContract.create({ data: { contractNumber: `QA-SPECIAL-${randomUUID()}`, title: 'QA', titlePersian: 'آزمون اعتبار مشتری خاص', content: 'QA',
        customerId: customer.id, departmentId: source.departmentId, createdBy: source.createdBy, responsibleSellerId: source.responsibleSellerId,
        totalAmount: 1000, currency: 'ریال', commercialFlowVersion: 1, commercialRevision: 1, commercialExpiresAt: new Date('2099-01-01') } });
      await tx.payment.create({ data: { contractId: contract.id, paymentMethod: 'SPECIAL_CUSTOMER_CREDIT', totalAmount: 600, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
      await run(tx, contract, admin);
      throw new Rollback();
    }, { timeout: 60_000 }), Rollback);
  } finally { await db.$disconnect(); }
};

test('mixed collections cover non-credit first, exact whole-rial arithmetic', () => {
  assert.equal(unpaidCustomerCredit(600, 1000, 300).toString(), '600');
  assert.equal(unpaidCustomerCredit(600, 1000, 600).toString(), '400');
  assert.equal(unpaidCustomerCredit(600, 1000, 1200).toString(), '0');
});

test('past initial promise is correctable, while an already authorized due date remains valid', () => fixture(async (tx, contract, admin) => {
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { paymentDate: new Date('2000-01-01') } });
  await assert.rejects(validateSpecialCustomerCreditPlan(tx, contract), error =>
    error instanceof CustomerCreditError && error.status === 400 && /امروز یا آینده/.test(error.message));
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { paymentDate: new Date('2099-01-01') } });
  await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  const existing = await tx.salesContract.update({ where: { id: contract.id }, data: { customerCreditPromisedDate: new Date('2000-01-01') } });
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { paymentDate: new Date('2000-01-01') } });
  assert.equal((await validateSpecialCustomerCreditPlan(tx, existing))?.date.toISOString().slice(0, 10), '2000-01-01');
}));

test('partial or stale invoices cannot release the live promise; cancellation retains evidenced debt', () => fixture(async (tx, contract, admin) => {
  const approved = await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  const invoice = await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT',
    contractId: contract.id, sourceSnapshot: { commercialRevision: 1 }, amount: 300, currency: 'ریال', createdBy: admin.id,
    financiallyApprovedAt: new Date() } });
  assert.equal((await consumedCustomerCredit(tx, approved)).toString(), '600');
  const renewed = await tx.salesContract.update({ where: { id: contract.id }, data: { commercialRevision: 2,
    customerCreditRevision: 2, salesApprovalRevision: 2, customerCreditTotalRials: 1200 } });
  assert.equal((await consumedCustomerCredit(tx, renewed)).toString(), '600');
  await tx.accountingFinancialRecord.update({ where: { id: invoice.id }, data: { sourceSnapshot: { commercialRevision: 2 } } });
  assert.equal((await consumedCustomerCredit(tx, renewed)).toString(), '600');
  const cancelled = await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'CANCELLED' } });
  assert.equal((await consumedCustomerCredit(tx, cancelled)).toString(), '300');
}));

test('authoritative posted credit notes reduce the obligation; a draft credit does not', () => fixture(async (tx, contract, admin) => {
  const approved = await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  const now = new Date();
  const entity = await tx.accountingLegalEntity.create({ data: { code: randomUUID(), namePersian: 'آزمون اعتبار', activeFrom: now, createdBy: admin.id } });
  const book = await tx.accountingBook.create({ data: { legalEntityId: entity.id, code: 'credit-test', namePersian: 'آزمون', createdBy: admin.id } });
  const year = await tx.accountingFiscalYear.create({ data: { bookId: book.id, code: 'credit-test', titlePersian: 'آزمون', startsAt: now, endsAt: new Date('2099-01-01'), createdBy: admin.id } });
  const period = await tx.accountingPostingPeriod.create({ data: { fiscalYearId: year.id, code: '1', titlePersian: 'آزمون', sequence: 1, startsAt: now, endsAt: year.endsAt } });
  await tx.accountingReplacementCutoverRun.create({ data: { id: randomUUID(), bookId: book.id, checkpointIdentity: 'QA', finalDeltaRunId: 'QA',
    exactReconciliationHash: 'QA', acceptanceHash: 'QA', writesBlocked: true, servicesDrained: true, status: 'AUTHORITY_TRANSFERRED',
    authorityTransferredAt: now, authorityTransferReason: 'rollback-only QA fixture', sepidarReadOnly: true, sabalanAuthoritative: true } });
  const profile = await tx.accountingCustomerProfile.create({ data: { legalEntityId: entity.id, accountingPartyId: randomUUID(),
    partySourceKind: 'CRM_CUSTOMER', partySourceId: contract.customerId, displayName: 'آزمون', activeFrom: now, createdBy: admin.id } });
  const addItem = async (credit: boolean, amount: number, posted: boolean) => {
    const voucher = await tx.accountingLedgerVoucher.create({ data: { bookId: book.id, fiscalYearId: year.id, periodId: period.id,
      referenceNumber: randomUUID(), idempotencyKey: randomUUID(), correlationId: randomUUID(), status: posted ? 'POSTED' : 'DRAFT',
      description: 'QA', documentDate: now, occurredAt: now, recordedAt: now, postedAt: posted ? now : null,
      sourceType: 'QA', sourceId: randomUUID(), sourceVersion: 1, sourceHash: 'QA', sourcePayload: {},
      debitTotalRials: amount, creditTotalRials: amount, contentHash: randomUUID(), createdBy: admin.id } });
    const invoice = await tx.accountingCommercialCustomerInvoice.create({ data: { profileId: profile.id, contractId: contract.id,
      contractVersion: 1, number: randomUUID(), ledgerVoucherId: voucher.id, controlPolicyId: 'QA', controlPolicyVersion: 1,
      controlEvidenceType: 'QA', controlEvidenceId: randomUUID(), controlEvidenceVersion: 1, controlEvidenceHash: 'QA',
      netRials: amount, taxRials: 0, grossRials: amount, issuedAt: now, dueAt: now, status: credit ? 'CREDIT_NOTE' : 'POSTED' } });
    await tx.accountingCustomerOpenItem.create({ data: { profileId: profile.id, invoiceId: invoice.id, contractId: contract.id,
      kind: credit ? 'CREDIT' : 'RECEIVABLE', originalRials: amount, dueAt: now, postedAt: now } });
    return voucher;
  };
  await addItem(false, 300, true);
  assert.equal((await consumedCustomerCredit(tx, approved)).toString(), '600', 'a partial delivered invoice does not cancel the uninvoiced promise');
  await addItem(false, 700, true);
  const credit = await addItem(true, 700, false);
  assert.equal((await consumedCustomerCredit(tx, approved)).toString(), '600');
  await tx.accountingLedgerVoucher.update({ where: { id: credit.id }, data: { status: 'POSTED', postedAt: now } });
  assert.equal((await consumedCustomerCredit(tx, approved)).toString(), '300');
}));

test('credit is consumed at Sales approval; saved finance is not dispatch approval; downgrade preserves authorization', () => fixture(async (tx, contract, admin) => {
  assert.equal((await customerCreditBalance(tx, contract.customerId)).usedRials, '0');
  assert.equal(ordinaryFinancialActionsAllowed(contract), false);
  const approved = await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  assert.equal(approved.status, 'PENDING_APPROVAL');
  assert.equal(hasSpecialCustomerCreditAuthorization(approved), true);
  assert.equal(ordinaryFinancialActionsAllowed(approved), true);
  await assertOrdinaryAccountingCommercialGate(tx, contract.id, 'CREATE_INVOICE', 1);
  assert.equal((await customerCreditBalance(tx, contract.customerId)).availableRials, '0');
  assert.equal(await ordinaryContractDispatchEligible(tx, approved), false);
  const record = await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: contract.id, sourceSnapshot: { commercialRevision: 1 }, amount: 1000, currency: 'ریال', createdBy: admin.id } });
  assert.equal(await ordinaryContractDispatchEligible(tx, approved), false);
  await tx.accountingFinancialRecord.update({ where: { id: record.id }, data: { status: 'ISSUED', financiallyApprovedAt: new Date(), systemInvoiceNumber: randomUUID(), systemInvoiceDate: new Date(), sepidarAmount: 1000 } });
  assert.equal(await ordinaryContractDispatchEligible(tx, approved), true);
  assert.equal((await customerCreditBalance(tx, contract.customerId)).usedRials, '600', 'financial approval does not release customer credit');
  await updateCustomerCreditPolicy(tx, admin.id, contract.customerId, { trustCategory: 'NORMAL', limitRials: '100', policyVersion: 0, reason: 'آزمون کاهش اعتبار' });
  assert.equal(ordinaryFinancialActionsAllowed(approved), true);
  assert.equal((await customerCreditBalance(tx, contract.customerId)).deficitRials, '500');
  await assert.rejects(updateCustomerCreditPolicy(tx, admin.id, contract.customerId, { trustCategory: 'SPECIAL', limitRials: null, policyVersion: 0, reason: 'نسخه قدیمی' }), /تغییر کرده/);
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { totalAmount: 700 } });
  await assert.rejects(validateSpecialCustomerCreditPlan(tx, approved), /باید خاص/);
  await tx.payment.updateMany({ where: { contractId: contract.id }, data: { totalAmount: 600 } });
  const edited = await tx.salesContract.update({ where: { id: contract.id }, data: { commercialRevision: 2, salesApprovalRevision: null, status: 'DRAFT' } });
  assert.equal(ordinaryFinancialActionsAllowed(edited), false);
  assert.equal(await ordinaryContractDispatchEligible(tx, edited), false);
  const renewed = await approveOrdinarySales(tx, contract.id, admin.id, undefined, 2);
  assert.equal(ordinaryFinancialActionsAllowed(renewed), true);
  assert.equal(await ordinaryContractDispatchEligible(tx, renewed), false, 'an old approved financial snapshot cannot authorize a corrected revision');
  await tx.accountingFinancialRecord.update({ where: { id: record.id }, data: { status: 'VOIDED' } });
  assert.equal(await ordinaryContractDispatchEligible(tx, renewed), false);
}));

test('insufficient limit leaves approval uncommitted; normal and Partner customers cannot acquire new credit', () => fixture(async (tx, contract, admin) => {
  await tx.crmCustomer.update({ where: { id: contract.customerId }, data: { creditLimitRials: 500 } });
  // Approval endpoint owns the enclosing transaction; a savepoint reproduces its atomic rollback.
  await tx.$executeRawUnsafe('SAVEPOINT credit_approval');
  await assert.rejects(approveOrdinarySales(tx, contract.id, admin.id, undefined, 1), /کسری 100/);
  await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT credit_approval');
  assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } })).status, 'DRAFT');
  assert.equal((await customerCreditBalance(tx, contract.customerId)).usedRials, '0');
  await tx.crmCustomer.update({ where: { id: contract.customerId }, data: { trustCategory: 'NORMAL' } });
  await assert.rejects(validateSpecialCustomerCreditPlan(tx, contract), /باید خاص/);
  await assert.rejects(validateSpecialCustomerCreditPlan(tx, { ...contract, partnerKind: 'PARTNER_CUSTOMER' }), /فقط برای مشتری مستقیم/);
}));

test('collections, uncleared checks, cancellation and date-change decisions preserve financial evidence', () => fixture(async (tx, contract, admin) => {
  const approved = await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  const receivable = await tx.accountingReceivable.create({ data: { contractId: contract.id, customerId: contract.customerId, originalAmount: 1000,
    remainingAmount: 1000, dueDate: new Date('2099-01-01'), createdBy: admin.id } });
  const payment = await tx.accountingPaymentStatus.create({ data: { contractId: contract.id, receivableId: receivable.id, method: 'CHECK',
    amount: 600, currency: 'ریال', status: 'RECEIVED', checkStatus: 'RECEIVED', createdBy: admin.id } });
  assert.equal((await consumedCustomerCredit(tx, approved)).toString(), '600');
  await tx.accountingPaymentStatus.update({ where: { id: payment.id }, data: { checkStatus: 'CLEARED' } });
  assert.equal((await consumedCustomerCredit(tx, approved)).toString(), '400');
  const date = await createDispatchRequest(tx, approved, admin.id, { kind: 'CUSTOMER_DATE', promisedDate: '2099-02-01', reason: 'تغییر موعد آزمون' });
  assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } })).customerCreditPromisedDate?.toISOString().slice(0, 10), '2099-01-01');
  await decideDispatchRequest(tx, date.id, admin.id, 'APPROVE');
  assert.equal((await tx.payment.findFirstOrThrow({ where: { contractId: contract.id } })).paymentDate?.toISOString().slice(0, 10), '2099-02-01');
  await assert.rejects(decideDispatchRequest(tx, date.id, admin.id, 'DECLINE', 'تصمیم دوم'));
  const cancelled = await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'CANCELLED' } });
  assert.equal((await consumedCustomerCredit(tx, cancelled)).toString(), '400');
  await tx.accountingReceivable.update({ where: { id: receivable.id }, data: { status: 'VOIDED' } });
  assert.equal((await consumedCustomerCredit(tx, cancelled)).toString(), '0');
}));

test('due customer-credit reminder is delivered once without releasing credit', () => fixture(async (tx, contract, admin) => {
  await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  await tx.salesContract.update({ where: { id: contract.id }, data: { customerCreditPromisedDate: new Date('2000-01-01') } });
  const inTransaction = new Proxy(tx, { get: (object, key) => key === '$transaction' ? (work: any) => work(tx) : (object as any)[key] });
  await processContractCreditReminders(inTransaction as unknown as PrismaClient, new Date('2000-01-01T12:00:00Z'));
  const count = await tx.notificationEvent.count({ where: { resourceId: contract.id, deduplicationKey: { startsWith: 'special-customer-credit-promise:' } } });
  assert.ok(count > 0);
  await processContractCreditReminders(inTransaction as unknown as PrismaClient, new Date('2000-01-01T12:00:00Z'));
  assert.equal(await tx.notificationEvent.count({ where: { resourceId: contract.id, deduplicationKey: { startsWith: 'special-customer-credit-promise:' } } }), count);
  assert.equal((await customerCreditBalance(tx, contract.customerId)).usedRials, '600');
}));

test('concurrent approvals cannot consume the same customer headroom', async () => {
  const db = new PrismaClient({ datasources: { db: { url } } });
  let customerId: string | undefined;
  const ids: string[] = [];
  try {
    const source = await db.salesContract.findFirstOrThrow({ where: { partnerKind: null, partnerCaseId: null } });
    const admin = await db.user.findFirstOrThrow({ where: { role: 'ADMIN', isActive: true } });
    customerId = (await db.crmCustomer.create({ data: { firstName: 'QA-SPECIAL-RACE', lastName: randomUUID(), trustCategory: 'SPECIAL', creditLimitRials: 1000 } })).id;
    for (let index = 0; index < 2; index++) {
      const contract = await db.salesContract.create({ data: { contractNumber: `QA-SPECIAL-RACE-${randomUUID()}`, title: 'QA', titlePersian: 'آزمون همزمانی اعتبار مشتری', content: 'QA',
        customerId, departmentId: source.departmentId, createdBy: source.createdBy, responsibleSellerId: source.responsibleSellerId,
        totalAmount: 1000, currency: 'ریال', commercialFlowVersion: 1, commercialRevision: 1, commercialExpiresAt: new Date('2099-01-01') } });
      ids.push(contract.id);
      await db.payment.create({ data: { contractId: contract.id, paymentMethod: 'SPECIAL_CUSTOMER_CREDIT', totalAmount: 600, currency: 'ریال', paymentDate: new Date('2099-01-01') } });
    }
    const results = await Promise.allSettled(ids.map(id => db.$transaction(tx => approveOrdinarySales(tx, id, admin.id, undefined, 1), { timeout: 30_000 })));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal((await customerCreditBalance(db, customerId)).usedRials, '600');
    assert.equal(await db.salesContract.count({ where: { id: { in: ids }, status: 'DRAFT', customerCreditRevision: null } }), 1);
  } finally {
    if (ids.length) {
      await db.accountingAuditLog.deleteMany({ where: { contractId: { in: ids } } });
      await db.salesContract.deleteMany({ where: { id: { in: ids } } });
    }
    if (customerId) await db.crmCustomer.deleteMany({ where: { id: customerId } });
    await db.$disconnect();
  }
});

test('special-credit correction returns to Accounting on renewed Sales approval without customer acceptance', () => fixture(async (tx, contract, admin) => {
  await approveOrdinarySales(tx, contract.id, admin.id, undefined, 1);
  await tx.salesContract.update({ where: { id: contract.id }, data: { firstFinancialRecordAt: new Date() } });
  await tx.accountingFinancialRecord.create({ data: { kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT', contractId: contract.id, amount: 1000, currency: 'ریال', createdBy: admin.id } });
  const request = await requestAccountingSalesContractCorrection(tx, { contractId: contract.id, actorUserId: admin.id,
    category: 'OTHER', priority: 'MEDIUM', reason: 'آزمون اصلاح قرارداد اعتباری مشتری خاص', idempotencyKey: randomUUID() });
  await respondToCrossWorkspaceDuty(tx, { dutyId: request.duty.id, actorUserId: admin.id, actionCode: 'APPROVE',
    expectedSourceVersion: 1, expectedEnvelopeVersion: 1, reason: null, policyVersion: 2 });
  await tx.salesContract.update({ where: { id: contract.id }, data: { status: 'DRAFT', commercialRevision: 2, salesApprovalRevision: null, customerAcceptanceRevision: null } });
  const renewed = await approveOrdinarySales(tx, contract.id, admin.id, undefined, 2);
  assert.equal(renewed.status, 'PENDING_APPROVAL');
  assert.equal(renewed.customerAcceptanceRevision, null);
  assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: request.correction.id } })).status, 'SALES_EDITED');
  assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceId: request.correction.id, sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN' } }), 0);
}));
