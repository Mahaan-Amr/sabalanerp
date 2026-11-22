import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { RuntimeWorkBoundary } from '../../backend/src/services/runtimeWorkBoundary';
import type { VersionedFilePublication } from '../../backend/src/services/versionedFilePublication';
import { performanceExportStorageDirectory } from '../../backend/src/services/performanceFileRuntime';
import { claimPerformanceExportDownload, completePerformanceExportDownload, cleanupExpiredPerformanceExports } from '../../backend/src/services/personnelPerformanceDisclosureStore';
import { readPerformancePayload, persistPerformancePayload, performanceVaultKeyFromEnvironment } from '../../backend/src/services/personnelPerformancePayloadStore';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../../backend/src/services/personnelPerformanceRetention';
import { placePerformanceLegalHold } from '../../backend/src/services/personnelPerformanceLegalHoldStore';
import { qualifyPerformanceExport, type PerformanceExportQualification } from './performance-export-native.fixture';

type CleanupCase = { mode: string; source: PerformanceExportQualification; logicalDeleted: boolean; liveDeleted: boolean;
  completionRecorded: boolean; headVersionSha256: string; planPayloadId: string | null; planHash: string | null;
  completionPayloadId: string | null; holdId: string | null; attemptStatus: string; attemptFailureCode: string | null; cleanupRows: number };
export type PerformanceCleanupQualification = { format: 'sabalan-native-performance-cleanup/v1'; cases: CleanupCase[];
  transactionClientRefusedBeforeMutation: true; periodicJobsCleanupExercised: true };
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
/** Explicit synthetic policy publication, never owner approval/release proof.
 * Same encrypted preview/publication shape as the existing local integration
 * fixture, scoped to this verified isolated native database only. */
