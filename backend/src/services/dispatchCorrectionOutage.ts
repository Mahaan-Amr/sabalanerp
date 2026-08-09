import { createHash, randomUUID } from 'node:crypto';
import { AccountingDispatchWaybillStatus, GuardDriverQueueTurnStatus, Prisma, PrismaClient } from '@prisma/client';
import { isRetryableDispatchTransactionError, refreshProjectionContracts } from './dispatchAllocation';
import { appendQueueEvent } from './guardDriverQueue';
import { guardReturnValidationFailure, shipmentQuantityEvidenceIntegrityHash } from './shipmentQuantityProjectionStore';
import { normalizeDispatchCorrectionDraft, StatementCorrectionPolicyError, type StatementCorrectionKind } from './dispatchCorrectionAdjustmentPolicy';
import {
  persistStatementAdjustment,
  planStatementAdjustment,
} from './statementAdjustmentPosting';
import type { ConfiguredStatementAdjustmentArtifactPreparer } from './statementAdjustmentRuntime';

type Tx = Prisma.TransactionClient;
type Authority = { actorRole: string; workspace: string; workspacePermission: string; feature?: string; featurePermission?: string };
export class DispatchRecoveryValidationError extends Error {}
export class DispatchRecoveryConflictError extends Error {}

const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Prisma.Decimal) return value.toFixed(3);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)]));
  return value;
};
const json = (value: unknown) => stable(value) as Prisma.InputJsonValue;
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
export const dispatchLifecycleAuditEventHash = (input: {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: unknown;
  actorId: string;
  authority: Authority;
  at: Date;
  previousHash: string | null;
}) => digest(input);
const required = (value: unknown, name: string) => {
  const result = String(value || '').trim();
  if (!result) throw new DispatchRecoveryValidationError(`${name} is required.`);
  return result;
};
const record = (value: unknown): Readonly<Record<string, unknown>> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Readonly<Record<string, unknown>> : {};
const auditAuthority = (value: unknown): Authority | null => {
  const evidence = record(value);
  const actorRole = String(evidence.actorRole || '').trim();
  const workspace = String(evidence.workspace || '').trim();
  const workspacePermission = String(evidence.workspacePermission || '').trim();
  if (!actorRole || !workspace || !workspacePermission) return null;
  const feature = String(evidence.feature || '').trim() || undefined;
  const featurePermission = String(evidence.featurePermission || '').trim() || undefined;
  return { actorRole, workspace, workspacePermission, feature, featurePermission };
};
const validDate = (value: Date, name: string) => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new DispatchRecoveryValidationError(`${name} must be a valid timestamp.`);
  return value;
};
const signedQuantity = (value: unknown) => {
  const result = new Prisma.Decimal(String(value));
  if (!result.isFinite() || result.isZero() || result.decimalPlaces() > 3) throw new DispatchRecoveryValidationError('Correction quantity must be non-zero fixed-point scale three.');
  return result.toDecimalPlaces(3);
};
const positiveQuantity = (value: unknown) => {
  const result = signedQuantity(value);
  if (!result.gt(0)) throw new DispatchRecoveryValidationError('Return quantity must be positive.');
  return result;
};
const lock = async (tx: Tx, keys: string[]) => {
  for (const key of [...new Set(keys)].sort()) await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
};
const appendAudit = async (tx: Tx, input: { aggregateType: string; aggregateId: string; eventType: string;
  payload: unknown; actorId: string; authority: Authority; at: Date }) => {
  await lock(tx, [`DISPATCH_AUDIT:${input.aggregateType}:${input.aggregateId}`]);
  const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId },
    orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const payload = stable({ workspace: input.authority.workspace, effectiveAuthority: input.authority, ...((input.payload || {}) as object) });
  const previousHash = previous?.eventHash || null;
  await tx.dispatchLifecycleAudit.create({ data: { aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    eventType: input.eventType, payload: json(payload), actorId: input.actorId, recordedAt: input.at,
    previousHash, eventHash: dispatchLifecycleAuditEventHash({ ...input, payload, previousHash }) } });
};
const serializable = <T>(prisma: PrismaClient, work: (tx: Tx) => Promise<T>) =>
  prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
const serializableCorrectionPosting = async <T>(prisma: PrismaClient, work: (tx: Tx) => Promise<T>) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await serializable(prisma, work);
    } catch (error) {
      lastError = error;
      if (!isRetryableDispatchTransactionError(error)) throw error;
    }
  }
  throw lastError;
};

const correctionPostingPolicy = async (tx: Tx, correction: { id: string; reversalOfId: string | null;
  lines: Array<{ contractItemId: string; quantity: Prisma.Decimal }> }) => {
  const creation = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: 'DISPATCH_CORRECTION',
    aggregateId: correction.id, eventType: 'CORRECTION_DRAFT_CREATED' }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
  const payload = record(creation?.payload);
  if (creation) {
    const authority = auditAuthority(payload.effectiveAuthority);
    if (!authority) throw new DispatchRecoveryConflictError('Dispatch correction draft audit authority is incomplete.');
    const expected = dispatchLifecycleAuditEventHash({ aggregateType: creation.aggregateType, aggregateId: creation.aggregateId,
      eventType: creation.eventType, payload, actorId: creation.actorId, authority, at: creation.recordedAt,
      previousHash: creation.previousHash });
    if (creation.eventHash !== expected) throw new DispatchRecoveryConflictError('Dispatch correction draft audit integrity failed.');
  }
  const storedKind = String(payload.correctionKind || '') as StatementCorrectionKind;
  const allowed: StatementCorrectionKind[] = ['QUANTITY', 'RETURN', 'REATTRIBUTION', 'REVERSAL'];
  const inferred: StatementCorrectionKind = correction.reversalOfId ? 'REVERSAL'
    : correction.lines.some((line) => line.quantity.lt(0)) ? 'RETURN' : 'QUANTITY';
  return { kind: allowed.includes(storedKind) ? storedKind : inferred, reattributions: payload.reattributions };
};

