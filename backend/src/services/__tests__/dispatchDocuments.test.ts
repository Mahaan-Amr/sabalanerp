import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import {
  DispatchDocumentConflictError,
  DispatchDocumentEvidenceConflictError,
  DispatchDocumentIntegrityError,
  DispatchDocumentNotAvailableError,
  DispatchDocumentValidationError,
  createDispatchDocuments,
  createStatementAdjustmentArtifactPreparer,
  bindPrintHandoffCompletion,
  dispatchDocumentHttpStatus,
  parseDispatchDocumentKinds,
  type DispatchArtifactStorage,
  type DispatchDocumentRepository,
  type DispatchDocumentSourceReader,
} from '../dispatchDocuments';
import type { DispatchDocumentKind, DispatchDocumentRenderInput, PublishedDispatchArtifact } from '../dispatchDocuments/contracts';
import { PilotSafetyPauseError } from '../dispatchCutover';

const bytes = (value: string) => new TextEncoder().encode(value);
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

const makeHarness = (options: { failStatementOnce?: boolean; failSecondStageOnce?: boolean; failSourceEvidence?: boolean } = {}) => {
  const files = new Map<string, Uint8Array>();
  const state = {
    commands: new Map<string, unknown>(),
    issued: [] as Array<any>,
    rejected: [] as Array<any>,
    voided: [] as Array<any>,
    replacements: [] as Array<any>,
    handoffs: [] as Array<any>,
    retrievals: [] as Array<any>,
    incidents: [] as Array<any>,
  };
  let nextNumber = 7000n;
  const repository: DispatchDocumentRepository = {
    findCommandResult: async ({ scope, scopeId, idempotencyKey }) => state.commands.get(`${scope}:${scopeId}:${idempotencyKey}`) ?? null,
    allocateWaybillNumber: async () => (++nextNumber).toString(),
    acceptAndIssue: async (input) => {
      if (input.expectedSourceIntegrityHash !== 'source-hash') throw new DispatchDocumentConflictError('stale');
      const result = { candidateId: input.candidateId, status: 'ACCEPTED' as const, waybill: input.waybill };
      state.issued.push(input);
      state.commands.set(`CANDIDATE:${input.candidateId}:${input.idempotencyKey}`, result);
      return result;
    },
    recordEvidenceConflict: async (input) => {
      const result = { candidateId: input.candidateId, status: 'EVIDENCE_CONFLICT' as const, waybill: null };
      state.rejected.push(input);
      state.commands.set(`CANDIDATE:${input.candidateId}:${input.idempotencyKey}`, result);
      return result;
    },
    rejectCandidate: async (input) => {
      const result = { candidateId: input.candidateId, status: input.action === 'REJECT' ? 'REJECTED' as const : 'RETURNED' as const, waybill: null };
      state.rejected.push(input);
      state.commands.set(`CANDIDATE:${input.candidateId}:${input.idempotencyKey}`, result);
      return result;
    },
    voidWaybill: async (input) => {
      const result = { id: input.waybillId, number: '7001', status: 'VOIDED' as const };
      state.voided.push(input);
      state.commands.set(`WAYBILL:${input.waybillId}:${input.idempotencyKey}`, result);
      return result;
    },
    replaceWaybill: async (input) => {
      state.replacements.push(input);
      state.issued.push({ waybill: input.replacement, artifacts: input.artifacts });
      const result = { voided: { id: input.waybillId, number: '7001', status: 'VOIDED' as const }, replacement: input.replacement };
      state.commands.set(`WAYBILL:${input.waybillId}:${input.idempotencyKey}`, result);
      return result;
    },
    getArtifact: async ({ artifactId }) => state.issued.flatMap((entry) => entry.artifacts).find((artifact: PublishedDispatchArtifact) => artifact.id === artifactId) ?? null,
    recordRetrieval: async (input) => { state.retrievals.push(input); },
    getPrintableArtifacts: async ({ waybillId, kinds }) => state.issued.flatMap((entry) => entry.artifacts)
      .filter((artifact: PublishedDispatchArtifact) => artifact.waybillId === waybillId && kinds.includes(artifact.kind)),
    recordPrintHandoff: async (input) => {
      state.handoffs.push(input);
      if (input.status === 'SUCCEEDED') state.commands.set(
        `PRINT_HANDOFF:${input.waybillId}:${input.operationIdempotencyKey}`,
        { kinds: input.kinds, artifactIds: input.artifacts.map(artifact => artifact.id) },
      );
    },
    getCombinedReadModel: async ({ candidateId, authorizedWaybillId }) => candidateId === 'candidate-1'
      && state.issued.some(entry => entry.waybill.id === authorizedWaybillId)
      ? { candidateId, status: 'ACCEPTED', waybills: state.issued.map((entry) => entry.waybill) } : null,
  };
  let stageCount = 0;
  let failedStage = false;
  const storage: DispatchArtifactStorage = {
    stage: async ({ storageKey, bytes: content }) => {
      stageCount += 1;
      if (options.failSecondStageOnce && stageCount === 2 && !failedStage) { failedStage = true; throw new Error('simulated storage interruption'); }
      files.set(storageKey, content);
    },
    read: async (storageKey) => files.get(storageKey) ?? null,
  };
  const sourceReader: DispatchDocumentSourceReader = {
    readPrimaryBundle: async ({ candidateId, waybill }) => ({
      candidateId,
      allocationRevisionId: 'revision-1',
      sourceIntegrityHash: 'source-hash',
      provenance: { generatorVersion: 'generator-v1', sourceVersionIdentities: { allocationRevision: 'revision-1', approvedPricing: 'price-1' } },
      pricedAllocation: { currency: 'IRR', pricingVersions: [{ contractId: 'contract-1', pricingVersionId: 'price-1', integrityHash: 'price-hash', readinessEvidenceHash: 'ready-hash' }],
        lines: [{ allocationRevisionLineId: 'revision-line-1', contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'row-1', unit: 'count', quantity: '2.000',
          grossAmount: '10.000000000000', discountAmount: '1.000000000000', netAmount: '9.000000000000', ledgerSequence: 1 }],
        totals: { grossAmount: '10.000000000000', discountAmount: '1.000000000000', netAmount: '9.000000000000' } },
      waybillSnapshot: { allocationRevisionId: 'revision-1' },
      waybill: {
        schemaVersion: 1, kind: 'WAYBILL', documentId: waybill.waybillDocumentId, waybillNumber: waybill.number,
        issuedAt: waybill.issuedAt, customerName: 'مشتری', projectOrDestination: 'مقصد', vehiclePlate: '11الف111', templateVersion: 'v1',
        payload: { allocationRevisionId: 'revision-1', contracts: [{ contractId: 'contract-1', contractNumber: 'C-1',
          lines: [{ contractItemId: 'item-1', productRowId: 'row-1', label: 'سنگ', unit: 'count', quantity: '2.000' }] }] },
      },
      statement: {
        schemaVersion: 1, kind: 'STATEMENT', documentId: waybill.statementDocumentId, waybillNumber: waybill.number,
        issuedAt: waybill.issuedAt, customerName: 'مشتری', projectOrDestination: 'مقصد', vehiclePlate: '11الف111', templateVersion: 'v1',
        payload: { currency: 'IRR', contracts: [{ contractId: 'contract-1', contractNumber: 'C-1', grossAmount: '10.000000000000', allocatedDiscount: '1.000000000000', netAmount: '9.000000000000',
          lines: [{ contractItemId: 'item-1', productRowId: 'row-1', label: 'سنگ', unit: 'count', quantity: '2.000', grossAmount: '10.000000000000', allocatedDiscount: '1.000000000000', netAmount: '9.000000000000' }] }],
          grossAmount: '10.000000000000', allocatedDiscount: '1.000000000000', netAmount: '9.000000000000' },
      },
    }),
    readReplacementBundle: async ({ waybillId, replacement }) => ({
      predecessorWaybillId: waybillId, candidateId: 'candidate-1', allocationRevisionId: 'revision-1', sourceIntegrityHash: 'source-hash',
      provenance: { generatorVersion: 'generator-v1', sourceVersionIdentities: { allocationRevision: 'revision-1', approvedPricing: 'price-1' } },
      pricedAllocation: { currency: 'IRR', pricingVersions: [{ contractId: 'contract-1', pricingVersionId: 'price-1', integrityHash: 'price-hash', readinessEvidenceHash: 'ready-hash' }],
        lines: [{ allocationRevisionLineId: 'revision-line-1', contractId: 'contract-1', contractItemId: 'item-1', productRowId: 'row-1', unit: 'count', quantity: '2.000', grossAmount: '10.000000000000', discountAmount: '1.000000000000', netAmount: '9.000000000000', ledgerSequence: 1 }],
        totals: { grossAmount: '10.000000000000', discountAmount: '1.000000000000', netAmount: '9.000000000000' } },
      waybillSnapshot: { allocationRevisionId: 'revision-1' },
      waybill: { schemaVersion: 1, kind: 'WAYBILL', documentId: replacement.waybillDocumentId, waybillNumber: replacement.number,
        issuedAt: replacement.issuedAt, customerName: 'مشتری', projectOrDestination: 'مقصد', vehiclePlate: '11الف111', templateVersion: 'v1',
        payload: { allocationRevisionId: 'revision-1', contracts: [{ contractId: 'contract-1', contractNumber: 'C-1', lines: [{ contractItemId: 'item-1', productRowId: 'row-1', label: 'سنگ', unit: 'count', quantity: '2.000' }] }] } },
      statement: { schemaVersion: 1, kind: 'STATEMENT', documentId: replacement.statementDocumentId, waybillNumber: replacement.number,
        issuedAt: replacement.issuedAt, customerName: 'مشتری', projectOrDestination: 'مقصد', vehiclePlate: '11الف111', templateVersion: 'v1',
        payload: { currency: 'IRR', contracts: [{ contractId: 'contract-1', contractNumber: 'C-1', grossAmount: '10.000000000000', allocatedDiscount: '1.000000000000', netAmount: '9.000000000000', lines: [{ contractItemId: 'item-1', productRowId: 'row-1', label: 'سنگ', unit: 'count', quantity: '2.000', grossAmount: '10.000000000000', allocatedDiscount: '1.000000000000', netAmount: '9.000000000000' }] }], grossAmount: '10.000000000000', allocatedDiscount: '1.000000000000', netAmount: '9.000000000000' } },
    }),
  };
  if (options.failSourceEvidence) sourceReader.readPrimaryBundle = async () => {
    throw new DispatchDocumentEvidenceConflictError('malformed priced allocation evidence');
  };
  let failedStatement = false;
  const service = createDispatchDocuments({ repository, storage, sourceReader,
    publisher: { publish: async (input: DispatchDocumentRenderInput) => {
      if (options.failStatementOnce && input.kind === 'STATEMENT' && !failedStatement) {
        failedStatement = true;
        throw new Error('simulated statement render failure');
      }
      return { bytes: bytes(`pdf:${input.kind}`), mediaType: 'application/pdf' };
    } },
    access: { canReadWaybill: async ({ actorId }) => actorId === 'allowed' },
    incidents: { report: async input => { state.incidents.push(input); } },
    id: (() => { let value = 0; return () => `id-${++value}`; })(),
    now: () => new Date('2026-08-09T12:00:00.000Z'),
  });
  return { service, state, files, repository };
};