async function seedRetention(db: PrismaClient, actorUserId: string, replaceActive = false) {
  const [{ name }] = await db.$queryRaw<Array<{ name: string }>>`SELECT current_database()::text AS name`;
  assert.match(name, /^qa_[a-z_]+_[a-f0-9]{32}$/);
  const phase = await db.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
  if (!phase?.releaseEnabled || phase.phase !== 'EXPANSION_RETIREMENT' || phase.effectiveFrom > new Date()) {
    const [{ now }] = await db.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
    await db.performanceFeaturePhaseVersion.create({ data: { version: (phase?.version ?? 0) + 1,
      predecessorId: phase?.id, phase: 'EXPANSION_RETIREMENT', releaseEnabled: true, effectiveFrom: now,
      recordedByUserId: actorUserId, reason: 'Private isolated native fixture; never release acceptance or owner approval' } });
  }
  if (!replaceActive && await db.performancePolicyVersion.findFirst({ where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE' } })) return;
  await db.$transaction(async tx => {
    // The canonical version guard compares activation with CURRENT_TIMESTAMP,
    // the start of THIS transaction. A later wall clock cannot activate here.
    const [{ now: policyNow }] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT transaction_timestamp() AS now`;
    const id = randomUUID(), previewId = randomUUID(), at = replaceActive ? policyNow : new Date(policyNow.getTime() - 10_000);
    const latest = await tx.performancePolicyVersion.findFirst({ where: { policyKind: 'RETENTION' }, orderBy: { version: 'desc' } });
    const payload = await persistPerformancePayload(tx, { aggregateType: 'POLICY_VERSION', aggregateId: id,
      payloadKind: 'POLICY_CONTENT_REVISION_1', schemaVersion: 1, payload: PERFORMANCE_RETENTION_SCHEDULE_V1, keyring: performanceVaultKeyFromEnvironment() });
    await tx.performancePolicyVersion.create({ data: { id, policyKind: 'RETENTION', version: (latest?.version ?? 0) + 1,
      predecessorId: latest?.id, contentHash: payload.contentHash, encryptedPayloadId: payload.id, createdByUserId: actorUserId } });
    const preview = await persistPerformancePayload(tx, { aggregateType: 'POLICY_ACTIVATION_PREVIEW', aggregateId: previewId,
      payloadKind: 'POPULATION_RESULT', schemaVersion: 1, payload: { testFixture: true, population: [] }, keyring: performanceVaultKeyFromEnvironment() });
    await tx.performancePolicyActivationPreview.create({ data: { id: previewId, policyVersionId: id, policyContentHash: payload.contentHash,
      populationHash: preview.contentHash, encryptedPayloadId: preview.id, eligibleSubjectCount: 0, evaluatedSubjectCount: 0,
      increasedCount: 0, decreasedCount: 0, unchangedCount: 0, expiredCount: 0, needsNewEvaluationCount: 0, errorCount: 0,
      resultHash: preview.contentHash, generatedAt: at, confirmedAt: at, confirmedByUserId: actorUserId } });
    await tx.performancePolicyVersion.update({ where: { id }, data: { lifecycle: 'SCHEDULED', effectiveFrom: at,
      publicationReason: 'Private isolated native cleanup fixture', publishedByUserId: actorUserId, publishedAt: at,
      activationPreviewId: previewId, activationPreviewHash: preview.contentHash, activationConfirmedAt: at } });
    if (replaceActive) await tx.performancePolicyVersion.updateMany({ where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE' }, data: { lifecycle: 'RETIRED' } });
    await tx.performancePolicyVersion.update({ where: { id }, data: { lifecycle: 'ACTIVE' } });
  });
}
function faultAtTransaction(db: PrismaClient, phase: number, kind: 'rollback' | 'lost-ack', afterCommit?: () => Promise<void>) {
  const original = db.$transaction.bind(db); let transactions = 0, injected = false, setupFailed = false, setupError: unknown;
  const proxy = new Proxy(db, { get(target, property) {
    if (property !== '$transaction') return Reflect.get(target, property, target);
    return async (body: (tx: unknown) => Promise<unknown>, options: unknown) => {
      const current = ++transactions;
      const result = await (original as any)(async (tx: unknown) => {
        const value = await body(tx);
        if (current === phase && kind === 'rollback') { injected = true; throw Error('PRIVATE_PERFORMANCE_SQL_ROLLBACK'); }
        return value;
      }, options);
      if (current === phase && kind === 'lost-ack') {
        if (afterCommit) {
          try { await afterCommit(); }
          catch (error) { setupFailed = true; setupError = error; throw error; }
        }
        injected = true; throw Error('PRIVATE_PERFORMANCE_COMMIT_ACK_LOST');
      }
      return result;
    };
  } });
  return { db: proxy, wasInjected: () => injected, assertInjected(mode: string) {
    // Runtime outcome resolution may correctly recover from this callback's
    // error. A failed test setup is not an injected lost acknowledgement.
    if (setupFailed) throw setupError;
    assert.equal(injected, true, `Performance cleanup fault was not injected: ${mode}`);
  } };
}

/** RED/GREEN probe works against the prior public processor/completion APIs.
 * The decisive assertion is the original live PUT after actual SQL rollback,
 * before inspecting any newly introduced journal shape. */
export async function qualifyPerformanceCleanupRollback(input: {
  db: PrismaClient; boundary: RuntimeWorkBoundary; publication: VersionedFilePublication; actorUserId: string;
}) {
  await input.boundary.runBackground(() => seedRetention(input.db, input.actorUserId));
  const source = await qualifyPerformanceExport(input);
  return input.boundary.runBackground(async () => {
    await input.db.performanceExportReceipt.update({ where: { id: source.exportId }, data: { status: 'DELIVERING' } });
    const fault = faultAtTransaction(input.db, 2, 'rollback');
    await assert.rejects(completePerformanceExportDownload(fault.db, { exportId: source.exportId,
      actorUserId: input.actorUserId, delivered: true }), /PRIVATE_PERFORMANCE_SQL_ROLLBACK/);
    fault.assertInjected('download-phase-a-rollback');
    const files = await input.publication.bindRoot(performanceExportStorageDirectory());
    const head = await files.inspect(source.fileName);
    assert.ok(head);
    assert.equal(head?.operation, 'PUT', 'SQL rollback must preserve the original live file publication');
    assert.equal(head.versionSha256, source.versionSha256);
    assert.equal(sha(await fs.readFile(source.sourceArtifactPath)), source.cipherSha256);
    const row = await input.db.performanceExportReceipt.findUniqueOrThrow({ where: { id: source.exportId } });
    assert.equal(row.status, 'DOWNLOADED'); assert.equal(row.artifactPath, source.sourceArtifactPath);
    assert.equal(row.encryptedPayloadId, source.encryptedPayloadId);
    return { actualSqlRollbackPreservedOriginalPerformancePut: true, source };
  });
}

export async function qualifyPerformanceMaintenanceHttpDenial(input: { db: PrismaClient; boundary: RuntimeWorkBoundary }) {
  await input.boundary.context.run(async () => {
    await assert.rejects(cleanupExpiredPerformanceExports(input.db), /WORKER_OWNERSHIP_REQUIRED/);
  });
  return { nativeHttpPerformanceMaintenanceDeniedBeforeSql: true };
}

/** Same actual processor, singleton SQL and native jobs publication as the
 * coherent cut. Faults wrap real Prisma transactions; no simulated SQL commit.
 * Keep all original rows/ciphertext/version plans for actual restored checks. */
export async function qualifyPerformanceCleanup(input: {
  db: PrismaClient; boundary: RuntimeWorkBoundary; publication: VersionedFilePublication; actorUserId: string;
}): Promise<PerformanceCleanupQualification> {
  const { db, boundary, publication, actorUserId } = input;
  const root = performanceExportStorageDirectory(), files = await publication.bindRoot(root), cases: CleanupCase[] = [];
  assert.ok(publication.ownsRoot(root) && publication.ownsWork(boundary.context));
  await boundary.runBackground(async () => {
    await seedRetention(db, actorUserId);
    // Refuse an externally owned transaction before audit/attempt/receipt SQL
    // mutation, rather than deleting files before an unknown outer COMMIT.
    const beforeAttempts = await db.performanceExportCleanupAttempt.count(), beforeAudits = await db.performanceAuditEvent.count();
    await db.$transaction(async tx => {
      await assert.rejects(cleanupExpiredPerformanceExports(tx), { code: 'PERFORMANCE_CLEANUP_TRANSACTION_REQUIRED' });
    });
    assert.equal(await db.performanceExportCleanupAttempt.count(), beforeAttempts);
    assert.equal(await db.performanceAuditEvent.count(), beforeAudits);

    for (const mode of ['periodic-normal', 'phase-a-rollback', 'phase-a-lost-ack', 'phase-b-lost-ack', 'hold-between-phases', 'phase-b-rollback', 'policy-between-phases']) {
      const source = await qualifyPerformanceExport(input);
      let holdId: string | null = null;
      if (mode === 'periodic-normal') {
        const cutoff = new Date(Date.now() + 2 * 60_000);
        await db.performanceExportReceipt.update({ where: { id: source.exportId }, data: { expiresAt: new Date(cutoff.getTime() - 1) } });
        assert.equal(await cleanupExpiredPerformanceExports(db, cutoff), 1);
      } else {
        // qualifyPerformanceExport already exercised the real download token,
        // permissions and ciphertext claim and reset an aborted delivery. The
        // actual completion callback now sees a successfully delivering row.
        await db.performanceExportReceipt.update({ where: { id: source.exportId }, data: { status: 'DELIVERING' } });
        // Transaction 1 is the existing DOWNLOADED audit; 2 and 3 are A and B.
        const phase = mode.startsWith('phase-a') || mode === 'hold-between-phases' || mode === 'policy-between-phases' ? 2 : 3;
        const fault = faultAtTransaction(db, phase, mode.endsWith('rollback') ? 'rollback' : 'lost-ack',
          mode === 'hold-between-phases' ? async () => {
            const hold = await placePerformanceLegalHold(db, { actorUserId, aggregateType: 'PERFORMANCE_EXPORT',
              aggregateId: source.exportId, reasonCode: 'NATIVE_CLEANUP_HOLD_AFTER_LOGICAL_COMMIT' });
            holdId = hold.id;
          } : mode === 'policy-between-phases' ? async () => {
            await seedRetention(db, actorUserId, true);
            const active = await db.performancePolicyVersion.findFirstOrThrow({ where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE' } });
            assert.notEqual(active.id, source.sourcePolicyId, 'The phase-B policy check must see a genuinely different committed active policy');
            assert.equal((await db.performancePolicyVersion.findUniqueOrThrow({ where: { id: source.sourcePolicyId } })).lifecycle, 'RETIRED');
          } : undefined);
        const work = () => completePerformanceExportDownload(fault.db, { exportId: source.exportId, actorUserId, delivered: true });
        if (mode === 'phase-a-rollback') await assert.rejects(work(), /PRIVATE_PERFORMANCE_SQL_ROLLBACK/);
        else if (mode === 'phase-b-rollback') await assert.rejects(work(), { code: 'PERFORMANCE_CLEANUP_OUTCOME_UNRESOLVED' });
        else await work();
        fault.assertInjected(mode);
      }
      const row = await db.performanceExportReceipt.findUniqueOrThrow({ where: { id: source.exportId } });
      const attempt = await db.performanceExportCleanupAttempt.findUniqueOrThrow({ where: { exportId: source.exportId } });
      const planned = await db.performanceAuditEvent.findMany({ where: { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: source.exportId,
        eventType: 'PERFORMANCE_EXPORT_REMOVAL_PLANNED' } });
      const completed = await db.performanceAuditEvent.findMany({ where: { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: source.exportId,
        eventType: 'PERFORMANCE_EXPORT_CLEANED_UP' } });
      const logicalDeleted = mode !== 'phase-a-rollback', liveDeleted = logicalDeleted && mode !== 'hold-between-phases' && mode !== 'policy-between-phases';
      const completionRecorded = liveDeleted && mode !== 'phase-b-rollback';
      assert.equal(row.status, logicalDeleted ? 'DELETED' : 'DOWNLOADED');
      assert.equal(row.artifactPath, logicalDeleted ? null : source.sourceArtifactPath);
      assert.equal(row.encryptedPayloadId, logicalDeleted ? null : source.encryptedPayloadId);
      assert.equal(planned.length, logicalDeleted ? 1 : 0); assert.equal(completed.length, completionRecorded ? 1 : 0);
      assert.equal(attempt.status, completionRecorded ? 'LIVE_DELETED_PENDING_BACKUP' : logicalDeleted ? 'RETRY_REQUIRED' : 'PENDING');
      assert.equal(attempt.lastFailureCode, logicalDeleted && !completionRecorded ? 'PERFORMANCE_CLEANUP_LOGICAL_REMOVAL_FILES_PENDING' : null);
      const head = await files.inspect(source.fileName); assert.ok(head);
      assert.equal(head.operation, liveDeleted ? 'DELETE' : 'PUT');
      if (!liveDeleted) { assert.equal(head.versionSha256, source.versionSha256); assert.equal(sha(await fs.readFile(source.sourceArtifactPath)), source.cipherSha256); }
      else await assert.rejects(fs.readFile(source.sourceArtifactPath), { code: 'ENOENT' });
      const retained = await files.readVersion(source.fileName, source.versionSha256); assert.ok(retained); assert.equal(sha(retained), source.cipherSha256);
      let planHash: string | null = null;
      if (logicalDeleted) {
        const encrypted = await db.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: planned[0].encryptedPayloadId! } }); planHash = encrypted.plaintextHash;
        const plan = await readPerformancePayload<any>(db, encrypted.id, performanceVaultKeyFromEnvironment());
        assert.equal(plan.format, 'sabalan-performance-cleanup/v1'); assert.match(plan.operationNonce, /^[a-f0-9-]{36}$/);
        assert.equal(plan.exportId, source.exportId); assert.equal(plan.attemptId, attempt.id);
        assert.equal(plan.policyVersionId, source.sourcePolicyId); assert.equal(attempt.policyVersionId, source.sourcePolicyId);
        assert.equal(plan.sources.length, 1); assert.equal(plan.sources[0].versionSha256, source.versionSha256);
        assert.equal(plan.sources[0].sha256, source.cipherSha256); assert.equal(plan.sources[0].bytes, source.cipherBytes);
        if (completed.length) {
          const completion = await readPerformancePayload<any>(db, completed[0].encryptedPayloadId!, performanceVaultKeyFromEnvironment());
          assert.equal(completion.operationNonce, plan.operationNonce); assert.equal(completion.planPayloadId, encrypted.id);
          assert.equal(completion.planHash, planHash); assert.equal(completion.files[0].deletionVersionSha256, head.versionSha256);
          assert.equal(completion.physicalErasure, 'UNPROVEN_RETAINED_COPIES_PENDING');
        }
      }
      cases.push({ mode, source, logicalDeleted, liveDeleted, completionRecorded, headVersionSha256: head.versionSha256,
        planPayloadId: planned[0]?.encryptedPayloadId ?? null, planHash, completionPayloadId: completed[0]?.encryptedPayloadId ?? null,
        holdId, attemptStatus: attempt.status, attemptFailureCode: attempt.lastFailureCode, cleanupRows: completed.length });
    }
    // A successor completion callback cannot use prior actor nonces or
    // manufacture completion after rollback/new legal hold.
    const pending = cases.filter(value => value.logicalDeleted && !value.completionRecorded);
    const snapshots = await Promise.all(pending.map(value => files.inspect(value.source.fileName)));
    for (let i = 0; i < pending.length; i++) {
      await completePerformanceExportDownload(db, { exportId: pending[i].source.exportId, actorUserId, delivered: true });
      assert.deepEqual(await files.inspect(pending[i].source.fileName), snapshots[i]);
      assert.equal(await db.performanceAuditEvent.count({ where: { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: pending[i].source.exportId,
        eventType: 'PERFORMANCE_EXPORT_CLEANED_UP' } }), 0);
    }
  });
  return { format: 'sabalan-native-performance-cleanup/v1', cases, transactionClientRefusedBeforeMutation: true, periodicJobsCleanupExercised: true };
}

export async function verifyRestoredPerformanceCleanup(input: { db: PrismaClient; qualification: PerformanceCleanupQualification }) {
  const { db, qualification } = input; assert.equal(qualification.format, 'sabalan-native-performance-cleanup/v1'); assert.equal(qualification.cases.length, 7);
  for (const value of qualification.cases) {
    const receipt = await db.performanceExportReceipt.findUniqueOrThrow({ where: { id: value.source.exportId } });
    assert.equal(receipt.status, value.logicalDeleted ? 'DELETED' : 'DOWNLOADED');
    assert.equal(receipt.artifactPath, value.logicalDeleted ? null : value.source.sourceArtifactPath);
    assert.equal(receipt.encryptedPayloadId, value.logicalDeleted ? null : value.source.encryptedPayloadId);
    const attempt = await db.performanceExportCleanupAttempt.findUniqueOrThrow({ where: { exportId: receipt.id } }); assert.equal(attempt.status, value.attemptStatus);
    assert.equal(attempt.lastFailureCode, value.attemptFailureCode);
    assert.equal(await db.performanceAuditEvent.count({ where: { aggregateType: 'PERFORMANCE_EXPORT', aggregateId: receipt.id,
      eventType: 'PERFORMANCE_EXPORT_CLEANED_UP' } }), value.cleanupRows);
    const target = path.join(performanceExportStorageDirectory(), value.source.fileName); assert.notEqual(target, value.source.sourceArtifactPath);
    if (value.liveDeleted) await assert.rejects(fs.readFile(target), { code: 'ENOENT' });
    else assert.equal(sha(await fs.readFile(target)), value.source.cipherSha256);
    if (value.planPayloadId) {
      const payload = await db.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: value.planPayloadId } }); assert.equal(payload.plaintextHash, value.planHash);
      const plan = await readPerformancePayload<any>(db, payload.id, performanceVaultKeyFromEnvironment());
      assert.equal(plan.exportId, receipt.id); assert.equal(plan.policyVersionId, value.source.sourcePolicyId);
      assert.equal(plan.sources[0].versionSha256, value.source.versionSha256);
      assert.equal(plan.sources[0].sha256, value.source.cipherSha256);
    }
    if (value.completionPayloadId) {
      const completed = await readPerformancePayload<any>(db, value.completionPayloadId, performanceVaultKeyFromEnvironment());
      assert.equal(completed.planPayloadId, value.planPayloadId); assert.equal(completed.planHash, value.planHash);
      assert.equal(completed.files[0].deletionVersionSha256, value.headVersionSha256); assert.equal(completed.physicalErasure, 'UNPROVEN_RETAINED_COPIES_PENDING');
    }
    if (value.holdId) assert.equal((await db.performanceLegalHold.findUniqueOrThrow({ where: { id: value.holdId } })).status, 'ACTIVE');
    if (value.mode === 'policy-between-phases') {
      const active = await db.performancePolicyVersion.findFirstOrThrow({ where: { policyKind: 'RETENTION', lifecycle: 'ACTIVE' } });
      assert.notEqual(active.id, value.source.sourcePolicyId);
      assert.equal(attempt.policyVersionId, value.source.sourcePolicyId);
      assert.equal((await db.performancePolicyVersion.findUniqueOrThrow({ where: { id: value.source.sourcePolicyId } })).lifecycle, 'RETIRED');
    }
  }
  return { actualPerformanceCleanupSqlPlansLiveInodesRestored: true, cases: qualification.cases.length, retainedCopyPhysicalErasureQualified: false };
}
