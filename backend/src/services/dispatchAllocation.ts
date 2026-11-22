import { personalPickupDisplayContext } from './personalLoadingPickup';
import { requirePickupVerification } from './dispatchPickupVerification';
import { LOADING_CANCELLATION_DUTY } from './crossWorkspaceDutyAdapters/loadingCancellationDutyCode';
import { exactQuantityText, ExactQuantityDecimal } from './exactQuantity';
import { assertPartnerCommercialDispatchEligible } from './partnerSales/fulfillment/commercialSettlement';
import { createHash } from 'node:crypto';
import { assertOrdinaryContractsDispatchEligible } from './ordinaryContractDispatchEligibility';
import { isOrdinaryCommercialFlow } from './ordinaryContractLifecycle';
import {
  AccountingDispatchCandidateStatus,
  AccountingDispatchWaybillStatus,
  GuardDriverQueueTurnStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { appendQueueEvent, isGuardQueueTurnCurrentlyReady } from './guardDriverQueue';
import {
  readShipmentQuantityProjection,
  shipmentProjectionPersistenceData,
  shipmentQuantityEvidenceIntegrityHash,
} from './shipmentQuantityProjectionStore';
import { assertCanonicalDispatchCommandAllowed } from './dispatchCutover';
import { isPostCutoverFinalization } from './dispatchDocuments/featureGate';
import { loadShipmentStatementRuntimeStateUnderLock } from './dispatchDocuments/runtimeState';
import { assessBoundAllocationPricingFreshness } from './allocationPricingReadModel';
import type { createDispatchDocuments } from './dispatchDocuments/service';
import { AllocationPricingBindingError, assertExactStableReservationTransfer, bindFinalizedAllocationPricing, bindApprovedAllocationPriceEvidence } from './allocationPricingBinding';
import { createPrismaAllocationPricingBindingPort } from './allocationPricingPrismaAdapter';
import { canonicalHash, canonicalJson, RevisionRefSchema, IdSchema, FulfillmentViewSchema, partnerError,
  type Result, type RevisionRef } from '@sabalanerp/partner-sales-contracts';
import { createPartnerFulfillmentAdapter } from './partnerSales/fulfillment/adapter';
import { createPrismaPartnerFulfillmentRepository } from './partnerSales/fulfillment/prismaRepository';
import { lockPartnerOperationsControl, authorizePartnerTechnicalRollout } from './partnerSales/authorization/technicalRollout';
import { partnerPredecessorIsFrozen } from './partnerSales/corrections/mutationFreeze';
import { authorizePartnerLoading, validPartnerLoadingActor as validLoadingActor, type PartnerLoadingActor } from './partnerSales/fulfillment/loadingAuthority';
import { allocateLoadingNumber } from './logisticsLoadingNumber';
import type { PartnerLoadingSource } from './partnerSales/fulfillment/repository';
import { readPartnerSnapshot } from './partnerSales/authorization/readSnapshot';
import { preparePartnerLoadingQueueChange } from './partnerSales/fulfillment/loadingQueue';
import { PartnerLoadingCommandError } from './partnerSales/fulfillment/loadingAuthority';
import { buildPartnerAllocationDraftRows, readPartnerAllocationDrafts, type PartnerAllocationLineInput } from './partnerSales/fulfillment/allocationDraft';
import { randomUUID } from 'node:crypto';
import { PartnerShipmentPricingConflictError, readPartnerApprovedShipmentPricing } from './partnerSales/fulfillment/approvedPricing';
import { allocatePricedRevision, pricedAllocationIntegrityHash,
  type LockedPartnerApprovedPricingVersion, type PartnerPricedRevisionLine } from './pricedAllocationLedger';
import { readPartnerShipmentQuantityProjection } from './partnerSales/fulfillment/quantityStore';
import { ordinaryAllocationLine } from './allocationSource';

import { getEffectiveUserAccess } from './effectiveAccessService';
import { resolveNarrowFeatureAccess } from './narrowFeatureAccess';
import { voidDispatchBundleInTransaction } from './dispatchDocuments/prismaRepository';
import { voidSalesInvoiceInTransaction } from './salesDispatchInvoice/lifecycle';

type Database = PrismaClient;
type Tx = Prisma.TransactionClient;
type DispatchDocumentsCommands = Pick<ReturnType<typeof createDispatchDocuments>, 'decideCandidate' | 'voidWaybill' | 'replaceWaybill'>;
let dispatchDocumentsCommands: DispatchDocumentsCommands | null = null;
export const installDispatchDocumentsCommands = (commands: DispatchDocumentsCommands) => { dispatchDocumentsCommands = commands; };

const candidateRequiresAtomicDocuments = async (prisma: Database, candidateId: string) => {
  const [candidate, cutover] = await Promise.all([
    prisma.accountingDispatchCandidate.findUnique({ where: { id: candidateId },
      select: { allocationRevision: { select: { sourceKind: true, finalizedAt: true } } } }),
    prisma.shipmentStatementCutover.findUnique({ where: { id: 'customer-shipment-statements' } }),
  ]);
  if (candidate?.allocationRevision.sourceKind === 'PARTNER_CASE') return true;
  return Boolean(candidate && cutover?.cutoverAt && isPostCutoverFinalization(candidate.allocationRevision.finalizedAt, cutover.cutoverAt));
};
const waybillRequiresAtomicDocuments = async (prisma: Database, waybillId: string) => {
  const waybill = await prisma.accountingDispatchWaybill.findUnique({ where: { id: waybillId }, select: { candidateId: true } });
  return waybill ? candidateRequiresAtomicDocuments(prisma, waybill.candidateId) : false;
};
const requiredDispatchDocumentsCommands = () => {
  if (!dispatchDocumentsCommands) throw new DispatchAllocationConflictError('Atomic dispatch document commands are not configured.');
  return dispatchDocumentsCommands;
};

export class DispatchAllocationValidationError extends Error {}
export class DispatchAllocationConflictError extends Error {}

const stableValue = (value: unknown, field = ''): unknown => {
  if (Array.isArray(value)) return value.map(entry => stableValue(entry));
  if (value instanceof Prisma.Decimal) return field.toLowerCase().includes('quantity') ? exactQuantityText(value) : value.toFixed(3);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry, key)]));
  }
  return value instanceof Date ? value.toISOString() : value;
};

const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
const required = (value: unknown, name: string) => {
  const result = String(value || '').trim();
  if (!result) throw new DispatchAllocationValidationError(`${name} is required.`);
  return result;
};
const quantity = (value: unknown) => {
  const result = new ExactQuantityDecimal(String(value));
  if (!result.isFinite() || !result.gt(0) || result.decimalPlaces() > 30) {
    throw new DispatchAllocationValidationError('Allocation quantities must be positive fixed-point values within exact storage capacity.');
  }
  exactQuantityText(result);
  return result;
};
const json = (value: unknown) => stableValue(value) as Prisma.InputJsonValue;

const lockKeys = async (tx: Tx, keys: string[]) => {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
  }
};

