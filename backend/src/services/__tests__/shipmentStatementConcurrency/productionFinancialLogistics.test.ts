import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { GuardDriverQueueTurnStatus, Prisma, PrismaClient } from '@prisma/client';
import { parseCanonicalProductGraph, projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { executeAccountingAction, type AccountingActionNotificationHook } from '../../accountingService';
import { publishCurrentApprovedPricingReadiness } from '../../approvedPricing';
import { type DispatchArtifactStorage } from '../../dispatchDocuments';
import { allocationPricingIntegrityVerifier, PrismaDispatchDocumentSourceReader } from '../../dispatchDocuments/prismaSourceReader';
import { PrismaDispatchDocumentRepository } from '../../dispatchDocuments/prismaRepository';
import { finalizeCanonicalLoadingAllocations } from '../../dispatchAllocation';

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
  const candidates = await observer.salesContract.findMany({ where: { productGraphState: { isNot: null },
    items: { some: { productRowId: { not: null } } } }, include: { customer: true, productGraphState: true, items: true },
  orderBy: { createdAt: 'asc' }, take: 100 });
  const contractTemplate = candidates.map(candidate => {
    if (!candidate.productGraphState) return null;
    const graph = parseCanonicalProductGraph(candidate.productGraphState.graph);
    const row = graph.rows[0];
    const item = row && candidate.items.find(candidateItem => candidateItem.productRowId === row.productRowId &&
      candidateItem.productId === row.catalogProductId && candidateItem.productType === row.productType);
    return row && item ? { candidate, graph, row, item } : null;
  }).find((value): value is NonNullable<typeof value> => value !== null);
  assert.ok(contractTemplate, 'BLOCKED: no exact catalog/product identity exists for an isolated test fixture');
  const contractId = randomUUID();
  const itemId = randomUUID();
  const productRowId = `contract-row-${randomUUID()}`;
  const amount = '100';
  const authoredQuantity = contractTemplate.row.productType === 'longitudinal'
    ? { length: '1', lengthUnit: 'm' }
    : contractTemplate.row.productType === 'slab'
      ? { squareMeters: '1' }
      : contractTemplate.row.productType === 'prepared'
        ? { preparedQuantity: '1', preparedUnit: 'count', unit: 'count' }
        : {};
  const canonicalQuantity = contractTemplate.row.productType === 'longitudinal'
    ? { requestedLengthMeters: '1', requestedQuantity: '1' }
    : contractTemplate.row.productType === 'slab'
      ? { requestedAreaSquareMeters: '1' }
      : { requestedQuantity: '1' };
  const productSnapshot = { rowId: productRowId, productRowId, productId: contractTemplate.item.productId,
    productType: contractTemplate.row.productType, name: contractTemplate.row.contractualTitle, quantity: '1',
    ...authoredQuantity, meta: { isLayer: false } };
  const syntheticGraph = parseCanonicalProductGraph({ ...contractTemplate.graph, revision: 1,
    catalogSnapshots: contractTemplate.graph.catalogSnapshots.filter(snapshot => snapshot.catalogProductId === contractTemplate.row.catalogProductId &&
      snapshot.snapshotVersion === contractTemplate.row.catalogSnapshotVersion),
    rows: [{ ...contractTemplate.row, productRowId, parentProductRowId: undefined, sourceProductRowId: undefined,
      commercial: { ...canonicalQuantity, baseAmountToman: amount, totalAmountToman: amount } }],
    stairSystems: [], layerConfigurations: [], sourceBatches: [], remainingStones: [], allocations: [], operationGroups: [],
    toolSelections: [], finishingSelections: [] });
  const graphHash = createHash('sha256').update(JSON.stringify(syntheticGraph)).digest('hex');
  const project = await observer.projectAddress.create({ data: { customerId: contractTemplate.candidate.customerId,
    address: `Issue 260 destination ${contractId}`, projectName: `Issue 260 ${contractId}` } });
  const contractData = { contractKind: 'collaboration', customerId: contractTemplate.candidate.customerId,
    customer: { id: contractTemplate.candidate.customerId, firstName: contractTemplate.candidate.customer.firstName,
      lastName: contractTemplate.candidate.customer.lastName, companyName: contractTemplate.candidate.customer.companyName },
    projectId: project.id, project: { id: project.id, address: project.address, projectName: project.projectName },
    payment: { currency: contractTemplate.candidate.currency }, products: [productSnapshot],
    discount: { enabled: false, baseSubtotal: amount, percent: '0', amount: '0', currency: contractTemplate.candidate.currency } };
  const sourceContract = await observer.salesContract.create({ data: { id: contractId,
    contractNumber: `ISSUE260-${randomUUID()}`, title: 'Issue 260 concurrency fixture', titlePersian: 'Issue 260', content: '',
    status: 'APPROVED', customerId: contractTemplate.candidate.customerId, departmentId: contractTemplate.candidate.departmentId,
    createdBy: contractTemplate.candidate.createdBy, responsibleSellerId: contractTemplate.candidate.responsibleSellerId,
    currency: contractTemplate.candidate.currency, totalAmount: new Prisma.Decimal(amount), contractData: json(contractData),
    items: { create: { id: itemId, productId: contractTemplate.item.productId, productRowId,
      productType: contractTemplate.row.productType, quantity: new Prisma.Decimal(1), unitPrice: new Prisma.Decimal(amount),
      totalPrice: new Prisma.Decimal(amount), description: contractTemplate.row.contractualTitle } },
    productGraphState: { create: { schemaVersion: syntheticGraph.schemaVersion, revision: syntheticGraph.revision,
      graph: json(syntheticGraph), policySnapshot: json(syntheticGraph.calculationPolicy), inputHash: graphHash,
      resultHash: graphHash, totalAmountToman: new Prisma.Decimal(amount) } } },
  include: { customer: true, productGraphState: true, items: true } });
  const normalizationManifest = { kind: 'SYNTHETIC_TEST_EVIDENCE', contractId, graphHash,
    rows: [{ productRowId, contractItemId: itemId, quantity: '1',
      unit: contractTemplate.row.productType === 'longitudinal' ? 'meter'
        : contractTemplate.row.productType === 'slab' ? 'squareMeter' : 'count',
      baseAmountToman: amount, totalAmountToman: amount, discountEligible: true }] };
  assert.equal(projectCanonicalProductGraph(syntheticGraph, 'accounting').totalAmountToman, amount);
  const source = { contractId, itemId, productRowId, productId: contractTemplate.item.productId };
  const contract = await observer.salesContract.findUniqueOrThrow({ where: { id: source.contractId } });
  const beforeVersionCount = await observer.contractApprovedPricingVersion.count({ where: { contractId: contract.id } });
  const actor = { userId: contract.createdBy, role: 'ADMIN' };
  const created = await executeAccountingAction({ kind: 'CREATE_INVOICE', contractId: contract.id,
    mode: 'FROM_CONTRACT_TOTAL', idempotencyKey: `issue260-create-${randomUUID()}` }, actor);
  const firstInvoiceId = String((record(created.affected).financialRecordIds as unknown[])?.[0] || '');
  const firstInvoice = await observer.accountingFinancialRecord.findUniqueOrThrow({ where: { id: firstInvoiceId }, include: { invoiceItems: true } });
  const approvalBase = { kind: 'APPROVE_FINANCIAL_INVOICE', systemInvoiceDate: new Date().toISOString().slice(0, 10),
    sepidarAmount: firstInvoice.amount.toString() };
  await executeAccountingAction({ ...approvalBase, invoiceId: firstInvoice.id, systemInvoiceNumber: invoiceNumber() }, actor);
  const firstHead = await observer.contractApprovedPricingHead.findUniqueOrThrow({ where: { contractId: contract.id },
    include: { currentVersion: { include: { rows: true } } } });
  const pricingRow = firstHead.currentVersion.rows.find(row => row.contractItemId === source.itemId);
  assert.ok(pricingRow, 'approved pricing must contain the selected stable contract row');
  assert.equal(firstHead.currentVersion.versionNumber, 1);
  assert.equal(await observer.contractPricingReadinessResult.count({ where: {
    contractId: contract.id, pricingVersionId: firstHead.currentVersion.id } }), 0,
  'financial approval owns the immutable version but does not manufacture READY evidence');

  const loadingId = randomUUID();
  const queueTurnId = randomUUID();
  const externalDriverId = randomUUID();
  const externalVehicleId = randomUUID();
  const expiresAt = new Date(Date.now() + 86_400_000 * 365);
  await observer.externalDriver.create({ data: { id: externalDriverId, firstName: 'Issue', lastName: '260',
    nationalCode: createHash('sha256').update(`driver:${externalDriverId}`).digest('hex').slice(0, 10),
    phone: `09${createHash('sha256').update(externalDriverId).digest('hex').replace(/[a-f]/g, '1').slice(0, 9)}`,
    status: 'ACTIVE', statusRecordedBy: actor.userId, createdBy: actor.userId,
    documents: { create: { documentType: 'DRIVING_LICENCE', reference: `issue260-${externalDriverId}`,
      expiresAt, recordedBy: actor.userId } } } });
  await observer.externalVehicle.create({ data: { id: externalVehicleId, vehicleType: 'Issue 260 test vehicle',
    status: 'ACTIVE', statusRecordedBy: actor.userId, createdBy: actor.userId,
    plates: { create: { plate: `260-${externalVehicleId.slice(0, 8)}`,
      normalizedPlate: `260${externalVehicleId.replace(/-/g, '').slice(0, 8)}`, effectiveFrom: new Date(),
      reason: 'Issue 260 isolated concurrency fixture', recordedBy: actor.userId } },
    documents: { create: { documentType: 'VEHICLE_REGISTRATION', reference: `issue260-${externalVehicleId}`,
      expiresAt, recordedBy: actor.userId } } } });
  const loading = await observer.logisticsLoading.create({ data: { id: loadingId,
    loadingNumber: `ISSUE260-${Date.now()}-${Math.floor(Math.random() * 10_000)}`,
    customerId: contract.customerId, projectId: project.id, status: 'DRAFT', createdBy: actor.userId,
    lines: { create: { sourceContractId: contract.id, sourceContractItemId: source.itemId,
      productRowId: source.productRowId, productId: source.productId, quantity: pricingRow.contractedQuantity,
      unit: pricingRow.unit, sourceSnapshot: json({ contractNumber: contract.contractNumber }) } } } });
  await observer.guardDriverQueueTurn.create({ data: { id: queueTurnId,
    driverSource: 'EXTERNAL', status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING,
    externalDriverId, externalVehicleId, admittedAt: new Date(), admittedBy: actor.userId,
    snapshotSchemaVersion: 1, admissionSnapshot: json({ schemaVersion: 1, externalDriverId, externalVehicleId }),
    integrityHash: createHash('sha256').update(`queue:${queueTurnId}`).digest('hex'), loadingId: loading.id,
    availableAt: new Date(), availableBy: actor.userId, reservedAt: new Date(), reservedBy: actor.userId } });
  await observer.logisticsAllocationDraft.create({ data: { loadingId: loading.id, queueTurnId, createdBy: actor.userId,
    lines: { create: { sourceContractId: contract.id, sourceContractItemId: source.itemId,
      productRowId: source.productRowId, productId: source.productId, quantity: pricingRow.contractedQuantity,
      unit: pricingRow.unit, snapshot: json({ contractNumber: contract.contractNumber, productName: source.productRowId }) } } } });

  const finalizationKey = `issue260-finalize-${loading.id}`;
  const finalize = () => finalizeCanonicalLoadingAllocations(logistics, {
    loadingId: loading.id, idempotencyKey: finalizationKey, actorId: actor.userId,
  });
  await assert.rejects(finalize, /pricing|READY/i,
    'post-cutover Logistics finalization fails closed while the approved version lacks READY evidence');
  assert.equal(await observer.logisticsAllocationBatch.count({ where: { loadingId: loading.id } }), 0);
  assert.equal(await observer.logisticsAllocationRevision.count({ where: { loadingId: loading.id } }), 0);
  assert.equal(await observer.dispatchPricedAllocationEvent.count({ where: { allocationRevision: { loadingId: loading.id } } }), 0);
  assert.equal((await observer.logisticsLoading.findUniqueOrThrow({ where: { id: loading.id } })).status, 'DRAFT');
  assert.equal((await observer.guardDriverQueueTurn.findUniqueOrThrow({ where: { id: queueTurnId } })).status,
    GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING);

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
  assert.equal(firstRace[1].status, 'rejected', 'Logistics cannot infer READY while financial approval is committing');
  assert.match(String((firstRace[1] as PromiseRejectedResult).reason), /pricing|READY/i);
  const secondHead = await observer.contractApprovedPricingHead.findUniqueOrThrow({ where: { contractId: contract.id },
    include: { currentVersion: { include: { rows: true } } } });
  assert.equal(secondHead.currentVersion.versionNumber, 2);
  assert.equal(await observer.logisticsAllocationBatch.count({ where: { loadingId: loading.id } }), 0,
    'the failed production finalization leaves no batch, revision, candidate, ledger, or reservation evidence');
  const secondPricingRow = secondHead.currentVersion.rows.find(row => row.contractItemId === source.itemId);
  assert.ok(secondPricingRow);
  const readiness = await publishCurrentApprovedPricingReadiness(observer, { contractId: contract.id,
    pricingVersionId: secondHead.currentVersion.id,
    sourceFinancialRecordId: secondHead.currentVersion.sourceFinancialRecordId, evaluatedBy: actor.userId });
  assert.equal(readiness.status, 'READY');
  const readinessPublishedAfterCommit = readiness.pricingVersionId === secondHead.currentVersion.id
    && readiness.evaluatedAt.getTime() >= secondHead.currentVersion.approvedAt.getTime();
  assert.equal(readinessPublishedAfterCommit, true);
  const finalizedBatch = await finalize();
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
  assert.equal(await observer.contractApprovedPricingVersion.count({ where: { contractId: contract.id } }), beforeVersionCount + 3);
  const proofDurationMs = Number((performance.now() - proofStartedAt).toFixed(3));
  console.log(JSON.stringify({ kind: 'issue260-financial-logistics-production-proof',
    schemaVersion: 1, parentRunId: process.env.ISSUE260_PARENT_RUN_ID,
    parentDatabaseName: process.env.ISSUE260_PARENT_DATABASE_NAME,
    databaseName: new URL(process.env.DATABASE_URL!).pathname.slice(1),
    scenarios: [{ name: 'financial-approval-vs-finalization-and-acceptance', repetitions: 1, anomalies: [],
      durationMs: proofDurationMs }],
    events: [
      { scenario: 'financial-approval-vs-finalization-and-acceptance', actor: 'financial-approval-v2',
        phase: 'approve-and-seal', outcome: 'winner', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
      { scenario: 'financial-approval-vs-finalization-and-acceptance', actor: 'logistics-finalization-before-ready',
        phase: 'bind-pricing', outcome: 'loser-fail-closed', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
      { scenario: 'financial-approval-vs-finalization-and-acceptance', actor: 'approved-pricing-readiness-publisher',
        phase: 'publish-ready', outcome: 'committed', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
      { scenario: 'financial-approval-vs-finalization-and-acceptance', actor: 'accounting-acceptance',
        phase: 'accept-vs-v3', outcome: 'loser-stale-successor', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
    ],
    finalBinding: 'ATOMIC_WAYBILL_STATEMENT', acceptanceStatus: acceptance.status, pricingVersionsAdded: 3,
    readinessPublishedAfterCommit, boundPricingVersionId: pricingReference?.pricingVersionId,
    normalizationManifest }));
};

run().finally(() => Promise.all([observer.$disconnect(), logistics.$disconnect()]));