const waybillContext = async (tx: Tx, waybillId: string) => {
  const waybill = await tx.accountingDispatchWaybill.findUnique({ where: { id: waybillId }, include: {
    physicalExit: true, manualOutageExit: true,
    candidate: { include: { allocationRevision: { include: { lines: true, queueTurn: true,
      pricingReferences: { include: { pricingVersion: { include: { rows: true } } } },
    } } } },
  } });
  if (!waybill) throw new DispatchRecoveryValidationError('Dispatch waybill was not found.');
  return waybill;
};

type DispatchQuantityEvidence = Prisma.ShipmentQuantityEvidenceGetPayload<object>;

const withDispatchLoadingAttribution = async <T extends DispatchQuantityEvidence | null>(tx: Tx, dispatchEvidence: T): Promise<T> => {
  if (!dispatchEvidence) return dispatchEvidence;
  if ((dispatchEvidence.metadata as Record<string, unknown> | null)?.loadingId || dispatchEvidence.kind !== 'PHYSICAL_EXIT') {
    return dispatchEvidence;
  }
  const physicalExitId = String((dispatchEvidence.metadata as Record<string, unknown> | null)?.physicalExitId || '');
  const physicalExit = physicalExitId
    ? await tx.guardPhysicalExit.findUnique({ where: { id: physicalExitId }, include: { allocationRevision: true } })
    : null;
  return (physicalExit ? { ...dispatchEvidence,
    metadata: { ...((dispatchEvidence.metadata as Record<string, unknown>) || {}), loadingId: physicalExit.allocationRevision.loadingId } }
    : dispatchEvidence) as T;
};

export const createDispatchCorrection = (prisma: PrismaClient, input: { waybillId: string; reason: string; effectiveAt: Date;
  lines?: Array<{ contractItemId: string; quantity: string | number; returnEvidenceId?: string }>;
  reattributions?: Array<{ sourceContractItemId: string; destinationContractItemId: string; quantity: string | number }>;
  actorId: string; authority: Authority;
  reversalOfId?: string }) => serializable(prisma, async (tx) => {
  const waybill = await waybillContext(tx, required(input.waybillId, 'waybillId'));
  validDate(input.effectiveAt, 'effectiveAt');
  if (input.effectiveAt > new Date()) throw new DispatchRecoveryValidationError('Correction effectiveAt cannot be in the future.');
  if (waybill.status !== AccountingDispatchWaybillStatus.EXIT_RECORDED || (!waybill.physicalExit && !waybill.manualOutageExit)) {
    throw new DispatchRecoveryConflictError('Only a physically exited or registered outage waybill can be corrected.');
  }
  const dispatchOccurredAt = waybill.physicalExit?.occurredAt || waybill.manualOutageExit?.actualOccurredAt;
  if (!dispatchOccurredAt || input.effectiveAt < dispatchOccurredAt) {
    throw new DispatchRecoveryValidationError('Correction effectiveAt cannot precede the original physical dispatch.');
  }
  const pricingVersionByItem = new Map(waybill.candidate.allocationRevision.pricingReferences.flatMap((reference) =>
    reference.pricingVersion.rows.map((row) => [row.contractItemId, reference.pricingVersionId] as const)));
  let normalized: ReturnType<typeof normalizeDispatchCorrectionDraft>;
  try {
    normalized = normalizeDispatchCorrectionDraft({ lines: input.lines, reattributions: input.reattributions,
      reversalOfId: input.reversalOfId }, waybill.candidate.allocationRevision.lines.map((line) => ({
      contractId: line.sourceContractId, contractItemId: line.sourceContractItemId, productRowId: line.productRowId,
      unit: line.unit, pricingVersionId: pricingVersionByItem.get(line.sourceContractItemId) || '',
    })));
  } catch (error) {
    if (error instanceof StatementCorrectionPolicyError) throw new DispatchRecoveryValidationError(error.message);
    throw error;
  }
  const lines = normalized.lines.map((line) => ({ contractId: line.contractId, contractItemId: line.contractItemId,
    productRowId: line.productRowId, unit: line.unit, quantity: signedQuantity(line.quantity),
    returnEvidenceId: line.returnEvidenceId }));
  if (input.reversalOfId) {
    await lock(tx, [`DISPATCH_CORRECTION_REVERSAL:${input.reversalOfId}`]);
    const prior = await tx.dispatchCorrection.findUnique({ where: { id: input.reversalOfId }, include: { lines: true } });
    if (!prior || prior.status !== 'POSTED' || prior.waybillId !== waybill.id) throw new DispatchRecoveryConflictError('Only a posted correction on this waybill can be reversed.');
    if (input.effectiveAt < prior.effectiveAt) throw new DispatchRecoveryValidationError('A reversal cannot become effective before the correction it reverses.');
    const priorByRow = new Map(prior.lines.map((line) => [line.contractItemId, line.quantity]));
    if (lines.length !== prior.lines.length || lines.some((line) => !priorByRow.get(line.contractItemId)?.equals(line.quantity.negated()))) {
      throw new DispatchRecoveryValidationError('A reversal must contain the exact opposite of every original correction line.');
    }
    if (await tx.dispatchCorrection.findFirst({ where: { reversalOfId: prior.id } })) {
      throw new DispatchRecoveryConflictError('This posted correction already has an immutable opposite correction.');
    }
  }
  const at = new Date();
  const correction = await tx.dispatchCorrection.create({ data: { waybillId: waybill.id, reason: required(input.reason, 'reason'),
    effectiveAt: input.effectiveAt, createdBy: input.actorId, reversalOfId: input.reversalOfId || null,
    lines: { create: lines } }, include: { lines: true } });
  await appendAudit(tx, { aggregateType: 'DISPATCH_CORRECTION', aggregateId: correction.id, eventType: 'CORRECTION_DRAFT_CREATED',
    payload: { waybillId: waybill.id, reason: correction.reason, effectiveAt: correction.effectiveAt,
      correctionKind: normalized.kind, reattributions: normalized.reattributions, lines: correction.lines },
    actorId: input.actorId, authority: input.authority, at });
  return correction;
});

