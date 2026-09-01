import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient, type Prisma } from '@prisma/client';
import { canonicalHash, partnerError, type PartnerCommand, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFixtures } from '@sabalanerp/partner-sales-contracts/testing';
import { createPartnerCaseLifecycleService, type PartnerCaseLifecycleDependencies } from '../partnerSales/cases/lifecycle';
import { createPartnerLifecycleDatabase } from './partnerCaseLifecycleDatabase';

function databaseUrl() {
  const url = new URL(process.env.CONTRACT_RECOVERY_TEST_DATABASE_URL ?? '');
  if (url.hostname !== '127.0.0.1' || url.port !== '55432' || url.pathname !== '/sabalanerp') throw new Error('Existing local DB required');
  url.searchParams.set('connection_limit', '2'); url.searchParams.set('pool_timeout', '10'); return url.toString();
}

type Ids = ReturnType<typeof idsFor>;
const hash = `sha256-v1:${'a'.repeat(64)}`;
const idsFor = (prefix: string) => ({ caseId: `${prefix}-case`, partnerId: `${prefix}-partner`, profileId: `${prefix}-profile`,
  customerId: `${prefix}-customer`, departmentId: `${prefix}-department`, accountId: `${prefix}-account`,
  internalId: `${prefix}-internal`, contractId: `${prefix}-contract`, rowId: `${prefix}-row`, cohortId: `${prefix}-cohort` });

async function seedCase(tx: Prisma.TransactionClient, ids: Ids, tamperAccounting = false) {
  const base = createPartnerFixtures();
  const deliveries = base.customer.deliveries.map(delivery => ({ ...delivery,
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
  const revisionEvidence = { purpose: 'PARTNER_CASE_REVISION', schemaVersion: 1, graphHash: hash,
    graph: {}, partySnapshots, wholesaleEnvelope, retailEnvelope, paymentEvidence,
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
  await tx.partnerCohortMembership.create({ data: { id: `${ids.cohortId}-membership`, profileId: ids.profileId,
    cohortId: ids.cohortId, actorId: ids.partnerId, eligibilityEvidence: { fixture: true } } });
  await tx.crmCustomer.create({ data: { id: ids.customerId, firstName: 'Customer', lastName: 'Lifecycle',
    ownerUserId: ids.partnerId, createdBy: ids.partnerId } });
  await tx.partnerSaleCase.create({ data: { id: ids.caseId, caseNumber: partner.caseNumber, profileId: ids.profileId,
    customerId: ids.customerId, internalRecordId: ids.internalId, customerContractId: ids.contractId,
    headRevision: 1, integrityHash } });
  await tx.partnerCaseRevision.create({ data: { caseId: ids.caseId, revision: 1, integrityHash, graphHash: hash,
    graph: {}, partySnapshots, wholesaleEnvelope, retailEnvelope, paymentEvidence, customerContent: revisionCustomerContent,
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
  await tx.partnerReleaseCohort.update({ where: { id: ids.cohortId }, data: { operationalPaused: true } });
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

test('concurrent SIGNED and PRINTED writers on independent clients create one commitment', async () => {
  const sourceDatabaseUrl = databaseUrl();
  const temporary = await createPartnerLifecycleDatabase({ repositoryRoot: path.resolve(process.cwd(), '..'),
    sourceDatabaseUrl });
  const setup = temporary.client(), first = temporary.client(), second = temporary.client();
  const ids = idsFor(`partner-lifecycle-race-${temporary.runId}`);
  try {
    const owner = await setup.$transaction(tx => seedCase(tx, ids));
    const serviceFor = (database: PrismaClient) => createPartnerCaseLifecycleService({
      ...dependencies({} as Prisma.TransactionClient, ids), transaction: work => database.$transaction(work),
    });
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
    const pauseSetup = createPartnerCaseLifecycleService({ ...dependencies({} as Prisma.TransactionClient, pauseIds),
      transaction: work => setup.$transaction(work) });
    await pauseSetup.markAwaitingCustomerConfirmation({ expected: pauseOwner, commandId: `${pauseIds.caseId}-send`,
      correlationId: `${pauseIds.caseId}-send`, snapshotId: `${pauseIds.caseId}-snapshot` });
    await pauseSetup.markCustomerApproved({ expected: pauseOwner, commandId: `${pauseIds.caseId}-approve`,
      correlationId: `${pauseIds.caseId}-approve`, snapshotId: `${pauseIds.caseId}-snapshot`,
      verifiedAt: '2026-08-30T07:30:00.000Z' });
    const [pauseCommit] = await Promise.all([
      createPartnerCaseLifecycleService({ ...dependencies({} as Prisma.TransactionClient, pauseIds),
        transaction: work => first.$transaction(work) }).execute(await commitCommand(pauseIds, pauseOwner, 'SIGNED')),
      second.partnerReleaseCohort.update({ where: { id: pauseIds.cohortId }, data: { operationalPaused: true } }),
    ]);
    assert.equal(pauseCommit.ok || pauseCommit.error.code === 'OPERATIONAL_PAUSE', true);
    const pauseRoot = await setup.partnerSaleCase.findUniqueOrThrow({ where: { id: pauseIds.caseId },
      include: { customerContract: true } });
    assert.equal(pauseRoot.state, pauseCommit.ok ? 'COMMITTED' : 'CUSTOMER_APPROVED');
    assert.equal(pauseRoot.customerContract.status, pauseCommit.ok ? 'SIGNED' : 'APPROVED');

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
