import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, partnerError, type PartnerCommand, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { createPrismaPartnerFinancialCorrectionServices } from '../crossWorkspaceDutyAdapters/partnerFinancialCorrectionAdapter';
import { partnerVoidingInspectionHash } from '../partnerSales/corrections/voiding';
import type { PartnerCorrectionDependencyInput } from '../partnerSales/corrections/dependencyChecks';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { capturePartnerContractedQuantities, readPartnerShipmentQuantityProjection } from '../partnerSales/fulfillment/quantityStore';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') {
    throw new Error('Existing sabalanerp-local database required');
  }
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10'); return url.toString();
}

const hash = (character: string) => `sha256-v1:${character.repeat(64)}`;
const idsFor = (prefix: string) => ({ caseId: `${prefix}-case`, partnerId: `${prefix}-partner`, profileId: `${prefix}-profile`,
  customerId: `${prefix}-customer`, departmentId: `${prefix}-department`, accountId: `${prefix}-account`,
  internalId: `${prefix}-internal`, contractId: `${prefix}-contract`, commitmentId: `${prefix}-commitment` });

async function seedCommittedCase(tx: Prisma.TransactionClient, ids: ReturnType<typeof idsFor>,
  profileState: 'ACTIVE' | 'SUSPENDED' = 'SUSPENDED'): Promise<RevisionRef> {
  const owner = { caseId: ids.caseId, revision: 1, integrityHash: hash('a') };
  await tx.user.create({ data: { id: ids.partnerId, username: ids.partnerId, email: `${ids.partnerId}@example.invalid`,
    password: 'not-a-login', firstName: 'Partner', lastName: 'Correction' } });
  await tx.department.create({ data: { id: ids.departmentId, name: ids.departmentId, namePersian: ids.departmentId } });
  await tx.partnerProfile.create({ data: { id: ids.profileId, userId: ids.partnerId, state: profileState } });
  await tx.partnerCommercialAccount.create({ data: { id: ids.accountId, profileId: ids.profileId } });
  await tx.crmCustomer.create({ data: { id: ids.customerId, firstName: 'Customer', lastName: 'Correction',
    ownerUserId: ids.partnerId, createdBy: ids.partnerId } });
  await tx.partnerSaleCase.create({ data: { id: ids.caseId, caseNumber: `${ids.caseId}-number`, profileId: ids.profileId,
    customerId: ids.customerId, internalRecordId: ids.internalId, customerContractId: ids.contractId,
    headRevision: 1, integrityHash: owner.integrityHash } });
  await tx.partnerCaseRevision.create({ data: { caseId: ids.caseId, revision: 1, integrityHash: owner.integrityHash,
    graphHash: hash('b'), graph: {}, partySnapshots: {},
    wholesaleEnvelope: { schemaVersion: 1, totals: { net: '900', discount: '50', tax: '100', charges: '50', payable: '1000', currency: 'IRR' } },
    retailEnvelope: { schemaVersion: 1, totals: { net: '1200', discount: '0', tax: '0', charges: '0', payable: '1200', currency: 'IRR' } }, paymentEvidence: {}, customerContent: {},
    internalProjection: {}, customerProjection: {}, actorId: ids.partnerId, commandId: `${ids.caseId}-create` } });
  await tx.partnerProductRow.create({ data: { id: `${ids.caseId}-seed-row`, caseId: ids.caseId } });
  await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 1,
    productRowId: `${ids.caseId}-seed-row`, configurationHash: hash('9'), quantity: '1', unit: 'piece',
    precisionPolicyVersion: 'exact-v1' } });
  await tx.sabalanToPartnerSaleRecord.create({ data: { id: ids.internalId, recordNumber: `${ids.internalId}-number`,
    caseId: ids.caseId, commercialAccountId: ids.accountId, expectedRevision: 1, integrityHash: owner.integrityHash } });
  await tx.salesContract.create({ data: { id: ids.contractId, contractNumber: `${ids.contractId}-number`,
    title: 'Partner customer sale', titlePersian: 'قرارداد مشتری همکار', content: 'متن قرارداد',
    customerId: ids.customerId, departmentId: ids.departmentId, createdBy: ids.partnerId,
    responsibleSellerId: ids.partnerId, partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: ids.caseId,
    partnerRevision: 1, partnerIntegrityHash: owner.integrityHash, totalAmount: '1200', currency: 'IRR',
    status: 'SIGNED', contractData: {} } });
  await tx.partnerSaleCase.update({ where: { id: ids.caseId }, data: {
    state: 'AWAITING_CUSTOMER_CONFIRMATION', stateRevision: 2,
  } });
  await tx.partnerSaleCase.update({ where: { id: ids.caseId }, data: {
    state: 'CUSTOMER_APPROVED', stateRevision: 3,
  } });
  await tx.partnerCaseEvent.create({ data: { id: ids.commitmentId, caseId: ids.caseId, caseRevision: 1,
    integrityHash: owner.integrityHash, sequence: 1, stateRevision: 4, type: 'CASE_COMMITTED',
    fromState: 'CUSTOMER_APPROVED', toState: 'COMMITTED', actorId: ids.partnerId,
    commandId: `${ids.caseId}-commit`, correlationId: `${ids.caseId}-commit`, effectiveDate: new Date('2026-08-30'), evidence: {} } });
  await tx.partnerSaleCase.update({ where: { id: ids.caseId }, data: { state: 'COMMITTED', stateRevision: 4,
    commitmentEventId: ids.commitmentId,
    committedRevision: 1, committedAt: new Date('2026-08-30T08:00:00.000Z'), commitmentTrigger: 'SIGNED' } });
  return owner;
}

