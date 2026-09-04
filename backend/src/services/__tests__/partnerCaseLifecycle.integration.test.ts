import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { PartnerEventSchema, canonicalHash, partnerError, type PartnerCommand, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { createPartnerCaseLifecycleService, createPrismaPartnerCaseLifecycleService,
  readPartnerRevisionProjections, type PartnerCaseLifecycleDependencies } from '../partnerSales/cases/lifecycle';
import { createPartnerAccountingAdapter } from '../partnerSales/accounting/adapter';
import { createPrismaPartnerAccountingRepository } from '../partnerSales/accounting/prismaRepository';
import { PARTNER_INTERNAL_ACCOUNTING_SOURCE, approvePartnerFinancialSourceWithinTransaction } from '../partnerSales/accounting/financialApproval';
import { createPrismaPartnerReportingSource } from '../partnerSales/reporting/prisma';
import * as partnerContracts from '@sabalanerp/partner-sales-contracts';
import { projectReportRow } from '../partnerSales/reporting/projection';
import express from 'express';
import { createServer } from 'node:http';
import { createPartnerCorrectionRouter } from '../../routes/partner-corrections';
import { createPartnerCaseRouter } from '../../routes/partner-cases';
import type { AuthRequest } from '../../middleware/auth';
import { createAuditedPartnerAuthorization } from '../partnerSales/authorization/audited';
import { readAuthorizationDecisionByCorrelation } from '../effectiveAuthorization/audit';
import { readPartnerWorkingCalendar } from '../partnerSales/corrections/calendar';
import { createPrismaPartnerConfirmationHooks } from '../partnerSales/customerOutput/prismaHooks';
import { createPrismaDispatchDocumentAccessPolicy } from '../dispatchDocuments/prismaAccessPolicy';
import { createPrismaPartnerFulfillmentRepository } from '../partnerSales/fulfillment/prismaRepository';
import { createPartnerFulfillmentAdapter } from '../partnerSales/fulfillment';
import { capturePartnerContractedQuantities, readPartnerShipmentQuantityProjection } from '../partnerSales/fulfillment/quantityStore';
import { validatePartnerSharedAccountingEffect, stagePartnerAccountingReplacement } from '../partnerSales/accounting/sharedCorrection';
import { buildCaseProjections, type CaseRevisionProjectionEvidence } from '../partnerSales/cases/projections';
import { subtract } from '../partnerSales/reporting/money';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { createPrismaPartnerFinancialCorrectionComposition } from '../partnerSales/corrections/prismaFinancialComposition';
import type { PartnerCorrectionDependencyInput } from '../partnerSales/corrections/dependencyChecks';
import { prepareRetailSuccessor } from '../partnerSales/corrections/retailSuccessor';
import { readPartnerOutstandingHistory, readPartnerAccountingTrend } from '../partnerSales/accounting/history';
import { createPartnerCaseLoading, readPartnerCaseLoading } from '../dispatchAllocation';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10'); return url.toString();
}

test('multi-Case Accounting list does not deadlock with the Partner writer lock sequence', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  try {
    const a = idsFor(`accounting-lock-${temporary.runId}-a`), b = idsFor(`accounting-lock-${temporary.runId}-b`);
    const actorId = `accounting-lock-${temporary.runId}-actor`;
    await database.$transaction(async tx => {
      await seedCase(tx, a); await seedCase(tx, b);
      await tx.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
      await tx.user.create({ data: { id: actorId, username: actorId, email: `${actorId}@example.invalid`,
        password: 'not-a-login', firstName: 'Read', lastName: 'Concurrency', role: 'ADMIN' } });
    });
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerAccountingReadConcurrencyProbe.ts'], { timeout: 30_000, env: { ...process.env,
        DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_ACTOR_ID: actorId, PARTNER_TEST_CASE_B: b.caseId } });
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerAccountingReadConcurrencyProbe.ts'], { timeout: 30_000, env: { ...process.env,
        DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_ACTOR_ID: actorId, PARTNER_TEST_CASE_A: a.caseId,
        PARTNER_TEST_CASE_B: b.caseId, PARTNER_TEST_READ_KIND: 'REPORT' } });
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});

test('Partner dispatch statements require current internal Accounting authority without changing ordinary access', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const ids = idsFor(`partner-dispatch-policy-${temporary.runId}`);
  const hiddenIds = idsFor(`partner-dispatch-policy-hidden-${temporary.runId}`);
  try {
    await database.$transaction(async tx => { await seedCase(tx, ids); await seedCase(tx, hiddenIds); });
    const managerId = `${ids.caseId}-accountant`;
    await database.user.create({ data: { id: managerId, username: managerId, email: `${managerId}@example.invalid`,
      password: 'not-a-login', firstName: 'Accounting', lastName: 'Policy' } });
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await database.effectiveActionGrant.create({ data: { id: `${managerId}-accounting-read`, principalKind: 'USER',
      principalId: managerId, subjectUserId: managerId, domain: 'PARTNER', action: 'ACCOUNTING_READ',
      rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND', boundRootId: ids.caseId,
      effect: 'ALLOW', grantedBy: managerId,
      reason: 'isolated dispatch document policy fixture', correlationId: `${managerId}-accounting-read` } });
    // Residual narrow grants must not let a Partner persona read wholesale shipment documents.
    const residualGrant = { userId: ids.partnerId, workspace: 'accounting',
      feature: 'accounting_dispatch_candidates_view', permissionLevel: 'view', grantedBy: managerId };
    await assert.rejects(() => database.featurePermission.create({ data: residualGrant }), /incompatible authority/);
    // Deliberately inject legacy corruption only in this disposable, isolated
    // fixture to prove the reader's independent persona boundary.
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.featurePermission.create({ data: residualGrant });
    });
    const project = await database.projectAddress.create({ data: { customerId: ids.customerId, address: 'Isolated policy fixture' } });
    const loading = await database.logisticsLoading.create({ data: { loadingNumber: `${ids.caseId}-loading`,
      customerId: ids.customerId, projectId: project.id, createdBy: managerId } });
    const driver = await database.externalDriver.create({ data: { firstName: 'Policy', lastName: 'Fixture',
      nationalCode: temporary.runId, phone: '09120000000', createdBy: managerId } });
    const vehicle = await database.externalVehicle.create({ data: { vehicleType: 'Policy fixture', createdBy: managerId } });
    const queue = await database.guardDriverQueueTurn.create({ data: { driverSource: 'EXTERNAL',
      externalDriverId: driver.id, externalVehicleId: vehicle.id, admittedBy: managerId, admissionSnapshot: {},
      integrityHash: 'a'.repeat(64), loadingId: loading.id } });
    const batch = await database.logisticsAllocationBatch.create({ data: { loadingId: loading.id,
      idempotencyKey: 'policy-fixture', finalizedBy: managerId } });
    const partnerCase = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      id: true, headRevision: true, integrityHash: true, internalRecordId: true,
    } });
    const partnerDelivery = await database.partnerCaseDelivery.findFirstOrThrow({ where: {
      caseId: ids.caseId, revision: partnerCase.headRevision,
    }, select: { id: true } });
    const candidates: Record<string, string> = {};
    for (const [index, sourceKind] of (['SALES_CONTRACT', 'PARTNER_CASE'] as const).entries()) {
      const revision = await database.logisticsAllocationRevision.create({ data: { sourceKind, loadingId: loading.id,
        queueTurnId: queue.id, batchId: batch.id, revisionNumber: index + 1, snapshot: {},
        integrityHash: String(index + 1).repeat(64), finalizedBy: managerId,
        ...(sourceKind === 'PARTNER_CASE' ? { partnerCaseId: partnerCase.id,
          partnerCaseRevision: partnerCase.headRevision, partnerIntegrityHash: partnerCase.integrityHash,
          partnerInternalRecordId: partnerCase.internalRecordId, partnerDeliveryId: partnerDelivery.id } : {}),
      } });
      const candidate = await database.accountingDispatchCandidate.create({ data: { allocationRevisionId: revision.id } });
      candidates[sourceKind] = candidate.id;
    }
    const hiddenProject = await database.projectAddress.create({ data: {
      customerId: hiddenIds.customerId, address: 'Hidden isolated policy fixture',
    } });
    const hiddenLoading = await database.logisticsLoading.create({ data: { loadingNumber: `${hiddenIds.caseId}-loading`,
      customerId: hiddenIds.customerId, projectId: hiddenProject.id, createdBy: managerId } });
    const hiddenDriver = await database.externalDriver.create({ data: { firstName: 'Hidden', lastName: 'Policy',
      nationalCode: `${temporary.runId}h`, phone: '09120000001', createdBy: managerId } });
    const hiddenVehicle = await database.externalVehicle.create({ data: { vehicleType: 'Hidden policy fixture', createdBy: managerId } });
    const hiddenQueue = await database.guardDriverQueueTurn.create({ data: { driverSource: 'EXTERNAL',
      externalDriverId: hiddenDriver.id, externalVehicleId: hiddenVehicle.id, admittedBy: managerId, admissionSnapshot: {},
      integrityHash: 'c'.repeat(64), loadingId: hiddenLoading.id } });
    const hiddenBatch = await database.logisticsAllocationBatch.create({ data: { loadingId: hiddenLoading.id,
      idempotencyKey: 'hidden-policy-fixture', finalizedBy: managerId } });
    const hiddenCase = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: hiddenIds.caseId }, select: {
      id: true, headRevision: true, integrityHash: true, internalRecordId: true,
    } });
    const hiddenDelivery = await database.partnerCaseDelivery.findFirstOrThrow({ where: {
      caseId: hiddenCase.id, revision: hiddenCase.headRevision,
    }, select: { id: true } });
    const hiddenRevision = await database.logisticsAllocationRevision.create({ data: { sourceKind: 'PARTNER_CASE',
      loadingId: hiddenLoading.id, queueTurnId: hiddenQueue.id, batchId: hiddenBatch.id, revisionNumber: 1,
      snapshot: { privateRecipient: 'must-not-be-serialized', confirmationPhone: '09120000000' },
      integrityHash: 'd'.repeat(64), finalizedBy: managerId, partnerCaseId: hiddenCase.id,
      partnerCaseRevision: hiddenCase.headRevision, partnerIntegrityHash: hiddenCase.integrityHash,
      partnerInternalRecordId: hiddenCase.internalRecordId, partnerDeliveryId: hiddenDelivery.id,
    } });
    candidates.HIDDEN_PARTNER_CASE = (await database.accountingDispatchCandidate.create({ data: {
      allocationRevisionId: hiddenRevision.id,
    } })).id;
    await database.workspacePermission.create({ data: { userId: managerId, workspace: 'accounting',
      permissionLevel: 'view', grantedBy: managerId } });
    await database.featurePermission.create({ data: { userId: managerId, workspace: 'accounting',
      feature: 'accounting_dispatch_candidates_view', permissionLevel: 'view', grantedBy: managerId } });
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerDispatchListHttpProbe.ts'], { timeout: 60_000, env: { ...process.env,
        DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_ACTOR_ID: managerId,
        PARTNER_TEST_ORDINARY_CANDIDATE_ID: candidates.SALES_CONTRACT,
        PARTNER_TEST_ALLOWED_CANDIDATE_ID: candidates.PARTNER_CASE,
        PARTNER_TEST_HIDDEN_CANDIDATE_ID: candidates.HIDDEN_PARTNER_CASE } });
    const access = createPrismaDispatchDocumentAccessPolicy(database);
    const request = { actorId: ids.partnerId, candidateId: candidates.PARTNER_CASE, kinds: ['STATEMENT'] as ['STATEMENT'] };
    assert.equal(await access.canReadDocuments(request), false);
    assert.equal(await access.canReadDocuments({ ...request, kinds: ['STATEMENT_ADJUSTMENT'] }), false);
    assert.equal(await access.canReadDocuments({ ...request, kinds: ['WAYBILL'] }), true);
    assert.equal(await access.canReadDocuments({ ...request, candidateId: candidates.SALES_CONTRACT }), true,
      'ordinary shipment access retains the existing narrow-grant policy');
    assert.equal(await access.canReadDocuments({ ...request, actorId: managerId }), true);
    await database.user.update({ where: { id: managerId }, data: { isActive: false } });
    assert.equal(await access.canReadDocuments({ ...request, actorId: managerId }), false);
    await database.featurePermission.update({ where: { userId_workspace_feature: { userId: ids.partnerId,
      workspace: 'accounting', feature: 'accounting_dispatch_candidates_view' } }, data: { isActive: false } });
    assert.equal(await access.canReadDocuments({ ...request, kinds: ['WAYBILL'] }), false);
    assert.equal(await access.canReadDocuments({ ...request, actorId: managerId, candidateId: 'missing' }), false);
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});

type Ids = ReturnType<typeof idsFor>;
const hash = `sha256-v1:${'a'.repeat(64)}`;
const idsFor = (prefix: string) => ({ caseId: `${prefix}-case`, partnerId: `${prefix}-partner`, profileId: `${prefix}-profile`,
  customerId: `${prefix}-customer`, departmentId: `${prefix}-department`, accountId: `${prefix}-account`,
  internalId: `${prefix}-internal`, contractId: `${prefix}-contract`, rowId: `${prefix}-row`, cohortId: `${prefix}-cohort` });

