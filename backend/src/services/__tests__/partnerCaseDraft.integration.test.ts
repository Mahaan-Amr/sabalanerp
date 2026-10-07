import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient, Prisma } from '@prisma/client';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { canonicalHash, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPartnerCaseService, createPrismaPartnerCaseService, type PartnerCaseDependencies } from '../partnerSales/cases/aggregate';
import { projectCustomerVisibleRevisionContent } from '../partnerSales/customerOutput/customerVisible';
import { createPartnerCaseLifecycleService } from '../partnerSales/cases/lifecycle';
import { buildRevisionEvidence, validateResolvedDraft, type ResolvedCaseDraft } from '../partnerSales/cases/revisions';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';
import { consumePrismaPartnerTechnicalRecovery, requireCompleteCustomerParty } from '../partnerSales/cases/prismaComposition';
import { createPartnerInquiryService } from '../partnerSales/inquiries/service';
import { allocatePartnerLinkedPair } from '../../routes/partner-cases';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10'); return url.toString();
}

const graphFor = (productRowId: string) => parseCanonicalProductGraph({ schemaVersion: 1, revision: 1,
  calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
  catalogSnapshots: [{ catalogProductId: 'catalog-case-stone', snapshotVersion: 'catalog-v1', facts: {} }],
  rows: [{ productRowId, catalogProductId: 'catalog-case-stone',
    catalogSnapshotVersion: 'catalog-v1', productType: 'prepared', contractualTitle: 'سنگ آماده پرونده',
    commercial: { requestedQuantity: '2', totalAmountToman: '200',
      calculationSnapshot: { kind: 'readyPiece', unit: 'count', quantity: '2' } } }], stairSystems: [], layerConfigurations: [],
  sourceBatches: [], remainingStones: [], allocations: [], operationGroups: [], toolSelections: [], finishingSelections: [] });
const configurationHash = `sha256-v1:${'1'.repeat(64)}`;
const approvalEvidenceHash = `sha256-v1:${'2'.repeat(64)}`;

test('customer-visible comparison ignores revision-owned identifiers but retains commercial content', () => {
  const original = createPartnerFixtures().customer;
  const revised = { ...original, revision: original.revision + 1,
    outputHash: `sha256-v1:${'f'.repeat(64)}`, status: 'DRAFT' as const, confirmation: 'INVALIDATED' as const,
    products: original.products.map(product => ({ ...product, productRowId: `${product.productRowId}-next` })),
    customerPaymentPlan: { ...original.customerPaymentPlan, planId: `${original.customerPaymentPlan.planId}-next`,
      version: original.customerPaymentPlan.version + 1, predecessorPlanId: original.customerPaymentPlan.planId,
      installments: original.customerPaymentPlan.installments.map(item => ({ ...item,
        installmentId: `${item.installmentId}-next` })) },
    deliveries: original.deliveries.map(delivery => ({ ...delivery, deliveryId: `${delivery.deliveryId}-next`,
      items: delivery.items.map(item => ({ ...item, productRowId: `${item.productRowId}-next` })) })),
  };
  assert.deepEqual(projectCustomerVisibleRevisionContent(revised), projectCustomerVisibleRevisionContent(original));
  assert.notDeepEqual(projectCustomerVisibleRevisionContent({ ...revised,
    totals: { ...revised.totals, payable: '999' } }), projectCustomerVisibleRevisionContent(original));
});

test('numbered Case requires a customer name and SMS recipient but preserves optional CRM address', () => {
  assert.deepEqual(requireCompleteCustomerParty({ displayName: 'مشتری', phone: '09121234567' }), {
    ok: true, value: { displayName: 'مشتری', phone: '09121234567' },
  });
  assert.equal(requireCompleteCustomerParty({ displayName: ' ', phone: '09121234567' }).ok, false);
  assert.equal(requireCompleteCustomerParty({ displayName: 'مشتری', address: 'تهران' }).ok, false);
  assert.deepEqual(requireCompleteCustomerParty({ displayName: ' مشتری ', phone: '09121234567', address: 'تهران' }), {
    ok: true, value: { displayName: 'مشتری', phone: '09121234567', address: 'تهران' },
  });
});

test('revision commercial evidence preserves significant fractional digits beyond ambient Decimal precision', async () => {
  const ids = { caseId: 'exact-case', partnerId: 'exact-partner', customerId: 'exact-customer', profileId: 'exact-profile',
    accountId: 'exact-account', departmentId: 'exact-department', inquiryId: 'exact-inquiry', inquiryRowId: 'exact-inquiry-row' };
  const input = await command(ids), source = await resolved(ids, ids.caseId);
  input.intent.rows[0].retailUnitPrice.amount = '90071992547409931234.01';
  input.intent.customerPaymentPlan.installments[0].amount.amount = '180143985094819862468';
  const approval = { ...createPartnerFixtures().approval, wholesaleUnitPrice: { amount: '100', currency: 'IRT' as const } };
  const result = buildRevisionEvidence({ command: input, resolved: source, graph: source.graph,
    graphHash: input.intent.graphHash, rows: [{ ...source.rows[0], approval, retailUnitPrice: input.intent.rows[0].retailUnitPrice }] });
  assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) {
    assert.equal(result.value.retailEnvelope.totals.net, '180143985094819862468.02');
    assert.equal(result.value.retailEnvelope.totals.payable, '180143985094819862468');
    assert.equal(result.value.retailEnvelope.totals.monetaryRounding?.sourceAmount, '180143985094819862468.02');
    assert.equal(result.value.resaleDifference, '180143985094819862268');
  }
});

test('family-aware technical measures bind longitudinal quantity instead of the raw piece count', async () => {
  const ids = { caseId: 'measure-case', partnerId: 'measure-partner', customerId: 'measure-customer',
    profileId: 'measure-profile', accountId: 'measure-account', departmentId: 'measure-department',
    inquiryId: 'measure-inquiry', inquiryRowId: 'measure-inquiry-row' };
  const submitted = await command(ids);
  const productRowId = `${ids.caseId}-product-row`;
  const graph = parseCanonicalProductGraph({ schemaVersion: 1, revision: 1,
    calculationPolicy: { calculation: 'calculation-v1', packing: 'packing-v1', pricing: 'pricing-v1', rounding: 'rounding-v1' },
    catalogSnapshots: [{ catalogProductId: 'catalog-case-stone', snapshotVersion: 'catalog-v1', facts: {} }],
    rows: [{ productRowId, catalogProductId: 'catalog-case-stone', catalogSnapshotVersion: 'catalog-v1',
      productType: 'longitudinal', contractualTitle: 'سنگ طولی پرونده', commercial: {
        requestedLengthMeters: '1.5', requestedQuantity: '2', requestedAreaSquareMeters: '1.2',
        calculationSnapshot: { quantityMode: 'piece-count' }, totalAmountToman: '200',
      } }], stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [],
    operationGroups: [], toolSelections: [], finishingSelections: [] });
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  const intent = { ...submitted.intent, graphHash };
  const input = { ...submitted, intent };
  const base = await resolved(ids, ids.caseId);
  const exact: ResolvedCaseDraft = { ...base, graph,
    technicalSnapshot: { ...base.technicalSnapshot, graphHash, rows: [{
      ...base.technicalSnapshot.rows[0], quantity: '3', unit: 'meter',
    }] },
    rows: [{ ...base.rows[0], quantity: '3', unit: 'meter' }],
  };
  assert.equal((await validateResolvedDraft(input, exact)).ok, true);
  const rawPieceCount = { ...exact, technicalSnapshot: { ...exact.technicalSnapshot,
    rows: [{ ...exact.technicalSnapshot.rows[0], quantity: '2' }] },
    rows: [{ ...exact.rows[0], quantity: '2' }] };
  const mismatch = await validateResolvedDraft(input, rawPieceCount);
  assert.equal(mismatch.ok ? null : mismatch.error.code, 'CONFIG_MISMATCH');
});

async function fixture(run: (tx: Prisma.TransactionClient, ids: Record<string, string>) => Promise<void>,
  approvalTtlMs = 48 * 60 * 60 * 1000, pricingDefinition = false) {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback partner Case fixture');
  try {
    await database.$transaction(async tx => {
      const prefix = `partner-case-${randomUUID()}`;
      const ids = { managerId: `${prefix}-manager`, partnerId: `${prefix}-partner`, responderId: `${prefix}-responder`, departmentId: `${prefix}-department`,
        customerId: `${prefix}-customer`, secondCustomerId: `${prefix}-customer-2`,
        firstProjectId: `${prefix}-project-1`, secondProjectId: `${prefix}-project-2`,
        profileId: `${prefix}-profile`, accountId: `${prefix}-account`,
        inquiryId: `${prefix}-inquiry`, inquiryRowId: `${prefix}-inquiry-row`, assignmentId: `${prefix}-assignment`,
        approvalId: `${prefix}-approval`, caseId: `${prefix}-case` };
      await tx.user.createMany({ data: [
        { id: ids.managerId, username: ids.managerId, email: `${ids.managerId}@example.invalid`, password: 'not-a-login', firstName: 'Manager', lastName: 'Case', role: 'ADMIN' },
        { id: ids.partnerId, username: ids.partnerId, email: `${ids.partnerId}@example.invalid`, password: 'not-a-login',
          firstName: 'Partner', lastName: 'Case' },
        { id: ids.responderId, username: ids.responderId, email: `${ids.responderId}@example.invalid`, password: 'not-a-login',
          firstName: 'Responder', lastName: 'Case', role: 'ADMIN' },
      ] });
      await tx.department.create({ data: { id: ids.departmentId, name: ids.departmentId, namePersian: 'فروش تستی' } });
      await tx.user.update({ where: { id: ids.partnerId }, data: { departmentId: ids.departmentId } });
      await tx.partnerProfile.create({ data: { id: ids.profileId, userId: ids.partnerId, state: 'ACTIVE' } });
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${ids.profileId}, true)`;
      await tx.partnerCommercialAccount.create({ data: { id: ids.accountId, profileId: ids.profileId } });
      await tx.partnerReleaseCohort.create({ data: { id: ids.profileId, name: ids.profileId,
        activationEnabled: true, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerOperationsControl.update({ where: { id: 'partner-operations' }, data: {
        cohortId: ids.profileId, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerCohortMembership.create({ data: { id: ids.profileId, profileId: ids.profileId,
        cohortId: ids.profileId, actorId: ids.responderId, eligibilityEvidence: { fixture: true } } });
      await tx.crmCustomer.create({ data: { id: ids.customerId, firstName: 'Customer', lastName: 'Case',
        ownerUserId: ids.partnerId, createdBy: ids.partnerId, partnerOwnerProfileId: ids.profileId, partnerRevision: 1 } });
      await tx.crmCustomer.create({ data: { id: ids.secondCustomerId, firstName: 'Customer', lastName: 'Revised',
        ownerUserId: ids.partnerId, createdBy: ids.partnerId, partnerOwnerProfileId: ids.profileId, partnerRevision: 1 } });
      await tx.crmPotentialProject.createMany({ data: [
        { id: ids.firstProjectId, customerId: ids.customerId, responsibleSellerId: ids.partnerId,
          createdBy: ids.partnerId, title: 'پروژه نخست', address: 'تهران، پروژه نخست',
          workType: 'سنگ', partnerRevision: 1 },
        { id: ids.secondProjectId, customerId: ids.secondCustomerId, responsibleSellerId: ids.partnerId,
          createdBy: ids.partnerId, title: 'پروژه دوم', address: 'تهران، پروژه دوم',
          workType: 'سنگ', partnerRevision: 1 },
      ] });
      await tx.partnerInquiry.create({ data: { id: ids.inquiryId, profileId: ids.profileId, revision: 2, submittedAt: new Date() } });
      await tx.partnerInquiryAssignment.create({ data: { id: ids.assignmentId, inquiryId: ids.inquiryId, revision: 1,
        responderId: ids.responderId, actorId: ids.responderId, reason: 'انتساب تست پرونده', eligibilityEvidence: { fixture: true } } });
      await tx.partnerInquiryRow.create({ data: { id: ids.inquiryRowId, inquiryId: ids.inquiryId, version: 1,
        revision: 2, outcome: 'APPROVED', configurationHash, definition: pricingDefinition ? {
      version: 1, configurationRef: { recoveryId: `${ids.caseId}-recovery`, recoveryRevision: 1,
        productRowId: `${ids.caseId}-product-row` }, identity: {
        schemaVersion: 1, partnerSellerId: ids.partnerId, catalogProductId: 'catalog-stone', family: 'prepared', unit: 'count',
        configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
        materialRateEvidenceId: 'fixture-rate', materialRateHash: configurationHash, components: [], currency: 'IRT',
        calculationPolicyVersion: 'fixture-v1', roundingPolicyVersion: 'fixture-v1',
      }, description: 'سنگ آماده', configuration: [{ label: 'تعداد', value: '۲' }],
    } : { fixture: true } } });
      const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      await tx.partnerInquiryApproval.create({ data: { id: ids.approvalId, rowId: ids.inquiryRowId,
        assignmentId: ids.assignmentId, actorId: ids.responderId, commandId: `${prefix}-approval-command`,
        authorizationEvidenceId: `${prefix}-approval-authorization`, wholesaleUnitPrice: '100', currency: 'IRT',
        evidenceHash: approvalEvidenceHash, approvedAt: clock.now, expiresAt: new Date(clock.now.getTime() + approvalTtlMs) } });
      await run(tx, ids); throw rollback;
    }, { timeout: 30_000 });
  } catch (error) { if (error !== rollback) throw error; }
  finally { await database.$disconnect(); }
}

async function command(ids: Record<string, string>, caseId = ids.caseId, suffix = 'first'): Promise<Extract<PartnerCommand, { type: 'CASE_SUBMIT' }>> {
  const productRowId = `${caseId}-product-row`, graph = graphFor(productRowId);
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  const intent = { customerId: ids.customerId, recoveryId: `${caseId}-recovery`, recoveryRevision: 1, graphHash,
    sabalanTermsVersionId: 'terms-v1', contractDate: '2026-08-29', rows: [{ productRowId,
      retailUnitPrice: { amount: '150', currency: 'IRT' as const } }],
    customerPaymentPlan: { planId: `${caseId}-retail-plan`, version: 1, effectiveDate: '2026-08-29', installments: [{
      installmentId: `${caseId}-retail-installment`, dueDate: '2026-08-30', amount: { amount: '300', currency: 'IRT' as const }, method: 'CASH' as const }] },
    retailDiscount: { amount: '0', currency: 'IRT' as const }, belowCostConfirmed: false,
    deliveries: [{ deliveryId: `${caseId}-delivery`, date: '2026-08-31', destination: 'تهران، مقصد تست',
      items: [{ productRowId, quantity: '2' }] }] };
  return { schemaVersion: 1, type: 'CASE_SUBMIT', commandId: `${caseId}-command-${suffix}`,
    correlationId: `${caseId}-correlation-${suffix}`, intent, idempotency: { actorId: ids.partnerId,
      operation: 'CASE_SUBMIT', targetId: caseId, key: `${caseId}-key`, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
}

async function resolved(ids: Record<string, string>, caseId: string, revision = 1,
  customerId = ids.customerId, projectId?: string): Promise<ResolvedCaseDraft> {
  const productRowId = `${caseId}-product-row`;
  const graph = graphFor(productRowId);
  const graphHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph });
  return { profileId: ids.profileId, partnerSellerId: ids.partnerId, customerId, ...(projectId ? { projectId } : {}),
    commercialAccountId: ids.accountId, departmentId: ids.departmentId, sabalanTermsVersionId: 'terms-v1', graph,
    technicalSnapshot: { schemaVersion: 1, recoveryId: `${caseId}-recovery`, recoveryRevision: revision,
      inputRevision: revision, graphHash, updatedAt: '2026-08-29T00:00:00.000Z', rows: [{
        configurationRef: { recoveryId: `${caseId}-recovery`, recoveryRevision: revision, productRowId },
        quantity: '2', unit: 'count', configurationChange: revision === 1 ? 'NEW' : 'UNCHANGED',
      }] },
    rows: [{ productRowId, configurationHash, quantity: '2', unit: 'count',
      precisionPolicyVersion: 'canonical-count-v1', description: 'سنگ آماده پرونده', retailUnitPriceAmount: '150',
      wholesaleUnitPriceAmount: '100' }],
    partner: { displayName: 'فروشنده همکار تست', phone: '09120000000', address: 'تهران، فروشنده تست' },
    customer: { displayName: customerId === ids.customerId ? 'مشتری تست' : 'مشتری بازنگری',
      phone: '09120000001', address: 'تهران، مشتری تست' },
    legalText: 'متن حقوقی قرارداد تست', sabalanPaymentPlan: { planId: `${caseId}-sabalan-plan-${revision}`, version: revision,
      ...(revision > 1 ? { predecessorPlanId: `${caseId}-sabalan-plan-${revision - 1}` } : {}),
      effectiveDate: '2026-08-29', installments: [{ installmentId: `${caseId}-sabalan-installment-${revision}`, dueDate: '2026-08-30',
        amount: { amount: '200', currency: 'IRT' }, method: 'BANK_TRANSFER' }] } };
}

function service(tx: Prisma.TransactionClient, ids: Record<string, string>, failpoint?: PartnerCaseDependencies['failpoint'],
  recordEvidenceReview: PartnerCaseDependencies['recordEvidenceReview'] = async () => undefined,
  authorizeProject: PartnerCaseDependencies['authorizeProject'] = async () =>
    ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } }),
  transformResolved: (draft: ResolvedCaseDraft) => ResolvedCaseDraft = draft => draft) {
  return createPartnerCaseService({ actorId: ids.partnerId, transaction: async work => {
    await tx.$executeRaw`SAVEPOINT partner_case_service`;
    try {
      const result = await work(tx);
      await tx.$executeRaw`RELEASE SAVEPOINT partner_case_service`;
      return result;
    } catch (error) {
      await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_case_service`;
      await tx.$executeRaw`RELEASE SAVEPOINT partner_case_service`;
      throw error;
    }
  },
    authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }),
    authorizeProject,
    recordEvidenceReview,
    resolveDraft: async (_tx, input) => ({ ok: true, value: transformResolved(await resolved(ids, input.command.idempotency.targetId,
      input.command.type === 'CASE_DRAFT_REVISE' ? input.command.expected.revision + 1 : 1,
      input.command.intent.customerId, input.command.intent.projectId)) }),
    consumeRecovery: async () => ({ ok: true, value: undefined }), failpoint });
}