const lockShipmentTruth = async (tx: Tx, contractItemIds: string[]) => {
  const ids = [...new Set(contractItemIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "contract_items"
    WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "contractItemId" FROM "shipment_quantity_projections"
    WHERE "contractItemId" IN (${Prisma.join(ids)}) ORDER BY "contractItemId" FOR UPDATE`);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "shipment_quantity_evidence"
    WHERE "contractItemId" IN (${Prisma.join(ids)}) ORDER BY "contractItemId", "recordedAt", "id" FOR UPDATE`);
};

const lockQueueTurns = async (tx: Tx, queueTurnIds: string[]) => {
  const ids = [...new Set(queueTurnIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "guard_driver_queue_turns"
    WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
};

const lockPricingContracts = async (tx: Tx, contractIds: string[]) => {
  const ids = [...new Set(contractIds)].sort();
  if (ids.length === 0) return;
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sales_contracts"
    WHERE "id" IN (${Prisma.join(ids)}) ORDER BY "id" FOR UPDATE`);
};

const serializable = async <T>(prisma: Database, work: (tx: Tx) => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      lastError = error;
      if (!isRetryableDispatchTransactionError(error)) throw error;
    }
  }
  throw lastError;
};

export const isRetryableDispatchTransactionError = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError
  && (error.code === 'P2034'
    || (error.code === 'P2010' && ['40001', '40P01'].includes(String(error.meta?.code || ''))));

type PartnerLoadingRead = { contractNumber: string; personalTurnId: string | null; loadingId: string; loadingNumber: string; status: string; source: PartnerLoadingSource;
  allocations: Extract<Awaited<ReturnType<typeof readPartnerAllocationDrafts>>, { ok: true }>['value'] };
const partnerFailure = (code: Parameters<typeof partnerError>[0]): Result<never> => ({ ok: false, error: partnerError(code) });

/** Apply Case visibility before SQL pagination/counts. Ordinary shipment
 * population and its existing workspace/feature policy remain unchanged. */
export const withLogisticsLoadingReadScope = <T>(prisma: Database, input: PartnerLoadingActor,
  read: (scope: { database: Tx; where: (where?: Prisma.LogisticsLoadingWhereInput) => Prisma.LogisticsLoadingWhereInput }) => Promise<T>) =>
  readPartnerSnapshot(prisma, async tx => {
    if (!validLoadingActor(input)) throw new DispatchAllocationValidationError('Invalid loading read context.');
    const cases = await tx.partnerSaleCase.findMany({ where: { loadings: { some: {} } }, select: { id: true }, orderBy: { id: 'asc' } });
    const allowed: string[] = [];
    for (const row of cases) if ((await authorizePartnerLoading(tx, input, row.id, 'READ')).ok) allowed.push(row.id);
    const access: Prisma.LogisticsLoadingWhereInput = { OR: [{ sourceKind: 'SALES_CONTRACT' },
      { sourceKind: 'PARTNER_CASE', partnerCaseId: { in: allowed } }] };
    return read({ database: tx, where: (where = {}) => ({ AND: [access, where] }) });
  });

export const findLoadablePartnerDeliveries = (db: Database, input: PartnerLoadingActor & { customerIds: string[] }) =>
  readPartnerSnapshot(db, async tx => {
    const sales = await tx.partnerSaleCase.findMany({ where: {
      state: 'COMMITTED', customerId: { in: input.customerIds },
      customerContract: { is: { isInactive: false, status: { notIn: ['CANCELLED', 'EXPIRED'] } } },
    }, select: { id: true, customerId: true, profileId: true, headRevision: true, integrityHash: true,
      customerContract: { select: { contractNumber: true } }, head: { select: { internalProjection: true } } } });
    const results: { id: string; customerId: string; sourceKind: 'PARTNER_CASE'; owner: RevisionRef;
      deliveryId: string; projectName: string; address: string; date: string; contractNumber: string; remainingCount: number }[] = [];
    for (const sale of sales) {
      if (!sale.customerContract || !(await authorizePartnerLoading(tx, input, sale.id, 'READ')).ok) continue;
      const view = FulfillmentViewSchema.safeParse((sale.head.internalProjection as Prisma.JsonObject | null)?.fulfillment);
      if (!view.success || view.data.owner.caseId !== sale.id || view.data.owner.revision !== sale.headRevision
        || view.data.owner.integrityHash !== sale.integrityHash) continue;
      if (!(await authorizePartnerTechnicalRollout(tx, sale.profileId, 'COMMITTED_FULFILLMENT')).ok
        || await partnerPredecessorIsFrozen(tx, sale.id, sale.headRevision)) continue;
      const projection = await readPartnerShipmentQuantityProjection(tx, sale.id);
      const balanceByRow = new Map(projection.rows.map(row => [row.productRowId, row]));
      const used = await tx.logisticsAllocationRevisionLine.groupBy({
        by: ['partnerDeliveryId', 'productRowId'],
        where: { sourceKind: 'PARTNER_CASE', partnerCaseId: sale.id, revision: {
          candidate: { status: { in: [AccountingDispatchCandidateStatus.PENDING, AccountingDispatchCandidateStatus.ACCEPTED] } },
        } },
        _sum: { quantity: true },
      });
      const usedByRow = new Map(used.map(row => [JSON.stringify([row.partnerDeliveryId, row.productRowId]), row._sum.quantity]));
      for (const delivery of view.data.deliveries) {
        const remainingCount = delivery.items.filter(item => {
          const balance = balanceByRow.get(item.productRowId);
          return balance?.health === 'CURRENT' && balance.quantities
            && new ExactQuantityDecimal(balance.quantities.availableToLoad).gt(0)
            && new ExactQuantityDecimal(item.quantity).gt(usedByRow.get(JSON.stringify([delivery.deliveryId, item.productRowId])) ?? 0);
        }).length;
        if (remainingCount) results.push({
          id: `partner:${sale.id}:${delivery.deliveryId}`, customerId: sale.customerId, sourceKind: 'PARTNER_CASE',
          owner: view.data.owner, deliveryId: delivery.deliveryId, projectName: delivery.destination, address: delivery.destination,
          date: delivery.date, contractNumber: sale.customerContract.contractNumber, remainingCount,
        });
      }
    }
    return results;
  });

/** Creates the existing Logistics loading aggregate, owned by one canonical
 * Case delivery. Draft creation does not reserve quantities or approve prices. */
export const createPartnerCaseLoading = (prisma: Database, input: PartnerLoadingActor & {
  expected: RevisionRef; deliveryId: string; idempotencyKey: string;
}): Promise<Result<{ loadingId: string; replayed: boolean }>> => serializable(prisma, async tx => {
  if (!validLoadingActor(input) || !RevisionRefSchema.safeParse(input.expected).success ||
      !IdSchema.safeParse(input.deliveryId).success || !IdSchema.safeParse(input.idempotencyKey).success) return partnerFailure('INVALID_PAYLOAD');
  await lockPartnerOperationsControl(tx);
  await tx.$queryRaw`SELECT id FROM partner_sale_cases WHERE id = ${input.expected.caseId} FOR UPDATE`;
  const authorized = await authorizePartnerLoading(tx, input, input.expected.caseId, 'CREATE');
  if (!authorized.ok) return authorized;
  const adapter = createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: tx, ...input }));
  const source = await adapter.readLoadingSource(input.expected, input.deliveryId);
  if (!source.ok) return source;
  const identity = { actorId: input.actorId, operation: 'PARTNER_LOADING_CREATE', targetScope: input.expected.caseId, key: input.idempotencyKey };
  const payloadHash = await canonicalHash({ operation: identity.operation, expected: input.expected, deliveryId: input.deliveryId });
  const previous = await tx.partnerCommandOutcome.findUnique({ where: { actorId_operation_targetScope_key: identity } });
  if (previous) {
    if (previous.payloadHash !== payloadHash) return partnerFailure('IDEMPOTENCY_CONFLICT');
    const outcome = previous.outcome as Prisma.JsonObject;
    const loading = typeof outcome?.loadingId === 'string' ? await tx.logisticsLoading.findUnique({ where: { id: outcome.loadingId } }) : null;
    if (!loading || loading.sourceKind !== 'PARTNER_CASE' || loading.partnerCaseId !== input.expected.caseId ||
        loading.partnerCaseRevision !== input.expected.revision || loading.partnerIntegrityHash !== input.expected.integrityHash ||
        loading.partnerDeliveryId !== input.deliveryId || loading.customerId !== source.value.recipient.customerId || loading.projectId !== null ||
        loading.partnerSourceHash !== await canonicalHash(source.value) ||
        canonicalJson(loading.partnerSourceSnapshot) !== canonicalJson(source.value)) return partnerFailure('INTEGRITY_CONFLICT');
    return { ok: true, value: { loadingId: loading.id, replayed: true } };
  }
  const caseRow = await tx.partnerSaleCase.findUniqueOrThrow({ where: { id: input.expected.caseId }, select: { profileId: true } });
  const rollout = await authorizePartnerTechnicalRollout(tx, caseRow.profileId, 'COMMITTED_FULFILLMENT');
  if (!rollout.ok) return rollout;
  if (await partnerPredecessorIsFrozen(tx, input.expected.caseId, input.expected.revision)) return partnerFailure('STATE_CONFLICT');
  await assertCanonicalDispatchCommandAllowed(tx);
  const loading = await tx.logisticsLoading.create({ data: { loadingNumber: await allocateLoadingNumber(tx),
    sourceKind: 'PARTNER_CASE', customerId: source.value.recipient.customerId,
    partnerCaseId: input.expected.caseId, partnerCaseRevision: input.expected.revision,
    partnerIntegrityHash: input.expected.integrityHash, partnerDeliveryId: input.deliveryId,
    partnerSourceSnapshot: json(source.value), partnerSourceHash: await canonicalHash(source.value), createdBy: input.actorId } });
  await tx.partnerCommandOutcome.create({ data: { id: `partner-loading:${(await canonicalHash(identity)).slice(10)}`,
    ...identity, payloadHash, outcome: { loadingId: loading.id } } });
  await appendAudit(tx, { aggregateType: 'LOGISTICS_LOADING', aggregateId: loading.id, eventType: 'LOADING_CREATED',
    actorId: input.actorId, payload: { sourceKind: 'PARTNER_CASE', owner: input.expected, deliveryId: input.deliveryId,
      sourceHash: loading.partnerSourceHash, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey,
      reason: input.reason ?? null, effectiveAuthority: authorized.value } });
  return { ok: true, value: { loadingId: loading.id, replayed: false } };
});

export const readPartnerCaseLoading = (prisma: Database, input: PartnerLoadingActor & {
  loadingId: string;
}): Promise<Result<PartnerLoadingRead>> => serializable(prisma, async tx => {
  if (!validLoadingActor(input) || !IdSchema.safeParse(input.loadingId).success) return partnerFailure('INVALID_PAYLOAD');
  await lockPartnerOperationsControl(tx);
  const loading = await tx.logisticsLoading.findUnique({ where: { id: input.loadingId }, include: {
    partnerCase: { select: { customerContract: { select: { contractNumber: true } } } },
    guardQueueTurns: { where: { driverSource: 'PERSONAL_PICKUP', status: 'RESERVED_FOR_LOADING' }, select: { id: true } },
  } });
  if (!loading || loading.sourceKind !== 'PARTNER_CASE' || !loading.partnerCaseId) return partnerFailure('NOT_FOUND');
  const authorized = await authorizePartnerLoading(tx, input, loading.partnerCaseId, 'READ');
  if (!authorized.ok) return authorized;
  const expected = RevisionRefSchema.safeParse({ caseId: loading.partnerCaseId,
    revision: loading.partnerCaseRevision, integrityHash: loading.partnerIntegrityHash });
  if (!expected.success || !loading.partnerDeliveryId) return partnerFailure('INTEGRITY_CONFLICT');
  const source = await createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: tx, ...input }))
    .readLoadingEvidence(expected.data, loading.partnerDeliveryId);
  if (!source.ok) return source;
  if (loading.partnerSourceHash !== await canonicalHash(source.value) ||
      canonicalJson(loading.partnerSourceSnapshot) !== canonicalJson(source.value)) return partnerFailure('INTEGRITY_CONFLICT');
  const allocations = await readPartnerAllocationDrafts(tx, input, loading.id, source.value);
  if (!allocations.ok) return allocations;
  return { ok: true, value: { loadingId: loading.id, loadingNumber: loading.loadingNumber, status: loading.status,
    contractNumber: loading.partnerCase?.customerContract?.contractNumber ?? '',
    personalTurnId: loading.guardQueueTurns[0]?.id ?? null, source: source.value, allocations: allocations.value } };
});

const bindRevisionPricing = async (tx: Tx, input: {
  allocationRevisionId: string;
  finalizedAt: Date;
  actorId: string;
  scope: { customerId: string; projectId: string; destination: string };
  expectedCurrency: string;
  lines: Array<{
    allocationRevisionLineId: string;
    contractId: string;
    contractItemId: string;
    productRowId: string;
    quantity: string;
    unit: string;
  }>;
}) => {
  try {
    const port = createPrismaAllocationPricingBindingPort(tx);
    const binding = await bindFinalizedAllocationPricing(port, input);
    if (binding.path === 'LEGACY_WAYBILL_ONLY') {
      // Preserve the old document path/cutover, but freeze authoritative prices
      // before sealing this new revision so its sales invoice can be issued.
      return { ...binding, ...await bindApprovedAllocationPriceEvidence(port, input) };
    }
    return binding;
  } catch (error) {
    if (error instanceof AllocationPricingBindingError) throw new DispatchAllocationConflictError(error.message);
    throw error;
  }
};
export const dispatchAllocationLifecycleAuditHash = (input: { aggregateType: string; aggregateId: string; eventType: string;
  payload: unknown; actorId: string; recordedAt: Date; previousHash: string | null }) => digest(input);

type FinalizedAllocationRow = {
  sourceContractId: string; sourceContractItemId: string; productRowId: string; productId: string;
  quantity: Prisma.Decimal; unit: string; snapshot: unknown;
};
type PartnerFinalizedAllocationRow = {
  sourceKind: 'PARTNER_CASE'; sourceContractId: null; sourceContractItemId: null; productId: null;
  partnerCaseId: string; partnerCaseRevision: number; partnerIntegrityHash: string;
  partnerDeliveryId: string; partnerLineageId: string; productRowId: string;
  quantity: Prisma.Decimal; unit: string; snapshot: unknown;
};
type PricingBindingResult = { path: 'LEGACY_WAYBILL_ONLY' | 'ATOMIC_WAYBILL_STATEMENT';
  pricingVersionIds: string[]; eventIntegrityHashes: string[] };

const persistFinalizedAllocationRevision = async (tx: Tx, input: {
  revisionData: Prisma.LogisticsAllocationRevisionUncheckedCreateInput;
  rows: FinalizedAllocationRow[] | PartnerFinalizedAllocationRow[];
  loadingLines: Map<string, string>;
  actorId: string;
  scope?: { customerId: string; projectId: string; destination: string };
  expectedCurrency: string;
  finalizedAt: Date;
  revisionEventType: string;
  idempotencyKey: string;
  effectiveAuthority: unknown;
  partnerPricing?: LockedPartnerApprovedPricingVersion & { preparationEvidenceHash: string };
  revisionAuditPayload: (result: { candidateId: string; snapshotHash: string; pricingBinding: PricingBindingResult }) => unknown;
  afterRevisionCreated?: (revision: { id: string }) => Promise<void>;
}) => {
  const revision = await tx.logisticsAllocationRevision.create({ data: input.revisionData });
  if (input.afterRevisionCreated) await input.afterRevisionCreated(revision);
  const pricedLines: Array<{
    allocationRevisionLineId: string; contractId: string; contractItemId: string;
    productRowId: string; quantity: string; unit: string;
  }> = [];
  const partnerPricedLines: PartnerPricedRevisionLine[] = [];
  for (const line of input.rows) {
    if ('sourceKind' in line) {
      const lineSnapshot = stableValue({ revisionId: revision.id, sourceKind: line.sourceKind,
        owner: { caseId: line.partnerCaseId, revision: line.partnerCaseRevision, integrityHash: line.partnerIntegrityHash },
        deliveryId: line.partnerDeliveryId, lineageId: line.partnerLineageId, productRowId: line.productRowId,
        quantity: exactQuantityText(line.quantity), unit: line.unit, snapshot: line.snapshot });
      const revisionLine = await tx.logisticsAllocationRevisionLine.create({ data: { revisionId: revision.id,
        sourceKind: 'PARTNER_CASE', sourceContractId: null, sourceContractItemId: null, productId: null,
        partnerCaseId: line.partnerCaseId, partnerCaseRevision: line.partnerCaseRevision,
        partnerIntegrityHash: line.partnerIntegrityHash, partnerDeliveryId: line.partnerDeliveryId,
        partnerLineageId: line.partnerLineageId, productRowId: line.productRowId,
        quantity: line.quantity, unit: line.unit, snapshot: json(line.snapshot), integrityHash: digest(lineSnapshot) } });
      partnerPricedLines.push({ sourceKind: 'PARTNER_CASE', caseId: line.partnerCaseId,
        internalRecordId: String(input.revisionData.partnerInternalRecordId), allocationRevisionLineId: revisionLine.id,
        productRowId: line.productRowId, quantity: exactQuantityText(line.quantity), unit: line.unit });
      const evidence = { id: revisionLine.id, sourceKind: 'PARTNER_CASE' as const, contractId: null, contractItemId: null,
        partnerCaseId: line.partnerCaseId, partnerLineageId: line.partnerLineageId,
        partnerCaseRevision: line.partnerCaseRevision, partnerIntegrityHash: line.partnerIntegrityHash,
        productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_FINALIZED' as const,
        quantity: exactQuantityText(line.quantity), effectiveAt: input.finalizedAt.toISOString(), recordedAt: input.finalizedAt.toISOString(),
        sourceType: 'PARTNER_LOGISTICS_ALLOCATION_REVISION', sourceId: revisionLine.id, sourceVersion: 1,
        integrityHash: '', metadata: { loadingId: input.revisionData.loadingId, revisionId: revision.id,
          deliveryId: line.partnerDeliveryId } };
      evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
      await tx.shipmentQuantityEvidence.create({ data: { sourceKind: 'PARTNER_CASE', contractId: null, contractItemId: null,
        partnerCaseId: line.partnerCaseId, partnerLineageId: line.partnerLineageId,
        partnerCaseRevision: line.partnerCaseRevision, partnerIntegrityHash: line.partnerIntegrityHash,
        productRowId: line.productRowId, unit: line.unit, kind: evidence.kind, quantity: line.quantity,
        effectiveAt: input.finalizedAt, recordedAt: input.finalizedAt, sourceType: evidence.sourceType,
        sourceId: evidence.sourceId, sourceVersion: 1, integrityHash: evidence.integrityHash, metadata: json(evidence.metadata) } });
      continue;
    }
    const lineSnapshot = stableValue({ revisionId: revision.id, contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
      quantity: exactQuantityText(line.quantity), unit: line.unit, snapshot: line.snapshot });
    const revisionLine = await tx.logisticsAllocationRevisionLine.create({ data: {
      revisionId: revision.id, sourceContractId: line.sourceContractId, sourceContractItemId: line.sourceContractItemId,
      productRowId: line.productRowId, productId: line.productId, quantity: line.quantity, unit: line.unit,
      snapshot: json(line.snapshot || {}), integrityHash: digest(lineSnapshot),
    } });
    pricedLines.push({ allocationRevisionLineId: revisionLine.id, contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId,
      quantity: exactQuantityText(line.quantity), unit: line.unit });
    const evidence = { id: revisionLine.id, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
      productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_FINALIZED' as const,
      quantity: exactQuantityText(line.quantity), effectiveAt: input.finalizedAt.toISOString(), recordedAt: input.finalizedAt.toISOString(),
      sourceType: 'LOGISTICS_ALLOCATION_REVISION', sourceId: revisionLine.id, sourceVersion: 1, integrityHash: '',
      metadata: { loadingId: input.revisionData.loadingId, revisionId: revision.id,
        loadingLineId: input.loadingLines.get(line.sourceContractItemId) || null } };
    evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
    await tx.shipmentQuantityEvidence.create({ data: { contractId: evidence.contractId,
      contractItemId: evidence.contractItemId, productRowId: evidence.productRowId, unit: evidence.unit,
      kind: evidence.kind, quantity: line.quantity, effectiveAt: input.finalizedAt, recordedAt: input.finalizedAt,
      sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
      integrityHash: evidence.integrityHash, metadata: json(evidence.metadata) } });
  }
  let pricingBinding: PricingBindingResult;
  if (input.partnerPricing) {
    const pricing = input.partnerPricing;
    const reference = await tx.partnerAllocationRevisionPricing.create({ data: { allocationRevisionId: revision.id,
      caseId: pricing.caseId, caseRevision: Number(input.revisionData.partnerCaseRevision),
      integrityHash: String(input.revisionData.partnerIntegrityHash), internalRecordId: pricing.internalRecordId,
      sourceFinancialRecordId: pricing.sourceFinancialRecordId, financialApprovalEvidenceId: pricing.id,
      preparationEvidenceHash: pricing.preparationEvidenceHash, readinessEvidenceHash: pricing.readinessEvidenceHash,
      currency: pricing.currency, grossAmount: pricing.grossAmount, discountAmount: pricing.discountAmount,
      netAmount: pricing.netAmount, pricingIntegrityHash: pricing.integrityHash } });
    const priorRows = await tx.partnerPricedAllocationEvent.findMany({ where: {
      approvalEvidenceId: { in: pricing.rows.map(row => row.id) },
      pricingReference: { caseId: pricing.caseId, internalRecordId: pricing.internalRecordId } },
      include: { allocationRevisionLine: true, pricingReference: true }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    const prior = priorRows.map(row => {
      const sequence = Number((row.evidence as Prisma.JsonObject).ledgerSequence);
      const payload = { sourceKind: 'PARTNER_CASE' as const, caseId: row.pricingReference.caseId,
        internalRecordId: row.pricingReference.internalRecordId,
        allocationRevisionLineId: row.allocationRevisionLineId, productRowId: row.allocationRevisionLine.productRowId,
        quantity: exactQuantityText(row.quantity), unit: row.allocationRevisionLine.unit,
        pricingVersionId: row.pricingReference.financialApprovalEvidenceId, pricingRowId: row.approvalEvidenceId,
        grossAmount: row.grossAmount.toFixed(12), discountAmount: row.discountAmount.toFixed(12),
        netAmount: row.netAmount.toFixed(12), consumesFinalRemainder: row.consumesFinalRemainder,
        evidence: row.evidence, recordedBy: row.recordedBy };
      return { pricingRowId: row.approvalEvidenceId, pricingVersionId: row.pricingReference.financialApprovalEvidenceId,
        quantity: payload.quantity, grossAmount: payload.grossAmount, discountAmount: payload.discountAmount,
        ledgerSequence: sequence, integrityVerified: Number.isSafeInteger(sequence) && sequence > 0 &&
          row.integrityHash === pricedAllocationIntegrityHash(payload) };
    });
    const calculated = allocatePricedRevision({ versions: [pricing], priorEvents: prior, lines: partnerPricedLines });
    const partnerEventHashes: string[] = [];
    for (const event of calculated.events) {
      const { ledgerSequence: _sequence, ...hashPayload } = event;
      const payload = { ...hashPayload, recordedBy: input.actorId };
      const eventHash = pricedAllocationIntegrityHash(payload);
      partnerEventHashes.push(eventHash);
      const stored = await tx.partnerPricedAllocationEvent.create({ data: { allocationRevisionLineId: event.allocationRevisionLineId,
        pricingReferenceId: reference.id, approvalEvidenceId: event.pricingRowId, quantity: event.quantity,
        grossAmount: event.grossAmount, discountAmount: event.discountAmount, netAmount: event.netAmount,
        consumesFinalRemainder: event.consumesFinalRemainder, evidence: json(event.evidence), integrityHash: eventHash,
        recordedAt: input.finalizedAt, recordedBy: input.actorId } });
      await appendAudit(tx, { aggregateType: 'PRICED_ALLOCATION_EVENT', aggregateId: stored.id,
        eventType: 'PRICED_ALLOCATION_RECORDED', actorId: input.actorId, recordedAt: input.finalizedAt,
        payload: { workspace: 'logistics', effectiveAuthority: input.effectiveAuthority,
          reason: 'Finalized Partner allocation pricing', correlationId: `${revision.id}:${input.idempotencyKey}`,
          idempotencyKey: input.idempotencyKey, before: { state: 'UNPRICED' }, after: { state: 'PRICED' },
          allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash,
          financialApprovalEvidenceId: pricing.id, approvalEvidenceId: event.pricingRowId,
          pricedEventIntegrityHash: eventHash } });
    }
    pricingBinding = { path: 'ATOMIC_WAYBILL_STATEMENT', pricingVersionIds: [pricing.id],
      eventIntegrityHashes: partnerEventHashes };
  } else {
    if (!input.scope) throw new DispatchAllocationConflictError('Ordinary allocation pricing scope is missing.');
    pricingBinding = await bindRevisionPricing(tx, { allocationRevisionId: revision.id,
      finalizedAt: input.finalizedAt, actorId: input.actorId, scope: input.scope,
      expectedCurrency: input.expectedCurrency, lines: pricedLines });
  }
  if (pricingBinding.eventIntegrityHashes.length > 0) {
    const events = await tx.dispatchPricedAllocationEvent.findMany({ where: { allocationRevisionId: revision.id },
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    for (const event of events) await appendAudit(tx, { aggregateType: 'PRICED_ALLOCATION_EVENT', aggregateId: event.id,
      eventType: 'PRICED_ALLOCATION_RECORDED', actorId: input.actorId, recordedAt: event.recordedAt,
      payload: { workspace: 'logistics', effectiveAuthority: input.effectiveAuthority,
        reason: 'Finalized allocation pricing', correlationId: `${revision.id}:${input.idempotencyKey}`,
        idempotencyKey: input.idempotencyKey, before: { state: 'UNPRICED' }, after: { state: 'PRICED' },
        allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash,
        pricingVersionId: event.pricingVersionId, pricingRowId: event.pricingRowId,
        pricedEventIntegrityHash: event.integrityHash } });
  }
  await tx.logisticsAllocationRevision.update({ where: { id: revision.id }, data: { sealedAt: input.finalizedAt } });
  const candidate = await tx.accountingDispatchCandidate.create({ data: {
    allocationRevisionId: revision.id, createdAt: input.finalizedAt, workItem: { create: { createdAt: input.finalizedAt } },
  } });
  const workItem = await tx.accountingDispatchWorkItem.findUniqueOrThrow({ where: { candidateId: candidate.id } });
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidate.id,
    eventType: 'CANDIDATE_CREATED', payload: { allocationRevisionId: revision.id, workItemId: workItem.id,
      predecessorRevisionId: input.revisionData.predecessorRevisionId || null },
    actorId: input.actorId, recordedAt: input.finalizedAt });
  await appendAudit(tx, { aggregateType: 'LOGISTICS_ALLOCATION_REVISION', aggregateId: revision.id,
    eventType: input.revisionEventType,
    payload: input.revisionAuditPayload({ candidateId: candidate.id, snapshotHash: revision.integrityHash, pricingBinding }),
    actorId: input.actorId, recordedAt: input.finalizedAt });
  return { revision, candidate, pricingBinding };
};

const appendAudit = async (tx: Tx, input: {
  aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; recordedAt?: Date;
}) => {
  const recordedAt = input.recordedAt || new Date();
  const previous = await tx.dispatchLifecycleAudit.findFirst({
    where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
  });
  const payload = stableValue(input.payload || {});
  return tx.dispatchLifecycleAudit.create({ data: {
    aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType,
    payload: payload as Prisma.InputJsonValue, actorId: input.actorId, recordedAt,
    previousHash: previous?.eventHash || null,
    eventHash: dispatchAllocationLifecycleAuditHash({ aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType,
      payload, actorId: input.actorId, recordedAt, previousHash: previous?.eventHash || null }),
  } });
};

const revokeActiveExitAuthorization = async (tx: Tx, input: {
  waybillId: string; actorId: string; reason: string; eventType: string; at: Date; effectiveAuthority: unknown;
}) => {
  const authorization = await tx.dispatchExitAuthorization.findFirst({ where: { waybillId: input.waybillId, status: 'ACTIVE' } });
  if (!authorization) return;
  await lockKeys(tx, [`DISPATCH_EXIT_AUTHORIZATION:${authorization.id}`]);
  const revoked = await tx.dispatchExitAuthorization.updateMany({ where: { id: authorization.id, status: 'ACTIVE' }, data: {
    status: 'REVOKED', revokedAt: input.at, revokedBy: input.actorId, revocationReason: input.reason,
  } });
  if (revoked.count !== 1) throw new DispatchAllocationConflictError('The authorization was finalized by a competing command.');
  await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: authorization.id,
    eventType: input.eventType, payload: { workspace: 'accounting', effectiveAuthority: input.effectiveAuthority,
      beforeStatus: 'ACTIVE', afterStatus: 'REVOKED', waybillId: input.waybillId,
      sessionId: authorization.sessionId, authorizationIntegrityHash: authorization.integrityHash,
      reason: input.reason, correlationId: input.waybillId }, actorId: input.actorId, recordedAt: input.at });
};

const normalizeConfirmationPhone = (phoneNumber: string) => {
  let digits = phoneNumber.replace(/\D/g, '');
  if (digits.startsWith('0098')) digits = digits.slice(4);
  else if (digits.startsWith('98')) digits = digits.slice(2);
  if (digits.length === 10 && digits.startsWith('9')) digits = `0${digits}`;
  return digits;
};

export const resolveRevisionConfirmationPhone = async (tx: Tx, contractIds: string[]) => {
  const uniqueContractIds = [...new Set(contractIds)];
  const contracts = await tx.salesContract.findMany({ where: { id: { in: uniqueContractIds } },
    include: { customer: { include: { phoneNumbers: { where: { isActive: true }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] }, primaryContact: true } } } });
  const byId = new Map(contracts.map(contract => [contract.id, contract]));
  const confirmations = await tx.contractPublicConfirmation.findMany({
    where: { contractId: { in: uniqueContractIds }, status: 'CONFIRMED', verifiedAt: { not: null } },
    select: { contractId: true, commercialRevision: true, phoneNumber: true, verifiedAt: true, createdAt: true },
    orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const latestByContract = new Map<string, string>();
  const evidence: Array<{ contractId: string; commercialRevision: number | null; source: string; phoneVerified: boolean }> = [];
  for (const confirmation of confirmations) {
    const contract = byId.get(confirmation.contractId);
    if (contract && isOrdinaryCommercialFlow(contract) && confirmation.commercialRevision !== contract.commercialRevision) continue;
    if (!latestByContract.has(confirmation.contractId)) {
      latestByContract.set(confirmation.contractId, normalizeConfirmationPhone(confirmation.phoneNumber));
      evidence.push({ contractId: confirmation.contractId, commercialRevision: confirmation.commercialRevision,
        source: 'CONTRACT_PUBLIC_CONFIRMATION', phoneVerified: true });
    }
  }
  for (const contract of contracts) {
    if (!isOrdinaryCommercialFlow(contract) || contract.customerAcceptanceMethod !== 'PAPER'
      || contract.customerAcceptanceRevision !== contract.commercialRevision || latestByContract.has(contract.id)) continue;
    // A paper signature does not verify a phone. Notification uses the current Customer contact separately.
    const candidates = [...contract.customer.phoneNumbers.map(phone => phone.number), contract.customer.primaryContact?.mobile];
    const phone = candidates.filter((value): value is string => Boolean(value)).map(normalizeConfirmationPhone)
      .find(value => /^09\d{9}$/.test(value));
    if (phone) {
      latestByContract.set(contract.id, phone);
      evidence.push({ contractId: contract.id, commercialRevision: contract.commercialRevision,
        source: 'CURRENT_CUSTOMER_CONTACT', phoneVerified: false });
    }
  }
  const phones = [...new Set(latestByContract.values())].filter(Boolean);
  if (phones.length > 1) throw new DispatchAllocationConflictError('Allocation rows have conflicting confirmed buyer notification phones. Split the allocation or reconcile confirmations.');
  return { confirmationPhone: phones[0] || null,
    source: evidence.some(item => !item.phoneVerified) ? 'CURRENT_CUSTOMER_CONTACT' : 'CONTRACT_PUBLIC_CONFIRMATION', evidence };
};

export type CanonicalAllocationLineInput = {
  sourceContractItemId: string;
  quantity: string | number;
  unit?: string;
  pieceCount?: string | number | null;
};

const loadedPieceEvidence = (line: CanonicalAllocationLineInput) => {
  const value = String(line.pieceCount ?? '').trim();
  if (!/^\d+(?:\.0+)?$/.test(value)) return {};
  const count = new ExactQuantityDecimal(value);
  return count.gt(0) ? { loadedPieceCount: count.toFixed() } : {};
};

export const saveCanonicalAllocationDraft = async (prisma: Database, input: {
  loadingId: string; queueTurnId: string; lines: Array<CanonicalAllocationLineInput | PartnerAllocationLineInput>; actorId: string;
  expected?: RevisionRef; correlationId?: string; reason?: string;
}) => serializable(prisma, async (tx) => {
  const actor = { ...input, correlationId: input.correlationId || randomUUID() };
  const source = await preparePartnerLoadingQueueChange(tx, actor, 'ALLOCATE');
  if (!source.ok) return { partnerFailure: source.error };
  if (source.value.sourceKind === 'PARTNER_CASE' && !validLoadingActor(actor)) return { partnerFailure: partnerError('INVALID_PAYLOAD') };
  await assertCanonicalDispatchCommandAllowed(tx);
  await lockKeys(tx, [`GUARD_QUEUE:${input.queueTurnId}`, `LOGISTICS_LOADING:${input.loadingId}`]);
  const [loading, turn] = await Promise.all([
    tx.logisticsLoading.findUnique({ where: { id: input.loadingId } }),
    tx.guardDriverQueueTurn.findUnique({ where: { id: input.queueTurnId } }),
  ]);
  if (!loading) throw new DispatchAllocationValidationError('Loading was not found.');
  if (!turn) throw new DispatchAllocationValidationError('Canonical queue turn was not found.');
  if (loading.status !== 'DRAFT') throw new DispatchAllocationConflictError('Only a draft loading can be allocated.');
  if (turn.status !== GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING || turn.loadingId !== loading.id) {
    throw new DispatchAllocationConflictError('The canonical queue turn must be reserved by this loading.');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DispatchAllocationValidationError('At least one allocation line is required.');
  let rows: Array<Omit<Prisma.LogisticsAllocationDraftLineCreateManyInput, 'draftId'>>;
  if (source.value.sourceKind === 'PARTNER_CASE') {
    const selected = await createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: tx, ...actor }))
      .readLoadingSource(source.value.owner, source.value.deliveryId);
    if (!selected.ok) return { partnerFailure: selected.error };
    const built = await buildPartnerAllocationDraftRows(selected.value, input.lines);
    if (!built.ok) return { partnerFailure: built.error };
    rows = built.value;
  } else {
  if (input.lines.some(line => !('sourceContractItemId' in line))) throw new DispatchAllocationValidationError('Ordinary allocations require contract rows.');
  const ordinaryLines = input.lines as CanonicalAllocationLineInput[];
  const ids = ordinaryLines.map((line) => required(line.sourceContractItemId, 'sourceContractItemId'));
  const items = await tx.contractItem.findMany({ where: { id: { in: ids }, retiredAt: null }, include: { contract: true, product: true } });
  await assertOrdinaryContractsDispatchEligible(tx, items.map(item => item.contractId), DispatchAllocationConflictError);
  const byId = new Map(items.map((item) => [item.id, item]));
  rows = ordinaryLines.map((line) => {
    const item = byId.get(line.sourceContractItemId);
    if (!item) throw new DispatchAllocationValidationError(`Contract row ${line.sourceContractItemId} was not found.`);
    if (item.contract.customerId !== loading.customerId) throw new DispatchAllocationValidationError('Allocation rows must belong to the loading customer.');
    if (!item.productRowId) throw new DispatchAllocationConflictError('Allocation rows require a stable productRowId.');
    return {
      sourceContractId: item.contractId, sourceContractItemId: item.id, productRowId: item.productRowId,
      productId: item.productId, quantity: quantity(line.quantity), unit: required(line.unit || 'count', 'unit'),
      snapshot: json({ contractNumber: item.contract.contractNumber, contractItemId: item.id, productRowId: item.productRowId,
        productId: item.productId, productName: item.product.namePersian || item.product.name, ...loadedPieceEvidence(line) }),
    };
  });
  }
  // Preserve ordinary-to-ordinary draft transfer, but never reassign a private
  // draft when its physical queue turn is reused by another loading.
  const ordinaryPrevious = source.value.sourceKind === 'SALES_CONTRACT'
    ? await tx.logisticsAllocationDraft.findFirst({ where: { queueTurnId: turn.id, loading: { sourceKind: 'SALES_CONTRACT' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], select: { id: true } }) : null;
  const draft = await tx.logisticsAllocationDraft.upsert({
    where: ordinaryPrevious ? { id: ordinaryPrevious.id } : { loadingId_queueTurnId: { loadingId: loading.id, queueTurnId: turn.id } },
    create: { loadingId: loading.id, queueTurnId: turn.id, createdBy: input.actorId },
    update: { loadingId: loading.id },
  });
  await tx.logisticsAllocationDraftLine.deleteMany({ where: { draftId: draft.id } });
  await tx.logisticsAllocationDraftLine.createMany({ data: rows.map((row) => ({ ...row, draftId: draft.id })) });
  await appendAudit(tx, { aggregateType: 'LOGISTICS_ALLOCATION_DRAFT', aggregateId: draft.id,
    eventType: 'DRAFT_SAVED', payload: { loadingId: loading.id, queueTurnId: turn.id, lines: rows }, actorId: input.actorId });
  return tx.logisticsAllocationDraft.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true, queueTurn: true } });
}).then(outcome => {
  if ('partnerFailure' in outcome) throw new PartnerLoadingCommandError(outcome.partnerFailure);
  return outcome;
});

export const refreshProjectionContracts = async (tx: Tx, contractIds: string[]) => {
  for (const contractId of [...new Set(contractIds)]) {
    const projection = await readShipmentQuantityProjection(tx as unknown as PrismaClient, { contractId });
    for (const row of projection.rows) {
      await tx.shipmentQuantityProjection.upsert({
        where: { contractItemId: row.contractItemId },
        create: { contractItemId: row.contractItemId, contractId: row.contractId, ...shipmentProjectionPersistenceData(row) },
        update: shipmentProjectionPersistenceData(row),
      });
    }
  }
};

const ordinaryDraftLine = (line: Prisma.LogisticsAllocationDraftLineGetPayload<object>) => {
  if (line.sourceKind !== 'SALES_CONTRACT' || !line.sourceContractId || !line.sourceContractItemId || !line.productId ||
      line.partnerCaseId !== null || line.partnerCaseRevision !== null || line.partnerIntegrityHash !== null ||
      line.partnerDeliveryId !== null || line.partnerLineageId !== null) {
    throw new DispatchAllocationConflictError('An ordinary loading cannot contain Partner allocation rows.');
  }
  return { sourceContractId: line.sourceContractId, sourceContractItemId: line.sourceContractItemId,
    productRowId: line.productRowId, productId: line.productId, quantity: line.quantity,
    unit: line.unit, snapshot: line.snapshot };
};

const finalizePartnerLoadingAllocations = async (tx: Tx, input: {
  loadingId: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}, source: PartnerLoadingSource, pricing: LockedPartnerApprovedPricingVersion & { preparationEvidenceHash: string }) => {
  const previous = await tx.logisticsAllocationBatch.findUnique({
    where: { loadingId_idempotencyKey: { loadingId: input.loadingId, idempotencyKey: input.idempotencyKey } },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } },
  });
  if (previous) return previous;
  await assertPartnerCommercialDispatchEligible(tx, [source.owner.caseId], DispatchAllocationConflictError);
  const loading = await tx.logisticsLoading.findUnique({ where: { id: input.loadingId }, include: {
    customer: true, canonicalAllocationDrafts: { include: { lines: true, queueTurn: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] } } });
  if (!loading || loading.sourceKind !== 'PARTNER_CASE' || loading.partnerCaseId !== source.owner.caseId ||
      loading.partnerDeliveryId !== source.deliveryId || loading.partnerSourceHash !== await canonicalHash(source) ||
      canonicalJson(loading.partnerSourceSnapshot) !== canonicalJson(source)) throw new DispatchAllocationConflictError('منبع بارگیری پرونده همکار تغییر کرده است.');
  if (loading.status !== 'DRAFT') throw new DispatchAllocationConflictError('فقط بارگیری پیش‌نویس قابل نهایی‌سازی است.');
  const active = loading.canonicalAllocationDrafts.filter(draft =>
    draft.queueTurn.loadingId === loading.id && draft.queueTurn.status === GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING);
  if (!active.length) throw new DispatchAllocationValidationError('حداقل یک تخصیص فعال راننده لازم است.');
  await lockKeys(tx, [...active.map(draft => `GUARD_QUEUE:${draft.queueTurnId}`),
    ...active.map(draft => `LOGISTICS_ALLOCATION_DRAFT:${draft.id}`),
    ...source.rows.map(row => `PARTNER_SHIPMENT_LINEAGE:${row.lineageId}`),
    ...pricing.rows.map(row => `PARTNER_APPROVED_PRICING_ROW:${row.id}`)]);
  await lockQueueTurns(tx, active.map(draft => draft.queueTurnId));
  const locked = await tx.logisticsAllocationDraft.findMany({ where: { id: { in: active.map(draft => draft.id) } },
    include: { lines: true, queueTurn: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
  if (locked.length !== active.length) throw new DispatchAllocationConflictError('تخصیص راننده در هنگام نهایی‌سازی تغییر کرد.');
  const byRow = new Map(source.rows.map(row => [row.productRowId, row]));
  const requested = new Map<string, Prisma.Decimal>();
  for (const draft of locked) {
    if (draft.queueTurn.loadingId !== loading.id || draft.queueTurn.status !== GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING ||
        !await isGuardQueueTurnCurrentlyReady(tx, draft.queueTurn) || !draft.lines.length) {
      throw new DispatchAllocationConflictError('راننده یا وسیله نقلیه دیگر آماده نیست.');
    }
    for (const line of draft.lines) {
      const canonical = byRow.get(line.productRowId);
      if (line.sourceKind !== 'PARTNER_CASE' || line.partnerCaseId !== source.owner.caseId ||
          line.partnerCaseRevision !== source.owner.revision || line.partnerIntegrityHash !== source.owner.integrityHash ||
          line.partnerDeliveryId !== source.deliveryId || line.partnerLineageId !== canonical?.lineageId ||
          line.sourceContractId !== null || line.sourceContractItemId !== null || line.productId !== null ||
          line.unit !== canonical.unit || line.quantity.lte(0)) throw new DispatchAllocationConflictError('شواهد ردیف تخصیص با تحویل انتخابی همخوان نیست.');
      requested.set(line.productRowId, (requested.get(line.productRowId) || new ExactQuantityDecimal(0)).add(line.quantity));
    }
  }
  const projection = await readPartnerShipmentQuantityProjection(tx, source.owner.caseId);
  for (const [productRowId, amount] of requested) {
    const selected = byRow.get(productRowId)!;
    const balance = projection.rows.find(row => row.productRowId === productRowId && row.unit === selected.unit);
    if (!balance || balance.health !== 'CURRENT' || !balance.quantities ||
        amount.gt(balance.quantities.availableToLoad) || amount.gt(selected.plannedQuantity)) {
      throw new DispatchAllocationConflictError('مقدار تخصیص از مانده معتبر یا تحویل انتخابی بیشتر است.');
    }
  }
  const priorDeliveryRows = await tx.logisticsAllocationRevisionLine.groupBy({ by: ['productRowId'], where: {
    sourceKind: 'PARTNER_CASE', partnerCaseId: source.owner.caseId, partnerDeliveryId: source.deliveryId,
    revision: { candidate: { status: { in: [AccountingDispatchCandidateStatus.PENDING, AccountingDispatchCandidateStatus.ACCEPTED] } } },
  },
    _sum: { quantity: true } });
  for (const prior of priorDeliveryRows) {
    const proposed = requested.get(prior.productRowId) || new ExactQuantityDecimal(0);
    const selected = byRow.get(prior.productRowId);
    if (!selected || proposed.add(prior._sum.quantity || 0).gt(selected.plannedQuantity)) {
      throw new DispatchAllocationConflictError('مقدار نهایی این تحویل از برنامه مصوب بیشتر است.');
    }
  }
  const now = (await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`)[0].now;
  const batch = await tx.logisticsAllocationBatch.create({ data: { loadingId: loading.id,
    idempotencyKey: input.idempotencyKey, finalizedAt: now, finalizedBy: input.actorId } });
  for (const draft of locked) {
    const prior = await tx.logisticsAllocationRevision.aggregate({ where: { loadingId: loading.id,
      queueTurnId: draft.queueTurnId }, _max: { revisionNumber: true } });
    const revisionNumber = (prior._max.revisionNumber || 0) + 1;
    const snapshot = stableValue({ schemaVersion: 1, sourceKind: 'PARTNER_CASE',
      ...(draft.queueTurn.driverSource === 'PERSONAL_PICKUP' ? { personalPickup: await personalPickupDisplayContext(tx, draft.lines) } : {}),
      loading: { id: loading.id, number: loading.loadingNumber,
        customer: { id: source.recipient.customerId, name: source.recipient.displayName },
        destination: source.recipient.destination, deliveryId: source.deliveryId, plannedDate: source.plannedDate },
      queueTurn: { id: draft.queueTurn.id, driverSource: draft.queueTurn.driverSource,
        admissionSnapshot: draft.queueTurn.admissionSnapshot, admissionIntegrityHash: draft.queueTurn.integrityHash },
      revisionNumber, finalizedAt: now,
      notification: { confirmationPhone: source.recipient.phone, source: 'PARTNER_VERIFIED_CUSTOMER_OUTPUT', capturedAt: now },
      lines: draft.lines.map(line => ({ productRowId: line.productRowId,
        lineageId: line.partnerLineageId, quantity: exactQuantityText(line.quantity), unit: line.unit,
        snapshot: line.snapshot })) });
    const rows: PartnerFinalizedAllocationRow[] = draft.lines.map(line => ({ sourceKind: 'PARTNER_CASE',
      sourceContractId: null, sourceContractItemId: null, productId: null,
      partnerCaseId: source.owner.caseId, partnerCaseRevision: source.owner.revision,
      partnerIntegrityHash: source.owner.integrityHash, partnerDeliveryId: source.deliveryId,
      partnerLineageId: line.partnerLineageId!, productRowId: line.productRowId,
      quantity: line.quantity, unit: line.unit, snapshot: line.snapshot }));
    await persistFinalizedAllocationRevision(tx, { revisionData: { sourceKind: 'PARTNER_CASE', batchId: batch.id,
      loadingId: loading.id, queueTurnId: draft.queueTurnId, revisionNumber, snapshot: json(snapshot),
      integrityHash: digest(snapshot), finalizedAt: now, finalizedBy: input.actorId,
      partnerCaseId: source.owner.caseId, partnerCaseRevision: source.owner.revision,
      partnerIntegrityHash: source.owner.integrityHash, partnerInternalRecordId: source.internalRecordId,
      partnerDeliveryId: source.deliveryId }, rows, loadingLines: new Map(), actorId: input.actorId,
      expectedCurrency: pricing.currency, finalizedAt: now, partnerPricing: pricing,
      revisionEventType: 'ALLOCATION_FINALIZED', idempotencyKey: input.idempotencyKey,
      effectiveAuthority: input.effectiveAuthority,
      revisionAuditPayload: ({ candidateId, snapshotHash, pricingBinding }) => ({ candidateId, snapshotHash,
        sourceKind: 'PARTNER_CASE', owner: source.owner, deliveryId: source.deliveryId,
        documentPath: pricingBinding.path, financialApprovalEvidenceId: pricing.id,
        pricedEventIntegrityHashes: pricingBinding.eventIntegrityHashes }) });
  }
  await tx.logisticsLoading.update({ where: { id: loading.id }, data: { status: 'FINALIZED', finalizedAt: now,
    finalizedBy: input.actorId } });
  for (const draft of locked) {
    const changed = await tx.guardDriverQueueTurn.updateMany({ where: { id: draft.queueTurnId,
      status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, loadingId: loading.id },
      data: { status: GuardDriverQueueTurnStatus.LOADING_FINALIZED, finalizedAt: now, finalizedBy: input.actorId } });
    if (changed.count !== 1) throw new DispatchAllocationConflictError('وضعیت نوبت راننده تغییر کرد.');
    await appendQueueEvent(tx, { turnId: draft.queueTurnId, eventType: 'LOADING_FINALIZED',
      fromStatus: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, toStatus: GuardDriverQueueTurnStatus.LOADING_FINALIZED,
      actorId: input.actorId, payload: { loadingId: loading.id, batchId: batch.id,
        source: { sourceKind: 'PARTNER_CASE', owner: source.owner, deliveryId: source.deliveryId,
          sourceHash: await canonicalHash(source) } } });
  }
  return tx.logisticsAllocationBatch.findUniqueOrThrow({ where: { id: batch.id },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } } });
};

