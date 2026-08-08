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

type Database = PrismaClient;
type Tx = Prisma.TransactionClient;

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

const serializable = async <T>(prisma: Database, work: (tx: Tx) => Promise<T>): Promise<T> => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
  throw lastError;
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
    eventHash: digest({ aggregateType: input.aggregateType, aggregateId: input.aggregateId, eventType: input.eventType,
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
  loadingId: string; idempotencyKey: string; actorId: string;
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
  await lockKeys(tx, [
    ...loading.canonicalAllocationDrafts.map((draft) => `GUARD_QUEUE:${draft.queueTurnId}`),
    ...itemIds.map((id) => `SHIPMENT_CONTRACT_ITEM:${id}`),
  ]);
  const refreshedTurns = await tx.guardDriverQueueTurn.findMany({ where: { id: { in: loading.canonicalAllocationDrafts.map((draft) => draft.queueTurnId) } } });
  const turns = new Map(refreshedTurns.map((turn) => [turn.id, turn]));
  for (const draft of loading.canonicalAllocationDrafts) {
    const turn = turns.get(draft.queueTurnId);
    if (!turn || turn.status !== GuardDriverQueueTurnStatus.RESERVED_FOR_LOADING || turn.loadingId !== loading.id) {
      throw new DispatchAllocationConflictError('Every allocation queue turn must still be reserved by this loading.');
    }
    if (!await isGuardQueueTurnCurrentlyReady(tx, turn)) throw new DispatchAllocationConflictError('A reserved driver or vehicle is no longer ready.');
    if (draft.lines.length === 0) throw new DispatchAllocationValidationError('Every driver allocation must contain a positive quantity.');
  }
  const contractIds = [...new Set(loading.canonicalAllocationDrafts.flatMap((draft) => draft.lines.map((line) => line.sourceContractId)))];
  const available = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const contractId of contractIds) {
    const projection = await readShipmentQuantityProjection(tx as unknown as PrismaClient, { contractId });
    for (const row of projection.rows) {
      if (row.health !== 'CURRENT' || !row.quantities) throw new DispatchAllocationConflictError(`Shipment row ${row.contractItemId} is not current.`);
      available.set(row.contractItemId, { amount: new Prisma.Decimal(row.quantities.availableToLoad), unit: row.unit });
    }
  }
  const requested = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const line of loading.canonicalAllocationDrafts.flatMap((draft) => draft.lines)) {
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
  for (const draft of loading.canonicalAllocationDrafts) {
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
    const revision = await tx.logisticsAllocationRevision.create({ data: {
      batchId: batch.id, loadingId: loading.id, queueTurnId: draft.queueTurnId, revisionNumber,
      snapshot: json(snapshot), integrityHash: digest(snapshot), finalizedAt: now, finalizedBy: input.actorId,
    } });
    const loadingLines = new Map(loading.lines.map((line) => [line.sourceContractItemId, line.id]));
    for (const line of draft.lines) {
      const lineSnapshot = stableValue({ revisionId: revision.id, contractId: line.sourceContractId,
        contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
        quantity: line.quantity.toFixed(3), unit: line.unit, snapshot: line.snapshot });
      const revisionLine = await tx.logisticsAllocationRevisionLine.create({ data: {
        revisionId: revision.id, sourceContractId: line.sourceContractId, sourceContractItemId: line.sourceContractItemId,
        productRowId: line.productRowId, productId: line.productId, quantity: line.quantity, unit: line.unit,
        snapshot: json(line.snapshot || {}), integrityHash: digest(lineSnapshot),
      } });
      const evidence = {
        id: revisionLine.id, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
        productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_FINALIZED' as const,
        quantity: line.quantity.toFixed(3), effectiveAt: now.toISOString(), recordedAt: now.toISOString(),
        sourceType: 'LOGISTICS_ALLOCATION_REVISION', sourceId: revisionLine.id, sourceVersion: 1,
        integrityHash: '', metadata: { loadingId: loading.id, revisionId: revision.id, loadingLineId: loadingLines.get(line.sourceContractItemId) || null },
      };
      evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
      await tx.shipmentQuantityEvidence.create({ data: {
        contractId: evidence.contractId, contractItemId: evidence.contractItemId, productRowId: evidence.productRowId,
        unit: evidence.unit, kind: evidence.kind, quantity: line.quantity, effectiveAt: now, recordedAt: now,
        sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
        integrityHash: evidence.integrityHash, metadata: json(evidence.metadata),
      } });
    }
    await tx.logisticsAllocationRevision.update({ where: { id: revision.id }, data: { sealedAt: now } });
    const candidate = await tx.accountingDispatchCandidate.create({ data: {
      allocationRevisionId: revision.id, createdAt: now, workItem: { create: { createdAt: now } },
    } });
    const workItem = await tx.accountingDispatchWorkItem.findUniqueOrThrow({ where: { candidateId: candidate.id } });
    await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidate.id,
      eventType: 'CANDIDATE_CREATED', payload: { allocationRevisionId: revision.id, workItemId: workItem.id }, actorId: input.actorId, recordedAt: now });
    await appendAudit(tx, { aggregateType: 'LOGISTICS_ALLOCATION_REVISION', aggregateId: revision.id,
      eventType: 'ALLOCATION_FINALIZED', payload: { candidateId: candidate.id, snapshotHash: revision.integrityHash }, actorId: input.actorId, recordedAt: now });
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
  predecessorRevisionId: string; lines: CanonicalAllocationLineInput[]; idempotencyKey: string; actorId: string;
}) => serializable(prisma, async (tx) => {
  await assertCanonicalDispatchCommandAllowed(tx);
  const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
  await lockKeys(tx, [`LOGISTICS_ALLOCATION_REVISION:${input.predecessorRevisionId}`]);
  const predecessor = await tx.logisticsAllocationRevision.findUnique({ where: { id: input.predecessorRevisionId },
    include: { candidate: true, successorRevision: true, loading: { include: { customer: true, project: true, lines: true } }, queueTurn: true } });
  if (!predecessor) throw new DispatchAllocationValidationError('Predecessor allocation revision was not found.');
  const previousBatch = await tx.logisticsAllocationBatch.findUnique({
    where: { loadingId_idempotencyKey: { loadingId: predecessor.loadingId, idempotencyKey } },
    include: { revisions: { include: { lines: true, candidate: { include: { workItem: true, waybills: true } } } } },
  });
  if (previousBatch) return previousBatch;
  if (!predecessor.candidate || !['REJECTED', 'RETURNED'].includes(predecessor.candidate.status)) {
    throw new DispatchAllocationConflictError('Only a rejected or returned allocation can have a successor.');
  }
  if (predecessor.successorRevision) throw new DispatchAllocationConflictError('This allocation already has a successor revision.');
  if (predecessor.queueTurn.status !== GuardDriverQueueTurnStatus.LOADING_FINALIZED || predecessor.queueTurn.loadingId !== predecessor.loadingId) {
    throw new DispatchAllocationConflictError('The predecessor queue turn is no longer bound to the finalized loading.');
  }
  if (!await isGuardQueueTurnCurrentlyReady(tx, predecessor.queueTurn)) {
    throw new DispatchAllocationConflictError('The driver or vehicle is no longer ready for a successor allocation.');
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) throw new DispatchAllocationValidationError('At least one successor line is required.');
  const itemIds = input.lines.map((line) => required(line.sourceContractItemId, 'sourceContractItemId'));
  await lockKeys(tx, [`LOGISTICS_LOADING:${predecessor.loadingId}`, ...itemIds.map((id) => `SHIPMENT_CONTRACT_ITEM:${id}`)]);
  const items = await tx.contractItem.findMany({ where: { id: { in: itemIds } }, include: { contract: true, product: true } });
  const byId = new Map(items.map((item) => [item.id, item]));
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
  const requested = new Map<string, Prisma.Decimal>();
  const projections = new Map<string, { amount: Prisma.Decimal; unit: string }>();
  for (const contractId of [...new Set(rows.map((line) => line.sourceContractId))]) {
    const projection = await readShipmentQuantityProjection(tx as unknown as PrismaClient, { contractId });
    for (const row of projection.rows) {
      if (row.health !== 'CURRENT' || !row.quantities) throw new DispatchAllocationConflictError(`Shipment row ${row.contractItemId} is not current.`);
      projections.set(row.contractItemId, { amount: new Prisma.Decimal(row.quantities.availableToLoad), unit: row.unit });
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
    queueTurn: { id: predecessor.queueTurn.id, driverSource: predecessor.queueTurn.driverSource,
      admissionSnapshot: predecessor.queueTurn.admissionSnapshot, admissionIntegrityHash: predecessor.queueTurn.integrityHash },
    revisionNumber, finalizedAt: now,
    notification: { confirmationPhone, source: 'CONTRACT_PUBLIC_CONFIRMATION', capturedAt: now },
    lines: rows.map((line) => ({ contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
      quantity: line.quantity.toFixed(3), unit: line.unit, snapshot: line.snapshot })) });
  const revision = await tx.logisticsAllocationRevision.create({ data: { batchId: batch.id, loadingId: predecessor.loadingId,
    queueTurnId: predecessor.queueTurnId, revisionNumber, predecessorRevisionId: predecessor.id,
    snapshot: json(snapshot), integrityHash: digest(snapshot), finalizedAt: now, finalizedBy: input.actorId } });
  const loadingLines = new Map(predecessor.loading.lines.map((line) => [line.sourceContractItemId, line.id]));
  for (const line of rows) {
    const lineSnapshot = stableValue({ revisionId: revision.id, contractId: line.sourceContractId,
      contractItemId: line.sourceContractItemId, productRowId: line.productRowId, productId: line.productId,
      quantity: line.quantity.toFixed(3), unit: line.unit, snapshot: line.snapshot });
    const revisionLine = await tx.logisticsAllocationRevisionLine.create({ data: { revisionId: revision.id,
      sourceContractId: line.sourceContractId, sourceContractItemId: line.sourceContractItemId, productRowId: line.productRowId,
      productId: line.productId, quantity: line.quantity, unit: line.unit, snapshot: line.snapshot, integrityHash: digest(lineSnapshot) } });
    const evidence = { id: revisionLine.id, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
      productRowId: line.productRowId, unit: line.unit, kind: 'ALLOCATION_FINALIZED' as const, quantity: line.quantity.toFixed(3),
      effectiveAt: now.toISOString(), recordedAt: now.toISOString(), sourceType: 'LOGISTICS_ALLOCATION_REVISION',
      sourceId: revisionLine.id, sourceVersion: 1, integrityHash: '', metadata: { loadingId: predecessor.loadingId,
        revisionId: revision.id, loadingLineId: loadingLines.get(line.sourceContractItemId) || null } };
    evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
    await tx.shipmentQuantityEvidence.create({ data: { contractId: evidence.contractId, contractItemId: evidence.contractItemId,
      productRowId: evidence.productRowId, unit: evidence.unit, kind: evidence.kind, quantity: line.quantity, effectiveAt: now,
      recordedAt: now, sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
      integrityHash: evidence.integrityHash, metadata: json(evidence.metadata) } });
  }
  await tx.logisticsAllocationRevision.update({ where: { id: revision.id }, data: { sealedAt: now } });
  const candidate = await tx.accountingDispatchCandidate.create({ data: { allocationRevisionId: revision.id, createdAt: now,
    workItem: { create: { createdAt: now } } } });
  const workItem = await tx.accountingDispatchWorkItem.findUniqueOrThrow({ where: { candidateId: candidate.id } });
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: candidate.id,
    eventType: 'CANDIDATE_CREATED', payload: { allocationRevisionId: revision.id, workItemId: workItem.id, predecessorRevisionId: predecessor.id },
    actorId: input.actorId, recordedAt: now });
  await appendAudit(tx, { aggregateType: 'LOGISTICS_ALLOCATION_REVISION', aggregateId: revision.id,
    eventType: 'SUCCESSOR_ALLOCATION_FINALIZED', payload: { predecessorRevisionId: predecessor.id, candidateId: candidate.id },
    actorId: input.actorId, recordedAt: now });
  await refreshProjectionContracts(tx, rows.map((line) => line.sourceContractId));
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
}) => serializable(prisma, async (tx) => {
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

export const voidAccountingDispatchWaybill = async (prisma: Database, input: {
  waybillId: string; reason: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}) => serializable(prisma, async (tx) => {
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

export const replaceAccountingDispatchWaybill = async (prisma: Database, input: {
  waybillId: string; reason: string; idempotencyKey: string; actorId: string; effectiveAuthority: unknown;
}) => serializable(prisma, async (tx) => {
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