export const postDispatchCorrection = (prisma: PrismaClient, input: { correctionId: string; actorId: string; authority: Authority;
  idempotencyKey: string; correlationId?: string },
  dependencies: { artifactPreparer?: ConfiguredStatementAdjustmentArtifactPreparer; now?: () => Date; id?: () => string } = {}) =>
  (() => {
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const createId = dependencies.id || randomUUID;
    const issuedAt = dependencies.now?.() || new Date();
    const correlationId = input.correlationId?.trim() || createId();
    const adjustmentId = createId();
    const requestHash = digest({ correctionId: input.correctionId, actorId: input.actorId, authority: input.authority });
    const prepared = new Map<string, ReturnType<ConfiguredStatementAdjustmentArtifactPreparer['preparer']['prepare']>>();
    const artifactPreparer = dependencies.artifactPreparer ? {
      templateVersion: dependencies.artifactPreparer.templateVersion,
      preparer: { prepare: (renderInput: Parameters<ConfiguredStatementAdjustmentArtifactPreparer['preparer']['prepare']>[0]) => {
        const key = digest(renderInput);
        const existing = prepared.get(key);
        if (existing) return existing;
        const result = dependencies.artifactPreparer!.preparer.prepare(renderInput);
        prepared.set(key, result);
        return result;
      } },
    } : undefined;
    return serializableCorrectionPosting(prisma, async (tx) => {
    await lock(tx, [`DISPATCH_CORRECTION:${input.correctionId}`]);
    const scope = await tx.dispatchCorrection.findUnique({ where: { id: input.correctionId }, select: {
      waybillId: true, waybill: { select: { candidate: { select: { allocationRevision: { select: {
        lines: { select: { sourceContractId: true, sourceContractItemId: true, productRowId: true, unit: true } },
        pricingReferences: { select: { pricingVersionId: true, pricingVersion: { select: { rows: { select: {
          id: true, contractItemId: true,
        } } } } } },
      } } } } } },
    } });
    if (!scope) throw new DispatchRecoveryValidationError('Dispatch correction was not found.');
    const pricingRowIds = scope.waybill.candidate.allocationRevision.pricingReferences
      .flatMap((reference) => reference.pricingVersion.rows.map((row) => row.id));
    await lock(tx, [`ACCOUNTING_DISPATCH_WAYBILL:${scope.waybillId}`, `STATEMENT_ADJUSTMENT:${scope.waybillId}`,
      ...pricingRowIds.map((id) => `PRICED_ALLOCATION_LEDGER:${id}`)]);
    const priorCommand = await tx.dispatchDocumentCommandResult.findUnique({ where: { scope_scopeId_idempotencyKey: {
      scope: 'CORRECTION', scopeId: input.correctionId, idempotencyKey,
    } } });
    if (priorCommand) {
      const result = record(priorCommand.result);
      if (result.requestHash !== requestHash) throw new DispatchRecoveryConflictError('The correction idempotency key was used with different command evidence.');
      if (priorCommand.status !== 'SUCCEEDED') throw new DispatchRecoveryConflictError('The correction posting command did not complete successfully.');
      return result.response;
    }
    const correction = await tx.dispatchCorrection.findUnique({ where: { id: input.correctionId }, include: { lines: true, waybill: true } });
    if (!correction) throw new DispatchRecoveryValidationError('Dispatch correction was not found.');
    if (correction.status === 'POSTED') {
      const originalCommand = await tx.dispatchDocumentCommandResult.findFirst({ where: { scope: 'CORRECTION',
        scopeId: correction.id, command: 'ISSUE_ADJUSTMENT', status: 'SUCCEEDED' }, orderBy: { completedAt: 'asc' } });
      if (originalCommand) {
        const result = record(originalCommand.result);
        if (result.requestHash !== requestHash) throw new DispatchRecoveryConflictError('The posted correction belongs to different command evidence.');
        return result.response;
      }
      return stable(correction);
    }
    const at = issuedAt;
    const policy = await correctionPostingPolicy(tx, correction);
    if (policy.kind === 'REATTRIBUTION') {
      const pricingVersionByItem = new Map(scope.waybill.candidate.allocationRevision.pricingReferences.flatMap((reference) =>
        reference.pricingVersion.rows.map((row) => [row.contractItemId, reference.pricingVersionId] as const)));
      let expected: ReturnType<typeof normalizeDispatchCorrectionDraft>;
      try {
        expected = normalizeDispatchCorrectionDraft({ reattributions: Array.isArray(policy.reattributions)
          ? policy.reattributions as Array<{ sourceContractItemId: string; destinationContractItemId: string; quantity: string | number }> : [] },
        scope.waybill.candidate.allocationRevision.lines.map((line) => ({ contractId: line.sourceContractId,
          contractItemId: line.sourceContractItemId, productRowId: line.productRowId, unit: line.unit,
          pricingVersionId: pricingVersionByItem.get(line.sourceContractItemId) || '' })));
      } catch (error) {
        throw new DispatchRecoveryConflictError(error instanceof Error ? error.message : 'Row reattribution evidence is invalid.');
      }
      const actualLines = correction.lines.map((line) => ({ contractId: line.contractId, contractItemId: line.contractItemId,
        productRowId: line.productRowId, unit: line.unit, quantity: line.quantity.toFixed(3),
        returnEvidenceId: line.returnEvidenceId })).sort((left, right) => left.contractItemId.localeCompare(right.contractItemId));
      const expectedLines = expected.lines.map(({ pricingVersionId: _pricingVersionId, ...line }) => line)
        .sort((left, right) => left.contractItemId.localeCompare(right.contractItemId));
      if (JSON.stringify(actualLines) !== JSON.stringify(expectedLines)) {
        throw new DispatchRecoveryConflictError('Posted reattribution no longer matches its immutable source-to-destination pairs.');
      }
    }
    for (const line of correction.lines) {
      if (policy.kind === 'REATTRIBUTION' && line.returnEvidenceId) {
        throw new DispatchRecoveryConflictError('Row reattribution cannot consume Guard return evidence.');
      }
      if (line.quantity.lt(0) && !correction.reversalOfId && policy.kind !== 'REATTRIBUTION') {
        if (!line.returnEvidenceId) throw new DispatchRecoveryConflictError('Negative corrections require verified Guard return evidence.');
        const returnEvidence = await tx.shipmentQuantityEvidence.findUnique({ where: { id: line.returnEvidenceId }, include: {
          guardReturnMovement: true, dispatchEvidence: true,
        } });
        const validatedReturnEvidence = returnEvidence ? { ...returnEvidence,
          dispatchEvidence: await withDispatchLoadingAttribution(tx, returnEvidence.dispatchEvidence) } : null;
        const movementReturns = validatedReturnEvidence?.guardReturnMovementId
          ? await tx.shipmentQuantityEvidence.findMany({ where: { kind: 'GUARD_RETURN_VERIFIED',
            guardReturnMovementId: validatedReturnEvidence.guardReturnMovementId }, include: { guardReturnMovement: true, dispatchEvidence: true } })
          : [];
        const failure = !validatedReturnEvidence ? 'Verified Guard return evidence was not found.'
          : guardReturnValidationFailure(validatedReturnEvidence, movementReturns.map((item) => item.id === validatedReturnEvidence.id
            ? validatedReturnEvidence : item));
        if (validatedReturnEvidence && correction.effectiveAt < validatedReturnEvidence.effectiveAt) {
          throw new DispatchRecoveryConflictError('Negative correction effectiveAt cannot precede its verified physical return.');
        }
        if (failure || returnEvidence!.contractItemId !== line.contractItemId
          || line.quantity.negated().gt(returnEvidence!.quantity)) {
          throw new DispatchRecoveryConflictError(failure || 'Correction exceeds or misattributes the verified physical return.');
        }
        const consumed = await tx.shipmentQuantityEvidence.findFirst({ where: { kind: 'DISPATCH_CORRECTION_POSTED', returnEvidenceId: line.returnEvidenceId } });
        if (consumed) throw new DispatchRecoveryConflictError('Verified Guard return evidence was already consumed by a posted correction.');
      }
    }
    const integrityHash = digest({ correctionId: correction.id, waybillId: correction.waybillId, reason: correction.reason,
      effectiveAt: correction.effectiveAt, lines: correction.lines, postedAt: at });
    const adjustmentPlan = await planStatementAdjustment(tx, { correctionId: correction.id, actorId: input.actorId,
      correctionIntegrityHash: integrityHash, issuedAt: at, artifactPreparer,
      id: () => adjustmentId });
    for (const line of correction.lines) {
      const evidence = { id: randomUUID(), contractId: line.contractId, contractItemId: line.contractItemId, productRowId: line.productRowId,
        unit: line.unit, kind: 'DISPATCH_CORRECTION_POSTED' as const, quantity: line.quantity.toFixed(3),
        effectiveAt: correction.effectiveAt.toISOString(), recordedAt: at.toISOString(), sourceType: 'DISPATCH_CORRECTION',
        sourceId: line.id, sourceVersion: 1, integrityHash: '', returnEvidenceId: line.returnEvidenceId || undefined,
        metadata: { waybillId: correction.waybillId, correctionId: correction.id, reversalOfId: correction.reversalOfId } };
      evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
      await tx.shipmentQuantityEvidence.create({ data: { ...evidence, quantity: line.quantity, effectiveAt: correction.effectiveAt,
        recordedAt: at, metadata: json(evidence.metadata), returnEvidenceId: line.returnEvidenceId || null } });
    }
    const posted = await tx.dispatchCorrection.update({ where: { id: correction.id }, data: { status: 'POSTED', postedAt: at,
      postedBy: input.actorId, integrityHash }, include: { lines: true } });
    const adjustment = adjustmentPlan ? await persistStatementAdjustment(tx, adjustmentPlan) : null;
    await refreshProjectionContracts(tx, correction.lines.map((line) => line.contractId));
    await appendAudit(tx, { aggregateType: 'DISPATCH_CORRECTION', aggregateId: correction.id, eventType: 'CORRECTION_POSTED',
      payload: { waybillId: correction.waybillId, beforeStatus: 'DRAFT', afterStatus: 'POSTED', integrityHash,
        effectiveAt: correction.effectiveAt, recordedAt: at, reason: correction.reason,
        statementAdjustmentId: adjustment?.adjustment.id || null,
        statementAdjustmentSequence: adjustment?.adjustment.sequence || null,
        statementAdjustmentIntegrityHash: adjustment?.adjustment.integrityHash || null,
        statementAdjustmentArtifactId: adjustment?.artifact.id || null,
        statementAdjustmentArtifactSourceIntegrityHash: adjustment?.artifact.sourceIntegrityHash || null,
      }, actorId: input.actorId, authority: input.authority, at });
    const response = stable({ ...posted, statementAdjustment: adjustment ? {
      id: adjustment.adjustment.id, sequence: adjustment.adjustment.sequence, integrityHash: adjustment.adjustment.integrityHash,
      artifactId: adjustment.artifact.id,
    } : null });
    await tx.dispatchDocumentCommandResult.create({ data: { waybillId: correction.waybillId, scope: 'CORRECTION',
      scopeId: correction.id, idempotencyKey, command: 'ISSUE_ADJUSTMENT', status: 'SUCCEEDED',
      result: json({ requestHash, response }), actorId: input.actorId, correlationId, completedAt: at } });
    return response;
    });
  })();