export const finalizeCanonicalLoadingAllocations = async (prisma: Database, input: {
  loadingId: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
  expected?: RevisionRef; correlationId?: string; reason?: string;
}) => serializable(prisma, async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await lockKeys(tx, [`LOGISTICS_LOADING:${input.loadingId}`]);
  const sourceOwner = await tx.logisticsLoading.findUnique({ where: { id: input.loadingId }, select: { sourceKind: true } });
  if (sourceOwner?.sourceKind === 'PARTNER_CASE') {
    const source = await preparePartnerLoadingQueueChange(tx, { ...input,
      correlationId: input.correlationId || randomUUID() }, 'FINALIZE');
    if (!source.ok) return { partnerFailure: source.error };
    if (source.value.sourceKind !== 'PARTNER_CASE') return { partnerFailure: partnerError('INTEGRITY_CONFLICT') };
    const canonical = await createPartnerFulfillmentAdapter(createPrismaPartnerFulfillmentRepository({ database: tx,
      actorId: input.actorId, correlationId: input.correlationId || randomUUID(), reason: input.reason }))
      .readLoadingSource(source.value.owner, source.value.deliveryId);
    if (!canonical.ok) return { partnerFailure: canonical.error };
    let pricing;
    try { pricing = await readPartnerApprovedShipmentPricing(tx, canonical.value); }
    catch (error) {
      if (error instanceof PartnerShipmentPricingConflictError) throw new DispatchAllocationConflictError(error.message);
      throw error;
    }
    return finalizePartnerLoadingAllocations(tx, { loadingId: input.loadingId,
      idempotencyKey, actorId: input.actorId, effectiveAuthority: input.effectiveAuthority }, canonical.value, pricing);
  }
  const previous = await tx.logisticsAllocationBatch.findUnique({
    where: { loadingId_idempotencyKey: { loadingId: input.loadingId, idempotencyKey } },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } },
  });
  if (previous) return previous;

  const loading = await tx.logisticsLoading.findUnique({
    where: { id: input.loadingId },
    include: { customer: true, project: true, lines: true,
      canonicalAllocationDrafts: { include: { lines: true, queueTurn: true }, orderBy: { createdAt: 'asc' } } },
  });
  if (!loading) throw new DispatchAllocationValidationError('Loading was not found.');
  if (!loading.project) throw new DispatchAllocationConflictError('Ordinary loading project evidence is missing.');
  if (loading.status !== 'DRAFT') throw new DispatchAllocationConflictError('Only a draft loading can be finalized.');
  if (loading.canonicalAllocationDrafts.length === 0) throw new DispatchAllocationValidationError('At least one canonical driver allocation is required.');
  const initialDrafts = loading.canonicalAllocationDrafts.map(draft => ({ ...draft, lines: draft.lines.map(ordinaryDraftLine) }));
  const itemIds = initialDrafts.flatMap((draft) => draft.lines.map((line) => line.sourceContractItemId));
  const initialContractIds = [...new Set(initialDrafts
    .flatMap((draft) => draft.lines.map((line) => line.sourceContractId)))];
  const draftIds = loading.canonicalAllocationDrafts.map((draft) => draft.id);
  await lockKeys(tx, [
    ...loading.canonicalAllocationDrafts.map((draft) => `GUARD_QUEUE:${draft.queueTurnId}`),
    ...draftIds.map((id) => `LOGISTICS_ALLOCATION_DRAFT:${id}`),
    ...itemIds.map((id) => `SHIPMENT_CONTRACT_ITEM:${id}`),
    ...itemIds.map((id) => `SHIPMENT_EVIDENCE_HEAD:${id}`),
    ...itemIds.map((id) => `SHIPMENT_PROJECTION:${id}`),
    ...initialContractIds.map((id) => `APPROVED_PRICING_CONTRACT:${id}`),
  ]);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "logistics_allocation_drafts"
    WHERE "id" IN (${Prisma.join(draftIds.sort())}) ORDER BY "id" FOR UPDATE`);
  await lockQueueTurns(tx, loading.canonicalAllocationDrafts.map((draft) => draft.queueTurnId));
  await lockPricingContracts(tx, initialContractIds);
  await lockShipmentTruth(tx, itemIds);
  const refreshedDrafts = (await tx.logisticsAllocationDraft.findMany({ where: { id: { in: draftIds } },
    include: { lines: true, queueTurn: true }, orderBy: { createdAt: 'asc' } }))
    .map(draft => ({ ...draft, lines: draft.lines.map(ordinaryDraftLine) }));
  if (refreshedDrafts.length !== draftIds.length) throw new DispatchAllocationConflictError('An allocation draft changed during finalization.');
  const lockedItems = await tx.contractItem.findMany({ where: { id: { in: itemIds }, retiredAt: null }, include: { contract: true } });
  await assertOrdinaryContractsDispatchEligible(tx, lockedItems.map(item => item.contractId), DispatchAllocationConflictError);
  const lockedItemsById = new Map(lockedItems.map((item) => [item.id, item]));
  for (const line of refreshedDrafts.flatMap((draft) => draft.lines)) {
    const item = lockedItemsById.get(line.sourceContractItemId);
    if (!item || item.contractId !== line.sourceContractId || item.productRowId !== line.productRowId
      || item.productId !== line.productId || item.contract.customerId !== loading.customerId) {
      throw new DispatchAllocationConflictError(`Allocation draft row ${line.sourceContractItemId} changed after it was saved.`);
    }
  }
  const currencies = [...new Set(lockedItems.map((item) => item.contract.currency))];
  if (currencies.length !== 1) throw new DispatchAllocationConflictError('One allocation revision cannot mix contract currencies.');
  const allocationCurrency = currencies[0];
  const refreshedTurns = await tx.guardDriverQueueTurn.findMany({ where: { id: { in: refreshedDrafts.map((draft) => draft.queueTurnId) } } });
  const turns = new Map(refreshedTurns.map((turn) => [turn.id, turn]));
  for (const draft of refreshedDrafts) {
    const turn = turns.get(draft.queueTurnId);
    if (!turn || turn.status !== GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING || turn.loadingId !== loading.id) {
      throw new DispatchAllocationConflictError('Every allocation queue turn must still be reserved by this loading.');
    }
    if (!await isGuardQueueTurnCurrentlyReady(tx, turn)) throw new DispatchAllocationConflictError('A reserved driver or vehicle is no longer ready.');
    if (draft.lines.length === 0) throw new DispatchAllocationValidationError('Every driver allocation must contain a positive quantity.');
  }
  const contractIds = [...new Set(refreshedDrafts.flatMap((draft) => draft.lines.map((line) => line.sourceContractId)))];
  const available = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const contractId of contractIds) {
    const projection = await readShipmentQuantityProjection(tx as unknown as PrismaClient, { contractId });
    for (const row of projection.rows) {
      if (row.health !== 'CURRENT' || !row.quantities) throw new DispatchAllocationConflictError(`Shipment row ${row.contractItemId} is not current.`);
      available.set(row.contractItemId, { amount: new ExactQuantityDecimal(row.quantities.availableToLoad), unit: row.unit });
    }
  }
  const requested = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const line of refreshedDrafts.flatMap((draft) => draft.lines)) {
    const current = requested.get(line.sourceContractItemId);
    requested.set(line.sourceContractItemId, { amount: (current?.amount || new ExactQuantityDecimal(0)).add(line.quantity), unit: line.unit });
  }
  for (const [itemId, total] of requested) {
    const balance = available.get(itemId);
    if (!balance || balance.unit !== total.unit || total.amount.gt(balance.amount)) {
      throw new DispatchAllocationConflictError(`Allocation exceeds the authoritative available balance for row ${itemId}.`);
    }
  }
  const now = new Date();
  const batch = await tx.logisticsAllocationBatch.create({ data: {
    loadingId: loading.id, idempotencyKey, finalizedAt: now, finalizedBy: input.actorId,
  } });
  for (const draft of refreshedDrafts) {
    const confirmationPhone = await resolveRevisionConfirmationPhone(tx, draft.lines.map((line) => line.sourceContractId));
    const prior = await tx.logisticsAllocationRevision.aggregate({ where: { loadingId: loading.id, queueTurnId: draft.queueTurnId }, _max: { revisionNumber: true } });
    const revisionNumber = (prior._max.revisionNumber || 0) + 1;
    const snapshot = stableValue({ schemaVersion: 1,
      ...(draft.queueTurn.driverSource === 'PERSONAL_PICKUP' ? { personalPickup: await personalPickupDisplayContext(tx, draft.lines) } : {}),
      loading: { id: loading.id, number: loading.loadingNumber,
      customer: { id: loading.customer.id, name: `${loading.customer.firstName} ${loading.customer.lastName}`.trim(), companyName: loading.customer.companyName },
      project: { id: loading.project.id, name: loading.project.projectName, address: loading.project.address } },
      queueTurn: { id: draft.queueTurn.id, driverSource: draft.queueTurn.driverSource,
        admissionSnapshot: draft.queueTurn.admissionSnapshot, admissionIntegrityHash: draft.queueTurn.integrityHash },
      revisionNumber, finalizedAt: now,
      notification: { ...confirmationPhone, capturedAt: now },
      lines: draft.lines.map((line) => ({ contractId: line.sourceContractId,
        contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
        quantity: exactQuantityText(line.quantity), unit: line.unit, snapshot: line.snapshot })) });
    const loadingLines = new Map(loading.lines.map((line) => [line.sourceContractItemId, line.id]));
    await persistFinalizedAllocationRevision(tx, {
      revisionData: { batchId: batch.id, loadingId: loading.id, queueTurnId: draft.queueTurnId, revisionNumber,
        snapshot: json(snapshot), integrityHash: digest(snapshot), finalizedAt: now, finalizedBy: input.actorId },
      rows: draft.lines, loadingLines, actorId: input.actorId, finalizedAt: now,
      scope: { customerId: loading.customer.id, projectId: loading.project.id, destination: loading.project.address },
      expectedCurrency: allocationCurrency, revisionEventType: 'ALLOCATION_FINALIZED',
      idempotencyKey, effectiveAuthority: input.effectiveAuthority,
      revisionAuditPayload: ({ candidateId, snapshotHash, pricingBinding }) => ({ candidateId, snapshotHash,
        documentPath: pricingBinding.path, pricingVersionIds: pricingBinding.pricingVersionIds,
        pricedEventIntegrityHashes: pricingBinding.eventIntegrityHashes }),
    });
  }
  await tx.logisticsLoading.update({ where: { id: loading.id }, data: { status: 'FINALIZED', finalizedAt: now, finalizedBy: input.actorId } });
  for (const turn of refreshedTurns) {
    const changed = await tx.guardDriverQueueTurn.updateMany({
      where: { id: turn.id, status: GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING, loadingId: loading.id },
      data: { status: GuardDriverQueueTurnStatus.LOADING_FINALIZED, finalizedAt: now, finalizedBy: input.actorId },
    });
    if (changed.count !== 1) throw new DispatchAllocationConflictError('A queue turn changed during finalization.');
    await appendQueueEvent(tx, { turnId: turn.id, eventType: 'LOADING_FINALIZED', fromStatus: turn.status,
      toStatus: GuardDriverQueueTurnStatus.LOADING_FINALIZED, actorId: input.actorId, payload: { loadingId: loading.id, batchId: batch.id } });
  }
  await refreshProjectionContracts(tx, contractIds);
  return tx.logisticsAllocationBatch.findUniqueOrThrow({ where: { id: batch.id },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } } });
}).then(outcome => {
  if ('partnerFailure' in outcome) throw new PartnerLoadingCommandError(outcome.partnerFailure);
  return outcome;
});

export const createSuccessorAllocationRevision = async (prisma: Database, input: {
  predecessorRevisionId: string; lines: CanonicalAllocationLineInput[]; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}) => serializable(prisma, async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  const initialPredecessor = await tx.logisticsAllocationRevision.findUnique({ where: { id: input.predecessorRevisionId },
    include: { candidate: true, successorRevision: true, lines: true,
      loading: { include: { customer: true, project: true, lines: true } }, queueTurn: true } });
  if (!initialPredecessor) throw new DispatchAllocationValidationError('Predecessor allocation revision was not found.');
  if (initialPredecessor.sourceKind !== 'SALES_CONTRACT' || initialPredecessor.loading.sourceKind !== 'SALES_CONTRACT') {
    throw new DispatchAllocationConflictError('اصلاح تخصیص بارگیری پرونده همکار به شواهد همان پرونده نیاز دارد.');
  }
  const initialPredecessorLines = initialPredecessor.lines.map(ordinaryAllocationLine);
  const previousBatch = await tx.logisticsAllocationBatch.findUnique({
    where: { loadingId_idempotencyKey: { loadingId: initialPredecessor.loadingId, idempotencyKey } },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } },
  });
  if (previousBatch) return previousBatch;
  if (!initialPredecessor.candidate) throw new DispatchAllocationConflictError('Only an Accounting candidate can have a successor.');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DispatchAllocationValidationError('At least one successor line is required.');
  const itemIds = input.lines.map((line) => required(line.sourceContractItemId, 'sourceContractItemId'));
  const initiallyRequestedItems = await tx.contractItem.findMany({ where: { id: { in: itemIds }, retiredAt: null }, select: { id: true, contractId: true } });
  const transferItemIds = [...new Set([...itemIds, ...initialPredecessorLines.map((line) => line.sourceContractItemId)])];
  const pricingContractIds = [...new Set([...initiallyRequestedItems.map((item) => item.contractId),
    ...initialPredecessorLines.map((line) => line.sourceContractId)])];
  await lockKeys(tx, [`LOGISTICS_ALLOCATION_REVISION:${initialPredecessor.id}`,
    `LOGISTICS_LOADING:${initialPredecessor.loadingId}`,
    `ACCOUNTING_DISPATCH_CANDIDATE:${initialPredecessor.candidate.id}`,
    `GUARD_QUEUE:${initialPredecessor.queueTurnId}`,
    ...transferItemIds.map((id) => `SHIPMENT_CONTRACT_ITEM:${id}`),
    ...transferItemIds.map((id) => `SHIPMENT_EVIDENCE_HEAD:${id}`),
    ...transferItemIds.map((id) => `SHIPMENT_PROJECTION:${id}`),
    ...pricingContractIds.map((id) => `APPROVED_PRICING_CONTRACT:${id}`)]);
  await lockPricingContracts(tx, pricingContractIds);
  await assertOrdinaryContractsDispatchEligible(tx, pricingContractIds, DispatchAllocationConflictError);
  await lockShipmentTruth(tx, transferItemIds);
  await lockQueueTurns(tx, [initialPredecessor.queueTurnId]);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "accounting_dispatch_candidates"
    WHERE "id" = ${initialPredecessor.candidate.id} FOR UPDATE`);
  const predecessor = await tx.logisticsAllocationRevision.findUnique({ where: { id: initialPredecessor.id },
    include: { candidate: true, successorRevision: true, lines: true,
      loading: { include: { customer: true, project: true, lines: true } }, queueTurn: true } });
  if (!predecessor?.candidate) throw new DispatchAllocationConflictError('The predecessor changed during successor finalization.');
  const predecessorLines = predecessor.lines.map(ordinaryAllocationLine);
  if (!predecessor.loading.project) throw new DispatchAllocationConflictError('Ordinary loading project evidence is missing.');
  if (predecessor.successorRevision) throw new DispatchAllocationConflictError('This allocation already has a successor revision.');
  const refreshedCandidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: predecessor.candidate.id } });
  if (!refreshedCandidate) throw new DispatchAllocationConflictError('The predecessor candidate changed during successor finalization.');
  const refreshedQueueTurn = await tx.guardDriverQueueTurn.findUnique({ where: { id: predecessor.queueTurnId } });
  if (!refreshedQueueTurn || refreshedQueueTurn.status !== GuardDriverQueueTurnStatus.LOADING_FINALIZED
    || refreshedQueueTurn.loadingId !== predecessor.loadingId) {
    throw new DispatchAllocationConflictError('The predecessor queue turn is no longer bound to the finalized loading.');
  }
  if (!await isGuardQueueTurnCurrentlyReady(tx, refreshedQueueTurn)) {
    throw new DispatchAllocationConflictError('The driver or vehicle is no longer ready for a successor allocation.');
  }
  const stalePricingTransfer = refreshedCandidate.status === AccountingDispatchCandidateStatus.STALE_REQUIRES_SUCCESSOR;
  if (!['REJECTED', 'RETURNED'].includes(refreshedCandidate.status) && !stalePricingTransfer) {
    throw new DispatchAllocationConflictError('Only a rejected, returned, or stale-priced allocation can have a successor.');
  }
  const items = await tx.contractItem.findMany({ where: { id: { in: itemIds }, retiredAt: null }, include: { contract: true, product: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
  const currencies = [...new Set(items.map((item) => item.contract.currency))];
  if (currencies.length !== 1) throw new DispatchAllocationConflictError('One successor revision cannot mix contract currencies.');
  const rows = input.lines.map((line) => {
    const item = byId.get(line.sourceContractItemId);
    if (!item || item.contract.customerId !== predecessor.loading.customerId || !item.productRowId) {
      throw new DispatchAllocationValidationError('Successor rows must be stable rows owned by the loading customer.');
    }
    return { sourceContractId: item.contractId, sourceContractItemId: item.id, productRowId: item.productRowId,
      productId: item.productId, quantity: quantity(line.quantity), unit: required(line.unit || 'count', 'unit'),
      snapshot: json({ contractNumber: item.contract.contractNumber, contractItemId: item.id, productRowId: item.productRowId,
        productId: item.productId, productName: item.product.namePersian || item.product.name, ...loadedPieceEvidence(line) }) };
  });
  if (stalePricingTransfer) {
    try {
      assertExactStableReservationTransfer(
        predecessorLines.map((line) => ({ contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
          productRowId: line.productRowId, quantity: exactQuantityText(line.quantity), unit: line.unit })),
        rows.map((line) => ({ contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
          productRowId: line.productRowId, quantity: exactQuantityText(line.quantity), unit: line.unit })),
      );
    } catch (error) {
      if (error instanceof AllocationPricingBindingError) throw new DispatchAllocationConflictError(error.message);
      throw error;
    }
  }
  const requested = new Map<string, Prisma.Decimal>();
  const projections = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const contractId of [...new Set(rows.map((line) => line.sourceContractId))]) {
    const projection = await readShipmentQuantityProjection(tx as unknown as PrismaClient, { contractId });
    for (const row of projection.rows) {
      if (row.health !== 'CURRENT' || !row.quantities) throw new DispatchAllocationConflictError(`Shipment row ${row.contractItemId} is not current.`);
      const transferred = stalePricingTransfer
        ? predecessorLines.filter((line) => line.sourceContractItemId === row.contractItemId)
          .reduce((sum, line) => sum.add(line.quantity), new ExactQuantityDecimal(0))
        : new ExactQuantityDecimal(0);
      projections.set(row.contractItemId, { amount: new ExactQuantityDecimal(row.quantities.availableToLoad).add(transferred), unit: row.unit });
    }
  }
  for (const row of rows) requested.set(row.sourceContractItemId, (requested.get(row.sourceContractItemId) || new ExactQuantityDecimal(0)).add(row.quantity));
  for (const [itemId, amount] of requested) {
    const projection = projections.get(itemId);
    const row = rows.find((candidate) => candidate.sourceContractItemId === itemId)!;
    if (!projection || projection.unit !== row.unit || amount.gt(projection.amount)) {
      throw new DispatchAllocationConflictError(`Successor exceeds the authoritative available balance for row ${itemId}.`);
    }
  }
  const now = new Date();
  const confirmationPhone = await resolveRevisionConfirmationPhone(tx, rows.map((line) => line.sourceContractId));
  const batch = await tx.logisticsAllocationBatch.create({ data: { loadingId: predecessor.loadingId, idempotencyKey,
    finalizedAt: now, finalizedBy: input.actorId } });
  const revisionNumber = predecessor.revisionNumber + 1;
  const snapshot = stableValue({ schemaVersion: 1, predecessorRevisionId: predecessor.id,
    ...(refreshedQueueTurn.driverSource === 'PERSONAL_PICKUP' ? { personalPickup: await personalPickupDisplayContext(tx, rows) } : {}),
    loading: { id: predecessor.loading.id, number: predecessor.loading.loadingNumber,
      customer: { id: predecessor.loading.customer.id, name: `${predecessor.loading.customer.firstName} ${predecessor.loading.customer.lastName}`.trim(), companyName: predecessor.loading.customer.companyName },
      project: { id: predecessor.loading.project.id, name: predecessor.loading.project.projectName, address: predecessor.loading.project.address } },
    queueTurn: { id: refreshedQueueTurn.id, driverSource: refreshedQueueTurn.driverSource,
      admissionSnapshot: refreshedQueueTurn.admissionSnapshot, admissionIntegrityHash: refreshedQueueTurn.integrityHash },
    revisionNumber, finalizedAt: now,
    notification: { ...confirmationPhone, capturedAt: now },
    lines: rows.map((line) => ({ contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
      quantity: exactQuantityText(line.quantity), unit: line.unit, snapshot: line.snapshot })) });
  const loadingLines = new Map(predecessor.loading.lines.map((line) => [line.sourceContractItemId, line.id]));
  await persistFinalizedAllocationRevision(tx, {
    revisionData: { batchId: batch.id, loadingId: predecessor.loadingId, queueTurnId: predecessor.queueTurnId,
      revisionNumber, predecessorRevisionId: predecessor.id, snapshot: json(snapshot), integrityHash: digest(snapshot),
      finalizedAt: now, finalizedBy: input.actorId },
    rows, loadingLines, actorId: input.actorId, finalizedAt: now,
    idempotencyKey, effectiveAuthority: input.effectiveAuthority,
    scope: { customerId: predecessor.loading.customer.id, projectId: predecessor.loading.project.id,
      destination: predecessor.loading.project.address }, expectedCurrency: currencies[0],
    revisionEventType: 'SUCCESSOR_ALLOCATION_FINALIZED',
    revisionAuditPayload: ({ candidateId, pricingBinding }) => ({ predecessorRevisionId: predecessor.id, candidateId,
      stalePricingTransfer, documentPath: pricingBinding.path, pricingVersionIds: pricingBinding.pricingVersionIds,
      pricedEventIntegrityHashes: pricingBinding.eventIntegrityHashes }),
    afterRevisionCreated: stalePricingTransfer ? async (revision) => {
      for (const line of predecessorLines) {
        const release = { id: `${revision.id}:${line.id}`, contractId: line.sourceContractId,
          contractItemId: line.sourceContractItemId, productRowId: line.productRowId, unit: line.unit,
          kind: 'ALLOCATION_RELEASED' as const, quantity: exactQuantityText(line.quantity), effectiveAt: now.toISOString(),
          recordedAt: now.toISOString(), sourceType: 'STALE_ALLOCATION_SUCCESSOR', sourceId: `${revision.id}:${line.id}`,
          sourceVersion: 1, integrityHash: '', metadata: { predecessorRevisionId: predecessor.id, successorRevisionId: revision.id } };
        release.integrityHash = shipmentQuantityEvidenceIntegrityHash(release);
        await tx.shipmentQuantityEvidence.create({ data: { contractId: release.contractId,
          contractItemId: release.contractItemId, productRowId: release.productRowId, unit: release.unit,
          kind: release.kind, quantity: line.quantity, effectiveAt: now, recordedAt: now,
          sourceType: release.sourceType, sourceId: release.sourceId, sourceVersion: 1,
          integrityHash: release.integrityHash, metadata: json(release.metadata) } });
      }
    } : undefined,
  });
  await refreshProjectionContracts(tx, [
    ...rows.map((line) => line.sourceContractId),
    ...(stalePricingTransfer ? predecessorLines.map((line) => line.sourceContractId) : []),
  ]);
  return tx.logisticsAllocationBatch.findUniqueOrThrow({ where: { id: batch.id },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } } });
});