async function seedCase(tx: Prisma.TransactionClient, ids: Ids, tamperAccounting = false, passThrough = false,
  deliveryPlan?: partnerContracts.FulfillmentView['deliveries']) {
  const base = createPartnerFixtures();
  if (passThrough) {
    for (const totals of [base.partner.sabalanTotals, base.accounting.totals]) {
      totals.tax = '100'; totals.payable = '1700';
    }
    for (const totals of [base.partner.retailTotals, base.customer.totals]) {
      totals.tax = '50'; totals.charges = '10'; totals.payable = '2060';
    }
    base.accounting.sabalanPaymentPlan.installments[0].amount.amount = '1700';
    base.partner.sabalanPaymentPlan.installments[0].amount.amount = '1700';
    for (const view of [base.customer, base.partner]) view.customerPaymentPlan.installments[0].amount.amount = '2060';
    base.partner.resaleDifference = '360';
  }
  const deliveries = (deliveryPlan ?? base.customer.deliveries).map(delivery => ({ ...delivery,
    items: delivery.items.map(item => ({ ...item, productRowId: ids.rowId })) }));
  const product = { productRowId: ids.rowId, description: base.partner.products[0].description,
    quantity: base.partner.products[0].quantity, unit: base.partner.products[0].unit,
    wholesaleUnitPrice: base.partner.products[0].wholesaleUnitPrice,
    retailUnitPrice: base.partner.products[0].retailUnitPrice,
    approvalEvidenceId: base.accounting.products[0].approvalEvidenceId, configurationHash: hash };
  const partySnapshots = { partner: base.accounting.debtor, customer: base.customer.customer };
  const wholesaleEnvelope = { schemaVersion: 1, products: [{ productRowId: product.productRowId,
    description: product.description, quantity: product.quantity, unit: product.unit,
    wholesaleUnitPrice: product.wholesaleUnitPrice, approvalEvidenceId: product.approvalEvidenceId,
    configurationHash: product.configurationHash }], totals: base.accounting.totals, termsVersionId: 'fixture-terms-v1' };
  const retailEnvelope = { schemaVersion: 1, products: [{ productRowId: product.productRowId,
    description: product.description, quantity: product.quantity, unit: product.unit,
    retailUnitPrice: product.retailUnitPrice }], totals: base.partner.retailTotals, belowCostConfirmed: false };
  const paymentEvidence = { customerPaymentPlan: base.customer.customerPaymentPlan,
    sabalanPaymentPlan: base.accounting.sabalanPaymentPlan };
  const revisionCustomerContent = { contractDate: base.customer.contractDate, legalText: base.customer.legalText,
    deliveries, confirmation: 'NOT_SENT', signatures: [] };
  const graph = parseCanonicalProductGraph({ schemaVersion: 1, revision: 1,
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    catalogSnapshots: [{ catalogProductId: 'fixture-stone', snapshotVersion: 'catalog-v1', facts: {} }],
    rows: [{ productRowId: ids.rowId, catalogProductId: 'fixture-stone', catalogSnapshotVersion: 'catalog-v1',
      productType: 'longitudinal', contractualTitle: product.description, commercial: { requestedLengthMeters: '1',
        requestedQuantity: '2', requestedAreaSquareMeters: '1', totalAmountToman: '200',
        calculationSnapshot: { quantityMode: 'piece-count' } } }], stairSystems: [], layerConfigurations: [], sourceBatches: [],
    remainingStones: [], allocations: [], operationGroups: [], toolSelections: [], finishingSelections: [] });
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  const storedGraph = JSON.parse(JSON.stringify(graph)) as Prisma.InputJsonValue;
  const revisionEvidence = { purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1, graphHash,
    graph: storedGraph, partySnapshots, wholesaleEnvelope, retailEnvelope, paymentEvidence,
    customerContent: revisionCustomerContent };
  const integrityHash = await canonicalHash(revisionEvidence);
  const owner = { caseId: ids.caseId, revision: 1, integrityHash };
  const partner = { ...base.partner, owner, caseNumber: `${ids.caseId}-number`, customerContractNumber: `${ids.contractId}-number`,
    products: [{ productRowId: product.productRowId, description: product.description, quantity: product.quantity,
      unit: product.unit, wholesaleUnitPrice: product.wholesaleUnitPrice, retailUnitPrice: product.retailUnitPrice }], deliveries };
  const accounting = { ...base.accounting, owner, recordId: ids.internalId, recordNumber: `${ids.internalId}-number`,
    caseNumber: partner.caseNumber, customerContractNumber: partner.customerContractNumber,
    commercialAccountId: ids.accountId, products: [{ productRowId: product.productRowId, description: product.description,
      quantity: product.quantity, unit: product.unit, wholesaleUnitPrice: product.wholesaleUnitPrice,
      approvalEvidenceId: product.approvalEvidenceId }] };
  const storedAccounting = tamperAccounting ? { ...accounting,
    totals: { ...accounting.totals, payable: '999999' } } : accounting;
  const fulfillment = { ...base.fulfillment, owner, recordId: ids.internalId,
    products: [{ productRowId: product.productRowId, description: product.description,
      quantity: product.quantity, unit: product.unit }], deliveries };
  const customerCore = { ...base.customer, contractNumber: partner.customerContractNumber, revision: 1,
    status: 'DRAFT' as const, confirmation: 'NOT_SENT' as const,
    products: [{ productRowId: product.productRowId, description: product.description, quantity: product.quantity,
      unit: product.unit, retailUnitPrice: product.retailUnitPrice }], deliveries };
  const { outputHash: _fixtureOutputHash, ...customerContent } = customerCore;
  const customer = { ...customerContent,
    outputHash: await canonicalHash({ purpose: 'PARTNER_CUSTOMER_OUTPUT', owner, content: customerContent }) };
  await tx.user.create({ data: { id: ids.partnerId, username: ids.partnerId, email: `${ids.partnerId}@example.invalid`,
    password: 'not-a-login', firstName: 'Partner', lastName: 'Lifecycle' } });
  await tx.department.create({ data: { id: ids.departmentId, name: ids.departmentId, namePersian: ids.departmentId } });
  await tx.partnerProfile.create({ data: { id: ids.profileId, userId: ids.partnerId, state: 'ACTIVE' } });
  await tx.partnerCommercialAccount.create({ data: { id: ids.accountId, profileId: ids.profileId } });
  await tx.partnerReleaseCohort.create({ data: { id: ids.cohortId, name: ids.cohortId, activationEnabled: true,
    enrollmentPaused: false, operationalPaused: false } });
  await tx.partnerOperationsControl.upsert({ where: { id: 'partner-operations' }, create: {
    id: 'partner-operations', cohortId: ids.cohortId, enrollmentPaused: false, operationalPaused: false },
  update: { cohortId: ids.cohortId, enrollmentPaused: false, operationalPaused: false } });
  await tx.partnerCohortMembership.create({ data: { id: `${ids.cohortId}-membership`, profileId: ids.profileId,
    cohortId: ids.cohortId, actorId: ids.partnerId, eligibilityEvidence: { fixture: true } } });
  await tx.crmCustomer.create({ data: { id: ids.customerId, firstName: 'Customer', lastName: 'Lifecycle',
    ownerUserId: ids.partnerId, createdBy: ids.partnerId } });
  await tx.partnerSaleCase.create({ data: { id: ids.caseId, caseNumber: partner.caseNumber, profileId: ids.profileId,
    customerId: ids.customerId, internalRecordId: ids.internalId, customerContractId: ids.contractId,
    headRevision: 1, integrityHash } });
  await tx.partnerCaseRevision.create({ data: { caseId: ids.caseId, revision: 1, integrityHash, graphHash,
    graph: storedGraph, partySnapshots, wholesaleEnvelope, retailEnvelope, paymentEvidence, customerContent: revisionCustomerContent,
    internalProjection: { partner, accounting: storedAccounting, fulfillment }, customerProjection: customer,
    actorId: ids.partnerId, commandId: `${ids.caseId}-create` } });
  await tx.sabalanToPartnerSaleRecord.create({ data: { id: ids.internalId, recordNumber: accounting.recordNumber,
    caseId: ids.caseId, commercialAccountId: ids.accountId, expectedRevision: 1, integrityHash } });
  await tx.salesContract.create({ data: { id: ids.contractId, contractNumber: customer.contractNumber, title: 'Partner customer sale',
    titlePersian: 'قرارداد فروش مشتری همکار', content: 'متن تست', customerId: ids.customerId, departmentId: ids.departmentId,
    createdBy: ids.partnerId, responsibleSellerId: ids.partnerId, partnerKind: 'PARTNER_CUSTOMER', partnerCaseId: ids.caseId,
    partnerRevision: 1, partnerIntegrityHash: integrityHash, totalAmount: base.customer.totals.payable, currency: 'IRR', contractData: customer } });
  await tx.partnerProductRow.create({ data: { id: ids.rowId, caseId: ids.caseId } });
  await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 1, productRowId: ids.rowId,
    configurationHash: hash, quantity: '2', unit: 'm', precisionPolicyVersion: 'measured-v1' } });
  for (const delivery of deliveries) {
    await tx.partnerCaseDelivery.create({ data: { caseId: ids.caseId, revision: 1, id: delivery.deliveryId,
      date: new Date(`${delivery.date}T00:00:00.000Z`), destination: delivery.destination } });
    await tx.partnerCaseDeliveryItem.createMany({ data: delivery.items.map(item => ({ caseId: ids.caseId,
      revision: 1, deliveryId: delivery.deliveryId, productRowId: item.productRowId, quantity: item.quantity })) });
  }
  await tx.partnerCaseEvent.create({ data: { id: `${ids.caseId}-created-event`, caseId: ids.caseId, caseRevision: 1,
    integrityHash, sequence: 1, stateRevision: 1, type: 'CASE_CREATED', toState: 'DRAFT', actorId: ids.partnerId,
    commandId: `${ids.caseId}-create`, correlationId: `${ids.caseId}-create`, effectiveDate: new Date('2026-08-30'), evidence: {} } });
  return owner;
}

function dependencies(tx: Prisma.TransactionClient, ids: Ids, cancelled: string[] = [], authorized: string[] = [],
  enforceProfileState = false, reviews: string[] = []):
