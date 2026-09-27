import assert from 'node:assert/strict';
import {
  AccountingRecordStatus, AccountingSourceKind, CorrectionRequestCategory,
  FinancialRecordKind, PrismaClient,
} from '@prisma/client';
import { assertCorrectionFinancialWorkflowReady } from '../accountingService';

const url = new URL(process.env.DATABASE_URL || '');
assert(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === '55432',
  'Only the existing sabalanerp-local database is allowed');

const rollback = Symbol('rollback accounting correction verification');
const run = async () => {
const client = new PrismaClient();
try {
  let verified = false;
  try {
    await client.$transaction(async tx => {
      const suffix = `correction-verification-${Date.now()}`;
      const actor = await tx.user.create({ data: {
        email: `${suffix}@example.invalid`, username: suffix, password: 'not-a-login-secret',
        firstName: 'QA', lastName: 'Accounting',
      } });
      const department = await tx.department.create({ data: {
        name: suffix, namePersian: 'آزمون حسابداری',
      } });
      const customer = await tx.crmCustomer.create({ data: {
        firstName: 'QA', lastName: 'Customer', createdBy: actor.id,
      } });
      const contract = await tx.salesContract.create({ data: {
        contractNumber: suffix, title: suffix, titlePersian: 'آزمون اصلاح',
        content: 'QA', customerId: customer.id, departmentId: department.id,
        createdBy: actor.id, responsibleSellerId: actor.id,
        totalAmount: 920_696_000, currency: 'تومان',
      } });
      const source = await tx.accountingFinancialRecord.create({ data: {
        kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.ISSUED,
        sourceKind: AccountingSourceKind.SALES_CONTRACT, sourceId: contract.id,
        contractId: contract.id, amount: 8_750_000_000,
        financiallyApprovedAt: new Date(), createdBy: actor.id,
      } });
      const correction = await tx.accountingCorrectionRequest.create({ data: {
        contractId: contract.id, recordId: source.id,
        category: CorrectionRequestCategory.AMOUNT_PRICING, status: 'SALES_EDITED',
        accountantNote: 'مبلغ قرارداد اصلاح شد', createdBy: actor.id,
      } });

      await assert.rejects(assertCorrectionFinancialWorkflowReady(tx, correction.id),
        /CORRECTION_FINANCIAL_WORKFLOW_INCOMPLETE/);
      await tx.accountingFinancialRecord.update({ where: { id: source.id },
        data: { status: AccountingRecordStatus.VOIDED } });
      await assert.rejects(assertCorrectionFinancialWorkflowReady(tx, correction.id),
        /CORRECTION_FINANCIAL_WORKFLOW_INCOMPLETE/);
      const replacement = await tx.accountingFinancialRecord.create({ data: {
        kind: FinancialRecordKind.INVOICE_CANDIDATE, status: AccountingRecordStatus.DRAFT,
        sourceKind: AccountingSourceKind.SALES_CONTRACT, sourceId: contract.id,
        contractId: contract.id, amount: 9_206_960_000,
        metadata: { correctionRequestId: correction.id, replacesRecordId: source.id },
        createdBy: actor.id,
      } });
      await assert.rejects(assertCorrectionFinancialWorkflowReady(tx, correction.id),
        /CORRECTION_FINANCIAL_WORKFLOW_INCOMPLETE/);
      await tx.accountingFinancialRecord.update({ where: { id: replacement.id },
        data: { financiallyApprovedAt: new Date() } });
      assert.equal((await assertCorrectionFinancialWorkflowReady(tx, correction.id)).canResolve, true);
      verified = true;
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  assert.equal(verified, true);
} finally {
  await client.$disconnect();
}
};

run().catch(error => { console.error(error); process.exitCode = 1; });