const nextWaybillNumber = async (tx: Tx) => {
  const rows = await tx.$queryRawUnsafe<Array<{ number: bigint }>>(`SELECT nextval('accounting_dispatch_waybill_number_seq') AS number`);
  return rows[0].number;
};

const issueWaybill = async (tx: Tx, candidate: any, actorId: string, replacesWaybillId?: string) => {
  const number = await nextWaybillNumber(tx);
  const issuedAt = new Date();
  const snapshot = stableValue({ schemaVersion: 1, number: number.toString(), issuedAt,
    allocationRevisionId: candidate.allocationRevision.id, allocationIntegrityHash: candidate.allocationRevision.integrityHash,
    allocationSnapshot: candidate.allocationRevision.snapshot });
  const waybill = await tx.accountingDispatchWaybill.create({ data: {
    number, candidateId: candidate.id, snapshot: json(snapshot), integrityHash: digest(snapshot), issuedAt, issuedBy: actorId,
    replacesWaybillId: replacesWaybillId || null,
  } });
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id,
    eventType: 'WAYBILL_ISSUED', payload: { number: number.toString(), candidateId: candidate.id,
      allocationRevisionId: candidate.allocationRevision.id, replacesWaybillId: replacesWaybillId || null }, actorId, recordedAt: issuedAt });
  return waybill;
};