export const verifyGuardPhysicalReturn = (prisma: PrismaClient, input: { movementId: string; dispatchEvidenceId: string;
  quantity: string | number; actorId: string; authority: Authority }) => serializable(prisma, async (tx) => {
  await lock(tx, [`GUARD_RETURN:${input.movementId}`, `SHIPMENT_EVIDENCE:${input.dispatchEvidenceId}`]);
  const [movement, dispatchEvidence] = await Promise.all([
    tx.securityVehicleMovement.findUnique({ where: { id: input.movementId } }),
    tx.shipmentQuantityEvidence.findUnique({ where: { id: input.dispatchEvidenceId } }),
  ]);
  if (!movement || !dispatchEvidence) throw new DispatchRecoveryValidationError('Return movement and dispatch evidence are required.');
  const validatedDispatchEvidence = await withDispatchLoadingAttribution(tx, dispatchEvidence);
  const quantity = positiveQuantity(input.quantity);
  const evidence = { id: randomUUID(), contractId: dispatchEvidence.contractId, contractItemId: dispatchEvidence.contractItemId,
    productRowId: dispatchEvidence.productRowId, unit: dispatchEvidence.unit, kind: 'GUARD_RETURN_VERIFIED' as const,
    quantity: quantity.toFixed(3), effectiveAt: movement.occurredAt.toISOString(), recordedAt: new Date().toISOString(),
    sourceType: 'GUARD_RETURN_MOVEMENT', sourceId: `${movement.id}:${dispatchEvidence.id}`, sourceVersion: 1, integrityHash: '',
    guardReturnMovementId: movement.id, dispatchEvidenceId: dispatchEvidence.id,
    metadata: { loadingId: movement.loadingId, movementNumber: movement.movementNumber,
      dispatchLoadingId: (validatedDispatchEvidence.metadata as Record<string, unknown>).loadingId } };
  const existingReturns = await tx.shipmentQuantityEvidence.findMany({ where: { kind: 'GUARD_RETURN_VERIFIED', guardReturnMovementId: movement.id },
    include: { guardReturnMovement: true, dispatchEvidence: true } });
  const exactRetry = existingReturns.find((item) => item.dispatchEvidenceId === dispatchEvidence.id);
  if (exactRetry) {
    if (exactRetry.quantity.equals(quantity)) return exactRetry;
    throw new DispatchRecoveryConflictError('This Guard return movement and dispatch attribution already has a different verified quantity.');
  }
  const candidate = { ...evidence, guardReturnMovement: movement, dispatchEvidence: validatedDispatchEvidence };
  const failure = guardReturnValidationFailure(candidate, [...existingReturns, candidate]);
  if (failure) throw new DispatchRecoveryConflictError(failure);
  evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
  const created = await tx.shipmentQuantityEvidence.create({ data: { ...evidence, quantity, effectiveAt: movement.occurredAt,
    recordedAt: new Date(evidence.recordedAt), metadata: json(evidence.metadata) } });
  await refreshProjectionContracts(tx, [created.contractId]);
  await appendAudit(tx, { aggregateType: 'GUARD_RETURN', aggregateId: created.id, eventType: 'PHYSICAL_RETURN_VERIFIED',
    payload: { movementId: movement.id, dispatchEvidenceId: dispatchEvidence.id, quantity: quantity.toFixed(3),
      effectiveAt: movement.occurredAt, recordedAt: created.recordedAt, integrityHash: created.integrityHash },
    actorId: input.actorId, authority: input.authority, at: created.recordedAt });
  return created;
});

