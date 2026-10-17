import { Prisma, type PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { canonicalHash } from '@sabalanerp/partner-sales-contracts';
import { historicalAccountingFixture, writerBoundAccountingFixture } from './partnerAccountingHistoricalReadFixture';
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export async function seedHistoricalAccountingRead(database: PrismaClient, password = 'HistoricalAccountingQa2026!', writerBound = false) {
    const f = writerBound ? await writerBoundAccountingFixture(true) : await historicalAccountingFixture();
    const row = f.row;
    await database.$transaction(async tx => {
      // Fixture assembly only, in the isolated exact-schema database. This
      // bypasses writer triggers without replacing any reader or integrity code.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      for (const id of ['historical-admin', 'historical-partner']) await tx.user.create({ data: { id, username: id,
        email: `${id}@example.invalid`, password: await bcrypt.hash(password, 4), firstName: 'Fixture', lastName: 'Accounting', role: id === 'historical-admin' ? 'ADMIN' : 'USER' } });
      await tx.department.create({ data: { id: 'historical-department', name: 'Historical', namePersian: 'آزمون' } });
      await tx.partnerProfile.create({ data: { id: row.profileId, userId: 'historical-partner', state: 'ACTIVE' } });
      await tx.partnerCommercialAccount.create({ data: { id: 'historical-account', profileId: row.profileId } });
      await tx.crmCustomer.create({ data: { id: 'historical-customer', firstName: 'Fixture', lastName: 'Customer',
        ownerUserId: 'historical-partner', createdBy: 'historical-partner' } });
      await tx.partnerSaleCase.create({ data: { id: row.id, profileId: row.profileId, customerId: 'historical-customer',
        caseNumber: row.caseNumber, internalRecordId: row.internalRecordId, customerContractId: row.customerContractId,
        state: 'COMMITTED', committedAt: new Date('2026-10-01'), commitmentTrigger: 'SIGNED', committedRevision: 1,
        commitmentEventId: 'historical-commit-event', pricingState: 'READY_TO_FINALIZE', headRevision: 1, integrityHash: row.integrityHash } });
      await tx.partnerCaseRevision.create({ data: { ...f.revision, caseId: row.id, revision: 1, actorId: 'historical-partner',
        commandId: 'historical-fixture-create', graph: json(f.revision.graph), partySnapshots: json(f.revision.partySnapshots),
        wholesaleEnvelope: json(f.revision.wholesaleEnvelope), retailEnvelope: json(f.revision.retailEnvelope),
        paymentEvidence: json(f.revision.paymentEvidence), customerContent: json(f.revision.customerContent),
        internalProjection: json(f.revision.internalProjection), customerProjection: json(f.revision.customerProjection), pricingState: 'READY_TO_FINALIZE' } });
      await tx.sabalanToPartnerSaleRecord.create({ data: { id: row.internalRecordId, caseId: row.id,
        recordNumber: row.internalRecord.recordNumber, commercialAccountId: 'historical-account', expectedRevision: 1,
        integrityHash: row.integrityHash, pricingState: 'READY_TO_FINALIZE' } });
      await tx.salesContract.create({ data: { id: row.customerContractId, contractNumber: row.customerContract.contractNumber,
        title: 'Historical test', titlePersian: 'آزمون تاریخچه', content: 'Fixture', customerId: 'historical-customer',
        departmentId: 'historical-department', createdBy: 'historical-partner', responsibleSellerId: 'historical-partner', partnerKind: 'PARTNER_CUSTOMER',
        partnerCaseId: row.id, partnerRevision: 1, partnerIntegrityHash: row.integrityHash } });
      for (let version = 1; version <= f.persistedPlan.version; version++) {
        const id = version >= 4 ? `current-plan-${version}` : `historical-plan-${version}`;
        const original = version === 4 && writerBound ? f.storedPlans.get('current-plan-4')!.evidence
          : version === f.persistedPlan.version ? f.persistedPlan.evidence : f.revision.paymentEvidence.sabalanPaymentPlan;
        const { predecessorPlanId: _historicalPredecessor, ...historicalPlan } = original;
        const predecessorPlanId = version === 5 ? 'current-plan-4' : `historical-plan-${version - 1}`;
        const plan = { ...historicalPlan, planId: id, version,
          ...(version === 1 ? {} : { predecessorPlanId }) };
        await tx.partnerPaymentPlan.create({ data: { id, caseId: row.id, caseRevision: 1, purpose: 'SABALAN', version,
          predecessorId: version === 1 ? null : predecessorPlanId, effectiveDate: f.persistedPlan.effectiveDate,
          evidence: json(plan), integrityHash: await canonicalHash({ purpose: 'PARTNER_SABALAN_PAYMENT_PLAN',
            schemaVersion: 1, caseId: row.id, revision: 1, plan }),
          installments: { create: plan.installments.map(item => ({ id: item.installmentId, dueDate: new Date(item.dueDate),
            amount: item.amount.amount, currency: item.amount.currency, method: item.method, evidence: json(item) })) } } });
      }
      await tx.accountingFinancialRecord.create({ data: { ...f.invoice, status: 'DRAFT', kind: 'INVOICE_CANDIDATE',
        sourceSnapshot: json(f.invoice.sourceSnapshot), metadata: json(f.invoice.metadata), createdBy: 'historical-admin' } });
      await tx.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    });

    return { fixture: f, actorId: 'historical-admin', username: 'historical-admin', password };
}
