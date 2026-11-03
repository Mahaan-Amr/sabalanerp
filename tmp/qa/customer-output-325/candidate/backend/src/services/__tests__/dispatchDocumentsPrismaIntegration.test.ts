import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type DispatchDocumentArtifact } from '@prisma/client';
import { PrismaDispatchDocumentRepository } from '../dispatchDocuments/prismaRepository';
import { DispatchDocumentConflictError } from '../dispatchDocuments/service';
import { dispatchArtifactStorageLockKey, verifyDispatchArtifactStorageUnderLock } from '../dispatchDocuments/artifactStorageLock';

const prisma = new PrismaClient();
const rollback = Symbol('dispatch-documents-integration-rollback');

const run = async () => {
  const before = {
    artifacts: await prisma.dispatchDocumentArtifact.count(),
    handoffs: await prisma.dispatchDocumentPrintHandoff.count(),
    commands: await prisma.dispatchDocumentCommandResult.count(),
    audits: await prisma.dispatchLifecycleAudit.count(),
  };
  try {
    await prisma.$transaction(async tx => {
      const waybill = await tx.accountingDispatchWaybill.findFirst({
        where: { documentArtifacts: { none: {} } },
        select: { id: true },
      });
      assert.ok(waybill, 'A waybill without document artifacts is required for rollback-only integration verification.');

      // The repository deliberately owns its production transaction. This adapter keeps that public seam
      // while nesting it in this test's rollback-only transaction, so immutable evidence never persists.
      const transactionalClient = new Proxy(tx, {
        get(target, property, receiver) {
          if (property === '$transaction') return async (work: (inner: Prisma.TransactionClient) => Promise<unknown>) => work(tx);
          return Reflect.get(target, property, receiver);
        },
      }) as unknown as PrismaClient;
      const durableArtifacts = new Map<string, Uint8Array>();
      const repository = new PrismaDispatchDocumentRepository(transactionalClient, {
        assess: async () => ({ status: 'CURRENT', staleContracts: [] }),
      }, { stage: async ({ storageKey, bytes }) => { durableArtifacts.set(storageKey, bytes); },
        read: async storageKey => durableArtifacts.get(storageKey) ?? null });
      const runId = randomUUID();
      const artifacts: DispatchDocumentArtifact[] = [];
      for (const [index, kind] of (['WAYBILL', 'STATEMENT'] as const).entries()) {
        const durableBytes = new TextEncoder().encode(`integration-${kind}`);
        const storageKey = `dispatch-documents/${runId}-${index}.pdf`;
        durableArtifacts.set(storageKey, durableBytes);
        artifacts.push(await tx.dispatchDocumentArtifact.create({ data: {
          id: `${runId}-${index}`, waybillId: waybill.id, kind, templateVersion: 'integration-v1',
          storageKey, mediaType: 'application/pdf', byteLength: BigInt(durableBytes.byteLength),
          sha256: createHash('sha256').update(durableBytes).digest('hex'), sourceIntegrityHash: 'a'.repeat(64), publishedBy: 'integration-verifier',
        } }));
      }
      const published = artifacts.map(artifact => ({
        id: artifact.id, waybillId: artifact.waybillId, kind: artifact.kind, adjustmentSequence: null,
        templateVersion: artifact.templateVersion, generatorVersion: 'integration-generator-v1',
        sourceVersionIdentities: { allocationRevision: 'integration-revision' }, storageKey: artifact.storageKey,
        mediaType: 'application/pdf' as const, byteLength: Number(artifact.byteLength), sha256: artifact.sha256,
        publishedAt: artifact.publishedAt.toISOString(),
      }));
      await verifyDispatchArtifactStorageUnderLock({ transaction: tx,
        storage: { stage: async () => undefined, read: async storageKey => durableArtifacts.get(storageKey) ?? null },
        artifacts: published });
      const contender = new PrismaClient();
      try {
        const [{ acquired }] = await contender.$queryRawUnsafe<Array<{ acquired: boolean }>>(
          'SELECT pg_try_advisory_xact_lock(hashtext($1)) AS acquired', dispatchArtifactStorageLockKey(published[0].storageKey));
        assert.equal(acquired, false, 'quarantine/recovery cannot acquire the canonical storage-key lock during publication');
      } finally { await contender.$disconnect(); }
      const operationIdempotencyKey = `${runId}:operation`;
      await repository.recordPrintHandoff({ waybillId: waybill.id, operationIdempotencyKey,
        attemptId: `${runId}:failed`, correlationId: `${runId}:failed`, actorId: 'integration-verifier',
        kinds: ['WAYBILL', 'STATEMENT'], status: 'FAILED', artifacts: published, failureCode: 'RESPONSE_CLOSED', intentFingerprint: `${runId}:intent` });
      await repository.recordPrintHandoff({ waybillId: waybill.id, operationIdempotencyKey,
        attemptId: `${runId}:success`, correlationId: `${runId}:success`, actorId: 'integration-verifier',
        kinds: ['WAYBILL', 'STATEMENT'], status: 'SUCCEEDED', artifacts: published, intentFingerprint: `${runId}:intent` });
      await repository.recordPrintHandoff({ waybillId: waybill.id, operationIdempotencyKey,
        attemptId: `${runId}:success`, correlationId: `${runId}:success`, actorId: 'integration-verifier',
        kinds: ['WAYBILL', 'STATEMENT'], status: 'SUCCEEDED', artifacts: published, intentFingerprint: `${runId}:intent` });

      const attempts = await tx.dispatchDocumentPrintHandoff.findMany({
        where: { idempotencyKey: { startsWith: runId } }, orderBy: { requestedAt: 'asc' },
      });
      assert.deepEqual(attempts.map(attempt => attempt.status), ['FAILED', 'SUCCEEDED']);
      assert.equal(await tx.dispatchDocumentCommandResult.count({ where: {
        scope: 'PRINT_HANDOFF', scopeId: waybill.id, idempotencyKey: operationIdempotencyKey, status: 'SUCCEEDED',
      } }), 1);
      assert.ok(await repository.findCommandResult({ scope: 'PRINT_HANDOFF', scopeId: waybill.id,
        idempotencyKey: operationIdempotencyKey, command: 'PRINT_HANDOFF', intentFingerprint: `${runId}:intent` }));
      await assert.rejects(() => repository.findCommandResult({ scope: 'PRINT_HANDOFF', scopeId: waybill.id,
        idempotencyKey: operationIdempotencyKey, command: 'PRINT_HANDOFF', intentFingerprint: `${runId}:different-intent` }),
      DispatchDocumentConflictError);
      assert.equal(await tx.dispatchLifecycleAudit.count({ where: {
        actorId: 'integration-verifier', aggregateId: waybill.id,
        payload: { path: ['operationIdempotencyKey'], equals: operationIdempotencyKey },
      } }), 2);

      await repository.recordRetrieval({ waybillId: waybill.id, artifact: published[0], requestedArtifactId: published[0].id,
        attemptId: `${runId}:retrieval-failed`, actorId: 'integration-verifier', correlationId: `${runId}:retrieval-failed`,
        status: 'FAILED', failureCode: 'RESPONSE_CLOSED', intentFingerprint: `${runId}:retrieval-intent` });
      await repository.recordRetrieval({ waybillId: waybill.id, artifact: published[0], requestedArtifactId: published[0].id,
        attemptId: `${runId}:retrieval-success`, actorId: 'integration-verifier', correlationId: `${runId}:retrieval-success`,
        status: 'SUCCEEDED', intentFingerprint: `${runId}:retrieval-intent` });
      assert.equal(await tx.dispatchDocumentCommandResult.count({ where: { scope: 'WAYBILL', scopeId: waybill.id,
        idempotencyKey: { in: [`retrieve:${runId}:retrieval-failed`, `retrieve:${runId}:retrieval-success`] } } }), 2,
      'failed and later successful retrieval attempts remain append-only');

      const pending = await tx.accountingDispatchCandidate.findFirst({
        where: { status: 'PENDING', workItem: { status: 'OPEN' } }, select: { id: true }, orderBy: { createdAt: 'asc' },
      });
      assert.ok(pending, 'An open pending candidate is required for rollback-only evidence-conflict verification.');
      const candidateWaybillsBefore = await tx.accountingDispatchWaybill.count({ where: { candidateId: pending.id } });
      const evidenceConflict = await repository.recordEvidenceConflict({ candidateId: pending.id,
        reason: 'integration malformed evidence', idempotencyKey: `${runId}:evidence-conflict`,
        actorId: 'integration-verifier', correlationId: `${runId}:evidence-conflict`, intentFingerprint: `${runId}:conflict-intent` });
      assert.equal(evidenceConflict.status, 'EVIDENCE_CONFLICT');
      assert.equal((await tx.accountingDispatchCandidate.findUniqueOrThrow({ where: { id: pending.id } })).status, 'EVIDENCE_CONFLICT');
      assert.equal((await tx.accountingDispatchWorkItem.findUniqueOrThrow({ where: { candidateId: pending.id } })).status, 'COMPLETED');
      assert.equal(await tx.accountingDispatchWaybill.count({ where: { candidateId: pending.id } }), candidateWaybillsBefore,
        'evidence conflict closes the work item without issuing a waybill');
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error !== rollback) throw error;
  }

  assert.deepEqual({
    artifacts: await prisma.dispatchDocumentArtifact.count(),
    handoffs: await prisma.dispatchDocumentPrintHandoff.count(),
    commands: await prisma.dispatchDocumentCommandResult.count(),
    audits: await prisma.dispatchLifecycleAudit.count(),
  }, before);
};

run()
  .then(() => console.log('dispatch document Prisma append-only handoff integration: ok'))
  .finally(() => prisma.$disconnect());