export const verifyErpWideOutage = (prisma: PrismaClient, input: { reason: string; verification: Record<string, unknown>; actualStartedAt: Date;
  actorId: string; authority: Authority }) => serializable(prisma, async (tx) => {
  if (input.authority.actorRole !== 'ADMIN') throw new DispatchRecoveryConflictError('Only a global administrator may verify an ERP-wide outage.');
  await lock(tx, ['DISPATCH_OUTAGE:ERP_WIDE']);
  if (await tx.dispatchOutage.findFirst({ where: { scope: 'ERP_WIDE', status: 'VERIFIED' } })) {
    throw new DispatchRecoveryConflictError('An ERP-wide outage is already verified and active.');
  }
  const confirmed = Array.isArray(input.verification.confirmedUnavailableServices) ? input.verification.confirmedUnavailableServices.map(String) : [];
  validDate(input.actualStartedAt, 'actualStartedAt');
  const at = new Date();
  if (input.actualStartedAt > at) throw new DispatchRecoveryValidationError('Actual outage start cannot be in the future.');
  if (!required(input.verification.incidentReference, 'incidentReference') || !['backend', 'database'].every((service) => confirmed.includes(service))) {
    throw new DispatchRecoveryValidationError('ERP-wide outage verification requires an incident reference and confirmed backend/database unavailability.');
  }
  const outage = await tx.dispatchOutage.create({ data: { scope: 'ERP_WIDE', reason: required(input.reason, 'reason'),
    verification: json(input.verification), actualStartedAt: input.actualStartedAt, verifiedAt: at, verifiedBy: input.actorId } });
  await appendAudit(tx, { aggregateType: 'DISPATCH_OUTAGE', aggregateId: outage.id, eventType: 'ERP_WIDE_OUTAGE_VERIFIED',
    payload: { scope: outage.scope, reason: outage.reason, verification: outage.verification,
      actualStartedAt: outage.actualStartedAt, recordedAt: outage.verifiedAt }, actorId: input.actorId, authority: input.authority, at });
  return outage;
});