test('Case-scoped pricing retains one linked numbered note before pricing and commits only after current approvals', async () => {
  await fixture(async (tx, ids) => {
    const priced = await command(ids);
    const pricedIntent = { ...priced.intent, projectId: ids.firstProjectId,
      rows: priced.intent.rows.map(row => ({ ...row,
        approvedRowBinding: { inquiryId: ids.inquiryId, rowId: ids.inquiryRowId, revision: 2 } })) };
    const pricedInput = { ...priced, intent: pricedIntent, idempotency: { ...priced.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: pricedIntent }) } };
    const intent = { ...pricedIntent,
      rows: pricedIntent.rows.map(({ approvedRowBinding: _binding, ...row }) => row) };
    const input = { ...pricedInput, intent, idempotency: { ...pricedInput.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', '', true)`;
    const first = await service(tx, ids).execute(input);
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok || !first.value.case) return;
    assert.equal(first.value.case.pricingState, 'AWAITING_INQUIRY');
    assert.equal(await tx.sabalanToPartnerSaleRecord.count({ where: { caseId: ids.caseId } }), 1);
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 1);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);

    const readyAt = new Date();
    await tx.partnerInquiry.update({ where: { id: ids.inquiryId }, data: { caseId: ids.caseId,
      caseRevision: 1, pricingReadyAt: readyAt,
      pricingExpiresAt: new Date(readyAt.getTime() + 48 * 60 * 60 * 1000) } });
    const revised = await reviseCommand(ids, pricedInput, 1,
      first.value.case.owner.integrityHash, 'case-price');
    const revisedIntent = { ...revised.intent, recoveryRevision: 2 };
    const pricedRevision = await service(tx, ids).execute({ ...revised, intent: revisedIntent,
      idempotency: { ...revised.idempotency, payloadHash: await canonicalHash({ schemaVersion: 1,
        type: 'CASE_DRAFT_REVISE', intent: revisedIntent }) } });
    assert.equal(pricedRevision.ok, true, JSON.stringify(pricedRevision));
    if (!pricedRevision.ok || !pricedRevision.value.case) return;
    assert.equal(pricedRevision.value.case.pricingState, 'READY_TO_FINALIZE');
    assert.equal(await tx.partnerInquiryUsage.count({ where: { caseId: ids.caseId, caseRevision: 2 } }), 1);
    assert.equal(await tx.sabalanToPartnerSaleRecord.count({ where: { caseId: ids.caseId } }), 1);

    await tx.user.update({ where: { id: ids.partnerId }, data: { departmentId: ids.departmentId } });
    await tx.salesContractEditSession.create({ data: { draftId: input.intent.recoveryId,
      ownerUserId: ids.partnerId, browserSessionId: `${ids.caseId}-allocation`, leaseToken: randomUUID(),
      schemaVersion: 2, baseRevision: 0, purpose: 'PARTNER_TECHNICAL', recovery: {
        kind: 'partner-technical-recovery', version: 1, recoveryRevision: revisedIntent.recoveryRevision,
        updatedAt: Date.now(), draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, validatedSnapshots: [],
      } } });
    const allocated = await allocatePartnerLinkedPair(tx, { caseId: ids.caseId, actorId: ids.partnerId,
      expected: pricedRevision.value.case.owner });
    assert.equal(allocated.ok, true, JSON.stringify(allocated));
    assert.equal(await tx.sabalanToPartnerSaleRecord.count({ where: { caseId: ids.caseId } }), 1);
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId, partnerKind: 'PARTNER_CUSTOMER' } }), 1);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);
    const head = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: {
      caseId: ids.caseId, revision: 2 } } });
    assert.equal((head.customerContent as Prisma.JsonObject).projectId, ids.firstProjectId,
      'legacy project identity remains in immutable Case evidence');
    assert.equal(await tx.projectAddress.count({ where: { customerId: ids.customerId,
      address: 'تهران، پروژه نخست' } }), 1);
    assert.ok((head.internalProjection as Prisma.JsonObject).accounting);
    assert.equal((await tx.partnerCaseEvent.findFirstOrThrow({ where: { caseId: ids.caseId,
      type: 'CASE_CREATED' } })).caseRevision, 1);
    assert.notEqual(head.customerProjection, null);
    const finalizeIntent = { trigger: 'FINALIZED' as const,
      authenticatedOutputEvidenceId: `${ids.caseId}-finalization-evidence`, lossAccepted: false };
    const finalized = await createPartnerCaseLifecycleService({ ...{
      actorId: ids.partnerId, cancellationPurpose: 'PARTNER' as const, transaction: async <T>(work: (database: Prisma.TransactionClient) => Promise<T>) => work(tx),
      authorize: async () => ({ ok: true as const, value: { evidenceId: `${ids.caseId}-authorization` } }),
      verifyOutputEvidence: async () => ({ ok: true as const, value: { evidenceId: finalizeIntent.authenticatedOutputEvidenceId,
        occurredAt: new Date().toISOString(), outputHash: configurationHash } }),
      cancelConfirmationSessions: async () => ({ ok: true as const, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
      recordEvidenceReview: async () => undefined,
    } }).execute({ schemaVersion: 1, type: 'CASE_COMMIT', commandId: `${ids.caseId}-finalize`,
      correlationId: `${ids.caseId}-finalize`, expected: pricedRevision.value.case.owner, expectedState: 'DRAFT',
      ...finalizeIntent, idempotency: { actorId: ids.partnerId, operation: 'CASE_COMMIT', targetId: ids.caseId,
        key: `${ids.caseId}-finalize`, payloadHash: await canonicalHash({ schemaVersion: 1,
          type: 'CASE_COMMIT', ...finalizeIntent }) } });
    assert.equal(finalized.ok ? null : finalized.error.code, 'STATE_CONFLICT', 'output evidence cannot bypass current commercial approvals');
    const { approvePartnerCommercialSales, acceptPartnerCustomer, assertPartnerFinancialFinality } = await import('../partnerSales/cases/commercialLifecycle');
    await assert.rejects(() => assertPartnerFinancialFinality(tx, ids.caseId), /قطعی/);
    const commercial = await tx.salesContract.findFirstOrThrow({ where: { partnerCaseId: ids.caseId } });
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: commercial.commercialRevision });
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: commercial.commercialRevision, method: 'DIGITAL' });
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'COMMITTED');
    assert.equal((await tx.salesContract.findFirstOrThrow({ where: { partnerCaseId: ids.caseId } })).status, 'SIGNED');
    await tx.$executeRawUnsafe('SET CONSTRAINTS partner_exact_pair IMMEDIATE');
    await tx.$executeRawUnsafe('SET CONSTRAINTS partner_exact_pair DEFERRED');
  });
});

test('customer-complete save creates one linked numbered unpriced note without operational projections', async () => {
  await fixture(async (tx, ids) => {
    const priced = await command(ids);
    const intent = { ...priced.intent, rows: priced.intent.rows.map(({ approvedRowBinding: _binding, ...row }) => row) };
    const input = { ...priced, intent, idempotency: { ...priced.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const first = await service(tx, ids).execute(input);
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok || !first.value.case) return;
    assert.equal(first.value.case.pricingState, 'AWAITING_INQUIRY');
    assert.equal(first.value.case.customerConfirmationState, 'NOT_SENT');
    assert.equal(first.value.case.products[0].wholesaleUnitPrice, undefined);
    assert.equal(first.value.case.sabalanTotals, undefined);
    const persisted = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      state: true, pricingState: true, customerConfirmationState: true,
      internalRecord: { select: { pricingState: true } },
      head: { select: { pricingState: true, internalProjection: true } },
    } });
    assert.equal(persisted.state, 'DRAFT');
    assert.equal(persisted.pricingState, 'AWAITING_INQUIRY');
    assert.equal(persisted.customerConfirmationState, 'NOT_SENT');
    assert.deepEqual(persisted.internalRecord, { pricingState: 'AWAITING_INQUIRY' });
    assert.equal(persisted.head.pricingState, 'AWAITING_INQUIRY');
    const projection = persisted.head.internalProjection as Record<string, unknown>;
    assert.equal('accounting' in projection, false);
    assert.equal('fulfillment' in projection, false);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);
    assert.equal(await tx.partnerInquiryUsage.count({ where: { caseId: ids.caseId } }), 0);
    const replay = await service(tx, ids).execute(input);
    assert.equal(replay.ok && replay.value.replayed, true);
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 1);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);

    const reason = 'لغو پرونده پیش از تکمیل استعلام';
    const payloadHash = await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', reason });
    const cancelled = await createPartnerCaseLifecycleService({ actorId: ids.partnerId,
      cancellationPurpose: 'PARTNER', transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-cancel-authorization` } }),
      verifyOutputEvidence: async () => ({ ok: false, error: { code: 'STATE_CONFLICT', status: 409,
        message: 'وضعیت پرونده اجازه این اقدام را نمی‌دهد.' } }),
      cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
      recordEvidenceReview: async () => undefined,
    }).execute({ schemaVersion: 1, type: 'CASE_CANCEL', commandId: `${ids.caseId}-cancel-command`,
      correlationId: `${ids.caseId}-cancel-correlation`, expected: first.value.case.owner, expectedState: 'DRAFT', reason,
      idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL', targetId: ids.caseId,
        key: `${ids.caseId}-cancel-key`, payloadHash } });
    assert.equal(cancelled.ok, true, JSON.stringify(cancelled));
    const retained = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      state: true, caseNumber: true, internalRecordId: true, customerContractId: true,
      events: { where: { type: 'CASE_CANCELLED' }, select: { reason: true } },
    } });
    assert.equal(retained.state, 'CANCELLED');
    assert.equal(retained.events[0]?.reason, reason);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);
  });
});

test('concurrent first-save retries create one numbered unpriced Case and one durable outcome', async () => {
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(__dirname, '../../../../'),
    sourceDatabaseUrl: databaseUrl() });
  const setup = temporary.client(), firstClient = temporary.client(), secondClient = temporary.client();
  const prefix = `partner-case-concurrent-${temporary.runId}`;
  const ids = { managerId: `${prefix}-manager`, partnerId: `${prefix}-partner`, departmentId: `${prefix}-department`, customerId: `${prefix}-customer`,
    profileId: `${prefix}-profile`, accountId: `${prefix}-account`, caseId: `${prefix}-case`,
    inquiryId: `${prefix}-unused-inquiry`, inquiryRowId: `${prefix}-unused-row` };
  try {
    await setup.$transaction(async tx => {
      await tx.user.create({ data: { id: ids.partnerId, username: ids.partnerId,
        email: `${ids.partnerId}@example.invalid`, password: 'not-a-login', firstName: 'Partner', lastName: 'Concurrent' } });
      await tx.department.create({ data: { id: ids.departmentId, name: ids.departmentId, namePersian: 'فروش هم‌زمان' } });
      await tx.user.update({ where: { id: ids.partnerId }, data: { departmentId: ids.departmentId } });
      await tx.partnerProfile.create({ data: { id: ids.profileId, userId: ids.partnerId, state: 'ACTIVE' } });
      await tx.partnerCommercialAccount.create({ data: { id: ids.accountId, profileId: ids.profileId } });
      await tx.partnerReleaseCohort.create({ data: { id: ids.profileId, name: ids.profileId,
        activationEnabled: true, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerOperationsControl.create({ data: { id: 'partner-operations', cohortId: ids.profileId,
        enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerCohortMembership.create({ data: { id: ids.profileId, profileId: ids.profileId,
        cohortId: ids.profileId, actorId: ids.partnerId, eligibilityEvidence: { fixture: true } } });
      await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', ${ids.profileId}, true)`;
      await tx.crmCustomer.create({ data: { id: ids.customerId, firstName: 'Customer', lastName: 'Concurrent',
        ownerUserId: ids.partnerId, createdBy: ids.partnerId, partnerOwnerProfileId: ids.profileId, partnerRevision: 1 } });
    });
    const priced = await command(ids);
    const intent = { ...priced.intent, rows: priced.intent.rows.map(({ approvedRowBinding: _binding, ...row }) => row) };
    const input = { ...priced, intent, idempotency: { ...priced.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const createService = (database: PrismaClient) => createPrismaPartnerCaseService({ database, actorId: ids.partnerId,
      authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }),
      authorizeProject: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } }),
      recordEvidenceReview: async () => undefined,
      resolveDraft: async () => ({ ok: true, value: await resolved(ids, ids.caseId) }),
      consumeRecovery: async () => ({ ok: true, value: undefined }),
    });
    const [first, second] = await Promise.all([createService(firstClient).execute(input), createService(secondClient).execute(input)]);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    if (first.ok && second.ok) assert.deepEqual([first.value.replayed, second.value.replayed].sort(), [false, true]);
    assert.equal(await setup.partnerSaleCase.count({ where: { id: ids.caseId } }), 1);
    assert.deepEqual((await setup.partnerCommercialNumber.findMany({ where: { caseId: ids.caseId },
      select: { purpose: true } })).map(number => number.purpose).sort(), ['CASE', 'CUSTOMER', 'INTERNAL']);
    assert.equal(await setup.partnerCommandOutcome.count({ where: { actorId: ids.partnerId,
      operation: 'CASE_SUBMIT', targetScope: ids.caseId } }), 1);

    const recoveryId = `${prefix}-recovery`;
    await setup.salesContractEditSession.create({ data: { draftId: recoveryId, ownerUserId: ids.partnerId,
      browserSessionId: `${prefix}-browser`, leaseToken: randomUUID(), schemaVersion: 2, baseRevision: 0,
      purpose: 'PARTNER_TECHNICAL', recovery: { kind: 'partner-technical-recovery', version: 1,
        recoveryRevision: 1, updatedAt: Date.now(), draft: { schemaVersion: 1, inputRevision: 1, rows: [] },
        validatedSnapshots: [] } } });
    const binding = { actorId: ids.partnerId, recoveryId, recoveryRevision: 1, caseId: ids.caseId };
    const bound = await setup.$transaction(tx => consumePrismaPartnerTechnicalRecovery(tx, binding));
    const reused = await setup.$transaction(tx => consumePrismaPartnerTechnicalRecovery(tx, binding));
    assert.equal(bound.ok, true, JSON.stringify(bound));
    assert.equal(reused.ok, true, JSON.stringify(reused));
    assert.equal((await setup.salesContractEditSession.findUniqueOrThrow({ where: { draftId: recoveryId } })).contractId,
      null, 'initial Case evidence remains bound without allocating a customer contract');
    assert.equal(await setup.partnerCommandOutcome.count({ where: { actorId: ids.partnerId,
      operation: 'PARTNER_SUBMITTED_TECHNICAL_EVIDENCE_V1', targetScope: recoveryId } }), 1);
    const firstEvidence = await setup.partnerCommandOutcome.findUniqueOrThrow({ where: {
      actorId_operation_targetScope_key: { actorId: ids.partnerId,
        operation: 'PARTNER_SUBMITTED_TECHNICAL_EVIDENCE_V1', targetScope: recoveryId, key: 'case-v1' },
    } });
    const session = await setup.salesContractEditSession.findUniqueOrThrow({ where: { draftId: recoveryId } });
    await setup.salesContractEditSession.update({ where: { draftId: recoveryId }, data: { recovery: {
      ...(session.recovery as Record<string, unknown>), recoveryRevision: 2,
      validatedSnapshots: [{ corrected: true }],
    } } });
    const corrected = await setup.$transaction(tx => consumePrismaPartnerTechnicalRecovery(tx,
      { ...binding, recoveryRevision: 2 }));
    assert.equal(corrected.ok, true, JSON.stringify(corrected));
    assert.deepEqual(await setup.partnerCommandOutcome.findUniqueOrThrow({ where: {
      actorId_operation_targetScope_key: { actorId: ids.partnerId,
        operation: 'PARTNER_SUBMITTED_TECHNICAL_EVIDENCE_V1', targetScope: recoveryId, key: 'case-v1' },
    } }), firstEvidence, 'the first submission evidence remains immutable');
    assert.equal(await setup.partnerCommandOutcome.count({ where: { actorId: ids.partnerId,
      operation: 'PARTNER_SUBMITTED_TECHNICAL_EVIDENCE_V1', targetScope: recoveryId } }), 2);
    const correctedSession = await setup.salesContractEditSession.findUniqueOrThrow({ where: { draftId: recoveryId } });
    await setup.salesContractEditSession.update({ where: { draftId: recoveryId }, data: { recovery: {
      ...(correctedSession.recovery as Record<string, unknown>), validatedSnapshots: [{ corrected: 'altered' }],
    } } });
    const altered = await setup.$transaction(tx => consumePrismaPartnerTechnicalRecovery(tx,
      { ...binding, recoveryRevision: 2 }));
    assert.equal(altered.ok, false);
    if (!altered.ok) assert.equal(altered.error.code, 'INTEGRITY_CONFLICT');
  } finally {
    await Promise.all([setup.$disconnect(), firstClient.$disconnect(), secondClient.$disconnect()]);
    await temporary.cleanup();
  }
});

async function reviseCommand(ids: Record<string, string>, submitted: Extract<PartnerCommand, { type: 'CASE_SUBMIT' }>,
  revision: number, integrityHash: string, suffix = 'revise',
  expectedState: Extract<PartnerCommand, { type: 'CASE_DRAFT_REVISE' }>['expectedState'] = 'DRAFT'):
