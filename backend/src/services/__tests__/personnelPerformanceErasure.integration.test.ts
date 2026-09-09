import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';
import { performanceVaultKeyFromEnvironment, persistPerformancePayload } from '../personnelPerformancePayloadStore';
import { assessPerformanceEvaluationRetention } from '../personnelPerformanceRetentionStore';
import { placePerformanceLegalHold } from '../personnelPerformanceLegalHoldStore';
import {
  approvePerformanceBulkErasure,
  approvePerformanceErasureImpact,
  executePerformanceErasureOperation,
  preparePerformanceErasureOperations,
  recordPerformanceRecoverableCopy,
  replayPerformanceErasureAfterRestore,
} from '../personnelPerformanceErasureStore';
import { enablePerformanceTestRelease, publishPerformanceTestRetentionPolicy } from './personnelPerformanceTestRelease';

const rollback = Symbol('rollback-performance-erasure');
const main = async () => {
  try {
    await prisma.$transaction(async (tx) => {
      const suffix = randomUUID();
      const actorPersonnel = await tx.personnel.create({ data: { firstName: 'عامل', lastName: 'حذف' } });
      const actor = await tx.user.create({ data: { email: `${suffix}@example.invalid`, username: suffix, password: 'not-used',
        firstName: 'عامل', lastName: 'حذف', personnelId: actorPersonnel.id } });
      await enablePerformanceTestRelease(tx, actor.id);
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:retention`, userId: actor.id,
        featureCode: 'MANAGE_PERFORMANCE_RETENTION', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
        grantedByUserId: actor.id, reason: 'Isolated erasure acceptance' } });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:legal-hold`, userId: actor.id,
        featureCode: 'PLACE_PERFORMANCE_LEGAL_HOLD', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
        grantedByUserId: actor.id, reason: 'Erasure and legal-hold race acceptance' } });
      const secondApprover = await tx.user.create({ data: { email: `${suffix}-second@example.invalid`, username: `${suffix}-second`,
        password: 'not-used', firstName: 'عامل', lastName: 'دوم' } });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:retention:second`, userId: secondApprover.id,
        featureCode: 'MANAGE_PERFORMANCE_RETENTION', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
        grantedByUserId: actor.id, reason: 'Independent bulk erasure approval' } });
      const personnel = await tx.personnel.create({ data: { firstName: 'موضوع', lastName: 'حذف' } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ENDED',
        effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2011-01-01Z'), createdBy: actor.id } });
      const assignment = await tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: relationship.id, type: 'PRIMARY',
        effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2011-01-01Z'), performanceAllocationPercent: 100, createdBy: actor.id } });
      const subject = await tx.performanceSubject.create({ data: { stableKey: `${suffix}:subject`, nonDisplayKey: `${suffix}:hidden`,
        personnelId: personnel.id, employmentRelationshipId: relationship.id, createdByUserId: actor.id } });
      const evaluation = await tx.performanceEvaluation.create({ data: { stableKey: `${suffix}:evaluation`, subjectId: subject.id,
        measurementFrom: new Date('2010-01-01Z'), measurementTo: new Date('2010-12-31Z'), createdByUserId: actor.id } });
      const section = await tx.performanceEvaluationSection.create({ data: { evaluationId: evaluation.id,
        employmentAssignmentId: assignment.id, responsibleSupervisorPersonnelId: actorPersonnel.id,
        effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2010-12-31Z'), allocationPercent: 100 } });
      const draftId = randomUUID();
      const draftPayload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_DRAFT', aggregateId: draftId,
        payloadKind: 'DRAFT_CONTENT', schemaVersion: 1, payload: { narrative: 'must be physically erased' }, keyring: performanceVaultKeyFromEnvironment() });
      await tx.performanceDraft.create({ data: { id: draftId, sectionId: section.id, supervisorUserId: actor.id,
        supervisorPersonnelId: actorPersonnel.id, revision: 1, encryptedPayloadId: draftPayload.id,
        contentHash: canonicalPerformanceHash({ narrative: 'must be physically erased' }), createdAt: new Date('2010-01-01Z') } });
      await tx.performanceEvaluationSection.update({ where: { id: section.id }, data: { status: 'CANCELLED' } });
      await tx.performanceEvaluation.update({ where: { id: evaluation.id }, data: { status: 'CANCELLED', writerVersion: { increment: 1 } } });
      await tx.performanceAuditEvent.create({ data: { id: randomUUID(), aggregateType: 'EVALUATION', aggregateId: evaluation.id,
        eventType: 'EVALUATION_CANCELLED', actorUserId: actor.id, eventHash: canonicalPerformanceHash({ suffix, event: 'cancelled' }),
        occurredAt: new Date('2011-01-01Z') } });
      const policy = await publishPerformanceTestRetentionPolicy(tx, actor.id);
      const secondImpactEvaluation = await tx.performanceEvaluation.create({ data: { stableKey: `${suffix}:impact-evaluation`, subjectId: subject.id,
        measurementFrom: new Date('2010-01-01Z'), measurementTo: new Date('2010-12-31Z'), createdByUserId: actor.id } });
      const secondImpactSection = await tx.performanceEvaluationSection.create({ data: { evaluationId: secondImpactEvaluation.id,
        employmentAssignmentId: assignment.id, responsibleSupervisorPersonnelId: actorPersonnel.id,
        effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2010-12-31Z'), allocationPercent: 100 } });
      const secondImpactDraftId = randomUUID();
      const secondImpactPayload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_DRAFT', aggregateId: secondImpactDraftId,
        payloadKind: 'DRAFT_CONTENT', schemaVersion: 1, payload: { narrative: 'second impact scope' }, keyring: performanceVaultKeyFromEnvironment() });
      await tx.performanceDraft.create({ data: { id: secondImpactDraftId, sectionId: secondImpactSection.id,
        supervisorUserId: actor.id, supervisorPersonnelId: actorPersonnel.id, revision: 1, encryptedPayloadId: secondImpactPayload.id,
        contentHash: canonicalPerformanceHash({ narrative: 'second impact scope' }), createdAt: new Date('2010-01-01Z') } });
      await tx.performanceEvaluationSection.update({ where: { id: secondImpactSection.id }, data: { status: 'CANCELLED' } });
      await tx.performanceEvaluation.update({ where: { id: secondImpactEvaluation.id }, data: { status: 'CANCELLED', writerVersion: { increment: 1 } } });
      await tx.performanceAuditEvent.create({ data: { id: randomUUID(), aggregateType: 'EVALUATION', aggregateId: secondImpactEvaluation.id,
        eventType: 'EVALUATION_CANCELLED', actorUserId: actor.id, eventHash: canonicalPerformanceHash({ suffix, event: 'impact-cancelled' }),
        occurredAt: new Date('2011-01-01Z') } });
      const assessment = await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: evaluation.id });
      await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: secondImpactEvaluation.id });
      assert.equal(assessment.status, 'PENDING_COPY_AND_RECONSTRUCTION_REVIEW');
      const initialOperations = await preparePerformanceErasureOperations(tx, new Date('2026-09-09Z'), 1);
      const operation = initialOperations.find(({ retentionStateId }) => retentionStateId === assessment.id)!;
      assert.ok(operation);
      assert.equal(operation.status, 'PENDING_IMPACT_APPROVAL');
      const impactPreview = await tx.performanceErasureImpactApproval.findUniqueOrThrow({ where: { policyVersionId: policy.id } });
      assert.equal(impactPreview.eligibleScopeCount, 2);
      assert.equal(impactPreview.erasableRecordCount, initialOperations.reduce((total, item) => total + item.recordCount, 0),
        'the approval preview aggregates every eligible scope under the policy');
      await approvePerformanceErasureImpact(tx, { actorUserId: actor.id, policyVersionId: policy.id });
      for (const location of ['TEMPORARY_STORAGE', 'DATABASE_REPLICA', 'ARTIFACT_STORAGE'] as const) {
        await recordPerformanceRecoverableCopy(tx, { actorUserId: actor.id, operationId: operation.id, location,
          copyKey: `${suffix}:${location}`, status: 'VERIFIED_ABSENT', evidenceHash: canonicalPerformanceHash({ suffix, location, inspected: true }) });
      }
      await recordPerformanceRecoverableCopy(tx, { actorUserId: actor.id, operationId: operation.id, location: 'INDEPENDENT_BACKUP',
        copyKey: `${suffix}:backup`, status: 'RECOVERABLE', recoverableUntil: new Date('2027-01-01Z'),
        evidenceHash: canonicalPerformanceHash({ suffix, backup: 'independent', retainedUntil: '2027-01-01' }) });
      assert.equal((await tx.performanceErasureOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'PENDING_BULK_APPROVAL');
      await approvePerformanceBulkErasure(tx, { actorUserId: actor.id, operationId: operation.id, reasonCode: 'APPROVED_SCOPE' });
      assert.equal((await tx.performanceErasureOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'PENDING_BULK_APPROVAL');
      await approvePerformanceBulkErasure(tx, { actorUserId: secondApprover.id, operationId: operation.id, reasonCode: 'APPROVED_SCOPE' });
      assert.equal((await tx.performanceErasureOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'READY');
      const checkpointDraft = await tx.performanceDraft.findUniqueOrThrow({ where: { id: draftId } });
      const checkpointPayload = await tx.performanceEncryptedPayload.findUniqueOrThrow({ where: { id: draftPayload.id } });
      const erased = await executePerformanceErasureOperation(tx, operation.id, new Date('2026-09-09Z'));
      assert.equal(erased.status, 'LIVE_ERASED_BACKUP_PENDING');
      assert.equal(await tx.performanceDraft.count({ where: { id: draftId } }), 0);
      assert.equal(await tx.performanceEncryptedPayload.count({ where: { id: draftPayload.id } }), 0);
      assert.equal(await tx.performanceDeletionReceipt.count({ where: { deletedRecordId: { in: [draftId, draftPayload.id] } } }), 2);
      const replay = await executePerformanceErasureOperation(tx, operation.id, new Date('2026-09-10Z'));
      assert.equal(replay.id, operation.id, 'a retry reuses the stable operation without duplicate deletion');
      await recordPerformanceRecoverableCopy(tx, { actorUserId: actor.id, operationId: operation.id, location: 'INDEPENDENT_BACKUP',
        copyKey: `${suffix}:backup`, status: 'ERASED', evidenceHash: canonicalPerformanceHash({ suffix, backup: 'expired' }) });
      assert.equal((await tx.performanceErasureOperation.findUniqueOrThrow({ where: { id: operation.id } })).status, 'COMPLETED');
      await tx.performanceEncryptedPayload.create({ data: checkpointPayload });
      await tx.performanceDraft.create({ data: checkpointDraft });
      const receiptCountBeforeReplay = await tx.performanceDeletionReceipt.count({ where: { deletedRecordId: { in: [draftId, draftPayload.id] } } });
      const restoreReplay = await replayPerformanceErasureAfterRestore(tx as any, tx as any, new Date('2026-09-10Z'));
      assert.equal(restoreReplay.replayed >= 1, true);
      assert.equal(await tx.performanceDraft.count({ where: { id: draftId } }), 0, 'a restored checkpoint cannot reintroduce erased content');
      assert.equal(await tx.performanceEncryptedPayload.count({ where: { id: draftPayload.id } }), 0);
      assert.equal(await tx.performanceDeletionReceipt.count({ where: { deletedRecordId: { in: [draftId, draftPayload.id] } } }), receiptCountBeforeReplay,
        'restore replay reuses the immutable receipts');

      const heldOperation = initialOperations.find(({ id }) => id !== operation.id)!;
      for (const location of ['TEMPORARY_STORAGE', 'DATABASE_REPLICA', 'ARTIFACT_STORAGE', 'INDEPENDENT_BACKUP'] as const) {
        await recordPerformanceRecoverableCopy(tx, { actorUserId: actor.id, operationId: heldOperation.id, location,
          copyKey: `${suffix}:held:${location}`, status: 'VERIFIED_ABSENT', evidenceHash: canonicalPerformanceHash({ suffix, location, held: true }) });
      }
      await approvePerformanceBulkErasure(tx, { actorUserId: actor.id, operationId: heldOperation.id, reasonCode: 'APPROVED_HELD_SCOPE' });
      await approvePerformanceBulkErasure(tx, { actorUserId: secondApprover.id, operationId: heldOperation.id, reasonCode: 'APPROVED_HELD_SCOPE' });
      await placePerformanceLegalHold(tx, { actorUserId: actor.id, aggregateType: 'EVALUATION',
        aggregateId: secondImpactEvaluation.id, reasonCode: 'ACTIVE_INVESTIGATION' });
      const held = await executePerformanceErasureOperation(tx, heldOperation.id, new Date('2026-09-10Z'));
      assert.equal(held.status, 'PARTIAL_RESTRICTED', 'a legal hold committed before deletion wins the shared fence');
      assert.equal(await tx.performanceDraft.count({ where: { id: secondImpactDraftId } }), 1);
      assert.equal(await tx.performanceDeletionReceipt.count({ where: { deletedRecordId: secondImpactDraftId } }), 0);

      const retryEvaluation = await tx.performanceEvaluation.create({ data: { stableKey: `${suffix}:retry-evaluation`, subjectId: subject.id,
        measurementFrom: new Date('2010-01-01Z'), measurementTo: new Date('2010-12-31Z'), createdByUserId: actor.id } });
      const retrySection = await tx.performanceEvaluationSection.create({ data: { evaluationId: retryEvaluation.id,
        employmentAssignmentId: assignment.id, responsibleSupervisorPersonnelId: actorPersonnel.id,
        effectiveFrom: new Date('2010-01-01Z'), effectiveTo: new Date('2010-12-31Z'), allocationPercent: 100 } });
      const retryDraftId = randomUUID();
      const retryPayload = await persistPerformancePayload(tx, { aggregateType: 'PERFORMANCE_DRAFT', aggregateId: retryDraftId,
        payloadKind: 'DRAFT_CONTENT', schemaVersion: 1, payload: { narrative: 'survives failed attempt' }, keyring: performanceVaultKeyFromEnvironment() });
      await tx.performanceDraft.create({ data: { id: retryDraftId, sectionId: retrySection.id, supervisorUserId: actor.id,
        supervisorPersonnelId: actorPersonnel.id, revision: 2, encryptedPayloadId: retryPayload.id,
        contentHash: canonicalPerformanceHash({ narrative: 'survives failed attempt' }) } });
      await tx.performanceEvaluationSection.update({ where: { id: retrySection.id }, data: { status: 'CANCELLED' } });
      await tx.performanceEvaluation.update({ where: { id: retryEvaluation.id }, data: { status: 'CANCELLED', writerVersion: { increment: 1 } } });
      await tx.performanceAuditEvent.create({ data: { id: randomUUID(), aggregateType: 'EVALUATION', aggregateId: retryEvaluation.id,
        eventType: 'EVALUATION_CANCELLED', actorUserId: actor.id, eventHash: canonicalPerformanceHash({ suffix, event: 'retry-cancelled' }),
        occurredAt: new Date('2011-01-01Z') } });
      await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: retryEvaluation.id });
      const prepared = await preparePerformanceErasureOperations(tx, new Date('2026-09-11Z'), 1);
      const retryState = await tx.performanceRetentionState.findFirstOrThrow({ where: { aggregateType: 'EVALUATION', aggregateId: retryEvaluation.id },
        orderBy: { version: 'desc' } });
      const retryOperation = prepared.find(({ retentionStateId }) => retentionStateId === retryState.id)!;
      for (const location of ['TEMPORARY_STORAGE', 'DATABASE_REPLICA', 'ARTIFACT_STORAGE', 'INDEPENDENT_BACKUP'] as const) {
        await recordPerformanceRecoverableCopy(tx, { actorUserId: actor.id, operationId: retryOperation.id, location,
          copyKey: `${suffix}:retry:${location}`, status: 'VERIFIED_ABSENT', evidenceHash: canonicalPerformanceHash({ suffix, location, retry: true }) });
      }
      await approvePerformanceBulkErasure(tx, { actorUserId: actor.id, operationId: retryOperation.id, reasonCode: 'APPROVED_RETRY_SCOPE' });
      await approvePerformanceBulkErasure(tx, { actorUserId: secondApprover.id, operationId: retryOperation.id, reasonCode: 'APPROVED_RETRY_SCOPE' });
      await tx.performanceErasureOperation.update({ where: { id: retryOperation.id }, data: {
        status: 'RUNNING', claimedAt: new Date('2026-09-10T00:00:00Z'), attemptCount: { increment: 1 },
      } });
      const failed = await executePerformanceErasureOperation(tx, retryOperation.id, new Date('2026-09-11Z'), {
        eraseArtifacts: async () => { throw Object.assign(new Error('injected storage outage'), { code: 'PERFORMANCE_ERASURE_STORAGE_FAILURE' }); },
      });
      assert.equal(failed.status, 'PARTIAL_RESTRICTED');
      assert.equal(await tx.performanceDraft.count({ where: { id: retryDraftId } }), 1, 'the failed transaction preserves content for a stable retry');
      assert.equal(await tx.performanceDeletionReceipt.count({ where: { deletedRecordId: retryDraftId } }), 0, 'a failure cannot leave a false receipt');
      assert.ok(await tx.performanceEvidenceRestriction.findFirst({ where: { evaluationId: retryEvaluation.id, reasonCode: 'ERASURE_PARTIAL_FAILURE', status: 'ACTIVE' } }));
      const retried = await executePerformanceErasureOperation(tx, retryOperation.id, new Date('2026-09-12Z'));
      assert.equal(retried.id, retryOperation.id);
      assert.equal(retried.status, 'COMPLETED');
      assert.equal(await tx.performanceDraft.count({ where: { id: retryDraftId } }), 0);
      throw rollback;
    }, { timeout: 30_000 });
  } catch (error) {
    if (error !== rollback) throw error;
  }
};

main().finally(() => prisma.$disconnect());