PartnerCaseLifecycleDependencies {
  return { actorId: ids.partnerId, cancellationPurpose: 'PARTNER', transaction: async work => {
    await tx.$executeRaw`SAVEPOINT partner_case_lifecycle`;
    try { const result = await work(tx); await tx.$executeRaw`RELEASE SAVEPOINT partner_case_lifecycle`; return result; }
    catch (error) { await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_case_lifecycle`;
      await tx.$executeRaw`RELEASE SAVEPOINT partner_case_lifecycle`; throw error; }
  }, authorize: async (_tx, request) => { authorized.push(request.action);
    if (enforceProfileState && request.action === 'CASE_COMMIT') {
      const profile = await _tx.partnerProfile.findUniqueOrThrow({ where: { id: ids.profileId }, select: { state: true } });
      if (profile.state !== 'ACTIVE') return { ok: false, error: partnerError('PARTNER_NOT_ACTIVE') };
    }
    return { ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }; },
  verifyOutputEvidence: async (_tx, input) => ({ ok: true, value: { evidenceId: input.authenticatedOutputEvidenceId,
    occurredAt: input.trigger === 'SIGNED' ? '2026-08-30T08:00:00.000Z' : '2026-08-30T09:00:00.000Z', outputHash: hash } }),
  cancelConfirmationSessions: async () => { cancelled.push('pending-session'); return { ok: true, value: {
    invalidatedSessionIds: ['pending-session'], preservedSnapshotIds: [`${ids.caseId}-verified-snapshot`] } }; },
  recordEvidenceReview: async (_tx, input) => { reviews.push(input.code); } };
}

async function commitCommand(ids: Ids, owner: RevisionRef, trigger: 'SIGNED' | 'PRINTED', suffix = trigger.toLowerCase()):
Promise<Extract<PartnerCommand, { type: 'CASE_COMMIT' }>> {
  const intent = { trigger, authenticatedOutputEvidenceId: `${ids.caseId}-${suffix}-output` };
  return { schemaVersion: 1, type: 'CASE_COMMIT', commandId: `${ids.caseId}-${suffix}-command`,
    correlationId: `${ids.caseId}-${suffix}-correlation`, expected: owner, expectedState: 'CUSTOMER_APPROVED', ...intent,
    idempotency: { actorId: ids.partnerId, operation: 'CASE_COMMIT', targetId: ids.caseId, key: `${ids.caseId}-${suffix}-key`,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_COMMIT', ...intent }) } };
}

async function cancelCommand(ids: Ids, owner: RevisionRef,
  expectedState: 'DRAFT' | 'AWAITING_CUSTOMER_CONFIRMATION' | 'CUSTOMER_APPROVED' = 'DRAFT'):
Promise<Extract<PartnerCommand, { type: 'CASE_CANCEL' }>> {
  const intent = { reason: 'لغو پرونده پیش از تعهد نهایی' };
  return { schemaVersion: 1, type: 'CASE_CANCEL', commandId: `${ids.caseId}-cancel-command`,
    correlationId: `${ids.caseId}-cancel-correlation`, expected: owner, expectedState, ...intent,
    idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL', targetId: ids.caseId, key: `${ids.caseId}-cancel-key`,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', ...intent }) } };
}

async function fixture(run: (tx: Prisma.TransactionClient, ids: Ids, owner: RevisionRef) => Promise<void>,
  tamperAccounting = false) {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback Partner lifecycle fixture');
  try { await database.$transaction(async tx => { const ids = idsFor(`partner-lifecycle-${randomUUID()}`);
    const owner = await seedCase(tx, ids, tamperAccounting); await run(tx, ids, owner); throw rollback; }, { timeout: 30_000 }); }
  catch (error) { if (error !== rollback) throw error; } finally { await database.$disconnect(); }
}

test('confirmation, approval and both issuance facts create one commitment without status regression', () => fixture(async (tx, ids, owner) => {
  const authorized: string[] = [];
  const service = createPartnerCaseLifecycleService(dependencies(tx, ids, [], authorized, true));
  const awaitingInput = { expected: owner, commandId: `${ids.caseId}-send`,
    correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` };
  const awaiting = await service.markAwaitingCustomerConfirmation(awaitingInput);
  assert.equal(awaiting.ok && awaiting.value.case.state, 'AWAITING_CUSTOMER_CONFIRMATION');
  const awaitingReplay = await service.markAwaitingCustomerConfirmation(awaitingInput);
  assert.equal(awaitingReplay.ok && awaitingReplay.value.replayed, true);
  const changedAwaiting = await service.markAwaitingCustomerConfirmation({ ...awaitingInput,
    snapshotId: `${ids.caseId}-different-snapshot` });
  assert.equal(changedAwaiting.ok ? null : changedAwaiting.error.code, 'IDEMPOTENCY_CONFLICT');
  const approved = await service.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
    correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T07:30:00.000Z' });
  assert.equal(approved.ok && approved.value.case.state, 'CUSTOMER_APPROVED');

  const signedCommand = await commitCommand(ids, owner, 'SIGNED');
  const signed = await service.execute(signedCommand);
  assert.equal(signed.ok && signed.value.case?.state, 'COMMITTED');
  await tx.partnerProfile.update({ where: { id: ids.profileId }, data: { state: 'SUSPENDED' } });
  const printed = await service.execute(await commitCommand(ids, owner, 'PRINTED'));
  assert.equal(printed.ok, true);
  const authorizationCount = authorized.length;
  const replay = await service.execute(signedCommand);
  assert.equal(replay.ok && replay.value.replayed, true);
  assert.equal(authorized.length, authorizationCount);
  const lateOtp = await service.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve-late`,
    correlationId: `${ids.caseId}-approve-late`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T09:30:00.000Z' });
  assert.equal(lateOtp.ok, true);

  const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { customerContract: true } });
  assert.equal(root.state, 'COMMITTED'); assert.equal(root.customerContract.status, 'PRINTED');
  assert.equal(root.commitmentTrigger, 'SIGNED');
  assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } }), 1);
  assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: { in: ['CASE_SIGNED', 'CASE_PRINTED'] } } }), 2);
}));

test('suspension and termination block new commitment while committed output obligations continue', async () => {
  for (const state of ['SUSPENDED', 'TERMINATED'] as const) {
    await fixture(async (tx, ids, owner) => {
      const service = createPartnerCaseLifecycleService(dependencies(tx, ids, [], [], true));
      await service.markAwaitingCustomerConfirmation({ expected: owner, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await service.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`,
        verifiedAt: '2026-08-30T07:30:00.000Z' });
      await tx.partnerProfile.update({ where: { id: ids.profileId }, data: { state } });
      const blocked = await service.execute(await commitCommand(ids, owner, 'SIGNED'));
      assert.equal(blocked.ok ? null : blocked.error.code, 'PARTNER_NOT_ACTIVE');
      assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'CUSTOMER_APPROVED');
    });
    await fixture(async (tx, ids, owner) => {
      const service = createPartnerCaseLifecycleService(dependencies(tx, ids, [], [], true));
      await service.markAwaitingCustomerConfirmation({ expected: owner, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await service.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`,
        verifiedAt: '2026-08-30T07:30:00.000Z' });
      assert.equal((await service.execute(await commitCommand(ids, owner, 'SIGNED'))).ok, true);
      await tx.partnerProfile.update({ where: { id: ids.profileId }, data: { state } });
      const continued = await service.execute(await commitCommand(ids, owner, 'PRINTED'));
      assert.equal(continued.ok, true);
      const committed = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId },
        include: { customerContract: true } });
      assert.equal(committed.state, 'COMMITTED');
      assert.equal(committed.customerContract.status, 'PRINTED');
    });
  }
});

test('projection content that is not derived from canonical revision evidence fails closed', () =>
  fixture(async (tx, ids, owner) => {
    const reviews: string[] = [];
    const service = createPartnerCaseLifecycleService(dependencies(tx, ids, [], [], false, reviews));
    const result = await service.markAwaitingCustomerConfirmation({ expected: owner,
      commandId: `${ids.caseId}-send`, correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
    assert.equal(result.ok ? null : result.error.code, 'INTEGRITY_CONFLICT');
    assert.deepEqual(reviews, ['INTEGRITY_CONFLICT']);
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'DRAFT');
  }, true));

test('operational pause blocks commitment but support cancellation remains atomic and retained', () => fixture(async (tx, ids, owner) => {
  const cancelled: string[] = [];
  const service = createPartnerCaseLifecycleService(dependencies(tx, ids, cancelled));
  await service.markAwaitingCustomerConfirmation({ expected: owner, commandId: `${ids.caseId}-send`,
    correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
  await service.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
    correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T07:30:00.000Z' });
  const revision = await tx.partnerCaseRevision.findUniqueOrThrow({
    where: { caseId_revision: { caseId: ids.caseId, revision: 1 } }, select: { customerProjection: true },
  });
  const customerOutput = revision.customerProjection as Prisma.JsonObject;
  await tx.partnerCustomerOutputSnapshot.create({ data: { id: `${ids.caseId}-verified-snapshot`, caseId: ids.caseId,
    caseRevision: 1, integrityHash: owner.integrityHash, contentHash: String(customerOutput.outputHash),
    contractNumber: String(customerOutput.contractNumber), recipient: '+989121234567',
    expiresAt: new Date('2026-09-30T00:00:00.000Z'), content: customerOutput,
    commandId: `${ids.caseId}-snapshot-command` } });
  await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
  const blocked = await service.execute(await commitCommand(ids, owner, 'PRINTED'));
  assert.equal(blocked.ok ? null : blocked.error.code, 'OPERATIONAL_PAUSE');
  const cancelledResult = await service.execute(await cancelCommand(ids, owner, 'CUSTOMER_APPROVED'));
  assert.equal(cancelledResult.ok && cancelledResult.value.case?.state, 'CANCELLED');
  assert.deepEqual(cancelled, ['pending-session']);
  const replay = await service.execute(await cancelCommand(ids, owner, 'CUSTOMER_APPROVED'));
  assert.equal(replay.ok && replay.value.replayed, true);
  const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { customerContract: true } });
  assert.equal(root.state, 'CANCELLED'); assert.equal(root.customerContract.status, 'CANCELLED');
  assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);
  assert.equal(await tx.partnerCaseRevision.count({ where: { caseId: ids.caseId } }), 1);
  assert.equal(await tx.partnerCustomerOutputSnapshot.count({ where: { caseId: ids.caseId } }), 1);
}));

test('durable Accounting queue replay returns the original Partner record without duplicating it', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const ids = idsFor(`partner-accounting-replay-${temporary.runId}`);
  const accountantId = `${ids.caseId}-accountant`;
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await database.$transaction(async tx => {
      const seeded = await seedCase(tx, ids);
      const lifecycle = createPartnerCaseLifecycleService(dependencies(tx, ids));
      await lifecycle.markAwaitingCustomerConfirmation({ expected: seeded, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await lifecycle.markCustomerApproved({ expected: seeded, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`,
        verifiedAt: '2026-08-30T08:00:00.000Z' });
      const committed = await lifecycle.execute(await commitCommand(ids, seeded, 'SIGNED'));
      assert.equal(committed.ok, true);
      return seeded;
    });
    const revision = await database.partnerCaseRevision.findUniqueOrThrow({ where: {
      caseId_revision: { caseId: ids.caseId, revision: 1 },
    }, select: { internalProjection: true } });
    const accounting = (revision.internalProjection as Prisma.JsonObject).accounting as Prisma.JsonObject;
    const committedEvent = await database.partnerCaseEvent.findFirstOrThrow({ where: {
      caseId: ids.caseId, type: 'CASE_COMMITTED',
    }, select: { evidence: true } });
    const commitment = PartnerEventSchema.parse((committedEvent.evidence as Prisma.JsonObject).publicEvent);
    if (commitment.type !== 'CASE_COMMITTED') throw new Error('Invalid Accounting replay fixture');
    await database.$transaction(async tx => {
      await tx.user.create({ data: { id: accountantId, username: accountantId,
        email: `${accountantId}@example.invalid`, password: 'not-a-login', firstName: 'Accounting', lastName: 'Replay' } });
      await tx.effectiveActionGrant.create({ data: { id: `${ids.caseId}-accounting-grant`, principalKind: 'USER',
        principalId: accountantId, subjectUserId: accountantId, domain: 'PARTNER', action: 'ACCOUNTING_WRITE',
        rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'ALLOW', grantedBy: accountantId,
        reason: 'isolated durable Accounting replay fixture', correlationId: `${ids.caseId}-grant` } });
    });
    const adapter = createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database,
      actorId: accountantId, correlationId: `${ids.caseId}-accounting` }));
    const view = { ...accounting, state: 'COMMITTED' } as Parameters<typeof adapter.enqueueCommitted>[0];
    const damagedQueueRollback = new Error('rollback damaged queue source');
    try {
      await database.$transaction(async tx => {
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
        await tx.partnerCaseRevision.update({ where: { caseId_revision: { caseId: ids.caseId, revision: 1 } },
          data: { graphHash: `sha256-v1:${'e'.repeat(64)}` } });
        await tx.$executeRawUnsafe('SET LOCAL session_replication_role = origin');
        const scoped = { $transaction: async <T>(work: (inner: Prisma.TransactionClient) => Promise<T>) => work(tx) } as PrismaClient;
        const result = await createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database: scoped,
          actorId: accountantId, correlationId: `${ids.caseId}-damaged-queue` })).enqueueCommitted(view, commitment);
        assert.equal(result.ok ? null : result.error.code, 'INTEGRITY_CONFLICT',
          'queue replay/preparation must rebuild the canonical Case source before accepting cached financial evidence');
        assert.equal(await tx.accountingFinancialRecord.count({ where: { sourceId: ids.internalId } }), 0);
        throw damagedQueueRollback;
      });
    } catch (error) { if (error !== damagedQueueRollback) throw error; }
    const frozenQueueRollback = new Error('rollback queue freeze branch');
    try {
      await database.$transaction(async tx => {
        const correctionId = `${ids.caseId}-frozen-queue`;
        await tx.partnerCorrectionOpportunity.create({ data: { id: correctionId, caseId: ids.caseId,
          predecessorRevision: 1, scope: 'SHARED', scopeHash: view.owner.integrityHash,
          requesterId: ids.partnerId, approvedBy: 'sales-manager', approvedAt: new Date(Date.now() - 60_000),
          expiresAt: new Date('2099-01-01'), calendarVersion: 'TEHRAN_WORKING_DAYS_V1', evidence: {} } });
        await tx.partnerCorrectionGate.create({ data: { id: `${correctionId}-sales`, opportunityId: correctionId,
          kind: 'SALES_SCOPE', outcome: 'APPROVE', actorId: 'sales-manager', commandId: `${correctionId}-sales`,
          evidence: { evidenceId: `${correctionId}-sales-evidence` } } });
        const scoped = { $transaction: async <T>(work: (inner: Prisma.TransactionClient) => Promise<T>) => work(tx) } as PrismaClient;
        const frozen = await createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database: scoped,
          actorId: accountantId, correlationId: `${correctionId}-enqueue` })).enqueueCommitted(view, commitment);
        assert.equal(frozen.ok ? null : frozen.error.code, 'DEPENDENCY_BLOCKED',
          'first invoicing cannot race between approved correction scope and its atomic effect');
        assert.equal(await tx.accountingFinancialRecord.count({ where: { sourceId: ids.internalId } }), 0);
        throw frozenQueueRollback;
      });
    } catch (error) { if (error !== frozenQueueRollback) throw error; }
    const first = await adapter.enqueueCommitted(view, commitment);
    assert.equal(first.ok, true);
    assert.deepEqual(await adapter.enqueueCommitted(view, commitment), first);
    assert.equal(await database.accountingFinancialRecord.count({ where: {
      sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE, sourceId: ids.internalId,
    } }), 1);
    // A retail-only successor changes ownership, not the already queued wholesale preparation.
    const predecessor = await database.partnerCaseRevision.findUniqueOrThrow({ where: {
      caseId_revision: { caseId: ids.caseId, revision: 1 } } });
    const successor = await database.$transaction(tx => prepareRetailSuccessor(tx, {
      predecessor: { caseId: ids.caseId, revision: 1, integrityHash: predecessor.integrityHash },
      retailPrices: ((predecessor.retailEnvelope as Prisma.JsonObject).products as Prisma.JsonObject[]).map(row => ({
        productRowId: String(row.productRowId), retailUnitPrice: { amount: String(row.retailUnitPrice), currency: 'IRR' } })),
      customerPaymentPlan: partnerContracts.PaymentPlanSchema.parse((predecessor.paymentEvidence as Prisma.JsonObject).customerPaymentPlan),
    }));
    const successorOwner = successor.owner;
    await database.$transaction(async tx => {
      // Install an isolated, reciprocal successor fixture without inventing customer confirmation.
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.partnerCaseRevision.create({ data: { ...predecessor, revision: 2, predecessorRevision: 1,
        integrityHash: successorOwner.integrityHash, commandId: `${ids.caseId}-retail-successor`,
        graph: predecessor.graph as Prisma.InputJsonValue, partySnapshots: predecessor.partySnapshots as Prisma.InputJsonValue,
        wholesaleEnvelope: predecessor.wholesaleEnvelope as Prisma.InputJsonValue,
        retailEnvelope: successor.fields.retailEnvelope as Prisma.InputJsonValue,
        paymentEvidence: successor.fields.paymentEvidence as Prisma.InputJsonValue,
        customerContent: predecessor.customerContent as Prisma.InputJsonValue,
        customerProjection: successor.projections.customer,
        internalProjection: { partner: successor.projections.partner, accounting: successor.projections.accounting,
          fulfillment: successor.projections.fulfillment } } });
      await tx.partnerSaleCase.update({ where: { id: ids.caseId }, data: { headRevision: 2,
        integrityHash: successorOwner.integrityHash } });
      await tx.sabalanToPartnerSaleRecord.update({ where: { id: ids.internalId }, data: {
        expectedRevision: 2, integrityHash: successorOwner.integrityHash } });
      await tx.salesContract.update({ where: { id: ids.contractId }, data: {
        partnerRevision: 2, partnerIntegrityHash: successorOwner.integrityHash } });
      const bindings = await tx.partnerCaseRowBinding.findMany({ where: { caseId: ids.caseId, revision: 1 } });
      for (const binding of bindings) await tx.partnerCaseRowBinding.create({ data: { ...binding, revision: 2 } });
      const plan = partnerContracts.PaymentPlanSchema.parse((predecessor.paymentEvidence as Prisma.JsonObject).customerPaymentPlan);
      await tx.partnerPaymentPlan.create({ data: { id: plan.planId, caseId: ids.caseId, caseRevision: 2,
        purpose: 'RETAIL', version: plan.version, effectiveDate: new Date(plan.effectiveDate), evidence: plan,
        integrityHash: await canonicalHash(plan) } });
    });
    const pendingInvoice = await database.accountingFinancialRecord.findFirstOrThrow({ where: { sourceId: ids.internalId } });
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerFinancialApprovalProbe.ts'], { timeout: 30_000, env: { ...process.env,
      DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_INVOICE_ID: pendingInvoice.id, PARTNER_TEST_ACTOR_ID: accountantId } });
    assert.equal(await database.accountingReceivable.count({ where: { invoiceRecord: { sourceId: ids.internalId } } }), 1);
    const existingInvoice = await database.accountingFinancialRecord.findFirstOrThrow({ where: { sourceId: ids.internalId } });
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerAccountingActionProbe.ts'], { timeout: 30_000, env: { ...process.env,
      DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_INVOICE_ID: existingInvoice.id, PARTNER_TEST_ACTOR_ID: accountantId } });
    const unchangedObligation = await database.$transaction(tx => validatePartnerSharedAccountingEffect(tx, {
      caseId: ids.caseId, internalRecordId: ids.internalId, partnerSellerId: ids.partnerId,
      successor: { ...view, owner: successorOwner },
    }));
    assert.equal(unchangedObligation.ok, true);
    const changedTax = structuredClone({ ...view, owner: { ...successorOwner, revision: 3, integrityHash: `sha256-v1:${'d'.repeat(64)}` } });
    changedTax.totals.tax = '100'; changedTax.totals.payable = '1700';
    changedTax.sabalanPaymentPlan = { ...changedTax.sabalanPaymentPlan, planId: `${ids.caseId}-tax-successor-plan`,
      version: 2, predecessorPlanId: changedTax.sabalanPaymentPlan.planId,
      installments: [{ ...changedTax.sabalanPaymentPlan.installments[0]!, amount: { amount: '1700', currency: 'IRR' } }] };
    const unsupportedReplacement = await database.$transaction(tx => validatePartnerSharedAccountingEffect(tx, {
      caseId: ids.caseId, internalRecordId: ids.internalId, partnerSellerId: ids.partnerId, successor: changedTax,
    }));
    assert.equal(unsupportedReplacement.ok ? null : unsupportedReplacement.error.code, 'DEPENDENCY_BLOCKED',
      'even a tax-only payable change with zero net-sales delta needs a formal Accounting replacement');
    assert.equal((await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
    const replacementRollback = new Error('rollback isolated replacement branch');
    await database.workspacePermission.update({ where: { userId_workspace: { userId: accountantId, workspace: 'accounting' } },
      data: { permissionLevel: 'admin' } });
    const exactPlan = partnerContracts.PaymentPlanSchema.parse((predecessor.paymentEvidence as Prisma.JsonObject).customerPaymentPlan);
    exactPlan.installments[0].amount.amount = '180143985094819862468.02';
    const exactRetail = await database.$transaction(tx => prepareRetailSuccessor(tx, { predecessor: successorOwner,
      retailPrices: [{ productRowId: ids.rowId, retailUnitPrice: { amount: '90071992547409931234.01', currency: 'IRR' } }],
      customerPaymentPlan: exactPlan }));
    assert.equal(exactRetail.projections.partner.retailTotals.payable, '180143985094819862468.02');
    const exactReadRollback = new Error('rollback exact canonical reader fixture');
    try {
      await database.$transaction(async tx => {
        const prior = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: { caseId: ids.caseId, revision: 2 } } });
        await tx.partnerCaseRevision.create({ data: { ...prior, revision: exactRetail.owner.revision, predecessorRevision: 2,
          integrityHash: exactRetail.owner.integrityHash, commandId: `${ids.caseId}-exact-reader`,
          graph: prior.graph as Prisma.InputJsonValue, partySnapshots: prior.partySnapshots as Prisma.InputJsonValue,
          wholesaleEnvelope: prior.wholesaleEnvelope as Prisma.InputJsonValue,
          retailEnvelope: exactRetail.fields.retailEnvelope as Prisma.InputJsonValue,
          paymentEvidence: exactRetail.fields.paymentEvidence as Prisma.InputJsonValue,
          customerContent: prior.customerContent as Prisma.InputJsonValue,
          customerProjection: exactRetail.projections.customer,
          internalProjection: { partner: exactRetail.projections.partner, accounting: exactRetail.projections.accounting,
            fulfillment: exactRetail.projections.fulfillment } } });
        const rebuilt = await readPartnerRevisionProjections(tx, exactRetail.owner);
        assert.ok(rebuilt, 'canonical reader must reproduce exact large-money projection without Decimal rounding');
        assert.equal(rebuilt.partner.retailTotals.payable, '180143985094819862468.02');
        throw exactReadRollback;
      });
    } catch (error) { if (error !== exactReadRollback) throw error; }
    try {
      await database.$transaction(async tx => {
        const correctionId = `${ids.caseId}-tax-correction`;
        const predecessorRevision = await tx.partnerCaseRevision.findUniqueOrThrow({ where: {
          caseId_revision: { caseId: ids.caseId, revision: 2 } } });
        const fields = { graphHash: predecessorRevision.graphHash, graph: predecessorRevision.graph,
          partySnapshots: predecessorRevision.partySnapshots,
          wholesaleEnvelope: { ...(predecessorRevision.wholesaleEnvelope as Prisma.JsonObject), totals: changedTax.totals },
          retailEnvelope: predecessorRevision.retailEnvelope,
          paymentEvidence: { ...(predecessorRevision.paymentEvidence as Prisma.JsonObject), sabalanPaymentPlan: changedTax.sabalanPaymentPlan },
          customerContent: predecessorRevision.customerContent };
        changedTax.owner.integrityHash = await canonicalHash({ purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1,
          predecessor: { revision: 2, integrityHash: predecessorRevision.integrityHash }, ...fields });
        const wholesaleProducts = (fields.wholesaleEnvelope as Prisma.JsonObject).products as Prisma.JsonObject[];
        const retailProducts = (fields.retailEnvelope as Prisma.JsonObject).products as Prisma.JsonObject[];
        const projections = await buildCaseProjections({ ...changedTax.owner, caseNumber: changedTax.caseNumber,
          internalRecordId: changedTax.recordId, internalRecordNumber: changedTax.recordNumber,
          customerContractNumber: changedTax.customerContractNumber, commercialAccountId: changedTax.commercialAccountId,
          state: 'DRAFT', evidence: { ...fields, products: wholesaleProducts.map(row => ({ ...row,
            retailUnitPrice: retailProducts.find(retailRow => retailRow.productRowId === row.productRowId)!.retailUnitPrice })),
          resaleDifference: subtract(String(((fields.retailEnvelope as Prisma.JsonObject).totals as Prisma.JsonObject).payable), changedTax.totals.payable),
          } as unknown as CaseRevisionProjectionEvidence });
        assert.equal(projections.ok, true);
        if (!projections.ok) throw new Error('Replacement fixture projection failed');
        await tx.partnerCorrectionOpportunity.create({ data: { id: correctionId, caseId: ids.caseId,
          predecessorRevision: 2, scope: 'SABALAN_TERMS', scopeHash: changedTax.owner.integrityHash,
          requesterId: ids.partnerId, approvedBy: 'sales-manager', approvedAt: new Date(Date.now() - 60_000),
          expiresAt: new Date('2099-01-01'), calendarVersion: 'TEHRAN_WORKING_DAYS_V1', evidence: {} } });
        await tx.partnerCaseRevision.create({ data: { ...predecessorRevision, revision: 3, predecessorRevision: 2,
          integrityHash: changedTax.owner.integrityHash, commandId: `${correctionId}-save`,
          graphHash: fields.graphHash,
          graph: fields.graph as Prisma.InputJsonValue, partySnapshots: fields.partySnapshots as Prisma.InputJsonValue,
          wholesaleEnvelope: fields.wholesaleEnvelope as Prisma.InputJsonValue,
          retailEnvelope: fields.retailEnvelope as Prisma.InputJsonValue, paymentEvidence: fields.paymentEvidence as Prisma.InputJsonValue,
          customerContent: fields.customerContent as Prisma.InputJsonValue, customerProjection: projections.value.customer,
          internalProjection: { partner: projections.value.partner, accounting: projections.value.accounting, fulfillment: projections.value.fulfillment } } });
        await tx.partnerCorrectionSave.create({ data: { opportunityId: correctionId, caseId: ids.caseId,
          successorRevision: 3, actorId: ids.partnerId, commandId: `${correctionId}-save` } });
        const stagedInvoice = await stagePartnerAccountingReplacement(tx, { caseId: ids.caseId, correctionId, actorId: ids.partnerId });
        assert.ok(stagedInvoice);
        assert.equal(stagedInvoice.amount.toString(), '1700');
        assert.equal(stagedInvoice.status, 'DRAFT');
        assert.equal(stagedInvoice.contractId, null);
        assert.equal(stagedInvoice.customerId, null);
        assert.equal(await tx.accountingReceivable.count({ where: { invoiceRecord: { sourceId: ids.internalId } } }), 1,
          'staging a replacement cannot create or replace the current debt');
        assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
        assert.equal((await stagePartnerAccountingReplacement(tx, { caseId: ids.caseId, correctionId, actorId: ids.partnerId }))?.id,
          stagedInvoice.id, 'staging retries return one immutable source-bound invoice draft');
        await tx.effectiveActionGrant.create({ data: { id: `${ids.caseId}-replacement-approval-grant`, principalKind: 'USER',
          principalId: accountantId, subjectUserId: accountantId, domain: 'PARTNER', action: 'FINANCIAL_APPROVE',
          rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'ALLOW', grantedBy: accountantId,
          reason: 'isolated replacement Accounting approval', correlationId: `${ids.caseId}-replacement-grant` } });
        await tx.partnerCorrectionGate.create({ data: { id: `${correctionId}-process`, opportunityId: correctionId,
          kind: 'ACCOUNTING_PROCESS', outcome: 'APPROVE', actorId: 'separate-accounting-processor',
          commandId: `${correctionId}-process`, evidence: { evidenceId: `${correctionId}-processing-evidence` } } });
        const approvedAt = new Date();
        const earlierInvoiceDate = new Date(approvedAt.getTime() - 86_400_000);
        const history = async (cutoff = new Date()) => readPartnerOutstandingHistory(tx, {
          invoiceIds: [existingInvoice.id, stagedInvoice.id], cutoff, asOf: new Date(),
        });
        assert.deepEqual((await history()).map(row => row.remainingAmount), ['1600']);
        const approvedReplacement = await tx.accountingFinancialRecord.update({ where: { id: stagedInvoice.id }, data: {
          status: 'ISSUED', financiallyApprovedAt: approvedAt, financiallyApprovedBy: accountantId,
          systemInvoiceNumber: `${correctionId}-external-invoice`, systemInvoiceDate: earlierInvoiceDate, sepidarAmount: '1700' } });
        await approvePartnerFinancialSourceWithinTransaction(tx, approvedReplacement, { actorId: accountantId,
          commandId: `${correctionId}-financial-approval`, correlationId: `${correctionId}-financial-approval`,
          approvedAt, effectiveDate: approvedAt, externalReference: `${correctionId}-external-cancellation`,
          downstreamNote: 'تسویه مستند پیش از جایگزینی صورتحساب' });
        assert.equal(await tx.accountingReceivable.count({ where: { invoiceRecord: { sourceId: ids.internalId } } }), 1,
          'official approval of a staged replacement cannot expose successor debt before Case effect');
        assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'SABALAN_FINANCIAL_APPROVED' } }), 1);
        assert.deepEqual((await history()).map(row => row.remainingAmount), ['1600'],
          'a validated staged approval remains invisible until atomic Case activation');
        await tx.$executeRaw`SAVEPOINT abandoned_staged_approval`;
        const beforeVoid = new Date(), voidInstant = new Date(beforeVoid.getTime() + 1);
        await tx.accountingFinancialRecord.update({ where: { id: stagedInvoice.id }, data: { status: 'VOIDED', voidedAt: voidInstant } });
        await assert.rejects(history, /سابقه تعهد/, 'retired staged evidence without Case void provenance remains a conflict');
        const voidCase = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
        const voidEvent = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CASE_VOIDED', eventId: `${correctionId}-void`,
          commandId: `${correctionId}-void`, correlationId: `${correctionId}-void`, actorId: accountantId,
          recordedAt: voidInstant.toISOString(), effectiveDate: voidInstant.toISOString().slice(0, 10), owner: successorOwner,
          correctionId: `${correctionId}-void-opportunity`, commitmentEventId: voidCase.commitmentEventId,
          adjustmentEventIds: [`${correctionId}-void-adjustment`], dependencyEvidenceIds: [`${correctionId}-void-dependencies`],
          reason: 'شواهد ایزوله تاریخچه ابطال پرونده' });
        await tx.partnerSaleCase.update({ where: { id: ids.caseId }, data: { state: 'VOIDED', stateRevision: { increment: 1 } } });
        await tx.partnerCaseEvent.create({ data: { id: voidEvent.eventId, caseId: ids.caseId, caseRevision: 2,
          integrityHash: successorOwner.integrityHash, sequence: 20, stateRevision: voidCase.stateRevision + 1,
          type: 'CASE_VOIDED', fromState: 'COMMITTED', toState: 'VOIDED', actorId: accountantId,
          commandId: voidEvent.commandId, correlationId: voidEvent.correlationId, effectiveDate: voidInstant,
          evidence: { publicEvent: voidEvent } } });
        await tx.accountingFinancialRecord.update({ where: { id: existingInvoice.id }, data: { status: 'VOIDED', voidedAt: voidInstant } });
        assert.deepEqual((await history(beforeVoid)).map(row => row.remainingAmount), ['1600']);
        assert.deepEqual(await history(), [], 'Case void retires the published debt; abandoned staging contributes no debt');
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT abandoned_staged_approval`;
        await tx.$executeRaw`RELEASE SAVEPOINT abandoned_staged_approval`;
        const fulfillment = partnerContracts.FulfillmentViewSchema.parse((predecessorRevision.internalProjection as Prisma.JsonObject).fulfillment);
        for (const product of fulfillment.products) {
          await tx.partnerCaseRowBinding.create({ data: { caseId: ids.caseId, revision: 3,
            productRowId: product.productRowId, configurationHash: hash, quantity: product.quantity,
            unit: product.unit, precisionPolicyVersion: 'measured-v1' } });
          await tx.partnerFulfillmentLineage.create({ data: { id: `${product.productRowId}-lineage`, caseId: ids.caseId,
            caseRevision: 2, integrityHash: successorOwner.integrityHash, internalRecordId: ids.internalId,
            productRowId: product.productRowId, quantity: product.quantity, unit: product.unit,
            recipient: { customerId: ids.customerId }, deliveryIds: [], commandId: `${product.productRowId}-lineage` } });
        }
        await tx.partnerCaseEvent.create({ data: { id: `${correctionId}-prior-retail-effect`, caseId: ids.caseId,
          caseRevision: 2, integrityHash: successorOwner.integrityHash, sequence: 20, type: 'CORRECTION_EFFECTIVE',
          effectiveDate: new Date(),
          actorId: ids.partnerId, commandId: `${correctionId}-prior-retail-effect`, correlationId: correctionId, evidence: {
            publicEvent: { schemaVersion: 1, type: 'CORRECTION_EFFECTIVE', eventId: `${correctionId}-prior-retail-effect`,
              commandId: `${correctionId}-prior-retail-effect`, correlationId: correctionId, actorId: ids.partnerId,
              owner: successorOwner, predecessor: view.owner, correctionId: `${correctionId}-prior-retail`, scope: 'RETAIL_ONLY',
              gateEvidenceIds: [`${correctionId}-prior-customer`], recordedAt: new Date().toISOString(),
              effectiveDate: new Date().toISOString().slice(0, 10) } } } });
        await capturePartnerContractedQuantities(tx, fulfillment);
        const quantity = await readPartnerShipmentQuantityProjection(tx, ids.caseId);
        const plan = partnerContracts.PaymentPlanSchema.parse((predecessorRevision.paymentEvidence as Prisma.JsonObject).customerPaymentPlan);
        const physicalEvidence = quantity.rows.flatMap(row => row.sourceEvidenceIds).sort();
        const dependencies: PartnerCorrectionDependencyInput = {
          predecessorProducts: (await tx.partnerCaseRowBinding.findMany({ where: { caseId: ids.caseId, revision: 2 } }))
            .map(({ productRowId, quantity, unit }) => ({ productRowId, quantity: quantity.toString(), unit })),
          successorProducts: fulfillment.products.map(({ productRowId, quantity, unit }) => ({ productRowId, quantity, unit })),
          physical: { evidenceIds: physicalEvidence, rows: quantity.rows.map(row => ({ productRowId: row.productRowId,
            unit: row.unit!, health: 'CURRENT', reserved: row.quantities!.finalizedReserved,
            dispatched: row.quantities!.physicallyDispatched })) },
          financial: { evidenceIds: [plan.planId], health: 'CURRENT', receiptStateHash: await canonicalHash({ receipts: [] }) },
          suppliedEvidenceIds: [...physicalEvidence, plan.planId].sort(), predecessorChildren: [], successorChildren: [],
        };
        await tx.partnerCaseEvent.create({ data: { id: `${correctionId}-saved`, caseId: ids.caseId, caseRevision: 3,
          integrityHash: changedTax.owner.integrityHash, sequence: 21, type: 'CORRECTION_SUCCESSOR_SAVED',
          effectiveDate: new Date(),
          actorId: ids.partnerId, commandId: `${correctionId}-saved`, correlationId: correctionId,
          evidence: JSON.parse(JSON.stringify({ pricing: [], dependencies })) } });
        for (const [kind, actorId] of [['SALES_SCOPE', 'sales-manager'], ['ACCOUNTING_MANAGER', accountantId],
          ['CUSTOMER_CONFIRM', 'isolated-customer-confirmation']] as const) {
          await tx.partnerCorrectionGate.create({ data: { id: `${correctionId}-${kind}`, opportunityId: correctionId,
            kind, outcome: 'APPROVE', actorId, commandId: `${correctionId}-${kind}`,
            evidence: { evidenceId: `${correctionId}-${kind}-evidence` } } });
        }
        await tx.effectiveActionGrant.create({ data: { id: `${ids.caseId}-replacement-verify-grant`, principalKind: 'USER',
          principalId: accountantId, subjectUserId: accountantId, domain: 'PARTNER', action: 'FINANCIAL_VERIFY',
          rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'ALLOW', grantedBy: accountantId,
          reason: 'isolated replacement Accounting verification', correlationId: `${ids.caseId}-verify-grant` } });
        const scoped = { $transaction: async <T>(work: (inner: Prisma.TransactionClient) => Promise<T>) => {
          await tx.$executeRaw`SAVEPOINT replacement_effect`;
          try { const result = await work(tx); await tx.$executeRaw`RELEASE SAVEPOINT replacement_effect`; return result; }
          catch (error) { await tx.$executeRaw`ROLLBACK TO SAVEPOINT replacement_effect`;
            await tx.$executeRaw`RELEASE SAVEPOINT replacement_effect`; throw error; }
        } } as PrismaClient;
        const intent = { correctionId, gate: 'ACCOUNTING_VERIFY' as const, outcome: 'APPROVE' as const,
          evidenceId: `${correctionId}-verify-evidence`, reason: 'تأیید نهایی جایگزینی تعهد مستقل همکار' };
        const command = { schemaVersion: 1, type: 'CORRECTION_GATE', commandId: `${correctionId}-verify`,
          correlationId: `${correctionId}-verify`, expected: successorOwner, expectedState: 'COMMITTED', ...intent,
          idempotency: { actorId: accountantId, operation: 'CORRECTION_GATE', targetId: ids.caseId, key: `${correctionId}-verify`,
            payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CORRECTION_GATE', ...intent }) } } as
          Extract<PartnerCommand, { type: 'CORRECTION_GATE' }>;
        const service = createPrismaPartnerFinancialCorrectionComposition({ database: scoped, actorId: accountantId,
          correlationId: command.correlationId, reason: command.reason }).shared;
        const oldReceivable = await tx.accountingReceivable.findFirstOrThrow({ where: { invoiceRecordId: existingInvoice.id } });
        const heldCheck = await tx.accountingPaymentStatus.create({ data: { receivableId: oldReceivable.id,
          method: 'CHECK', amount: '200', currency: 'IRR', status: 'RECEIVED', checkStatus: 'RECEIVED',
          metadata: { collectionMovements: [] }, createdBy: accountantId } });
        const unsettled = await service.execute(command);
        assert.equal(unsettled.ok ? null : unsettled.error.code, 'DEPENDENCY_BLOCKED');
        assert.equal(await tx.partnerCorrectionGate.count({ where: { opportunityId: correctionId } }), 4);
        assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
        await tx.accountingPaymentStatus.update({ where: { id: heldCheck.id }, data: { status: 'REVERSED', checkStatus: 'RETURNED' } });
        await tx.$executeRaw`SAVEPOINT corrupted_predecessor_receivable`;
        await tx.accountingReceivable.update({ where: { id: oldReceivable.id }, data: { originalAmount: '999' } });
        const corrupted = await service.execute(command);
        assert.equal(corrupted.ok ? null : corrupted.error.code, 'INTEGRITY_CONFLICT');
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT corrupted_predecessor_receivable`;
        await tx.$executeRaw`RELEASE SAVEPOINT corrupted_predecessor_receivable`;
        for (const data of [{ status: 'SETTLED' as const }, { status: 'PARTIALLY_PAID' as const }, { remainingAmount: '900' }]) {
          await tx.$executeRaw`SAVEPOINT contradictory_predecessor_balance`;
          await tx.accountingReceivable.update({ where: { id: oldReceivable.id }, data });
          const contradictory = await service.execute(command);
          assert.equal(contradictory.ok ? null : contradictory.error.code, 'INTEGRITY_CONFLICT', JSON.stringify(data));
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT contradictory_predecessor_balance`;
          await tx.$executeRaw`RELEASE SAVEPOINT contradictory_predecessor_balance`;
        }
        await tx.$executeRaw`SAVEPOINT revoked_replacement_approver`;
        await tx.effectiveActionGrant.update({ where: { id: `${ids.caseId}-replacement-approval-grant` }, data: {
          revokedAt: new Date(), revokedBy: accountantId, revocationReason: 'isolated revocation regression',
          revocationCorrelationId: `${correctionId}-revoke` } });
        const revoked = await service.execute(command);
        assert.equal(revoked.ok ? null : revoked.error.code, 'FORBIDDEN');
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT revoked_replacement_approver`;
        await tx.$executeRaw`RELEASE SAVEPOINT revoked_replacement_approver`;
        const beforeActivation = new Date();
        for (const administrativeDate of [earlierInvoiceDate, new Date(approvedAt.getTime() + 86_400_000)]) {
          await tx.$executeRaw`SAVEPOINT replacement_date_boundary`;
          const dated = await tx.accountingFinancialRecord.update({ where: { id: stagedInvoice.id }, data: {
            systemInvoiceDate: administrativeDate,
          } });
          await approvePartnerFinancialSourceWithinTransaction(tx, dated, { actorId: accountantId,
            commandId: `${correctionId}-financial-approval`, correlationId: `${correctionId}-financial-approval`,
            approvedAt, effectiveDate: administrativeDate, externalReference: `${correctionId}-external-cancellation`,
            downstreamNote: 'تسویه مستند پیش از جایگزینی صورتحساب' });
          const effective = await service.execute(command);
          assert.equal(effective.ok, true, JSON.stringify(effective));
          assert.deepEqual((await history(beforeActivation)).map(row => row.remainingAmount), ['1600'],
            'administrative invoice dating cannot move replacement debt before activation');
          assert.deepEqual((await history()).map(row => row.remainingAmount), ['1700'],
            'an activated future-dated invoice must not leave a gap in current debt');
          const trend = await readPartnerAccountingTrend(tx, { invoiceIds: [existingInvoice.id, stagedInvoice.id],
            asOf: new Date(), periods: [{ key: 'activation', monthKey: 'activation', label: 'activation', marker: true,
              startsAt: beforeActivation, endsAt: new Date() }] });
          assert.equal(trend[0].points[0].invoiced, '100', 'the replacement adjustment belongs to the activation period');
          await tx.$executeRaw`ROLLBACK TO SAVEPOINT replacement_date_boundary`;
          await tx.$executeRaw`RELEASE SAVEPOINT replacement_date_boundary`;
        }
        const effective = await service.execute(command);
        assert.equal(effective.ok, true, JSON.stringify(effective));
        assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 3);
        assert.equal((await tx.accountingFinancialRecord.findUniqueOrThrow({ where: { id: existingInvoice.id } })).status, 'VOIDED');
        assert.equal(await tx.accountingReceivable.count({ where: { invoiceRecord: { sourceId: ids.internalId }, status: { not: 'VOIDED' } } }), 1);
        assert.equal(await tx.partnerFinancialAdjustment.count({ where: { correctionId } }), 0,
          'tax-only replacement changes payable but never invents a net-sales adjustment');
        const account = await createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database: scoped,
          actorId: ids.partnerId, correlationId: `${correctionId}-account` })).readOwnAccount(ids.partnerId);
        assert.equal(account.ok, true, JSON.stringify(account));
        if (account.ok) assert.equal(account.value.purchases[0].amount.amount, '1700');
        assert.equal((await service.execute(command)).ok, true);
        assert.equal(await tx.accountingReceivable.count({ where: { invoiceRecord: { sourceId: ids.internalId } } }), 2);
        throw replacementRollback;
      }, { timeout: 30_000 });
    } catch (error) { if (error !== replacementRollback) throw error; }
    const ownAccount = await createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database,
      actorId: ids.partnerId, correlationId: `${ids.caseId}-own-account` })).readOwnAccount(ids.partnerId);
    assert.equal(ownAccount.ok, true);
    if (ownAccount.ok) assert.equal(ownAccount.value.purchases[0].status, 'PAYABLE');
    const officialReceivable = await database.accountingReceivable.findFirstOrThrow({ where: {
      invoiceRecord: { sourceId: ids.internalId } } });
    const check = await database.accountingPaymentStatus.create({ data: { receivableId: officialReceivable.id,
      method: 'CHECK', amount: '200', currency: 'IRR', status: 'RECEIVED', checkStatus: 'RECEIVED',
      metadata: { collectionMovements: [] }, createdBy: accountantId } });
    const currentAccount = () => createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database,
      actorId: ids.partnerId, correlationId: `${ids.caseId}-own-collections` })).readOwnAccount(ids.partnerId);
    const uncollected = await currentAccount();
    assert.equal(uncollected.ok, true);
    if (uncollected.ok) assert.equal(uncollected.value.purchases[0].received.amount, '0', 'an uncleared cheque is not received money');
    await database.accountingPaymentStatus.update({ where: { id: check.id }, data: { status: 'RECONCILED', checkStatus: 'BOUNCED',
      metadata: { collectionMovements: [
        { kind: 'CHECK_CLEARED', effectiveAt: '2026-09-01T08:00:00.000Z', amount: '200' },
        { kind: 'CHECK_BOUNCED', effectiveAt: '2026-09-02T08:00:00.000Z', amount: '-200' },
      ] } } });
    const bounced = await currentAccount();
    assert.equal(bounced.ok, true);
    if (bounced.ok) assert.equal(bounced.value.purchases[0].received.amount, '0', 'a bounced cheque reverses its collection');
    const publicCorrection = PartnerEventSchema.parse({ schemaVersion: 1, type: 'CORRECTION_EFFECTIVE',
      eventId: `${ids.caseId}-correction-event`, commandId: `${ids.caseId}-correction-command`,
      correlationId: `${ids.caseId}-correction-event`, actorId: ids.partnerId, recordedAt: new Date().toISOString(),
      effectiveDate: '2026-09-01', owner: successorOwner, predecessor: view.owner, correctionId: `${ids.caseId}-correction`,
      scope: 'RETAIL_ONLY', gateEvidenceIds: [`${ids.caseId}-customer-confirmation`] });
    await database.partnerCaseEvent.create({ data: { id: publicCorrection.eventId, caseId: ids.caseId,
      caseRevision: 2, integrityHash: successorOwner.integrityHash, sequence: 99, type: publicCorrection.type,
      actorId: ids.partnerId, commandId: publicCorrection.commandId, correlationId: publicCorrection.correlationId,
      effectiveDate: new Date('2026-09-01'), evidence: { publicEvent: publicCorrection } } });
    const reporting = createPrismaPartnerReportingSource({ database, actorId: ids.partnerId, correlationId: `${ids.caseId}-past` });
    const historical = await reporting.read({ purpose: 'PARTNER', from: '2026-08-01', to: '2026-08-31' },
      async snapshot => projectReportRow(partnerContracts, await snapshot.caseEvidence({ caseId: ids.caseId,
        partnerSellerId: ids.partnerId, departmentId: ids.departmentId }, 'PARTNER'), 'PARTNER',
      { from: '2026-08-01', to: '2026-08-31', asOf: snapshot.capturedAt }));
    assert.equal(historical.revision, 1, 'later retail correction must not replace historical source ownership');
    assert.equal(historical.account?.status, 'AWAITING_REVIEW', 'later approval must not enter earlier balances');
    const currentReport = () => reporting.read({ purpose: 'PARTNER', from: '2026-08-01', to: '2026-12-31' },
      async snapshot => snapshot.caseEvidence({ caseId: ids.caseId, partnerSellerId: ids.partnerId,
        departmentId: ids.departmentId }, 'PARTNER'));
    assert.equal((await currentReport()).account?.received.amount, '0');
    const approvedInvoice = await database.accountingFinancialRecord.findUniqueOrThrow({ where: { id: officialReceivable.invoiceRecordId! } });
    const pendingReplacement = await database.accountingFinancialRecord.create({ data: {
      kind: 'INVOICE_CANDIDATE', status: 'DRAFT', sourceKind: PARTNER_INTERNAL_ACCOUNTING_SOURCE,
      sourceId: ids.internalId, amount: approvedInvoice.amount, currency: approvedInvoice.currency,
      sourceSnapshot: approvedInvoice.sourceSnapshot as Prisma.InputJsonValue,
      metadata: { partnerCaseId: ids.caseId }, createdBy: accountantId } });
    assert.equal((await currentReport()).account?.status, 'PAYABLE', 'a later unapproved draft does not hide the effective obligation');
    const accountWithDraft = await currentAccount();
    assert.equal(accountWithDraft.ok, true);
    if (accountWithDraft.ok) assert.equal(accountWithDraft.value.purchases[0].status, 'PAYABLE');
    await database.accountingFinancialRecord.delete({ where: { id: pendingReplacement.id } });
    await database.accountingFinancialRecord.update({ where: { id: approvedInvoice.id }, data: { metadata: { partnerCaseId: ids.caseId } } });
    await assert.rejects(currentReport, /integrity/i, 'published approval with missing invoice evidence fails closed');
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});

