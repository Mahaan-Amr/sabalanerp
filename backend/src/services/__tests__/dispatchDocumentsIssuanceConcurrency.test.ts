import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaDispatchDocumentRepository, runSerializableDispatchOperation } from '../dispatchDocuments/prismaRepository';
import { DispatchDocumentConflictError } from '../dispatchDocuments/service';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';

const countSourceEvidence = async (prisma: PrismaClient) => ({
  candidates: await prisma.accountingDispatchCandidate.count(),
  waybills: await prisma.accountingDispatchWaybill.count(),
  artifacts: await prisma.dispatchDocumentArtifact.count(),
  commands: await prisma.dispatchDocumentCommandResult.count(),
  audits: await prisma.dispatchLifecycleAudit.count(),
});

const observeTransactionErrors = (client: PrismaClient, errors: string[]) => new Proxy(client, {
  get(target, property, receiver) {
    if (property === '$transaction') return async (...args: Parameters<PrismaClient['$transaction']>) => {
      try { return await (target.$transaction as any)(...args); }
      catch (error) {
        const code = (error as { code?: string }).code;
        if (code) errors.push(code);
        throw error;
      }
    };
    return Reflect.get(target, property, receiver);
  },
}) as PrismaClient;

const run = async () => {
  const sourceDatabaseUrl = process.env.DATABASE_URL;
  assert.ok(sourceDatabaseUrl, 'DATABASE_URL must target sabalanerp-local');
  const repositoryRoot = path.resolve(process.cwd(), '..');
  const source = new PrismaClient();
  const sourceBefore = await countSourceEvidence(source);
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const firstRaw = database.client();
  const secondRaw = database.client();
  const observer = database.client();
  const firstErrors: string[] = [];
  const secondErrors: string[] = [];
  const previousGate = process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
  process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = 'true';
  try {
    const candidate = await observer.accountingDispatchCandidate.findFirstOrThrow({
      where: { status: 'PENDING', workItem: { status: 'OPEN' }, waybills: { none: {} } },
      include: { allocationRevision: { select: { finalizedAt: true } } }, orderBy: { createdAt: 'desc' },
    });
    const actor = await observer.user.findFirstOrThrow({ where: { isActive: true }, select: { id: true } });
    const manifest = await observer.shipmentStatementMigrationManifest.create({ data: {
      migrationName: `dispatch-documents-concurrency-${database.runId}`, schemaVersion: 1,
      sourceSchemaHash: createHash('sha256').update(`source-${database.runId}`).digest('hex'), createdBy: actor.id,
    } });
    await observer.shipmentStatementCutover.update({ where: { id: 'customer-shipment-statements' }, data: {
      enabled: true, cutoverAt: new Date(candidate.allocationRevision.finalizedAt.getTime() - 1_000),
      activatedAt: new Date(), activatedBy: actor.id, manifestId: manifest.id,
      integrityHash: createHash('sha256').update(`cutover-${database.runId}`).digest('hex'),
    } });
    const number = (await observer.$queryRawUnsafe<Array<{ number: bigint }>>(
      `SELECT nextval('accounting_dispatch_waybill_number_seq') AS number`))[0].number.toString();
    const waybillId = randomUUID();
    const bytes = new TextEncoder().encode(`atomic-waybill-statement-${database.runId}`);
    const byteHash = createHash('sha256').update(bytes).digest('hex');
    const issuedAt = new Date().toISOString();
    const artifacts = (['WAYBILL', 'STATEMENT'] as const).map(kind => ({
      id: randomUUID(), waybillId, kind, adjustmentSequence: null, templateVersion: 'concurrency-v1',
      generatorVersion: 'concurrency-generator-v1', sourceVersionIdentities: { allocationRevision: candidate.allocationRevisionId },
      storageKey: `dispatch-documents/${database.runId}/${kind.toLowerCase()}.pdf`, mediaType: 'application/pdf' as const,
      byteLength: bytes.byteLength, sha256: byteHash, publishedAt: issuedAt,
    }));
    const storage = { stage: async () => undefined, read: async () => bytes };
    let firstAssessment = true;
    const verifier = { assess: async () => {
      if (firstAssessment) {
        firstAssessment = false;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      return { status: 'CURRENT' as const, staleContracts: [] as [] };
    } };
    const firstClient = observeTransactionErrors(firstRaw, firstErrors);
    const secondClient = observeTransactionErrors(secondRaw, secondErrors);
    const first = new PrismaDispatchDocumentRepository(firstClient, verifier, storage);
    const second = new PrismaDispatchDocumentRepository(secondClient, verifier, storage);
    const input = { candidateId: candidate.id, allocationRevisionId: candidate.allocationRevisionId,
      expectedSourceIntegrityHash: '7'.repeat(64), waybillSnapshot: { candidateId: candidate.id },
      waybill: { id: waybillId, number, status: 'ISSUED' as const, issuedAt, replacesWaybillId: null }, artifacts,
      idempotencyKey: `same-key-${database.runId}`, actorId: actor.id,
      correlationId: `same-key-${database.runId}`, intentFingerprint: createHash('sha256').update(`same-intent-${database.runId}`).digest('hex') };

    const results = await Promise.all([first.acceptAndIssue(input), second.acceptAndIssue(input)]);
    assert.deepEqual(results[0], results[1], 'same-key concurrent issuance replays the exact durable result');
    assert.equal(await observer.accountingDispatchWaybill.count({ where: { id: waybillId } }), 1);
    assert.equal(await observer.dispatchDocumentArtifact.count({ where: { waybillId } }), 2);
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: input.idempotencyKey } }), 1);
    assert.equal(await observer.dispatchLifecycleAudit.count({ where: { aggregateId: waybillId, eventType: 'PRIMARY_BUNDLE_ISSUED' } }), 1);
    assert.deepEqual(await first.acceptAndIssue(input), results[0], 'an unknown-response retry returns the persisted result');
    await assert.rejects(() => second.acceptAndIssue({ ...input, intentFingerprint: '8'.repeat(64) }),
      DispatchDocumentConflictError, 'same scope and key with a different intent stays a conflict');
    await assert.rejects(() => second.acceptAndIssue({ ...input, idempotencyKey: `${input.idempotencyKey}-different`,
      intentFingerprint: '9'.repeat(64) }), DispatchDocumentConflictError,
    'a different key cannot claim the already issued candidate');

    const p2002Key = `p2002-${database.runId}`;
    const p2002Fingerprint = createHash('sha256').update(p2002Key).digest('hex');
    const duplicateCommandData = { scope: 'CANDIDATE' as const, scopeId: candidate.id, idempotencyKey: p2002Key,
      command: 'ACCEPT_AND_ISSUE' as const, status: 'SUCCEEDED' as const,
      result: { intentFingerprint: p2002Fingerprint, value: results[0] }, actorId: actor.id,
      correlationId: p2002Key, completedAt: new Date() };
    await firstRaw.dispatchDocumentCommandResult.create({ data: duplicateCommandData });
    const durableReader = new PrismaDispatchDocumentRepository(secondRaw, verifier, storage);
    let runnerErrorCode: string | undefined;
    const replayed = await runSerializableDispatchOperation(secondRaw, async tx => {
      try { await tx.dispatchDocumentCommandResult.create({ data: duplicateCommandData }); }
      catch (error) { runnerErrorCode = (error as { code?: string }).code; throw error; }
      return results[0];
    }, async () => await durableReader.findCommandResult({ scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: p2002Key, command: 'ACCEPT_AND_ISSUE', intentFingerprint: p2002Fingerprint }) as typeof results[0] | null);
    assert.equal(runnerErrorCode, 'P2002', 'a real Serializable transaction reaches the command-key unique violation');
    assert.deepEqual(replayed, results[0],
      'the production Serializable runner replays the exact durable result after its real P2002');
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: p2002Key } }), 1);

    console.log(JSON.stringify({ runId: database.runId, temporaryDatabase: database.databaseName,
      observedTransactionErrors: [...firstErrors, ...secondErrors], issuedWaybills: 1, issuedArtifacts: 2,
      commandResults: 1, issuanceAudits: 1 }));
  } finally {
    if (previousGate === undefined) delete process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED;
    else process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED = previousGate;
    await Promise.all([firstRaw.$disconnect(), secondRaw.$disconnect(), observer.$disconnect()]);
    await database.cleanup();
    const sourceAfter = await countSourceEvidence(source);
    assert.deepEqual(sourceAfter, sourceBefore, 'the sabalanerp-local source database remains unchanged');
    await source.$disconnect();
  }
};

run().then(() => console.log('dispatch document real P2002 issuance replay integration: ok'));