const run = async () => {
  assert.deepEqual(parseDispatchDocumentKinds(['STATEMENT', 'WAYBILL']), ['STATEMENT', 'WAYBILL']);
  assert.throws(() => parseDispatchDocumentKinds(['WAYBILL', 'UNKNOWN']), DispatchDocumentValidationError);
  assert.equal(dispatchDocumentHttpStatus(new DispatchDocumentValidationError('invalid')), 400);
  assert.equal(dispatchDocumentHttpStatus(new DispatchDocumentConflictError('conflict')), 409);
  assert.equal(dispatchDocumentHttpStatus(new PilotSafetyPauseError('paused')), 409);
  assert.equal(dispatchDocumentHttpStatus(new DispatchDocumentNotAvailableError()), 404);
  const { service, state, files } = makeHarness();
  const issued = await service.decideCandidate({ candidateId: 'candidate-1', action: 'ACCEPT', idempotencyKey: 'accept-1', actorId: 'accountant' });
  assert.equal(issued.status, 'ACCEPTED');
  assert.equal(state.issued.length, 1);
  assert.deepEqual(state.issued[0].artifacts.map((artifact: PublishedDispatchArtifact) => artifact.kind), ['WAYBILL', 'STATEMENT']);
  assert.equal(state.issued[0].artifacts[0].generatorVersion, 'generator-v1');
  assert.equal(files.size, 2);
  for (const artifact of state.issued[0].artifacts) {
    const content = files.get(artifact.storageKey)!;
    assert.equal(artifact.sha256, sha256(content));
    assert.equal(artifact.byteLength, content.byteLength);
  }

  const duplicate = await service.decideCandidate({ candidateId: 'candidate-1', action: 'ACCEPT', idempotencyKey: 'accept-1', actorId: 'accountant' });
  assert.deepEqual(duplicate, issued);
  assert.equal(state.issued.length, 1);

  const rejected = await service.decideCandidate({ candidateId: 'candidate-2', action: 'REJECT', reason: 'نیازمند اصلاح', idempotencyKey: 'reject-1', actorId: 'accountant' });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(files.size, 2);

  const artifact = state.issued[0].artifacts[0] as PublishedDispatchArtifact;
  const retrieved = await service.retrieveArtifact({ artifactId: artifact.id, waybillId: artifact.waybillId, actorId: 'allowed', correlationId: 'read-1' });
  assert.equal(sha256(retrieved.bytes), artifact.sha256);
  assert.equal(state.retrievals[0].status, 'SUCCEEDED');
  await assert.rejects(() => service.retrieveArtifact({ artifactId: artifact.id, waybillId: artifact.waybillId, actorId: 'denied', correlationId: 'read-2' }), /not available/i);
  const readModel = await service.getCombinedReadModel({ candidateId: 'candidate-1', waybillId: artifact.waybillId, actorId: 'allowed' }) as any;
  assert.equal(readModel.candidateId, 'candidate-1');
  await assert.rejects(() => service.getCombinedReadModel({ candidateId: 'candidate-1', waybillId: artifact.waybillId, actorId: 'denied' }), /not available/i);
  await assert.rejects(() => service.getCombinedReadModel({ candidateId: 'candidate-other', waybillId: artifact.waybillId, actorId: 'allowed' }), /not available/i);

  const printed = await service.printHandoff({ waybillId: artifact.waybillId, kinds: ['STATEMENT', 'WAYBILL'],
    idempotencyKey: 'print-1', actorId: 'allowed', correlationId: 'print-correlation' });
  assert.deepEqual(printed.documents.map(document => document.artifact.kind), ['WAYBILL', 'STATEMENT']);
  assert.equal(state.handoffs.length, 0, 'preparation is not a successful byte handoff');
  await printed.complete.succeeded();
  assert.equal(state.handoffs[0].status, 'SUCCEEDED');
  const repeatedPrint = await service.printHandoff({ waybillId: artifact.waybillId, kinds: ['WAYBILL', 'STATEMENT'],
    idempotencyKey: 'print-1', actorId: 'allowed', correlationId: 'print-retry' });
  await repeatedPrint.complete.failed('RESPONSE_CLOSED');
  assert.equal(state.handoffs.length, 2, 'each actual transfer attempt retains append-only evidence');
  await assert.rejects(() => service.printHandoff({ waybillId: artifact.waybillId, kinds: ['WAYBILL'],
    idempotencyKey: 'print-1', actorId: 'allowed', correlationId: 'print-conflicting-retry' }),
  /another document set/);
  const adjustments = [1, 2].map(sequence => ({ ...artifact, id: `adjustment-artifact-${sequence}`,
    kind: 'STATEMENT_ADJUSTMENT' as const, adjustmentSequence: sequence,
    storageKey: `dispatch-documents/adjustment-${sequence}.pdf`, sha256: sha256(bytes(`adjustment-${sequence}`)),
    byteLength: bytes(`adjustment-${sequence}`).byteLength }));
  state.issued[0].artifacts.push(...adjustments);
  adjustments.forEach(item => files.set(item.storageKey, bytes(`adjustment-${item.adjustmentSequence}`)));
  const adjustmentPrint = await service.printHandoff({ waybillId: artifact.waybillId, kinds: ['STATEMENT_ADJUSTMENT'],
    idempotencyKey: 'print-adjustments', actorId: 'allowed', correlationId: 'print-adjustments-attempt' });
  assert.deepEqual(adjustmentPrint.documents.map(item => item.artifact.adjustmentSequence), [1, 2]);
  await adjustmentPrint.complete.succeeded();

  const replacement = await service.replaceWaybill({ waybillId: artifact.waybillId, reason: 'نسخه چاپی اشتباه',
    idempotencyKey: 'replace-1', actorId: 'accountant' });
  assert.equal((replacement as any).replacement.replacesWaybillId, artifact.waybillId);
  assert.equal(state.replacements[0].artifacts.length, 2);
  assert.equal(state.issued[0].artifacts.length, 4, 'predecessor primary and adjustment artifact history remains immutable');

  const voided = await service.voidWaybill({ waybillId: 'waybill-other', reason: 'ابطال مستقل', idempotencyKey: 'void-1', actorId: 'accountant' });
  assert.equal((voided as any).status, 'VOIDED');
  assert.equal(state.voided.length, 1);

  files.set(artifact.storageKey, bytes('corrupt'));
  await assert.rejects(() => service.retrieveArtifact({ artifactId: artifact.id, waybillId: artifact.waybillId, actorId: 'allowed', correlationId: 'read-3' }), DispatchDocumentIntegrityError);
  assert.equal(state.retrievals.at(-1).status, 'FAILED');
  assert.equal(state.incidents.at(-1).failureCode, 'ARTIFACT_INTEGRITY_FAILURE');
  await assert.rejects(() => service.printHandoff({ waybillId: artifact.waybillId, kinds: ['WAYBILL'], idempotencyKey: 'print-2',
    actorId: 'allowed', correlationId: 'print-corrupt' }), DispatchDocumentIntegrityError);
  assert.equal(state.handoffs.at(-1).status, 'FAILED');
  files.set(artifact.storageKey, bytes('pdf:WAYBILL'));
  const recoveredPrint = await service.printHandoff({ waybillId: artifact.waybillId, kinds: ['WAYBILL'], idempotencyKey: 'print-2',
    actorId: 'allowed', correlationId: 'print-recovered' });
  await recoveredPrint.complete.succeeded();
  assert.deepEqual(state.handoffs.slice(-2).map(item => item.status), ['FAILED', 'SUCCEEDED']);

  const retryHarness = makeHarness({ failStatementOnce: true });
  await assert.rejects(() => retryHarness.service.decideCandidate({ candidateId: 'candidate-retry', action: 'ACCEPT',
    idempotencyKey: 'retry-key', actorId: 'accountant' }), /simulated statement render failure/);
  assert.equal(retryHarness.state.issued.length, 0, 'a partial render never commits candidate, waybill, or artifact metadata');
  const retried = await retryHarness.service.decideCandidate({ candidateId: 'candidate-retry', action: 'ACCEPT',
    idempotencyKey: 'retry-key', actorId: 'accountant' });
  assert.equal(retried.status, 'ACCEPTED');
  assert.equal(retryHarness.state.issued.length, 1);

  const evidenceConflictHarness = makeHarness({ failSourceEvidence: true });
  const evidenceConflict = await evidenceConflictHarness.service.decideCandidate({ candidateId: 'candidate-conflict', action: 'ACCEPT',
    idempotencyKey: 'conflict-key', actorId: 'accountant' });
  assert.equal(evidenceConflict.status, 'EVIDENCE_CONFLICT');
  assert.equal(evidenceConflictHarness.state.issued.length, 0);
  assert.equal(evidenceConflictHarness.state.rejected.length, 1);

  const missingMetadataHarness = makeHarness();
  const missingMetadataIssued = await missingMetadataHarness.service.decideCandidate({ candidateId: 'candidate-missing', action: 'ACCEPT',
    idempotencyKey: 'missing-issue', actorId: 'accountant' });
  const missingWaybillId = missingMetadataIssued.waybill!.id;
  await assert.rejects(() => missingMetadataHarness.service.retrieveArtifact({ artifactId: 'missing-artifact',
    waybillId: missingWaybillId, actorId: 'allowed', correlationId: 'missing-retrieval' }), /not available/i);
  assert.equal(missingMetadataHarness.state.incidents.at(-1).failureCode, 'ARTIFACT_METADATA_MISSING');
  missingMetadataHarness.state.issued[0].artifacts = missingMetadataHarness.state.issued[0].artifacts
    .filter((item: PublishedDispatchArtifact) => item.kind !== 'WAYBILL');
  await assert.rejects(() => missingMetadataHarness.service.printHandoff({ waybillId: missingWaybillId,
    kinds: ['WAYBILL'], idempotencyKey: 'missing-print', actorId: 'allowed', correlationId: 'missing-print-attempt' }),
  DispatchDocumentIntegrityError);
  assert.equal(missingMetadataHarness.state.incidents.at(-1).artifactId, null);
  assert.equal(missingMetadataHarness.state.incidents.at(-1).failureCode, 'ARTIFACT_METADATA_MISSING');

  const storageRetry = makeHarness({ failSecondStageOnce: true });
  await assert.rejects(() => storageRetry.service.decideCandidate({ candidateId: 'candidate-storage-retry', action: 'ACCEPT',
    idempotencyKey: 'storage-retry-key', actorId: 'accountant' }), /simulated storage interruption/);
  assert.equal(storageRetry.files.size, 1, 'a losing staged file is retained as an unreferenced immutable orphan');
  assert.equal(storageRetry.state.issued.length, 0);
  await storageRetry.service.decideCandidate({ candidateId: 'candidate-storage-retry', action: 'ACCEPT',
    idempotencyKey: 'storage-retry-key', actorId: 'accountant' });
  assert.equal(storageRetry.state.issued.length, 1);
  assert.equal(storageRetry.files.size, 3, 'retry publishes a fresh verified pair without overwriting the losing staged file');

  const adjustmentFiles = new Map<string, Uint8Array>();
  const preparer = createStatementAdjustmentArtifactPreparer({
    publisher: { publish: async () => ({ bytes: bytes('adjustment-pdf'), mediaType: 'application/pdf' }) },
    storage: { stage: async ({ storageKey, bytes: content }) => { adjustmentFiles.set(storageKey, content); },
      read: async storageKey => adjustmentFiles.get(storageKey) ?? null },
    id: (() => { let next = 0; return () => `adjustment-${++next}`; })(),
    now: () => new Date('2026-08-09T12:00:00.000Z'),
    generatorVersion: 'generator-v1', sourceVersionIdentities: { correction: 'correction-v1' },
  });
  const prepared = await preparer.prepare({ schemaVersion: 1, kind: 'STATEMENT_ADJUSTMENT', documentId: 'adjustment-document-1',
    waybillNumber: '7001', issuedAt: '2026-08-09T12:00:00.000Z', customerName: 'مشتری', projectOrDestination: 'مقصد',
    vehiclePlate: '11الف111', templateVersion: 'v1', payload: { sequence: 1, originalStatementDocumentId: 'statement-1',
      reason: 'اصلاح', currency: 'IRR', lines: [], grossAmountDelta: '0.000000000000', discountDelta: '0.000000000000', netAmountDelta: '0.000000000000' } });
  assert.equal(prepared.sha256, sha256(bytes('adjustment-pdf')));
  assert.equal(prepared.generatorVersion, 'generator-v1');
  assert.equal(adjustmentFiles.size, 1);

  const finishedResponse = new EventEmitter();
  const completionEvents: string[] = [];
  bindPrintHandoffCompletion(finishedResponse as any, { succeeded: async () => { completionEvents.push('SUCCEEDED'); },
    failed: async code => { completionEvents.push(`FAILED:${code}`); } });
  finishedResponse.emit('finish'); finishedResponse.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(completionEvents, ['SUCCEEDED']);
  const closedResponse = new EventEmitter();
  bindPrintHandoffCompletion(closedResponse as any, { succeeded: async () => { completionEvents.push('UNEXPECTED'); },
    failed: async code => { completionEvents.push(`FAILED:${code}`); } });
  closedResponse.emit('close');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(completionEvents.at(-1), 'FAILED:RESPONSE_CLOSED');
};

run().then(() => console.log('dispatch documents tests passed'));