test('persisted report margin and commitment exclude separately evidenced taxes and charges', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const ids = idsFor(`partner-pass-through-${temporary.runId}`);
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    await database.$transaction(async tx => {
      const owner = await seedCase(tx, ids, false, true);
      const lifecycle = createPartnerCaseLifecycleService(dependencies(tx, ids));
      await lifecycle.markAwaitingCustomerConfirmation({ expected: owner, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await lifecycle.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T08:00:00.000Z' });
      const committed = await lifecycle.execute(await commitCommand(ids, owner, 'SIGNED'));
      assert.equal(committed.ok, true, JSON.stringify(committed));
    });
    const reporting = createPrismaPartnerReportingSource({ database, actorId: ids.partnerId, correlationId: `${ids.caseId}-report` });
    const result = await reporting.read({ purpose: 'PARTNER', from: '2026-08-01', to: '2026-08-31' }, async snapshot =>
      projectReportRow(partnerContracts, await snapshot.caseEvidence({ caseId: ids.caseId, partnerSellerId: ids.partnerId,
        departmentId: ids.departmentId }, 'PARTNER'), 'PARTNER', { from: '2026-08-01', to: '2026-08-31', asOf: snapshot.capturedAt }));
    assert.equal(result.metrics?.netComparableMargin, '400');
    assert.equal(result.metrics?.wholesalePurchases, '1600');
    assert.equal(result.metrics?.retailSales, '2000');
    assert.equal(result.account?.amount.amount, '1700', 'pass-throughs remain payable, but are not comparable margin');
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});

test('real-schema loading source selects canonical delivery evidence without changing the stable lineage', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const ids = idsFor(`partner-delivery-source-${temporary.runId}`);
  const actorId = `${ids.caseId}-manager`;
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    const expected = await database.$transaction(async tx => {
      const owner = await seedCase(tx, ids, false, false, [
        { deliveryId: 'first-delivery', date: '2026-09-05', destination: 'محل نخست مشتری', items: [{ productRowId: ids.rowId, quantity: '1.25' }] },
        { deliveryId: 'second-delivery', date: '2026-09-10', destination: 'محل دوم مشتری', items: [{ productRowId: ids.rowId, quantity: '0.75' }] },
      ]);
      const lifecycle = createPartnerCaseLifecycleService(dependencies(tx, ids));
      await lifecycle.markAwaitingCustomerConfirmation({ expected: owner, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await lifecycle.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T08:00:00.000Z' });
      assert.equal((await lifecycle.execute(await commitCommand(ids, owner, 'SIGNED'))).ok, true);
      await tx.user.create({ data: { id: actorId, username: actorId, email: `${actorId}@example.invalid`,
        password: 'not-a-login', firstName: 'Loading', lastName: 'Manager', role: 'ADMIN' } });
      return owner;
    });
    const fulfillment = createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database, actorId,
      correlationId: `${ids.caseId}-selection`, reason: 'بررسی و ثبت منبع تحویل مستقیم مشتری' }));
    const source = await database.$transaction(tx => readPartnerRevisionProjections(tx, expected));
    assert.ok(source);
    const caseRow = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { head: true } });
    const view = partnerContracts.FulfillmentViewSchema.parse((caseRow.head.internalProjection as Prisma.JsonObject).fulfillment);
    const materialized = await fulfillment.ensureCommittedLineage(view, { schemaVersion: 1, expected,
      commandId: `${ids.caseId}-lineage`, correlationId: `${ids.caseId}-lineage`, authenticatedActorId: actorId,
      idempotencyKey: `${ids.caseId}-lineage` });
    assert.equal(materialized.ok, true, JSON.stringify(materialized));
    const first = await fulfillment.readLoadingSource(expected, 'first-delivery');
    const second = await fulfillment.readLoadingSource(expected, 'second-delivery');
    assert.equal(first.ok, true, JSON.stringify(first)); assert.equal(second.ok, true, JSON.stringify(second));
    if (first.ok && second.ok) {
      assert.equal(first.value.recipient.destination, 'محل نخست مشتری');
      assert.equal(second.value.recipient.destination, 'محل دوم مشتری');
      assert.equal(second.value.plannedDate, '2026-09-10');
      assert.equal(second.value.rows[0].plannedQuantity, '0.750');
      assert.equal(first.value.rows[0].lineageId, second.value.rows[0].lineageId);
    }
    const lineage = await database.partnerFulfillmentLineage.findUniqueOrThrow({ where: { caseId_productRowId: {
      caseId: ids.caseId, productRowId: ids.rowId } } });
    const replaceOriginHash = (integrityHash: string) => database.$transaction(async tx => {
      await tx.$executeRawUnsafe('SET LOCAL session_replication_role = replica');
      await tx.partnerFulfillmentLineage.update({ where: { id: lineage.id }, data: { integrityHash } });
    });
    try {
      await replaceOriginHash(`sha256-v1:${'f'.repeat(64)}`);
      const invalidOrigin = await fulfillment.readLoadingSource(expected, 'second-delivery');
      assert.equal(invalidOrigin.ok ? null : invalidOrigin.error.code, 'INTEGRITY_CONFLICT',
        'loading must verify the immutable origin hash of its existing physical lineage');
    } finally { await replaceOriginHash(lineage.integrityHash); }
    const missing = await fulfillment.readLoadingSource(expected, 'unowned-delivery');
    assert.equal(missing.ok ? null : missing.error.code, 'NOT_FOUND');
    const stale = await fulfillment.readLoadingSource({ ...expected, revision: 2 }, 'second-delivery');
    assert.equal(stale.ok ? null : stale.error.code, 'ROW_STALE');
    const loadingCommand = { expected, deliveryId: 'second-delivery', actorId,
      correlationId: `${ids.caseId}-loading`, idempotencyKey: `${ids.caseId}-loading`,
      reason: 'ثبت بارگیری تحویل دوم مشتری از پرونده قطعی' };
    const created = await createPartnerCaseLoading(database, loadingCommand);
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok) return;
    const reopened = await readPartnerCaseLoading(database, { loadingId: created.value.loadingId, actorId,
      correlationId: `${ids.caseId}-reopen`, reason: 'بررسی بارگیری ثبت‌شده مشتری' });
    assert.equal(reopened.ok, true, JSON.stringify(reopened));
    if (reopened.ok) {
      assert.equal(reopened.value.status, 'DRAFT');
      assert.equal(reopened.value.source.recipient.destination, 'محل دوم مشتری');
      assert.equal(reopened.value.source.plannedDate, '2026-09-10');
      assert.equal(reopened.value.source.rows[0].plannedQuantity, '0.750');
      assert.equal(reopened.value.source.sourceKind, 'PARTNER_CASE');
      assert.equal('projectId' in reopened.value, false, 'a Case delivery must not manufacture an ordinary project');
      assert.equal(/wholesaleUnitPrice|retailUnitPrice|PaymentPlan/.test(JSON.stringify(reopened.value)), false);
    }
    const replay = await createPartnerCaseLoading(database, loadingCommand);
    assert.equal(replay.ok, true, JSON.stringify(replay));
    if (replay.ok) {
      assert.equal(replay.value.loadingId, created.value.loadingId);
      assert.equal(replay.value.replayed, true);
    }
    await database.logisticsLoading.update({ where: { id: created.value.loadingId }, data: { partnerDeliveryId: 'first-delivery' } });
    try {
      const wrongDeliveryReplay = await createPartnerCaseLoading(database, loadingCommand);
      assert.equal(wrongDeliveryReplay.ok ? null : wrongDeliveryReplay.error.code, 'INTEGRITY_CONFLICT',
        'replay verifies the persisted selected delivery, not only the retained source snapshot');
    } finally {
      await database.logisticsLoading.update({ where: { id: created.value.loadingId }, data: { partnerDeliveryId: 'second-delivery' } });
    }
    const loaderId = `${ids.caseId}-loader`;
    await database.user.create({ data: { id: loaderId, username: loaderId, email: `${loaderId}@example.invalid`,
      password: 'not-a-login', firstName: 'Loading', lastName: 'Operator' } });
    for (const action of ['FULFILLMENT_READ', 'FULFILLMENT_WRITE']) {
      await database.effectiveActionGrant.create({ data: { id: `${loaderId}-${action}`, principalKind: 'USER',
        principalId: loaderId, subjectUserId: loaderId, domain: 'PARTNER', action, rootKind: 'CASE',
        purpose: 'FULFILLMENT', scope: 'PURPOSE_BOUND', boundRootId: ids.caseId, effect: 'ALLOW',
        grantedBy: actorId, reason: 'isolated loading authority fixture', correlationId: `${loaderId}-${action}` } });
    }
    for (const feature of ['logistics_loadings_create', 'logistics_loadings_view']) {
      await database.featurePermission.create({ data: { userId: loaderId, workspace: 'logistics', feature,
        permissionLevel: 'edit', grantedBy: actorId } });
    }
    await database.workspacePermission.create({ data: { userId: loaderId, workspace: 'logistics', permissionLevel: 'edit', grantedBy: actorId } });
    const employeeCommand = { ...loadingCommand, actorId: loaderId, idempotencyKey: `${loaderId}-create` };
    const employeeCreated = await createPartnerCaseLoading(database, employeeCommand);
    assert.equal(employeeCreated.ok, true, JSON.stringify(employeeCreated));
    await database.workspacePermission.update({ where: { userId_workspace: { userId: loaderId, workspace: 'logistics' } },
      data: { permissionLevel: 'view' } });
    const revokedReplay = await createPartnerCaseLoading(database, employeeCommand);
    assert.equal(revokedReplay.ok ? null : revokedReplay.error.code, 'FORBIDDEN',
      'a retained Case/feature grant cannot bypass the current view-only Logistics workspace on replay');
    await database.workspacePermission.update({ where: { userId_workspace: { userId: loaderId, workspace: 'logistics' } },
      data: { permissionLevel: 'edit' } });
    let waiting: ReturnType<typeof createPartnerCaseLoading> | undefined;
    try {
      await database.$transaction(async tx => {
        await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
        waiting = createPartnerCaseLoading(database, { ...employeeCommand, idempotencyKey: `${loaderId}-concurrent` });
        let blocked = false;
        const deadline = Date.now() + 3000;
        while (Date.now() < deadline) {
          await tx.$queryRaw`SELECT pg_stat_clear_snapshot()::text`;
          const waits = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM pg_stat_activity
            WHERE datname = current_database() AND pid <> pg_backend_pid() AND wait_event_type = 'Lock'
              AND query LIKE '%partner_operations_controls%'`;
          if (Number(waits[0].count)) { blocked = true; break; }
          await new Promise(resolve => setTimeout(resolve, 20));
        }
        assert.equal(blocked, true, 'loading creation reached the shared command lock');
        await tx.workspacePermission.update({ where: { userId_workspace: { userId: loaderId, workspace: 'logistics' } },
          data: { permissionLevel: 'view' } });
      });
      const concurrent = await waiting!;
      assert.equal(concurrent.ok ? null : concurrent.error.code, 'FORBIDDEN',
        'a workspace downgrade committed while loading waits must invalidate its earlier authorization snapshot');
    } finally { await waiting; }
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerLoadingHttpProbe.ts'], { timeout: 120_000, env: { ...process.env,
        DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_ACTOR_ID: actorId, PARTNER_TEST_OWNER: JSON.stringify(expected) } });
    const accountantId = `${ids.caseId}-dispatch-accountant`;
    await database.$transaction(async tx => {
      await tx.user.create({ data: { id: accountantId, username: accountantId,
        email: `${accountantId}@example.invalid`, password: 'not-a-login', firstName: 'Dispatch', lastName: 'Accountant' } });
      for (const action of ['ACCOUNTING_READ', 'ACCOUNTING_WRITE']) await tx.effectiveActionGrant.create({ data: {
        id: `${accountantId}-${action}`, principalKind: 'USER', principalId: accountantId, subjectUserId: accountantId,
        domain: 'PARTNER', action, rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'PURPOSE_BOUND',
        boundRootId: ids.caseId, effect: 'ALLOW', grantedBy: actorId, reason: 'isolated dispatch document authority',
        correlationId: `${accountantId}-${action}` } });
    });
    const committedCase = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { head: true } });
    const committedPublicEvent = await database.partnerCaseEvent.findFirstOrThrow({ where: {
      caseId: ids.caseId, type: 'CASE_COMMITTED' }, select: { evidence: true } });
    const commitment = PartnerEventSchema.parse((committedPublicEvent.evidence as Prisma.JsonObject).publicEvent);
    if (commitment.type !== 'CASE_COMMITTED') throw new Error('Committed Partner event fixture is invalid');
    const accountingView = { ...((committedCase.head.internalProjection as Prisma.JsonObject).accounting as object),
      state: 'COMMITTED' } as Parameters<ReturnType<typeof createPartnerAccountingAdapter>['enqueueCommitted']>[0];
    const queued = await createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database,
      actorId: accountantId, correlationId: `${accountantId}-queue` })).enqueueCommitted(accountingView, commitment);
    assert.equal(queued.ok, true, JSON.stringify(queued));
    const invoice = await database.accountingFinancialRecord.findFirstOrThrow({ where: { sourceId: ids.internalId } });
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerFinancialApprovalProbe.ts'], { timeout: 120_000, env: { ...process.env,
        DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_INVOICE_ID: invoice.id, PARTNER_TEST_ACTOR_ID: accountantId } });
    for (const [feature, permissionLevel] of [['accounting_dispatch_candidates_view', 'view'],
      ['accounting_dispatch_candidates_manage', 'edit']] as const) {
      await database.featurePermission.create({ data: { userId: accountantId, workspace: 'accounting', feature,
        permissionLevel, grantedBy: accountantId } });
    }
    await promisify(execFile)(process.execPath, ['backend/node_modules/tsx/dist/cli.mjs',
      'backend/src/services/__tests__/partnerFinalizationHttpProbe.ts'], { timeout: 180_000, env: { ...process.env,
        DATABASE_URL: temporary.databaseUrl, PARTNER_TEST_ACTOR_ID: actorId, PARTNER_TEST_ACCOUNTANT_ID: accountantId,
        PARTNER_TEST_OWNER: JSON.stringify(expected) } });
  } finally { await database.$disconnect(); await temporary.cleanup(); }
});

test('real-schema correction HTTP dispatch approves a requested retail correction, saves once and confirms its successor', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()), sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const ids = idsFor(`partner-retail-http-${temporary.runId}`);
  let actorId = ids.partnerId;
  const app = express();
  app.use(express.json());
  // Substitute only session authentication; every command still executes the real current DB authorization policy.
  const authenticate: express.RequestHandler = (request, _response, next) => {
    (request as AuthRequest).user = { id: actorId } as AuthRequest['user']; next();
  };
  app.use('/corrections', createPartnerCorrectionRouter({ database, authenticate }));
  app.use('/cases', createPartnerCaseRouter({ database, authenticate }));
  const server = createServer(app);
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    const owner = await database.$transaction(async tx => {
      const seeded = await seedCase(tx, ids);
      const lifecycle = createPartnerCaseLifecycleService(dependencies(tx, ids));
      await lifecycle.markAwaitingCustomerConfirmation({ expected: seeded, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await lifecycle.markCustomerApproved({ expected: seeded, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T08:00:00.000Z' });
      assert.equal((await lifecycle.execute(await commitCommand(ids, seeded, 'SIGNED'))).ok, true);
      const plan = createPartnerFixtures().customer.customerPaymentPlan;
      await tx.partnerPaymentPlan.create({ data: { id: plan.planId, caseId: ids.caseId, caseRevision: 1,
        purpose: 'RETAIL', version: 1, effectiveDate: new Date(plan.effectiveDate), evidence: plan, integrityHash: await canonicalHash(plan) } });
      await tx.user.create({ data: { id: `${ids.caseId}-manager`, username: `${ids.caseId}-manager`,
        email: `${ids.caseId}-manager@example.invalid`, password: 'not-a-login', firstName: 'Review', lastName: 'Manager', role: 'ADMIN' } });
      return seeded;
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture address unavailable');
    const post = async (path: string, body: unknown) => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method: 'POST',
        headers: { 'content-type': 'application/json', Connection: 'close' }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as { success: boolean; code?: string; data: any } };
    };
    const command = async (intent: Record<string, unknown>, suffix: string) => ({ schemaVersion: 1, ...intent,
      commandId: `${ids.caseId}-${suffix}`, correlationId: `${ids.caseId}-${suffix}`,
      idempotency: { actorId, operation: intent.type, targetId: ids.caseId, key: `${ids.caseId}-${suffix}`,
        payloadHash: await canonicalHash(intent) } });
    const fulfillment = createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database,
      actorId: `${ids.caseId}-manager`, correlationId: `${ids.caseId}-physical`, reason: 'ثبت تبار فیزیکی تعهد قطعی همکار' }));
    const materialize = async (suffix: string) => {
      const current = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { head: true } });
      const view = partnerContracts.FulfillmentViewSchema.parse((current.head.internalProjection as Prisma.JsonObject).fulfillment);
      return fulfillment.ensureCommittedLineage(view, { schemaVersion: 1, commandId: `${ids.caseId}-${suffix}`,
        correlationId: `${ids.caseId}-${suffix}`, authenticatedActorId: `${ids.caseId}-manager`,
        idempotencyKey: `${ids.caseId}-${suffix}`, expected: view.owner });
    };
    const missingBaseline = await database.$transaction(tx => readPartnerShipmentQuantityProjection(tx, ids.caseId));
    assert.equal(missingBaseline.rows.length, 1, 'an unmaterialized committed row is missing coverage, not an empty complete report');
    assert.equal(missingBaseline.rows[0].canAuthorizeLoading, false);
    assert.equal(missingBaseline.totalsByUnit[0].isComplete, false);
    const initialLineage = await materialize('first-lineage');
    assert.equal(initialLineage.ok, true, JSON.stringify(initialLineage));
    const retainedLoading = await createPartnerCaseLoading(database, { expected: owner,
      deliveryId: createPartnerFixtures().customer.deliveries[0].deliveryId, actorId: `${ids.caseId}-manager`,
      correlationId: `${ids.caseId}-loading`, idempotencyKey: `${ids.caseId}-loading`, reason: 'ثبت بارگیری پیش از اصلاح تجاری' });
    assert.equal(retainedLoading.ok, true, JSON.stringify(retainedLoading));
    const frozenRecipient = await database.partnerFulfillmentLineage.findFirstOrThrow({ where: { caseId: ids.caseId } });
    assert.equal((frozenRecipient.recipient as Prisma.JsonObject).displayName, createPartnerFixtures().customer.customer.displayName);
    await database.crmCustomer.update({ where: { id: ids.customerId }, data: { firstName: 'Later CRM edit', lastName: 'Not the frozen delivery recipient' } });
    const sameLineage = await materialize('same-lineage-new-command');
    assert.equal(sameLineage.ok, true, JSON.stringify(sameLineage));
    const physicalDependencies = async () => {
      const current = await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { head: true } });
      return fulfillment.inspectDependencies(partnerContracts.FulfillmentViewSchema.parse((current.head.internalProjection as Prisma.JsonObject).fulfillment));
    };
    const initialDependencies = await physicalDependencies();
    assert.equal(initialDependencies.ok, true, JSON.stringify(initialDependencies));
    if (initialDependencies.ok) {
      assert.deepEqual(initialDependencies.value.blockedProductRowIds, []);
      assert.equal(initialDependencies.value.evidenceIds.length, 1, 'the stable lineage has an authoritative contracted-quantity event');
    }
    const physicalEvidence = await database.shipmentQuantityEvidence.findFirstOrThrow({ where: { partnerCaseId: ids.caseId } });
    assert.equal(physicalEvidence.sourceKind, 'PARTNER_CASE');
    assert.equal(physicalEvidence.contractId, null);
    assert.equal(physicalEvidence.contractItemId, null);
    assert.equal(await database.contractItem.count({ where: { contractId: ids.contractId } }), 0);
    await assert.rejects(database.shipmentQuantityEvidence.create({ data: { ...physicalEvidence,
      id: `${ids.caseId}-foreign-quantity`, sourceId: `${ids.caseId}-foreign-quantity`, metadata: {},
      partnerIntegrityHash: `sha256-v1:${'f'.repeat(64)}` } }), /foreign key|constraint/i);
    await assert.rejects(database.shipmentQuantityEvidence.create({ data: { ...physicalEvidence,
      id: `${ids.caseId}-mixed-quantity`, sourceId: `${ids.caseId}-mixed-quantity`, metadata: {},
      contractId: ids.contractId } }), /constraint/i);
    const request = await command({ type: 'CORRECTION_REQUEST', expected: owner, expectedState: 'COMMITTED',
      scope: 'RETAIL_ONLY', reason: 'اصلاح مستند قیمت فروش به مشتری' }, 'request');
    assert.equal((await post('/corrections/commands', request)).status, 200);
    const correctionId = `correction:${request.commandId}`;
    assert.equal(await database.partnerCorrectionOpportunity.count({ where: { id: correctionId } }), 0,
      'the initial SALES_SCOPE dispatcher cannot depend on a not-yet-created opportunity');
    actorId = `${ids.caseId}-manager`;
    const correlationId = `${ids.caseId}-scope-evidence`;
    const evidence = await database.$transaction(async tx => {
      const result = await createAuditedPartnerAuthorization(tx, { actorId, purpose: 'MANAGEMENT', channel: 'API' },
        { correlationId, reason: 'تأیید مستند دامنه اصلاح' }).authorize('CORRECTION_SCOPE_APPROVE', { kind: 'CASE', id: ids.caseId });
      assert.equal(result.ok, true);
      return readAuthorizationDecisionByCorrelation(tx, { domain: 'PARTNER', actorId, action: 'CORRECTION_SCOPE_APPROVE',
        rootKind: 'CASE', rootId: ids.caseId, purpose: 'MANAGEMENT', channel: 'API', correlationId, allowed: true });
    });
    assert.ok(evidence);
    const gate = await command({ type: 'CORRECTION_GATE', expected: owner, expectedState: 'COMMITTED', correctionId,
      gate: 'SALES_SCOPE', outcome: 'APPROVE', evidenceId: evidence.id, reason: 'تأیید مستند دامنه اصلاح' }, 'scope');
    const approved = await post('/corrections/commands', gate);
    assert.equal(approved.status, 200, JSON.stringify(approved.body));
    assert.equal(await database.partnerCorrectionGate.count({ where: { opportunityId: correctionId, kind: 'SALES_SCOPE' } }), 1);
    actorId = ids.partnerId;
    const opportunity = await post('/corrections/query', { caseId: ids.caseId });
    assert.equal(opportunity.body.data.status, 'APPROVED_TO_EDIT');
    const plan = createPartnerFixtures().customer.customerPaymentPlan;
    const nextPlan = { ...plan, planId: `${ids.caseId}-retail-plan-v2`, version: 2, predecessorPlanId: plan.planId,
      effectiveDate: '2099-01-01', installments: [{ installmentId: `${ids.caseId}-retail-v2-installment`, dueDate: '2099-01-02',
        amount: { amount: '2200', currency: 'IRR' }, method: 'CASH' }] };
    const save = await command({ type: 'RETAIL_CORRECTION_SAVE', expected: owner, expectedState: 'COMMITTED',
      opportunityId: opportunity.body.data.opportunityId,
      retailPrices: [{ productRowId: ids.rowId, retailUnitPrice: { amount: '1100', currency: 'IRR' } }], customerPaymentPlan: nextPlan }, 'save');
    const saved = await post('/corrections/commands', save);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal((await post('/corrections/commands', save)).status, 200);
    assert.equal(await database.partnerCorrectionSave.count({ where: { caseId: ids.caseId } }), 1);
    const successor = saved.body.data.head as RevisionRef;
    let capturedOtp: string | undefined;
    const customerFlow = createPrismaPartnerConfirmationHooks({ database, sms: {
      sendContractConfirmationMessage: async input => { capturedOtp = input.code; return { success: true }; },
    } });
    const sent = await customerFlow.sendForConfirmation({ contractId: ids.contractId, requestedBy: ids.partnerId });
    assert.equal(sent?.success, true, sent?.error);
    assert.ok(sent?.data?.publicLink && capturedOtp);
    const token = new URL(sent.data.publicLink).pathname.split('/').at(-1)!;
    const publicOutput = await customerFlow.getPublicContractByToken(token);
    assert.equal(publicOutput?.data?.contract.revision, 2);
    assert.equal(publicOutput?.data?.contract.totals.payable, '2200');
    assert.equal((await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 1);
    const confirmed = await customerFlow.verifyPublicOtp({ token, code: capturedOtp });
    assert.equal(confirmed?.success, true, confirmed?.error);
    assert.equal((await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
    if (retainedLoading.ok) {
      const history = await readPartnerCaseLoading(database, { loadingId: retainedLoading.value.loadingId,
        actorId: `${ids.caseId}-manager`, correlationId: `${ids.caseId}-loading-history`, reason: 'بازخوانی بارگیری پس از اصلاح تجاری' });
      assert.equal(history.ok, true, JSON.stringify(history));
      if (history.ok) assert.deepEqual(history.value.source.owner, owner,
        'an effective retail successor must not rewrite or hide the original loading source');
    }
    const atomicSuccessorQuantity = await database.shipmentQuantityEvidence.findFirst({ where: {
      partnerCaseId: ids.caseId, partnerCaseRevision: 2, kind: 'CONTRACTED_SET' } });
    assert.ok(atomicSuccessorQuantity, 'effective correction publishes its existing physical obligations in the same transaction');
    const successorLineage = await materialize('retail-successor-lineage');
    assert.equal(successorLineage.ok, true, JSON.stringify(successorLineage));
    if (successorLineage.ok && initialLineage.ok) assert.deepEqual(successorLineage.value.lineageEvidenceIds, initialLineage.value.lineageEvidenceIds);
    const successorDependencies = await physicalDependencies();
    assert.equal(successorDependencies.ok, true, JSON.stringify(successorDependencies));
    if (successorDependencies.ok) assert.deepEqual(successorDependencies.value.blockedProductRowIds, []);
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.shipmentQuantityEvidence.update({ where: { id: physicalEvidence.id }, data: { quantity: '1.000' } });
    });
    const damagedPhysicalEvidence = await physicalDependencies();
    assert.equal(damagedPhysicalEvidence.ok, true);
    if (damagedPhysicalEvidence.ok) assert.deepEqual(damagedPhysicalEvidence.value.blockedProductRowIds, [ids.rowId],
      'damaged shipment evidence cannot be accepted as an empty or zero physical balance');
    assert.equal((await post('/cases/query-v2', { caseId: ids.caseId })).status, 200);
    actorId = `${ids.caseId}-manager`;
    await database.partnerProfile.update({ where: { id: ids.profileId }, data: { state: 'SUSPENDED' } });
    await database.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
    const remediationReason = 'رسیدگی داخلی مستند به تعهد همکار معلق در زمان توقف عملیاتی';
    const remediation = await command({ type: 'VOID_REMEDIATION_REQUEST', expected: successor,
      expectedState: 'COMMITTED', reason: remediationReason }, 'paused-remediation');
    remediation.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: 'VOID_REMEDIATION_REQUEST', reason: remediationReason });
    const requestedRemediation = await post('/corrections/commands', remediation);
    assert.equal(requestedRemediation.status, 200, JSON.stringify(requestedRemediation.body));
    const remediationGate = { correctionId: remediation.commandId, gate: 'SALES_SCOPE', outcome: 'APPROVE',
      evidenceId: `${ids.caseId}-remediation-scope-evidence`, reason: 'تأیید دامنه رسیدگی به تعهد قبلی همکار' };
    const scopeGate = await command({ type: 'CORRECTION_GATE', expected: successor,
      expectedState: 'COMMITTED', ...remediationGate }, 'paused-remediation-scope');
    scopeGate.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: 'CORRECTION_GATE', ...remediationGate });
    const acceptedScope = await post('/corrections/commands', scopeGate);
    assert.equal(acceptedScope.status, 200, JSON.stringify(acceptedScope.body));
    assert.equal((await database.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'COMMITTED',
      'opening remediation and accepting its scope cannot bypass the remaining financial and physical gates');
    actorId = ids.partnerId;
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      const row = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: { caseId: ids.caseId, revision: 2 } } });
      const projection = row.internalProjection as Prisma.JsonObject;
      await tx.partnerCaseRevision.update({ where: { caseId_revision: { caseId: ids.caseId, revision: 2 } }, data: {
        internalProjection: { ...projection, partner: { ...(projection.partner as Prisma.JsonObject),
          owner: { ...successor, caseId: `${ids.caseId}-foreign` } } } } });
    });
    assert.equal((await post('/cases/query-v2', { caseId: ids.caseId })).body.code, 'INTEGRITY_CONFLICT');
    const calendar = await database.$transaction(async tx => {
      await tx.sabalanCalendarEntry.create({ data: { date: new Date('2026-09-03T08:00:00Z'), isHoliday: true,
        title: 'تعطیل آزمایشی', eventType: 'COMPANY_HOLIDAY', createdBy: actorId } });
      return readPartnerWorkingCalendar(tx);
    });
    assert.equal(await calendar.addWorkingDays('2026-09-02T08:00:00.000Z', 3), '2026-09-07T08:00:00.000Z');
  } finally {
    server.closeAllConnections();
    if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await database.$disconnect(); await temporary.cleanup();
  }
});

test('persisted Accounting and reporting projections fail closed when ownership or public evidence is corrupted', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl: databaseUrl() });
  const database = temporary.client();
  const ids = idsFor(`partner-projection-integrity-${temporary.runId}`);
  try {
    await database.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });
    const owner = await database.$transaction(async tx => {
      const seeded = await seedCase(tx, ids);
      const lifecycle = createPartnerCaseLifecycleService(dependencies(tx, ids));
      await lifecycle.markAwaitingCustomerConfirmation({ expected: seeded, commandId: `${ids.caseId}-send`,
        correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
      await lifecycle.markCustomerApproved({ expected: seeded, commandId: `${ids.caseId}-approve`,
        correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`,
        verifiedAt: '2026-08-30T08:00:00.000Z' });
      assert.equal((await lifecycle.execute(await commitCommand(ids, seeded, 'SIGNED'))).ok, true);
      return seeded;
    });
    const revision = await database.partnerCaseRevision.findUniqueOrThrow({ where: {
      caseId_revision: { caseId: ids.caseId, revision: owner.revision },
    }, select: { internalProjection: true } });
    const originalProjection = revision.internalProjection as Prisma.JsonObject;
    const accounting = originalProjection.accounting as Prisma.JsonObject;
    const partner = originalProjection.partner as Prisma.JsonObject;
    const reporting = createPrismaPartnerReportingSource({ database, actorId: ids.partnerId,
      correlationId: `${ids.caseId}-reporting` });
    const reportEvidence = () => reporting.read({ purpose: 'PARTNER', from: '2026-08-01', to: '2026-08-31' },
      snapshot => snapshot.caseEvidence({ caseId: ids.caseId, partnerSellerId: ids.partnerId,
        departmentId: ids.departmentId }, 'PARTNER'));
    const account = createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database,
      actorId: ids.partnerId, correlationId: `${ids.caseId}-accounting` }));
    const replaceProjection = (internalProjection: Prisma.InputJsonObject) => database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.partnerCaseRevision.update({ where: { caseId_revision: { caseId: ids.caseId, revision: owner.revision } },
        data: { internalProjection } });
    });
    assert.equal((await account.readOwnAccount(ids.partnerId)).ok, true);
    await reportEvidence();

    await replaceProjection({ ...originalProjection, accounting: { ...accounting,
      owner: { ...owner, caseId: `${ids.caseId}-foreign` } } } as Prisma.InputJsonObject);
    const corruptedAccount = await account.readOwnAccount(ids.partnerId);
    assert.equal(corruptedAccount.ok ? null : corruptedAccount.error.code, 'INTEGRITY_CONFLICT');
    await assert.rejects(reportEvidence, /integrity/i);

    await replaceProjection({ ...originalProjection, partner: { ...partner,
      owner: { ...owner, revision: owner.revision + 1 } } } as Prisma.InputJsonObject);
    await assert.rejects(reportEvidence, /integrity/i);

    await replaceProjection(originalProjection as Prisma.InputJsonObject);
    const committed = await database.partnerCaseEvent.findFirstOrThrow({ where: { caseId: ids.caseId,
      type: 'CASE_COMMITTED' }, select: { id: true, evidence: true } });
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.partnerCaseEvent.update({ where: { id: committed.id }, data: {
        evidence: { ...(committed.evidence as Prisma.JsonObject), publicEvent: { schemaVersion: 1, type: 'CASE_COMMITTED' } },
      } });
    });
    await assert.rejects(reportEvidence, /integrity/i);
    await database.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET LOCAL session_replication_role = 'replica'");
      await tx.partnerCaseEvent.update({ where: { id: committed.id }, data: { evidence: {} } });
    });
    await assert.rejects(reportEvidence, /integrity/i, 'a public event cannot disappear by removing its projection');
  } finally {
    await database.$disconnect();
    await temporary.cleanup();
  }
});

