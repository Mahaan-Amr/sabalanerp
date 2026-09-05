import { enablePerformanceTestRelease, enrollPerformanceTestCohort, publishPerformanceTestRetentionPolicy } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';
import { createPerformancePolicyDraft, updatePerformancePolicyDraft, DEFAULT_CURRENT_LEVEL_POLICY_CONTENT } from '../personnelPerformancePolicyStore';
import { prisma } from '../../lib/prisma';
import { pausePersonnelPerformance, getPersonnelPerformanceOperationsState, disablePersonnelPerformanceBeforeFirstWrite } from '../personnelPerformanceOperationsStore';
import { resolvePersonnelPerformanceWriteGate, assertPersonnelPerformanceWriteAdmission } from '../personnelPerformanceRolloutPolicy';
import { restrictPerformanceEvidence } from '../personnelPerformanceRestrictions';
import { assessPerformanceEvaluationRetention } from '../personnelPerformanceRetentionStore';

const rollback = Symbol('rollback-performance-operations');
const main = async () => {
  await assert.rejects(() => createPerformancePolicyDraft(prisma, {
    policyKind: 'RETENTION', content: { schemaVersion: 1 }, createdByUserId: 'never-persist-invalid-policy',
  }), (error: { code?: string }) => error.code === 'PERFORMANCE_POLICY_VALIDATION_FAILED');
  try {
    await prisma.$transaction(async (tx) => {
      const suffix = randomUUID();
      const actor = await tx.user.create({ data: {
        email: `operations-${suffix}@example.invalid`, username: `operations-${suffix}`,
        password: 'not-used', firstName: 'عامل', lastName: 'آزمون',
      } });
  await enablePerformanceTestRelease(tx, actor.id);
      await assert.rejects(() => assertPersonnelPerformanceWriteAdmission(tx, 'SAVE_SUPERVISOR_DRAFT', 'outside-cohort'),
        (error: { code?: string }) => error.code === 'PERFORMANCE_SUBJECT_OUTSIDE_COHORT');
      await assertPersonnelPerformanceWriteAdmission(tx, 'MANAGE_POLICY');
      const personnel = await tx.personnel.create({ data: { firstName: 'آزمون', lastName: 'عضویت' } });
      const relationship = await tx.hrEmploymentRelationship.create({ data: { personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2020-01-01Z'), createdBy: actor.id } });
      const subject = await tx.performanceSubject.create({ data: { stableKey: suffix, nonDisplayKey: suffix, personnelId: personnel.id, employmentRelationshipId: relationship.id, createdByUserId: actor.id } });
      await assert.rejects(() => assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: 'unrelated-evaluation' }),
        (error: { code?: string }) => error.code === 'PERFORMANCE_RETENTION_PERMISSION_REQUIRED');
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:retention`, userId: actor.id, featureCode: 'MANAGE_PERFORMANCE_RETENTION', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated retention assessment' } });
      const evaluation = await tx.performanceEvaluation.create({ data: { stableKey: `${suffix}:assessment`, subjectId: subject.id,
        measurementFrom: new Date('2026-01-01Z'), measurementTo: new Date('2026-03-31Z'), createdByUserId: actor.id } });
      await publishPerformanceTestRetentionPolicy(tx, actor.id);
      const assessment = await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: evaluation.id });
      assert.equal(assessment.status, 'REQUIRES_RETENTION_DECISION', 'an open draft has no invented closure anchor');
      assert.equal(assessment.classification, 'DRAFT');
      assert.equal(assessment.deleteAfter, null);
      assert.equal((await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: evaluation.id })).id, assessment.id,
        'unchanged evidence reuses the immutable decision');
      assert.ok(await tx.performanceAuditEvent.findFirst({ where: { aggregateId: assessment.id, eventType: 'RETENTION_ASSESSED', encryptedPayloadId: { not: null } } }));
      for (const featureCode of ['RESTRICT_PERFORMANCE_EVIDENCE', 'RELEASE_PERFORMANCE_RESTRICTION']) await tx.hrFeatureAccessGrant.create({ data: {
        stableKey: `${suffix}:${featureCode}`, userId: actor.id, featureCode, level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated restriction retention test',
      } });
      const restriction = await restrictPerformanceEvidence(tx, { actorUserId: actor.id, evaluationId: evaluation.id, reasonCode: 'EVIDENCE_DISPUTED' });
      const restrictedAssessment = await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: evaluation.id });
      assert.equal(restrictedAssessment.status, 'DEPENDENCY_OPEN');
      assert.equal(restrictedAssessment.version, assessment.version + 1);
      await restrictPerformanceEvidence(tx, { actorUserId: actor.id, evaluationId: evaluation.id, releaseId: restriction.id, reasonCode: 'DISPUTE_CLOSED' });
      const releasedAssessment = await assessPerformanceEvaluationRetention(tx, { actorUserId: actor.id, evaluationId: evaluation.id });
      assert.equal(releasedAssessment.status, 'REQUIRES_RETENTION_DECISION');
      assert.equal(releasedAssessment.version, restrictedAssessment.version + 1);
      const cohort = await enrollPerformanceTestCohort(tx, actor.id, [subject.id]);
      assert.equal((await assertPersonnelPerformanceWriteAdmission(tx, 'SAVE_SUPERVISOR_DRAFT', subject.id)).allowed, true);
      await tx.performanceCohortVersion.update({ where: { id: cohort.id }, data: { lifecycle: 'RETIRED' } });
      await assert.rejects(() => assertPersonnelPerformanceWriteAdmission(tx, 'SAVE_SUPERVISOR_DRAFT', subject.id),
        (error: { code?: string }) => error.code === 'PERFORMANCE_SUBJECT_OUTSIDE_COHORT', 'retired cohort membership never admits a write');
      const draft = await createPerformancePolicyDraft(tx, { policyKind: 'CURRENT_LEVEL', content: DEFAULT_CURRENT_LEVEL_POLICY_CONTENT, createdByUserId: actor.id });
      assert.equal((await getPersonnelPerformanceOperationsState(tx)).rollbackMode, 'EVIDENCE_PRESERVING_FIX_FORWARD');
      const latest = await tx.performanceFeaturePhaseVersion.findFirst({ orderBy: { version: 'desc' } });
      const previous = await tx.performanceFeaturePhaseVersion.create({ data: {
        version: (latest?.version ?? 0) + 1, predecessorId: latest?.id, phase: 'EXPANSION_RETIREMENT', releaseEnabled: true,
        effectiveFrom: new Date('2099-01-01Z'), reason: 'Isolated operations acceptance', recordedByUserId: actor.id,
      } });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:pause`, userId: actor.id, featureCode: 'PAUSE_PERFORMANCE_EVALUATION', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated pause acceptance' } });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:rollout`, userId: actor.id, featureCode: 'MANAGE_PERFORMANCE_ROLLOUT', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated disable acceptance' } });
      await assert.rejects(() => disablePersonnelPerformanceBeforeFirstWrite(tx, { actorUserId: actor.id, reason: 'Cannot discard canonical data' }), (error: { code?: string }) => error.code === 'PERFORMANCE_FIX_FORWARD_REQUIRED');
      const pause = await pausePersonnelPerformance(tx, { phaseVersionId: previous.id, actorUserId: actor.id, scope: 'ALL', reasonCode: 'INTEGRITY_MISMATCH', reason: 'Isolated operations acceptance' });
      assert.equal(pause.status, 'ACTIVE');
      assert.equal((await getPersonnelPerformanceOperationsState(tx)).activePauses.some(({ id }) => id === pause.id), true);
      await tx.performanceFeaturePhaseVersion.create({ data: {
        version: previous.version + 1, predecessorId: previous.id, phase: 'EXPANSION_RETIREMENT', releaseEnabled: true,
        effectiveFrom: new Date('2099-01-02Z'), reason: 'Isolated next phase', recordedByUserId: actor.id,
      } });
      assert.deepEqual(await resolvePersonnelPerformanceWriteGate(tx, 'MANAGE_POLICY', new Date('2099-01-03Z')),
        { allowed: false, reason: 'SAFETY_PAUSED' }, 'a new phase must not hide an unresolved global safety pause');
      await tx.$executeRawUnsafe('SAVEPOINT paused_write');
      await assert.rejects(() => createPerformancePolicyDraft(tx, { policyKind: 'RETENTION', content: PERFORMANCE_RETENTION_SCHEDULE_V1, createdByUserId: actor.id }), (error: { code?: string }) => error.code === 'PERFORMANCE_SAFETY_PAUSED');
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT paused_write');
      await assert.rejects(() => updatePerformancePolicyDraft(tx, { versionId: draft.id, content: DEFAULT_CURRENT_LEVEL_POLICY_CONTENT }), (error: { code?: string }) => error.code === 'PERFORMANCE_SAFETY_PAUSED');
      await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT paused_write');
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
};
main().finally(() => prisma.$disconnect());