export class LoadingCancellationAccountingAccessError extends Error {}

export async function loadingCancellationAccountingAuthority(db: Tx, actorId: string) {
  const actor = await db.user.findUnique({ where: { id: actorId },
    select: { role: true, isActive: true, partnerProfile: { select: { id: true } } } });
  if (!actor?.isActive || actor.partnerProfile) return null;
  const workspace = 'accounting';
  const feature = 'accounting_dispatch_candidates_manage';
  const [access, grant] = await Promise.all([
    getEffectiveUserAccess(db, { userId: actorId, userRole: actor.role }),
    resolveNarrowFeatureAccess(db, { userId: actorId, role: actor.role, workspace, feature, requiredPermission: 'edit' }),
  ]);
  const workspacePermission = access.workspaces.find(item => item.workspace === workspace)?.permission;
  if (!workspacePermission || !['edit', 'admin'].includes(workspacePermission) || !grant.allowed) return null;
  return { actorRole: actor.role, workspace, workspacePermission, feature, featurePermission: grant.permissionLevel };
}

export async function readLegacyLoadingRecovery(tx: Tx, loadingId: string, cutoverAt: Date | null) {
  const loading = await tx.logisticsLoading.findUnique({
    where: { id: loadingId },
    select: {
      status: true, sourceKind: true,
      salesDispatchInvoices: { orderBy: { number: 'desc' }, select: { id: true, number: true, voidedAt: true } },
      canonicalAllocationRevisions: { take: 2, include: {
        physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } },
        queueTurn: { include: { physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } } } },
        lines: { select: { sourceKind: true, sourceContractId: true, sourceContractItemId: true, productId: true } },
        candidate: { select: { id: true, status: true, waybills: { orderBy: { number: 'desc' }, select: {
          id: true, number: true, status: true, voidedAt: true, replacesWaybillId: true,
          physicalExit: { select: { id: true } }, manualOutageExit: { select: { id: true } },
          exitAuthorizations: { where: { status: { in: ['ACTIVE', 'CONSUMED'] } }, select: { id: true } },
        } } } },
      } },
    },
  });
  if (!loading || loading.status !== 'FINALIZED' || loading.sourceKind !== 'SALES_CONTRACT' ||
      loading.canonicalAllocationRevisions.length !== 1 || loading.salesDispatchInvoices.some(invoice => !invoice.voidedAt)) return null;
  const [revision] = loading.canonicalAllocationRevisions;
  const candidate = revision.candidate;
  const invoice = loading.salesDispatchInvoices[0];
  if (!invoice || !revision.sealedAt || revision.sourceKind !== 'SALES_CONTRACT' ||
      (cutoverAt && isPostCutoverFinalization(revision.finalizedAt, cutoverAt)) ||
      revision.physicalExit || revision.manualOutageExit || revision.queueTurn.physicalExit || revision.queueTurn.manualOutageExit ||
      revision.queueTurn.status !== 'LOADING_FINALIZED' || revision.queueTurn.loadingId !== loadingId ||
      candidate?.status !== 'ACCEPTED' || candidate.waybills.some(waybill =>
        waybill.status !== 'VOIDED' || !waybill.voidedAt || waybill.physicalExit || waybill.manualOutageExit ||
        waybill.exitAuthorizations.length)) return null;
  const [waybill] = candidate.waybills;
  if (!waybill || candidate.waybills.some(item => item.replacesWaybillId === waybill.id)) return null;
  const cancellation = await tx.accountingDispatchCommand.findFirst({ where: {
    candidateId: candidate.id, action: `VOID_WAYBILL_AND_INVOICE:${waybill.id}:${invoice.id}`,
  }, select: { id: true } });
  const pending = await tx.crossWorkspaceDuty.findFirst({ where: {
    sourceActionCode: LOADING_CANCELLATION_DUTY, sourceId: loadingId, status: 'OPEN',
  }, select: { id: true } });
  return cancellation && !pending ? { revision, candidate, waybill, invoice } : null;
}