Promise<Extract<PartnerCommand, { type: 'CASE_DRAFT_REVISE' }>> {
  const caseId = submitted.idempotency.targetId;
  const productRowId = `${caseId}-product-row`;
  const intent = { ...submitted.intent, recoveryRevision: revision + 1,
    rows: [{ ...submitted.intent.rows[0], retailUnitPrice: { amount: '150', currency: 'IRT' as const } }],
    customerPaymentPlan: { planId: `${caseId}-retail-plan-${revision + 1}`, version: revision + 1,
      predecessorPlanId: submitted.intent.customerPaymentPlan.planId, effectiveDate: '2026-08-29', installments: [{
        installmentId: `${caseId}-retail-installment-${revision + 1}`, dueDate: '2026-08-30',
        amount: { amount: '300', currency: 'IRT' as const }, method: 'CASH' as const }] },
    deliveries: [{ deliveryId: `${caseId}-delivery-${revision + 1}`, date: '2026-09-01', destination: 'تهران، مقصد بازنگری',
      items: [{ productRowId, quantity: '2' }] }],
  };
  return { schemaVersion: 1, type: 'CASE_DRAFT_REVISE', commandId: `${caseId}-command-${suffix}`,
    correlationId: `${caseId}-correlation-${suffix}`, expected: { caseId, revision, integrityHash }, expectedState,
    editLease: { recoveryId: intent.recoveryId, browserSessionId: `${caseId}-browser`,
      leaseToken: `${caseId}-lease`, baseRevision: 0 },
    intent, idempotency: { actorId: ids.partnerId, operation: 'CASE_DRAFT_REVISE', targetId: caseId,
      key: `${caseId}-key-${suffix}`, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } };
}

async function bindInquiryToCase(tx: Prisma.TransactionClient, ids: Record<string, string>, caseId = ids.caseId,
  caseRevision = 1, ttlMs = 48 * 60 * 60 * 1000) {
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  const readyAt = new Date(clock.now.getTime() - 48 * 60 * 60 * 1000 + ttlMs);
  await tx.partnerInquiry.update({ where: { id: ids.inquiryId }, data: { caseId, caseRevision,
    pricingReadyAt: readyAt, pricingExpiresAt: new Date(readyAt.getTime() + 48 * 60 * 60 * 1000) } });
}

async function withApprovedBinding(ids: Record<string, string>, draft: Extract<PartnerCommand, { type: 'CASE_DRAFT_REVISE' }>,
  binding = { inquiryId: ids.inquiryId, rowId: ids.inquiryRowId, revision: 2 }) {
  const intent = { ...draft.intent, rows: draft.intent.rows.map(row => ({ ...row,
    approvedRowBinding: binding })) };
  return { ...draft, intent, idempotency: { ...draft.idempotency,
    payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } };
}

async function allocateFixturePair(tx: Prisma.TransactionClient, ids: Record<string, string>,
  submitted: Pick<Extract<PartnerCommand, { type: 'CASE_SUBMIT' | 'CASE_DRAFT_REVISE' }>, 'intent'>,
  expected: Parameters<typeof allocatePartnerLinkedPair>[1]['expected'], caseId = ids.caseId) {
  await tx.user.update({ where: { id: ids.partnerId }, data: { departmentId: ids.departmentId } });
  await tx.salesContractEditSession.create({ data: { draftId: submitted.intent.recoveryId,
    ownerUserId: ids.partnerId, browserSessionId: `${caseId}-allocation`, leaseToken: randomUUID(),
    schemaVersion: 2, baseRevision: 0, purpose: 'PARTNER_TECHNICAL', recovery: {
      kind: 'partner-technical-recovery', version: 1, recoveryRevision: expected.revision,
      updatedAt: Date.now(), draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, validatedSnapshots: [],
    } } });
  const allocated = await allocatePartnerLinkedPair(tx, { caseId, actorId: ids.partnerId, expected });
  assert.equal(allocated.ok, true, JSON.stringify(allocated));
}

async function createApprovedInquiryForCase(tx: Prisma.TransactionClient, ids: Record<string, string>, caseId: string, wholesaleUnitPrice = '100') {
  const suffix = randomUUID();
  const inquiryId = `partner-inquiry-${suffix}`, rowId = `partner-inquiry-row-${suffix}`;
  const assignmentId = `partner-inquiry-assignment-${suffix}`;
  const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
  await tx.partnerInquiry.create({ data: { id: inquiryId, profileId: ids.profileId, caseId, caseRevision: 1,
    revision: 2, submittedAt: clock.now, pricingReadyAt: clock.now,
    pricingExpiresAt: new Date(clock.now.getTime() + 48 * 60 * 60 * 1000) } });
  await tx.partnerInquiryAssignment.create({ data: { id: assignmentId, inquiryId, revision: 1,
    responderId: ids.responderId, actorId: ids.responderId, reason: 'استعلام تست پرونده',
    eligibilityEvidence: { fixture: true } } });
  await tx.partnerInquiryRow.create({ data: { id: rowId, inquiryId, version: 1,
    revision: 2, outcome: 'APPROVED', configurationHash, definition: { fixture: true } } });
  await tx.partnerInquiryApproval.create({ data: { id: `partner-inquiry-approval-${suffix}`, rowId,
    assignmentId, actorId: ids.responderId, commandId: `partner-inquiry-command-${suffix}`,
    authorizationEvidenceId: `partner-inquiry-evidence-${suffix}`, wholesaleUnitPrice, currency: 'IRT',
    evidenceHash: approvalEvidenceHash, approvedAt: clock.now,
    expiresAt: new Date(clock.now.getTime() + 48 * 60 * 60 * 1000) } });
  return { inquiryId, rowId, revision: 2 };
}

test('asynchronous preparation finishes before the original inquiry is answered while retaining the same numbered note', async () => {
  await fixture(async (tx, ids) => {
    const base = await command(ids);
    const intent = { ...base.intent, preparationCompleted: false };
    const submitted = { ...base, intent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const first = await service(tx, ids).execute(submitted);
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok || !first.value.case) return;
    const revision = await reviseCommand(ids, submitted, 1, first.value.case.owner.integrityHash, 'prepared');
    const completedIntent = { ...revision.intent, preparationCompleted: true };
    const completed = await service(tx, ids).execute({ ...revision, intent: completedIntent,
      idempotency: { ...revision.idempotency, payloadHash: await canonicalHash({ schemaVersion: 1,
        type: 'CASE_DRAFT_REVISE', intent: completedIntent }) } });
    assert.equal(completed.ok, true, JSON.stringify(completed));
    if (!completed.ok || !completed.value.case) return;
    assert.equal(completed.value.case.preparationCompleted, true);
    assert.equal(completed.value.case.pricingState, 'AWAITING_INQUIRY');
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 1);
    assert.equal(await tx.sabalanToPartnerSaleRecord.count({ where: { caseId: ids.caseId } }), 1);
    await bindInquiryToCase(tx, ids, ids.caseId, 1);
    const acceptance = await withApprovedBinding(ids, await reviseCommand(ids,
      { ...submitted, intent: completedIntent }, 2, completed.value.case.owner.integrityHash, 'accept-late-price'));
    const accepted = await service(tx, ids).execute(acceptance);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    if (!accepted.ok || !accepted.value.case) return;
    assert.equal(accepted.value.case.pricingState, 'READY_TO_FINALIZE');
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 1);
    await allocateFixturePair(tx, ids, { ...submitted, intent: acceptance.intent }, accepted.value.case.owner);
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 1);
  });
});

test('accepting a price with unfinished payments cannot allocate a commercial contract', async () => {
  await fixture(async (tx, ids) => {
    const base = await command(ids);
    const intent = { ...base.intent, preparationCompleted: false,
      customerPaymentPlan: { ...base.intent.customerPaymentPlan, installments: [] } };
    const submitted = { ...base, intent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const first = await service(tx, ids).execute(submitted);
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok || !first.value.case) return;
    await bindInquiryToCase(tx, ids);
    const priced = await withApprovedBinding(ids, await reviseCommand(ids, submitted, 1,
      first.value.case.owner.integrityHash, 'early-accept'));
    const accepted = await service(tx, ids).execute(priced);
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    if (!accepted.ok || !accepted.value.case) return;
    assert.equal(accepted.value.case.preparationCompleted, false);
    const allocation = await allocatePartnerLinkedPair(tx, { caseId: ids.caseId,
      actorId: ids.partnerId, expected: accepted.value.case.owner });
    assert.equal(allocation.ok ? null : allocation.error.code, 'STATE_CONFLICT');
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 0);
    assert.equal(await tx.sabalanToPartnerSaleRecord.count({ where: { caseId: ids.caseId } }), 0);
  });
});

test('a customer-visible revision invalidates the sent version and requires confirmation again', async () => {
  await fixture(async (tx, ids) => {
    const base = await command(ids);
    const intent = { ...base.intent, projectId: ids.firstProjectId };
    const submitted = { ...base, intent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    await bindInquiryToCase(tx, ids);
    const pricedCommand = await withApprovedBinding(ids, await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'priced-before-confirmation'));
    const priced = await service(tx, ids).execute(pricedCommand);
    assert.equal(priced.ok, true, JSON.stringify(priced));
    if (!priced.ok || !priced.value.case) return;
    await allocateFixturePair(tx, ids, pricedCommand, priced.value.case.owner);
    const lifecycle = createPartnerCaseLifecycleService({ actorId: ids.partnerId, cancellationPurpose: 'PARTNER',
      transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }),
      verifyOutputEvidence: async () => ({ ok: false as const, error: { code: 'STATE_CONFLICT' as const, status: 409 as const,
        message: 'وضعیت پرونده اجازه این اقدام را نمی‌دهد.' } }),
      cancelConfirmationSessions: async () => ({ ok: true, value: {
        invalidatedSessionIds: [], preservedSnapshotIds: [],
      } }), recordEvidenceReview: async () => undefined });
    const sent = await lifecycle.markAwaitingCustomerConfirmation({ expected: priced.value.case.owner,
      commandId: `${ids.caseId}-send`, correlationId: `${ids.caseId}-send`, snapshotId: `${ids.caseId}-snapshot` });
    assert.equal(sent.ok && sent.value.case.customerConfirmationState, 'SENT');

    const visibleDraft = await reviseCommand(ids, { ...submitted, intent: pricedCommand.intent }, 2,
      priced.value.case.owner.integrityHash, 'customer-visible', 'AWAITING_CUSTOMER_CONFIRMATION');
    visibleDraft.intent.deliveries[0].date = '2026-09-02';
    const revised = await service(tx, ids).execute(await withApprovedBinding(ids, visibleDraft));
    assert.equal(revised.ok, true, JSON.stringify(revised));
    if (!revised.ok || !revised.value.case) return;
    assert.equal(revised.value.case.state, 'AWAITING_CUSTOMER_CONFIRMATION');
    assert.equal(revised.value.case.customerConfirmationState, 'RECONFIRMATION_REQUIRED');
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      state: true, customerConfirmationState: true, customerContract: { select: { status: true } },
    } });
    assert.deepEqual(root, { state: 'AWAITING_CUSTOMER_CONFIRMATION', customerConfirmationState: 'RECONFIRMATION_REQUIRED',
      customerContract: { status: 'DRAFT' } });
  });
});

test('draft revision advances the atomic pair once and rejects a stale competing writer', async () => {
  await fixture(async (tx, ids) => {
    const submitted = await command(ids);
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    const revision = await reviseCommand(ids, submitted, 1, created.value.case.owner.integrityHash);
    const revised = await service(tx, ids).execute(revision);
    assert.equal(revised.ok, true);
    if (!revised.ok || !revised.value.case) return;
    assert.equal(revised.value.case.owner.revision, 2);
    assert.equal(revised.value.case.products[0].retailUnitPrice, '150');
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      headRevision: true, integrityHash: true, internalRecord: { select: { expectedRevision: true } },
      customerContract: { select: { partnerRevision: true, partnerIntegrityHash: true } },
    } });
    assert.equal(root.headRevision, 2);
    assert.deepEqual(root.internalRecord, { expectedRevision: 2 });
    assert.deepEqual(root.customerContract, { partnerRevision: 2, partnerIntegrityHash: root.integrityHash });
    assert.equal(await tx.partnerCaseRevision.count({ where: { caseId: ids.caseId } }), 2);
    assert.equal(await tx.partnerInquiryUsage.count({ where: { caseId: ids.caseId } }), 0);
    const replay = await service(tx, ids).execute(revision);
    assert.equal(replay.ok && replay.value.replayed, true);
    const originalReplay = await service(tx, ids).execute(submitted);
    assert.equal(originalReplay.ok && originalReplay.value.replayed, true);
    if (originalReplay.ok) assert.equal(originalReplay.value.case?.owner.revision, 2);
    const stale = await service(tx, ids).execute(await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'stale'));
    assert.equal(stale.ok ? null : stale.error.code, 'ROW_STALE');
    assert.equal(await tx.partnerCaseRevision.count({ where: { caseId: ids.caseId } }), 2);
  });
});

test('an unchanged Draft row retains its frozen wholesale approval after inquiry expiry', async () => {
  await fixture(async (tx, ids) => {
    const submitted = await command(ids);
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    await bindInquiryToCase(tx, ids, ids.caseId, 1, 75);
    const pricedCommand = await withApprovedBinding(ids, await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'priced'));
    const priced = await service(tx, ids).execute(pricedCommand);
    assert.equal(priced.ok, true, JSON.stringify(priced));
    if (!priced.ok || !priced.value.case) return;
    await tx.$queryRaw`SELECT pg_sleep(0.15)::text AS slept`;
    const revised = await service(tx, ids).execute(await withApprovedBinding(ids,
      await reviseCommand(ids, { ...submitted, intent: pricedCommand.intent }, 2,
        priced.value.case.owner.integrityHash, 'after-expiry')));
    assert.equal(revised.ok, true);
    if (!revised.ok || !revised.value.case) return;
    assert.equal(revised.value.case.products[0].wholesaleUnitPrice, '100');
    const usages = await tx.partnerInquiryUsage.findMany({ where: { caseId: ids.caseId },
      orderBy: { caseRevision: 'asc' }, select: { approvalSnapshot: true } });
    assert.equal(usages.length, 2);
    assert.deepEqual(usages[1].approvalSnapshot, usages[0].approvalSnapshot);
  }, 75);
});

test('an idempotent replay still requires current Case authority', async () => {
  await fixture(async (tx, ids) => {
    const submitted = await command(ids);
    assert.equal((await service(tx, ids).execute(submitted)).ok, true);
    const denied = createPartnerCaseService({ actorId: ids.partnerId, transaction: work => work(tx),
      authorize: async (_tx, request) => request.action === 'CASE_SUBMIT'
        ? { ok: false, error: { code: 'PARTNER_NOT_ACTIVE', status: 409,
          message: 'حساب فروشنده همکار فعال نیست.' } as const }
        : { ok: true, value: { evidenceId: `${ids.caseId}-authorization` } },
      authorizeProject: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } }),
      recordEvidenceReview: async () => undefined,
      resolveDraft: async () => ({ ok: true, value: await resolved(ids, ids.caseId) }),
      consumeRecovery: async () => ({ ok: true, value: undefined }) });
    const replay = await denied.execute(submitted);
    assert.equal(replay.ok ? null : replay.error.code, 'PARTNER_NOT_ACTIVE');
  });
});

test('an explicit Draft revision reauthorizes and snapshots a changed Customer and Project', async () => {
  await fixture(async (tx, ids) => {
    const base = await command(ids);
    const initialIntent = { ...base.intent, projectId: ids.firstProjectId };
    const submitted = { ...base, intent: initialIntent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: initialIntent }) } };
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    const draft = await reviseCommand(ids, submitted, 1, created.value.case.owner.integrityHash, 'parties');
    const revisedIntent = { ...draft.intent, customerId: ids.secondCustomerId, projectId: ids.secondProjectId };
    const revisedCommand = { ...draft, intent: revisedIntent, idempotency: { ...draft.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent: revisedIntent }) } };
    await tx.$executeRaw`SELECT set_config('sabalan.partner_crm_profile', '', true)`;
    const projectChecks: string[] = [];
    const revised = await service(tx, ids, undefined, async () => undefined, async (_tx, request) => {
      projectChecks.push(request.projectId);
      return { ok: true, value: { evidenceId: `${request.projectId}-authorization` } };
    }).execute(revisedCommand);
    assert.equal(revised.ok, true);
    assert.deepEqual(projectChecks.sort(), [ids.firstProjectId, ids.firstProjectId,
      ids.secondProjectId, ids.secondProjectId].sort());
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      customerId: true, customerContract: { select: { customerId: true } },
      revisions: { orderBy: { revision: 'asc' }, select: { partySnapshots: true } },
    } });
    assert.equal(root.customerId, ids.secondCustomerId);
    assert.deepEqual(root.customerContract, { customerId: ids.secondCustomerId });
    assert.notDeepEqual(root.revisions[0].partySnapshots, root.revisions[1].partySnapshots);
    assert.equal((await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: ids.firstProjectId } })).wonSalesContractId, null);
    assert.equal((await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: ids.secondProjectId } })).wonSalesContractId,
      (await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).customerContractId);
  });
});

test('a Project already won by another Case cannot be stolen by submit or Draft revision', async () => {
  await fixture(async (tx, ids) => {
    const otherCaseId = `${ids.caseId}-other`;
    const otherBase = await command(ids, otherCaseId, 'other');
    const otherIntent = { ...otherBase.intent, customerId: ids.secondCustomerId, projectId: ids.secondProjectId };
    const other = { ...otherBase, intent: otherIntent, idempotency: { ...otherBase.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: otherIntent }) } };
    const otherCreated = await service(tx, ids).execute(other);
    assert.equal(otherCreated.ok, true, JSON.stringify(otherCreated));
    if (!otherCreated.ok || !otherCreated.value.case) return;
    await bindInquiryToCase(tx, ids, otherCaseId);
    const otherPricedCommand = await withApprovedBinding(ids, await reviseCommand(ids, other, 1,
      otherCreated.value.case.owner.integrityHash, 'other-priced'));
    const otherPriced = await service(tx, ids).execute(otherPricedCommand);
    assert.equal(otherPriced.ok, true, JSON.stringify(otherPriced));
    if (!otherPriced.ok || !otherPriced.value.case) return;
    await allocateFixturePair(tx, ids, otherPricedCommand, otherPriced.value.case.owner, otherCaseId);

    const base = await command(ids);
    const initialIntent = { ...base.intent, projectId: ids.firstProjectId };
    const submitted = { ...base, intent: initialIntent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: initialIntent }) } };
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    const binding = await createApprovedInquiryForCase(tx, ids, ids.caseId);
    const pricedCommand = await withApprovedBinding(ids, await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'priced'), binding);
    const priced = await service(tx, ids).execute(pricedCommand);
    assert.equal(priced.ok, true, JSON.stringify(priced));
    if (!priced.ok || !priced.value.case) return;
    await allocateFixturePair(tx, ids, pricedCommand, priced.value.case.owner);
    const draft = await reviseCommand(ids, { ...submitted, intent: pricedCommand.intent }, 2,
      priced.value.case.owner.integrityHash, 'steal-project');
    const intent = { ...draft.intent, customerId: ids.secondCustomerId, projectId: ids.secondProjectId };
    const attempted = await withApprovedBinding(ids, { ...draft, intent }, binding);
    const rejected = await service(tx, ids).execute(attempted);
    assert.equal(rejected.ok ? null : rejected.error.code, 'ROW_STALE');
    const target = await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: ids.secondProjectId } });
    assert.equal(target.wonSalesContractId,
      (await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: otherCaseId } })).customerContractId);
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
  });
});

