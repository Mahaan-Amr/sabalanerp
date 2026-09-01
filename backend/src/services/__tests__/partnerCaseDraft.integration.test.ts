import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { PrismaClient, type Prisma } from '@prisma/client';
import { parseCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { canonicalHash, type PartnerCommand } from '@sabalanerp/partner-sales-contracts';
import { createPartnerCaseService, type PartnerCaseDependencies } from '../partnerSales/cases/aggregate';
import { validateResolvedDraft, type ResolvedCaseDraft } from '../partnerSales/cases/revisions';

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
  approvalTtlMs = 48 * 60 * 60 * 1000) {
  const database = new PrismaClient({ datasources: { db: { url: databaseUrl() } } });
  const rollback = new Error('rollback partner Case fixture');
  try {
    await database.$transaction(async tx => {
      const prefix = `partner-case-${randomUUID()}`;
      const ids = { partnerId: `${prefix}-partner`, responderId: `${prefix}-responder`, departmentId: `${prefix}-department`,
        customerId: `${prefix}-customer`, secondCustomerId: `${prefix}-customer-2`,
        firstProjectId: `${prefix}-project-1`, secondProjectId: `${prefix}-project-2`,
        profileId: `${prefix}-profile`, accountId: `${prefix}-account`,
        inquiryId: `${prefix}-inquiry`, inquiryRowId: `${prefix}-inquiry-row`, assignmentId: `${prefix}-assignment`,
        approvalId: `${prefix}-approval`, caseId: `${prefix}-case` };
      await tx.user.createMany({ data: [
        { id: ids.partnerId, username: ids.partnerId, email: `${ids.partnerId}@example.invalid`, password: 'not-a-login',
          firstName: 'Partner', lastName: 'Case' },
        { id: ids.responderId, username: ids.responderId, email: `${ids.responderId}@example.invalid`, password: 'not-a-login',
          firstName: 'Responder', lastName: 'Case', role: 'ADMIN' },
      ] });
      await tx.department.create({ data: { id: ids.departmentId, name: ids.departmentId, namePersian: 'فروش تستی' } });
      await tx.partnerProfile.create({ data: { id: ids.profileId, userId: ids.partnerId, state: 'ACTIVE' } });
      await tx.partnerCommercialAccount.create({ data: { id: ids.accountId, profileId: ids.profileId } });
      await tx.partnerReleaseCohort.create({ data: { id: ids.profileId, name: ids.profileId,
        activationEnabled: true, enrollmentPaused: false, operationalPaused: false } });
      await tx.partnerCohortMembership.create({ data: { id: ids.profileId, profileId: ids.profileId,
        cohortId: ids.profileId, actorId: ids.responderId, eligibilityEvidence: { fixture: true } } });
      await tx.crmCustomer.create({ data: { id: ids.customerId, firstName: 'Customer', lastName: 'Case',
        ownerUserId: ids.partnerId, createdBy: ids.partnerId } });
      await tx.crmCustomer.create({ data: { id: ids.secondCustomerId, firstName: 'Customer', lastName: 'Revised',
        ownerUserId: ids.partnerId, createdBy: ids.partnerId } });
      await tx.crmPotentialProject.createMany({ data: [
        { id: ids.firstProjectId, customerId: ids.customerId, responsibleSellerId: ids.partnerId,
          createdBy: ids.partnerId, title: 'پروژه نخست', workType: 'سنگ' },
        { id: ids.secondProjectId, customerId: ids.secondCustomerId, responsibleSellerId: ids.partnerId,
          createdBy: ids.partnerId, title: 'پروژه دوم', workType: 'سنگ' },
      ] });
      await tx.partnerInquiry.create({ data: { id: ids.inquiryId, profileId: ids.profileId, revision: 2, submittedAt: new Date() } });
      await tx.partnerInquiryAssignment.create({ data: { id: ids.assignmentId, inquiryId: ids.inquiryId, revision: 1,
        responderId: ids.responderId, actorId: ids.responderId, reason: 'انتساب تست پرونده', eligibilityEvidence: { fixture: true } } });
      await tx.partnerInquiryRow.create({ data: { id: ids.inquiryRowId, inquiryId: ids.inquiryId, version: 1,
        revision: 2, outcome: 'APPROVED', configurationHash, definition: { fixture: true } } });
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
      approvedRowBinding: { inquiryId: ids.inquiryId, rowId: ids.inquiryRowId, revision: 2 },
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
      precisionPolicyVersion: 'canonical-count-v1', description: 'سنگ آماده پرونده' }],
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
    ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } })) {
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
    resolveDraft: async (_tx, input) => ({ ok: true, value: await resolved(ids, input.command.idempotency.targetId,
      input.command.type === 'CASE_DRAFT_REVISE' ? input.command.expected.revision + 1 : 1,
      input.command.intent.customerId, input.command.intent.projectId) }),
    consumeRecovery: async () => ({ ok: true, value: undefined }), failpoint });
}

