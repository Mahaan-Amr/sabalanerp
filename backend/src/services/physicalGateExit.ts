import { createHash, randomUUID } from 'node:crypto';
import { AccountingDispatchWaybillStatus, DispatchBuyerSmsStatus, GuardDriverQueueTurnStatus, Prisma, PrismaClient } from '@prisma/client';
import { refreshProjectionContracts } from './dispatchAllocation';
import { appendQueueEvent } from './guardDriverQueue';
import { shipmentQuantityEvidenceIntegrityHash } from './shipmentQuantityProjectionStore';

type Tx = Prisma.TransactionClient;
export class PhysicalGateExitValidationError extends Error {}
export class PhysicalGateExitConflictError extends Error {}

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Prisma.Decimal) return value.toFixed(3);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stableValue(entry)]));
  return value;
};
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
export const guardPhysicalExitIntegrityHash = (value: unknown) => digest(value);
export const guardPhysicalExitAuditIntegrityHash = (input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; at: Date | string; previousHash: string | null }) =>
  digest({ ...input, at: input.at instanceof Date ? input.at : new Date(input.at), payload: stableValue(input.payload), previousHash: input.previousHash });
const json = (value: unknown) => stableValue(value) as Prisma.InputJsonValue;
const required = (value: unknown, name: string) => {
  const result = String(value || '').trim();
  if (!result) throw new PhysicalGateExitValidationError(`${name} is required.`);
  return result;
};
const asRecord = (value: unknown) => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};