test('an unchanged Project binding cannot be claimed by a different customer contract', async () => {
  await fixture(async (tx, ids) => {
    const base = await command(ids);
    const intent = { ...base.intent, projectId: ids.firstProjectId };
    const submitted = { ...base, intent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    await bindInquiryToCase(tx, ids);
    const pricedCommand = await withApprovedBinding(ids, await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'priced'));
    const priced = await service(tx, ids).execute(pricedCommand);
    assert.equal(priced.ok, true, JSON.stringify(priced));
    if (!priced.ok || !priced.value.case) return;
    await allocateFixturePair(tx, ids, pricedCommand, priced.value.case.owner);
    const foreign = await tx.salesContract.create({ data: { contractNumber: `${ids.caseId}-foreign`, title: 'QA', titlePersian: 'QA',
      content: 'QA', customerId: ids.customerId, departmentId: ids.departmentId, createdBy: ids.managerId,
      responsibleSellerId: ids.managerId, totalAmount: 0 } });
    await tx.crmPotentialProject.update({ where: { id: ids.firstProjectId }, data: {
      wonSalesContractId: foreign.id, partnerRevision: { increment: 1 } } });
    const revised = await service(tx, ids).execute(await withApprovedBinding(ids,
      await reviseCommand(ids, { ...submitted, intent: pricedCommand.intent }, 2,
        priced.value.case.owner.integrityHash, 'missing-project-binding')));
    assert.equal(revised.ok ? null : revised.error.code, 'ROW_STALE');
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
  });
});

test('graph mismatch and an injected pair failure leave no partial Case, records or numbers', async () => {
  await fixture(async (tx, ids) => {
    const reviews: Array<{ code: string }> = [];
    const valid = await command(ids);
    const invalidIntent = { ...valid.intent, graphHash: `sha256-v1:${'f'.repeat(64)}` };
    const invalid = { ...valid, intent: invalidIntent, idempotency: { ...valid.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: invalidIntent }) } };
    const mismatch = await service(tx, ids, undefined, async (_tx, review) => { reviews.push(review); }).execute(invalid);
    assert.equal(mismatch.ok ? null : mismatch.error.code, 'CONFIG_MISMATCH');
    assert.deepEqual(reviews.map(review => review.code), ['CONFIG_MISMATCH']);
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 0);
    const paymentIntent = { ...valid.intent, customerPaymentPlan: { ...valid.intent.customerPaymentPlan,
      installments: valid.intent.customerPaymentPlan.installments.map(item => ({ ...item,
        amount: { ...item.amount, amount: '301' } })) } };
    const paymentCommand = { ...valid, intent: paymentIntent, idempotency: { ...valid.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: paymentIntent }) } };
    const paymentMismatch = await service(tx, ids, undefined,
      async (_tx, review) => { reviews.push(review); }).execute(paymentCommand);
    assert.equal(paymentMismatch.ok ? null : paymentMismatch.error.code, 'INVALID_PAYLOAD');
    assert.deepEqual(reviews.map(review => review.code), ['CONFIG_MISMATCH']);
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 0);
    await tx.$executeRaw`SAVEPOINT partner_case_result_failure`;
    const recoveryDenied = createPartnerCaseService({ actorId: ids.partnerId,
      transaction: async work => { try { return await work(tx); } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_case_result_failure`; throw error;
      } }, authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }),
      authorizeProject: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } }),
      recordEvidenceReview: async () => undefined,
      resolveDraft: async () => ({ ok: true, value: await resolved(ids, ids.caseId) }),
      consumeRecovery: async () => ({ ok: false, error: { code: 'ROW_STALE', status: 409,
        message: 'اطلاعات تغییر کرده است؛ صفحه را تازه کنید.' } as const }) });
    const denied = await recoveryDenied.execute(valid);
    assert.equal(denied.ok ? null : denied.error.code, 'ROW_STALE');
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 0,
      'a canonical failure returned after writes must roll the aggregate transaction back');
    await tx.$executeRaw`SAVEPOINT partner_case_failpoint`;
    const failure = new Error('case failpoint');
    const failing = createPartnerCaseService({ actorId: ids.partnerId,
      transaction: async work => { try { return await work(tx); } catch (error) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT partner_case_failpoint`; throw error;
      } }, authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }),
      authorizeProject: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } }),
      recordEvidenceReview: async () => undefined,
      resolveDraft: async () => ({ ok: true, value: await resolved(ids, ids.caseId) }),
      consumeRecovery: async () => ({ ok: true, value: undefined }),
      failpoint: point => { if (point === 'AFTER_PAIR') throw failure; } });
    await assert.rejects(failing.execute(valid), error => error === failure);
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 0);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 0);
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 0);
  });
});

test('service-only revision prices both agreements without inquiry and projects economic services separately from physical graph', async () => {
  const ids = {caseId:'service-case',partnerId:'service-partner',customerId:'service-customer',profileId:'service-profile',accountId:'service-account',departmentId:'service-department',inquiryId:'unused',inquiryRowId:'unused-row'};
  const submitted=await command(ids), base=await resolved(ids,ids.caseId);
  const graph=parseCanonicalProductGraph({...base.graph,catalogSnapshots:[],rows:[]});
  const graphHash=await canonicalHash({purpose:'PARTNER_CASE_GRAPH',schemaVersion:1,graph});
  const service={serviceRowId:'service-row',sourceType:'tool' as const,catalogItemId:'tool',catalogSnapshotVersion:'2026-10-03T00:00:00.000Z',title:'ابزار مشتری',unit:'meter' as const,quantity:'2.5',retailUnitPrice:{amount:'200',currency:'IRT' as const},wholesaleUnitPriceAmount:'100',rateEvidenceId:configurationHash};
  const source:ResolvedCaseDraft={...base,graph,rows:[],serviceRows:[service],technicalSnapshot:{...base.technicalSnapshot,graphHash,rows:[],serviceRows:[{serviceRowId:service.serviceRowId,quantity:service.quantity,unit:service.unit}]},sabalanPaymentPlan:{...base.sabalanPaymentPlan,installments:[]}};
  const input={...submitted,intent:{...submitted.intent,rows:[],serviceRows:[{serviceRowId:service.serviceRowId}],graphHash,deliveries:[{deliveryId:'service-execution',date:'2026-10-03',destination:'محل اجرای خدمت',items:[],serviceItems:[{serviceRowId:service.serviceRowId,quantity:service.quantity}]}],customerPaymentPlan:{...submitted.intent.customerPaymentPlan,installments:submitted.intent.customerPaymentPlan.installments.map(item=>({...item,amount:{amount:'500',currency:'IRT' as const}}))}}};
  assert.equal((await validateResolvedDraft(input,source)).ok,true);
  assert.equal((await validateResolvedDraft({...input,intent:{...input.intent,serviceRows:[]}},source)).ok,false);
  const evidence=buildRevisionEvidence({command:input,resolved:source,graph,graphHash,rows:[]});
  assert.equal(evidence.ok,true,JSON.stringify(evidence));if(!evidence.ok)return;
  assert.equal(evidence.value.pricingState,'READY_TO_FINALIZE');
  assert.equal(evidence.value.retailEnvelope.totals.payable,'500');
  assert.equal(evidence.value.wholesaleEnvelope.status,'PRICED');
  if(evidence.value.wholesaleEnvelope.status==='PRICED')assert.equal(evidence.value.wholesaleEnvelope.totals.payable,'250');
  const {buildCaseProjections}=await import('../partnerSales/cases/projections');
  const views=await buildCaseProjections({caseId:ids.caseId,revision:1,integrityHash:configurationHash,caseNumber:'service-case-number',internalRecordId:'service-internal',internalRecordNumber:'service-internal-number',customerContractNumber:'service-customer-number',commercialAccountId:ids.accountId,state:'DRAFT',evidence:evidence.value});
  assert.equal(views.ok,true,JSON.stringify(views));if(!views.ok)return;
  assert.equal(views.value.customer?.products[0].productType,'service');
  assert.equal(views.value.accounting?.products[0].approvalEvidenceId,undefined);
  assert.equal(views.value.accounting?.products[0].serviceRateEvidenceId,configurationHash);
  assert.deepEqual(views.value.fulfillment?.products,[]);
  assert.deepEqual(views.value.fulfillment?.deliveries,[]);
  assert.deepEqual(views.value.customer?.deliveries[0].serviceItems,[{serviceRowId:service.serviceRowId,quantity:service.quantity}]);
  for (const serviceItems of [[],[{serviceRowId:service.serviceRowId,quantity:'3'}],[{serviceRowId:'foreign-service',quantity:'2.5'}]]) {
    const rejected=buildRevisionEvidence({command:{...input,intent:{...input.intent,deliveries:input.intent.deliveries.map(delivery=>({...delivery,serviceItems}))}},resolved:source,graph,graphHash,rows:[]});
    assert.equal(rejected.ok,false,'service execution must allocate exact authorized quantities');
  }
});

test('service-only aggregate submits, allocates and commits a real Case without stone inquiry usages', async () => {
  await fixture(async (tx,ids) => {
    const base=await resolved(ids,ids.caseId), submitted=await command(ids);
    const graph=parseCanonicalProductGraph({...base.graph,catalogSnapshots:[],rows:[]});
    const graphHash=await canonicalHash({purpose:'PARTNER_CASE_GRAPH',schemaVersion:1,graph});
    const source:ResolvedCaseDraft={...base,graph,projectId:ids.firstProjectId,project:{title:'پروژه نخست',address:'تهران، پروژه نخست'},rows:[],
      serviceRows:[{serviceRowId:'service-row',sourceType:'tool',catalogItemId:'tool',catalogSnapshotVersion:'2026-10-03T00:00:00.000Z',title:'ابزار',unit:'meter',quantity:'2.5',retailUnitPrice:{amount:'200',currency:'IRT'},wholesaleUnitPriceAmount:'100',rateEvidenceId:configurationHash}],
      technicalSnapshot:{...base.technicalSnapshot,graphHash,rows:[],serviceRows:[{serviceRowId:'service-row',quantity:'2.5',unit:'meter'}]},sabalanPaymentPlan:{...base.sabalanPaymentPlan,installments:[]}};
    const intent={...submitted.intent,projectId:ids.firstProjectId,graphHash,rows:[],serviceRows:[{serviceRowId:'service-row'}],deliveries:[{deliveryId:'service-execution',date:'2026-10-03',destination:'محل اجرای خدمت',items:[],serviceItems:[{serviceRowId:'service-row',quantity:'2.5'}]}],customerPaymentPlan:{...submitted.intent.customerPaymentPlan,installments:submitted.intent.customerPaymentPlan.installments.map(item=>({...item,amount:{amount:'500',currency:'IRT' as const}}))}};
    const input={...submitted,intent,idempotency:{...submitted.idempotency,payloadHash:await canonicalHash({schemaVersion:1,type:'CASE_SUBMIT',intent})}};
    const service=createPartnerCaseService({actorId:ids.partnerId,transaction:async work=>work(tx),authorize:async()=>({ok:true,value:{evidenceId:'auth'}}),authorizeProject:async()=>({ok:true,value:{evidenceId:'project-auth'}}),recordEvidenceReview:async()=>undefined,resolveDraft:async()=>({ok:true,value:source}),consumeRecovery:async()=>({ok:true,value:undefined})});
    const saved=await service.execute(input);assert.equal(saved.ok,true,JSON.stringify(saved));if(!saved.ok||!saved.value.case)return;
    assert.equal(saved.value.case.pricingState,'READY_TO_FINALIZE');
    assert.equal(await tx.partnerCaseRowBinding.count({where:{caseId:ids.caseId}}),0);
    assert.equal(await tx.partnerInquiryUsage.count({where:{caseId:ids.caseId}}),0);
    await tx.user.update({where:{id:ids.partnerId},data:{departmentId:ids.departmentId}});
    await tx.salesContractEditSession.create({data:{draftId:intent.recoveryId,ownerUserId:ids.partnerId,browserSessionId:'service-browser',leaseToken:randomUUID(),schemaVersion:2,baseRevision:0,purpose:'PARTNER_TECHNICAL',recovery:{kind:'partner-technical-recovery',version:1,recoveryRevision:1,updatedAt:Date.now(),draft:{schemaVersion:1,inputRevision:1,rows:[]},validatedSnapshots:[]}}});
    const allocated=await allocatePartnerLinkedPair(tx,{caseId:ids.caseId,actorId:ids.partnerId,expected:saved.value.case.owner});
    assert.equal(allocated.ok,true,JSON.stringify(allocated));
    const commit={trigger:'FINALIZED' as const,authenticatedOutputEvidenceId:'service-output-evidence',lossAccepted:false};
    const lifecycle=createPartnerCaseLifecycleService({actorId:ids.partnerId,cancellationPurpose:'PARTNER',transaction:async work=>work(tx),authorize:async()=>({ok:true,value:{evidenceId:'commit-auth'}}),verifyOutputEvidence:async()=>({ok:true,value:{evidenceId:commit.authenticatedOutputEvidenceId,occurredAt:new Date().toISOString(),outputHash:configurationHash}}),cancelConfirmationSessions:async()=>({ok:true,value:{invalidatedSessionIds:[],preservedSnapshotIds:[]}}),recordEvidenceReview:async()=>undefined});
    const committed=await lifecycle.execute({schemaVersion:1,type:'CASE_COMMIT',commandId:'service-commit',correlationId:'service-commit',expected:saved.value.case.owner,expectedState:'DRAFT',...commit,idempotency:{actorId:ids.partnerId,operation:'CASE_COMMIT',targetId:ids.caseId,key:'service-commit',payloadHash:await canonicalHash({schemaVersion:1,type:'CASE_COMMIT',...commit})}});
    assert.equal(committed.ok ? null : committed.error.code, 'STATE_CONFLICT');
    const { approvePartnerCommercialSales, acceptPartnerCustomer } = await import('../partnerSales/cases/commercialLifecycle');
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1 });
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1, method: 'DIGITAL' });
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'COMMITTED');
    await tx.$executeRawUnsafe('SET CONSTRAINTS partner_exact_pair IMMEDIATE');
    await tx.$executeRawUnsafe('SET CONSTRAINTS partner_exact_pair DEFERRED');
  });
});

test('linked allocation rejects service-only rows without valid frozen catalog rate evidence', async () => {
  await fixture(async(tx,ids)=>{
    await tx.$executeRawUnsafe('SAVEPOINT invalid_service_evidence');
    const base=await resolved(ids,ids.caseId), submitted=await command(ids);
    const graph=parseCanonicalProductGraph({...base.graph,catalogSnapshots:[],rows:[]});
    const graphHash=await canonicalHash({purpose:'PARTNER_CASE_GRAPH',schemaVersion:1,graph});
    const source:ResolvedCaseDraft={...base,graph,rows:[],serviceRows:[{serviceRowId:'invalid-service-row',sourceType:'tool',catalogItemId:'tool',catalogSnapshotVersion:'2026-10-03T00:00:00.000Z',title:'خدمت',unit:'meter',quantity:'2',retailUnitPrice:{amount:'150',currency:'IRT'},wholesaleUnitPriceAmount:'100',rateEvidenceId:'not-a-catalog-rate-proof'}],technicalSnapshot:{...base.technicalSnapshot,graphHash,rows:[],serviceRows:[{serviceRowId:'invalid-service-row',quantity:'2',unit:'meter'}]},sabalanPaymentPlan:{...base.sabalanPaymentPlan,installments:[]}};
    const intent={...submitted.intent,graphHash,rows:[],serviceRows:[{serviceRowId:'invalid-service-row'}],deliveries:[{deliveryId:'service-execution',date:'2026-10-03',destination:'محل اجرای خدمت',items:[],serviceItems:[{serviceRowId:'invalid-service-row',quantity:'2'}]}]};
    const input={...submitted,intent,idempotency:{...submitted.idempotency,payloadHash:await canonicalHash({schemaVersion:1,type:'CASE_SUBMIT',intent})}};
    const cases = service(tx, ids, undefined, undefined, undefined, () => source);
    const saved=await cases.execute(input);assert.equal(saved.ok ? null : saved.error.code, 'INTEGRITY_CONFLICT');
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 0);
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId } }), 0);
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT invalid_service_evidence');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT invalid_service_evidence');
  });
});

