import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaDispatchDocumentRepository } from '../dispatchDocuments/prismaRepository';
import { DispatchDocumentConflictError, DispatchDocumentEvidenceConflictError } from '../dispatchDocuments/service';
import { dispatchArtifactStorageLockKey } from '../dispatchDocuments/artifactStorageLock';

const writes: string[] = [];
const advisoryLocks: string[] = [];
let replacementMode = false;
const tx = {
  $executeRawUnsafe: async (_query: string, key: string) => { advisoryLocks.push(key); return 1; },
  $queryRawUnsafe: async () => [],
  dispatchCutoverControl: { findUnique: async () => ({ phase: 'CANONICAL_LIVE' }) },
  dispatchDocumentCommandResult: { findUnique: async () => null, create: async () => { writes.push('command'); return {}; } },
  accountingDispatchCandidate: {
    findUnique: async () => replacementMode
      ? ({ id: 'candidate-1', status: 'ACCEPTED', allocationRevisionId: 'revision-1', allocationRevision: { finalizedAt: new Date('2026-08-10T00:00:00.000Z') } })
      : ({ id: 'candidate-1', status: 'PENDING', allocationRevisionId: 'revision-1', workItem: { id: 'work-1' } }),
    update: async ({ data }: any) => { writes.push(`candidate:${data.status}`); return {}; },
  },
  accountingDispatchWorkItem: { update: async () => { writes.push('work-item:COMPLETED'); return {}; } },
  shipmentStatementCutover: { findUnique: async () => ({ enabled: true, cutoverAt: new Date('2026-08-09T00:00:00.000Z') }) },
  logisticsAllocationRevision: { findUnique: async () => ({ finalizedAt: new Date('2026-08-10T00:00:00.000Z') }) },
  logisticsAllocationRevisionPricing: { findMany: async () => [{ contractId: 'contract-b' }, { contractId: 'contract-a' }] },
  accountingDispatchWaybill: {
    findUnique: async () => replacementMode ? ({ id: 'waybill-old', status: 'ISSUED', candidateId: 'candidate-1',
      physicalExit: null, manualOutageExit: null, replacementWaybill: null }) : null,
    create: async () => { writes.push('WAYBILL_CREATED'); throw new Error('stale evidence must not issue'); },
  },
  dispatchLifecycleAudit: { findFirst: async () => null, create: async () => { writes.push('audit'); return {}; } },
};
const prisma = { $transaction: async (work: any) => work(tx) } as any;