export const recoverLegacyLoadingWaybill = (prisma: Database, input: {
  loadingId: string; waybillId: string; invoiceId: string; reason: string; actorId: string;
}) => serializable(prisma, async tx => {
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 3 || reason.length > 2000) {
    throw new DispatchAllocationValidationError('دلیل صدور مجدد باید بین ۳ و ۲۰۰۰ نویسه باشد.');
  }
  await tx.$queryRaw`SELECT id FROM users WHERE id=${input.actorId} FOR UPDATE`;
  await tx.$queryRaw`SELECT revision FROM effective_authorization_state WHERE id=1 FOR UPDATE`;
  if (!await loadingCancellationAccountingAuthority(tx, input.actorId)) {
    throw new LoadingCancellationAccountingAccessError('مجوز مدیریت اسناد ارسال برای صدور مجدد لازم است.');
  }
  await assertCanonicalDispatchCommandAllowed(tx);
  await lockKeys(tx, [`LOGISTICS_LOADING:${input.loadingId}`, `SALES_INVOICE:${input.loadingId}`]);
  const gate = await loadShipmentStatementRuntimeStateUnderLock(tx);
  const control = await tx.shipmentStatementOperationsControl.findUnique({
    where: { id: 'customer-shipment-statements' }, select: { id: true },
  });
  const target = gate && control && await readLegacyLoadingRecovery(tx, input.loadingId, gate.cutoverAt);
  if (!target || target.waybill.id !== input.waybillId || target.invoice.id !== input.invoiceId) {
    throw new DispatchAllocationConflictError('وضعیت اسناد بارگیری تغییر کرده یا صدور مجدد مجاز نیست. اسناد را به‌روزرسانی کنید.');
  }
  const { candidate, revision, waybill, invoice } = target;
  await lockKeys(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${candidate.id}`,
    `ACCOUNTING_DISPATCH_WAYBILL:${waybill.id}`, `GUARD_QUEUE:${revision.queueTurnId}`,
    `LOGISTICS_ALLOCATION_REVISION:${revision.id}`]);
  await lockQueueTurns(tx, [revision.queueTurnId]);
  const contractIds = [...new Set(revision.lines.map(line => ordinaryAllocationLine(line).sourceContractId))];
  await lockPricingContracts(tx, contractIds);
  await assertOrdinaryContractsDispatchEligible(tx, contractIds, DispatchAllocationConflictError);
  if (!await isGuardQueueTurnCurrentlyReady(tx, revision.queueTurn) ||
      (await assessBoundAllocationPricingFreshness(tx, revision.id)).status !== 'CURRENT') {
    throw new DispatchAllocationConflictError('آمادگی راننده و خودرو یا شواهد قیمت بارگیری نیاز به بررسی دارد.');
  }
  const replacement = await issueWaybill(tx, { ...candidate, allocationRevision: revision }, input.actorId, waybill.id);
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: replacement.id,
    eventType: 'WAYBILL_REISSUED_AFTER_VOID', actorId: input.actorId,
    payload: { reason, loadingId: input.loadingId, voidedWaybillId: waybill.id, voidedInvoiceId: invoice.id } });
  return replacement.id;
});

type FinalizedLoadingCancellation = {
  loadingId: string; reason: string; actorId: string; expectedDocumentIds?: string[];
};

export const cancelFinalizedOrdinaryLoading = (prisma: Database, input: FinalizedLoadingCancellation) =>
  serializable(prisma, tx => cancelFinalizedOrdinaryLoadingInTransaction(tx, input));

export const cancelFinalizedOrdinaryLoadingInTransaction = async (tx: Tx, input: FinalizedLoadingCancellation) => {
  const reason = required(input.reason, 'reason');
  if (input.expectedDocumentIds?.length) {
    await tx.$queryRaw`SELECT id FROM users WHERE id=${input.actorId} FOR UPDATE`;
    await tx.$queryRaw`SELECT revision FROM effective_authorization_state WHERE id=1 FOR UPDATE`;
  }
  await assertCanonicalDispatchCommandAllowed(tx);
  await lockKeys(tx, [`LOGISTICS_LOADING:${input.loadingId}`, `SALES_INVOICE:${input.loadingId}`]);
  const pending = await tx.crossWorkspaceDuty.findFirst({
    where: { sourceActionCode: LOADING_CANCELLATION_DUTY, sourceId: input.loadingId, status: 'OPEN' },
    select: { id: true },
  });
  if (pending) throw new DispatchAllocationConflictError('درخواست لغو این بارگیری در انتظار تصمیم حسابداری است.');
  const loading = await tx.logisticsLoading.findUnique({
    where: { id: input.loadingId },
    include: {
      salesDispatchInvoices: { where: { voidedAt: null }, select: { id: true, number: true, loadingId: true } },
      guardQueueTurns: { include: { physicalExit: true, manualOutageExit: true } },
      canonicalAllocationRevisions: { include: {
        lines: true, physicalExit: true, manualOutageExit: true,
        candidate: { include: { waybills: { include: {
          physicalExit: true, manualOutageExit: true,
          exitAuthorizations: { where: { status: { in: ['ACTIVE', 'CONSUMED'] } }, select: { id: true, status: true } },
        } } } },
      } },
    },
  });
  if (!loading || loading.sourceKind !== 'SALES_CONTRACT') {
    throw new DispatchAllocationConflictError('بارگیری فروش عادی پیدا نشد.');
  }
  const revisions = loading.canonicalAllocationRevisions;
  if (!revisions.length) throw new DispatchAllocationConflictError('تخصیص نهایی این بارگیری در گردش کار جدید ثبت نشده است.');
  if (loading.status === 'CANCELLED') {
    const cancellation = await tx.dispatchLifecycleAudit.findFirst({
      where: { aggregateType: 'LOGISTICS_LOADING', aggregateId: loading.id, eventType: 'FINALIZED_LOADING_CANCELLED' },
    });
    if (cancellation) return loading.id;
  }
  const alreadyCancelled = loading.status === 'CANCELLED' && Boolean(loading.finalizedAt && loading.cancelledAt);
  if (loading.status !== 'FINALIZED' && !alreadyCancelled) {
    throw new DispatchAllocationConflictError('بارگیری در وضعیت قابل لغو نیست.');
  }

  const waybills = revisions.flatMap(revision => revision.candidate?.waybills ?? []);
  const turnIds = [...new Set(revisions.map(revision => revision.queueTurnId))];
  // Closed draft-only personal selections retain their loading history but are not finalized carriers.
  const turns = loading.guardQueueTurns.filter(turn => !(turn.driverSource === 'PERSONAL_PICKUP'
    && turn.status === 'CLOSED_WITHOUT_LOADING' && !turnIds.includes(turn.id)));
  await lockKeys(tx, [
    ...turnIds.map(id => `GUARD_QUEUE:${id}`),
    ...revisions.map(revision => `LOGISTICS_ALLOCATION_REVISION:${revision.id}`),
    ...revisions.flatMap(revision => revision.candidate ? [`ACCOUNTING_DISPATCH_CANDIDATE:${revision.candidate.id}`] : []),
    ...waybills.map(waybill => `ACCOUNTING_DISPATCH_WAYBILL:${waybill.id}`),
  ]);
  if (turns.length !== turnIds.length || turns.some(turn => !turnIds.includes(turn.id) ||
    turn.status !== 'LOADING_FINALIZED' || turn.physicalExit || turn.manualOutageExit) ||
    revisions.some(revision => revision.physicalExit || revision.manualOutageExit) ||
    waybills.some(waybill => waybill.status === 'EXIT_RECORDED' || waybill.physicalExit || waybill.manualOutageExit ||
      waybill.exitAuthorizations.some(authorization => authorization.status === 'CONSUMED'))) {
    throw new DispatchAllocationConflictError('لغو فقط پیش از ثبت خروج و برای نوبت‌های نهایی‌شدهٔ همین بارگیری ممکن است.');
  }
  const issuedWaybills = waybills.filter(waybill => waybill.status === 'ISSUED');
  const activeInvoices = loading.salesDispatchInvoices;
  const documentIds = [...issuedWaybills.map(doc => doc.id), ...activeInvoices.map(doc => doc.id)].sort();
  if (input.expectedDocumentIds && JSON.stringify([...input.expectedDocumentIds].sort()) !== JSON.stringify(documentIds)) {
    throw new DispatchAllocationConflictError('اسناد بارگیری تغییر کرده‌اند. صفحه را به‌روز کنید و دوباره تأیید کنید.');
  }
  const authority = documentIds.length && input.expectedDocumentIds
    ? await loadingCancellationAccountingAuthority(tx, input.actorId) : null;
  if (documentIds.length && !input.expectedDocumentIds) {
    throw new DispatchAllocationConflictError('برای لغو، اسناد فعال را بررسی و ابطال آن‌ها را تأیید کنید.');
  }
  if (documentIds.length && reason.length < 3) throw new DispatchAllocationConflictError('دلیل ابطال اسناد حداقل سه نویسه است.');
  if (documentIds.length && !authority) {
    throw new LoadingCancellationAccountingAccessError('برای ابطال اسناد فعال، دسترسی ویرایش حسابداری و مجوز مدیریت اسناد ارسال لازم است.');
  }
  if (waybills.some(waybill => waybill.status === 'VOIDED' && waybill.exitAuthorizations.length > 0)) {
    throw new DispatchAllocationConflictError('مجوز خروج یکی از بارنامه‌های ابطال‌شده هنوز تعیین تکلیف نشده است.');
  }

  // A successor already settled its predecessor. A returned or rejected candidate already released its own lines.
  const superseded = new Set(revisions.flatMap(revision => revision.predecessorRevisionId ? [revision.predecessorRevisionId] : []));
  const current = revisions.filter(revision => !superseded.has(revision.id));
  if (current.length !== turnIds.length || new Set(current.map(revision => revision.queueTurnId)).size !== turnIds.length ||
    current.some(revision => !revision.sealedAt || !revision.lines.length || !revision.candidate ||
      !['PENDING', 'ACCEPTED', 'RETURNED', 'REJECTED', 'STALE_REQUIRES_SUCCESSOR'].includes(revision.candidate.status))) {
    throw new DispatchAllocationConflictError('سوابق تخصیص این بارگیری کامل یا قابل لغو نیست.');
  }

  const lines = current.flatMap(revision => revision.lines.map(ordinaryAllocationLine));
  const itemIds = lines.map(line => line.sourceContractItemId);
  await lockKeys(tx, itemIds.flatMap(id => [
    `SHIPMENT_CONTRACT_ITEM:${id}`, `SHIPMENT_EVIDENCE_HEAD:${id}`, `SHIPMENT_PROJECTION:${id}`,
  ]));
  await lockShipmentTruth(tx, itemIds);
  const at = new Date();
  if (authority) {
    const correlationId = `cancel-loading:${loading.id}`;
    for (const waybill of issuedWaybills) {
      const idempotencyKey = correlationId;
      await voidDispatchBundleInTransaction(tx, waybill, {
        waybillId: waybill.id, actorId: input.actorId, reason, at, authority,
        correlationId, idempotencyKey, intentFingerprint: digest({ command: 'VOID', waybillId: waybill.id, reason, authority }),
      });
    }
    for (const invoice of activeInvoices) {
      await voidSalesInvoiceInTransaction(tx, invoice, { actorId: input.actorId, reason, at });
    }
  }
  for (const revision of current) {
    const candidate = revision.candidate!;
    if (!['REJECTED', 'RETURNED'].includes(candidate.status)) {
      for (const row of revision.lines) {
        const line = ordinaryAllocationLine(row);
        const evidence = {
          id: row.id, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
          productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_RELEASED' as const,
          quantity: exactQuantityText(line.quantity), effectiveAt: at.toISOString(), recordedAt: at.toISOString(),
          sourceType: 'FINALIZED_LOADING_CANCELLATION', sourceId: row.id, sourceVersion: 1,
          integrityHash: '', metadata: { loadingId: loading.id, revisionId: revision.id, revisionLineId: row.id },
        };
        evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
        await tx.shipmentQuantityEvidence.create({ data: {
          contractId: evidence.contractId, contractItemId: evidence.contractItemId, productRowId: evidence.productRowId,
          unit: evidence.unit, kind: evidence.kind, quantity: line.quantity, effectiveAt: at, recordedAt: at,
          sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
          integrityHash: evidence.integrityHash, metadata: json(evidence.metadata),
        } });
      }
      await tx.accountingDispatchCandidate.update({ where: { id: candidate.id }, data: {
        status: 'WITHDRAWN', dispositionAt: at, dispositionBy: input.actorId, dispositionReason: reason,
      } });
      await tx.accountingDispatchWorkItem.updateMany({ where: { candidateId: candidate.id, status: 'OPEN' },
        data: { status: 'COMPLETED', completedAt: at } });
      await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidate.id,
        eventType: 'CANDIDATE_WITHDRAWN', payload: { loadingId: loading.id, reason, previousStatus: candidate.status },
        actorId: input.actorId, recordedAt: at });
    }
  }
  for (const turn of turns) {
    await tx.guardDriverQueueTurn.update({ where: { id: turn.id }, data: {
      ...(turn.driverSource === 'PERSONAL_PICKUP'
        ? { status: 'CLOSED_WITHOUT_LOADING' as const, closedAt: at, closedBy: input.actorId, closureReason: reason }
        : { status: 'AVAILABLE_FOR_LOADING' as const, loadingId: null, availableAt: at, availableBy: input.actorId }),
      reservedAt: null, reservedBy: null, finalizedAt: null, finalizedBy: null,
    } });
    await appendQueueEvent(tx, {
      turnId: turn.id, eventType: 'FINALIZED_LOADING_CANCELLED', fromStatus: 'LOADING_FINALIZED', toStatus: turn.driverSource === 'PERSONAL_PICKUP' ? 'CLOSED_WITHOUT_LOADING' : 'AVAILABLE_FOR_LOADING',
      actorId: input.actorId, reason, payload: { loadingId: loading.id },
    });
  }
  if (!alreadyCancelled) {
    await tx.logisticsLoading.update({ where: { id: loading.id }, data: {
      status: 'CANCELLED', cancelledAt: at, cancelledBy: input.actorId, cancellationReason: reason,
    } });
  }
  await refreshProjectionContracts(tx, lines.map(line => line.sourceContractId));
  await appendAudit(tx, { aggregateType: 'LOGISTICS_LOADING', aggregateId: loading.id,
    eventType: 'FINALIZED_LOADING_CANCELLED', payload: { reason, alreadyCancelled, documentIds, queueTurnIds: turnIds, revisionIds: current.map(revision => revision.id) },
    actorId: input.actorId, recordedAt: at });
  return loading.id;
};

const publicCandidateResult = (candidate: any, waybill?: any) => ({
  candidateId: candidate.id, status: candidate.status,
  waybill: waybill ? { id: waybill.id, number: waybill.number.toString(), status: waybill.status } : null,
});

export const decideAccountingDispatchCandidate = async (prisma: Database, input: {
  candidateId: string; action: 'ACCEPT' | 'REJECT' | 'RETURN'; reason?: string; idempotencyKey: string; actorId: string; effectiveAuthority?: unknown;
}) => {
  if (await candidateRequiresAtomicDocuments(prisma, input.candidateId)) {
    return requiredDispatchDocumentsCommands().decideCandidate({ ...input, authority: input.effectiveAuthority });
  }
  return serializable(prisma, async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  if (!['ACCEPT', 'REJECT', 'RETURN'].includes(input.action)) {
    throw new DispatchAllocationValidationError('action must be ACCEPT, REJECT, or RETURN.');
  }
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await lockKeys(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${input.candidateId}`]);
  const previous = await tx.accountingDispatchCommand.findUnique({
    where: { candidateId_idempotencyKey: { candidateId: input.candidateId, idempotencyKey } },
  });
  if (previous) {
    if (previous.action !== input.action) throw new DispatchAllocationConflictError('The idempotency key was already used for another candidate action.');
    return previous.result;
  }
  const candidate = await tx.accountingDispatchCandidate.findUnique({
    where: { id: input.candidateId }, include: { allocationRevision: { include: { lines: true, queueTurn: { select: { driverSource: true } } } }, workItem: true, waybills: true },
  });
  if (!candidate) throw new DispatchAllocationValidationError('Accounting dispatch candidate was not found.');
  if (candidate.status !== AccountingDispatchCandidateStatus.PENDING) throw new DispatchAllocationConflictError('Only a pending candidate can be decided.');
  if (input.action === 'ACCEPT') await requirePickupVerification(tx, candidate.id, candidate.allocationRevision.queueTurn.driverSource, DispatchAllocationConflictError);
  if (input.action === 'ACCEPT') await assertOrdinaryContractsDispatchEligible(tx,
    candidate.allocationRevision.lines.map(line => line.sourceContractId), DispatchAllocationConflictError);
  const reason = input.action === 'ACCEPT' ? null : required(input.reason, 'reason');
  const status = input.action === 'ACCEPT' ? AccountingDispatchCandidateStatus.ACCEPTED
    : input.action === 'REJECT' ? AccountingDispatchCandidateStatus.REJECTED : AccountingDispatchCandidateStatus.RETURNED;
  const now = new Date();
  const updated = await tx.accountingDispatchCandidate.update({ where: { id: candidate.id }, data: {
    status, dispositionAt: now, dispositionBy: input.actorId, dispositionReason: reason,
  } });
  await tx.accountingDispatchWorkItem.update({ where: { candidateId: candidate.id }, data: { status: 'COMPLETED', completedAt: now } });
  if (input.action !== 'ACCEPT') {
    for (const line of candidate.allocationRevision.lines) {
      const source = line.sourceKind === 'PARTNER_CASE' && line.partnerCaseId && line.partnerLineageId &&
        line.partnerCaseRevision && line.partnerIntegrityHash && line.sourceContractId === null && line.sourceContractItemId === null
        ? { sourceKind: 'PARTNER_CASE' as const, contractId: null, contractItemId: null,
          partnerCaseId: line.partnerCaseId, partnerLineageId: line.partnerLineageId,
          partnerCaseRevision: line.partnerCaseRevision, partnerIntegrityHash: line.partnerIntegrityHash }
        : (() => { const ordinary = ordinaryAllocationLine(line); return {
          contractId: ordinary.sourceContractId, contractItemId: ordinary.sourceContractItemId }; })();
      const evidence = {
        id: `${candidate.id}:${line.id}`, ...source,
        productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_RELEASED' as const,
        quantity: exactQuantityText(line.quantity), effectiveAt: now.toISOString(), recordedAt: now.toISOString(),
        sourceType: 'ACCOUNTING_CANDIDATE_DISPOSITION', sourceId: `${candidate.id}:${line.id}`, sourceVersion: 1,
        integrityHash: '', metadata: { revisionId: candidate.allocationRevisionId, candidateId: candidate.id, revisionLineId: line.id },
      };
      evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
      await tx.shipmentQuantityEvidence.create({ data: {
        contractId: evidence.contractId, contractItemId: evidence.contractItemId, productRowId: evidence.productRowId,
        unit: evidence.unit, kind: evidence.kind, quantity: line.quantity, effectiveAt: now, recordedAt: now,
        sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
        integrityHash: evidence.integrityHash, metadata: json(evidence.metadata),
      } });
    }
    await refreshProjectionContracts(tx, candidate.allocationRevision.lines.filter(line => line.sourceKind === 'SALES_CONTRACT')
      .map(ordinaryAllocationLine).map(line => line.sourceContractId));
  }
  const waybill = input.action === 'ACCEPT' ? await issueWaybill(tx, { ...candidate, status, allocationRevision: candidate.allocationRevision }, input.actorId) : null;
  const result = publicCandidateResult({ ...updated, status }, waybill);
  await tx.accountingDispatchCommand.create({ data: { candidateId: candidate.id, idempotencyKey,
    action: input.action, result: json(result), actorId: input.actorId } });
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidate.id,
    eventType: `CANDIDATE_${input.action}ED`, payload: { reason, waybillId: waybill?.id || null, waybillNumber: waybill?.number.toString() || null }, actorId: input.actorId });
    return result;
  });
};