test('deferred pair guard keeps rejecting missing stone bindings even with a service-looking envelope', async()=>{
  await fixture(async(tx,ids)=>{
    await tx.$executeRawUnsafe('SAVEPOINT missing_stone_binding');
    await tx.partnerSaleCase.create({data:{id:ids.caseId,caseNumber:ids.caseId,profileId:ids.profileId,customerId:ids.customerId,headRevision:1,integrityHash:configurationHash,state:'DRAFT',pricingState:'READY_TO_FINALIZE'}});
    const display={productRowId:'service-looking',productType:'service',description:'خدمت',quantity:'1',unit:'meter',retailUnitPrice:'100',wholesaleUnitPrice:'50',configurationHash};
    await tx.partnerCaseRevision.create({data:{caseId:ids.caseId,revision:1,integrityHash:configurationHash,graphHash:configurationHash,graph:JSON.parse(JSON.stringify(graphFor('unbound-stone'))),partySnapshots:{},wholesaleEnvelope:{schemaVersion:1,status:'PRICED',products:[display]},retailEnvelope:{schemaVersion:1,products:[display]},paymentEvidence:{},customerContent:{},internalProjection:{},customerProjection:{},actorId:ids.partnerId,commandId:`${ids.caseId}-missing-stone`}});
    await assert.rejects(()=>tx.$executeRawUnsafe('SET CONSTRAINTS partner_exact_pair IMMEDIATE'),/no row binding/);
    await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT missing_stone_binding');
    await tx.$executeRawUnsafe('RELEASE SAVEPOINT missing_stone_binding');
  });
});


test('new commercial flow permits customer acceptance before prices and resets both approvals after rejection edit', async () => {
  const { approvePartnerCommercialSales, acceptPartnerCustomer, rejectPartnerCustomer, resetPartnerCommercialApprovals, readPartnerCommercialState } = await import('../partnerSales/cases/commercialLifecycle');
  await fixture(async (tx, ids) => {
    const input = await command(ids);
    const created = await service(tx, ids).execute(input);
    assert.equal(created.ok, true, JSON.stringify(created));
    if (!created.ok || !created.value.case) return;
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
    assert.ok(root.customerContractId, 'customer contract exists while prices are pending');
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'NOTE');
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, revision: 1, actorId: ids.partnerId, method: 'DIGITAL' });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'CUSTOMER_SIGNED');
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, revision: 1, actorId: ids.partnerId });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'CUSTOMER_SIGNED', 'customer acceptance stays visible while inquiry is pending');
    await resetPartnerCommercialApprovals(tx, ids.caseId, ids.partnerId, 'آزمون نسخه مجدد');
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, revision: 2, actorId: ids.partnerId });
    await rejectPartnerCustomer(tx, ids.caseId, ids.partnerId);
    const revision = await reviseCommand(ids, input, 1, created.value.case.owner.integrityHash, 'customer-rejection-edit');
    const intent = { ...revision.intent, recoveryRevision: 2 };
    const edited = await service(tx, ids).execute({ ...revision, intent, idempotency: { ...revision.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } });
    assert.equal(edited.ok, true, JSON.stringify(edited));
    const state = await readPartnerCommercialState(tx, ids.caseId);
    assert.equal(state?.revision, 3);
    assert.equal(state?.status, 'NOTE');
    assert.equal(state?.salesApproved, false);
    assert.equal(state?.customerAccepted, false);
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});


test('customer OTP is sent only through SMS, responses hide it and old code fails after edit', async () => {
  const { createPrismaPartnerConfirmationHooks } = await import('../partnerSales/customerOutput/prismaHooks');
  const previous = { node: process.env.NODE_ENV, sms: process.env.SMS_IR_ENVIRONMENT, preview: process.env.PARTNER_LOCAL_CONFIRMATION_PREVIEW };
  process.env.NODE_ENV = 'development'; process.env.SMS_IR_ENVIRONMENT = 'sandbox'; process.env.PARTNER_LOCAL_CONFIRMATION_PREVIEW = 'true';
  try {
    await fixture(async (tx, ids) => {
      const input = await command(ids);
      const created = await service(tx, ids).execute(input);
      assert.equal(created.ok, true, JSON.stringify(created));
      if (!created.ok || !created.value.case) return;
      const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
      const database = new Proxy(tx, { get(target, key) {
        if (key === '$transaction') return async (work: (value: Prisma.TransactionClient) => unknown) => {
          await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED');
          try { const result = await work(tx); await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE'); return result; }
          finally { await tx.$executeRawUnsafe('SET CONSTRAINTS ALL DEFERRED'); }
        };
        return Reflect.get(target, key);
      } }) as unknown as PrismaClient;
      const messages: Array<{ code: string }> = [];
      const hooks = createPrismaPartnerConfirmationHooks({ database, onTechnicalError: error => { throw error; }, sms: { sendContractConfirmationMessage: async message => {
        messages.push(message); return { success: true };
      } } });
      const sent = await hooks.sendForConfirmation({ contractId: root.customerContractId!, requestedBy: ids.partnerId });
      assert.equal(sent?.success, true, sent?.error);
      assert.match(messages[0].code, /^\d{6}$/);
      assert.equal(JSON.stringify(sent).includes('debugOtp'), false);
      const stored = await tx.contractPublicConfirmation.findFirstOrThrow({ where: { contractId: root.customerContractId! } });
      assert.notEqual(stored.otpCodeHash, messages[0].code);
      assert.match(stored.otpCodeHash, /^[0-9a-f]{64}$/);
      const token = new URL(sent!.data!.publicLink!).pathname.split('/').at(-1)!;
      const publicView = await hooks.getPublicContractByToken(token);
      assert.equal(publicView?.success, true, publicView?.error);
      assert.equal(JSON.stringify(publicView).includes('debugOtp'), false);
      assert.equal(JSON.stringify(publicView).includes('wholesaleUnitPrice'), false);
      await tx.contractPublicConfirmation.update({ where: { id: stored.id }, data: { lastSentAt: new Date(Date.now() - 120000) } });
      const publicResend = await hooks.resendFromPublicToken({ token });
      assert.equal(publicResend?.success, true, publicResend?.error);
      assert.equal(publicResend?.data?.debugOtp, undefined, 'public resend must not reveal the code even while local preview is enabled');
      const rejected = await hooks.rejectPublicContract({ token });
      assert.equal(rejected?.success, true, rejected?.error);
      const revision = await reviseCommand(ids, input, 1, created.value.case.owner.integrityHash, 'otp-rejection-edit');
      const intent = { ...revision.intent, recoveryRevision: 2 };
      const edited = await service(tx, ids).execute({ ...revision, intent, idempotency: { ...revision.idempotency,
        payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } });
      assert.equal(edited.ok, true, JSON.stringify(edited));
      assert.equal((await hooks.verifyPublicOtp({ token, code: messages[0].code }))?.success, false);
      const next = await hooks.sendForConfirmation({ contractId: root.customerContractId!, requestedBy: ids.partnerId });
      assert.equal(next?.success, true, next?.error);
      const nextToken = new URL(next!.data!.publicLink!).pathname.split('/').at(-1)!;
      assert.equal((await hooks.verifyPublicOtp({ token: nextToken, code: messages.at(-1)!.code }))?.success, true);
      const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: root.customerContractId! } });
      assert.equal(contract.status, 'APPROVED', 'customer acceptance alone does not finalize pending wholesale pricing');
      await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
    });
  } finally {
    for (const [key, value] of Object.entries({ NODE_ENV: previous.node, SMS_IR_ENVIRONMENT: previous.sms, PARTNER_LOCAL_CONFIRMATION_PREVIEW: previous.preview })) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});


test('commercial finality waits for both approvals, creates no automatic financial record and first saved wholesale record realizes once', async () => {
  const { approvePartnerCommercialSales, acceptPartnerCustomer, readPartnerCommercialState } = await import('../partnerSales/cases/commercialLifecycle');
  const { readCurrentPartnerCaseViews } = await import('../partnerSales/cases/lifecycle');
  const { createPartnerAccountingAdapter } = await import('../partnerSales/accounting/adapter');
  const { createPrismaPartnerAccountingRepository } = await import('../partnerSales/accounting/prismaRepository');
  const { reconcilePartnerFinancialRealization } = await import('../partnerSales/accounting/commercialRealization');
  const { PartnerEventSchema } = await import('@sabalanerp/partner-sales-contracts');
  await fixture(async (tx, ids) => {
    const input = await command(ids);
    const intent = { ...input.intent, rows: input.intent.rows.map(row => ({ ...row, approvedRowBinding: { inquiryId: ids.inquiryId, rowId: ids.inquiryRowId, revision: 2 } })) };
    const created = await service(tx, ids).execute(input);
    assert.equal(created.ok, true, JSON.stringify(created));
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1 });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'DRAFT');
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1, method: 'DIGITAL' });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'CUSTOMER_SIGNED');
    if (!created.ok || !created.value.case) return;
    const now = new Date();
    await tx.partnerInquiry.update({ where: { id: ids.inquiryId }, data: { caseId: ids.caseId, caseRevision: 1, pricingReadyAt: now, pricingExpiresAt: new Date(now.getTime() + 48 * 3600000) } });
    const revision = await reviseCommand(ids, { ...input, intent }, 1, created.value.case.owner.integrityHash, 'final-price-accept');
    const pricingIntent = { ...revision.intent, recoveryRevision: 2, deliveries: input.intent.deliveries.map(item => ({ ...item, deliveryId: `${item.deliveryId}-priced` })) };
    const pricing = { materialAmount: '200', componentAmount: '0', totalAmount: '240',
      mandatoryCharges: [{ subjectId: `${ids.caseId}-product-row`, basisAmount: '200', percentage: '20', amount: '40' }] };
    const priced = await service(tx, ids, undefined, undefined, undefined, draft => ({ ...draft,
      rows: draft.rows.map(row => ({ ...row, wholesaleUnitPriceAmount: '120', wholesaleLineTotalAmount: '240', wholesalePricing: pricing })),
      sabalanPaymentPlan: { ...draft.sabalanPaymentPlan, installments: draft.sabalanPaymentPlan.installments.map(item => ({ ...item, amount: { amount: '240', currency: 'IRT' } })) },
    })).execute({ ...revision, intent: pricingIntent, idempotency: { ...revision.idempotency, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent: pricingIntent }) } });
    assert.equal(priced.ok, true, JSON.stringify(priced));
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'FINAL');
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
    assert.equal(await tx.accountingFinancialRecord.count({ where: { sourceId: root.internalRecordId } }), 0);
    const views = await readCurrentPartnerCaseViews(tx, ids.caseId); assert.ok(views?.accounting);
    assert.deepEqual(views?.accounting?.products[0].wholesalePricing, pricing);
    const frozen = await tx.partnerCaseRevision.findFirstOrThrow({ where: { caseId: ids.caseId }, orderBy: { revision: 'desc' } });
    assert.doesNotMatch(JSON.stringify(frozen.retailEnvelope), /wholesalePricing|mandatoryCharges/);
    assert.equal(views?.partner.retailTotals.payable, '300');
    const customerOutput = (await import('@sabalanerp/partner-sales-contracts')).CustomerContractOutputSchema.parse(frozen.customerProjection);
    assert.equal(customerOutput.totals.payable, '300');
    assert.doesNotMatch(JSON.stringify(customerOutput), /wholesalePricing|mandatoryCharges|حکمی سبلان/);
    const { projectPartnerInternalContent } = await import('../partnerSales/accounting/internalDocumentContent');
    assert.deepEqual(projectPartnerInternalContent({ partnerPreparation: { ...views!.accounting!, paymentPlan: views!.accounting!.sabalanPaymentPlan } }, frozen.graph).items[0].wholesalePricing, pricing);
    const commitment = PartnerEventSchema.parse((await tx.partnerCaseEvent.findFirstOrThrow({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } })).evidence && ((await tx.partnerCaseEvent.findFirstOrThrow({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } })).evidence as Prisma.JsonObject).publicEvent);
    assert.equal(commitment.type, 'CASE_COMMITTED');
    if (commitment.type !== 'CASE_COMMITTED') return;
    const database = new Proxy(tx, { get(target, key) { if (key === '$transaction') return async (work: (value: Prisma.TransactionClient) => unknown) => work(tx); return Reflect.get(target, key); } }) as unknown as PrismaClient;
    await tx.user.update({ where: { id: ids.responderId }, data: { role: 'USER' } });
    for (const action of ['ACCOUNTING_READ', 'ACCOUNTING_WRITE']) await tx.effectiveActionGrant.create({ data: { id: randomUUID(), principalKind: 'USER', principalId: ids.responderId, subjectUserId: ids.responderId, domain: 'PARTNER', action, rootKind: 'CASE', purpose: 'ACCOUNTING', scope: 'COMPANY', effect: 'ALLOW', grantedBy: ids.responderId, reason: 'isolated accounting fixture', correlationId: randomUUID() } });
    const accounting = createPartnerAccountingAdapter(createPrismaPartnerAccountingRepository({ database, actorId: ids.responderId, correlationId: randomUUID() }));
    const saved = await accounting.enqueueCommitted({ ...views!.accounting!, state: 'COMMITTED' }, commitment);
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: root.customerContractId! } })).realizedAmount?.toString(), '240', 'wholesale total includes twenty percent mandatory; retail remains 300');
    assert.equal(await tx.salesReportingEvent.count({ where: { contractId: root.customerContractId! } }), 1);
    assert.equal((await accounting.enqueueCommitted({ ...views!.accounting!, state: 'COMMITTED' }, commitment)).ok, true);
    assert.equal(await tx.salesReportingEvent.count({ where: { contractId: root.customerContractId! } }), 1);
    const record = await tx.accountingFinancialRecord.findFirstOrThrow({ where: { sourceId: root.internalRecordId } });
    assert.deepEqual(projectPartnerInternalContent(record.sourceSnapshot, frozen.graph).items[0].wholesalePricing, pricing);
    await tx.accountingFinancialRecord.delete({ where: { id: record.id } });
    await reconcilePartnerFinancialRealization(tx, root.id, ids.responderId, `test-reversal:${root.id}`);
    const events = await tx.salesReportingEvent.findMany({ where: { contractId: root.customerContractId! } });
    assert.equal(events.reduce((value, event) => value.plus(event.amount), new Prisma.Decimal(0)).toString(), '0');
    assert.ok((await tx.salesContract.findUniqueOrThrow({ where: { id: root.customerContractId! } })).firstFinancialRecordAt, 'first record boundary remains sticky');
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('retail quote and numbered draft accept a CRM customer without an optional personal address', async () => {
  await fixture(async (tx, ids) => {
    const { resolvePrismaPartnerCaseDraft } = await import('../partnerSales/cases/prismaComposition');
    const { encodeTechnicalSavedSnapshot } = await import('../partnerSales/cases/technicalSavedRecords');
    const submitted = await command(ids);
    submitted.intent.projectId = ids.firstProjectId;
    const source = await resolved(ids, ids.caseId, 1, ids.customerId, ids.firstProjectId);
    await tx.crmCustomer.update({ where: { id: ids.customerId }, data: {
      homeNumber: '09121234567', partnerRevision: { increment: 1 },
    } });
    await tx.partnerCommercialIdentity.create({ data: { accountId: ids.accountId, version: 1,
      legalName: 'فروشنده آزمون', phone: '09121234568', address: 'نشانی فروشنده', identifiers: {}, integrityHash: configurationHash, actorId: ids.partnerId } });
    const session = await tx.salesContractEditSession.create({ data: {
      draftId: submitted.intent.recoveryId, ownerUserId: ids.partnerId, browserSessionId: 'quote-test',
      leaseToken: randomUUID(), schemaVersion: 2, baseRevision: 0, purpose: 'PARTNER_TECHNICAL',
    } });
    const productRowId = submitted.intent.rows[0].productRowId;
    const snapshot = await encodeTechnicalSavedSnapshot({ version: 1, sessionId: session.id,
      view: source.technicalSnapshot, graph: source.graph,
      draft: { schemaVersion: 1, inputRevision: 1, rows: [{ productRowId,
        catalogItemId: 'catalog-case-stone', catalogSnapshotVersion: '2026-08-29T00:00:00.000Z', family: 'prepared',
        configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }] },
      context: { catalog: { products: [{ catalogItemId: 'catalog-case-stone', name: 'سنگ آماده', code: 'stone' }] } },
      identities: [{ productRowId, identity: { schemaVersion: 1, partnerSellerId: ids.partnerId,
        catalogProductId: 'catalog-case-stone', family: 'prepared', unit: 'count', configuration: [{key:'kind',value:'readyPiece'}],
        materialRateEvidenceId: 'test-material', materialRateHash: configurationHash, components: [],
        currency: 'IRT', calculationPolicyVersion: 'calculation-v1', roundingPolicyVersion: 'rounding-v1' } }],
    });
    await tx.salesContractEditSession.update({ where: { id: session.id }, data: { recovery: {
      kind: 'partner-technical-recovery', version: 1, recoveryRevision: 1, updatedAt: Date.now(),
      draft: { schemaVersion: 1, inputRevision: 1, rows: [{ productRowId,
        catalogItemId: 'catalog-case-stone', catalogSnapshotVersion: '2026-08-29T00:00:00.000Z',
        family: 'prepared', configuration: { kind: 'readyPiece', unit: 'count', quantity: '2' } }] }, validatedSnapshots: [snapshot],
    } as Prisma.InputJsonValue } });
    const result = await resolvePrismaPartnerCaseDraft(tx, { actorId: ids.partnerId, command: submitted });
    assert.equal(result.ok, true, result.ok ? undefined : result.error.code);
    if (!result.ok) return;
    assert.equal(result.value.rows[0].retailLineTotalAmount, '200');
    assert.equal(result.value.customer.address, undefined, 'do not invent an address or copy the project address');
    assert.equal(result.value.project?.address, 'تهران، پروژه نخست');
    // The resolver is shared by quote and submission; the resulting customer
    // projection must retain the genuinely absent optional CRM address.
    assert.equal((await validateResolvedDraft(submitted, result.value)).ok, true);
    submitted.intent.customerPaymentPlan.installments[0].amount.amount = '200';
    const evidence = buildRevisionEvidence({ command: submitted, resolved: result.value,
      graph: result.value.graph, graphHash: submitted.intent.graphHash, rows: result.value.rows.map(row => ({
        ...row, retailUnitPrice: {amount: row.retailUnitPriceAmount, currency: 'IRT' as const},
      })) });
    assert.equal(evidence.ok, true);
    if (!evidence.ok) return;
    const {buildCaseProjections} = await import('../partnerSales/cases/projections');
    const projections = await buildCaseProjections({caseId:ids.caseId,revision:1,integrityHash:configurationHash,
      caseNumber:'PC-ADDRESS-TEST',customerContractNumber:'CT-ADDRESS-TEST',commercialAccountId:ids.accountId,
      state:'DRAFT',evidence:evidence.value});
    assert.equal(projections.ok, true);
    if (projections.ok) assert.equal(projections.value.customer?.customer.address, undefined);
  });
});


