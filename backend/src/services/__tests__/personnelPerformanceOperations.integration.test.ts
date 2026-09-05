import { enablePerformanceTestRelease, enrollPerformanceTestCohort, publishPerformanceTestRetentionPolicy } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PERFORMANCE_RETENTION_SCHEDULE_V1 } from '../personnelPerformanceRetention';
import { canonicalPerformanceHash } from '../personnelPerformancePolicy';
import { createPerformancePolicyDraft, updatePerformancePolicyDraft, DEFAULT_CURRENT_LEVEL_POLICY_CONTENT } from '../personnelPerformancePolicyStore';
import { prisma } from '../../lib/prisma';
import { pausePersonnelPerformance, getPersonnelPerformanceOperationsState, disablePersonnelPerformanceBeforeFirstWrite } from '../personnelPerformanceOperationsStore';
import { resolvePersonnelPerformanceWriteGate, assertPersonnelPerformanceWriteAdmission } from '../personnelPerformanceRolloutPolicy';
import { restrictPerformanceEvidence } from '../personnelPerformanceRestrictions';
import { assessPerformanceEvaluationRetention } from '../personnelPerformanceRetentionStore';
import {
  activatePerformanceCohort,
  activateDuePerformanceCohorts,
  decidePerformanceRollout,
  proposePerformanceCohort,
  recordPerformanceTrainingEvidence,
  resumePersonnelPerformance,
} from '../personnelPerformanceRolloutStore';

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
      const assignment = await tx.hrEmploymentAssignment.create({ data: { employmentRelationshipId: relationship.id,
        type: 'PRIMARY', effectiveFrom: new Date('2020-01-01Z'), performanceAllocationPercent: 100, createdBy: actor.id } });
      const readinessSourceHash = canonicalPerformanceHash({ fixture: suffix });
      const readinessRun = await tx.performanceReadinessRun.create({ data: { stableKey: `${suffix}:rollout-readiness`,
        measurementFrom: evaluation.measurementFrom, measurementTo: evaluation.measurementTo, sourceCount: 1,
        sourceHash: readinessSourceHash, status: 'COMPLETED', appliedCount: 1, requestedByUserId: actor.id, completedAt: new Date() } });
      await tx.performanceReadinessRecord.create({ data: { runId: readinessRun.id, employmentAssignmentId: assignment.id,
        sourceHash: readinessSourceHash, status: 'APPLIED', evaluationId: evaluation.id } });
      const trainingHash = canonicalPerformanceHash({ curriculum: 'performance-rollout-v1' });
      const evidenceHash = canonicalPerformanceHash({ subjectId: subject.id, completion: suffix });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:training`, userId: actor.id,
        featureCode: 'RECORD_PERFORMANCE_TRAINING', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
        grantedByUserId: actor.id, reason: 'Isolated rollout governance' } });
      await recordPerformanceTrainingEvidence(tx, { actorUserId: actor.id, subjectId: subject.id,
        curriculumHash: trainingHash, evidenceHash, completedAt: new Date('2026-01-01Z'), validUntil: new Date('2099-01-01Z') });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:rollout-proposal`, userId: actor.id,
        featureCode: 'MANAGE_PERFORMANCE_ROLLOUT', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
        grantedByUserId: actor.id, reason: 'Isolated rollout governance' } });
      await tx.hrFeatureAccessGrant.create({ data: { stableKey: `${suffix}:rollout-activation`, userId: actor.id,
        featureCode: 'TECHNICALLY_ACTIVATE_PERFORMANCE_COHORT', level: 'ADMIN', effectiveFrom: new Date('2020-01-01Z'),
        grantedByUserId: actor.id, reason: 'Isolated rollout governance' } });
      const proposal = await proposePerformanceCohort(tx, { actorUserId: actor.id, cohortKey: `${suffix}:governed`, stage: 'PILOT',
        subjectIds: [subject.id], readinessHash: canonicalPerformanceHash([readinessSourceHash]), reason: 'Isolated governed cohort proposal' });
      assert.ok(await tx.performanceAuditEvent.findFirst({ where: { aggregateId: proposal.id, eventType: 'PERFORMANCE_COHORT_PROPOSED' } }));
      await assert.rejects(() => decidePerformanceRollout(tx, { actorUserId: actor.id, scopeType: 'COHORT', scopeId: proposal.id,
        ownerType: 'UNSUPPORTED_OWNER' as 'HUMAN_RESOURCES', action: 'APPROVE', reasonCode: 'READINESS_VERIFIED', evidenceHash }),
      (error: { code?: string }) => error.code === 'PERFORMANCE_ROLLOUT_DECISION_INVALID');
      await assert.rejects(() => activatePerformanceCohort(tx, { actorUserId: actor.id, cohortVersionId: proposal.id,
        effectiveFrom: new Date('2099-01-01Z'), reason: 'Missing approvals must fail' }),
      (error: { code?: string }) => error.code === 'PERFORMANCE_ROLLOUT_APPROVALS_INCOMPLETE');
      const ownerDefinitions = [
        ['HUMAN_RESOURCES', 'APPROVE_PERFORMANCE_COHORT_HR', 'APPROVE_PERFORMANCE_RESUME_HR'],
        ['SECURITY_PRIVACY', 'APPROVE_PERFORMANCE_COHORT_SECURITY', 'APPROVE_PERFORMANCE_RESUME_SECURITY'],
        ['SYSTEM_OWNER', 'APPROVE_PERFORMANCE_COHORT_SYSTEM', 'APPROVE_PERFORMANCE_RESUME_SYSTEM'],
      ] as const;
      const owners: Array<{ owner: { id: string }; ownerType: typeof ownerDefinitions[number][0] }> = [];
      for (const [ownerType, cohortPermission, resumePermission] of ownerDefinitions) {
        const owner = await tx.user.create({ data: { email: `${suffix}-${ownerType}@example.invalid`, username: `${suffix}-${ownerType}`,
          password: 'not-used', firstName: 'مالک', lastName: ownerType } });
        owners.push({ owner, ownerType });
        for (const featureCode of [cohortPermission, resumePermission]) await tx.hrFeatureAccessGrant.create({ data: {
          stableKey: `${suffix}:${ownerType}:${featureCode}`, userId: owner.id, featureCode, level: 'ADMIN',
          effectiveFrom: new Date('2020-01-01Z'), grantedByUserId: actor.id, reason: 'Isolated rollout owner' } });
        await decidePerformanceRollout(tx, { actorUserId: owner.id, scopeType: 'COHORT', scopeId: proposal.id, ownerType,
          action: 'APPROVE', reasonCode: 'READINESS_VERIFIED', evidenceHash });
      }
      const [activationClock] = await tx.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS now`;
      const effectiveFrom = new Date(activationClock.now.getTime() + 1_000);
      const scheduled = await activatePerformanceCohort(tx, { actorUserId: actor.id, cohortVersionId: proposal.id,
        effectiveFrom, reason: 'Three independently approved owners' });
      assert.equal(scheduled.lifecycle, 'SCHEDULED');
      assert.ok(await tx.performanceAuditEvent.findFirst({ where: { aggregateId: proposal.id, eventType: 'PERFORMANCE_COHORT_SCHEDULED' } }));
      const securityOwner = owners.find(({ ownerType }) => ownerType === 'SECURITY_PRIVACY')!;
      await decidePerformanceRollout(tx, { actorUserId: securityOwner.owner.id, scopeType: 'COHORT', scopeId: proposal.id,
        ownerType: securityOwner.ownerType, action: 'VETO', reasonCode: 'LATE_SECURITY_VETO', evidenceHash });
      await assert.rejects(() => activateDuePerformanceCohorts(tx, new Date(effectiveFrom.getTime() + 1)),
        (error: { code?: string }) => error.code === 'PERFORMANCE_ROLLOUT_APPROVALS_INCOMPLETE', 'a late veto blocks due activation');
      await decidePerformanceRollout(tx, { actorUserId: securityOwner.owner.id, scopeType: 'COHORT', scopeId: proposal.id,
        ownerType: securityOwner.ownerType, action: 'APPROVE', reasonCode: 'SECURITY_VETO_RESOLVED', evidenceHash });
      await assert.rejects(() => activateDuePerformanceCohorts(tx, new Date('2100-01-01Z')),
        (error: { code?: string }) => error.code === 'PERFORMANCE_COHORT_ELIGIBILITY_EXPIRED', 'expired training blocks due activation');
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
      const resumeEvidenceHash = canonicalPerformanceHash({ pauseId: pause.id, reconciliation: 'clean', repeatedTests: true });
      for (const { owner, ownerType } of owners) await decidePerformanceRollout(tx, { actorUserId: owner.id,
        scopeType: 'SAFETY_PAUSE', scopeId: pause.id, ownerType, action: 'APPROVE_RESUME',
        reasonCode: 'ROOT_CAUSE_RESOLVED', evidenceHash: resumeEvidenceHash });
      const resumed = await resumePersonnelPerformance(tx, { actorUserId: actor.id, pauseId: pause.id,
        reasonCode: 'ROOT_CAUSE_RESOLVED', evidenceHash: resumeEvidenceHash });
      assert.equal(resumed.status, 'RESUMED');
      assert.ok(await tx.performanceAuditEvent.findFirst({ where: { aggregateId: pause.id, eventType: 'PERFORMANCE_SAFETY_PAUSE_RESUMED' } }));
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
};
main().finally(() => prisma.$disconnect());