export const voidAccountingDispatchWaybill = async (prisma: Database, input: {
  waybillId: string; reason: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown; expectedInvoiceId?: string | null;
}) => {
  if (await waybillRequiresAtomicDocuments(prisma, input.waybillId)) {
    return requiredDispatchDocumentsCommands().voidWaybill({ ...input, authority: input.effectiveAuthority });
  }
  return serializable(prisma, async (tx) => {
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  const initial = await tx.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId } });
  if (!initial) throw new DispatchAllocationValidationError('Dispatch waybill was not found.');
  await lockKeys(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${initial.candidateId}`, `ACCOUNTING_DISPATCH_WAYBILL:${input.waybillId}`]);
  const action = input.expectedInvoiceId === undefined
    ? `VOID_WAYBILL:${input.waybillId}`
    : `VOID_WAYBILL_AND_INVOICE:${input.waybillId}:${input.expectedInvoiceId ?? ''}`;
  const previous = await tx.accountingDispatchCommand.findUnique({ where: {
    candidateId_idempotencyKey: { candidateId: initial.candidateId, idempotencyKey },
  } });
  if (previous) {
    if (previous.action !== action) throw new DispatchAllocationConflictError('The idempotency key was already used for another dispatch command.');
    return previous.result;
  }
  const waybill = await tx.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: input.waybillId } });
  if (waybill.status !== AccountingDispatchWaybillStatus.ISSUED) throw new DispatchAllocationConflictError('Only an issued waybill can be voided.');
  const reason = required(input.reason, 'reason');
  if (input.expectedInvoiceId !== undefined) {
    const candidate = await tx.accountingDispatchCandidate.findUniqueOrThrow({
      where: { id: waybill.candidateId }, select: { allocationRevision: { select: { loadingId: true } } },
    });
    const { voidSalesInvoiceInTransaction } = await import('./salesDispatchInvoice/service');
    await voidSalesInvoiceInTransaction(tx, { actorId: input.actorId, workspace: 'accounting' },
      candidate.allocationRevision.loadingId, input.expectedInvoiceId, reason, true);
  }
  const now = new Date();
  await revokeActiveExitAuthorization(tx, { waybillId: waybill.id, actorId: input.actorId,
    reason: `Waybill voided: ${reason}`, eventType: 'REVOKED_FOR_WAYBILL_VOID', at: now, effectiveAuthority: input.effectiveAuthority });
  const voided = await tx.accountingDispatchWaybill.update({ where: { id: waybill.id }, data: {
    status: AccountingDispatchWaybillStatus.VOIDED, voidedAt: now, voidedBy: input.actorId, voidReason: reason,
  } });
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id,
    eventType: 'WAYBILL_VOIDED', payload: { number: waybill.number.toString(), reason }, actorId: input.actorId });
  const result = { id: voided.id, number: voided.number.toString(), status: voided.status };
  await tx.accountingDispatchCommand.create({ data: { candidateId: waybill.candidateId, idempotencyKey,
    action, result: json(result), actorId: input.actorId } });
    return result;
  });
};

export const replaceAccountingDispatchWaybill = async (prisma: Database, input: {
  waybillId: string; reason: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}) => {
  if (await waybillRequiresAtomicDocuments(prisma, input.waybillId)) {
    return requiredDispatchDocumentsCommands().replaceWaybill({ ...input, authority: input.effectiveAuthority });
  }
  return serializable(prisma, async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  const initial = await tx.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId } });
  if (!initial) throw new DispatchAllocationValidationError('Dispatch waybill was not found.');
  await lockKeys(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${initial.candidateId}`, `ACCOUNTING_DISPATCH_WAYBILL:${input.waybillId}`]);
  const action = `REPLACE_WAYBILL:${input.waybillId}`;
  const previous = await tx.accountingDispatchCommand.findUnique({ where: {
    candidateId_idempotencyKey: { candidateId: initial.candidateId, idempotencyKey },
  } });
  if (previous) {
    if (previous.action !== action) throw new DispatchAllocationConflictError('The idempotency key was already used for another dispatch command.');
    return previous.result;
  }
  const waybill = await tx.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId },
    include: { candidate: { include: { allocationRevision: true } } } });
  if (!waybill) throw new DispatchAllocationValidationError('Dispatch waybill was not found.');
  if (waybill.status !== AccountingDispatchWaybillStatus.ISSUED) throw new DispatchAllocationConflictError('Only an issued waybill can be replaced.');
  const reason = required(input.reason, 'reason');
  const now = new Date();
  await revokeActiveExitAuthorization(tx, { waybillId: waybill.id, actorId: input.actorId,
    reason: `Waybill replaced: ${reason}`, eventType: 'REVOKED_FOR_WAYBILL_REPLACEMENT', at: now, effectiveAuthority: input.effectiveAuthority });
  await tx.accountingDispatchWaybill.update({ where: { id: waybill.id }, data: {
    status: AccountingDispatchWaybillStatus.VOIDED, voidedAt: now, voidedBy: input.actorId, voidReason: reason,
  } });
  const replacement = await issueWaybill(tx, waybill.candidate, input.actorId, waybill.id);
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id,
    eventType: 'WAYBILL_REPLACED', payload: { number: waybill.number.toString(), replacementId: replacement.id,
      replacementNumber: replacement.number.toString(), reason }, actorId: input.actorId });
  const result = { voided: { id: waybill.id, number: waybill.number.toString(), status: 'VOIDED' },
    replacement: { id: replacement.id, number: replacement.number.toString(), status: replacement.status } };
  await tx.accountingDispatchCommand.create({ data: { candidateId: waybill.candidateId, idempotencyKey,
    action, result: json(result), actorId: input.actorId } });
    return result;
  });
};