test('explicit product revision replaces old pending inquiry duties atomically and replays once', async () => {
  await fixture(async (tx, ids) => {
    const initial = await command(ids);
    const saved = await service(tx, ids).execute(initial);
    assert.ok(saved.ok && saved.value.case, JSON.stringify(saved));
    if (!saved.ok || !saved.value.case) return;
    const inquiries = (replacePendingCaseInquiries = false, invalidEvidence = false) => createPartnerInquiryService({
      actorId: ids.partnerId, replacePendingCaseInquiries, transaction: async work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: 'fixture' } }),
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: { fixture: true } } }),
      resolveConfiguration: async () => ({ ok: true, value: { identity: {
        schemaVersion: 1, partnerSellerId: invalidEvidence ? 'different-owner' : ids.partnerId, catalogProductId: 'catalog-stone', family: 'prepared', unit: 'count',
        configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
        materialRateEvidenceId: 'fixture-rate', materialRateHash: configurationHash, components: [], currency: 'IRT',
        calculationPolicyVersion: 'fixture-v1', roundingPolicyVersion: 'fixture-v1',
      }, description: 'سنگ آماده', configuration: [{ label: 'تعداد', value: '۲' }] } }),
    });
    const pricingCommand = async (owner: typeof saved.value.case.owner, suffix: string) => {
      const payload = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const, caseId: ids.caseId,
        inquiryId: `${ids.caseId}-inquiry-${suffix}`, expected: owner, rows: [{ rowId: `${ids.caseId}-row-${suffix}`,
          configuration: { recoveryId: `${ids.caseId}-recovery`, recoveryRevision: owner.revision, productRowId: `${ids.caseId}-product-row` } }] };
      return { ...payload, commandId: `${ids.caseId}-pricing-${suffix}`, correlationId: `${ids.caseId}-pricing-${suffix}`,
        idempotency: { actorId: ids.partnerId, operation: 'CASE_PRICING_SUBMIT' as const, targetId: ids.caseId,
          key: suffix, payloadHash: await canonicalHash(payload) } };
    };
    const old = await pricingCommand(saved.value.case.owner, 'old');
    assert.ok((await inquiries().execute(old)).ok);
    const revisionInput = await reviseCommand(ids, initial, 1, saved.value.case.owner.integrityHash);
    const revised = await service(tx, ids).execute(revisionInput);
    assert.ok(revised.ok && revised.value.case, JSON.stringify(revised));
    if (!revised.ok || !revised.value.case) return;
    const independent = await pricingCommand(revised.value.case.owner, 'independent');
    assert.ok((await inquiries().execute(independent)).ok);
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: old.rows[0].rowId } })).outcome, 'PENDING',
      'ordinary row inquiries do not cancel unrelated pending work');
    await tx.$executeRaw`SAVEPOINT replacement_failure`;
    const failingRevision = await service(tx, ids).execute(await reviseCommand(ids,
      { ...initial, intent: revisionInput.intent }, 2, revised.value.case.owner.integrityHash, 'failed-edit'));
    assert.ok(failingRevision.ok && failingRevision.value.case);
    if (!failingRevision.ok || !failingRevision.value.case) return;
    const failedInquiry = await inquiries(true, true).execute(await pricingCommand(failingRevision.value.case.owner, 'invalid-evidence'));
    assert.equal(failedInquiry.ok, false);
    await tx.$executeRaw`ROLLBACK TO SAVEPOINT replacement_failure`;
    await tx.$executeRaw`RELEASE SAVEPOINT replacement_failure`;
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 2);
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: old.rows[0].rowId } })).outcome, 'PENDING');
    assert.equal(await tx.partnerInquiry.count({ where: { id: `${ids.caseId}-inquiry-invalid-evidence` } }), 0);
    const third = await service(tx, ids).execute(await reviseCommand(ids, { ...initial, intent: revisionInput.intent }, 2, revised.value.case.owner.integrityHash, 'edit-again'));
    assert.ok(third.ok && third.value.case, JSON.stringify(third));
    if (!third.ok || !third.value.case) return;
    const replacement = await pricingCommand(third.value.case.owner, 'replacement');
    const replaced = await inquiries(true).execute(replacement);
    assert.ok(replaced.ok, JSON.stringify(replaced));
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: old.rows[0].rowId } })).outcome, 'CANCELLED');
    assert.equal((await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: old.inquiryId } })).status, 'CANCELLED');
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: independent.rows[0].rowId } })).outcome, 'CANCELLED');
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: ids.inquiryRowId } })).outcome, 'APPROVED', 'immutable decisions remain unchanged');
    for (const current of [replacement]) {
      assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: current.rows[0].rowId } })).outcome, 'PENDING');
      assert.equal((await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: current.inquiryId } })).status, 'OPEN');
    }
    const replay = await inquiries(true).execute(replacement);
    assert.ok(replay.ok && replay.value.replayed);
    assert.equal(await tx.partnerInquiry.count({ where: { id: replacement.inquiryId } }), 1);
    assert.equal(await tx.partnerInquiryEvent.count({ where: { inquiryId: old.inquiryId, type: 'INQUIRY_CANCELLED' } }), 1);
  });
});