async function remediationCommand(actorId: string, owner: RevisionRef) {
  const intent = { reason: 'ابطال داخلی مستند پس از تعلیق همکار' };
  return { schemaVersion: 1, type: 'VOID_REMEDIATION_REQUEST', commandId: `${owner.caseId}-void-request`,
    correlationId: `${owner.caseId}-void-request`, expected: owner, expectedState: 'COMMITTED', ...intent,
    idempotency: { actorId, operation: 'VOID_REMEDIATION_REQUEST', targetId: owner.caseId,
      key: `${owner.caseId}-void-request`, payloadHash: await canonicalHash({ schemaVersion: 1,
        type: 'VOID_REMEDIATION_REQUEST', ...intent }) } } as Extract<PartnerCommand, { type: 'VOID_REMEDIATION_REQUEST' }>;
}

async function gateCommand(actorId: string, owner: RevisionRef, correctionId: string,
  gate: Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>['gate']) {
  const intent = { correctionId, gate, outcome: 'APPROVE' as const, evidenceId: `${correctionId}-${gate}-evidence`,
    reason: 'تأیید مستند مرحله ابطال پرونده' };
  return { schemaVersion: 1, type: 'CORRECTION_GATE', commandId: `${correctionId}-${gate}-command`,
    correlationId: `${correctionId}-${gate}-correlation`, expected: owner, expectedState: 'COMMITTED', ...intent,
    idempotency: { actorId, operation: 'CORRECTION_GATE', targetId: owner.caseId, key: `${correctionId}-${gate}-key`,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CORRECTION_GATE', ...intent }) } } as
      Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>;
}

test('real-schema voiding commits cancellation, internal adjustment, audit and notice together', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback Partner financial correction fixture');
  try {
    await database.$transaction(async tx => {
      const ids = idsFor(`partner-correction-${randomUUID()}`);
      const owner = await seedCommittedCase(tx, ids);
      const invoice = await tx.accountingFinancialRecord.create({ data: { id: `${ids.caseId}-invoice`,
        kind: 'INVOICE_CANDIDATE', status: 'ISSUED', sourceKind: 'SALES_CONTRACT', sourceId: ids.internalId,
        contractId: ids.contractId, customerId: ids.customerId, amount: '1000', currency: 'IRR',
        financiallyApprovedAt: new Date('2026-08-30T07:00:00.000Z'), financiallyApprovedBy: ids.partnerId,
        createdBy: ids.partnerId, metadata: { partnerCaseId: ids.caseId } } });
      const receivable = await tx.accountingReceivable.create({ data: { id: `${ids.caseId}-receivable`,
        contractId: ids.contractId, invoiceRecordId: invoice.id, customerId: ids.customerId,
        originalAmount: '1000', remainingAmount: '1000', currency: 'IRR', dueDate: new Date('2026-09-30'),
        status: 'OPEN', createdBy: ids.partnerId,
        metadata: { partnerReceivable: { id: `${ids.caseId}-receivable`, originalEvidence: 'retained' } } } });
      const transactionalDatabase = { $transaction: async <T>(work: (inner: Prisma.TransactionClient) => Promise<T>) => {
        await tx.$executeRaw`SAVEPOINT partner_financial_correction`;
        try { const result = await work(tx); await tx.$executeRaw`RELEASE SAVEPOINT partner_financial_correction`; return result; }
        catch (error) { await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_financial_correction`;
          await tx.$executeRaw`RELEASE SAVEPOINT partner_financial_correction`; throw error; }
      } } as unknown as PrismaClient;
      const serviceFor = (actorId: string) => createPrismaPartnerFinancialCorrectionServices({
        database: transactionalDatabase, actorId,
        authorize: async () => ({ ok: true, value: { evidenceId: `${actorId}-authorization` } }),
        prepareSharedSuccessor: async () => ({ ok: false, error: partnerError('STATE_CONFLICT') }),
        revalidateSharedEffect: async () => ({ ok: false, error: partnerError('STATE_CONFLICT') }),
        inspectVoiding: async () => {
          const inspection = { dependencyEvidenceIds: ['formal-return', 'receipt-settlement'], adjustmentEventIds: [],
            owner, commitmentEventId: ids.commitmentId };
          return { ok: true, value: { ...inspection, evidenceHash: await partnerVoidingInspectionHash(inspection) } };
        },
      }).voiding;
      const requester = 'sales-remediation';
      const request = await remediationCommand(requester, owner);
      assert.equal((await serviceFor(requester).execute(request)).ok, true);
      const actors = { SALES_SCOPE: 'sales-manager', ACCOUNTING_PROCESS: 'accounting-processor',
        ACCOUNTING_MANAGER: 'accounting-manager', ACCOUNTING_VERIFY: 'accounting-verifier',
        CUSTOMER_CONFIRM: 'customer-contract-canceller' } as const;
      for (const gate of ['CUSTOMER_CONFIRM', 'SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER',
        'ACCOUNTING_VERIFY'] as const) {
        const result = await serviceFor(actors[gate]).execute(await gateCommand(actors[gate], owner, request.commandId, gate));
        assert.equal(result.ok, true, gate);
      }
      const [sale, contract, adjustment, voidEvent, notice, voidedInvoice, voidedReceivable, accountingAudit] = await Promise.all([
        tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } }),
        tx.salesContract.findUniqueOrThrow({ where: { id: ids.contractId } }),
        tx.partnerFinancialAdjustment.findFirstOrThrow({ where: { caseId: ids.caseId } }),
        tx.partnerCaseEvent.findFirstOrThrow({ where: { caseId: ids.caseId, type: 'CASE_VOIDED' } }),
        tx.partnerOutboxMessage.findFirstOrThrow({ where: { purpose: 'CUSTOMER_CANCELLATION_NOTICE',
          event: { caseId: ids.caseId } } }),
        tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: invoice.id } }),
        tx.accountingReceivable.findUniqueOrThrow({ where: { id: receivable.id } }),
        tx.accountingAuditLog.findFirstOrThrow({ where: { action: 'VOID_ACCOUNTING_RECORD', recordId: invoice.id } }),
      ]);
      assert.equal(sale.state, 'VOIDED');
      assert.equal(sale.commitmentEventId, ids.commitmentId);
      assert.equal(sale.caseNumber, `${ids.caseId}-number`);
      assert.equal(contract.status, 'CANCELLED');
      assert.equal(adjustment.originalRealizationEventId, ids.commitmentId);
      assert.equal(adjustment.delta.toString(), '-850', 'void reverses net realization, excluding taxes and charges');
      assert.equal(voidedInvoice.status, 'VOIDED');
      assert.equal(voidedReceivable.status, 'VOIDED');
      assert.deepEqual((voidedReceivable.metadata as { partnerReceivable?: unknown }).partnerReceivable,
        { id: receivable.id, originalEvidence: 'retained' }, 'void preserves immutable obligation provenance for historical reads');
      assert.equal(voidedReceivable.remainingAmount.toString(), '1000', 'Accounting void preserves the original receivable amount');
      assert.equal((voidedInvoice.metadata as { externalVoidReference?: string }).externalVoidReference, request.commandId);
      assert.equal(accountingAudit.entityId, invoice.id);
      assert.equal(voidEvent.toState, 'VOIDED');
      assert.match(notice.deduplicationKey, /partner-void-notice/);
      assert.equal((notice.safePayload as { readOnlyLinkEvidenceId?: string }).readOnlyLinkEvidenceId,
        `${request.commandId}-CUSTOMER_CONFIRM-evidence`);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await database.$disconnect();
  }
});

test('real-schema shared successor is staged append-only and becomes the head only after every gate', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback Partner shared correction fixture');
  try {
    await database.$transaction(async tx => {
      const ids = idsFor(`partner-shared-${randomUUID()}`);
      const owner = await seedCommittedCase(tx, ids, 'ACTIVE');
      const rowId = `${ids.caseId}-row`, responderId = `${ids.caseId}-responder`, inquiryId = `${ids.caseId}-inquiry`;
      await tx.user.create({ data: { id: responderId, username: responderId, email: `${responderId}@example.invalid`,
        password: 'not-a-login', firstName: 'Price', lastName: 'Responder' } });
      await tx.partnerInquiry.create({ data: { id: inquiryId, profileId: ids.profileId } });
      const assignment = await tx.partnerInquiryAssignment.create({ data: { inquiryId, revision: 1,
        responderId, actorId: responderId, reason: 'تخصیص تست', eligibilityEvidence: {} } });
      const inquiryRow = await tx.partnerInquiryRow.create({ data: { id: `${inquiryId}-row`, inquiryId,
        version: 1, outcome: 'APPROVED', configurationHash: hash('c'), definition: {} } });
      const approval = await tx.partnerInquiryApproval.create({ data: { id: `${inquiryId}-approval`, rowId: inquiryRow.id,
        assignmentId: assignment.id, actorId: responderId, commandId: `${inquiryId}-approval-command`,
        authorizationEvidenceId: `${inquiryId}-authorization`, wholesaleUnitPrice: '100', currency: 'IRR',
        evidenceHash: hash('d'), approvedAt: new Date('2026-01-01'), expiresAt: new Date('2026-01-02') } });
      await tx.partnerProductRow.create({ data: { id: rowId, caseId: ids.caseId } });
      await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 1, productRowId: rowId,
        configurationHash: hash('c'), quantity: '10', unit: 'm', precisionPolicyVersion: 'measured-v1' } });
      await tx.partnerInquiryUsage.create({ data: { id: `${ids.caseId}-usage`, caseId: ids.caseId, caseRevision: 1,
        productRowId: rowId, approvalId: approval.id, approvalSnapshot: {}, evidenceHash: approval.evidenceHash } });
      const predecessorPlanId = `${ids.caseId}-predecessor-retail-plan`;
      await tx.partnerPaymentPlan.create({ data: { id: predecessorPlanId, caseId: ids.caseId, caseRevision: 1,
        purpose: 'RETAIL', version: 1, effectiveDate: new Date('2026-08-30'), evidence: {}, integrityHash: hash('6') } });
      await tx.partnerPaymentInstallment.create({ data: { id: `${predecessorPlanId}-installment`, planId: predecessorPlanId,
        dueDate: new Date('2026-09-01'), amount: '1200', currency: 'IRR', method: 'CASH', evidence: {} } });
      const initialReceiptHash = await canonicalHash({ receipts: [] });
      const correctionId = `${ids.caseId}-correction`;
      const [opportunityClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      await tx.partnerCorrectionOpportunity.create({ data: { id: correctionId, caseId: ids.caseId,
        predecessorRevision: 1, scope: 'SHARED', scopeHash: hash('e'), requesterId: ids.partnerId,
        approvedBy: 'sales-manager', approvedAt: new Date(opportunityClock.now.getTime() - 60 * 60 * 1000),
        expiresAt: new Date(opportunityClock.now.getTime() + 24 * 60 * 60 * 1000),
        calendarVersion: 'tehran-v1', evidence: {} } });
      const transactionalDatabase = { $transaction: async <T>(work: (inner: Prisma.TransactionClient) => Promise<T>) => {
        await tx.$executeRaw`SAVEPOINT partner_shared_correction`;
        try { const result = await work(tx); await tx.$executeRaw`RELEASE SAVEPOINT partner_shared_correction`; return result; }
        catch (error) { await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_shared_correction`;
          await tx.$executeRaw`RELEASE SAVEPOINT partner_shared_correction`; throw error; }
      } } as unknown as PrismaClient;
      const dependencies = {
        database: transactionalDatabase,
        authorize: async () => ({ ok: true as const, value: { evidenceId: 'authorization-evidence' } }),
        prepareSharedSuccessor: async () => ({ ok: true as const, value: {
          evidence: { graphHash: hash('f'), graph: { savedGraphMarker: 'immutable-successor' }, partySnapshots: {},
            wholesaleEnvelope: { schemaVersion: 1, totals: { net: '1000', discount: '50', tax: '150', charges: '100', payable: '1200', currency: 'IRR' } },
            retailEnvelope: { schemaVersion: 1, totals: { net: '1400', discount: '0', tax: '0', charges: '0', payable: '1400', currency: 'IRR' } }, paymentEvidence: {}, customerContent: {} },
          pricing: [{ productRowId: rowId, configurationChanged: false, source: 'FROZEN' as const,
            approvalId: approval.id, configurationHash: hash('c'), evidenceHash: approval.evidenceHash,
            approvalExpiresAt: approval.expiresAt.toISOString() }],
          dependencies: { predecessorProducts: [{ productRowId: rowId, quantity: '10', unit: 'm' }],
            successorProducts: [{ productRowId: rowId, quantity: '7.5', unit: 'm' }],
            physical: { evidenceIds: ['dispatch-return', 'reservation-release'], rows: [{ productRowId: rowId,
              reserved: '2.5', dispatched: '5', unit: 'm', health: 'CURRENT' as const }] },
            financial: { evidenceIds: ['retail-receipt-state'], receiptStateHash: initialReceiptHash,
              health: 'CURRENT' as const },
            suppliedEvidenceIds: ['reservation-release', 'dispatch-return', 'retail-receipt-state'],
            predecessorChildren: [], successorChildren: [] },
          products: [{ productRowId: rowId, configurationHash: hash('c'), quantity: '7.5', unit: 'm',
            precisionPolicyVersion: 'measured-v1', approvalId: approval.id, approvalSnapshot: {},
            approvalEvidenceHash: approval.evidenceHash }], deliveries: [], paymentPlans: [],
          buildProjections: async () => ({ ok: true as const, value: { internal: {}, customer: {} } }),
        } }),
        revalidateSharedEffect: async (currentTx: Prisma.TransactionClient, context: {
          candidate: { dependencies: PartnerCorrectionDependencyInput; payload: { evidence: { graph: unknown } } } }) => {
          assert.deepEqual(context.candidate.payload.evidence.graph, { savedGraphMarker: 'immutable-successor' },
            'resuming a saved correction revalidates its persisted graph, not an empty placeholder');
          const receipts = await currentTx.partnerRetailReceipt.findMany({ where: { caseId: ids.caseId },
            orderBy: { id: 'asc' }, select: { id: true, planId: true, kind: true, originalReceiptId: true,
              amount: true, currency: true, effectiveDate: true, commandId: true } });
          return { ok: true as const, value: { ...context.candidate.dependencies, financial: {
            ...context.candidate.dependencies.financial,
            receiptStateHash: await canonicalHash({ receipts: receipts.map(receipt => ({ ...receipt,
              amount: receipt.amount.toString(), effectiveDate: receipt.effectiveDate.toISOString().slice(0, 10) })) }),
          } } };
        },
        inspectVoiding: async () => ({ ok: false as const, error: partnerError('STATE_CONFLICT') }),
      };
      const intent = { opportunityId: correctionId, intent: { customerId: ids.customerId,
        recoveryId: `${ids.caseId}-recovery`, recoveryRevision: 1, graphHash: hash('f'), sabalanTermsVersionId: 'terms-v1',
        contractDate: '2026-08-30', rows: [{ productRowId: rowId, approvedRowBinding: { inquiryId,
          rowId: inquiryRow.id, revision: 1 }, retailUnitPrice: { amount: '140', currency: 'IRR' as const } }],
        customerPaymentPlan: { planId: `${ids.caseId}-retail-plan`, version: 1, effectiveDate: '2026-08-30',
          installments: [{ installmentId: `${ids.caseId}-retail-installment`, dueDate: '2026-09-01',
            amount: { amount: '1400', currency: 'IRR' as const }, method: 'CASH' as const }] },
        retailDiscount: { amount: '0', currency: 'IRR' as const }, belowCostConfirmed: false,
        deliveries: [{ deliveryId: `${ids.caseId}-delivery`, date: '2026-09-01', destination: 'تهران',
          items: [{ productRowId: rowId, quantity: '7.5' }] }] },
        dependencyEvidenceIds: ['reservation-release', 'dispatch-return', 'retail-receipt-state'] };
      const save = { schemaVersion: 1, type: 'SHARED_CORRECTION_SAVE', commandId: `${correctionId}-save`,
        correlationId: `${correctionId}-save`, expected: owner, expectedState: 'COMMITTED', ...intent,
        idempotency: { actorId: ids.partnerId, operation: 'SHARED_CORRECTION_SAVE', targetId: ids.caseId,
          key: `${correctionId}-save`, payloadHash: await canonicalHash({ schemaVersion: 1,
            type: 'SHARED_CORRECTION_SAVE', ...intent }) } } as Extract<PartnerCommand, { type: 'SHARED_CORRECTION_SAVE' }>;
      const sharedFor = (actorId: string) => createPrismaPartnerFinancialCorrectionServices({ ...dependencies, actorId }).shared;
      const saved = await sharedFor(ids.partnerId).execute(save);
      assert.equal(saved.ok, true, JSON.stringify(saved));
      assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 1);
      const actors = { SALES_SCOPE: 'sales-manager', ACCOUNTING_PROCESS: 'accounting-processor',
        ACCOUNTING_MANAGER: 'accounting-manager', ACCOUNTING_VERIFY: 'accounting-verifier',
        CUSTOMER_CONFIRM: 'customer-confirmer' } as const;
      for (const gate of ['SALES_SCOPE', 'ACCOUNTING_PROCESS', 'ACCOUNTING_MANAGER', 'ACCOUNTING_VERIFY'] as const) {
        assert.equal((await sharedFor(actors[gate]).execute(await gateCommand(actors[gate], owner, correctionId, gate))).ok, true);
      }
      await tx.$executeRaw`SAVEPOINT partner_receipt_race`;
      await tx.partnerRetailReceipt.create({ data: { id: `${ids.caseId}-raced-receipt`, caseId: ids.caseId,
        planId: predecessorPlanId, kind: 'RECEIPT', amount: '100', currency: 'IRR', effectiveDate: new Date('2026-08-30'),
        actorId: ids.partnerId, commandId: `${ids.caseId}-raced-receipt`, evidence: { source: 'real-schema-race' } } });
      const finalCommand = await gateCommand(actors.CUSTOMER_CONFIRM, owner, correctionId, 'CUSTOMER_CONFIRM');
      const raced = await sharedFor(actors.CUSTOMER_CONFIRM).execute(finalCommand);
      assert.equal(raced.ok ? null : raced.error.code, 'ROW_STALE');
      assert.equal(await tx.partnerCorrectionGate.count({ where: { opportunityId: correctionId } }), 4,
        'the final gate is rolled back with a raced receipt snapshot');
      assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 1);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_receipt_race`;
      await tx.$executeRaw`RELEASE SAVEPOINT partner_receipt_race`;
      assert.equal((await sharedFor(actors.CUSTOMER_CONFIRM).execute(finalCommand)).ok, true);
      const [sale, saveRow, adjustment, effective] = await Promise.all([
        tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } }),
        tx.partnerCorrectionSave.findUniqueOrThrow({ where: { opportunityId: correctionId } }),
        tx.partnerFinancialAdjustment.findFirstOrThrow({ where: { correctionId } }),
        tx.partnerCaseEvent.findFirstOrThrow({ where: { caseId: ids.caseId, type: 'CORRECTION_EFFECTIVE' } }),
      ]);
      assert.equal(saveRow.successorRevision, 2);
      assert.equal(sale.headRevision, 2);
      assert.equal(sale.state, 'COMMITTED');
      assert.equal(adjustment.delta.toString(), '100', 'shared correction adjusts net realization, not the payable delta');
      assert.equal(effective.caseRevision, 2);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await database.$disconnect();
  }
});

test('Partner shipment coverage retains removed lineage history, rejects gaps and seals zero current obligation', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback Partner quantity coverage fixture');
  try {
    await database.$transaction(async tx => {
      const ids = idsFor(`partner-quantity-coverage-${randomUUID()}`);
      const owner = await seedCommittedCase(tx, ids, 'ACTIVE');
      const secondId = `${ids.caseId}-removed-row`;
      await tx.partnerProductRow.create({ data: { id: secondId, caseId: ids.caseId } });
      await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 1, productRowId: secondId,
        configurationHash: hash('9'), quantity: '2', unit: 'piece', precisionPolicyVersion: 'exact-v1' } });
      const products = [{ productRowId: `${ids.caseId}-seed-row`, quantity: '1', unit: 'piece' },
        { productRowId: secondId, quantity: '2', unit: 'piece' }];
      for (const product of products) await tx.partnerFulfillmentLineage.create({ data: { id: `${product.productRowId}-lineage`,
        caseId: ids.caseId, caseRevision: 1, integrityHash: owner.integrityHash, internalRecordId: ids.internalId,
        ...product, recipient: { customerId: ids.customerId }, deliveryIds: [], commandId: `${product.productRowId}-lineage` } });
      const view = { ...createPartnerFixtures().fulfillment, owner, recordId: ids.internalId,
        products: products.map(product => ({ ...product, description: 'سنگ آزمایشی تبار فیزیکی' })) };
      await capturePartnerContractedQuantities(tx, view);
      const first = await readPartnerShipmentQuantityProjection(tx, ids.caseId);
      assert.equal(first.rows.length, 2);
      assert.equal(first.totalsByUnit[0].contracted, '3.000');
      assert.equal(first.totalsByUnit[0].isComplete, true);
      await tx.$executeRaw`SAVEPOINT missing_partner_baseline`;
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.shipmentQuantityEvidence.deleteMany({ where: { partnerCaseId: ids.caseId, productRowId: secondId } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
      const missing = await readPartnerShipmentQuantityProjection(tx, ids.caseId);
      assert.equal(missing.rows.length, 2, 'a lost row remains visible as missing coverage');
      assert.equal(missing.totalsByUnit[0].isComplete, false);
      assert.equal(missing.rows.find(row => row.productRowId === secondId)?.canAuthorizeLoading, false);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT missing_partner_baseline`;
      await tx.$executeRaw`RELEASE SAVEPOINT missing_partner_baseline`;
      await tx.$executeRaw`SAVEPOINT damaged_partner_baseline`;
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.shipmentQuantityEvidence.updateMany({ where: { partnerCaseId: ids.caseId }, data: { metadata: { tampered: true } } });
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'origin'");
      await assert.rejects(capturePartnerContractedQuantities(tx, view), /integrity conflict/);
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT damaged_partner_baseline`;
      await tx.$executeRaw`RELEASE SAVEPOINT damaged_partner_baseline`;
      const previous = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: { caseId: ids.caseId, revision: 1 } } });
      const successor = { ...owner, revision: 2, integrityHash: hash('c') };
      await tx.partnerCaseRevision.create({ data: { ...previous, revision: 2, predecessorRevision: 1,
        integrityHash: successor.integrityHash, commandId: `${ids.caseId}-successor`,
        graph: {}, partySnapshots: {}, wholesaleEnvelope: previous.wholesaleEnvelope as Prisma.InputJsonValue,
        retailEnvelope: previous.retailEnvelope as Prisma.InputJsonValue, paymentEvidence: {}, customerContent: {},
        internalProjection: {}, customerProjection: {} } });
      await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 2, ...products[0],
        configurationHash: hash('9'), precisionPolicyVersion: 'exact-v1' } });
      await tx.partnerSaleCase.update({ where: { id: ids.caseId }, data: { headRevision: 2,
        integrityHash: successor.integrityHash, stateRevision: 5 } });
      await tx.sabalanToPartnerSaleRecord.update({ where: { id: ids.internalId }, data: {
        expectedRevision: 2, integrityHash: successor.integrityHash } });
      await tx.salesContract.update({ where: { id: ids.contractId }, data: { partnerRevision: 2, partnerIntegrityHash: successor.integrityHash } });
      const effectiveInstant = new Date();
      await tx.partnerCaseEvent.create({ data: { id: `${ids.caseId}-effect`, caseId: ids.caseId, caseRevision: 2,
        integrityHash: successor.integrityHash, sequence: 2, stateRevision: 5, type: 'CORRECTION_EFFECTIVE',
        fromState: 'COMMITTED', toState: 'COMMITTED', actorId: ids.partnerId, commandId: `${ids.caseId}-effect`,
        correlationId: `${ids.caseId}-effect`, effectiveDate: new Date(effectiveInstant.toISOString().slice(0, 10)),
        recordedAt: effectiveInstant, evidence: {} } });
      const stale = await readPartnerShipmentQuantityProjection(tx, ids.caseId);
      assert.equal(stale.totalsByUnit[0].isComplete, false, 'advancing the Case without its quantity baseline cannot report current coverage');
      assert.equal(stale.rows.every(row => !row.canAuthorizeLoading), true);
      await capturePartnerContractedQuantities(tx, { ...view, owner: successor, products: [view.products[0]] });
      const current = await readPartnerShipmentQuantityProjection(tx, ids.caseId);
      assert.equal(current.totalsByUnit[0].isComplete, true);
      assert.equal(current.totalsByUnit[0].contracted, '1.000');
      assert.equal(current.rows.find(row => row.productRowId === secondId)?.quantities?.availableToLoad, '0.000');
      const immediatelyBefore = await readPartnerShipmentQuantityProjection(tx, ids.caseId, {
        cutoff: new Date(effectiveInstant.getTime() - 1).toISOString() });
      assert.equal(immediatelyBefore.totalsByUnit[0].isComplete, true);
      assert.equal(immediatelyBefore.totalsByUnit[0].contracted, '3.000', 'same-day history before correction retains predecessor quantities');
      const historical = await readPartnerShipmentQuantityProjection(tx, ids.caseId, { cutoff: '2026-08-31T20:29:59.999Z' });
      assert.equal(historical.totalsByUnit[0].contracted, '3.000');
      assert.equal(historical.totalsByUnit[0].isComplete, true);
      assert.equal(await tx.partnerFulfillmentLineage.count({ where: { caseId: ids.caseId } }), 2);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
});

test('real schema binds frozen output and fulfillment evidence to one exact Case owner and rejects rewrites', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback Partner exact evidence fixture');
  try {
    await database.$transaction(async tx => {
      const ids = idsFor(`partner-evidence-${randomUUID()}`);
      const other = idsFor(`partner-evidence-other-${randomUUID()}`);
      const owner = await seedCommittedCase(tx, ids);
      await seedCommittedCase(tx, other);
      const snapshotId = `${ids.caseId}-snapshot`;
      await tx.partnerCustomerOutputSnapshot.create({ data: { id: snapshotId, caseId: ids.caseId,
        caseRevision: 1, integrityHash: owner.integrityHash, contentHash: hash('3'),
        contractNumber: `${ids.contractId}-number`, recipient: '09120000000',
        expiresAt: new Date('2027-08-30T08:00:00.000Z'), content: { exact: true },
        commandId: `${ids.caseId}-snapshot-command` } });
      const artifact = await tx.partnerCustomerArtifact.create({ data: { id: `${ids.caseId}-artifact`, snapshotId,
        caseId: ids.caseId, caseRevision: 1, mode: 'FINAL', outputHash: hash('4'), byteHash: hash('5'),
        content: Buffer.from('immutable partner output'), actorId: ids.partnerId, publishedAt: new Date() } });
      const lineage = await tx.partnerFulfillmentLineage.create({ data: { id: `${ids.caseId}-lineage`,
        caseId: ids.caseId, caseRevision: 1, integrityHash: owner.integrityHash, internalRecordId: ids.internalId,
        productRowId: `${ids.caseId}-seed-row`, quantity: '1', unit: 'piece', recipient: { customer: ids.customerId },
        deliveryIds: [`${ids.caseId}-delivery`], commandId: `${ids.caseId}-lineage-command` } });
      const mismatchRowId = `${ids.caseId}-mismatch-row`;
      await tx.partnerProductRow.create({ data: { id: mismatchRowId, caseId: ids.caseId } });
      await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 1,
        productRowId: mismatchRowId, configurationHash: hash('9'), quantity: '1', unit: 'piece',
        precisionPolicyVersion: 'exact-v1' } });
      const report = await tx.partnerReportExport.create({ data: { id: `${ids.caseId}-report`, actorId: ids.partnerId,
        expiresAt: new Date('2027-08-30T08:00:00.000Z'), query: { purpose: 'PARTNER' }, report: { exact: true },
        roots: [ids.caseId], contentHash: hash('6') } });
      const rejected = async (name: string, work: () => Promise<unknown>, pattern: RegExp) => {
        await tx.$executeRawUnsafe(`SAVEPOINT ${name}`);
        try { await assert.rejects(work(), pattern); }
        finally { await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${name}`);
          await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${name}`); }
      };
      await rejected('artifact_owner_mismatch', () => tx.partnerCustomerArtifact.create({ data: {
        id: `${ids.caseId}-bad-artifact`, snapshotId, caseId: other.caseId, caseRevision: 1, mode: 'PREVIEW',
        outputHash: hash('4'), byteHash: hash('5'), content: Buffer.from('bad owner'), actorId: ids.partnerId,
      } }), /partner_customer_artifact_snapshot_owner/);
      await rejected('lineage_owner_mismatch', () => tx.partnerFulfillmentLineage.create({ data: {
        id: `${ids.caseId}-bad-lineage`, caseId: ids.caseId, caseRevision: 1, integrityHash: owner.integrityHash,
        internalRecordId: other.internalId, productRowId: mismatchRowId, quantity: '1', unit: 'piece',
        recipient: { customer: ids.customerId }, deliveryIds: [`${ids.caseId}-delivery`],
        commandId: `${ids.caseId}-bad-lineage-command`,
      } }), /partner_fulfillment_internal_record_owner/);
      await rejected('artifact_rewrite', () => tx.partnerCustomerArtifact.update({ where: { id: artifact.id },
        data: { byteHash: hash('7') } }), /append-only/);
      await rejected('lineage_delete', () => tx.partnerFulfillmentLineage.delete({ where: { id: lineage.id } }), /append-only/);
      await rejected('report_rewrite', () => tx.partnerReportExport.update({ where: { id: report.id },
        data: { contentHash: hash('8') } }), /append-only/);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    await database.$disconnect();
  }
});

test('concurrent final void gates serialize so exactly one atomic void becomes visible', async () => {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const ids = idsFor(`partner-void-race-${randomUUID()}`);
  try {
    const seededTransaction = await database.$transaction(async tx => {
      const owner = await seedCommittedCase(tx, ids);
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
      return { owner, count: await tx.partnerSaleCase.count({ where: { id: ids.caseId } }) };
    });
    const owner = seededTransaction.owner;
    assert.equal(seededTransaction.count, 1);
    const seeded = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
    assert.equal(seeded.commitmentEventId, ids.commitmentId);
    const servicesFor = (actorId: string) => createPrismaPartnerFinancialCorrectionServices({
      database, actorId,
      authorize: async () => ({ ok: true, value: { evidenceId: `${actorId}-authorization` } }),
      prepareSharedSuccessor: async () => ({ ok: false, error: partnerError('STATE_CONFLICT') }),
      revalidateSharedEffect: async () => ({ ok: false, error: partnerError('STATE_CONFLICT') }),
      inspectVoiding: async () => {
        const inspection = { dependencyEvidenceIds: ['formal-return', 'receipt-settlement'], adjustmentEventIds: [],
          owner, commitmentEventId: ids.commitmentId };
        return { ok: true, value: { ...inspection, evidenceHash: await partnerVoidingInspectionHash(inspection) } };
      },
    }).voiding;
    const request = await remediationCommand('race-requester', owner);
    const requested = await servicesFor('race-requester').execute(request);
    assert.equal(requested.ok, true, JSON.stringify(requested));
    const actors = { SALES_SCOPE: 'race-sales', ACCOUNTING_PROCESS: 'race-processor',
      ACCOUNTING_MANAGER: 'race-manager', ACCOUNTING_VERIFY: 'race-verifier' } as const;
    for (const gate of Object.keys(actors) as Array<keyof typeof actors>) {
      assert.equal((await servicesFor(actors[gate]).execute(await gateCommand(actors[gate], owner,
        request.commandId, gate))).ok, true);
    }
    const [left, right] = await Promise.all([
      servicesFor('race-customer-a').execute(await gateCommand('race-customer-a', owner,
        request.commandId, 'CUSTOMER_CONFIRM')),
      servicesFor('race-customer-b').execute(await gateCommand('race-customer-b', owner,
        request.commandId, 'CUSTOMER_CONFIRM')),
    ]);
    assert.equal([left, right].filter(result => result.ok).length, 1);
    assert.equal([left, right].filter(result => !result.ok && ['ROW_STALE', 'STATE_CONFLICT'].includes(result.error.code)).length, 1);
    assert.equal(await database.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_VOIDED' } }), 1);
    assert.equal(await database.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 1);
    assert.equal(await database.partnerOutboxMessage.count({ where: { event: { caseId: ids.caseId },
      purpose: 'CUSTOMER_CANCELLATION_NOTICE' } }), 1);
  } finally {
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.partnerOutboxMessage.deleteMany({ where: { event: { caseId: ids.caseId } } });
      await tx.partnerFinancialAdjustment.deleteMany({ where: { caseId: ids.caseId } });
      await tx.partnerCorrectionDependency.deleteMany({ where: { opportunity: { caseId: ids.caseId } } });
      await tx.partnerCorrectionGate.deleteMany({ where: { opportunity: { caseId: ids.caseId } } });
      await tx.partnerCommandOutcome.deleteMany({ where: { key: { contains: ids.caseId } } });
      await tx.partnerCaseEvent.deleteMany({ where: { caseId: ids.caseId } });
      await tx.partnerCorrectionOpportunity.deleteMany({ where: { caseId: ids.caseId } });
      await tx.partnerCaseRowBinding.deleteMany({ where: { caseId: ids.caseId } });
      await tx.partnerProductRow.deleteMany({ where: { caseId: ids.caseId } });
      await tx.salesContract.deleteMany({ where: { id: ids.contractId } });
      await tx.sabalanToPartnerSaleRecord.deleteMany({ where: { id: ids.internalId } });
      await tx.partnerCaseRevision.deleteMany({ where: { caseId: ids.caseId } });
      await tx.partnerCommercialNumber.deleteMany({ where: { caseId: ids.caseId } });
      await tx.partnerSaleCase.deleteMany({ where: { id: ids.caseId } });
      await tx.crmCustomer.deleteMany({ where: { id: ids.customerId } });
      await tx.partnerCommercialAccount.deleteMany({ where: { id: ids.accountId } });
      await tx.partnerProfile.deleteMany({ where: { id: ids.profileId } });
      await tx.department.deleteMany({ where: { id: ids.departmentId } });
      await tx.user.deleteMany({ where: { id: ids.partnerId } });
    });
    await database.$disconnect();
  }
});