const run = async () => {
  const previous = process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
  process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = 'true';
  try {
    const storage = { stage: async () => undefined, read: async () => null };
    const repository = new PrismaDispatchDocumentRepository(prisma, { assess: async () => ({
      status: 'STALE_REQUIRES_SUCCESSOR', staleContracts: [{ contractId: 'contract-1', boundPricingVersionId: 'price-1', currentPricingVersionId: 'price-2' }],
    }) }, storage);
    const result = await repository.acceptAndIssue({ candidateId: 'candidate-1', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, waybill: { id: 'waybill-1', number: '1',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: null }, artifacts: [],
      idempotencyKey: 'accept-1', actorId: 'accountant', correlationId: 'correlation-1', intentFingerprint: 'intent-1' });
    assert.equal(result.status, 'STALE_REQUIRES_SUCCESSOR');
    assert.deepEqual(writes, ['candidate:STALE_REQUIRES_SUCCESSOR', 'work-item:COMPLETED', 'command', 'audit']);
    assert.equal(writes.includes('WAYBILL_CREATED'), false);
    assert.deepEqual(advisoryLocks.filter(key => key.startsWith('APPROVED_PRICING_HEAD:')),
      ['APPROVED_PRICING_HEAD:contract-a', 'APPROVED_PRICING_HEAD:contract-b']);

    writes.length = 0;
    const conflictingRepository = new PrismaDispatchDocumentRepository(prisma, { assess: async () => {
      throw new DispatchDocumentEvidenceConflictError('malformed priced evidence');
    } }, storage);
    const conflict = await conflictingRepository.acceptAndIssue({ candidateId: 'candidate-1', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, waybill: { id: 'waybill-2', number: '2',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: null }, artifacts: [],
      idempotencyKey: 'accept-conflict', actorId: 'accountant', correlationId: 'correlation-2', intentFingerprint: 'intent-2' });
    assert.equal(conflict.status, 'EVIDENCE_CONFLICT');
    assert.deepEqual(writes, ['candidate:EVIDENCE_CONFLICT', 'work-item:COMPLETED', 'command', 'audit']);

    writes.length = 0;
    advisoryLocks.length = 0;
    const expectedBytes = new TextEncoder().encode('durable-pdf');
    const publicationArtifact = { id: 'artifact-1', waybillId: 'waybill-publish', kind: 'WAYBILL' as const,
      adjustmentSequence: null, templateVersion: 'v1', generatorVersion: 'generator-v1', sourceVersionIdentities: {},
      storageKey: 'dispatch-documents/artifact-1.pdf', mediaType: 'application/pdf' as const,
      byteLength: expectedBytes.byteLength, sha256: createHash('sha256').update(expectedBytes).digest('hex'),
      publishedAt: '2026-08-10T01:00:00.000Z' };
    const tamperedStorage = { stage: async () => undefined,
      read: async () => new TextEncoder().encode('quarantined-or-tampered') };
    const currentRepository = new PrismaDispatchDocumentRepository(prisma,
      { assess: async () => ({ status: 'CURRENT', staleContracts: [] }) }, tamperedStorage);
    await assert.rejects(() => currentRepository.acceptAndIssue({ candidateId: 'candidate-1', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, waybill: { id: 'waybill-publish', number: '3',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: null }, artifacts: [publicationArtifact],
      idempotencyKey: 'accept-publish', actorId: 'accountant', correlationId: 'publish-1', intentFingerprint: 'publish-intent' }),
    /changed before metadata publication/);
    assert.equal(writes.includes('WAYBILL_CREATED'), false, 'primary metadata is not inserted after durable-byte mismatch');
    assert.ok(advisoryLocks.includes(dispatchArtifactStorageLockKey(publicationArtifact.storageKey)));

    const duplicateCommand = new Prisma.PrismaClientKnownRequestError('duplicate command result', {
      code: 'P2002', clientVersion: '5.16.1', meta: { target: ['scope', 'scopeId', 'idempotencyKey'] },
    });
    const replayValue = { candidateId: 'candidate-race', status: 'ACCEPTED' as const,
      waybill: { id: 'waybill-race', number: '91', status: 'ISSUED' as const,
        issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: null } };
    const racingPrisma = {
      $transaction: async () => { throw duplicateCommand; },
      dispatchDocumentCommandResult: { findUnique: async () => ({ command: 'ACCEPT_AND_ISSUE', status: 'SUCCEEDED',
        result: { intentFingerprint: 'race-intent', value: replayValue } }) },
    } as any;
    const racingRepository = new PrismaDispatchDocumentRepository(racingPrisma,
      { assess: async () => ({ status: 'CURRENT', staleContracts: [] }) }, storage);
    assert.deepEqual(await racingRepository.acceptAndIssue({ candidateId: 'candidate-race', allocationRevisionId: 'revision-race',
      expectedSourceIntegrityHash: 'race-source', waybillSnapshot: {}, waybill: replayValue.waybill, artifacts: [],
      idempotencyKey: 'race-key', actorId: 'accountant', correlationId: 'race-correlation', intentFingerprint: 'race-intent' }),
    replayValue, 'a same-scope, same-key, exact-intent P2002 replays the durable issuance result');
    await assert.rejects(() => racingRepository.acceptAndIssue({ candidateId: 'candidate-race', allocationRevisionId: 'revision-race',
      expectedSourceIntegrityHash: 'race-source', waybillSnapshot: {}, waybill: replayValue.waybill, artifacts: [],
      idempotencyKey: 'race-key', actorId: 'accountant', correlationId: 'race-correlation', intentFingerprint: 'other-intent' }),
    DispatchDocumentConflictError, 'same key with a different intent remains a conflict');
    const unrelatedRepository = new PrismaDispatchDocumentRepository({
      $transaction: async () => { throw duplicateCommand; },
      dispatchDocumentCommandResult: { findUnique: async () => null },
    } as any, { assess: async () => ({ status: 'CURRENT', staleContracts: [] }) }, storage);
    await assert.rejects(() => unrelatedRepository.acceptAndIssue({ candidateId: 'candidate-race', allocationRevisionId: 'revision-race',
      expectedSourceIntegrityHash: 'race-source', waybillSnapshot: {}, waybill: replayValue.waybill, artifacts: [],
      idempotencyKey: 'unrelated-key', actorId: 'accountant', correlationId: 'race-correlation', intentFingerprint: 'race-intent' }),
    error => error === duplicateCommand, 'a P2002 without the exact durable command result is rethrown fail-closed');
    const unrelatedTarget = new Prisma.PrismaClientKnownRequestError('duplicate waybill number', {
      code: 'P2002', clientVersion: '5.16.1', meta: { target: ['number'] },
    });
    const unrelatedTargetRepository = new PrismaDispatchDocumentRepository({
      $transaction: async () => { throw unrelatedTarget; },
      dispatchDocumentCommandResult: racingPrisma.dispatchDocumentCommandResult,
    } as any, { assess: async () => ({ status: 'CURRENT', staleContracts: [] }) }, storage);
    await assert.rejects(() => unrelatedTargetRepository.acceptAndIssue({ candidateId: 'candidate-race', allocationRevisionId: 'revision-race',
      expectedSourceIntegrityHash: 'race-source', waybillSnapshot: {}, waybill: replayValue.waybill, artifacts: [],
      idempotencyKey: 'race-key', actorId: 'accountant', correlationId: 'race-correlation', intentFingerprint: 'race-intent' }),
    error => error === unrelatedTarget,
    'a P2002 for another unique target is rethrown even when an exact durable command result exists');

    replacementMode = true;
    advisoryLocks.length = 0;
    await assert.rejects(() => repository.replaceWaybill({ waybillId: 'waybill-old', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, replacement: { id: 'waybill-new', number: '2',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: 'waybill-old' }, artifacts: [],
      reason: 'replace', idempotencyKey: 'replace-1', actorId: 'accountant', correlationId: 'replace-1',
      authority: {}, intentFingerprint: 'replace-intent' }), /Stale priced evidence/);
    assert.deepEqual(advisoryLocks.filter(key => key.startsWith('APPROVED_PRICING_HEAD:')),
      ['APPROVED_PRICING_HEAD:contract-a', 'APPROVED_PRICING_HEAD:contract-b'],
      'replacement locks the same deterministic approved-pricing heads before freshness assessment');

    advisoryLocks.length = 0;
    await assert.rejects(() => currentRepository.replaceWaybill({ waybillId: 'waybill-old', allocationRevisionId: 'revision-1',
      expectedSourceIntegrityHash: 'source-hash', waybillSnapshot: {}, replacement: { id: 'waybill-publish', number: '4',
        status: 'ISSUED', issuedAt: '2026-08-10T01:00:00.000Z', replacesWaybillId: 'waybill-old' }, artifacts: [publicationArtifact],
      reason: 'replace', idempotencyKey: 'replace-publish', actorId: 'accountant', correlationId: 'replace-publish',
      authority: {}, intentFingerprint: 'replace-publish-intent' }), /changed before metadata publication/);
    assert.equal(writes.includes('WAYBILL_CREATED'), false, 'replacement metadata is not inserted after durable-byte mismatch');
    assert.ok(advisoryLocks.includes(dispatchArtifactStorageLockKey(publicationArtifact.storageKey)));
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
    else process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = previous;
  }
};
run().then(() => console.log('dispatch document stale transaction behavior tests passed'));
