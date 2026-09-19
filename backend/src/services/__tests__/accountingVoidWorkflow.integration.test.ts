import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AccountingPaymentMethod,
  AccountingRecordStatus,
  AccountingSourceKind,
  AccountingVoidCaseStatus,
  CheckAccountingStatus,
  FinancialRecordKind,
  PaymentAccountingStatus,
  Prisma,
  ReceivableStatus,
  TaxReadinessStatus,
  TaxSubmissionStatus,
} from '@prisma/client';
import { prisma } from '../../lib/prisma';
import { AccountingVoidBlockedError, executeAccountingAction } from '../accountingService';

test('ordinary Accounting voids a duplicate invoice only after receipt reversal and receivable void', async () => {
  const token = `void-workflow-${Date.now()}`;
  const contractId = `${token}-contract`;
  const actor = { userId: `${token}-manager`, role: 'ADMIN' };
  const createdAt = new Date(Date.now() - 60_000);
  const effectiveAt = new Date().toISOString();
  try {
    const retained = await prisma.accountingFinancialRecord.create({ data: {
      kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.ISSUED,
      sourceKind: AccountingSourceKind.SALES_CONTRACT, sourceId: contractId, contractId,
      amount: new Prisma.Decimal(1_000), systemInvoiceNumber: `${token}-1405`,
      systemInvoiceDate: createdAt, financiallyApprovedAt: createdAt, financiallyApprovedBy: actor.userId,
      createdBy: actor.userId, createdAt,
    } });
    const source = await prisma.accountingFinancialRecord.create({ data: {
      kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.ISSUED,
      sourceKind: AccountingSourceKind.SALES_CONTRACT, sourceId: contractId, contractId,
      amount: new Prisma.Decimal(1_000), systemInvoiceNumber: `${token}-1406`,
      systemInvoiceDate: createdAt, financiallyApprovedAt: createdAt, financiallyApprovedBy: actor.userId,
      createdBy: actor.userId, createdAt,
    } });
    const receivable = await prisma.accountingReceivable.create({ data: {
      contractId, invoiceRecordId: source.id, originalAmount: new Prisma.Decimal(1_000),
      paidAmount: new Prisma.Decimal(100), remainingAmount: new Prisma.Decimal(900),
      dueDate: new Date(Date.now() + 86_400_000), status: ReceivableStatus.PARTIALLY_PAID, createdBy: actor.userId,
    } });
    const payment = await prisma.accountingPaymentStatus.create({ data: {
      contractId, receivableId: receivable.id, method: AccountingPaymentMethod.CASH,
      amount: new Prisma.Decimal(100), status: PaymentAccountingStatus.RECEIVED,
      occurredAt: createdAt, createdBy: actor.userId,
      metadata: { collectionMovements: [{ kind: 'RECEIVED', effectiveAt: createdAt.toISOString(), amount: '100.00' }] },
    } });
    const check = await prisma.accountingPaymentStatus.create({ data: {
      contractId, receivableId: receivable.id, method: AccountingPaymentMethod.CHECK,
      amount: new Prisma.Decimal(50), status: PaymentAccountingStatus.RECEIVED,
      checkStatus: CheckAccountingStatus.RECEIVED, occurredAt: createdAt, createdBy: actor.userId,
    } });
    const submittedTax = await prisma.accountingTaxRecord.create({ data: {
      contractId, invoiceRecordId: source.id, readinessStatus: TaxReadinessStatus.READY,
      submissionStatus: TaxSubmissionStatus.SUBMITTED_MANUALLY, missingFields: [], createdBy: actor.userId,
    } });

    await assert.rejects(() => executeAccountingAction({
      kind: 'START_ACCOUNTING_VOID_CASE', recordId: source.id, retainedRecordId: retained.id,
      reasonKind: 'DUPLICATE_ISSUE', reason: 'صدور تکراری',
    }, actor), /تاریخ مؤثر/);

    const started = await executeAccountingAction({
      kind: 'START_ACCOUNTING_VOID_CASE', recordId: source.id, retainedRecordId: retained.id,
      reasonKind: 'DUPLICATE_ISSUE', reason: 'صدور تکراری', effectiveAt,
    }, actor);
    assert.equal(started.status, 'APPLIED');

    await assert.rejects(() => executeAccountingAction({
      kind: 'UPDATE_CHECK_STATUS', paymentEventId: check.id, status: 'CLEARED', occurredAt: effectiveAt,
    }, actor), /فقط «عودت چک» یا «برگشت خورد»/);
    await assert.rejects(() => executeAccountingAction({
      kind: 'MARK_TAX_READY', invoiceId: source.id, readiness: 'READY',
    }, actor), /فعالیت مالی جدید نمی‌پذیرد/);
    await assert.rejects(() => executeAccountingAction({
      kind: 'TRACK_TAX_SUBMISSION', invoiceId: source.id, status: 'ACCEPTED',
    }, actor), /فعالیت مالی جدید نمی‌پذیرد/);

    await assert.rejects(() => executeAccountingAction({
      kind: 'VOID_ACCOUNTING_RECEIVABLE', receivableId: receivable.id, reason: 'وابسته به فاکتور تکراری', effectiveAt,
    }, actor), (error: unknown) => error instanceof AccountingVoidBlockedError && /ابتدا دریافت/.test(error.message));

    await executeAccountingAction({ kind: 'REVERSE_RECEIPT', paymentEventId: payment.id,
      reason: 'برگشت پیش از ابطال فاکتور تکراری', effectiveAt }, actor);
    await executeAccountingAction({ kind: 'UPDATE_CHECK_STATUS', paymentEventId: check.id,
      status: 'RETURNED', note: 'عودت پیش از ابطال فاکتور تکراری', occurredAt: effectiveAt }, actor);
    await executeAccountingAction({ kind: 'RESOLVE_TAX_FOR_VOID', taxRecordId: submittedTax.id,
      reason: 'تعیین‌تکلیف مالیات فاکتور تکراری', effectiveAt }, actor);
    const openCase = await prisma.accountingFinancialVoidCase.findFirstOrThrow({ where: { sourceRecordId: source.id } });
    await assert.rejects(() => executeAccountingAction({ kind: 'CANCEL_ACCOUNTING_VOID_CASE', voidCaseId: openCase.id,
      cancellationReason: 'نباید پس از تغییر مالی ممکن باشد' }, actor), /پس از اولین تغییر مالی/);
    await executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECEIVABLE', receivableId: receivable.id,
      reason: 'دریافتنی فاکتور تکراری', effectiveAt }, actor);
    await executeAccountingAction({ kind: 'VOID_ACCOUNTING_RECORD', recordId: source.id }, actor);

    const [finalPayment, finalCheck, finalReceivable, finalSource, finalCase, finalTax, finalVoidAudit] = await Promise.all([
      prisma.accountingPaymentStatus.findUniqueOrThrow({ where: { id: payment.id } }),
      prisma.accountingPaymentStatus.findUniqueOrThrow({ where: { id: check.id } }),
      prisma.accountingReceivable.findUniqueOrThrow({ where: { id: receivable.id } }),
      prisma.accountingFinancialRecord.findUniqueOrThrow({ where: { id: source.id } }),
      prisma.accountingFinancialVoidCase.findFirstOrThrow({ where: { sourceRecordId: source.id } }),
      prisma.accountingTaxRecord.findUniqueOrThrow({ where: { id: submittedTax.id } }),
      prisma.accountingAuditLog.findFirstOrThrow({ where: { contractId, action: 'VOID_ACCOUNTING_RECORD' } }),
    ]);
    assert.equal(finalPayment.status, PaymentAccountingStatus.REVERSED);
    assert.equal(finalCheck.checkStatus, CheckAccountingStatus.RETURNED);
    assert.equal(finalReceivable.paidAmount.toString(), '0');
    assert.equal(finalReceivable.status, ReceivableStatus.VOIDED);
    assert.equal(finalSource.status, AccountingRecordStatus.VOIDED);
    assert.equal(finalCase.status, AccountingVoidCaseStatus.COMPLETED);
    assert.equal(finalTax.readinessStatus, TaxReadinessStatus.NOT_READY);
    assert.equal(finalTax.submissionStatus, TaxSubmissionStatus.NOT_READY);
    assert.equal((finalTax.metadata as { voidedWithInvoiceRecordId?: string }).voidedWithInvoiceRecordId, source.id);
    assert.equal((finalTax.metadata as { voidCaseId?: string }).voidCaseId, finalCase.id);
    assert.equal(((finalVoidAudit.afterState as { metadata?: { voidCaseId?: string } })?.metadata?.voidCaseId), finalCase.id);
  } finally {
    await prisma.accountingAuditLog.deleteMany({ where: { contractId } });
    await prisma.accountingFinancialVoidCase.deleteMany({ where: { contractId } });
    await prisma.accountingTaxRecord.deleteMany({ where: { contractId } });
    await prisma.accountingPaymentStatus.deleteMany({ where: { contractId } });
    await prisma.accountingReceivable.deleteMany({ where: { contractId } });
    await prisma.accountingFinancialRecord.deleteMany({ where: { contractId } });
  }
});
