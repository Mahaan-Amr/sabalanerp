import { createHash, randomUUID } from 'node:crypto';
import {
  AccountingDispatchCandidateStatus,
  AccountingDispatchWaybillStatus,
  Prisma,
  PrismaClient,
  type DispatchDocumentKind as PrismaDispatchDocumentKind,
} from '@prisma/client';
import type { DispatchDocumentCommandScope, DispatchDocumentKind, PublishedDispatchArtifact } from './contracts';
import type { DispatchDocumentRepository, DispatchSourceIntegrityVerifier } from './ports';
import { DispatchDocumentConflictError, DispatchDocumentValidationError } from './service';
import { DispatchDocumentEvidenceConflictError } from './service';
import { assertCanonicalDispatchCommandAllowed } from '../dispatchCutover';
import { isPostCutoverFinalization, isShipmentStatementFlowActive } from './featureGate';
import { refreshProjectionContracts } from '../dispatchAllocation';
import { shipmentQuantityEvidenceIntegrityHash } from '../shipmentQuantityProjectionStore';
import { createPrismaAllocationPricingBindingPort } from '../allocationPricingPrismaAdapter';

type Tx = Prisma.TransactionClient;
const json = (value: unknown) => value as Prisma.InputJsonValue;
const stable = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stable);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, stable(item)]));
  return typeof value === 'bigint' ? value.toString() : value;
};
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const resultJson = (value: unknown) => json(stable(value));
const record = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value)
  ? value as Record<string, any> : {};

const serializable = async <T>(prisma: PrismaClient, work: (tx: Tx) => Promise<T>) => {
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await prisma.$transaction(work, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
    catch (caught) {
      error = caught;
      if (!(caught instanceof Prisma.PrismaClientKnownRequestError) || caught.code !== 'P2034') throw caught;
    }
  }
  throw error;
};
const lock = async (tx: Tx, keys: string[]) => {
  for (const key of [...new Set(keys)].sort()) await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', key);
};
const artifactData = (artifact: PublishedDispatchArtifact, sourceIntegrityHash: string, actorId: string) => ({
  id: artifact.id,
  waybillId: artifact.waybillId,
  kind: artifact.kind as PrismaDispatchDocumentKind,
  templateVersion: artifact.templateVersion,
  storageKey: artifact.storageKey,
  mediaType: artifact.mediaType,
  byteLength: BigInt(artifact.byteLength),
  sha256: artifact.sha256,
  sourceIntegrityHash,
  publishedAt: new Date(artifact.publishedAt),
  publishedBy: actorId,
});
const publicArtifact = (artifact: any): PublishedDispatchArtifact => ({
  id: artifact.id, waybillId: artifact.waybillId, kind: artifact.kind,
  adjustmentSequence: artifact.statementAdjustment?.sequence ?? null,
  templateVersion: artifact.templateVersion, storageKey: artifact.storageKey,
  generatorVersion: String(record(record(artifact.waybill?.snapshot).documentProvenance).generatorVersion || '') || null,
  sourceVersionIdentities: record(record(artifact.waybill?.snapshot).documentProvenance).sourceVersionIdentities || {},
  mediaType: 'application/pdf', byteLength: Number(artifact.byteLength), sha256: artifact.sha256,
  publishedAt: artifact.publishedAt.toISOString(),
});
const commandResult = async (tx: Tx, scope: DispatchDocumentCommandScope, scopeId: string, idempotencyKey: string) => {
  const row = await tx.dispatchDocumentCommandResult.findUnique({ where: { scope_scopeId_idempotencyKey: { scope, scopeId, idempotencyKey } } });
  if (!row) return null;
  if (row.status === 'SUCCEEDED') return row.result;
  throw new DispatchDocumentConflictError('The idempotent dispatch command did not complete successfully.');
};
const appendAudit = async (tx: Tx, input: { aggregateType: string; aggregateId: string; eventType: string; payload: unknown; actorId: string; at: Date }) => {
  const previous = await tx.dispatchLifecycleAudit.findFirst({ where: { aggregateType: input.aggregateType, aggregateId: input.aggregateId }, orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }] });
  const payload = stable(input.payload);
  await tx.dispatchLifecycleAudit.create({ data: { aggregateType: input.aggregateType, aggregateId: input.aggregateId,
    eventType: input.eventType, payload: json(payload), actorId: input.actorId, recordedAt: input.at,
    previousHash: previous?.eventHash ?? null, eventHash: hash({ ...input, payload, previousHash: previous?.eventHash ?? null }) } });
};
const completeCandidateWithoutIssue = async (tx: Tx, input: { candidateId: string;
  status: 'STALE_REQUIRES_SUCCESSOR' | 'EVIDENCE_CONFLICT'; reason: string; eventType: string;
  eventPayload: Readonly<Record<string, unknown>>; idempotencyKey: string; actorId: string; correlationId: string }) => {
  const at = new Date();
  await tx.accountingDispatchCandidate.update({ where: { id: input.candidateId }, data: { status: input.status,
    dispositionAt: at, dispositionBy: input.actorId, dispositionReason: input.reason } });
  await tx.accountingDispatchWorkItem.update({ where: { candidateId: input.candidateId }, data: { status: 'COMPLETED', completedAt: at } });
  const result = { candidateId: input.candidateId, status: input.status, waybill: null };
  await tx.dispatchDocumentCommandResult.create({ data: { scope: 'CANDIDATE', scopeId: input.candidateId,
    idempotencyKey: input.idempotencyKey, command: 'ACCEPT_AND_ISSUE', status: 'SUCCEEDED', result: resultJson(result),
    actorId: input.actorId, correlationId: input.correlationId, completedAt: at } });
  await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_CANDIDATE', aggregateId: input.candidateId,
    eventType: input.eventType, payload: { ...input.eventPayload, correlationId: input.correlationId }, actorId: input.actorId, at });
  return result;
};