test('seller rejection cancels an approved pending-price case without deleting its evidence', async () => {
  const { approvePartnerCommercialSales } = await import('../partnerSales/cases/commercialLifecycle');
  await fixture(async (tx, ids) => {
    const first = await service(tx, ids).execute(await command(ids));
    assert.equal(first.ok, true, JSON.stringify(first));
    if (!first.ok || !first.value.case) return;
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1 });
    const reason = 'لغو قرارداد به درخواست فروشنده';
    const lifecycle = createPartnerCaseLifecycleService({ actorId: ids.partnerId, cancellationPurpose: 'PARTNER', transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-reject-authority` } }),
      verifyOutputEvidence: async () => ({ ok: false, error: { code: 'STATE_CONFLICT', status: 409, message: 'not required' } }),
      cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
      recordEvidenceReview: async () => undefined });
    const result = await lifecycle.execute({ schemaVersion: 1, type: 'CASE_CANCEL', commandId: `${ids.caseId}-reject`, correlationId: `${ids.caseId}-reject`,
      expected: first.value.case.owner, expectedState: 'DRAFT', reason,
      idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL', targetId: ids.caseId, key: `${ids.caseId}-reject`,
        payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', reason }) } });
    assert.equal(result.ok, true, JSON.stringify(result));
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, include: { customerContract: true } });
    assert.equal(root.state, 'CANCELLED');
    assert.equal(root.customerContract?.status, 'CANCELLED');
    assert.equal(root.committedAt, null);
  });
});

test('contract list statuses distinguish approval customer acceptance and received pricing', async () => {
  const { approvePartnerCommercialSales, acceptPartnerCustomer, readPartnerCommercialState } = await import('../partnerSales/cases/commercialLifecycle');
  await fixture(async (tx, ids) => {
    const created = await service(tx, ids).execute(await command(ids));
    assert.equal(created.ok, true, JSON.stringify(created));
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'NOTE');
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1 });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'DRAFT');
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1, method: 'DIGITAL' });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'CUSTOMER_SIGNED');
    assert.equal((await readPartnerCommercialState(tx, ids.caseId, 'PARTIAL'))?.status, 'CUSTOMER_SIGNED');
    assert.equal((await readPartnerCommercialState(tx, ids.caseId, 'READY'))?.status, 'QUOTED');
    assert.equal((await readPartnerCommercialState(tx, ids.caseId, 'EXPIRED'))?.status, 'CUSTOMER_SIGNED');
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).committedAt, null);
  });
});

test('three price negotiation rounds keep the same Case revision and expose the exact successor duty reason', async () => {
  await fixture(async (tx, ids) => {
    const saved = await service(tx, ids).execute(await command(ids));
    assert.ok(saved.ok && saved.value.case);
    if (!saved.ok || !saved.value.case) return;
    const ports = (actorId: string) => createPartnerInquiryService({ actorId, transaction: async work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: 'fixture' } }),
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: { fixture: true } } }),
      resolveConfiguration: async () => ({ ok: true, value: { identity: {
        schemaVersion: 1, partnerSellerId: ids.partnerId, catalogProductId: 'catalog-stone', family: 'prepared', unit: 'count',
        configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
        materialRateEvidenceId: 'fixture-rate', materialRateHash: configurationHash, components: [], currency: 'IRT',
        calculationPolicyVersion: 'fixture-v1', roundingPolicyVersion: 'fixture-v1' },
        description: 'سنگ آماده', configuration: [{ label: 'تعداد', value: '۲' }] } }),
    });
    let previous: { rowId: string; revision: number; reason: string } | undefined;
    let priorInquiry: string | undefined;
    for (let round = 1; round <= 3; round++) {
      const inquiryId = `${ids.caseId}-round-${round}`, rowId = `${inquiryId}-row`;
      const intent = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const, caseId: ids.caseId,
        inquiryId, expected: saved.value.case.owner, rows: [{ rowId,
          configuration: { recoveryId: `${ids.caseId}-recovery`, recoveryRevision: 1, productRowId: `${ids.caseId}-product-row` },
          ...(previous ? { predecessor: previous } : {}) }] };
      const submitted = await ports(ids.partnerId).execute({ ...intent, commandId: inquiryId, correlationId: inquiryId,
        idempotency: { actorId: ids.partnerId, operation: intent.type, targetId: ids.caseId, key: inquiryId,
          payloadHash: await canonicalHash(intent) } });
      assert.ok(submitted.ok, JSON.stringify(submitted));
      if (previous) {
        const view = await ports(ids.responderId).query({ schemaVersion: 2, purpose: 'RESPONDER_INQUIRY', inquiryId });
        assert.ok(view.ok && view.value.rows[0].partnerRejectionReason === previous.reason);
        const prior = await ports(ids.partnerId).query({ schemaVersion: 2, purpose: 'PARTNER_INQUIRY', inquiryId: priorInquiry! });
        assert.ok(prior.ok && prior.value.rows[0].successor?.inquiryId === inquiryId);
      }
      const decision = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId,
        expectedAssignmentRevision: 1, decisions: [{ rowId, expectedRevision: 1, outcome: 'APPROVED' as const,
          wholesaleUnitPrice: { amount: String(2000000 - round * 100000), currency: 'IRT' as const } }] };
      const offered = await ports(ids.responderId).execute({ ...decision, commandId: `${inquiryId}-offer`, correlationId: inquiryId,
        idempotency: { actorId: ids.responderId, operation: decision.type, targetId: inquiryId,
          key: `${inquiryId}-offer`, payloadHash: await canonicalHash(decision) } });
      assert.ok(offered.ok, JSON.stringify(offered));
      previous = { rowId, revision: 2, reason: `کاهش قیمت نوبت ${round}` }; priorInquiry = inquiryId;
    }
    assert.equal(await tx.partnerInquiry.count({ where: { caseId: ids.caseId } }), 3);
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 1);
  });
});

async function finalCommercialFixture(tx: Prisma.TransactionClient, ids: Record<string, string>) {
  const { approvePartnerCommercialSales, acceptPartnerCustomer } = await import('../partnerSales/cases/commercialLifecycle');
  const input = await command(ids);
  const created = await service(tx, ids).execute(input);
  assert.ok(created.ok && created.value.case, JSON.stringify(created));
  if (!created.ok || !created.value.case) throw new Error('Case fixture unavailable');
  await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1 });
  await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: 1, method: 'DIGITAL' });
  await bindInquiryToCase(tx, ids);
  const priced = await withApprovedBinding(ids, await reviseCommand(ids, input, 1, created.value.case.owner.integrityHash, 'priced'));
  const finalized = await service(tx, ids).execute(priced);
  assert.ok(finalized.ok && finalized.value.case, JSON.stringify(finalized));
  if (!finalized.ok || !finalized.value.case) throw new Error('Final Case unavailable');
  const commercial = await tx.salesContract.findFirstOrThrow({ where: { partnerCaseId: ids.caseId } });
  await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: commercial.commercialRevision });
  await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: commercial.commercialRevision, method: 'DIGITAL' });
  const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
  assert.equal(root.state, 'COMMITTED');
  return { input: { ...input, intent: priced.intent }, owner: finalized.value.case.owner, root };
}

async function approvePartnerEdit(tx: Prisma.TransactionClient, input: {
  contractId: string; actorUserId: string; reason: string; requestKey: string; now: Date;
}) {
  const { openPartnerCommercialEditPermission } = await import('../crossWorkspaceDutyAdapters/salesContractCorrectionDutyAdapter');
  const { respondToCrossWorkspaceDuty } = await import('../crossWorkspaceDutyModule');
  const request = await openPartnerCommercialEditPermission(tx, input);
  assert.equal(request.status, 'ACKNOWLEDGED');
  const duty = await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: request.id, status: 'OPEN' } });
  const manager = await tx.user.findFirstOrThrow({ where: { username: input.actorUserId.replace('-responder', '-manager') } });
  await respondToCrossWorkspaceDuty(tx, { dutyId: duty.id, actorUserId: manager.id, actionCode: 'APPROVE',
    expectedSourceVersion: duty.sourceVersion, expectedEnvelopeVersion: duty.envelopeVersion,
    reason: 'تأیید مستقل مدیر حسابداری', policyVersion: 2, now: input.now });
  return tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } });
}

test('Partner reactivation returns to note, requires manager authority, rejects old prices and restores debt only once at new finality', async () => {
  const { reactivatePartnerCase } = await import('../partnerSales/cases/reactivation');
  const { readPartnerCommercialState, approvePartnerCommercialSales, acceptPartnerCustomer, assertPartnerFinancialFinality } = await import('../partnerSales/cases/commercialLifecycle');
  const { currentPricingEvidenceIsValid } = await import('../partnerSales/cases/lifecycle');
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const { capturePartnerContractedQuantities } = await import('../partnerSales/fulfillment/quantityStore');
    const { FulfillmentViewSchema } = await import('@sabalanerp/partner-sales-contracts');
    const initialHead = await tx.partnerCaseRevision.findUniqueOrThrow({ where: { caseId_revision: { caseId: ids.caseId, revision: final.owner.revision } } });
    const physical = FulfillmentViewSchema.parse((initialHead.internalProjection as Prisma.JsonObject).fulfillment);
    for (const product of physical.products) await tx.partnerFulfillmentLineage.create({ data: {
      id: `${ids.caseId}-lineage`, caseId: ids.caseId, caseRevision: physical.owner.revision,
      integrityHash: physical.owner.integrityHash, internalRecordId: physical.recordId,
      productRowId: product.productRowId, quantity: product.quantity, unit: product.unit,
      recipient: { customerId: ids.customerId, displayName: 'مشتری تست', phone: '09120000000', destination: 'مقصد تست' },
      deliveryIds: physical.deliveries.map(delivery => delivery.deliveryId), commandId: `${ids.caseId}-lineage-command`,
    } });
    await capturePartnerContractedQuantities(tx, physical);
    const lifecycle = createPartnerCaseLifecycleService({ actorId: ids.partnerId, cancellationPurpose: 'PARTNER', transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: 'fixture-cancel' } }),
      verifyOutputEvidence: async () => ({ ok: false, error: { code: 'STATE_CONFLICT', status: 409, message: 'unused' } }),
      cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
      recordEvidenceReview: async () => undefined });
    const grant = () => approvePartnerEdit(tx, { contractId: final.root.customerContractId!, actorUserId: ids.responderId,
      reason: 'درخواست و تأیید مستقل مدیر', requestKey: randomUUID(), now: new Date() });
    await grant();
    const reason = 'لغو قرارداد برای آزمون فعال‌سازی';
    const cancelled = await lifecycle.execute({ schemaVersion: 1, type: 'CASE_CANCEL', commandId: randomUUID(), correlationId: randomUUID(),
      expected: final.owner, expectedState: 'COMMITTED', reason,
      idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL', targetId: ids.caseId, key: randomUUID(),
        payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', reason }) } });
    assert.ok(cancelled.ok, JSON.stringify(cancelled));
    const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } });
    const input = { caseId: ids.caseId, actorId: ids.partnerId, expected: final.owner, expectedState: 'VOIDED',
      commercialRevision: contract.commercialRevision, commandId: randomUUID(), reason: 'فعال‌سازی با استعلام تازه' };
    await assert.rejects(() => reactivatePartnerCase(tx, input), /مجوز تازه/);
    await grant();
    await reactivatePartnerCase(tx, input);
    await reactivatePartnerCase(tx, input);
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'NOTE');
    assert.equal(await currentPricingEvidenceIsValid(tx, final.owner), false);
    await assert.rejects(() => assertPartnerFinancialFinality(tx, ids.caseId), /قطعی/);
    assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_REACTIVATED' } }), 1);
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 1);
    const stale = await reviseCommand(ids, final.input, final.owner.revision, final.owner.integrityHash, 'old-price-after-reactivation', 'COMMITTED');
    const denied = await service(tx, ids).execute(stale);
    assert.equal(denied.ok ? null : denied.error.code, 'APPROVAL_EXPIRED');
    const binding = await createApprovedInquiryForCase(tx, ids, ids.caseId);
    const repriced = await reviseCommand(ids, final.input, final.owner.revision, final.owner.integrityHash, 'new-price-after-reactivation', 'COMMITTED');
    repriced.intent.rows[0].approvedRowBinding = binding;
    repriced.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: repriced.type, intent: repriced.intent });
    const saved = await service(tx, ids).execute(repriced);
    assert.ok(saved.ok && saved.value.case, JSON.stringify(saved));
    const current = await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: current.commercialRevision });
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: current.commercialRevision, method: 'DIGITAL' });
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: current.commercialRevision });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'FINAL');
    assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } }), 1);
    assert.equal(await tx.shipmentQuantityEvidence.count({ where: { partnerCaseId: ids.caseId,
      partnerCaseRevision: saved.ok && saved.value.case ? saved.value.case.owner.revision : -1, kind: 'CONTRACTED_SET' } }), 1,
      'reactivation finality publishes the new physical baseline once');
    assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_RECOMMITTED' } }), 1);
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 2);
    const adjustments = await tx.partnerFinancialAdjustment.findMany({ where: { caseId: ids.caseId } });
    assert.equal(adjustments.reduce((amount, item) => amount.plus(item.delta), new Prisma.Decimal(200)).toString(), '200');
    // A second cancellation/activation may itself be cancelled before finality.
    // That empty cycle must not add debt or duplicate commercial credit.
    const cancelCurrent = async () => {
      const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
      const expected = { caseId: ids.caseId, revision: root.headRevision, integrityHash: root.integrityHash };
      const reason = 'لغو چرخه بعدی';
      const result = await lifecycle.execute({ schemaVersion: 1, type: 'CASE_CANCEL', commandId: randomUUID(), correlationId: randomUUID(),
        expected, expectedState: 'COMMITTED', reason, idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL',
          targetId: ids.caseId, key: randomUUID(), payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', reason }) } });
      assert.ok(result.ok, JSON.stringify(result));
      return expected;
    };
    const reopen = async (expected: typeof final.owner) => {
      await grant();
      const row = await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
      await reactivatePartnerCase(tx, { ...input, expected, commercialRevision: row.commercialRevision, commandId: randomUUID() });
    };
    assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceType: 'SALES_CONTRACT_CORRECTION',
      sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION',
      sourceId: { in: (await tx.accountingCorrectionRequest.findMany({ where: { contractId: contract.id } })).map(row => row.id) } } }), 0);
    await grant();
    await reopen(await cancelCurrent());
    await reopen(await cancelCurrent());
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } });
    const freshBinding = await createApprovedInquiryForCase(tx, ids, ids.caseId);
    const fresh = await reviseCommand(ids, { ...final.input, intent: repriced.intent }, root.headRevision, root.integrityHash, 'another-fresh-cycle', 'COMMITTED');
    fresh.intent.rows[0].approvedRowBinding = freshBinding;
    fresh.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: fresh.type, intent: fresh.intent });
    const success = await service(tx, ids).execute(fresh);
    assert.ok(success.ok, JSON.stringify(success));
    const note = await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: note.commercialRevision });
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: note.commercialRevision, method: 'DIGITAL' });
    const allAdjustments = await tx.partnerFinancialAdjustment.findMany({ where: { caseId: ids.caseId } });
    assert.equal(allAdjustments.reduce((amount, item) => amount.plus(item.delta), new Prisma.Decimal(200)).toString(), '200');
    assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } }), 1);
    assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_RECOMMITTED' } }), 2);
    const { readPersistedPartnerEvents } = await import('../partnerSales/events/persisted');
    const { caseHistory } = await import('../partnerSales/reporting/history');
    const runtime = await import('@sabalanerp/partner-sales-contracts');
    const eventRows = await tx.partnerCaseEvent.findMany({ where: { caseId: ids.caseId }, orderBy: { sequence: 'asc' } });
    const history = caseHistory(runtime, readPersistedPartnerEvents({ id: ids.caseId, internalRecordId: root.internalRecordId! }, eventRows));
    assert.equal(history.voids.length, 3);
    assert.equal(history.voided, undefined);
    assert.equal(history.effective?.revision, root.headRevision + 1);
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('one Accounting permission permits repeated Partner edits, resets both approvals, expires and can be renewed', async () => {
  const openPartnerCommercialEditPermission = (db: Prisma.TransactionClient, input: Parameters<typeof approvePartnerEdit>[1]) => approvePartnerEdit(db, input);
  const { readPartnerCommercialEditPermission } = await import('../partnerSales/cases/commercialEditPermission');
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const first = await reviseCommand(ids, final.input, final.owner.revision, final.owner.integrityHash, 'shared-edit-one', 'COMMITTED');
    first.intent.deliveries[0].destination = 'تهران، مقصد ویرایش نخست';
    first.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: first.type, intent: first.intent });
    const denied = await service(tx, ids).execute(first);
    assert.equal(denied.ok ? null : denied.error.code, 'DEPENDENCY_BLOCKED');
    const grant = await openPartnerCommercialEditPermission(tx, { contractId: final.root.customerContractId!, actorUserId: ids.responderId,
      reason: 'مجوز مشترک ویرایش و لغو', requestKey: randomUUID(), now: new Date() });
    const edited = await service(tx, ids).execute(first);
    assert.ok(edited.ok && edited.value.case, JSON.stringify(edited));
    if (!edited.ok || !edited.value.case) return;
    const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } });
    assert.equal(contract.status, 'DRAFT'); assert.equal(contract.salesApprovalRevision, null); assert.equal(contract.customerAcceptanceRevision, null);
    const duty = await readPartnerCommercialEditPermission(tx, contract.id, ids.partnerId);
    assert.equal(duty?.sourceId, grant.id);
    const second = await reviseCommand(ids, { ...final.input, intent: first.intent }, edited.value.case.owner.revision,
      edited.value.case.owner.integrityHash, 'shared-edit-two', 'COMMITTED');
    const twice = await service(tx, ids).execute(second);
    assert.ok(twice.ok && twice.value.case, JSON.stringify(twice));
    if (!twice.ok || !twice.value.case) return;
    assert.equal((await readPartnerCommercialEditPermission(tx, contract.id, ids.partnerId))?.id, duty?.id);
    await tx.crossWorkspaceDuty.update({ where: { id: duty!.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    const third = await reviseCommand(ids, { ...final.input, intent: second.intent }, twice.value.case.owner.revision,
      twice.value.case.owner.integrityHash, 'shared-edit-expired', 'COMMITTED');
    assert.equal((await service(tx, ids).execute(third)).ok, false);
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, twice.value.case.owner.revision);
    const renewed = await openPartnerCommercialEditPermission(tx, { contractId: contract.id, actorUserId: ids.responderId,
      reason: 'تمدید دسترسی مشترک', requestKey: randomUUID(), now: new Date() });
    assert.notEqual(renewed.id, grant.id);
    assert.equal((await tx.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty!.id } })).status, 'CANCELLED');
    assert.equal((await service(tx, ids).execute(third)).ok, true);
    const { approvePartnerCommercialSales, acceptPartnerCustomer } = await import('../partnerSales/cases/commercialLifecycle');
    const savedContract = await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } });
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: savedContract.commercialRevision });
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: savedContract.commercialRevision, method: 'DIGITAL' });
    assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: contract.id } })).status, 'SIGNED');
    assert.equal(await readPartnerCommercialEditPermission(tx, contract.id, ids.partnerId), null);

    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('committed Partner cancellation requires the common permission and neutralizes obligation once without deleting history', async () => {
  const openPartnerCommercialEditPermission = (db: Prisma.TransactionClient, input: Parameters<typeof approvePartnerEdit>[1]) => approvePartnerEdit(db, input);
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const lifecycle = createPartnerCaseLifecycleService({ actorId: ids.partnerId, cancellationPurpose: 'PARTNER', transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: 'fixture-cancel' } }),
      verifyOutputEvidence: async () => ({ ok: false, error: { code: 'STATE_CONFLICT', status: 409, message: 'unused' } }),
      cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
      recordEvidenceReview: async () => undefined });
    const reason = 'لغو قرارداد قطعی توسط فروشنده همکار';
    const cancel = { schemaVersion: 1 as const, type: 'CASE_CANCEL' as const, commandId: randomUUID(), correlationId: randomUUID(),
      expected: final.owner, expectedState: 'COMMITTED' as const, reason,
      idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL' as const, targetId: ids.caseId, key: randomUUID(),
        payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', reason }) } };
    assert.equal((await lifecycle.execute(cancel)).ok, false);
    const permission = await openPartnerCommercialEditPermission(tx, { contractId: final.root.customerContractId!, actorUserId: ids.responderId,
      reason: 'مجوز ویرایش و لغو', requestKey: randomUUID(), now: new Date() });
    const cancelled = await lifecycle.execute(cancel);
    assert.ok(cancelled.ok, JSON.stringify(cancelled));
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'VOIDED');
    assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } })).status, 'CANCELLED');
    assert.equal(await tx.partnerCaseEvent.count({ where: { caseId: ids.caseId, type: 'CASE_COMMITTED' } }), 1);
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 1);
    assert.equal((await tx.partnerFinancialAdjustment.findFirstOrThrow({ where: { caseId: ids.caseId } })).delta.toString(), '-200');
    assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: permission.id } })).status, 'RESOLVED');
    assert.equal((await lifecycle.execute(cancel)).ok, true);
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 1);
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('responder SQL pages twenty authorized contracts with package grouping, global search and independent tab counts', async () => {
  const { createPrismaPartnerWorkspaceQuery } = await import('../partnerSales/workspaces/prisma');
  await fixture(async (tx, ids) => {
    const allow = async () => ({ ok: true as const, value: { evidenceId: 'fixture-inbox' } });
    const inquiryService = createPartnerInquiryService({ actorId: ids.partnerId, transaction: work => work(tx), authorize: allow,
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: {} } }),
      resolveConfiguration: async () => ({ ok: true, value: { identity: { schemaVersion: 1, partnerSellerId: ids.partnerId,
        catalogProductId: 'catalog-stone', family: 'prepared', unit: 'count', configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
        materialRateEvidenceId: 'fixture-rate', materialRateHash: configurationHash, components: [], currency: 'IRT',
        calculationPolicyVersion: 'fixture-v1', roundingPolicyVersion: 'fixture-v1' }, description: 'سنگ آماده', configuration: [{ label: 'تعداد', value: '۲' }] } }) });
    const caseIds: string[] = [];
    for (let index = 41; index >= 0; index--) {
      const caseId = `${ids.caseId}-inbox-${String(index).padStart(2, '0')}`, caseIdsScoped = { ...ids, caseId };
      caseIds[index] = caseId;
      const saved = await service(tx, caseIdsScoped).execute(await command(caseIdsScoped));
      assert.ok(saved.ok && saved.value.case, JSON.stringify(saved));
      if (!saved.ok || !saved.value.case) return;
      const inquiryId = `${caseId}-pricing`;
      const payload = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const, caseId, inquiryId,
        expected: saved.value.case.owner, rows: [{ rowId: `${inquiryId}-row`,
          configuration: { recoveryId: `${caseId}-recovery`, recoveryRevision: 1, productRowId: `${caseId}-product-row` } }] };
      assert.ok((await inquiryService.execute({ ...payload, commandId: inquiryId, correlationId: inquiryId,
        idempotency: { actorId: ids.partnerId, operation: payload.type, targetId: caseId, key: inquiryId,
          payloadHash: await canonicalHash(payload) } })).ok);
    }
    const database = new Proxy(tx, { get(target, key) { if (key === '$transaction') return async (work: (value: Prisma.TransactionClient) => unknown) => work(tx); return Reflect.get(target, key); } }) as unknown as PrismaClient;
    // Explicit per-fixture read avoids unrelated manager-visible local inquiries.
    await tx.user.update({ where: { id: ids.responderId }, data: { role: 'USER' } });
    await tx.featurePermission.create({ data: { userId: ids.responderId, workspace: 'sales', feature: 'sales_partner_inquiries_view', permissionLevel: 'view' } });
    const resolveConfiguration = async () => ({ ok: true as const, value: { identity: { schemaVersion: 1 as const, partnerSellerId: ids.partnerId,
      catalogProductId: 'catalog-stone', family: 'prepared' as const, unit: 'count' as const, configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
      materialRateEvidenceId: 'fixture-rate', materialRateHash: configurationHash, components: [], currency: 'IRT' as const,
      calculationPolicyVersion: 'fixture-v1', roundingPolicyVersion: 'fixture-v1' }, description: 'سنگ آماده', configuration: [{ label: 'تعداد', value: '۲' }] } });
    const query = createPrismaPartnerWorkspaceQuery({ database, actorId: ids.responderId, correlationId: randomUUID(), authorize: allow, resolveConfiguration });
    const first = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending', limit: 50 });
    assert.ok(first.ok, JSON.stringify(first));
    if (!first.ok) return;
    assert.equal(new Set(first.value.contracts!.map(item => item.id)).size, 20);
    assert.equal(first.value.contractCounts?.pending, 42);
    assert.deepEqual(first.value.inquiries, [], 'list omits full product and response projections');
    assert.deepEqual(first.value.contracts!.map(item => item.id), [...caseIds].reverse().slice(0, 20), 'oldest outstanding request first, independent of identifiers');
    assert.ok(first.value.nextCursor);
    const next = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending', cursor: first.value.nextCursor });
    assert.ok(next.ok && next.value.contracts!.length === 20, JSON.stringify(next));
    if (!next.ok) return;
    const last = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending', cursor: next.value.nextCursor });
    assert.ok(last.ok && last.value.contracts!.length === 2 && !last.value.nextCursor, JSON.stringify(last));
    const contract = await tx.salesContract.findFirstOrThrow({ where: { partnerCaseId: caseIds[41] } });
    const searched = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending', search: contract.contractNumber });
    assert.ok(searched.ok && searched.value.contracts!.length === 1, JSON.stringify(searched));
    const blank = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'answered', search: contract.contractNumber });
    assert.ok(blank.ok && blank.value.contracts!.length === 0 && blank.value.contractCounts?.pending === 1, JSON.stringify(blank));
    const denied = createPrismaPartnerWorkspaceQuery({ database, actorId: ids.responderId, correlationId: randomUUID(),
      resolveConfiguration, authorize: async (_tx, request) => request.root.id === `${caseIds[41]}-pricing`
        ? { ok: false, error: { code: 'FORBIDDEN', status: 403, message: 'دسترسی مجاز نیست' } } : allow() });
    const deniedCounts = await denied.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending' });
    assert.ok(deniedCounts.ok && deniedCounts.value.contractCounts?.pending === 41, JSON.stringify(deniedCounts));
    const deniedSearch = await denied.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending', search: contract.contractNumber });
    assert.ok(deniedSearch.ok && deniedSearch.value.contractCounts?.pending === 0 && deniedSearch.value.contracts!.length === 0, JSON.stringify(deniedSearch));
    const foreign = createPrismaPartnerWorkspaceQuery({ database, actorId: ids.partnerId, correlationId: randomUUID(), authorize: allow, resolveConfiguration });
    const hidden = await foreign.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'pending' });
    assert.ok(!hidden.ok && hidden.error.code === 'FORBIDDEN', JSON.stringify(hidden));
    const responder = createPartnerInquiryService({ actorId: ids.responderId, transaction: work => work(tx), authorize: allow,
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: {} } }), resolveConfiguration });
    for (const index of [41, 40]) {
      const inquiryId = `${caseIds[index]}-pricing`;
      const payload = { schemaVersion: 1 as const, type: 'INQUIRY_DECIDE' as const, inquiryId, expectedAssignmentRevision: 1,
        decisions: [{ rowId: `${inquiryId}-row`, expectedRevision: 1, outcome: 'REJECTED' as const, reason: 'اصلاح مشخصات محصول' }] };
      assert.ok((await responder.execute({ ...payload, commandId: `${inquiryId}-answer`, correlationId: `${inquiryId}-answer`,
        idempotency: { actorId: ids.responderId, operation: payload.type, targetId: inquiryId, key: `${inquiryId}-answer`, payloadHash: await canonicalHash(payload) } })).ok);
    }
    const answered = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', view: 'answered', status: 'rejected' });
    assert.ok(answered.ok, JSON.stringify(answered));
    if (answered.ok) {
      assert.deepEqual(answered.value.contracts!.map(item => item.id), [caseIds[40], caseIds[41]], 'latest completed response first');
      assert.equal(answered.value.contractCounts?.answered, 2);
      assert.ok(answered.value.contracts!.every(item => item.answeredAt));
    }
    const direct = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE', contractId: caseIds[41], view: 'all' });
    assert.ok(direct.ok && direct.value.inquiries.length === 1 && direct.value.inquiries[0].caseId === caseIds[41], JSON.stringify(direct));
    if (direct.ok && answered.ok) {
      const detail = direct.value.inquiries[0];
      const summary = answered.value.contracts!.find(item => item.id === detail.caseId)!;
      assert.equal(summary.customer, detail.customerDisplayName);
      assert.equal(summary.partnerDisplayName, detail.partnerDisplayName);
      assert.equal(summary.currentRows, detail.rows.filter(row => !row.superseded).length);
      assert.equal(summary.answeredRows, detail.rows.filter(row => !row.superseded && ['APPROVED', 'REJECTED', 'EXPIRED'].includes(row.state)).length);
      assert.equal(summary.answeredAt, detail.rows[0].answeredAt);
    }
    const all = await query.query({ schemaVersion: 2, purpose: 'RESPONDER_WORKSPACE' });
    assert.ok(all.ok && all.value.contractCounts?.pending === 40 && all.value.contractCounts?.answered === 3, JSON.stringify(all));
    if (all.ok) assert.deepEqual(all.value.contracts!.map(item => item.id), [...caseIds].reverse().slice(2, 22));
  });
});


test('committed Partner edit creation context retains its owned technical recovery', async () => {
  const express = (await import('express')).default;
  const { createPartnerCaseRouter } = await import('../../routes/partner-cases');
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const draftId = `recovery-${randomUUID()}`;
    const [databaseClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await tx.salesContractEditSession.create({ data: { ownerUserId: ids.partnerId,
      purpose: 'PARTNER_TECHNICAL', schemaVersion: 1, contractId: final.root.customerContractId, draftId,
      baseRevision: 0, browserSessionId: randomUUID(), leaseToken: randomUUID(),
      recovery: { kind: 'partner-technical-recovery', version: 1, recoveryRevision: 1, updatedAt: databaseClock.now.getTime(),
        partnerCaseId: ids.caseId, draft: { schemaVersion: 1, inputRevision: 1, rows: [] }, validatedSnapshots: [] } } });
    const app = express();
    const database = { $transaction: (work: (client: Prisma.TransactionClient) => unknown) => work(tx) };
    app.use('/cases', createPartnerCaseRouter({ database: database as never, authenticate: (req, _res, next) => {
      (req as { user?: { id: string } }).user = { id: ids.partnerId }; next();
    } }));
    const server = app.listen(0); await new Promise<void>(resolve => server.once('listening', resolve));
    try {
      const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing address');
      const response = await fetch(`http://127.0.0.1:${address.port}/cases/creation-context?caseId=${ids.caseId}`);
      const body = await response.json() as { data?: { recoverableDraft?: { recoveryId: string; caseId: string } } };
      assert.equal(response.status, 200, JSON.stringify(body));
      assert.equal(body.data?.recoverableDraft?.recoveryId, draftId);
      assert.equal(body.data?.recoverableDraft?.caseId, ids.caseId);
    } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
  });
});

