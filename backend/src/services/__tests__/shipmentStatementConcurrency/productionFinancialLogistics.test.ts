import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { GuardDriverQueueTurnStatus, Prisma, PrismaClient } from '@prisma/client';
import { executeAccountingAction, type AccountingActionNotificationHook } from '../../accountingService';
import { type DispatchArtifactStorage } from '../../dispatchDocuments';
import { allocationPricingIntegrityVerifier, PrismaDispatchDocumentSourceReader } from '../../dispatchDocuments/prismaSourceReader';
import { PrismaDispatchDocumentRepository } from '../../dispatchDocuments/prismaRepository';
import { finalizeCanonicalLoadingAllocations } from '../../dispatchAllocation';
import { createAuthorizedActorFixture } from './authorityFixture';
import { createProductionApprovedPricingFixture } from './productionApprovedPricingFixture';

assert.match(process.env.DATABASE_URL || '', /\/sabalanerp_concurrency_[a-f0-9]{16}(?:\?|$)/,
  'Financial/Logistics proof may run only in an issue260 temporary database.');

const observer = new PrismaClient();
const logistics = new PrismaClient();
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {};
const json = (value: unknown) => value as Prisma.InputJsonValue;
const invoiceNumber = () => `260${Date.now()}${Math.floor(Math.random() * 10_000)}`;

const coordinatedApproval = async <T>(command: Parameters<typeof executeAccountingAction>[0], actor: { userId: string; role: string },
  competingWork: () => Promise<T>) => {
  let sealed!: () => void;
  const sealReached = new Promise<void>(resolve => { sealed = resolve; });
  let release!: () => void;
  const mayCommit = new Promise<void>(resolve => { release = resolve; });
  const hook: AccountingActionNotificationHook = async () => { sealed(); await mayCommit; };
  const approval = executeAccountingAction(command, actor, hook);
  await sealReached;
  const competitor = competingWork();
  await new Promise(resolve => setTimeout(resolve, 100));
  release();
  const [approvalResult, competitorResult] = await Promise.allSettled([approval, competitor]);
  return [approvalResult, competitorResult] as const;
};

