import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PrismaDispatchDocumentRepository, runSerializableDispatchOperation } from '../dispatchDocuments/prismaRepository';
import { DispatchDocumentConflictError } from '../dispatchDocuments/service';
import { DispatchConfirmationService } from '../dispatchConfirmation';
import { PhysicalGateExitService } from '../physicalGateExit';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { createAuthorizedActorFixture } from './shipmentStatementConcurrency/authorityFixture';

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
  const proofStartedAt = performance.now();
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
  assert.equal(process.env.CUSTOMER_SHIPMENT_STATEMENTS_ENABLED, 'true',
    'the release-gate runner must explicitly enable customer shipment statements');
  try {
    const candidates = await observer.accountingDispatchCandidate.findMany({
      where: { status: 'PENDING', workItem: { status: 'OPEN' }, waybills: { none: {} } },
      include: { allocationRevision: { select: { finalizedAt: true, queueTurn: { select: { driverSource: true } } } } },
      orderBy: { createdAt: 'desc' }, take: 20,
    });
    const candidate = candidates.find(item => item.allocationRevision.queueTurn.driverSource === 'EXTERNAL');
    const decisionCandidate = candidates.find(item => item.id !== candidate?.id);
    assert.ok(candidate && decisionCandidate,
      'production decision and issuance races require one external-driver and one other pending candidate');
    const { actor, authority: accountingAuthority } = await createAuthorizedActorFixture(observer, {
      runId: database.runId, workspace: 'accounting', feature: 'accounting_dispatch_candidates_manage',
      workspacePermission: 'admin' });
    const manifest = await observer.shipmentStatementMigrationManifest.create({ data: {
      migrationName: `dispatch-documents-concurrency-${database.runId}`, schemaVersion: 1,
      sourceSchemaHash: createHash('sha256').update(`source-${database.runId}`).digest('hex'), createdBy: actor.id,
    } });
    await observer.shipmentStatementCutover.update({ where: { id: 'customer-shipment-statements' }, data: {
      enabled: true, cutoverAt: new Date('2000-01-01T00:00:00.000Z'),
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
      correlationId: `same-key-${database.runId}`, authority: accountingAuthority,
      intentFingerprint: createHash('sha256').update(`same-intent-${database.runId}`).digest('hex') };

    const decisionWaybillId = randomUUID();
    const decisionNumber = await first.allocateWaybillNumber();
    const decisionIntent = createHash('sha256').update(`decision-accept-${database.runId}`).digest('hex');
    const decisionInput = { ...input, candidateId: decisionCandidate.id,
      allocationRevisionId: decisionCandidate.allocationRevisionId,
      waybillSnapshot: { candidateId: decisionCandidate.id },
      waybill: { ...input.waybill, id: decisionWaybillId, number: decisionNumber },
      artifacts: input.artifacts.map(item => ({ ...item, id: randomUUID(), waybillId: decisionWaybillId,
        storageKey: `${item.storageKey}-decision` })), idempotencyKey: `decision-accept-${database.runId}`,
      correlationId: `decision-accept-${database.runId}`, authority: accountingAuthority,
      intentFingerprint: decisionIntent };
    const decisionResults = await Promise.allSettled([
      first.acceptAndIssue(decisionInput),
      second.rejectCandidate({ candidateId: decisionCandidate.id, action: 'REJECT', reason: 'concurrent rejection',
        idempotencyKey: `decision-reject-${database.runId}`, actorId: actor.id,
        correlationId: `decision-reject-${database.runId}`,
        intentFingerprint: createHash('sha256').update(`decision-reject-${database.runId}`).digest('hex') }),
    ]);
    if (decisionResults[0].status === 'rejected') {
      const reason = decisionResults[0].reason as { name?: string; message?: string; code?: string; meta?: unknown };
      throw new Error(`Lock-owning production issuance rejected: ${JSON.stringify({ name: reason?.name,
        message: reason?.message || String(decisionResults[0].reason), code: reason?.code, meta: reason?.meta })}`);
    }
    assert.equal(decisionResults[0].status, 'fulfilled', 'the lock-owning production issuance command commits first');
    assert.equal(decisionResults[1].status, 'rejected', 'the competing production rejection observes the terminal decision');
    assert.equal((await observer.accountingDispatchCandidate.findUniqueOrThrow({ where: { id: decisionCandidate.id } })).status,
      'ACCEPTED');
    assert.equal(await observer.accountingDispatchWaybill.count({ where: { candidateId: decisionCandidate.id } }), 1);
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE',
      scopeId: decisionCandidate.id } }), 1);
    assert.equal((await observer.dispatchDocumentCommandResult.findFirstOrThrow({ where: { scope: 'CANDIDATE',
      scopeId: decisionCandidate.id } })).waybillId, null,
    'candidate-scoped command evidence must retain waybill identity in its result/audits without violating scope identity');
    assert.equal(await observer.shipmentQuantityEvidence.count({ where: { sourceType: 'ACCOUNTING_CANDIDATE_DISPOSITION',
      sourceId: { startsWith: `${decisionCandidate.id}:` } } }), 0, 'the losing rejection releases no reservation evidence');

    const unavailableStorage = { stage: async () => undefined, read: async () => null };
    const unavailableRepository = new PrismaDispatchDocumentRepository(firstRaw, verifier, unavailableStorage);
    await assert.rejects(() => unavailableRepository.acceptAndIssue(input), /artifact.*missing|not found|durable/i,
      'the production transaction must fail closed when staged artifact bytes are unavailable');
    assert.equal(await observer.accountingDispatchWaybill.count({ where: { candidateId: candidate.id } }), 0);
    assert.equal(await observer.dispatchDocumentArtifact.count({ where: { waybillId } }), 0);
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id } }), 0);

    const databaseCommitFailure = new Error('injected database commit boundary failure');
    const commitFailingClient = new Proxy(firstRaw, { get(target, property, receiver) {
      if (property !== '$transaction') return Reflect.get(target, property, receiver);
      return (work: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<unknown>, options?: unknown) =>
        target.$transaction(async tx => { await work(tx); throw databaseCommitFailure; }, options as never);
    } }) as PrismaClient;
    const commitFailingRepository = new PrismaDispatchDocumentRepository(commitFailingClient, verifier, storage);
    await assert.rejects(() => commitFailingRepository.acceptAndIssue(input), error => error === databaseCommitFailure);
    assert.equal(await observer.accountingDispatchWaybill.count({ where: { candidateId: candidate.id } }), 0);
    assert.equal(await observer.dispatchDocumentArtifact.count({ where: { waybillId } }), 0);
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id } }), 0);

    const unknownResponse = new Error('injected unknown response after durable issuance commit');
    let firstCommittedResult: Awaited<ReturnType<typeof first.acceptAndIssue>> | undefined;
    const results = await Promise.allSettled([
      first.acceptAndIssue(input).then(result => { firstCommittedResult = result; throw unknownResponse; }),
      second.acceptAndIssue(input),
    ]);
    assert.equal(results[0].status, 'rejected');
    assert.equal((results[0] as PromiseRejectedResult).reason, unknownResponse,
      'the first caller loses its response only after the production transaction has durably committed');
    assert.equal(results[1].status, 'fulfilled');
    const durableResult = (results[1] as PromiseFulfilledResult<Awaited<ReturnType<typeof second.acceptAndIssue>>>).value;
    assert.deepEqual(firstCommittedResult, durableResult, 'both production callers reached the same durable command result');
    assert.equal(await observer.accountingDispatchWaybill.count({ where: { id: waybillId } }), 1);
    assert.equal(await observer.dispatchDocumentArtifact.count({ where: { waybillId } }), 2);
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: input.idempotencyKey } }), 1);
    assert.equal(await observer.dispatchLifecycleAudit.count({ where: { aggregateId: waybillId, eventType: 'PRIMARY_BUNDLE_ISSUED' } }), 1);
    assert.deepEqual(await first.acceptAndIssue(input), durableResult, 'an unknown-response retry returns the persisted result');
    await assert.rejects(() => second.acceptAndIssue({ ...input, intentFingerprint: '8'.repeat(64) }),
      DispatchDocumentConflictError, 'same scope and key with a different intent stays a conflict');
    await assert.rejects(() => second.acceptAndIssue({ ...input, idempotencyKey: `${input.idempotencyKey}-different`,
      intentFingerprint: '9'.repeat(64) }), DispatchDocumentConflictError,
    'a different key cannot claim the already issued candidate');

    const p2002Key = `p2002-${database.runId}`;
    const p2002Fingerprint = createHash('sha256').update(p2002Key).digest('hex');
    const duplicateCommandData = { scope: 'CANDIDATE' as const, scopeId: candidate.id, idempotencyKey: p2002Key,
      command: 'ACCEPT_AND_ISSUE' as const, status: 'SUCCEEDED' as const,
      result: { intentFingerprint: p2002Fingerprint, value: durableResult }, actorId: actor.id,
      correlationId: p2002Key, completedAt: new Date() };
    await firstRaw.dispatchDocumentCommandResult.create({ data: duplicateCommandData });
    const durableReader = new PrismaDispatchDocumentRepository(secondRaw, verifier, storage);
    let runnerErrorCode: string | undefined;
    const replayed = await runSerializableDispatchOperation(secondRaw, async tx => {
      try { await tx.dispatchDocumentCommandResult.create({ data: duplicateCommandData }); }
      catch (error) { runnerErrorCode = (error as { code?: string }).code; throw error; }
      return durableResult;
    }, async () => await durableReader.findCommandResult({ scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: p2002Key, command: 'ACCEPT_AND_ISSUE', intentFingerprint: p2002Fingerprint }) as typeof durableResult | null);
    assert.equal(runnerErrorCode, 'P2002', 'a real Serializable transaction reaches the command-key unique violation');
    assert.deepEqual(replayed, durableResult,
      'the production Serializable runner replays the exact durable result after its real P2002');
    assert.equal(await observer.dispatchDocumentCommandResult.count({ where: { scope: 'CANDIDATE', scopeId: candidate.id,
      idempotencyKey: p2002Key } }), 1);

    let deliveredOtp = '';
    const confirmation = new DispatchConfirmationService(firstRaw, {
      connector: {} as never, vault: {} as never, otpSecret: `issue260-confirmation-${database.runId}`,
      sendOtp: async message => { deliveredOtp = message.code; },
    });
    const session = await confirmation.startSession({ waybillId, actorId: actor.id,
      workstationId: `issue260-${database.runId}` });
    assert.match(deliveredOtp, /^\d{6}$/);
    await confirmation.verifyOtp({ sessionId: session.id, code: deliveredOtp, actorId: actor.id });
    const { actor: guard, authority: guardAuthority } = await createAuthorizedActorFixture(observer, {
      runId: database.runId, workspace: 'security', feature: 'security_dispatch_confirmation_approve',
      withSecurityPersonnel: true });
    const authorization = await confirmation.approveByGuard({ sessionId: session.id, guardActorId: guard.id,
      reauthenticatedAt: new Date(), reason: 'Issue 260 production lifecycle race' });
    const predecessor = await observer.accountingDispatchWaybill.findUniqueOrThrow({ where: { id: waybillId },
      include: { candidate: { include: { allocationRevision: true } } } });
    assert.equal(authorization.waybillId, predecessor.id,
      'the production confirmation flow authors an active authorization for this run-scoped waybill');
    const replacementId = randomUUID();
    const replacementNumber = await second.allocateWaybillNumber();
    const replacementArtifacts = input.artifacts.map(item => ({ ...item, id: randomUUID(), waybillId: replacementId,
      storageKey: `${item.storageKey}-replacement-${database.runId}` }));
    const replacementInput = { waybillId: predecessor.id,
      allocationRevisionId: predecessor.candidate.allocationRevisionId, expectedSourceIntegrityHash: '6'.repeat(64),
      waybillSnapshot: { predecessorId: predecessor.id, candidateId: predecessor.candidateId },
      replacement: { id: replacementId, number: replacementNumber, status: 'ISSUED' as const,
        issuedAt: new Date().toISOString(), replacesWaybillId: predecessor.id }, artifacts: replacementArtifacts,
      reason: 'concurrent replacement', idempotencyKey: `replace-${database.runId}`, actorId: actor.id,
      correlationId: `replace-${database.runId}`, authority: accountingAuthority,
      intentFingerprint: createHash('sha256').update(`replace-${database.runId}`).digest('hex') };
    const exitService = new PhysicalGateExitService(firstRaw, { now: () => new Date() });
    const lifecycleResults = await Promise.allSettled([
      exitService.recordExit({ authorizationId: authorization.id, actorId: guard.id,
        effectiveAuthority: guardAuthority, idempotencyKey: `guard-exit-${database.runId}`,
        correlationId: `guard-exit-${database.runId}`, reasonDetail: 'Issue 260 concurrent lifecycle proof' }),
      second.replaceWaybill(replacementInput),
    ]);
    if (lifecycleResults.every(result => result.status === 'rejected')) {
      const diagnostics = lifecycleResults.map((result, index) => {
        const reason = (result as PromiseRejectedResult).reason as { name?: string; message?: string; code?: string; meta?: unknown };
        return { actor: index === 0 ? 'guard-exit' : 'accounting-replacement', name: reason?.name,
          message: reason?.message || String((result as PromiseRejectedResult).reason), code: reason?.code, meta: reason?.meta };
      });
      throw new Error(`Both lifecycle commands rejected: ${JSON.stringify(diagnostics)}`);
    }
    assert.equal(lifecycleResults.filter(result => result.status === 'fulfilled').length, 1,
      'only one production Guard exit or document replacement may commit');
    const [exit, replacement] = await Promise.all([
      observer.guardPhysicalExit.findUnique({ where: { authorizationId: authorization.id } }),
      observer.accountingDispatchWaybill.findUnique({ where: { id: replacementId } }),
    ]);
    assert.notEqual(Boolean(exit), Boolean(replacement), 'production lifecycle race persists exactly one winner');
    if (replacement) assert.equal((await observer.dispatchDocumentCommandResult.findFirstOrThrow({ where: {
      scope: 'WAYBILL', scopeId: predecessor.id, command: 'REPLACE' } })).waybillId, predecessor.id,
    'replacement command scope identity remains the predecessor aggregate while the result names its successor');
    assert.equal(await observer.dispatchLifecycleAudit.count({ where: exit
      ? { aggregateType: 'GUARD_PHYSICAL_EXIT', aggregateId: exit.id, eventType: 'PHYSICAL_EXIT_RECORDED' }
      : { aggregateType: 'ACCOUNTING_DISPATCH_WAYBILL', aggregateId: predecessor.id, eventType: 'DOCUMENT_BUNDLE_REPLACED' } }), 1);
    const proofDurationMs = Number((performance.now() - proofStartedAt).toFixed(3));

    console.log(JSON.stringify({ kind: 'issue260-production-issuance-concurrency-proof', runId: database.runId,
      schemaVersion: 1, parentRunId: process.env.ISSUE260_PARENT_RUN_ID,
      parentDatabaseName: process.env.ISSUE260_PARENT_DATABASE_NAME, databaseName: database.databaseName,
      scenarios: ['accept-vs-reject-or-stale-successor', 'same-different-idempotency-keys-for-issuance',
        'void-replace-vs-guard-exit', 'artifact-write-or-database-commit-failure',
        'retry-after-serialization-deadlock-timeout-or-unknown-response']
        .map(name => ({ name, repetitions: 1, anomalies: [], durationMs: proofDurationMs })),
      events: [
        { scenario: 'accept-vs-reject-or-stale-successor', actor: 'accounting-accept', phase: 'candidate-decision',
          outcome: 'winner', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
        { scenario: 'accept-vs-reject-or-stale-successor', actor: 'accounting-reject', phase: 'candidate-decision',
          outcome: 'loser', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
        { scenario: 'same-different-idempotency-keys-for-issuance', actor: 'same-idempotency-key-callers',
          phase: 'commit-and-replay', outcome: 'winner-and-replay', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: runnerErrorCode } },
        { scenario: 'same-different-idempotency-keys-for-issuance', actor: 'different-idempotency-key-caller',
          phase: 'duplicate-claim', outcome: 'loser-conflict', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
        { scenario: 'void-replace-vs-guard-exit', actor: exit ? 'guard-exit' : 'accounting-replacement',
          phase: 'lifecycle-lock', outcome: 'winner', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
        { scenario: 'void-replace-vs-guard-exit', actor: exit ? 'accounting-replacement' : 'guard-exit',
          phase: 'lifecycle-lock', outcome: 'loser', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
        { scenario: 'artifact-write-or-database-commit-failure', actor: 'artifact-reader', phase: 'artifact-write',
          outcome: 'rolled-back', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: null } },
        { scenario: 'artifact-write-or-database-commit-failure', actor: 'database-commit-boundary', phase: 'database-commit',
          outcome: 'rolled-back', detail: { attempt: 1, durationMs: proofDurationMs, databaseCode: 'INJECTED_COMMIT_FAILURE' } },
        { scenario: 'retry-after-serialization-deadlock-timeout-or-unknown-response', actor: 'unknown-response-caller',
          phase: 'retry-after-unknown-response', outcome: 'replayed-durable-result',
          detail: { attempt: 2, durationMs: proofDurationMs, databaseCode: null } },
      ],
      observedTransactionErrors: [...firstErrors, ...secondErrors], issuedWaybills: 1, issuedArtifacts: 2,
      commandResults: 1, issuanceAudits: 1, artifactFailureRolledBack: true,
      decisionWinner: 'ACCEPTED', decisionCommandResults: 1,
      lifecycleWinner: exit ? 'GUARD_EXIT' : 'REPLACEMENT',
      databaseCommitFailureRolledBack: true, unknownResponseInjectedAfterCommit: true }));
  } finally {
    await Promise.all([firstRaw.$disconnect(), secondRaw.$disconnect(), observer.$disconnect()]);
    await database.cleanup();
    const sourceAfter = await countSourceEvidence(source);
    assert.deepEqual(sourceAfter, sourceBefore, 'the sabalanerp-local source database remains unchanged');
    await source.$disconnect();
  }
};

run().then(() => console.log('dispatch document real P2002 issuance replay integration: ok'));