test('opening and returning an unchanged Partner correction preserves finality approvals revision and debt', async () => {
  const { readPartnerCommercialState } = await import('../partnerSales/cases/commercialLifecycle');
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const before = await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } });
    const request = await approvePartnerEdit(tx, { contractId: before.id, actorUserId: ids.responderId,
      reason: 'بررسی قرارداد بدون تغییر', requestKey: randomUUID(), now: new Date() });
    assert.equal((await readPartnerCommercialState(tx, ids.caseId))?.status, 'FINAL');
    const unchanged = await reviseCommand(ids, final.input, final.owner.revision, final.owner.integrityHash, 'unchanged-return', 'COMMITTED');
    unchanged.intent = { ...final.input.intent, recoveryRevision: unchanged.intent.recoveryRevision, rows: unchanged.intent.rows };
    unchanged.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: unchanged.type, intent: unchanged.intent });
    const returned = await service(tx, ids).execute(unchanged);
    assert.ok(returned.ok && returned.value.case, JSON.stringify(returned));
    assert.equal(returned.ok && returned.value.case?.owner.revision, final.owner.revision);
    const after = await tx.salesContract.findUniqueOrThrow({ where: { id: before.id } });
    assert.equal(after.status, 'SIGNED');
    assert.equal(after.commercialRevision, before.commercialRevision);
    assert.equal(after.salesApprovalRevision, before.salesApprovalRevision);
    assert.equal(after.customerAcceptanceRevision, before.customerAcceptanceRevision);
    assert.equal(after.signedAt?.getTime(), before.signedAt?.getTime());
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).integrityHash, final.owner.integrityHash);
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 0);
    assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'RESOLVED');
    assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceId: request.id, sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION' } }), 0);
    const replay = await service(tx, ids).execute(unchanged);
    assert.ok(replay.ok && replay.value.replayed);
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('edited Partner note changes effective commitment only at renewed finality, once, without a second accounting approval', async () => {
  const { approvePartnerCommercialSales, acceptPartnerCustomer, reconcilePartnerCommercialFinality } = await import('../partnerSales/cases/commercialLifecycle');
  const { readPersistedPartnerEvents } = await import('../partnerSales/events/persisted');
  const { caseHistory } = await import('../partnerSales/reporting/history');
  const runtime = await import('@sabalanerp/partner-sales-contracts');
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const request = await approvePartnerEdit(tx, { contractId: final.root.customerContractId!, actorUserId: ids.responderId,
      reason: 'اصلاح قرارداد و قیمت خرید', requestKey: randomUUID(), now: new Date() });
    const { readCurrentPartnerCaseViews } = await import('../partnerSales/cases/lifecycle');
    const { capturePartnerContractedQuantities } = await import('../partnerSales/fulfillment/quantityStore');
    const previous = await readCurrentPartnerCaseViews(tx, ids.caseId);
    assert.ok(previous);
    const physical = runtime.FulfillmentViewSchema.parse((previous.row.head.internalProjection as Prisma.JsonObject).fulfillment);
    for (const product of physical.products) await tx.partnerFulfillmentLineage.create({ data: {
      id: `${ids.caseId}-lineage`, caseId: ids.caseId, caseRevision: physical.owner.revision,
      integrityHash: physical.owner.integrityHash, internalRecordId: physical.recordId,
      productRowId: product.productRowId, quantity: product.quantity, unit: product.unit,
      recipient: { customerId: ids.customerId, displayName: 'مشتری تست', phone: '09120000000', destination: 'مقصد تست' },
      deliveryIds: physical.deliveries.map(delivery => delivery.deliveryId), commandId: `${ids.caseId}-lineage-command`,
    } });
    await capturePartnerContractedQuantities(tx, physical);
    const { shipmentQuantityEvidenceIntegrityHash } = await import('../shipmentQuantityProjectionStore');
    const reservedAt = new Date();
    const reservation = { id: `${ids.caseId}-reservation`, sourceKind: 'PARTNER_CASE' as const, contractId: null, contractItemId: null,
      partnerCaseId: ids.caseId, partnerLineageId: `${ids.caseId}-lineage`, partnerCaseRevision: physical.owner.revision,
      partnerIntegrityHash: physical.owner.integrityHash, productRowId: physical.products[0].productRowId, unit: physical.products[0].unit,
      kind: 'ALLOCATION_FINALIZED' as const, quantity: '2.000', effectiveAt: reservedAt.toISOString(), recordedAt: reservedAt.toISOString(),
      sourceType: 'PARTNER_TEST_RESERVATION', sourceId: `${ids.caseId}-reservation`, sourceVersion: 1, integrityHash: '', metadata: {} };
    await tx.shipmentQuantityEvidence.create({ data: { ...reservation, integrityHash: shipmentQuantityEvidenceIntegrityHash(reservation),
      effectiveAt: reservedAt, recordedAt: reservedAt } });
    const cancellation = createPartnerCaseLifecycleService({ actorId: ids.partnerId, cancellationPurpose: 'PARTNER',
      transaction: work => work(tx), authorize: async () => ({ ok: true, value: { evidenceId: 'reserved-cancel' } }),
      verifyOutputEvidence: async () => ({ ok: false, error: { code: 'STATE_CONFLICT', status: 409, message: 'unused' } }),
      cancelConfirmationSessions: async () => ({ ok: true, value: { invalidatedSessionIds: [], preservedSnapshotIds: [] } }),
      recordEvidenceReview: async () => undefined });
    const cancelReason = 'لغو با رزرو تعیین تکلیف نشده';
    const cancelled = await cancellation.execute({ schemaVersion: 1, type: 'CASE_CANCEL', commandId: randomUUID(), correlationId: randomUUID(),
      expected: final.owner, expectedState: 'COMMITTED', reason: cancelReason,
      idempotency: { actorId: ids.partnerId, operation: 'CASE_CANCEL', targetId: ids.caseId, key: randomUUID(),
        payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_CANCEL', reason: cancelReason }) } });
    assert.equal(cancelled.ok ? null : cancelled.error.code, 'DEPENDENCY_BLOCKED',
      'cancellation cannot leave finalized stock reservation active');
    const reduced = await reviseCommand(ids, final.input, final.owner.revision, final.owner.integrityHash, 'below-reservation', 'COMMITTED');
    const baseGraph = graphFor(physical.products[0].productRowId);
    const reducedGraph = parseCanonicalProductGraph({ ...baseGraph, rows: baseGraph.rows.map(row => ({ ...row,
      commercial: { requestedQuantity: '1', totalAmountToman: '100',
        calculationSnapshot: { kind: 'readyPiece', unit: 'count', quantity: '1' } } })) });
    const reducedHash = await canonicalHash({ purpose: 'PARTNER_CASE_GRAPH', schemaVersion: 1, graph: reducedGraph });
    reduced.intent.graphHash = reducedHash;
    reduced.intent.deliveries[0].items[0].quantity = '1';
    reduced.intent.customerPaymentPlan.installments[0].amount.amount = '150';
    reduced.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: reduced.type, intent: reduced.intent });
    const blocked = await service(tx, ids, undefined, undefined, undefined, draft => ({ ...draft, graph: reducedGraph,
      rows: draft.rows.map(row => ({ ...row, quantity: '1' })),
      technicalSnapshot: { ...draft.technicalSnapshot, graphHash: reducedHash,
        rows: draft.technicalSnapshot.rows.map(row => ({ ...row, quantity: '1' })) },
      sabalanPaymentPlan: { ...draft.sabalanPaymentPlan, installments: draft.sabalanPaymentPlan.installments.map(item => ({
        ...item, amount: { ...item.amount, amount: '100' } })) },
    })).execute(reduced);
    assert.equal(blocked.ok ? null : blocked.error.code, 'DEPENDENCY_BLOCKED', 'commercial editing cannot reduce already reserved stock');
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, final.owner.revision);
    assert.equal(await tx.shipmentQuantityEvidence.count({ where: { partnerCaseId: ids.caseId } }), 2);
    const binding = await createApprovedInquiryForCase(tx, ids, ids.caseId, '75');
    const changed = await reviseCommand(ids, final.input, final.owner.revision, final.owner.integrityHash, 'revised-finality', 'COMMITTED');
    changed.intent.rows[0].approvedRowBinding = binding;
    changed.idempotency.payloadHash = await canonicalHash({ schemaVersion: 1, type: changed.type, intent: changed.intent });
    const saved = await service(tx, ids, undefined, undefined, undefined, draft => ({ ...draft,
      rows: draft.rows.map(row => ({ ...row, wholesaleUnitPriceAmount: '75' })),
      sabalanPaymentPlan: { ...draft.sabalanPaymentPlan, installments: draft.sabalanPaymentPlan.installments.map(item => ({
        ...item, amount: { ...item.amount, amount: '150' } })) },
    })).execute(changed);
    assert.ok(saved.ok && saved.value.case, JSON.stringify(saved));
    const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } });
    assert.equal(contract.status, 'DRAFT');
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 0);
    await approvePartnerCommercialSales(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: contract.commercialRevision });
    assert.equal(await tx.partnerFinancialAdjustment.count({ where: { caseId: ids.caseId } }), 0);
    await acceptPartnerCustomer(tx, { caseId: ids.caseId, actorId: ids.partnerId, revision: contract.commercialRevision, method: 'DIGITAL' });
    await reconcilePartnerCommercialFinality(tx, ids.caseId, ids.partnerId);
    const adjustments = await tx.partnerFinancialAdjustment.findMany({ where: { caseId: ids.caseId } });
    assert.equal(adjustments.length, 1);
    assert.equal(adjustments[0].delta.toString(), '-50');
    const rows = await tx.partnerCaseEvent.findMany({ where: { caseId: ids.caseId }, orderBy: { sequence: 'asc' } });
    const events = readPersistedPartnerEvents({ id: ids.caseId, internalRecordId: final.root.internalRecordId! }, rows);
    const history = caseHistory(runtime, events);
    assert.equal(history.effective?.revision, saved.ok && saved.value.case?.owner.revision);
    assert.equal(history.corrections.length, 1);
    assert.equal(await tx.shipmentQuantityEvidence.count({ where: { partnerCaseId: ids.caseId,
      partnerCaseRevision: saved.ok && saved.value.case ? saved.value.case.owner.revision : -1, kind: 'CONTRACTED_SET' } }), 1,
      'renewed finality publishes the current physical obligation without deleting the previous baseline');
    assert.equal((await tx.accountingCorrectionRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'RESOLVED');
    assert.equal(await tx.crossWorkspaceDuty.count({ where: { sourceId: request.id, sourceActionCode: 'ACCOUNTING_VERIFY_CONTRACT_CORRECTION' } }), 0);
    await tx.$executeRawUnsafe('SET CONSTRAINTS ALL IMMEDIATE');
  });
});

test('approved committed Partner correction acquires reads and checkpoints its retained technical recovery without changing finality', async () => {
  const { createPartnerTechnicalRequestServices } = await import('../../routes/partner-technical');
  const { PARTNER_TECHNICAL_RECOVERY_KIND } = await import('../contractRecoveryProtection');
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const staleTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await tx.salesContractEditSession.create({ data: { draftId: ids.caseId, contractId: final.root.customerContractId,
      ownerUserId: ids.partnerId, browserSessionId: 'old-browser', leaseToken: randomUUID(), schemaVersion: 1,
      baseRevision: 0, purpose: 'PARTNER_TECHNICAL', updatedAt: staleTime, recovery: {
        kind: PARTNER_TECHNICAL_RECOVERY_KIND, version: 1, recoveryRevision: 1, updatedAt: staleTime.getTime(),
        partnerCaseId: ids.caseId, draft: { schemaVersion: 1, inputRevision: 1, rows: [] } } } });
    const ports = createPartnerTechnicalRequestServices({ database: { $transaction: async (run: any) => run(tx) } as any,
      actorId: ids.partnerId, correlationId: randomUUID() });
    const input = { schemaVersion: 1 as const, recoveryId: ids.caseId, browserSessionId: 'new-browser', baseRevision: 0, takeover: false };
    assert.equal((await ports.lease.acquire(input)).ok, false, 'finality alone never authorizes technical editing');
    const request = await approvePartnerEdit(tx, { contractId: final.root.customerContractId!, actorUserId: ids.responderId,
      reason: 'مجوز اصلاح پیش‌نویس فنی قرارداد قطعی', requestKey: randomUUID(), now: new Date() });
    const { readPartnerCommercialEditPermission } = await import('../partnerSales/cases/commercialEditPermission');
    const reviewedPermission = await readPartnerCommercialEditPermission(tx, final.root.customerContractId!, ids.partnerId);
    assert.equal(reviewedPermission?.sourceId, request.id);
    assert.equal(reviewedPermission?.accountantNote, 'مجوز اصلاح پیش‌نویس فنی قرارداد قطعی');
    const lease = await ports.lease.acquire(input);
    assert.ok(lease.ok, JSON.stringify(lease));
    if (!lease.ok) return;
    const access = { schemaVersion: 1 as const, recoveryId: lease.value.recoveryId, browserSessionId: lease.value.browserSessionId,
      leaseToken: lease.value.leaseToken, baseRevision: lease.value.baseRevision };
    const loaded = await ports.recovery.read(access);
    assert.ok(loaded.ok, JSON.stringify(loaded));
    const otherBrowser = await ports.lease.acquire({ ...input, browserSessionId: 'other-browser' });
    assert.equal(otherBrowser.ok, false, 'a real active writer must remain protected');
    assert.equal(otherBrowser.ok ? null : otherBrowser.error.code, 'EDIT_SESSION_OWNED_ELSEWHERE');
    const checkpoint = await ports.recovery.checkpoint({ ...access, expectedRecoveryRevision: 1,
      idempotencyKey: randomUUID(), draft: { schemaVersion: 1, inputRevision: 2, rows: [] } });
    assert.ok(checkpoint.ok, JSON.stringify(checkpoint));
    const contract = await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } });
    assert.equal(contract.status, 'SIGNED', 'opening or checkpointing technical recovery is not a commercial change');
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, final.owner.revision);
    const duty = await tx.crossWorkspaceDuty.findFirstOrThrow({ where: { sourceId: request.id, sourceActionCode: 'SALES_EDIT_CONTRACT_CORRECTION', status: 'OPEN' } });
    await tx.crossWorkspaceDuty.update({ where: { id: duty.id }, data: { dueAt: new Date(Date.now() - 1000) } });
    assert.equal((await ports.lease.acquire({ ...input, takeover: true })).ok, false, 'takeover cannot bypass expired manager permission');
    assert.equal((await ports.recovery.read(access)).ok, false, 'an existing lease cannot bypass expired permission');
  });
});


test('approved finalized Partner correction can request a successor price while retaining finality until commercial save', async () => {
  await fixture(async (tx, ids) => {
    const final = await finalCommercialFixture(tx, ids);
    const inquiries = createPartnerInquiryService({ actorId: ids.partnerId, transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: 'fixture' } }),
      resolveInitialResponder: async () => ({ ok: true, value: { responderId: ids.responderId, eligibilityEvidence: {} } }),
      resolveConfiguration: async () => ({ ok: true, value: { identity: {
        schemaVersion: 1, partnerSellerId: ids.partnerId, catalogProductId: 'catalog-stone', family: 'prepared', unit: 'count',
        configuration: [{ key: 'technicalConfigurationHash', value: configurationHash }],
        materialRateEvidenceId: 'fixture-rate', materialRateHash: configurationHash, components: [], currency: 'IRT',
        calculationPolicyVersion: 'fixture-v1', roundingPolicyVersion: 'fixture-v1',
      }, description: 'سنگ آماده', configuration: [{ label: 'تعداد', value: '۲' }] } }),
    });
    const payload = { schemaVersion: 1 as const, type: 'CASE_PRICING_SUBMIT' as const, caseId: ids.caseId,
      inquiryId: `${ids.caseId}-correction-pricing`, expected: final.owner,
      rows: [{ rowId: `${ids.caseId}-successor`, configuration: { recoveryId: `${ids.caseId}-recovery`,
        recoveryRevision: 2, productRowId: `${ids.caseId}-product-row` },
        predecessor: { rowId: ids.inquiryRowId, revision: 2, reason: 'کاهش قیمت' } }] };
    const command = { ...payload, commandId: randomUUID(), correlationId: randomUUID(),
      idempotency: { actorId: ids.partnerId, operation: payload.type, targetId: ids.caseId,
        key: randomUUID(), payloadHash: await canonicalHash(payload) } };
    assert.equal((await inquiries.execute(command)).ok, false, 'finalized inquiry needs reviewed permission');
    await approvePartnerEdit(tx, { contractId: final.root.customerContractId!, actorUserId: ids.responderId,
      reason: 'بررسی قیمت', requestKey: randomUUID(), now: new Date() });
    const submitted = await inquiries.execute(command);
    assert.ok(submitted.ok, JSON.stringify(submitted));
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: payload.rows[0].rowId } })).outcome, 'PENDING');
    assert.equal((await tx.partnerInquiryRow.findUniqueOrThrow({ where: { id: ids.inquiryRowId } })).outcome, 'APPROVED');
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).state, 'COMMITTED');
    assert.equal((await tx.salesContract.findUniqueOrThrow({ where: { id: final.root.customerContractId! } })).status, 'SIGNED');
    assert.ok((await inquiries.execute(command)).ok, 'same request replays');
  }, 48 * 60 * 60 * 1000, true);
});
