import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DispatchDocumentConflictError,
  DispatchDocumentIntegrityError,
  createDispatchDocuments,
  createStatementAdjustmentArtifactPreparer,
  type DispatchArtifactStorage,
  type DispatchDocumentRepository,
  type DispatchDocumentSourceReader,
} from '../dispatchDocuments';
import type { DispatchDocumentKind, DispatchDocumentRenderInput, PublishedDispatchArtifact } from '../dispatchDocuments/contracts';

const bytes = (value: string) => new TextEncoder().encode(value);
const sha256 = (value: Uint8Array) => createHash('sha256').update(value).digest('hex');

const makeHarness = (options: { failStatementOnce?: boolean; failSecondStageOnce?: boolean } = {}) => {
  const files = new Map<string, Uint8Array>();
  const state = {
    commands: new Map<string, unknown>(),
    issued: [] as Array<any>,
    rejected: [] as Array<any>,
    voided: [] as Array<any>,
    replacements: [] as Array<any>,
    handoffs: [] as Array<any>,
    retrievals: [] as Array<any>,
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
      if (input.status === 'SUCCEEDED') state.commands.set(`PRINT_HANDOFF:${input.waybillId}:${input.idempotencyKey}`, { kinds: input.kinds });
    },
    getCombinedReadModel: async ({ candidateId }) => ({ candidateId, status: 'ACCEPTED', waybills: state.issued.map((entry) => entry.waybill) }),
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
    id: (() => { let value = 0; return () => `id-${++value}`; })(),
    now: () => new Date('2026-08-09T12:00:00.000Z'),
  });
  return { service, state, files, repository };
};

const run = async () => {
  const { service, state, files } = makeHarness();
  const issued = await service.decideCandidate({ candidateId: 'candidate-1', action: 'ACCEPT', idempotencyKey: 'accept-1', actorId: 'accountant' });
  assert.equal(issued.status, 'ACCEPTED');
  assert.equal(state.issued.length, 1);
  assert.deepEqual(state.issued[0].artifacts.map((artifact: PublishedDispatchArtifact) => artifact.kind), ['WAYBILL', 'STATEMENT']);
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

  const printed = await service.printHandoff({ waybillId: artifact.waybillId, kinds: ['STATEMENT', 'WAYBILL'],
    idempotencyKey: 'print-1', actorId: 'allowed', correlationId: 'print-correlation' });
  assert.deepEqual(printed.documents.map(document => document.artifact.kind), ['WAYBILL', 'STATEMENT']);
  assert.equal(state.handoffs[0].status, 'SUCCEEDED');
  await service.printHandoff({ waybillId: artifact.waybillId, kinds: ['WAYBILL', 'STATEMENT'],
    idempotencyKey: 'print-1', actorId: 'allowed', correlationId: 'print-retry' });
  assert.equal(state.handoffs.length, 1, 'a successful print handoff retry replays without duplicate evidence');

  const replacement = await service.replaceWaybill({ waybillId: artifact.waybillId, reason: 'نسخه چاپی اشتباه',
    idempotencyKey: 'replace-1', actorId: 'accountant' });
  assert.equal((replacement as any).replacement.replacesWaybillId, artifact.waybillId);
  assert.equal(state.replacements[0].artifacts.length, 2);
  assert.equal(state.issued[0].artifacts.length, 2, 'predecessor artifact history remains immutable');

  const voided = await service.voidWaybill({ waybillId: 'waybill-other', reason: 'ابطال مستقل', idempotencyKey: 'void-1', actorId: 'accountant' });
  assert.equal((voided as any).status, 'VOIDED');
  assert.equal(state.voided.length, 1);

  files.set(artifact.storageKey, bytes('corrupt'));
  await assert.rejects(() => service.retrieveArtifact({ artifactId: artifact.id, waybillId: artifact.waybillId, actorId: 'allowed', correlationId: 'read-3' }), DispatchDocumentIntegrityError);
  assert.equal(state.retrievals.at(-1).status, 'FAILED');
  await assert.rejects(() => service.printHandoff({ waybillId: artifact.waybillId, kinds: ['WAYBILL'], idempotencyKey: 'print-2',
    actorId: 'allowed', correlationId: 'print-corrupt' }), DispatchDocumentIntegrityError);
  assert.equal(state.handoffs.at(-1).status, 'FAILED');

  const retryHarness = makeHarness({ failStatementOnce: true });
  await assert.rejects(() => retryHarness.service.decideCandidate({ candidateId: 'candidate-retry', action: 'ACCEPT',
    idempotencyKey: 'retry-key', actorId: 'accountant' }), /simulated statement render failure/);
  assert.equal(retryHarness.state.issued.length, 0, 'a partial render never commits candidate, waybill, or artifact metadata');
  const retried = await retryHarness.service.decideCandidate({ candidateId: 'candidate-retry', action: 'ACCEPT',
    idempotencyKey: 'retry-key', actorId: 'accountant' });
  assert.equal(retried.status, 'ACCEPTED');
  assert.equal(retryHarness.state.issued.length, 1);

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
  });
  const prepared = await preparer.prepare({ schemaVersion: 1, kind: 'STATEMENT_ADJUSTMENT', documentId: 'adjustment-document-1',
    waybillNumber: '7001', issuedAt: '2026-08-09T12:00:00.000Z', customerName: 'مشتری', projectOrDestination: 'مقصد',
    vehiclePlate: '11الف111', templateVersion: 'v1', payload: { sequence: 1, originalStatementDocumentId: 'statement-1',
      reason: 'اصلاح', currency: 'IRR', lines: [], grossAmountDelta: '0.000000000000', discountDelta: '0.000000000000', netAmountDelta: '0.000000000000' } });
  assert.equal(prepared.sha256, sha256(bytes('adjustment-pdf')));
  assert.equal(adjustmentFiles.size, 1);
};

run().then(() => console.log('dispatch documents tests passed'));