test('final submit atomically creates the exact pair, binds reusable approval and replays one Case', async () => {
  await fixture(async (tx, ids) => {
    const input = await command(ids);
    const first = await service(tx, ids).execute(input);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.replayed, false);
    assert.equal(first.value.case?.products[0].wholesaleUnitPrice, '100');
    assert.equal(first.value.case?.products[0].retailUnitPrice, '150');
    assert.equal(await tx.partnerSaleCase.count({ where: { id: ids.caseId } }), 1);
    assert.equal(await tx.sabalanToPartnerSaleRecord.count({ where: { caseId: ids.caseId } }), 1);
    assert.equal(await tx.salesContract.count({ where: { partnerCaseId: ids.caseId, partnerKind: 'PARTNER_CUSTOMER' } }), 1);
    assert.equal(await tx.partnerCommercialNumber.count({ where: { caseId: ids.caseId } }), 3);
    assert.equal(await tx.partnerInquiryUsage.count({ where: { caseId: ids.caseId } }), 1);
    const replay = await service(tx, ids).execute(input);
    assert.equal(replay.ok, true);
    if (replay.ok) { assert.equal(replay.value.replayed, true); assert.equal(replay.value.case?.owner.integrityHash, first.value.case?.owner.integrityHash); }
    const secondCaseId = `${ids.caseId}-second`;
    const second = await service(tx, ids).execute(await command(ids, secondCaseId, 'second'));
    assert.equal(second.ok, true, 'one approval remains reusable across independent valid intents');
    assert.equal(await tx.partnerInquiryUsage.count({ where: { approvalId: ids.approvalId } }), 2);
  });
});

