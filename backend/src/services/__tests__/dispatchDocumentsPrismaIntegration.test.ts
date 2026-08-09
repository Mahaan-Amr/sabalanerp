import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient, type DispatchDocumentArtifact } from '@prisma/client';
import { PrismaDispatchDocumentRepository } from '../dispatchDocuments/prismaRepository';

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
      const repository = new PrismaDispatchDocumentRepository(transactionalClient, {
        assess: async () => ({ status: 'CURRENT', staleContracts: [] }),
      });
      const runId = randomUUID();
      const artifacts: DispatchDocumentArtifact[] = [];
      for (const [index, kind] of (['WAYBILL', 'STATEMENT'] as const).entries()) {
        artifacts.push(await tx.dispatchDocumentArtifact.create({ data: {
          id: `${runId}-${index}`, waybillId: waybill.id, kind, templateVersion: 'integration-v1',
          storageKey: `dispatch-documents/${runId}-${index}.pdf`, mediaType: 'application/pdf', byteLength: 4n,
          sha256: String(index).repeat(64), sourceIntegrityHash: 'a'.repeat(64), publishedBy: 'integration-verifier',
        } }));
      }
      const published = artifacts.map(artifact => ({
        id: artifact.id, waybillId: artifact.waybillId, kind: artifact.kind, adjustmentSequence: null,
        templateVersion: artifact.templateVersion, generatorVersion: 'integration-generator-v1',
        sourceVersionIdentities: { allocationRevision: 'integration-revision' }, storageKey: artifact.storageKey,
        mediaType: 'application/pdf' as const, byteLength: Number(artifact.byteLength), sha256: artifact.sha256,
        publishedAt: artifact.publishedAt.toISOString(),
      }));
      const operationIdempotencyKey = `${runId}:operation`;
      await repository.recordPrintHandoff({ waybillId: waybill.id, operationIdempotencyKey,
        attemptId: `${runId}:failed`, correlationId: `${runId}:failed`, actorId: 'integration-verifier',
        kinds: ['WAYBILL', 'STATEMENT'], status: 'FAILED', artifacts: published, failureCode: 'RESPONSE_CLOSED' });
      await repository.recordPrintHandoff({ waybillId: waybill.id, operationIdempotencyKey,
        attemptId: `${runId}:success`, correlationId: `${runId}:success`, actorId: 'integration-verifier',
        kinds: ['WAYBILL', 'STATEMENT'], status: 'SUCCEEDED', artifacts: published });
      await repository.recordPrintHandoff({ waybillId: waybill.id, operationIdempotencyKey,
        attemptId: `${runId}:success`, correlationId: `${runId}:success`, actorId: 'integration-verifier',
        kinds: ['WAYBILL', 'STATEMENT'], status: 'SUCCEEDED', artifacts: published });

      const attempts = await tx.dispatchDocumentPrintHandoff.findMany({
        where: { idempotencyKey: { startsWith: runId } }, orderBy: { requestedAt: 'asc' },
      });
      assert.deepEqual(attempts.map(attempt => attempt.status), ['FAILED', 'SUCCEEDED']);
      assert.equal(await tx.dispatchDocumentCommandResult.count({ where: {
        scope: 'PRINT_HANDOFF', scopeId: waybill.id, idempotencyKey: operationIdempotencyKey, status: 'SUCCEEDED',
      } }), 1);
      assert.equal(await tx.dispatchLifecycleAudit.count({ where: {
        actorId: 'integration-verifier', aggregateId: waybill.id,
        payload: { path: ['operationIdempotencyKey'], equals: operationIdempotencyKey },
      } }), 2);

      const pending = await tx.accountingDispatchCandidate.findFirst({
        where: { status: 'PENDING', workItem: { status: 'OPEN' } }, select: { id: true }, orderBy: { createdAt: 'asc' },
      });
      assert.ok(pending, 'An open pending candidate is required for rollback-only evidence-conflict verification.');
      const candidateWaybillsBefore = await tx.accountingDispatchWaybill.count({ where: { candidateId: pending.id } });
      const evidenceConflict = await repository.recordEvidenceConflict({ candidateId: pending.id,
        reason: 'integration malformed evidence', idempotencyKey: `${runId}:evidence-conflict`,
        actorId: 'integration-verifier', correlationId: `${runId}:evidence-conflict` });
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
