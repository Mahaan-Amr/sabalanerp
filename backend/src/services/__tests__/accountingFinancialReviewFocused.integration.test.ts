import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { seedHistoricalAccountingRead } from './partnerAccountingHistoricalReadSeed';

const recordId = 'partner-accounting:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:replacement:00000000-0000-4000-8000-000000000001';

test('exact financial review and history retain authority, evidence and data without reading unrelated Cases', async () => {
  const sourceDatabaseUrl = process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '';
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: process.cwd(), sourceDatabaseUrl });
  const database = temporary.client();
  try {
    const { fixture } = await seedHistoricalAccountingRead(database, undefined, false,
      { invoiceId: recordId, customerContractNumber: '900001' });
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (let index = 0; index < 42; index++) {
        const id = `review-unrelated-${index}`;
        await tx.partnerSaleCase.create({ data: { id, caseNumber: id, profileId: fixture.row.profileId,
          customerId: 'historical-customer', internalRecordId: `internal-${id}`, customerContractId: `contract-${id}`,
          headRevision: 1, integrityHash: fixture.row.integrityHash, state: 'COMMITTED',
          committedAt: new Date('2026-10-01'), commitmentTrigger: 'SIGNED', committedRevision: 1,
          commitmentEventId: `event-${id}` } });
        await tx.sabalanToPartnerSaleRecord.create({ data: { id: `internal-${id}`, caseId: id, recordNumber: `record-${id}`,
          commercialAccountId: 'historical-account', expectedRevision: 1, integrityHash: fixture.row.integrityHash } });
        await tx.salesContract.create({ data: { id: `contract-${id}`, contractNumber: `number-${id}`,
          title: 'Unrelated', titlePersian: 'پرونده نامرتبط آزمون', content: '', customerId: 'historical-customer',
          departmentId: 'historical-department', createdBy: 'historical-partner', responsibleSellerId: 'historical-partner', partnerKind: 'PARTNER_CUSTOMER',
          partnerCaseId: id, partnerRevision: 1, partnerIntegrityHash: fixture.row.integrityHash } });
      }
      await tx.salesContract.create({ data: { id: 'review-ordinary-contract', contractNumber: 'review-ordinary-number',
        title: 'Ordinary', titlePersian: 'قرارداد عادی آزمون', content: '', customerId: 'historical-customer',
        departmentId: 'historical-department', createdBy: 'historical-admin', responsibleSellerId: 'historical-admin' } });
      await tx.accountingFinancialRecord.createMany({ data: [
        // A broken unrelated source must not prevent this exact review from opening.
        { id: 'unrelated-corrupt', kind: 'INVOICE_CANDIDATE', sourceKind: 'PARTNER_INTERNAL_RECORD',
          sourceId: 'internal-review-unrelated-0', metadata: { partnerCaseId: 'review-unrelated-0' },
          amount: 99, currency: 'IRR', createdBy: 'historical-admin' },
        { id: 'hidden-orphan', kind: 'INVOICE_CANDIDATE', sourceKind: 'PARTNER_INTERNAL_RECORD',
          sourceId: 'missing-private-owner', amount: 99, createdBy: 'historical-admin' },
        { id: 'disguised-ordinary', kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT',
          metadata: { nested: [{ partnerCaseId: 'historical-case' }] }, amount: 99, createdBy: 'historical-admin' },
        { id: 'ordinary-review-invoice', kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT',
          contractId: 'review-ordinary-contract', sourceId: 'review-ordinary-contract', sourceSnapshot: { partnerCaseId: null },
          amount: 200, currency: 'IRR', createdBy: 'historical-admin' },
        { id: 'ordinary%3Aidentity', kind: 'INVOICE_CANDIDATE', sourceKind: 'SALES_CONTRACT',
          contractId: 'review-ordinary-contract', sourceId: 'review-ordinary-contract', amount: 50, currency: 'IRT', createdBy: 'historical-admin' },
      ] });
      await tx.accountingReceivable.create({ data: { id: 'review-ordinary-receivable', invoiceRecordId: 'ordinary-review-invoice',
        contractId: 'review-ordinary-contract', originalAmount: 200, paidAmount: 20, remainingAmount: 180, currency: 'IRR',
        dueDate: new Date('2026-11-25'), createdBy: 'historical-admin' } });
      await tx.accountingPaymentStatus.create({ data: { id: 'review-ordinary-payment', receivableId: 'review-ordinary-receivable',
        contractId: 'review-ordinary-contract', method: 'CASH', status: 'RECEIVED', amount: 2, currency: 'IRT', createdBy: 'historical-admin' } });
      await tx.accountingAuditLog.createMany({ data: [
        { id: 'review-valid', recordId, entityId: recordId, action: 'REVIEW_FIXTURE', actorId: 'historical-admin',
          note: 'تاریخچه محفوظ', afterState: { partnerCaseId: 'historical-case' } },
        { id: 'review-legacy-unknown', recordId, entityId: 'legacy-note-identifier', action: 'REVIEW_FIXTURE', actorId: 'historical-admin' },
        { id: 'review-private-unknown', recordId, entityId: 'unknown-private-entity', action: 'REVIEW_FIXTURE', actorId: 'historical-admin',
          afterState: { nested: { partnerCaseId: 'historical-case' } } },
        { id: 'review-hidden-entity', recordId, entityId: 'hidden-orphan', action: 'REVIEW_FIXTURE', actorId: 'historical-admin' },
        { id: 'review-private-mixed', recordId, entityId: 'hidden-orphan', action: 'REVIEW_FIXTURE', actorId: 'historical-admin',
          afterState: { partnerCaseId: 'historical-case' } },
        { id: 'review-foreign-contract', recordId, contractId: 'contract-review-unrelated-1', action: 'REVIEW_FIXTURE', actorId: 'historical-admin' },
        { id: 'review-orphan-history', recordId: 'missing-financial-record', action: 'REVIEW_FIXTURE', actorId: 'historical-admin',
          afterState: { partnerCaseId: 'historical-case' } },
      ] });
    });
    const output = execFileSync(process.execPath, [path.resolve('backend/node_modules/tsx/dist/cli.mjs'),
      'backend/src/services/__tests__/accountingFinancialReviewFocusedProbe.ts'], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 90_000,
      env: { ...process.env, DATABASE_URL: temporary.databaseUrl, ACCOUNTING_REVIEW_RECORD_ID: recordId },
    });
    console.log(output.trim());
    assert.match(output, /focused-financial-review-passed/);
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});