const run = async () => {
  const proofStartedAt = performance.now();
  const fixture = await createProductionApprovedPricingFixture(observer, {
    runId: process.env.ISSUE260_PARENT_RUN_ID || randomUUID() });
  const { contract, project, invoice: firstInvoice, approvalBase, head: firstHead, pricingRow,
    normalizationManifest } = fixture;
  const source = { contractId: contract.id, itemId: fixture.item.id, productRowId: fixture.productRowId,
    productId: fixture.productId };
  const beforeVersionCount = await observer.contractApprovedPricingVersion.count({ where: { contractId: contract.id } });
  const actor = fixture.actor;
  assert.equal(firstHead.currentVersion.versionNumber, 1);
  assert.equal(await observer.contractPricingReadinessResult.count({ where: {
    contractId: contract.id, pricingVersionId: firstHead.currentVersion.id, status: 'READY' } }), 1,
  'the production financial approval transaction atomically publishes READY for its sealed version');

  const loadingId = randomUUID();
  const queueTurnId = randomUUID();
  const externalDriverId = randomUUID();
  const externalVehicleId = randomUUID();
  const expiresAt = new Date(Date.now() + 86_400_000 * 365);
  const { actor: logisticsActor, authority: logisticsAuthority } = await createAuthorizedActorFixture(observer, {
    runId: process.env.ISSUE260_PARENT_RUN_ID || randomUUID(), workspace: 'logistics',
    feature: 'logistics_loadings_finalize' });
  await observer.externalDriver.create({ data: { id: externalDriverId, firstName: 'Issue', lastName: '260',
    nationalCode: createHash('sha256').update(`driver:${externalDriverId}`).digest('hex').slice(0, 10),
    phone: `09${createHash('sha256').update(externalDriverId).digest('hex').replace(/[a-f]/g, '1').slice(0, 9)}`,
    status: 'ACTIVE', statusRecordedBy: logisticsActor.id, createdBy: logisticsActor.id,
    documents: { create: { documentType: 'DRIVING_LICENCE', reference: `issue260-${externalDriverId}`,
      expiresAt, recordedBy: logisticsActor.id } } } });
  await observer.externalVehicle.create({ data: { id: externalVehicleId, vehicleType: 'Issue 260 test vehicle',
    status: 'ACTIVE', statusRecordedBy: logisticsActor.id, createdBy: logisticsActor.id,
    plates: { create: { plate: `260-${externalVehicleId.slice(0, 8)}`,
      normalizedPlate: `260${externalVehicleId.replace(/-/g, '').slice(0, 8)}`, effectiveFrom: new Date(),
      reason: 'Issue 260 isolated concurrency fixture', recordedBy: logisticsActor.id } },
    documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: `issue260-${externalVehicleId}`,
      expiresAt, recordedBy: logisticsActor.id } } } });
  const loading = await observer.logisticsLoading.create({ data: { id: loadingId,
    loadingNumber: `ISSUE260-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
    customerId: contract.customerId, projectId: project.id, status: 'DRAFT', createdBy: logisticsActor.id,
    lines: { create: { sourceContractId: contract.id, sourceContractItemId: source.itemId,
      productRowId: source.productRowId, productId: source.productId, quantity: pricingRow.contractedQuantity,
      unit: pricingRow.unit, sourceSnapshot: json({ contractNumber: contract.contractNumber }) } } } });
  await observer.guardDriverQueueTurn.create({ data: { id: queueTurnId,
    driverSource: 'EXTERNAL', status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING,
    externalDriverId, externalVehicleId, admittedAt: new Date(), admittedBy: logisticsActor.id,
    snapshotSchemaVersion: 1, admissionSnapshot: json({ schemaVersion: 1, externalDriverId, externalVehicleId }),
    integrityHash: createHash('sha256').update(`queue:${queueTurnId}`).digest('hex'), loadingId: loading.id,
    availableAt: new Date(), availableBy: logisticsActor.id, reservedAt: new Date(), reservedBy: logisticsActor.id } });
  await observer.logisticsAllocationDraft.create({ data: { loadingId: loading.id, queueTurnId, createdBy: logisticsActor.id,
    lines: { create: { sourceContractId: contract.id, sourceContractItemId: source.itemId,
      productRowId: source.productRowId, productId: source.productId, quantity: pricingRow.contractedQuantity,
      unit: pricingRow.unit, snapshot: json({ contractNumber: contract.contractNumber, productName: source.productRowId }) } } } });

  const finalizationKey = `issue260-finalize-${loading.id}`;
  const finalize = () => finalizeCanonicalLoadingAllocations(logistics, {
    loadingId: loading.id, idempotencyKey: finalizationKey, actorId: logisticsActor.id,
  });
  const cloneInvoice = async () => {
    const id = randomUUID();
    await observer.accountingFinancialRecord.create({ data: { id, kind: firstInvoice.kind, status: 'DRAFT',
      sourceKind: firstInvoice.sourceKind, sourceId: firstInvoice.sourceId, contractId: firstInvoice.contractId,
      customerId: firstInvoice.customerId, periodId: firstInvoice.periodId, amount: firstInvoice.amount,
      currency: firstInvoice.currency, sourceSnapshot: json(firstInvoice.sourceSnapshot), metadata: json(firstInvoice.metadata),
      createdBy: firstInvoice.createdBy, invoiceItems: { create: firstInvoice.invoiceItems.map(item => ({
        contractItemId: item.contractItemId, productId: item.productId, description: item.description,
        quantity: item.quantity, unitPrice: item.unitPrice, totalPrice: item.totalPrice, taxRate: item.taxRate,
        metadata: item.metadata ? json(item.metadata) : undefined })) } } });
    return id;
  };
  const secondInvoiceId = await cloneInvoice();
  const firstRace = await coordinatedApproval({ ...approvalBase, invoiceId: secondInvoiceId,
    systemInvoiceNumber: invoiceNumber() }, actor, finalize);
  assert.equal(firstRace[0].status, 'fulfilled', 'production financial replacement must commit');
  assert.equal(firstRace[1].status, 'fulfilled',
    'Logistics waits for the atomic approval/READY transaction and finalizes against its committed head');
  const secondHead = await observer.contractApprovedPricingHead.findUniqueOrThrow({ where: { contractId: contract.id },
    include: { currentVersion: { include: { rows: true } } } });
  assert.equal(secondHead.currentVersion.versionNumber, 2);
  const secondPricingRow = secondHead.currentVersion.rows.find(row => row.contractItemId === source.itemId);
  assert.ok(secondPricingRow);
  const readiness = await observer.contractPricingReadinessResult.findFirstOrThrow({ where: { contractId: contract.id,
    pricingVersionId: secondHead.currentVersion.id, status: 'READY' }, orderBy: { evaluatedAt: 'desc' } });
  const readinessCommittedAtomicallyWithApproval = readiness.pricingVersionId === secondHead.currentVersion.id
    && readiness.evaluatedAt.getTime() >= secondHead.currentVersion.approvedAt.getTime();
  assert.equal(readinessCommittedAtomicallyWithApproval, true);
  const finalizedBatch = (firstRace[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof finalize>>>).value;
  assert.equal(finalizedBatch.revisions.length, 1);
  const revision = finalizedBatch.revisions[0];
  assert.ok(revision.candidate);
  const [pricingReference] = await observer.logisticsAllocationRevisionPricing.findMany({ where: {
    allocationRevisionId: revision.id } });
  assert.equal(pricingReference?.pricingVersionId, secondHead.currentVersion.id,
    'the fresh production finalization binds exactly the independently READY replacement version');
  assert.equal(await observer.dispatchPricedAllocationEvent.count({ where: { allocationRevisionId: revision.id,
    pricingVersionId: secondHead.currentVersion.id } }), 1);

  const waybillId = randomUUID();
  const issuedAt = new Date().toISOString();
  const files = new Map<string, Uint8Array>();
  const storage: DispatchArtifactStorage = { stage: async ({ storageKey, bytes }) => { files.set(storageKey, bytes); },
    read: async key => files.get(key) || null };
  const repository = new PrismaDispatchDocumentRepository(logistics, allocationPricingIntegrityVerifier, storage);
  const number = await repository.allocateWaybillNumber();
  const identity = { waybillId, waybillDocumentId: randomUUID(), statementDocumentId: randomUUID(), number, issuedAt };
  const bundle = await new PrismaDispatchDocumentSourceReader(logistics, 'concurrency-v1', 'concurrency-generator-v1')
    .readPrimaryBundle({ candidateId: revision.candidate.id, waybill: identity });
  const artifacts = ([bundle.waybill, bundle.statement] as const).map(renderInput => {
    const bytes = new TextEncoder().encode(`${renderInput.kind}:${revision.candidate!.id}`);
    const storageKey = `dispatch-documents/issue260/${waybillId}/${renderInput.kind.toLowerCase()}.pdf`;
    files.set(storageKey, bytes);
    return { id: renderInput.documentId, waybillId, kind: renderInput.kind, adjustmentSequence: null,
      templateVersion: renderInput.templateVersion, generatorVersion: bundle.provenance.generatorVersion,
      sourceVersionIdentities: bundle.provenance.sourceVersionIdentities, storageKey, mediaType: 'application/pdf' as const,
      byteLength: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), publishedAt: issuedAt };
  });
  const accept = () => repository.acceptAndIssue({ candidateId: revision.candidate!.id, allocationRevisionId: revision.id,
    expectedSourceIntegrityHash: bundle.sourceIntegrityHash, waybillSnapshot: bundle.waybillSnapshot,
    waybill: { id: waybillId, number, status: 'ISSUED', issuedAt, replacesWaybillId: null }, artifacts,
    idempotencyKey: `pricing-accept-${revision.id}`, actorId: actor.userId,
    correlationId: `pricing-accept-${revision.id}`,
    intentFingerprint: createHash('sha256').update(`pricing-accept-${revision.id}`).digest('hex') });
  const thirdInvoiceId = await cloneInvoice();
  const secondRace = await coordinatedApproval({ ...approvalBase, invoiceId: thirdInvoiceId,
    systemInvoiceNumber: invoiceNumber() }, actor, accept);
  assert.equal(secondRace[0].status, 'fulfilled');
  if (secondRace[1].status === 'rejected') {
    const reason = record(secondRace[1].reason);
    throw new Error(`Accounting acceptance rejected instead of returning a stale-successor decision: ${JSON.stringify({
      name: reason.name, message: reason.message ?? String(secondRace[1].reason), code: reason.code, meta: reason.meta,
    })}`);
  }
  const acceptance = (secondRace[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof accept>>>).value;
  assert.equal(acceptance.status, 'STALE_REQUIRES_SUCCESSOR', 'the financial head winner forces a successor before issuance');
  assert.equal(await observer.accountingDispatchWaybill.count({ where: { candidateId: revision.candidate.id } }), 0);
  assert.equal(await observer.contractApprovedPricingVersion.count({ where: { contractId: contract.id } }), beforeVersionCount + 2);
  const proofDurationMs = Number((performance.now() - proofStartedAt).toFixed(3));
  console.log(JSON.stringify({ kind: 'issue260-financial-logistics-production-proof',
    schemaVersion: 1, parentRunId: process.env.ISSUE260_PARENT_RUN_ID,
    parentDatabaseName: process.env.ISSUE260_PARENT_DATABASE_NAME,
    databaseName: new URL(process.env.DATABASE_URL!).pathname.slice(1),
    scenarios: ['financial-approval-vs-logistics-finalization',
      'pricing-replacement-vs-accounting-acceptance'].map(name => ({ name, repetitions: 1, anomalies: [], durationMs: proofDurationMs })),
    events: [
      { scenario: 'financial-approval-vs-logistics-finalization', actor: 'financial-approval-v2',
        phase: 'approve-and-seal', outcome: 'winner', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
      { scenario: 'financial-approval-vs-logistics-finalization', actor: 'logistics-finalization',
        phase: 'bind-pricing', outcome: 'waited-for-atomic-ready', detail: { attempt: 1, durationMs: proofDurationMs,
          databaseCode: null, effectiveAuthority: logisticsAuthority } },
      { scenario: 'financial-approval-vs-logistics-finalization', actor: 'approved-pricing-readiness-publisher',
        phase: 'publish-ready', outcome: 'committed', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
      { scenario: 'pricing-replacement-vs-accounting-acceptance', actor: 'financial-approval-v3',
        phase: 'replace-pricing', outcome: 'winner', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
      { scenario: 'pricing-replacement-vs-accounting-acceptance', actor: 'accounting-acceptance',
        phase: 'accept-vs-v3', outcome: 'loser-stale-successor', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
    ],
    finalBinding: 'ATOMIC_WAYBILL_STATEMENT', acceptanceStatus: acceptance.status, pricingVersionsAdded: 3,
    readinessCommittedAtomicallyWithApproval, boundPricingVersionId: pricingReference?.pricingVersionId,
    normalizationManifest }));
};

run().finally(() => Promise.all([observer.$disconnect(), logistics.$disconnect()]));
