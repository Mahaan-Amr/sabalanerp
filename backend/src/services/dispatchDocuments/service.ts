import { createHash, randomUUID } from 'node:crypto';
import type { DispatchArtifactPublisher, DispatchDocumentKind, PublishedDispatchArtifact } from './contracts';
import type {
  CandidateDecisionResult,
  DispatchArtifactStorage,
  DispatchDocumentAccessPolicy,
  DispatchDocumentRepository,
  DispatchDocumentSourceReader,
  IssuedWaybill,
  PrimaryBundleIdentity,
  PrimaryBundleSource,
} from './ports';

export class DispatchDocumentValidationError extends Error {}
export class DispatchDocumentConflictError extends Error {}
export class DispatchDocumentIntegrityError extends Error {}
export class DispatchDocumentNotAvailableError extends Error {
  constructor() { super('Dispatch document is not available.'); }
}

type Dependencies = {
  repository: DispatchDocumentRepository;
  storage: DispatchArtifactStorage;
  sourceReader: DispatchDocumentSourceReader;
  publisher: DispatchArtifactPublisher;
  access: DispatchDocumentAccessPolicy;
  id?: () => string;
  now?: () => Date;
};

const required = (value: unknown, name: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DispatchDocumentValidationError(`${name} is required.`);
  return normalized;
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const ensureOpaqueStorageKey = (value: string) => {
  if (!/^dispatch-documents\/[A-Za-z0-9_-]+\.pdf$/.test(value)) {
    throw new DispatchDocumentValidationError('Artifact storage key must be opaque and relative.');
  }
};
const orderedKinds = (kinds: DispatchDocumentKind[]) => [...new Set(kinds)].sort((left, right) => {
  const order: Record<DispatchDocumentKind, number> = { WAYBILL: 0, STATEMENT: 1, STATEMENT_ADJUSTMENT: 2 };
  return order[left] - order[right];
});
const assertRenderSourceConsistency = (source: PrimaryBundleSource) => {
  const priced = source.pricedAllocation;
  const statement = source.statement.payload;
  if (priced.currency !== statement.currency
    || priced.totals.grossAmount !== statement.grossAmount
    || priced.totals.discountAmount !== statement.allocatedDiscount
    || priced.totals.netAmount !== statement.netAmount) {
    throw new DispatchDocumentConflictError('Statement totals do not match the bound priced-allocation ledger.');
  }
  const pricedLines = [...priced.lines].sort((left, right) => `${left.contractId}:${left.contractItemId}:${left.productRowId}`.localeCompare(`${right.contractId}:${right.contractItemId}:${right.productRowId}`));
  const statementLines = statement.contracts.flatMap(group => group.lines.map(line => ({ contractId: group.contractId, ...line })))
    .sort((left, right) => `${left.contractId}:${left.contractItemId}:${left.productRowId}`.localeCompare(`${right.contractId}:${right.contractItemId}:${right.productRowId}`));
  const waybillLines = source.waybill.payload.contracts.flatMap(group => group.lines.map(line => ({ contractId: group.contractId, ...line })))
    .sort((left, right) => `${left.contractId}:${left.contractItemId}:${left.productRowId}`.localeCompare(`${right.contractId}:${right.contractItemId}:${right.productRowId}`));
  const normalizePriced = pricedLines.map(line => ({ contractId: line.contractId, contractItemId: line.contractItemId,
    productRowId: line.productRowId, unit: line.unit, quantity: line.quantity, grossAmount: line.grossAmount,
    allocatedDiscount: line.discountAmount, netAmount: line.netAmount }));
  const normalizeStatement = statementLines.map(line => ({ contractId: line.contractId, contractItemId: line.contractItemId,
    productRowId: line.productRowId, unit: line.unit, quantity: line.quantity, grossAmount: line.grossAmount,
    allocatedDiscount: line.allocatedDiscount, netAmount: line.netAmount }));
  const normalizeWaybill = waybillLines.map(line => ({ contractId: line.contractId, contractItemId: line.contractItemId,
    productRowId: line.productRowId, unit: line.unit, quantity: line.quantity }));
  const pricedQuantities = normalizePriced.map(({ grossAmount: _gross, allocatedDiscount: _discount, netAmount: _net, ...line }) => line);
  if (JSON.stringify(normalizePriced) !== JSON.stringify(normalizeStatement)
    || JSON.stringify(pricedQuantities) !== JSON.stringify(normalizeWaybill)) {
    throw new DispatchDocumentConflictError('Rendered bundle rows do not match the bound priced-allocation ledger.');
  }
};

export const createDispatchDocuments = (dependencies: Dependencies) => {
  const id = dependencies.id ?? randomUUID;
  const now = dependencies.now ?? (() => new Date());

  const identity = async (): Promise<PrimaryBundleIdentity> => ({
    waybillId: id(),
    waybillDocumentId: id(),
    statementDocumentId: id(),
    number: await dependencies.repository.allocateWaybillNumber(),
    issuedAt: now().toISOString(),
  });

  const publish = async (source: PrimaryBundleSource, root: PrimaryBundleIdentity, actorId: string) => {
    if (source.waybill.kind !== 'WAYBILL' || source.statement.kind !== 'STATEMENT'
      || source.waybill.waybillNumber !== root.number || source.statement.waybillNumber !== root.number) {
      throw new DispatchDocumentConflictError('Dispatch document source does not match the reserved waybill identity.');
    }
    assertRenderSourceConsistency(source);
    const rendered = await Promise.all([
      dependencies.publisher.publish(source.waybill),
      dependencies.publisher.publish(source.statement),
    ]);
    const inputs = [source.waybill, source.statement] as const;
    const artifacts: PublishedDispatchArtifact[] = [];
    for (let index = 0; index < inputs.length; index += 1) {
      const output = rendered[index];
      if (output.mediaType !== 'application/pdf' || output.bytes.byteLength === 0) {
        throw new DispatchDocumentIntegrityError('Renderer did not produce a non-empty PDF artifact.');
      }
      const artifactId = id();
      const storageKey = `dispatch-documents/${id()}.pdf`;
      ensureOpaqueStorageKey(storageKey);
      await dependencies.storage.stage({ storageKey, bytes: output.bytes });
      const verified = await dependencies.storage.read(storageKey);
      if (!verified || verified.byteLength !== output.bytes.byteLength || digest(verified) !== digest(output.bytes)) {
        throw new DispatchDocumentIntegrityError('Staged dispatch artifact failed verification.');
      }
      artifacts.push({
        id: artifactId,
        waybillId: root.waybillId,
        kind: inputs[index].kind,
        adjustmentSequence: null,
        templateVersion: inputs[index].templateVersion,
        storageKey,
        mediaType: 'application/pdf',
        byteLength: verified.byteLength,
        sha256: digest(verified),
        publishedAt: root.issuedAt,
      });
    }
    if (artifacts.length !== 2) throw new DispatchDocumentIntegrityError('Primary dispatch bundle is incomplete.');
    void actorId;
    return artifacts;
  };

  const decideCandidate = async (input: {
    candidateId: string;
    action: 'ACCEPT' | 'REJECT' | 'RETURN';
    reason?: string;
    idempotencyKey: string;
    actorId: string;
    correlationId?: string;
  }): Promise<CandidateDecisionResult> => {
    const candidateId = required(input.candidateId, 'candidateId');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const actorId = required(input.actorId, 'actorId');
    const prior = await dependencies.repository.findCommandResult({ scope: 'CANDIDATE', scopeId: candidateId, idempotencyKey });
    if (prior) return prior as CandidateDecisionResult;
    const correlationId = input.correlationId?.trim() || id();
    if (input.action !== 'ACCEPT') {
      if (!['REJECT', 'RETURN'].includes(input.action)) throw new DispatchDocumentValidationError('Unsupported candidate action.');
      return dependencies.repository.rejectCandidate({ candidateId, action: input.action as 'REJECT' | 'RETURN',
        reason: required(input.reason, 'reason'), idempotencyKey, actorId, correlationId });
    }
    const root = await identity();
    const source = await dependencies.sourceReader.readPrimaryBundle({ candidateId, waybill: root });
    if (source.candidateId !== candidateId) throw new DispatchDocumentConflictError('Dispatch source candidate changed.');
    const artifacts = await publish(source, root, actorId);
    const waybill: IssuedWaybill = { id: root.waybillId, number: root.number, status: 'ISSUED', issuedAt: root.issuedAt, replacesWaybillId: null };
    return dependencies.repository.acceptAndIssue({ candidateId, allocationRevisionId: source.allocationRevisionId,
      expectedSourceIntegrityHash: source.sourceIntegrityHash, waybillSnapshot: source.waybillSnapshot,
      waybill, artifacts, idempotencyKey, actorId, correlationId });
  };

  const voidWaybill = async (input: { waybillId: string; reason: string; idempotencyKey: string; actorId: string; correlationId?: string; authority?: unknown }) => {
    const waybillId = required(input.waybillId, 'waybillId');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const prior = await dependencies.repository.findCommandResult({ scope: 'WAYBILL', scopeId: waybillId, idempotencyKey });
    if (prior) return prior;
    return dependencies.repository.voidWaybill({ waybillId, reason: required(input.reason, 'reason'), idempotencyKey,
      actorId: required(input.actorId, 'actorId'), correlationId: input.correlationId?.trim() || id(), authority: input.authority ?? {} });
  };

  const replaceWaybill = async (input: { waybillId: string; reason: string; idempotencyKey: string; actorId: string; correlationId?: string; authority?: unknown }) => {
    const waybillId = required(input.waybillId, 'waybillId');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const prior = await dependencies.repository.findCommandResult({ scope: 'WAYBILL', scopeId: waybillId, idempotencyKey });
    if (prior) return prior;
    const root = await identity();
    const source = await dependencies.sourceReader.readReplacementBundle({ waybillId, replacement: root });
    if (source.predecessorWaybillId !== waybillId) throw new DispatchDocumentConflictError('Replacement source changed.');
    const artifacts = await publish(source, root, input.actorId);
    const replacement: IssuedWaybill = { id: root.waybillId, number: root.number, status: 'ISSUED', issuedAt: root.issuedAt, replacesWaybillId: waybillId };
    return dependencies.repository.replaceWaybill({ waybillId, allocationRevisionId: source.allocationRevisionId,
      expectedSourceIntegrityHash: source.sourceIntegrityHash, waybillSnapshot: source.waybillSnapshot,
      replacement, artifacts, reason: required(input.reason, 'reason'), idempotencyKey,
      actorId: required(input.actorId, 'actorId'), correlationId: input.correlationId?.trim() || id(), authority: input.authority ?? {} });
  };

  const assertAccess = async (actorId: string, waybillId: string) => {
    if (!await dependencies.access.canReadWaybill({ actorId, waybillId })) throw new DispatchDocumentNotAvailableError();
  };
  const verifiedBytes = async (artifact: PublishedDispatchArtifact) => {
    ensureOpaqueStorageKey(artifact.storageKey);
    const bytes = await dependencies.storage.read(artifact.storageKey);
    if (!bytes || bytes.byteLength !== artifact.byteLength || digest(bytes) !== artifact.sha256) {
      throw new DispatchDocumentIntegrityError('Dispatch artifact integrity verification failed.');
    }
    return bytes;
  };

  const retrieveArtifact = async (input: { artifactId: string; waybillId: string; actorId: string; correlationId: string }) => {
    await assertAccess(required(input.actorId, 'actorId'), required(input.waybillId, 'waybillId'));
    const artifact = await dependencies.repository.getArtifact({ artifactId: required(input.artifactId, 'artifactId'), waybillId: input.waybillId });
    if (!artifact) throw new DispatchDocumentNotAvailableError();
    try {
      const bytes = await verifiedBytes(artifact);
      await dependencies.repository.recordRetrieval({ waybillId: input.waybillId, artifact, actorId: input.actorId,
        correlationId: required(input.correlationId, 'correlationId'), status: 'SUCCEEDED' });
      return { artifact, bytes };
    } catch (error) {
      await dependencies.repository.recordRetrieval({ waybillId: input.waybillId, artifact, actorId: input.actorId,
        correlationId: required(input.correlationId, 'correlationId'), status: 'FAILED', failureCode: 'ARTIFACT_INTEGRITY_FAILURE' });
      throw error;
    }
  };

  const printHandoff = async (input: { waybillId: string; kinds: DispatchDocumentKind[]; idempotencyKey: string; actorId: string; correlationId: string }) => {
    await assertAccess(required(input.actorId, 'actorId'), required(input.waybillId, 'waybillId'));
    const kinds = orderedKinds(input.kinds);
    if (!kinds.length) throw new DispatchDocumentValidationError('At least one document kind is required.');
    const prior = await dependencies.repository.findCommandResult({ scope: 'PRINT_HANDOFF', scopeId: input.waybillId,
      idempotencyKey: required(input.idempotencyKey, 'idempotencyKey') }) as { kinds?: DispatchDocumentKind[] } | null;
    if (prior && JSON.stringify(prior.kinds) !== JSON.stringify(kinds)) {
      throw new DispatchDocumentConflictError('The print idempotency key was already used for another document set.');
    }
    const artifacts = await dependencies.repository.getPrintableArtifacts({ waybillId: input.waybillId, kinds });
    try {
      if (artifacts.length !== kinds.length || artifacts.some((artifact, index) => artifact.kind !== kinds[index])) {
        throw new DispatchDocumentIntegrityError('Requested dispatch bundle is incomplete.');
      }
      const documents: Array<{ artifact: PublishedDispatchArtifact; bytes: Uint8Array }> = [];
      for (const artifact of artifacts) documents.push({ artifact, bytes: await verifiedBytes(artifact) });
      if (!prior) await dependencies.repository.recordPrintHandoff({ ...input, kinds, status: 'SUCCEEDED', artifacts });
      return { documents };
    } catch (error) {
      await dependencies.repository.recordPrintHandoff({ ...input, kinds, status: 'FAILED', artifacts, failureCode: 'ARTIFACT_INTEGRITY_FAILURE' });
      throw error;
    }
  };

  const getCombinedReadModel = async (input: { candidateId: string; waybillId: string; actorId: string }) => {
    await assertAccess(required(input.actorId, 'actorId'), required(input.waybillId, 'waybillId'));
    const model = await dependencies.repository.getCombinedReadModel({ candidateId: required(input.candidateId, 'candidateId') });
    if (!model) throw new DispatchDocumentNotAvailableError();
    return model;
  };

  return { decideCandidate, voidWaybill, replaceWaybill, retrieveArtifact, printHandoff, getCombinedReadModel };
};