export class PrismaDispatchDocumentRepository implements DispatchDocumentRepository {
  constructor(private readonly prisma: PrismaClient, private readonly verifier: DispatchSourceIntegrityVerifier<Tx>) {}

  async findCommandResult(input: { scope: DispatchDocumentCommandScope; scopeId: string; idempotencyKey: string }) {
    const row = await this.prisma.dispatchDocumentCommandResult.findUnique({ where: { scope_scopeId_idempotencyKey: input } });
    return row?.status === 'SUCCEEDED' ? row.result : null;
  }
  async allocateWaybillNumber() {
    const rows = await this.prisma.$queryRawUnsafe<Array<{ number: bigint }>>(`SELECT nextval('accounting_dispatch_waybill_number_seq') AS number`);
    return rows[0].number.toString();
  }
  async acceptAndIssue(input: Parameters<DispatchDocumentRepository['acceptAndIssue']>[0]) {
    return serializable(this.prisma, async (tx) => {
      await lock(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${input.candidateId}`]);
      const prior = await commandResult(tx, 'CANDIDATE', input.candidateId, input.idempotencyKey);
      if (prior) return prior as any;
      const candidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: input.candidateId }, include: { workItem: true } });
      if (!candidate) throw new DispatchDocumentValidationError('Accounting dispatch candidate was not found.');
      if (candidate.status !== AccountingDispatchCandidateStatus.PENDING || candidate.allocationRevisionId !== input.allocationRevisionId) {
        throw new DispatchDocumentConflictError('Only the current pending candidate can be issued.');
      }
      await assertCanonicalDispatchCommandAllowed(tx);
      const [cutover, revision] = await Promise.all([
        tx.shipmentStatementCutover.findUnique({ where: { id: 'customer-shipment-statements' } }),
        tx.logisticsAllocationRevision.findUnique({ where: { id: input.allocationRevisionId }, select: { finalizedAt: true } }),
      ]);
      if (!revision || !isShipmentStatementFlowActive(process.env, cutover)
        || !cutover?.cutoverAt || !isPostCutoverFinalization(revision.finalizedAt, cutover.cutoverAt)) {
        throw new DispatchDocumentConflictError('This candidate belongs to the compatibility waybill-only path.');
      }
      const pricingContracts = await tx.logisticsAllocationRevisionPricing.findMany({
        where: { allocationRevisionId: input.allocationRevisionId }, select: { contractId: true }, orderBy: { contractId: 'asc' },
      });
      await createPrismaAllocationPricingBindingPort(tx).lockPricingScope(
        pricingContracts.map(reference => `APPROVED_PRICING_HEAD:${reference.contractId}`),
      );
      let freshness;
      try {
        freshness = await this.verifier.assess({ transaction: tx, allocationRevisionId: input.allocationRevisionId,
          expectedSourceIntegrityHash: input.expectedSourceIntegrityHash });
      } catch (error) {
        if (!(error instanceof DispatchDocumentEvidenceConflictError)) throw error;
        return completeCandidateWithoutIssue(tx, { candidateId: candidate.id, status: 'EVIDENCE_CONFLICT',
          reason: error.message, eventType: 'PRICING_EVIDENCE_CONFLICT',
          eventPayload: { allocationRevisionId: input.allocationRevisionId, reason: error.message },
          idempotencyKey: input.idempotencyKey, actorId: input.actorId, correlationId: input.correlationId });
      }
      if (freshness.status === 'STALE_REQUIRES_SUCCESSOR') {
        return completeCandidateWithoutIssue(tx, { candidateId: candidate.id, status: 'STALE_REQUIRES_SUCCESSOR',
          reason: 'APPROVED_PRICING_CHANGED', eventType: 'PRICING_STALE_REQUIRES_SUCCESSOR',
          eventPayload: { allocationRevisionId: input.allocationRevisionId, sourceIntegrityHash: input.expectedSourceIntegrityHash,
            staleContracts: freshness.staleContracts }, idempotencyKey: input.idempotencyKey,
          actorId: input.actorId, correlationId: input.correlationId });
      }
      const issuedAt = new Date(input.waybill.issuedAt);
      const waybill = await tx.accountingDispatchWaybill.create({ data: { id: input.waybill.id, number: BigInt(input.waybill.number),
        candidateId: input.candidateId, snapshot: json(input.waybillSnapshot), integrityHash: hash(input.waybillSnapshot),
        issuedAt, issuedBy: input.actorId, documentArtifacts: { create: input.artifacts.map(item => {
          const { waybillId: _waybillId, ...data } = artifactData(item, input.expectedSourceIntegrityHash, input.actorId); return data;
        }) } } });
      await tx.accountingDispatchCandidate.update({ where: { id: candidate.id }, data: { status: 'ACCEPTED', dispositionAt: issuedAt, dispositionBy: input.actorId } });
      await tx.accountingDispatchWorkItem.update({ where: { candidateId: candidate.id }, data: { status: 'COMPLETED', completedAt: issuedAt } });
      const result = { candidateId: candidate.id, status: 'ACCEPTED' as const,
        waybill: { id: waybill.id, number: waybill.number.toString(), status: 'ISSUED' as const, issuedAt: waybill.issuedAt.toISOString(), replacesWaybillId: null } };
      await tx.dispatchDocumentCommandResult.create({ data: { waybillId: waybill.id, scope: 'CANDIDATE', scopeId: candidate.id,
        idempotencyKey: input.idempotencyKey, command: 'ACCEPT_AND_ISSUE', status: 'SUCCEEDED', result: resultJson(result),
        actorId: input.actorId, correlationId: input.correlationId, completedAt: issuedAt } });
      await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id, eventType: 'PRIMARY_BUNDLE_ISSUED',
        payload: { candidateId: candidate.id, allocationRevisionId: input.allocationRevisionId, artifactIds: input.artifacts.map(item => item.id),
          sourceIntegrityHash: input.expectedSourceIntegrityHash, idempotencyKey: input.idempotencyKey, correlationId: input.correlationId }, actorId: input.actorId, at: issuedAt });
      return result;
    });
  }
  async recordEvidenceConflict(input: Parameters<DispatchDocumentRepository['recordEvidenceConflict']>[0]) {
    return serializable(this.prisma, async (tx) => {
      await lock(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${input.candidateId}`]);
      const prior = await commandResult(tx, 'CANDIDATE', input.candidateId, input.idempotencyKey);
      if (prior) return prior as any;
      const candidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: input.candidateId } });
      if (!candidate) throw new DispatchDocumentValidationError('Accounting dispatch candidate was not found.');
      if (candidate.status !== 'PENDING') throw new DispatchDocumentConflictError('Only a pending candidate can be quarantined for evidence conflict.');
      return completeCandidateWithoutIssue(tx, { candidateId: candidate.id, status: 'EVIDENCE_CONFLICT',
        reason: input.reason, eventType: 'PRICING_EVIDENCE_CONFLICT', eventPayload: { reason: input.reason },
        idempotencyKey: input.idempotencyKey, actorId: input.actorId, correlationId: input.correlationId });
    });
  }
  async rejectCandidate(input: Parameters<DispatchDocumentRepository['rejectCandidate']>[0]) {
    return serializable(this.prisma, async (tx) => {
      await lock(tx, [`ACCOUNTING_DISPATCH_CANDIDATE:${input.candidateId}`]);
      const prior = await commandResult(tx, 'CANDIDATE', input.candidateId, input.idempotencyKey);
      if (prior) return prior as any;
      const candidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: input.candidateId },
        include: { allocationRevision: { include: { lines: true } } } });
      if (!candidate) throw new DispatchDocumentValidationError('Accounting dispatch candidate was not found.');
      if (candidate.status !== 'PENDING') throw new DispatchDocumentConflictError('Only a pending candidate can be decided.');
      const at = new Date();
      const status = input.action === 'REJECT' ? 'REJECTED' as const : 'RETURNED' as const;
      await tx.accountingDispatchCandidate.update({ where: { id: candidate.id }, data: { status, dispositionAt: at, dispositionBy: input.actorId, dispositionReason: input.reason } });
      await tx.accountingDispatchWorkItem.update({ where: { candidateId: candidate.id }, data: { status: 'COMPLETED', completedAt: at } });
      for (const line of candidate.allocationRevision.lines) {
        const evidence = { id: `${candidate.id}:${line.id}`, contractId: line.sourceContractId,
          contractItemId: line.sourceContractItemId, productRowId: line.productRowId, unit: line.unit,
          kind: 'ALLOCATION_RELEASED' as const, quantity: line.quantity.toFixed(3), effectiveAt: at.toISOString(),
          recordedAt: at.toISOString(), sourceType: 'ACCOUNTING_CANDIDATE_DISPOSITION', sourceId: `${candidate.id}:${line.id}`,
          sourceVersion: 1, integrityHash: '', metadata: { revisionId: candidate.allocationRevisionId,
            candidateId: candidate.id, revisionLineId: line.id } };
        evidence.integrityHash = shipmentQuantityEvidenceIntegrityHash(evidence);
        await tx.shipmentQuantityEvidence.create({ data: { contractId: evidence.contractId, contractItemId: evidence.contractItemId,
          productRowId: evidence.productRowId, unit: evidence.unit, kind: evidence.kind, quantity: line.quantity,
          effectiveAt: at, recordedAt: at, sourceType: evidence.sourceType, sourceId: evidence.sourceId, sourceVersion: 1,
          integrityHash: evidence.integrityHash, metadata: json(evidence.metadata) } });
      }
      await refreshProjectionContracts(tx, candidate.allocationRevision.lines.map(line => line.sourceContractId));
      const result = { candidateId: candidate.id, status, waybill: null };
      await tx.dispatchDocumentCommandResult.create({ data: { scope: 'CANDIDATE', scopeId: candidate.id, idempotencyKey: input.idempotencyKey,
        command: 'REJECT', status: 'SUCCEEDED', result: resultJson(result), actorId: input.actorId, correlationId: input.correlationId, completedAt: at } });
      return result;
    });
  }
  async voidWaybill(input: Parameters<DispatchDocumentRepository['voidWaybill']>[0]) {
    return serializable(this.prisma, async (tx) => {
      await lock(tx, [`ACCOUNTING_DISPATCH_WAYBILL:${input.waybillId}`]);
      const prior = await commandResult(tx, 'WAYBILL', input.waybillId, input.idempotencyKey);
      if (prior) return prior;
      const waybill = await tx.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId }, include: { physicalExit: true, manualOutageExit: true } });
      if (!waybill) throw new DispatchDocumentValidationError('Dispatch waybill was not found.');
      if (waybill.status !== 'ISSUED' || waybill.physicalExit || waybill.manualOutageExit) throw new DispatchDocumentConflictError('Only an unexited issued waybill can be voided.');
      const at = new Date();
      await tx.dispatchExitAuthorization.updateMany({ where: { waybillId: waybill.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: at, revokedBy: input.actorId, revocationReason: input.reason } });
      await tx.accountingDispatchWaybill.update({ where: { id: waybill.id }, data: { status: AccountingDispatchWaybillStatus.VOIDED, voidedAt: at, voidedBy: input.actorId, voidReason: input.reason } });
      const result = { id: waybill.id, number: waybill.number.toString(), status: 'VOIDED' as const };
      await tx.dispatchDocumentCommandResult.create({ data: { waybillId: waybill.id, scope: 'WAYBILL', scopeId: waybill.id,
        idempotencyKey: input.idempotencyKey, command: 'VOID', status: 'SUCCEEDED', result: resultJson(result), actorId: input.actorId,
        correlationId: input.correlationId, completedAt: at } });
      await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: waybill.id, eventType: 'DOCUMENT_BUNDLE_VOIDED',
        payload: { reason: input.reason, authority: input.authority, correlationId: input.correlationId, idempotencyKey: input.idempotencyKey }, actorId: input.actorId, at });
      return result;
    });
  }
  async replaceWaybill(input: Parameters<DispatchDocumentRepository['replaceWaybill']>[0]) {
    return serializable(this.prisma, async (tx) => {
      await lock(tx, [`ACCOUNTING_DISPATCH_WAYBILL:${input.waybillId}`]);
      const prior = await commandResult(tx, 'WAYBILL', input.waybillId, input.idempotencyKey);
      if (prior) return prior;
      const predecessor = await tx.accountingDispatchWaybill.findUnique({ where: { id: input.waybillId }, include: { physicalExit: true, manualOutageExit: true, replacementWaybill: true } });
      if (!predecessor) throw new DispatchDocumentValidationError('Dispatch waybill was not found.');
      if (predecessor.status !== 'ISSUED' || predecessor.physicalExit || predecessor.manualOutageExit || predecessor.replacementWaybill) {
        throw new DispatchDocumentConflictError('Only an unexited current issued waybill can be replaced.');
      }
      await assertCanonicalDispatchCommandAllowed(tx);
      const candidate = await tx.accountingDispatchCandidate.findUnique({ where: { id: predecessor.candidateId },
        include: { allocationRevision: { select: { finalizedAt: true } } } });
      const cutover = await tx.shipmentStatementCutover.findUnique({ where: { id: 'customer-shipment-statements' } });
      if (!candidate || !isShipmentStatementFlowActive(process.env, cutover) || !cutover?.cutoverAt
        || !isPostCutoverFinalization(candidate.allocationRevision.finalizedAt, cutover.cutoverAt)) {
        throw new DispatchDocumentConflictError('This waybill belongs to the compatibility waybill-only path.');
      }
      const freshness = await this.verifier.assess({ transaction: tx, allocationRevisionId: input.allocationRevisionId, expectedSourceIntegrityHash: input.expectedSourceIntegrityHash });
      if (freshness.status !== 'CURRENT') throw new DispatchDocumentConflictError('Stale priced evidence requires a successor allocation, not document replacement.');
      const at = new Date(input.replacement.issuedAt);
      await tx.dispatchExitAuthorization.updateMany({ where: { waybillId: predecessor.id, status: 'ACTIVE' }, data: { status: 'REVOKED', revokedAt: at, revokedBy: input.actorId, revocationReason: input.reason } });
      await tx.accountingDispatchWaybill.update({ where: { id: predecessor.id }, data: { status: 'VOIDED', voidedAt: at, voidedBy: input.actorId, voidReason: input.reason } });
      const replacement = await tx.accountingDispatchWaybill.create({ data: { id: input.replacement.id, number: BigInt(input.replacement.number), candidateId: predecessor.candidateId,
        snapshot: json(input.waybillSnapshot), integrityHash: hash({ ...input.waybillSnapshot, replacementId: input.replacement.id }), issuedAt: at,
        issuedBy: input.actorId, replacesWaybillId: predecessor.id, documentArtifacts: { create: input.artifacts.map(item => {
          const { waybillId: _waybillId, ...data } = artifactData(item, input.expectedSourceIntegrityHash, input.actorId); return data;
        }) } } });
      const result = { voided: { id: predecessor.id, number: predecessor.number.toString(), status: 'VOIDED' as const },
        replacement: { id: replacement.id, number: replacement.number.toString(), status: 'ISSUED' as const, issuedAt: replacement.issuedAt.toISOString(), replacesWaybillId: predecessor.id } };
      await tx.dispatchDocumentCommandResult.create({ data: { waybillId: replacement.id, scope: 'WAYBILL', scopeId: predecessor.id,
        idempotencyKey: input.idempotencyKey, command: 'REPLACE', status: 'SUCCEEDED', result: resultJson(result), actorId: input.actorId,
        correlationId: input.correlationId, completedAt: at } });
      await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: predecessor.id, eventType: 'DOCUMENT_BUNDLE_REPLACED',
        payload: { replacementWaybillId: replacement.id, reason: input.reason, authority: input.authority,
          correlationId: input.correlationId, idempotencyKey: input.idempotencyKey }, actorId: input.actorId, at });
      return result;
    });
  }
  async getArtifact(input: { artifactId: string; waybillId: string }) {
    const artifact = await this.prisma.dispatchDocumentArtifact.findFirst({ where: { id: input.artifactId, waybillId: input.waybillId },
      include: { statementAdjustment: { select: { sequence: true } }, waybill: { select: { snapshot: true } } } });
    return artifact ? publicArtifact(artifact) : null;
  }
  async recordRetrieval(input: Parameters<DispatchDocumentRepository['recordRetrieval']>[0]) {
    await serializable(this.prisma, async (tx) => {
      const idempotencyKey = `retrieve:${input.correlationId}`;
      await lock(tx, [`DISPATCH_RETRIEVAL:${input.waybillId}:${idempotencyKey}`]);
      const prior = await tx.dispatchDocumentCommandResult.findUnique({ where: { scope_scopeId_idempotencyKey: {
        scope: 'WAYBILL', scopeId: input.waybillId, idempotencyKey } } });
      if (prior) return;
      const at = new Date();
      await tx.dispatchDocumentCommandResult.create({ data: { waybillId: input.waybillId, scope: 'WAYBILL', scopeId: input.waybillId,
        idempotencyKey, command: 'RETRIEVE', status: input.status, result: input.status === 'SUCCEEDED'
          ? resultJson({ artifactId: input.artifact.id, byteLength: input.artifact.byteLength, sha256: input.artifact.sha256 }) : undefined,
        failureCode: input.failureCode ?? null, actorId: input.actorId, correlationId: input.correlationId, completedAt: at } });
      await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: input.waybillId,
        eventType: input.status === 'SUCCEEDED' ? 'DOCUMENT_BYTES_HANDED_OFF' : 'DOCUMENT_BYTES_HANDOFF_FAILED',
        payload: { artifactId: input.artifact.id, artifactKind: input.artifact.kind, sha256: input.artifact.sha256,
          failureCode: input.failureCode ?? null, correlationId: input.correlationId }, actorId: input.actorId, at });
    });
  }
  async getPrintableArtifacts(input: { waybillId: string; kinds: DispatchDocumentKind[] }) {
    const artifacts = await this.prisma.dispatchDocumentArtifact.findMany({ where: { waybillId: input.waybillId, kind: { in: input.kinds as PrismaDispatchDocumentKind[] } },
      include: { statementAdjustment: { select: { sequence: true } }, waybill: { select: { snapshot: true } } },
      orderBy: [{ publishedAt: 'asc' }, { id: 'asc' }] });
    const order: Record<DispatchDocumentKind, number> = { WAYBILL: 0, STATEMENT: 1, STATEMENT_ADJUSTMENT: 2 };
    return artifacts.map(publicArtifact).sort((left, right) => order[left.kind] - order[right.kind] || (left.adjustmentSequence ?? 0) - (right.adjustmentSequence ?? 0));
  }
  async recordPrintHandoff(input: Parameters<DispatchDocumentRepository['recordPrintHandoff']>[0]) {
    await serializable(this.prisma, async (tx) => {
      await lock(tx, [`DISPATCH_PRINT_HANDOFF_ATTEMPT:${input.attemptId}`]);
      if (await tx.dispatchDocumentPrintHandoff.findUnique({ where: { idempotencyKey: input.attemptId } })) return;
      const completedAt = new Date();
      const handoff = await tx.dispatchDocumentPrintHandoff.create({ data: { id: randomUUID(), waybillId: input.waybillId,
        idempotencyKey: input.attemptId, status: input.status, requestedKinds: input.kinds as PrismaDispatchDocumentKind[],
        requestedBy: input.actorId, completedAt, failureCode: input.failureCode ?? null,
        failureDetail: input.failureCode ? { correlationId: input.correlationId } : undefined, correlationId: input.correlationId,
        items: input.status === 'SUCCEEDED' ? { create: input.artifacts.map((artifact, ordinal) => ({ id: randomUUID(), artifactId: artifact.id,
          ordinal: ordinal + 1, byteLength: BigInt(artifact.byteLength), sha256: artifact.sha256 })) } : undefined } });
      if (input.status === 'SUCCEEDED') {
        const priorSuccess = await tx.dispatchDocumentCommandResult.findUnique({ where: { scope_scopeId_idempotencyKey: {
          scope: 'PRINT_HANDOFF', scopeId: input.waybillId, idempotencyKey: input.operationIdempotencyKey } } });
        if (!priorSuccess) await tx.dispatchDocumentCommandResult.create({ data: { waybillId: input.waybillId,
          scope: 'PRINT_HANDOFF', scopeId: input.waybillId, idempotencyKey: input.operationIdempotencyKey,
          command: 'PRINT_HANDOFF', status: 'SUCCEEDED', result: resultJson({ handoffId: handoff.id, kinds: input.kinds,
            artifactIds: input.artifacts.map(item => item.id) }), actorId: input.actorId,
          correlationId: input.correlationId, completedAt } });
      }
      await appendAudit(tx, { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: input.waybillId,
        eventType: input.status === 'SUCCEEDED' ? 'PRINT_BYTES_HANDED_OFF' : 'PRINT_BYTES_HANDOFF_FAILED',
        payload: { handoffId: handoff.id, attemptId: input.attemptId, operationIdempotencyKey: input.operationIdempotencyKey,
          artifactIds: input.artifacts.map(item => item.id), failureCode: input.failureCode ?? null,
          correlationId: input.correlationId }, actorId: input.actorId, at: completedAt });
    });
  }
  async getCombinedReadModel(input: { candidateId: string; authorizedWaybillId: string }) {
    const candidate = await this.prisma.accountingDispatchCandidate.findFirst({ where: { id: input.candidateId,
      waybills: { some: { id: input.authorizedWaybillId } } }, include: {
      workItem: true, allocationRevision: { include: { lines: true, pricingReferences: { include: { pricingVersion: true } }, pricedAllocationEvents: true } },
      waybills: { include: { documentArtifacts: { include: { statementAdjustment: { select: { sequence: true } } } }, printHandoffs: { include: { items: true } }, statementAdjustments: true }, orderBy: { issuedAt: 'asc' } },
    } });
    return candidate ? stable(candidate) : null;
  }
}