export const createManualOutageExit = async (prisma: PrismaClient, input: { outageId: string; waybillId: string; paperNumber: string;
  actualOccurredAt: Date; paperEvidence: Record<string, unknown>; actorId: string; authority: Authority }) => {
  const paperNumber = required(input.paperNumber, 'paperNumber');
  const result = await serializable(prisma, async (tx) => {
    await lock(tx, [`MANUAL_OUTAGE_PAPER:${paperNumber}`, `MANUAL_OUTAGE_WAYBILL:${input.waybillId}`]);
    const waybill = await waybillContext(tx, input.waybillId);
    const revision = waybill.candidate.allocationRevision;
    await lock(tx, [`MANUAL_OUTAGE_QUEUE:${revision.queueTurnId}`, `MANUAL_OUTAGE_REVISION:${revision.id}`]);
    const duplicate = await tx.manualOutageExit.findFirst({ where: { OR: [{ paperNumber }, { waybillId: input.waybillId },
      { queueTurnId: revision.queueTurnId }, { allocationRevisionId: revision.id }] } });
    if (duplicate) {
      const at = new Date();
      const exceptionType = duplicate.paperNumber === paperNumber
        ? 'DUPLICATE_EMERGENCY_PAPER_NUMBER' : 'CONFLICTING_EMERGENCY_WAYBILL';
      await tx.dispatchEvidenceException.create({ data: { exceptionType, aggregateType: 'MANUAL_OUTAGE_EXIT',
        aggregateId: duplicate.id, createdBy: input.actorId, detail: json({ attemptedPaperNumber: paperNumber,
          existingPaperNumber: duplicate.paperNumber, waybillId: input.waybillId, queueTurnId: revision.queueTurnId,
          allocationRevisionId: revision.id }) } });
      await appendAudit(tx, { aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: duplicate.id,
        eventType: exceptionType, payload: { attemptedPaperNumber: paperNumber, existingPaperNumber: duplicate.paperNumber,
          waybillId: input.waybillId, queueTurnId: revision.queueTurnId, allocationRevisionId: revision.id },
        actorId: input.actorId, authority: input.authority, at });
      return { conflict: true as const };
    }
    validDate(input.actualOccurredAt, 'actualOccurredAt');
    if (input.actualOccurredAt > new Date()) throw new DispatchRecoveryValidationError('Actual outage exit time cannot be in the future.');
    required(input.paperEvidence?.attachmentReference, 'paperEvidence.attachmentReference');
    const outage = await tx.dispatchOutage.findUnique({ where: { id: input.outageId } });
    if (!outage || outage.status !== 'VERIFIED' || outage.scope !== 'ERP_WIDE') throw new DispatchRecoveryConflictError('A verified ERP-wide outage is required.');
    if (waybill.status !== 'ISSUED' || waybill.physicalExit || waybill.manualOutageExit || revision.queueTurn.status !== 'LOADING_FINALIZED') {
      throw new DispatchRecoveryConflictError('Manual outage exit requires one unexited issued waybill awaiting physical exit.');
    }
    if (input.actualOccurredAt < outage.actualStartedAt) throw new DispatchRecoveryValidationError('Actual outage exit time cannot precede the actual outage start.');
    if (!/^MOE-\d{6,}$/.test(paperNumber)) throw new DispatchRecoveryValidationError('Manual outage paper number must use the pre-numbered MOE-NNNNNN format.');
    const at = new Date();
    const record = await tx.manualOutageExit.create({ data: { outageId: outage.id, waybillId: waybill.id,
      queueTurnId: revision.queueTurnId, allocationRevisionId: revision.id, paperNumber,
      actualOccurredAt: input.actualOccurredAt, paperEvidence: json(input.paperEvidence) } });
    await appendAudit(tx, { aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: record.id, eventType: 'PAPER_EXIT_REGISTERED_PENDING_APPROVALS',
      payload: { paperNumber, waybillId: waybill.id, actualOccurredAt: input.actualOccurredAt, outageId: outage.id },
      actorId: input.actorId, authority: input.authority, at });
    return { conflict: false as const, record };
  });
  if (result.conflict) throw new DispatchRecoveryConflictError('Emergency paper number or waybill already has a manual outage record.');
  return result.record;
};

export const approveManualOutageExit = (prisma: PrismaClient, input: { id: string; role: 'ACCOUNTING' | 'GUARD'; actorId: string; authority: Authority }) =>
  serializable(prisma, async (tx) => {
    await lock(tx, [`MANUAL_OUTAGE_EXIT:${input.id}`]);
    const record = await tx.manualOutageExit.findUnique({ where: { id: input.id } });
    if (!record || !['PENDING_APPROVALS', 'APPROVED'].includes(record.status)) throw new DispatchRecoveryConflictError('Manual outage record is not awaiting approval.');
    if (input.role === 'ACCOUNTING' && input.authority.workspace !== 'accounting') throw new DispatchRecoveryConflictError('Accounting approval requires Accounting authority.');
    if (input.role === 'GUARD' && input.authority.workspace !== 'security') throw new DispatchRecoveryConflictError('Guard approval requires Security authority.');
    if (input.authority.workspacePermission !== 'admin') throw new DispatchRecoveryConflictError('Manual outage approval requires workspace supervisor authority.');
    const existingActor = input.role === 'ACCOUNTING' ? record.accountingApprovedBy : record.guardApprovedBy;
    if (existingActor) {
      if (existingActor === input.actorId) return record;
      throw new DispatchRecoveryConflictError(`${input.role === 'ACCOUNTING' ? 'Accounting' : 'Guard'} approval is immutable and already belongs to another actor.`);
    }
    const otherActor = input.role === 'ACCOUNTING' ? record.guardApprovedBy : record.accountingApprovedBy;
    if (otherActor === input.actorId) throw new DispatchRecoveryConflictError('Accounting and Guard outage approvals require different actors.');
    const at = new Date();
    const updated = await tx.manualOutageExit.update({ where: { id: record.id }, data: input.role === 'ACCOUNTING'
      ? { accountingApprovedAt: at, accountingApprovedBy: input.actorId,
        status: record.guardApprovedBy ? 'APPROVED' : 'PENDING_APPROVALS' }
      : { guardApprovedAt: at, guardApprovedBy: input.actorId,
        status: record.accountingApprovedBy ? 'APPROVED' : 'PENDING_APPROVALS' } });
    await appendAudit(tx, { aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: record.id, eventType: `${input.role}_PAPER_EXIT_APPROVED`,
      payload: { paperNumber: record.paperNumber, waybillId: record.waybillId, beforeStatus: record.status, afterStatus: updated.status },
      actorId: input.actorId, authority: input.authority, at });
    return updated;
  });

