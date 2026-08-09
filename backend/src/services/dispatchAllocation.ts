import { createHash } from 'node:crypto';
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
import type { createDispatchDocuments } from './dispatchDocuments/service';
import { AllocationPricingBindingError, assertExactStableReservationTransfer, bindFinalizedAllocationPricing } from './allocationPricingBinding';
import { createPrismaAllocationPricingBindingPort } from './allocationPricingPrismaAdapter';

type Database = PrismaClient;
type Tx = Prisma.TransactionClient;
type DispatchDocumentsCommands = Pick<ReturnType<typeof createDispatchDocuments>, 'decideCandidate' | 'voidWaybill' | 'replaceWaybill'>;
let dispatchDocumentsCommands: DispatchDocumentsCommands | null = null;
export const installDispatchDocumentsCommands = (commands: DispatchDocumentsCommands) => { dispatchDocumentsCommands = commands; };

const candidateRequiresAtomicDocuments = async (prisma: Database, candidateId: string) => {
  const [candidate, cutover] = await Promise.all([
    prisma.accountingDispatchCandidate.findUnique({ where: { id: candidateId },
      select: { allocationRevision: { select: { finalizedAt: true } } } }),
    prisma.shipmentStatementCutover.findUnique({ where: { id: 'customer-shipment-statements' } }),
  ]);
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

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value instanceof Prisma.Decimal) return value.toFixed(3);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
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
  const result = new Prisma.Decimal(String(value));
  if (!result.isFinite() || !result.gt(0) || result.decimalPlaces() > 3) {
    throw new DispatchAllocationValidationError('Allocation quantities must be positive fixed-point values with at most three decimals.');
  }
  return result.toDecimalPlaces(3);
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
    return await bindFinalizedAllocationPricing(createPrismaAllocationPricingBindingPort(tx), input);
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