const appendAudit = async (tx: Tx, input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; at: Date }) => {
  await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_AUDIT:${input.aggregateType}:${input.aggregateId}`);
  const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const payload = stableValue(input.payload || {});
  await tx.dispatchLifecycleAudit.create({ data: { aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    eventType: input.eventType, payload: json(payload), actorId: input.actorId, recordedAt: input.at,
    previousHash: previous?.eventHash || null, eventHash: digest({ ...input, payload, previousHash: previous?.eventHash || null }) } });
};

const serializable = async <T>(prisma: PrismaClient, work: (tx: Tx) => Promise<T>) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (error) {
      lastError = error;
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034') throw error;
    }
  }
  throw lastError;
};

type SmsResult = { outcome: 'SENT'; providerMessageId: string } | { outcome: 'UNKNOWN'; detail?: string } | { outcome: 'FAILED'; retryable: boolean; detail: string };

export class PhysicalGateExitService {
  constructor(private readonly prisma: PrismaClient, private readonly dependencies: {
    now?: () => Date;
    sendBuyerSms?: (message: { phoneNumber: string; dispatchNumber: string; vehiclePlate: string; idempotencyKey: string }) => Promise<SmsResult>;
  } = {}) {}

  private now() { return this.dependencies.now?.() || new Date(); }

  async listCurrentlyAuthorized() {
    const at = this.now();
    const authorizations = await this.prisma.dispatchExitAuthorization.findMany({ where: {
      status: 'ACTIVE', validUntil: { gt: at }, waybill: { status: AccountingDispatchWaybillStatus.ISSUED,
        candidate: { allocationRevision: { sealedAt: { not: null }, queueTurn: { status: GuardDriverQueueTurnStatus.LOADING_FINALIZED } } } },
    }, include: { waybill: { include: { candidate: { include: { allocationRevision: { include: { queueTurn: true } } } } } } }, orderBy: [{ issuedAt: 'asc' }, { id: 'asc' }] });
    return authorizations.map((authorization) => ({ id: authorization.id, waybillId: authorization.waybillId,
      dispatchNumber: authorization.waybill.number.toString(), validUntil: authorization.validUntil,
      method: authorization.method, queueTurnId: authorization.waybill.candidate.allocationRevision.queueTurnId,
      admissionSnapshot: authorization.waybill.candidate.allocationRevision.queueTurn.admissionSnapshot }));
  }

  async recordExit(input: { authorizationId: string; actorId: string; effectiveAuthority: unknown }) {
    const authorizationId = required(input.authorizationId, 'authorizationId');
    const actorId = required(input.actorId, 'actorId');
    const initial = await this.prisma.dispatchExitAuthorization.findUnique({ where: { id: authorizationId }, include: { physicalExit: { include: { smsIntent: true } }, waybill: { include: { candidate: { include: { allocationRevision: true } } } } } });
    if (!initial) throw new PhysicalGateExitValidationError('Exit authorization was not found.');
    if (initial.physicalExit) return initial.physicalExit;
    const revisionId = initial.waybill.candidate.allocationRevisionId;
    const queueTurnId = initial.waybill.candidate.allocationRevision.queueTurnId;
    try {
      const result = await serializable(this.prisma, async (tx) => {
      for (const key of [`ACCOUNTING_DISPATCH_WAYBILL:${initial.waybillId}`, `DISPATCH_EXIT_AUTHORIZATION:${authorizationId}`, `GUARD_QUEUE:${queueTurnId}`, `LOGISTICS_ALLOCATION_REVISION:${revisionId}`].sort()) {
        await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
      }
      const authorization = await tx.dispatchExitAuthorization.findUnique({ where: { id: authorizationId }, include: {
        physicalExit: { include: { smsIntent: true } },
        waybill: { include: { candidate: { include: { allocationRevision: { include: { lines: true, queueTurn: true } } } } } },
      } });
      if (!authorization) throw new PhysicalGateExitValidationError('Exit authorization was not found.');
      if (authorization.physicalExit) return authorization.physicalExit;
      const at = this.now();
      if (authorization.status !== 'ACTIVE') throw new PhysicalGateExitConflictError('Only a currently active authorization permits physical exit.');
      if (authorization.validUntil <= at) {
        await tx.dispatchExitAuthorization.update({ where: { id: authorization.id }, data: { status: 'EXPIRED' } });
        await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: authorization.id, eventType: 'EXPIRED_AT_EXIT_DESK',
          payload: { workspace: 'security', effectiveAuthority: input.effectiveAuthority,
            beforeStatus: 'ACTIVE', afterStatus: 'EXPIRED', waybillId: authorization.waybillId,
            queueTurnId: authorization.waybill.candidate.allocationRevision.queueTurnId, sessionId: authorization.sessionId,
            authorizationIntegrityHash: authorization.integrityHash, correlationId: authorization.id }, actorId, at });
        return { expired: true as const };
      }
      const waybill = authorization.waybill;
      const revision = waybill.candidate.allocationRevision;
      const turn = revision.queueTurn;
      if (waybill.status !== AccountingDispatchWaybillStatus.ISSUED || waybill.integrityHash !== authorization.waybillIntegrityHash) {
        throw new PhysicalGateExitConflictError('The authorized waybill snapshot is no longer valid.');
      }
      if (waybill.candidate.status !== 'ACCEPTED' || !revision.sealedAt) {
        throw new PhysicalGateExitConflictError('The authorized allocation is not active and sealed.');
      }
      if (turn.status !== GuardDriverQueueTurnStatus.LOADING_FINALIZED || turn.loadingId !== revision.loadingId) {
        throw new PhysicalGateExitConflictError('The Guard queue turn is not awaiting physical exit.');
      }
      const expectedDriverId = turn.driverSource === 'INTERNAL' ? turn.internalDriverId : turn.externalDriverId;
      if (!expectedDriverId || expectedDriverId !== authorization.driverId || turn.driverSource !== authorization.driverSource) {
        throw new PhysicalGateExitConflictError('The authorization does not match the admitted driver snapshot.');
      }
      const revisionSnapshot = asRecord(revision.snapshot);
      const admissionSnapshot = asRecord(turn.admissionSnapshot);
      const notification = asRecord(revisionSnapshot.notification);
      const plate = String(asRecord(admissionSnapshot.plate).plate || asRecord(admissionSnapshot.vehicle).plate || '').trim();
      const phoneNumber = String(notification.confirmationPhone || '').trim() || null;
      const exitId = randomUUID();
      const snapshot = { schemaVersion: 1, authorizationId: authorization.id, authorizationIntegrityHash: authorization.integrityHash,
        waybillId: waybill.id, dispatchNumber: waybill.number.toString(), waybillIntegrityHash: waybill.integrityHash,
        allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash, queueTurnId: turn.id,
        admissionIntegrityHash: turn.integrityHash, driverSource: turn.driverSource, driverId: expectedDriverId,
        vehiclePlate: plate, occurredAt: at, recordedBy: actorId };
      const physicalExit = await tx.guardPhysicalExit.create({ data: { id: exitId, authorizationId: authorization.id,
        waybillId: waybill.id, queueTurnId: turn.id, allocationRevisionId: revision.id, occurredAt: at, recordedAt: at,
        recordedBy: actorId, snapshot: json(snapshot), integrityHash: digest(snapshot) } });
      for (const line of revision.lines) {
        const evidence = { id: `${exitId}:${line.id}`, contractId: line.sourceContractId, contractItemId: line.sourceContractItemId,
          productRowId: line.productRowId, unit: line.unit, kind: 'PHYSICAL_EXIT' as const, quantity: line.quantity.toFixed(3),
          effectiveAt: at.toISOString(), recordedAt: at.toISOString(), sourceType: 'GUARD_PHYSICAL_EXIT', sourceId: `${exitId}:${line.id}`,
          sourceVersion: 1, integrityHash: '', metadata: { loadingId: revision.loadingId, waybillId: waybill.id, physicalExitId: exitId,
            authorizationId: authorization.id, allocationLineId: line.id, allocationRevisionId: revision.id } };
        evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
        await tx.shipmentQuantityEvidence.create({ data: { contractId: evidence.contractId, contractItemId: evidence.contractItemId,
          productRowId: evidence.productRowId, unit: evidence.unit, kind: evidence.kind, quantity: line.quantity,
          effectiveAt: at, recordedAt: at, sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
          integrityHash: evidence.integrityHash, metadata: json(evidence.metadata) } });
      }
      const consumed = await tx.dispatchExitAuthorization.updateMany({ where: { id: authorization.id, status: 'ACTIVE' }, data: { status: 'CONSUMED', consumedAt: at, consumedBy: actorId } });
      if (consumed.count !== 1) throw new PhysicalGateExitConflictError('The authorization was finalized by a competing command.');
      await tx.accountingDispatchWaybill.update({ where: { id: waybill.id }, data: { status: AccountingDispatchWaybillStatus.EXIT_RECORDED } });
      const closed = await tx.guardDriverQueueTurn.updateMany({ where: { id: turn.id, status: GuardDriverQueueTurnStatus.LOADING_FINALIZED }, data: { status: GuardDriverQueueTurnStatus.EXIT_RECORDED, exitedAt: at, exitedBy: actorId } });
      if (closed.count !== 1) throw new PhysicalGateExitConflictError('The queue turn changed during physical exit.');
      await appendQueueEvent(tx, { turnId: turn.id, eventType: 'PHYSICAL_EXIT_RECORDED', fromStatus: GuardDriverQueueTurnStatus.LOADING_FINALIZED,
        toStatus: GuardDriverQueueTurnStatus.EXIT_RECORDED, actorId, payload: { physicalExitId: exitId, authorizationId: authorization.id, waybillId: waybill.id } });
      const smsIntent = await tx.dispatchBuyerSmsIntent.create({ data: { physicalExitId: exitId, idempotencyKey: `BUYER_EXIT:${exitId}`,
        sessionId: authorization.sessionId,
        phoneNumber, dispatchNumber: waybill.number.toString(), vehiclePlate: plate,
        payload: json({ dispatchNumber: waybill.number.toString(), vehiclePlate: plate }), status: phoneNumber ? 'PENDING' : 'NEEDS_ATTENTION', availableAt: at } });
      if (!phoneNumber) await tx.dispatchConfirmationAlert.create({ data: { sessionId: authorization.sessionId,
        alertType: 'BUYER_EXIT_SMS_NEEDS_ATTENTION', payload: json({ physicalExitId: exitId, smsIntentId: smsIntent.id,
          dispatchNumber: waybill.number.toString(), status: 'NEEDS_ATTENTION', detail: 'No confirmed buyer notification phone was snapshotted.' }) } });
      await appendAudit(tx, { aggregateType: 'GUARD_PHYSICAL_EXIT', aggregateId: exitId, eventType: 'PHYSICAL_EXIT_RECORDED',
        payload: { workspace: 'security', effectiveAuthority: input.effectiveAuthority,
          authorizationId: authorization.id, authorizationIntegrityHash: authorization.integrityHash,
          waybillId: waybill.id, waybillIntegrityHash: waybill.integrityHash, queueTurnId: turn.id, queueTurnIntegrityHash: turn.integrityHash,
          allocationRevisionId: revision.id, allocationIntegrityHash: revision.integrityHash, sessionId: authorization.sessionId,
          before: { authorization: 'ACTIVE', waybill: 'ISSUED', queueTurn: 'LOADING_FINALIZED' },
          after: { authorization: 'CONSUMED', waybill: 'EXIT_RECORDED', queueTurn: 'EXIT_RECORDED' }, correlationId: exitId }, actorId, at });
      await appendAudit(tx, { aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: authorization.id, eventType: 'CONSUMED_AT_PHYSICAL_EXIT',
        payload: { workspace: 'security', effectiveAuthority: input.effectiveAuthority,
          beforeStatus: 'ACTIVE', afterStatus: 'CONSUMED', physicalExitId: exitId,
          waybillId: waybill.id, queueTurnId: turn.id, sessionId: authorization.sessionId,
          authorizationIntegrityHash: authorization.integrityHash, correlationId: exitId }, actorId, at });
      await refreshProjectionContracts(tx, revision.lines.map((line) => line.sourceContractId));
        return tx.guardPhysicalExit.findUniqueOrThrow({ where: { id: physicalExit.id }, include: { smsIntent: true } });
      });
      if ('expired' in result) throw new PhysicalGateExitConflictError('The exit authorization expired before physical exit.');
      return result;
    } catch (error) {
      if (error instanceof PhysicalGateExitConflictError) {
        const at = this.now();
        const current = await this.prisma.dispatchExitAuthorization.findUnique({ where: { id: authorizationId }, include: {
          waybill: { include: { candidate: { include: { allocationRevision: true } } } },
        } });
        if (current && current.status !== 'EXPIRED') await this.prisma.$transaction((tx) => appendAudit(tx, {
          aggregateType: 'DISPATCH_EXIT_AUTHORIZATION', aggregateId: current.id, eventType: 'PHYSICAL_EXIT_DENIED',
          payload: { workspace: 'security', effectiveAuthority: input.effectiveAuthority,
            reason: error.message, authorizationStatus: current.status, waybillId: current.waybillId,
            queueTurnId: current.waybill.candidate.allocationRevision.queueTurnId, sessionId: current.sessionId,
            authorizationIntegrityHash: current.integrityHash, correlationId: current.id, deviceContext: null }, actorId, at,
        }));
      }
      throw error;
    }
  }

  async deliverBuyerSms(intentId: string) {
    if (!this.dependencies.sendBuyerSms) throw new PhysicalGateExitValidationError('The buyer SMS gateway is not configured.');
    const at = this.now();
    const intent = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', `DISPATCH_BUYER_SMS:${intentId}`);
      const current = await tx.dispatchBuyerSmsIntent.findUnique({ where: { id: intentId } });
      if (!current || (current.status !== DispatchBuyerSmsStatus.PENDING && current.status !== DispatchBuyerSmsStatus.RETRY)
        || current.availableAt > at || !current.phoneNumber) {
        throw new PhysicalGateExitConflictError('The buyer SMS intent is not ready for delivery.');
      }
      return tx.dispatchBuyerSmsIntent.update({ where: { id: current.id }, data: { status: DispatchBuyerSmsStatus.SENDING, attemptCount: { increment: 1 }, lastAttemptAt: at } });
    });
    let result: SmsResult;
    try { result = await this.dependencies.sendBuyerSms({ phoneNumber: intent.phoneNumber!, dispatchNumber: intent.dispatchNumber,
      vehiclePlate: intent.vehiclePlate, idempotencyKey: intent.idempotencyKey }); }
    catch (error) { result = { outcome: 'FAILED', retryable: true, detail: error instanceof Error ? error.message : 'SMS gateway failure' }; }
    const completedAt = this.now();
    return this.prisma.$transaction(async (tx) => {
      const status = result.outcome === 'SENT' ? DispatchBuyerSmsStatus.SENT
        : result.outcome === 'UNKNOWN' ? DispatchBuyerSmsStatus.UNKNOWN
          : result.retryable ? DispatchBuyerSmsStatus.RETRY : DispatchBuyerSmsStatus.NEEDS_ATTENTION;
      const updated = await tx.dispatchBuyerSmsIntent.update({ where: { id: intent.id }, data: {
        status, sentAt: result.outcome === 'SENT' ? completedAt : undefined,
        providerMessageId: result.outcome === 'SENT' ? result.providerMessageId : undefined,
        unknownAt: result.outcome === 'UNKNOWN' ? completedAt : undefined,
        availableAt: result.outcome === 'FAILED' && result.retryable ? new Date(completedAt.getTime() + 60_000) : undefined,
        lastError: result.outcome === 'SENT' ? null : result.detail || 'Provider outcome is unknown',
      } });
      const detail = result.outcome === 'SENT' ? null : result.detail || 'Provider outcome is unknown';
      const sourceAggregateId = updated.physicalExitId || updated.manualOutageExitId || updated.id;
      await appendAudit(tx, { aggregateType: updated.physicalExitId ? 'GUARD_PHYSICAL_EXIT' : 'MANUAL_OUTAGE_EXIT', aggregateId: sourceAggregateId,
        eventType: `BUYER_SMS_${status}`, payload: { smsIntentId: updated.id, status, attemptCount: updated.attemptCount,
          providerMessageId: updated.providerMessageId, detail, correlationId: sourceAggregateId }, actorId: 'SYSTEM', at: completedAt });
      if (status === DispatchBuyerSmsStatus.UNKNOWN || status === DispatchBuyerSmsStatus.NEEDS_ATTENTION) {
        if (updated.sessionId) await tx.dispatchConfirmationAlert.create({ data: { sessionId: updated.sessionId,
          alertType: `BUYER_EXIT_SMS_${status}`, payload: json({ physicalExitId: updated.physicalExitId, smsIntentId: updated.id,
            dispatchNumber: updated.dispatchNumber, status, detail }) } });
        else await tx.dispatchEvidenceException.create({ data: { exceptionType: `BUYER_EXIT_SMS_${status}`,
          aggregateType: updated.manualOutageExitId ? 'MANUAL_OUTAGE_EXIT' : 'DISPATCH_BUYER_SMS',
          aggregateId: updated.manualOutageExitId || updated.id, createdBy: 'SYSTEM',
          detail: json({ smsIntentId: updated.id, dispatchNumber: updated.dispatchNumber, status, detail }) } });
      }
      return updated;
    });
  }
}