export const endErpWideOutage = (prisma: PrismaClient, input: { outageId: string; actualEndedAt: Date; actorId: string; authority: Authority }) =>
  serializable(prisma, async (tx) => {
    if (input.authority.actorRole !== 'ADMIN') throw new DispatchRecoveryConflictError('Only a global administrator may end an ERP-wide outage.');
    await lock(tx, ['DISPATCH_OUTAGE:ERP_WIDE']);
    const current = await tx.dispatchOutage.findUnique({ where: { id: input.outageId } });
    if (!current || current.scope !== 'ERP_WIDE' || current.status !== 'VERIFIED') {
      throw new DispatchRecoveryConflictError('Only a currently verified ERP-wide outage can be ended.');
    }
    validDate(input.actualEndedAt, 'actualEndedAt');
    const at = new Date();
    if (input.actualEndedAt < current.actualStartedAt || input.actualEndedAt > at) {
      throw new DispatchRecoveryValidationError('Actual outage end must fall between the actual start and its ERP recording time.');
    }
    const outage = await tx.dispatchOutage.update({ where: { id: input.outageId }, data: { status: 'ENDED', actualEndedAt: input.actualEndedAt,
      endedAt: at, endedBy: input.actorId } });
    await appendAudit(tx, { aggregateType: 'DISPATCH_OUTAGE', aggregateId: outage.id, eventType: 'ERP_WIDE_OUTAGE_ENDED',
      payload: { beforeStatus: 'VERIFIED', afterStatus: 'ENDED', actualEndedAt: input.actualEndedAt, recordedAt: at },
      actorId: input.actorId, authority: input.authority, at });
    return outage;
  });

export const registerManualOutageExit = (prisma: PrismaClient, input: { id: string; actorId: string; authority: Authority }) =>
  serializable(prisma, async (tx) => {
    if (input.authority.workspace !== 'security' || input.authority.workspacePermission !== 'admin') {
      throw new DispatchRecoveryConflictError('Retrospective outage registration requires a Guard supervisor.');
    }
    const initial = await tx.manualOutageExit.findUnique({ where: { id: input.id }, include: { waybill: { include: {
      exitAuthorizations: { where: { status: 'ACTIVE' } }, candidate: { include: { allocationRevision: true } },
    } } } });
    if (!initial) throw new DispatchRecoveryValidationError('Manual outage record was not found.');
    await lock(tx, [`MANUAL_OUTAGE_EXIT:${input.id}`, `ACCOUNTING_DISPATCH_WAYBILL:${initial.waybillId}`,
      `GUARD_QUEUE:${initial.queueTurnId}`, `LOGISTICS_ALLOCATION_REVISION:${initial.allocationRevisionId}`,
      ...initial.waybill.exitAuthorizations.map((authorization) => `DISPATCH_EXIT_AUTHORIZATION:${authorization.id}`)]);
    const record = await tx.manualOutageExit.findUnique({ where: { id: input.id }, include: { outage: true,
      waybill: { include: { candidate: { include: { allocationRevision: { include: { lines: true, queueTurn: true } } } } } } } });
    if (!record) throw new DispatchRecoveryValidationError('Manual outage record was not found.');
    if (record.status === 'REGISTERED') return record;
    if (record.status !== 'APPROVED' || !record.accountingApprovedBy || !record.guardApprovedBy || record.accountingApprovedBy === record.guardApprovedBy) {
      throw new DispatchRecoveryConflictError('Distinct Accounting and Guard approvals are required.');
    }
    if (record.outage.status !== 'ENDED' || !record.outage.endedAt) throw new DispatchRecoveryConflictError('Retrospective registration is available only after ERP recovery.');
    if (!record.outage.actualEndedAt || record.actualOccurredAt > record.outage.actualEndedAt) {
      throw new DispatchRecoveryConflictError('Actual exit time must fall within the verified outage window.');
    }
    const waybill = record.waybill;
    const revision = waybill.candidate.allocationRevision;
    if (waybill.status !== 'ISSUED' || revision.queueTurn.status !== 'LOADING_FINALIZED') throw new DispatchRecoveryConflictError('Waybill or queue state conflicts with the paper record.');
    const at = new Date();
    const revisionSnapshot = revision.snapshot as Record<string, any>;
    const admission = revision.queueTurn.admissionSnapshot as Record<string, any>;
    const phoneNumber = String(revisionSnapshot?.notification?.confirmationPhone || '').trim() || null;
    const vehiclePlate = String(admission?.plate?.plate || admission?.vehicle?.plate || '').trim();
    const snapshot = { schemaVersion: 1, method: 'MANUAL_OUTAGE_EXIT', paperNumber: record.paperNumber,
      outageId: record.outageId, waybillId: waybill.id, waybillIntegrityHash: waybill.integrityHash,
      allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash, queueTurnId: revision.queueTurnId,
      actualOccurredAt: record.actualOccurredAt, recordedAt: at, accountingApprovedBy: record.accountingApprovedBy,
      guardApprovedBy: record.guardApprovedBy, biometricSuccess: false, otpSuccess: false, paperEvidence: record.paperEvidence };
    const integrityHash = digest(snapshot);
    for (const line of revision.lines) {
      const evidence = { id: randomUUID(), contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
        productRowId: line.productRowId, unit: line.unit, kind: 'MANUAL_OUTAGE_EXIT' as const, quantity: line.quantity.toFixed(3),
        effectiveAt: record.actualOccurredAt.toISOString(), recordedAt: at.toISOString(), sourceType: 'MANUAL_OUTAGE_EXIT',
        sourceId: `${record.id}:${line.id}`, sourceVersion: 1, integrityHash: '', metadata: { loadingId: revision.loadingId,
          waybillId: waybill.id, paperNumber: record.paperNumber, manualOutageExitId: record.id, allocationRevisionId: revision.id } };
      evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
      await tx.shipmentQuantityEvidence.create({ data: { ...evidence, quantity: line.quantity, effectiveAt: record.actualOccurredAt,
        recordedAt: at, metadata: json(evidence.metadata) } });
    }
    const activeAuthorizations = await tx.dispatchExitAuthorization.findMany({ where: { waybillId: waybill.id, status: 'ACTIVE' } });
    for (const authorization of activeAuthorizations) {
      await tx.dispatchExitAuthorization.update({ where: { id: authorization.id }, data: { status: 'REVOKED', revokedAt: at,
        revokedBy: input.actorId, revocationReason: `Superseded by registered manual outage exit ${record.paperNumber}` } });
      await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: authorization.id,
        eventType: 'REVOKED_BY_MANUAL_OUTAGE_EXIT', payload: { waybillId: waybill.id, manualOutageExitId: record.id,
          beforeStatus: 'ACTIVE', afterStatus: 'REVOKED' }, actorId: input.actorId, authority: input.authority, at });
    }
    await tx.accountingDispatchWaybill.update({ where: { id: waybill.id }, data: { status: AccountingDispatchWaybillStatus.EXIT_RECORDED } });
    await tx.guardDriverQueueTurn.update({ where: { id: revision.queueTurnId }, data: { status: GuardDriverQueueTurnStatus.EXIT_RECORDED,
      exitedAt: record.actualOccurredAt, exitedBy: input.actorId } });
    await appendQueueEvent(tx, { turnId: revision.queueTurnId, eventType: 'MANUAL_OUTAGE_EXIT_REGISTERED',
      fromStatus: GuardDriverQueueTurnStatus.LOADING_FINALIZED, toStatus: GuardDriverQueueTurnStatus.EXIT_RECORDED,
      actorId: input.actorId, payload: { manualOutageExitId: record.id, paperNumber: record.paperNumber, waybillId: waybill.id } });
    const registered = await tx.manualOutageExit.update({ where: { id: record.id }, data: { status: 'REGISTERED',
      recordedAt: at, recordedBy: input.actorId, snapshot: json(snapshot), integrityHash } });
    await tx.dispatchBuyerSmsIntent.create({ data: { manualOutageExitId: record.id, idempotencyKey: `BUYER_OUTAGE_EXIT:${record.id}`,
      phoneNumber, dispatchNumber: waybill.number.toString(), vehiclePlate, payload: json({ dispatchNumber: waybill.number.toString(), vehiclePlate }),
      status: phoneNumber ? 'PENDING' : 'NEEDS_ATTENTION', availableAt: at } });
    if (!phoneNumber) await tx.dispatchEvidenceException.create({ data: { exceptionType: 'BUYER_EXIT_SMS_NEEDS_ATTENTION',
      aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: record.id, createdBy: input.actorId,
      detail: json({ paperNumber: record.paperNumber, reason: 'No confirmed buyer notification phone was snapshotted.' }) } });
    await refreshProjectionContracts(tx, revision.lines.map((line) => line.sourceContractId));
    await appendAudit(tx, { aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: record.id, eventType: 'MANUAL_OUTAGE_EXIT_REGISTERED',
      payload: { paperNumber: record.paperNumber, waybillId: waybill.id, actualOccurredAt: record.actualOccurredAt,
        recordedAt: at, before: { waybill: 'ISSUED', queueTurn: 'LOADING_FINALIZED' },
        after: { waybill: 'EXIT_RECORDED', queueTurn: 'EXIT_RECORDED' }, integrityHash },
      actorId: input.actorId, authority: input.authority, at });
    return registered;
  });