async function reviseCommand(ids: Record<string, string>, submitted: Extract<PartnerCommand, { type: 'CASE_SUBMIT' }>,
  revision: number, integrityHash: string, suffix = 'revise'): Promise<Extract<PartnerCommand, { type: 'CASE_DRAFT_REVISE' }>> {
  const caseId = submitted.idempotency.targetId;
  const productRowId = `${caseId}-product-row`;
  const intent = { ...submitted.intent, recoveryRevision: revision + 1,
    rows: [{ ...submitted.intent.rows[0], retailUnitPrice: { amount: '160', currency: 'IRT' as const } }],
    customerPaymentPlan: { planId: `${caseId}-retail-plan-${revision + 1}`, version: revision + 1,
      predecessorPlanId: `${caseId}-retail-plan`, effectiveDate: '2026-08-29', installments: [{
        installmentId: `${caseId}-retail-installment-${revision + 1}`, dueDate: '2026-08-30',
        amount: { amount: '320', currency: 'IRT' as const }, method: 'CASH' as const }] },
    deliveries: [{ deliveryId: `${caseId}-delivery-${revision + 1}`, date: '2026-09-01', destination: 'تهران، مقصد بازنگری',
      items: [{ productRowId, quantity: '2' }] }],
  };
  return { schemaVersion: 1, type: 'CASE_DRAFT_REVISE', commandId: `${caseId}-command-${suffix}`,
    correlationId: `${caseId}-correlation-${suffix}`, expected: { caseId, revision, integrityHash }, expectedState: 'DRAFT',
    intent, idempotency: { actorId: ids.partnerId, operation: 'CASE_DRAFT_REVISE', targetId: caseId,
      key: `${caseId}-key-${suffix}`, payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } };
}

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
    assert.equal(revised.value.case.products[0].retailUnitPrice, '160');
    const root = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId }, select: {
      headRevision: true, integrityHash: true, internalRecord: { select: { expectedRevision: true } },
      customerContract: { select: { partnerRevision: true, partnerIntegrityHash: true } },
    } });
    assert.equal(root.headRevision, 2);
    assert.equal(root.internalRecord.expectedRevision, 2);
    assert.equal(root.customerContract.partnerRevision, 2);
    assert.equal(root.customerContract.partnerIntegrityHash, root.integrityHash);
    assert.equal(await tx.partnerCaseRevision.count({ where: { caseId: ids.caseId } }), 2);
    assert.equal(await tx.partnerInquiryUsage.count({ where: { caseId: ids.caseId } }), 2);
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
    await tx.$queryRaw`SELECT pg_sleep(0.15)::text AS slept`;
    const revised = await service(tx, ids).execute(await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'after-expiry'));
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
    assert.equal(root.customerContract.customerId, ids.secondCustomerId);
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
    assert.equal((await service(tx, ids).execute(other)).ok, true);

    const base = await command(ids);
    const initialIntent = { ...base.intent, projectId: ids.firstProjectId };
    const submitted = { ...base, intent: initialIntent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent: initialIntent }) } };
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    const draft = await reviseCommand(ids, submitted, 1, created.value.case.owner.integrityHash, 'steal-project');
    const intent = { ...draft.intent, customerId: ids.secondCustomerId, projectId: ids.secondProjectId };
    const attempted = { ...draft, intent, idempotency: { ...draft.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_DRAFT_REVISE', intent }) } };
    const rejected = await service(tx, ids).execute(attempted);
    assert.equal(rejected.ok ? null : rejected.error.code, 'ROW_STALE');
    const target = await tx.crmPotentialProject.findUniqueOrThrow({ where: { id: ids.secondProjectId } });
    assert.equal(target.wonSalesContractId,
      (await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: otherCaseId } })).customerContractId);
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 1);
  });
});

test('an unchanged Project binding must still belong to the exact current customer contract', async () => {
  await fixture(async (tx, ids) => {
    const base = await command(ids);
    const intent = { ...base.intent, projectId: ids.firstProjectId };
    const submitted = { ...base, intent, idempotency: { ...base.idempotency,
      payloadHash: await canonicalHash({ schemaVersion: 1, type: 'CASE_SUBMIT', intent }) } };
    const created = await service(tx, ids).execute(submitted);
    assert.equal(created.ok, true);
    if (!created.ok || !created.value.case) return;
    await tx.crmPotentialProject.update({ where: { id: ids.firstProjectId }, data: { wonSalesContractId: null } });
    const revised = await service(tx, ids).execute(await reviseCommand(ids, submitted, 1,
      created.value.case.owner.integrityHash, 'missing-project-binding'));
    assert.equal(revised.ok ? null : revised.error.code, 'ROW_STALE');
    assert.equal((await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: ids.caseId } })).headRevision, 1);
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
    const inconsistentPayment = createPartnerCaseService({ actorId: ids.partnerId, transaction: work => work(tx),
      authorize: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-authorization` } }),
      authorizeProject: async () => ({ ok: true, value: { evidenceId: `${ids.caseId}-project-authorization` } }),
      recordEvidenceReview: async (_tx, review) => { reviews.push(review); },
      resolveDraft: async () => {
        const value = await resolved(ids, ids.caseId);
        return { ok: true, value: { ...value, sabalanPaymentPlan: { ...value.sabalanPaymentPlan,
          installments: value.sabalanPaymentPlan.installments.map(item => ({ ...item,
            amount: { ...item.amount, amount: '201' } })) } } } as const;
      }, consumeRecovery: async () => ({ ok: true, value: undefined }) });
    const paymentMismatch = await inconsistentPayment.execute(valid);
    assert.equal(paymentMismatch.ok ? null : paymentMismatch.error.code, 'INTEGRITY_CONFLICT');
    assert.deepEqual(reviews.map(review => review.code), ['CONFIG_MISMATCH', 'INTEGRITY_CONFLICT']);
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
