import { createHash, randomUUID } from 'node:crypto';
import type { DispatchArtifactPublisher, DispatchDocumentKind, PublishedDispatchArtifact } from './contracts';
import type {
  CandidateDecisionResult,
  DispatchArtifactStorage,
  DispatchDocumentAccessPolicy,
  DispatchDocumentRepository,
  DispatchDocumentSourceReader,
  DispatchIntegrityIncidentReporter,
  IssuedWaybill,
  PrimaryBundleIdentity,
  PrimaryBundleSource,
} from './ports';
import { prepareDispatchArtifact } from './artifactPreparation';

export class DispatchDocumentValidationError extends Error {}
export class DispatchDocumentConflictError extends Error {}
export class DispatchDocumentEvidenceConflictError extends DispatchDocumentConflictError {}
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
  incidents: DispatchIntegrityIncidentReporter;
  id?: () => string;
  now?: () => Date;
};

const required = (value: unknown, name: string) => {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new DispatchDocumentValidationError(`${name} is required.`);
  return normalized;
};
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonical(item)])) : value;
const intentFingerprint = (value: unknown) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
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
    const prepared = await Promise.all([source.waybill, source.statement].map(renderInput => prepareDispatchArtifact({
      publisher: dependencies.publisher, storage: dependencies.storage, id, now: () => new Date(root.issuedAt),
    }, renderInput)));
    const artifacts: PublishedDispatchArtifact[] = prepared.map(artifact => ({ ...artifact, waybillId: root.waybillId,
      adjustmentSequence: null, generatorVersion: source.provenance.generatorVersion,
      sourceVersionIdentities: source.provenance.sourceVersionIdentities }));
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
    authority?: unknown;
  }): Promise<CandidateDecisionResult> => {
    const candidateId = required(input.candidateId, 'candidateId');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const actorId = required(input.actorId, 'actorId');
    const command = input.action === 'ACCEPT' ? 'ACCEPT_AND_ISSUE' as const : 'REJECT' as const;
    const fingerprint = intentFingerprint({ command, candidateId, action: input.action, reason: input.reason?.trim() || null });
    const prior = await dependencies.repository.findCommandResult({ scope: 'CANDIDATE', scopeId: candidateId, idempotencyKey,
      command, intentFingerprint: fingerprint });
    if (prior) return prior as CandidateDecisionResult;
    const correlationId = input.correlationId?.trim() || id();
    if (input.action !== 'ACCEPT') {
      if (!['REJECT', 'RETURN'].includes(input.action)) throw new DispatchDocumentValidationError('Unsupported candidate action.');
      return dependencies.repository.rejectCandidate({ candidateId, action: input.action as 'REJECT' | 'RETURN',
        reason: required(input.reason, 'reason'), idempotencyKey, actorId, correlationId, intentFingerprint: fingerprint });
    }
    const root = await identity();
    let source;
    try {
      source = await dependencies.sourceReader.readPrimaryBundle({ candidateId, waybill: root });
    } catch (error) {
      if (!(error instanceof DispatchDocumentEvidenceConflictError)) throw error;
      return dependencies.repository.recordEvidenceConflict({ candidateId, reason: error.message, idempotencyKey,
        actorId, correlationId, intentFingerprint: fingerprint });
    }
    if (source.candidateId !== candidateId) throw new DispatchDocumentConflictError('Dispatch source candidate changed.');
    const artifacts = await publish(source, root, actorId);
    const waybill: IssuedWaybill = { id: root.waybillId, number: root.number, status: 'ISSUED', issuedAt: root.issuedAt, replacesWaybillId: null };
    return dependencies.repository.acceptAndIssue({ candidateId, allocationRevisionId: source.allocationRevisionId,
      expectedSourceIntegrityHash: source.sourceIntegrityHash, waybillSnapshot: source.waybillSnapshot,
      waybill, artifacts, idempotencyKey, actorId, correlationId, authority: input.authority, intentFingerprint: fingerprint });
  };

  const voidWaybill = async (input: { waybillId: string; reason: string; idempotencyKey: string; actorId: string; correlationId?: string; authority?: unknown }) => {
    const waybillId = required(input.waybillId, 'waybillId');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const fingerprint = intentFingerprint({ command: 'VOID', waybillId, reason: input.reason?.trim() || null, authority: input.authority ?? {} });
    const prior = await dependencies.repository.findCommandResult({ scope: 'WAYBILL', scopeId: waybillId, idempotencyKey,
      command: 'VOID', intentFingerprint: fingerprint });
    if (prior) return prior;
    return dependencies.repository.voidWaybill({ waybillId, reason: required(input.reason, 'reason'), idempotencyKey,
      actorId: required(input.actorId, 'actorId'), correlationId: input.correlationId?.trim() || id(), authority: input.authority ?? {},
      intentFingerprint: fingerprint });
  };

  const replaceWaybill = async (input: { waybillId: string; reason: string; idempotencyKey: string; actorId: string; correlationId?: string; authority?: unknown }) => {
    const waybillId = required(input.waybillId, 'waybillId');
    const idempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const fingerprint = intentFingerprint({ command: 'REPLACE', waybillId, reason: input.reason?.trim() || null, authority: input.authority ?? {} });
    const prior = await dependencies.repository.findCommandResult({ scope: 'WAYBILL', scopeId: waybillId, idempotencyKey,
      command: 'REPLACE', intentFingerprint: fingerprint });
    if (prior) return prior;
    const root = await identity();
    const source = await dependencies.sourceReader.readReplacementBundle({ waybillId, replacement: root });
    if (source.predecessorWaybillId !== waybillId) throw new DispatchDocumentConflictError('Replacement source changed.');
    const artifacts = await publish(source, root, input.actorId);
    const replacement: IssuedWaybill = { id: root.waybillId, number: root.number, status: 'ISSUED', issuedAt: root.issuedAt, replacesWaybillId: waybillId };
    return dependencies.repository.replaceWaybill({ waybillId, allocationRevisionId: source.allocationRevisionId,
      expectedSourceIntegrityHash: source.sourceIntegrityHash, waybillSnapshot: source.waybillSnapshot,
      replacement, artifacts, reason: required(input.reason, 'reason'), idempotencyKey,
      actorId: required(input.actorId, 'actorId'), correlationId: input.correlationId?.trim() || id(), authority: input.authority ?? {},
      intentFingerprint: fingerprint });
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
    const retrievalFingerprint = intentFingerprint({ command: 'RETRIEVE', waybillId: input.waybillId, artifactId: input.artifactId });
    const attemptId = id();
    const artifact = await dependencies.repository.getArtifact({ artifactId: required(input.artifactId, 'artifactId'), waybillId: input.waybillId });
    if (!artifact) {
      await dependencies.repository.recordRetrieval({ waybillId: input.waybillId, artifact: null,
        requestedArtifactId: input.artifactId, attemptId,
        actorId: input.actorId, correlationId: input.correlationId, status: 'FAILED', failureCode: 'ARTIFACT_NOT_AVAILABLE',
        intentFingerprint: retrievalFingerprint });
      throw new DispatchDocumentNotAvailableError();
    }
    try {
      const bytes = await verifiedBytes(artifact);
      let completion: 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'PENDING';
      return { artifact, bytes, complete: {
        succeeded: async () => { if (completion !== 'PENDING') return; completion = 'SUCCEEDED';
          await dependencies.repository.recordRetrieval({ waybillId: input.waybillId, artifact,
            requestedArtifactId: artifact.id, attemptId, actorId: input.actorId,
            correlationId: input.correlationId, status: 'SUCCEEDED', intentFingerprint: retrievalFingerprint }); },
        failed: async (failureCode = 'BYTE_HANDOFF_FAILED') => { if (completion !== 'PENDING') return; completion = 'FAILED';
          await dependencies.repository.recordRetrieval({ waybillId: input.waybillId, artifact,
            requestedArtifactId: artifact.id, attemptId, actorId: input.actorId,
            correlationId: input.correlationId, status: 'FAILED', failureCode, intentFingerprint: retrievalFingerprint }); },
      } };
    } catch (error) {
      await dependencies.repository.recordRetrieval({ waybillId: input.waybillId, artifact, requestedArtifactId: artifact.id,
        attemptId, actorId: input.actorId, correlationId: required(input.correlationId, 'correlationId'),
        status: 'FAILED', failureCode: 'ARTIFACT_INTEGRITY_FAILURE', intentFingerprint: retrievalFingerprint });
      await dependencies.incidents.report({ waybillId: input.waybillId, artifactId: artifact.id, actorId: input.actorId,
        correlationId: input.correlationId, failureCode: 'ARTIFACT_INTEGRITY_FAILURE',
        evidence: { expectedSha256: artifact.sha256, expectedByteLength: artifact.byteLength, storageKey: artifact.storageKey } });
      throw error;
    }
  };

  const printHandoff = async (input: { waybillId: string; kinds: DispatchDocumentKind[]; idempotencyKey: string; actorId: string; correlationId: string }) => {
    await assertAccess(required(input.actorId, 'actorId'), required(input.waybillId, 'waybillId'));
    const kinds = orderedKinds(input.kinds);
    if (!kinds.length) throw new DispatchDocumentValidationError('At least one document kind is required.');
    const operationIdempotencyKey = required(input.idempotencyKey, 'idempotencyKey');
    const attemptId = required(input.correlationId, 'correlationId');
    const fingerprint = intentFingerprint({ command: 'PRINT_HANDOFF', waybillId: input.waybillId, kinds });
    const prior = await dependencies.repository.findCommandResult({ scope: 'PRINT_HANDOFF', scopeId: input.waybillId,
      idempotencyKey: operationIdempotencyKey, command: 'PRINT_HANDOFF', intentFingerprint: fingerprint }) as { kinds?: DispatchDocumentKind[] } | null;
    if (prior?.kinds && JSON.stringify(orderedKinds(prior.kinds)) !== JSON.stringify(kinds)) {
      throw new DispatchDocumentConflictError('The print idempotency key was already used for another document set.');
    }
    const artifacts = await dependencies.repository.getPrintableArtifacts({ waybillId: input.waybillId, kinds });
    const availableKinds = new Set(artifacts.map(artifact => artifact.kind));
    if (kinds.some(kind => !availableKinds.has(kind)) || artifacts.some(artifact => !kinds.includes(artifact.kind))) {
      await dependencies.repository.recordPrintHandoff({ waybillId: input.waybillId, operationIdempotencyKey,
        attemptId, correlationId: input.correlationId, actorId: input.actorId, kinds, status: 'FAILED', artifacts,
        failureCode: 'ARTIFACT_METADATA_MISSING', intentFingerprint: fingerprint });
      if (await dependencies.repository.isRequiredArtifactMetadataMissing({ waybillId: input.waybillId, kinds })) {
        await dependencies.incidents.report({ waybillId: input.waybillId, artifactId: null, actorId: input.actorId,
          correlationId: input.correlationId, failureCode: 'ARTIFACT_METADATA_MISSING',
          evidence: { requestedKinds: kinds, availableKinds: [...availableKinds] } });
      }
      throw new DispatchDocumentIntegrityError('Requested dispatch bundle is incomplete.');
    }
    try {
      const documents: Array<{ artifact: PublishedDispatchArtifact; bytes: Uint8Array }> = [];
      for (const artifact of artifacts) documents.push({ artifact, bytes: await verifiedBytes(artifact) });
      let completion: 'PENDING' | 'SUCCEEDED' | 'FAILED' = 'PENDING';
      return { documents, complete: {
        succeeded: async () => {
          if (completion !== 'PENDING') return;
          completion = 'SUCCEEDED';
          await dependencies.repository.recordPrintHandoff({ waybillId: input.waybillId, operationIdempotencyKey,
            attemptId, correlationId: input.correlationId, actorId: input.actorId, kinds, status: 'SUCCEEDED', artifacts,
            intentFingerprint: fingerprint });
        },
        failed: async (failureCode = 'BYTE_HANDOFF_FAILED') => {
          if (completion !== 'PENDING') return;
          completion = 'FAILED';
          await dependencies.repository.recordPrintHandoff({ waybillId: input.waybillId, operationIdempotencyKey,
            attemptId, correlationId: input.correlationId, actorId: input.actorId, kinds, status: 'FAILED', artifacts, failureCode,
            intentFingerprint: fingerprint });
        },
      } };
    } catch (error) {
      await dependencies.repository.recordPrintHandoff({ waybillId: input.waybillId, operationIdempotencyKey,
        attemptId, correlationId: input.correlationId, actorId: input.actorId, kinds, status: 'FAILED', artifacts,
        failureCode: 'ARTIFACT_INTEGRITY_FAILURE', intentFingerprint: fingerprint });
      for (const artifact of artifacts) await dependencies.incidents.report({ waybillId: input.waybillId,
        artifactId: artifact.id, actorId: input.actorId, correlationId: input.correlationId,
        failureCode: 'ARTIFACT_INTEGRITY_FAILURE', evidence: { expectedSha256: artifact.sha256,
          expectedByteLength: artifact.byteLength, storageKey: artifact.storageKey } });
      throw error;
    }
  };

  const getCombinedReadModel = async (input: { candidateId: string; waybillId?: string; actorId: string }) => {
    const actorId = required(input.actorId, 'actorId');
    const waybillId = input.waybillId?.trim() || undefined;
    if (waybillId) await assertAccess(actorId, waybillId);
    else if (!await dependencies.access.canReadCandidate({ actorId })) throw new DispatchDocumentNotAvailableError();
    const model = await dependencies.repository.getCombinedReadModel({ candidateId: required(input.candidateId, 'candidateId'),
      authorizedWaybillId: waybillId });
    if (!model) throw new DispatchDocumentNotAvailableError();
    return model;
  };

  return { decideCandidate, voidWaybill, replaceWaybill, retrieveArtifact, printHandoff, getCombinedReadModel };
};