export const spoilManualOutageExit = (prisma: PrismaClient, input: { id: string; reason: string; actorId: string; authority: Authority }) =>
  serializable(prisma, async (tx) => {
    if (input.authority.workspace !== 'security' || input.authority.workspacePermission !== 'admin') {
      throw new DispatchRecoveryConflictError('Spoiling a manual outage record requires a Guard supervisor.');
    }
    const record = await tx.manualOutageExit.findUnique({ where: { id: input.id } });
    if (!record || !['PENDING_APPROVALS', 'APPROVED'].includes(record.status)) throw new DispatchRecoveryConflictError('Only an unregistered paper record can be spoiled.');
    const at = new Date();
    const spoiled = await tx.manualOutageExit.update({ where: { id: record.id }, data: { status: 'SPOILED' } });
    await tx.dispatchEvidenceException.create({ data: { exceptionType: 'SPOILED_EMERGENCY_RECORD', aggregateType: 'MANUAL_OUTAGE_EXIT',
      aggregateId: record.id, createdBy: input.actorId, detail: json({ paperNumber: record.paperNumber, reason: required(input.reason, 'reason') }) } });
    await appendAudit(tx, { aggregateType: 'MANUAL_OUTAGE_EXIT', aggregateId: record.id, eventType: 'PAPER_EXIT_SPOILED',
      payload: { paperNumber: record.paperNumber, reason: input.reason }, actorId: input.actorId, authority: input.authority, at });
    return spoiled;
  });

export const reportMissingManualOutagePaper = (prisma: PrismaClient, input: { paperNumber: string; reason: string;
  actorId: string; authority: Authority }) => serializable(prisma, async (tx) => {
  if (input.authority.workspace !== 'security' || input.authority.workspacePermission !== 'admin') {
    throw new DispatchRecoveryConflictError('Reporting missing outage paper requires a Guard supervisor.');
  }
  const paperNumber = required(input.paperNumber, 'paperNumber');
  if (!/^MOE-\d{6,}$/.test(paperNumber)) throw new DispatchRecoveryValidationError('Manual outage paper number must use the pre-numbered MOE-NNNNNN format.');
  const existing = await tx.manualOutageExit.findUnique({ where: { paperNumber } });
  if (existing) throw new DispatchRecoveryConflictError('A manual outage record already exists for this paper number.');
  const at = new Date();
  const exception = await tx.dispatchEvidenceException.create({ data: { exceptionType: 'MISSING_EMERGENCY_RECORD',
    aggregateType: 'MANUAL_OUTAGE_PAPER', aggregateId: paperNumber, createdBy: input.actorId,
    detail: json({ paperNumber, reason: required(input.reason, 'reason') }) } });
  await appendAudit(tx, { aggregateType: 'MANUAL_OUTAGE_PAPER', aggregateId: paperNumber,
    eventType: 'EMERGENCY_PAPER_REPORTED_MISSING', payload: { paperNumber, reason: input.reason }, actorId: input.actorId,
    authority: input.authority, at });
  return exception;
});