const persistFinalizedAllocationRevision = async (tx: Tx, input: {
  revisionData: Prisma.LogisticsAllocationRevisionUncheckedCreateInput;
  rows: FinalizedAllocationRow[];
  loadingLines: Map<string, string>;
  actorId: string;
  scope: { customerId: string; projectId: string; destination: string };
  expectedCurrency: string;
  finalizedAt: Date;
  revisionEventType: string;
  idempotencyKey: string;
  effectiveAuthority: unknown;
  revisionAuditPayload: (result: { candidateId: string; snapshotHash: string; pricingBinding: Awaited<ReturnType<typeof bindRevisionPricing>> }) => unknown;
  afterRevisionCreated?: (revision: { id: string }) => Promise<void>;
}) => {
  const revision = await tx.logisticsAllocationRevision.create({ data: input.revisionData });
  if (input.afterRevisionCreated) await input.afterRevisionCreated(revision);
  const pricedLines: Array<{
    allocationRevisionLineId: string; contractId: string; contractItemId: string;
    productRowId: string; quantity: string; unit: string;
  }> = [];
  for (const line of input.rows) {
    const lineSnapshot = stableValue({ revisionId: revision.id, contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
      quantity: line.quantity.toFixed(3), unit: line.unit, snapshot: line.snapshot });
    const revisionLine = await tx.logisticsAllocationRevisionLine.create({ data: {
      revisionId: revision.id, sourceContractId: line.sourceContractId, sourceContractItemId: line.sourceContractItemId,
      productRowId: line.productRowId, productId: line.productId, quantity: line.quantity, unit: line.unit,
      snapshot: json(line.snapshot || {}), integrityHash: digest(lineSnapshot),
    } });
    pricedLines.push({ allocationRevisionLineId: revisionLine.id, contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId,
      quantity: line.quantity.toFixed(3), unit: line.unit });
    const evidence = { id: revisionLine.id, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
      productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_FINALIZED' as const,
      quantity: line.quantity.toFixed(3), effectiveAt: input.finalizedAt.toISOString(), recordedAt: input.finalizedAt.toISOString(),
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
  const pricingBinding = await bindRevisionPricing(tx, { allocationRevisionId: revision.id,
    finalizedAt: input.finalizedAt, actorId: input.actorId, scope: input.scope,
    expectedCurrency: input.expectedCurrency, lines: pricedLines });
  if (pricingBinding.path === 'ATOMIC_WAYBILL_STATEMENT') {
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

const resolveRevisionConfirmationPhone = async (tx: Tx, contractIds: string[]) => {
  const uniqueContractIds = [...new Set(contractIds)];
  const confirmations = await tx.contractPublicConfirmation.findMany({
    where: { contractId: { in: uniqueContractIds }, status: 'CONFIRMED', verifiedAt: { not: null } },
    select: { contractId: true, phoneNumber: true, verifiedAt: true, createdAt: true },
    orderBy: [{ verifiedAt: 'desc' }, { createdAt: 'desc' }],
  });
  const latestByContract = new Map<string, string>();
  for (const confirmation of confirmations) {
    if (!latestByContract.has(confirmation.contractId)) latestByContract.set(confirmation.contractId, normalizeConfirmationPhone(confirmation.phoneNumber));
  }
  const phones = [...new Set(latestByContract.values())].filter(Boolean);
  if (phones.length > 1) throw new DispatchAllocationConflictError('Allocation rows have conflicting confirmed buyer notification phones. Split the allocation or reconcile confirmations.');
  return phones[0] || null;
};

export type CanonicalAllocationLineInput = {
  sourceContractItemId: string;
  quantity: string | number;
  unit?: string;
};

export const saveCanonicalAllocationDraft = async (prisma: Database, input: {
  loadingId: string; queueTurnId: string; lines: CanonicalAllocationLineInput[]; actorId: string;
}) => serializable(prisma, async (tx) => {
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
  const ids = input.lines.map((line) => required(line.sourceContractItemId, 'sourceContractItemId'));
  const items = await tx.contractItem.findMany({ where: { id: { in: ids } }, include: { contract: true, product: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
  const rows = input.lines.map((line) => {
    const item = byId.get(line.sourceContractItemId);
    if (!item) throw new DispatchAllocationValidationError(`Contract row ${line.sourceContractItemId} was not found.`);
    if (item.contract.customerId !== loading.customerId) throw new DispatchAllocationValidationError('Allocation rows must belong to the loading customer.');
    if (!item.productRowId) throw new DispatchAllocationConflictError('Allocation rows require a stable productRowId.');
    return {
      sourceContractId: item.contractId, sourceContractItemId: item.id, productRowId: item.productRowId,
      productId: item.productId, quantity: quantity(line.quantity), unit: required(line.unit || 'count', 'unit'),
      snapshot: json({ contractNumber: item.contract.contractNumber, contractItemId: item.id, productRowId: item.productRowId,
        productId: item.productId, productName: item.product.namePersian || item.product.name }),
    };
  });
  const draft = await tx.logisticsAllocationDraft.upsert({
    where: { queueTurnId: turn.id },
    create: { loadingId: loading.id, queueTurnId: turn.id, createdBy: input.actorId },
    update: { loadingId: loading.id },
  });
  await tx.logisticsAllocationDraftLine.deleteMany({ where: { draftId: draft.id } });
  await tx.logisticsAllocationDraftLine.createMany({ data: rows.map((row) => ({ ...row, draftId: draft.id })) });
  await appendAudit(tx, { aggregateType: 'LOGISTICS_ALLOCATION_DRAFT', aggregateId: draft.id,
    eventType: 'DRAFT_SAVED', payload: { loadingId: loading.id, queueTurnId: turn.id, lines: rows }, actorId: input.actorId });
  return tx.logisticsAllocationDraft.findUniqueOrThrow({ where: { id: draft.id }, include: { lines: true, queueTurn: true } });
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

export const finalizeCanonicalLoadingAllocations = async (prisma: Database, input: {
  loadingId: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}) => serializable(prisma, async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await lockKeys(tx, [`LOGISTICS_LOADING:${input.loadingId}`]);
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
  if (loading.status !== 'DRAFT') throw new DispatchAllocationConflictError('Only a draft loading can be finalized.');
  if (loading.canonicalAllocationDrafts.length === 0) throw new DispatchAllocationValidationError('At least one canonical driver allocation is required.');
  const itemIds = loading.canonicalAllocationDrafts.flatMap((draft) => draft.lines.map((line) => line.sourceContractItemId));
  const initialContractIds = [...new Set(loading.canonicalAllocationDrafts
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
  const refreshedDrafts = await tx.logisticsAllocationDraft.findMany({ where: { id: { in: draftIds } },
    include: { lines: true, queueTurn: true }, orderBy: { createdAt: 'asc' } });
  if (refreshedDrafts.length !== draftIds.length) throw new DispatchAllocationConflictError('An allocation draft changed during finalization.');
  const lockedItems = await tx.contractItem.findMany({ where: { id: { in: itemIds } }, include: { contract: true } });
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
      available.set(row.contractItemId, { amount: new Prisma.Decimal(row.quantities.availableToLoad), unit: row.unit });
    }
  }
  const requested = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const line of refreshedDrafts.flatMap((draft) => draft.lines)) {
    const current = requested.get(line.sourceContractItemId);
    requested.set(line.sourceContractItemId, { amount: (current?.amount || new Prisma.Decimal(0)).add(line.quantity), unit: line.unit });
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
    const snapshot = stableValue({ schemaVersion: 1, loading: { id: loading.id, number: loading.loadingNumber,
      customer: { id: loading.customer.id, name: `${loading.customer.firstName} ${loading.customer.lastName}`.trim(), companyName: loading.customer.companyName },
      project: { id: loading.project.id, name: loading.project.projectName, address: loading.project.address } },
      queueTurn: { id: draft.queueTurn.id, driverSource: draft.queueTurn.driverSource,
        admissionSnapshot: draft.queueTurn.admissionSnapshot, admissionIntegrityHash: draft.queueTurn.integrityHash },
      revisionNumber, finalizedAt: now,
      notification: { confirmationPhone, source: 'CONTRACT_PUBLIC_CONFIRMATION', capturedAt: now },
      lines: draft.lines.map((line) => ({ contractId: line.sourceContractId,
        contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
        quantity: line.quantity.toFixed(3), unit: line.unit, snapshot: line.snapshot })) });
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
  const previousBatch = await tx.logisticsAllocationBatch.findUnique({
    where: { loadingId_idempotencyKey: { loadingId: initialPredecessor.loadingId, idempotencyKey } },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } },
  });
  if (previousBatch) return previousBatch;
  if (!initialPredecessor.candidate) throw new DispatchAllocationConflictError('Only an Accounting candidate can have a successor.');
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DispatchAllocationValidationError('At least one successor line is required.');
  const itemIds = input.lines.map((line) => required(line.sourceContractItemId, 'sourceContractItemId'));
  const initiallyRequestedItems = await tx.contractItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, contractId: true } });
  const transferItemIds = [...new Set([...itemIds, ...initialPredecessor.lines.map((line) => line.sourceContractItemId)])];
  const pricingContractIds = [...new Set([...initiallyRequestedItems.map((item) => item.contractId),
    ...initialPredecessor.lines.map((line) => line.sourceContractId)])];
  await lockKeys(tx, [`LOGISTICS_ALLOCATION_REVISION:${initialPredecessor.id}`,
    `LOGISTICS_LOADING:${initialPredecessor.loadingId}`,
    `ACCOUNTING_DISPATCH_CANDIDATE:${initialPredecessor.candidate.id}`,
    `GUARD_QUEUE:${initialPredecessor.queueTurnId}`,
    ...transferItemIds.map((id) => `SHIPMENT_CONTRACT_ITEM:${id}`),
    ...transferItemIds.map((id) => `SHIPMENT_EVIDENCE_HEAD:${id}`),
    ...transferItemIds.map((id) => `SHIPMENT_PROJECTION:${id}`),
    ...pricingContractIds.map((id) => `APPROVED_PRICING_CONTRACT:${id}`)]);
  await lockPricingContracts(tx, pricingContractIds);
  await lockShipmentTruth(tx, transferItemIds);
  await lockQueueTurns(tx, [initialPredecessor.queueTurnId]);
  await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "accounting_dispatch_candidates"
    WHERE "id" = ${initialPredecessor.candidate.id} FOR UPDATE`);
  const predecessor = await tx.logisticsAllocationRevision.findUnique({ where: { id: initialPredecessor.id },
    include: { candidate: true, successorRevision: true, lines: true,
      loading: { include: { customer: true, project: true, lines: true } }, queueTurn: true } });
  if (!predecessor?.candidate) throw new DispatchAllocationConflictError('The predecessor changed during successor finalization.');
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
  const items = await tx.contractItem.findMany({ where: { id: { in: itemIds } }, include: { contract: true, product: true } });
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
        productId: item.productId, productName: item.product.namePersian || item.product.name }) };
  });
  if (stalePricingTransfer) {
    try {
      assertExactStableReservationTransfer(
        predecessor.lines.map((line) => ({ contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
          productRowId: line.productRowId, quantity: line.quantity.toFixed(3), unit: line.unit })),
        rows.map((line) => ({ contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
          productRowId: line.productRowId, quantity: line.quantity.toFixed(3), unit: line.unit })),
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
        ? predecessor.lines.filter((line) => line.sourceContractItemId === row.contractItemId)
          .reduce((sum, line) => sum.add(line.quantity), new Prisma.Decimal(0))
        : new Prisma.Decimal(0);
      projections.set(row.contractItemId, { amount: new Prisma.Decimal(row.quantities.availableToLoad).add(transferred), unit: row.unit });
    }
  }
  for (const row of rows) requested.set(row.sourceContractItemId, (requested.get(row.sourceContractItemId) || new Prisma.Decimal(0)).add(row.quantity));
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
    loading: { id: predecessor.loading.id, number: predecessor.loading.loadingNumber,
      customer: { id: predecessor.loading.customer.id, name: `${predecessor.loading.customer.firstName} ${predecessor.loading.customer.lastName}`.trim(), companyName: predecessor.loading.customer.companyName },
      project: { id: predecessor.loading.project.id, name: predecessor.loading.project.projectName, address: predecessor.loading.project.address } },
    queueTurn: { id: refreshedQueueTurn.id, driverSource: refreshedQueueTurn.driverSource,
      admissionSnapshot: refreshedQueueTurn.admissionSnapshot, admissionIntegrityHash: refreshedQueueTurn.integrityHash },
    revisionNumber, finalizedAt: now,
    notification: { confirmationPhone, source: 'CONTRACT_PUBLIC_CONFIRMATION', capturedAt: now },
    lines: rows.map((line) => ({ contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
      quantity: line.quantity.toFixed(3), unit: line.unit, snapshot: line.snapshot })) });
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
      for (const line of predecessor.lines) {
        const release = { id: `${revision.id}:${line.id}`, contractId: line.sourceContractId,
          contractItemId: line.sourceContractItemId, productRowId: line.productRowId, unit: line.unit,
          kind: 'ALLOCATION_RELEASED' as const, quantity: line.quantity.toFixed(3), effectiveAt: now.toISOString(),
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
    ...(stalePricingTransfer ? predecessor.lines.map((line) => line.sourceContractId) : []),
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

const publicCandidateResult = (candidate: any, waybill?: any) => ({
  candidateId: candidate.id, status: candidate.status,
  waybill: waybill ? { id: waybill.id, number: waybill.number.toString(), status: waybill.status } : null,
});

export const decideAccountingDispatchCandidate = async (prisma: Database, input: {
  candidateId: string; action: 'ACCEPT' | 'REJECT' | 'RETURN'; reason?: string; idempotencyKey: string; actorId: string;
}) => {
  if (await candidateRequiresAtomicDocuments(prisma, input.candidateId)) {
    return requiredDispatchDocumentsCommands().decideCandidate(input);
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
    where: { id: input.candidateId }, include: { allocationRevision: { include: { lines: true } }, workItem: true, waybills: true },
  });
  if (!candidate) throw new DispatchAllocationValidationError('Accounting dispatch candidate was not found.');
  if (candidate.status !== AccountingDispatchCandidateStatus.PENDING) throw new DispatchAllocationConflictError('Only a pending candidate can be decided.');
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
      const evidence = {
        id: `${candidate.id}:${line.id}`, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
        productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_RELEASED' as const,
        quantity: line.quantity.toFixed(3), effectiveAt: now.toISOString(), recordedAt: now.toISOString(),
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
    await refreshProjectionContracts(tx, candidate.allocationRevision.lines.map((line) => line.sourceContractId));
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
  waybillId: string; reason: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}) => {
  if (await waybillRequiresAtomicDocuments(prisma, input.waybillId)) {
    return requiredDispatchDocumentsCommands().voidWaybill({ ...input, authority: input.effectiveAuthority });
  }
  return serializable(prisma, async (tx) => {
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  const initial = await tx.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId } });
  if (!initial) throw new DispatchAllocationValidationError('Dispatch waybill was not found.');
  await lockKeys(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${initial.candidateId}`, `ACCOUNTING_DISPATCH_WAYBILL:${input.waybillId}`]);
  const action = `VOID_WAYBILL:${input.waybillId}`;
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
