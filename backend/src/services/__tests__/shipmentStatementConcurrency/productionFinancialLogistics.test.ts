import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import { parseCanonicalProductGraph, projectCanonicalProductGraph } from '@sabalanerp/contract-product-graph';
import { executeAccountingAction, type AccountingActionNotificationHook } from '../../accountingService';
import { bindFinalizedAllocationPricing } from '../../allocationPricingBinding';
import { createPrismaAllocationPricingBindingPort } from '../../allocationPricingPrismaAdapter';
import { type DispatchArtifactStorage } from '../../dispatchDocuments';
import { allocationPricingIntegrityVerifier, PrismaDispatchDocumentSourceReader } from '../../dispatchDocuments/prismaSourceReader';
import { PrismaDispatchDocumentRepository } from '../../dispatchDocuments/prismaRepository';

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
  release();
  const [approvalResult, competitorResult] = await Promise.allSettled([approval, competitor]);
  return [approvalResult, competitorResult] as const;
};

const run = async () => {
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
  const contractData = { contractKind: 'collaboration', customerId: contractTemplate.candidate.customerId,
    customer: { id: contractTemplate.candidate.customerId, firstName: contractTemplate.candidate.customer.firstName,
      lastName: contractTemplate.candidate.customer.lastName, companyName: contractTemplate.candidate.customer.companyName },
    projectId: null, project: null, payment: { currency: contractTemplate.candidate.currency }, products: [productSnapshot],
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

  const template = await observer.logisticsAllocationRevision.findFirstOrThrow({ include: { lines: true }, orderBy: { finalizedAt: 'asc' } });
  const maxRevision = await observer.logisticsAllocationRevision.aggregate({ where: { loadingId: template.loadingId,
    queueTurnId: template.queueTurnId }, _max: { revisionNumber: true } });
  const revisionId = randomUUID();
  const finalizedAt = new Date();
  await observer.logisticsAllocationRevision.create({ data: { id: revisionId, batchId: template.batchId,
    loadingId: template.loadingId, queueTurnId: template.queueTurnId,
    revisionNumber: (maxRevision._max.revisionNumber || 0) + 1, snapshot: json(template.snapshot),
    integrityHash: createHash('sha256').update(`revision:${revisionId}`).digest('hex'), finalizedAt, finalizedBy: actor.userId,
    lines: { create: { id: randomUUID(), sourceContractId: contract.id, sourceContractItemId: source.itemId,
      productRowId: source.productRowId, productId: source.productId, quantity: pricingRow.contractedQuantity,
      unit: pricingRow.unit, snapshot: { contractNumber: contract.contractNumber, productName: source.productRowId },
      integrityHash: createHash('sha256').update(`line:${revisionId}`).digest('hex') } },
    candidate: { create: { status: 'PENDING', workItem: { create: { status: 'OPEN' } } } } } });
  await observer.logisticsAllocationRevision.update({ where: { id: revisionId }, data: {
    sealedAt: finalizedAt,
  } });
  const revision = await observer.logisticsAllocationRevision.findUniqueOrThrow({ where: { id: revisionId },
    include: { lines: true, candidate: true } });
  assert.ok(revision.candidate);

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
  const sourceEvidence = record(firstHead.currentVersion.sourceEvidence);
  const destination = record(sourceEvidence.destination);
  const project = record(sourceEvidence.project);
  const scope = { customerId: String(record(sourceEvidence.customer).id || ''),
    projectId: String(destination.projectId || project.id || ''), destination: String(destination.address || '') };
  let bindAttempts = 0;
  const bind = async (): Promise<Awaited<ReturnType<typeof bindFinalizedAllocationPricing>>> => {
    for (;;) {
      bindAttempts += 1;
      try {
        return await logistics.$transaction(tx => bindFinalizedAllocationPricing(createPrismaAllocationPricingBindingPort(tx), {
          allocationRevisionId: revision.id, finalizedAt: revision.finalizedAt, actorId: actor.userId, scope,
          expectedCurrency: contract.currency, lines: revision.lines.map(line => ({ allocationRevisionLineId: line.id,
            contractId: line.sourceContractId, contractItemId: line.sourceContractItemId, productRowId: line.productRowId,
            quantity: line.quantity.toFixed(3), unit: line.unit })) }, { CUSTOMER_SHIPMENT_STATEMENTS_ENABLED: 'true' }),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
      } catch (error) {
        const code = record(error).code;
        if (bindAttempts >= 3 || !['P2034', '40001', '40P01'].includes(String(code))) throw error;
      }
    }
  };

  const secondInvoiceId = await cloneInvoice();
  const firstRace = await coordinatedApproval({ ...approvalBase, invoiceId: secondInvoiceId,
    systemInvoiceNumber: invoiceNumber() }, actor, bind);
  assert.equal(firstRace[0].status, 'fulfilled', 'production financial replacement must commit');
  if (firstRace[1].status === 'rejected') {
    assert.match(String(firstRace[1].reason), /scope differs|serialization|write conflict/i,
      'the losing transaction must fail closed with a concurrency/evidence conflict');
  }
  const finalizedBinding = firstRace[1].status === 'fulfilled' ? firstRace[1].value : await bind();
  assert.equal(finalizedBinding.path, 'ATOMIC_WAYBILL_STATEMENT');
  assert.equal(await observer.logisticsAllocationRevisionPricing.count({ where: { allocationRevisionId: revision.id } }), 1,
    'a fail-closed attempt plus command retry must create one pricing reference');
  assert.equal(await observer.dispatchPricedAllocationEvent.count({ where: { allocationRevisionId: revision.id } }), 1,
    'a fail-closed attempt plus command retry must create one immutable priced event');

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
  assert.equal(secondRace[1].status, 'fulfilled');
  const acceptance = (secondRace[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof accept>>>).value;
  assert.equal(acceptance.status, 'STALE_REQUIRES_SUCCESSOR', 'the financial head winner forces a successor before issuance');
  assert.equal(await observer.accountingDispatchWaybill.count({ where: { candidateId: revision.candidate.id } }), 0);
  assert.equal(await observer.contractApprovedPricingVersion.count({ where: { contractId: contract.id } }), beforeVersionCount + 3);
  console.log(JSON.stringify({ kind: 'issue260-financial-logistics-production-proof',
    scenarios: ['financial-approval-vs-finalization', 'pricing-replacement-vs-accounting-acceptance'],
    finalBinding: 'ATOMIC_WAYBILL_STATEMENT', acceptanceStatus: acceptance.status, pricingVersionsAdded: 3,
    bindAttempts, normalizationManifest }));
};

run().finally(() => Promise.all([observer.$disconnect(), logistics.$disconnect()]));