test('concurrent SIGNED and PRINTED writers on independent clients create one commitment', async () => {
  const sourceDatabaseUrl = databaseUrl();
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd()),
    sourceDatabaseUrl });
  const setup = temporary.client(), first = temporary.client(), second = temporary.client();
  const ids = idsFor(`partner-lifecycle-race-${temporary.runId}`);
  try {
    const owner = await setup.$transaction(tx => seedCase(tx, ids));
    const serviceFor = (database: PrismaClient, caseIds = ids) => {
      const { transaction: _transaction, ...composition } = dependencies({} as Prisma.TransactionClient, caseIds);
      return createPrismaPartnerCaseLifecycleService({ ...composition, database });
    };
    const setupService = serviceFor(setup);
    await setupService.markAwaitingCustomerConfirmation({ expected: owner, commandId: `${ids.caseId}-send`,
      correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
    await setupService.markCustomerApproved({ expected: owner, commandId: `${ids.caseId}-approve`,
      correlationId: `${ids.caseId}-approve`, snapshotId: `${ids.caseId}-snapshot`, verifiedAt: '2026-08-30T07:30:00.000Z' });
    const results = await Promise.all([
      serviceFor(first).execute(await commitCommand(ids, owner, 'SIGNED')),
      serviceFor(second).execute(await commitCommand(ids, owner, 'PRINTED')),
    ]);
    assert.equal(results.every(result => result.ok), true);
    assert.equal(await setup.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } }), 1);
    assert.equal(await setup.partnerCaseEvent.count({ where: { caseId: ids.caseId,
      type: { in: ['CASE_SIGNED', 'CASE_PRINTED'] } } }), 2);
    const root = await setup.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { customerContract: true } });
    assert.equal(root.state, 'COMMITTED'); assert.equal(root.customerContract.status, 'PRINTED');

    const pauseIds = idsFor(`partner-lifecycle-pause-race-${temporary.runId}`);
    const pauseOwner = await setup.$transaction(tx => seedCase(tx, pauseIds));
    const pauseSetup = serviceFor(setup, pauseIds);
    await pauseSetup.markAwaitingCustomerConfirmation({ expected: pauseOwner, commandId: `${pauseIds.caseId}-send`,
      correlationId: `${pauseIds.caseId}-send`, snapshotId: `${pauseIds.caseId}-snapshot` });
    await pauseSetup.markCustomerApproved({ expected: pauseOwner, commandId: `${pauseIds.caseId}-approve`,
      correlationId: `${pauseIds.caseId}-approve`, snapshotId: `${pauseIds.caseId}-snapshot`,
      verifiedAt: '2026-08-30T07:30:00.000Z' });
    let releaseLock!: () => void;
    const controlLocked = new Promise<void>(resolve => { releaseLock = resolve; });
    const pauseWinner = second.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM partner_operations_controls WHERE id = 'partner-operations' FOR UPDATE`;
      await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: { operationalPaused: true } });
      releaseLock();
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    await controlLocked;
    const pauseCommitPromise = serviceFor(first, pauseIds).execute(await commitCommand(pauseIds, pauseOwner, 'SIGNED'));
    const [pauseCommit] = await Promise.all([pauseCommitPromise, pauseWinner]);
    assert.equal(!pauseCommit.ok && pauseCommit.error.code, 'OPERATIONAL_PAUSE');
    const pauseRoot = await setup.partnerSaleCase.findUniqueOrThrow({ where: { id: pauseIds.caseId },
      include: { customerContract: true } });
    assert.equal(pauseRoot.state, 'CUSTOMER_APPROVED');
    assert.equal(pauseRoot.customerContract.status, 'APPROVED');

    const competingIds = idsFor(`partner-lifecycle-cancel-race-${temporary.runId}`);
    const competingOwner = await setup.$transaction(tx => seedCase(tx, competingIds));
    const competingSetup = createPartnerCaseLifecycleService({
      ...dependencies({} as Prisma.TransactionClient, competingIds), transaction: work => setup.$transaction(work),
    });
    await competingSetup.markAwaitingCustomerConfirmation({ expected: competingOwner,
      commandId: `${competingIds.caseId}-send`, correlationId: `${competingIds.caseId}-send`,
      snapshotId: `${competingIds.caseId}-snapshot` });
    await competingSetup.markCustomerApproved({ expected: competingOwner, commandId: `${competingIds.caseId}-approve`,
      correlationId: `${competingIds.caseId}-approve`, snapshotId: `${competingIds.caseId}-snapshot`,
      verifiedAt: '2026-08-30T07:30:00.000Z' });
    const competing = await Promise.all([
      createPartnerCaseLifecycleService({ ...dependencies({} as Prisma.TransactionClient, competingIds),
        transaction: work => first.$transaction(work) }).execute(await commitCommand(competingIds, competingOwner, 'SIGNED')),
      createPartnerCaseLifecycleService({ ...dependencies({} as Prisma.TransactionClient, competingIds),
        transaction: work => second.$transaction(work) }).execute(await cancelCommand(competingIds, competingOwner, 'CUSTOMER_APPROVED')),
    ]);
    assert.equal(competing.filter(result => result.ok).length, 1);
    assert.equal(competing.filter(result => !result.ok && result.error.code === 'STATE_CONFLICT').length, 1);
    const competingRoot = await setup.partnerSaleCase.findUniqueOrThrow({ where: { id: competingIds.caseId } });
    assert.equal(['COMMITTED', 'CANCELLED'].includes(competingRoot.state), true);
  } finally {
    await Promise.all([setup.$disconnect(), first.$disconnect(), second.$disconnect()]);
    await temporary.cleanup();
  }
});
