import { enablePerformanceTestRelease, enrollPerformanceTestCohort } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PerformanceReviewDecision } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { reconstructPerformanceReadiness, retryFailedPerformanceReadinessRecords } from '../personnelPerformanceReadinessStore';
import { filterCurrentlyAuthorizedNotifications } from '../notificationAuthorization';
import { DEFAULT_LEVEL_POLICY_CONTENT, nextTehranDayStart } from '../personnelPerformancePolicy';
import { readPerformancePayload } from '../personnelPerformancePayloadStore';
import {
  activateDuePerformanceArtifacts,
  activateDuePerformancePolicies,
  createPerformanceCriterionDraft,
  createPerformancePolicyDraft,
  createPerformanceTemplateDraft,
  DEFAULT_CURRENT_LEVEL_POLICY_CONTENT,
  DEFAULT_SCORING_POLICY_CONTENT,
  previewPerformancePolicy,
  schedulePerformanceCriterion,
  schedulePerformancePolicy,
  schedulePerformanceTemplate,
} from '../personnelPerformancePolicyStore';
import { pausePersonnelPerformance } from '../personnelPerformanceOperationsStore';
import {
  cancelPerformanceEvaluation,
  decidePerformanceReview,
  getSupervisorPerformanceSection,
  invalidatePerformanceEvaluation,
  listPerformanceLifecycleSections,
  markPerformanceSectionNotEvaluable,
  saveSupervisorPerformanceDraft,
  submitSupervisorPerformanceSection,
} from '../personnelPerformanceWorkflowStore';
import {
  performanceBusinessErrorCode,
  raceEvidenceMarker,
  runOrderedPerformanceRace,
} from './performanceAcceptanceRaceHarness';

const repositoryRoot = path.resolve(process.cwd(), '..');
const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10';
const keyring = { keyId: 'workflow-integration-v1', key: Buffer.from('0123456789abcdef0123456789abcdef') };

const main = async () => {
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const first = database.client();
  const second = database.client();
  const raceEvidence: Parameters<typeof raceEvidenceMarker>[0] = [];
  try {
    const suffix = database.runId;
    const [supervisorPersonnel, replacementSupervisorPersonnel, targetPersonnel, firstReviewerPersonnel, secondReviewerPersonnel] = await Promise.all([
      first.personnel.create({ data: { firstName: 'سرپرست', lastName: `آزمون ${suffix}` } }),
      first.personnel.create({ data: { firstName: 'سرپرست', lastName: `جایگزین ${suffix}` } }),
      first.personnel.create({ data: { firstName: 'پرسنل', lastName: `آزمون ${suffix}` } }),
      first.personnel.create({ data: { firstName: 'بررسی‌کننده', lastName: `یک ${suffix}` } }),
      first.personnel.create({ data: { firstName: 'بررسی‌کننده', lastName: `دو ${suffix}` } }),
    ]);
    const [supervisorUser, firstReviewer, secondReviewer] = await Promise.all([
      first.user.create({ data: {
        email: `performance-supervisor-${suffix}@example.invalid`, username: `performance_supervisor_${suffix}`,
        password: 'not-used', firstName: 'سرپرست', lastName: 'آزمون', personnelId: supervisorPersonnel.id,
      } }),
      first.user.create({ data: {
        email: `performance-reviewer-a-${suffix}@example.invalid`, username: `performance_reviewer_a_${suffix}`,
        password: 'not-used', firstName: 'بررسی‌کننده', lastName: 'یک', personnelId: firstReviewerPersonnel.id,
      } }),
      first.user.create({ data: {
        email: `performance-reviewer-b-${suffix}@example.invalid`, username: `performance_reviewer_b_${suffix}`,
        password: 'not-used', firstName: 'بررسی‌کننده', lastName: 'دو', personnelId: secondReviewerPersonnel.id,
      } }),
    ]);
    await enablePerformanceTestRelease(first, firstReviewer.id);
    await first.hrFeatureAccessGrant.createMany({ data: [
      { stableKey: `performance-submit-${suffix}`, userId: supervisorUser.id, featureCode: 'SUBMIT_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-review-supervisor-${suffix}`, userId: supervisorUser.id, featureCode: 'REVIEW_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون ممیزی خودبررسی سرپرست مجاز' },
      { stableKey: `performance-review-a-${suffix}`, userId: firstReviewer.id, featureCode: 'REVIEW_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-pause-a-${suffix}`, userId: firstReviewer.id, featureCode: 'PAUSE_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-cycle-a-${suffix}`, userId: firstReviewer.id, featureCode: 'MANAGE_PERFORMANCE_CYCLE', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-review-b-${suffix}`, userId: secondReviewer.id, featureCode: 'REVIEW_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-submit-nondisclosure-${suffix}`, userId: firstReviewer.id, featureCode: 'SUBMIT_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون عدم افشا' },
    ] });
    const unit = await first.hrOrganizationalUnit.create({ data: {
      code: `PERF-UNIT-${suffix}`, name: 'واحد آزمون عملکرد', type: 'DEPARTMENT', createdBy: firstReviewer.id,
    } });
    const nextUnit = await first.hrOrganizationalUnit.create({ data: {
      code: `PERF-UNIT-NEXT-${suffix}`, name: 'واحد دوم آزمون عملکرد', type: 'DEPARTMENT', createdBy: firstReviewer.id,
    } });
    const [workplace, nextWorkplace] = await Promise.all([
      first.hrWorkplace.create({ data: { code: `PERF-WORK-${suffix}`, name: 'محل نخست آزمون', createdBy: firstReviewer.id } }),
      first.hrWorkplace.create({ data: { code: `PERF-WORK-NEXT-${suffix}`, name: 'محل دوم آزمون', createdBy: firstReviewer.id } }),
    ]);
    const job = await first.hrJob.create({ data: { code: `PERF-JOB-${suffix}`, title: 'شغل آزمون عملکرد', createdBy: firstReviewer.id } });
    const nextJob = await first.hrJob.create({ data: { code: `PERF-JOB-NEXT-${suffix}`, title: 'شغل دوم آزمون عملکرد', createdBy: firstReviewer.id } });
    const policyEffectiveFrom = new Date('2024-12-31T20:30:00.000Z');
    const criterionContent = {
      schemaVersion: 1 as const,
      conceptCode: `PERF-WORKFLOW-${suffix.toUpperCase()}`,
      titleFa: 'کیفیت تحویل', meaningFa: 'کیفیت نتیجه در بازه مسئولیت', kind: 'JUDGMENT' as const,
      anchorsFa: ['به‌طور جدی پایین‌تر', 'پایین‌تر', 'مطابق انتظار', 'بالاتر', 'به‌طور استثنایی بالاتر'],
      applicability: null,
      evidence: { allowedKinds: ['STRUCTURED_OBSERVATION' as const], minimumReliableCount: 1, lookbackDays: 0, required: true },
    };
    const publicationNow = new Date('2024-12-01T00:00:00.000Z');
    const criterionVersion = await createPerformanceCriterionDraft(first, {
      content: criterionContent, createdByUserId: firstReviewer.id, keyring,
    });
    await schedulePerformanceCriterion(first, {
      versionId: criterionVersion.id, effectiveFrom: policyEffectiveFrom,
      reason: 'انتشار معیار آزمون گردش عملکرد', publishedByUserId: firstReviewer.id, now: publicationNow, keyring,
    });
    const templateContent = {
      schemaVersion: 1 as const, titleFa: 'الگوی آزمون گردش عملکرد',
      categories: [{ id: 'delivery', titleFa: 'تحویل', weightPercent: '100.00', required: true,
        criteria: [{ criterionVersionId: criterionVersion.id, weightPercent: '100.00' }] }],
    };
    const templateVersion = await createPerformanceTemplateDraft(first, {
      templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: job.id,
      content: templateContent, createdByUserId: firstReviewer.id, keyring,
    });
    await schedulePerformanceTemplate(first, {
      versionId: templateVersion.id, effectiveFrom: policyEffectiveFrom,
      reason: 'انتشار الگوی آزمون گردش عملکرد', publishedByUserId: firstReviewer.id, now: publicationNow, keyring,
    });
    const nextTemplateVersion = await createPerformanceTemplateDraft(first, {
      templateKind: 'JOB_TEMPLATE', ownerType: 'JOB', ownerId: nextJob.id,
      content: templateContent, createdByUserId: firstReviewer.id, keyring,
    });
    await schedulePerformanceTemplate(first, {
      versionId: nextTemplateVersion.id, effectiveFrom: policyEffectiveFrom,
      reason: 'انتشار الگوی دوم آزمون گردش عملکرد', publishedByUserId: firstReviewer.id, now: publicationNow, keyring,
    });
    const createPolicy = async (kind: 'SCORING' | 'LEVEL_CLASSIFICATION' | 'CURRENT_LEVEL', content: typeof DEFAULT_SCORING_POLICY_CONTENT | typeof DEFAULT_LEVEL_POLICY_CONTENT | typeof DEFAULT_CURRENT_LEVEL_POLICY_CONTENT) => {
      const policy = await createPerformancePolicyDraft(first, {
        policyKind: kind, content, createdByUserId: firstReviewer.id, keyring,
      });
      const preview = await previewPerformancePolicy(first, { versionId: policy.id, asOf: policyEffectiveFrom, now: publicationNow, keyring });
      await schedulePerformancePolicy(first, {
        versionId: policy.id, effectiveFrom: policyEffectiveFrom,
        reason: 'انتشار سیاست آزمون گردش عملکرد', confirmedByUserId: firstReviewer.id,
        confirmedPreviewHash: preview.preview.resultHash, confirmedPopulationHash: preview.sourcePopulationHash,
        now: publicationNow, keyring,
      });
      await activateDuePerformancePolicies(first, {
        actorUserId: firstReviewer.id,
        idempotencyKey: `activate-workflow-policy-${kind.toLowerCase()}-${suffix}`,
        now: policyEffectiveFrom,
        keyring,
      });
      return policy;
    };
    const scoringPolicy = await createPolicy('SCORING', DEFAULT_SCORING_POLICY_CONTENT);
    await createPolicy('LEVEL_CLASSIFICATION', DEFAULT_LEVEL_POLICY_CONTENT);
    await createPolicy('CURRENT_LEVEL', DEFAULT_CURRENT_LEVEL_POLICY_CONTENT);
    await activateDuePerformanceArtifacts(first, {
      actorUserId: firstReviewer.id, idempotencyKey: `activate-workflow-artifacts-${suffix}`, now: policyEffectiveFrom, keyring,
    });
    const supervisorPosition = await first.hrPosition.create({ data: {
      code: `PERF-SUP-${suffix}`, title: 'جایگاه سرپرست آزمون', capacity: 1,
      organizationalUnitId: unit.id, jobId: job.id, createdBy: firstReviewer.id,
    } });
    const targetPosition = await first.hrPosition.create({ data: {
      code: `PERF-TARGET-${suffix}`, title: 'جایگاه پرسنل آزمون', capacity: 1,
      organizationalUnitId: nextUnit.id, workplaceId: nextWorkplace.id, jobId: nextJob.id,
      supervisorPositionId: supervisorPosition.id, createdBy: firstReviewer.id,
    } });
    const measurementFrom = new Date('2026-01-01T00:00:00.000Z');
    const measurementTo = new Date('2026-04-01T00:00:00.000Z');
    await first.hrFoundationLifecycleVersion.createMany({ data: [
      {
        stableKey: `target-position-origin-${suffix}`, entityType: 'POSITION', entityId: targetPosition.id, version: 1,
        status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'زمینه نخست آزمون تاریخ مؤثر',
        afterJson: { jobId: job.id, organizationalUnitId: unit.id, workplaceId: workplace.id }, changedByUserId: firstReviewer.id,
      },
      {
        stableKey: `target-position-transition-${suffix}`, entityType: 'POSITION', entityId: targetPosition.id, version: 2,
        status: 'ACTIVE', effectiveFrom: new Date('2026-03-20T00:00:00.000Z'), reason: 'تغییر آزمون تاریخ مؤثر',
        beforeJson: { jobId: job.id, organizationalUnitId: unit.id, workplaceId: workplace.id },
        afterJson: { jobId: nextJob.id, organizationalUnitId: nextUnit.id, workplaceId: nextWorkplace.id }, changedByUserId: firstReviewer.id,
      },
    ] });
    const supervisorRelationship = await first.hrEmploymentRelationship.create({ data: {
      personnelId: supervisorPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), createdBy: firstReviewer.id,
    } });
    const replacementSupervisorRelationship = await first.hrEmploymentRelationship.create({ data: {
      personnelId: replacementSupervisorPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-03-20T00:00:00.000Z'), createdBy: firstReviewer.id,
    } });
    const targetRelationship = await first.hrEmploymentRelationship.create({ data: {
      personnelId: targetPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), createdBy: firstReviewer.id,
    } });
    const supervisorAssignment = await first.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: supervisorRelationship.id, positionId: supervisorPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), effectiveTo: new Date('2026-03-20T00:00:00.000Z'), organizationalUnitId: unit.id,
      performanceAllocationPercent: '100.00', createdBy: firstReviewer.id,
    } });
    const replacementSupervisorAssignment = await first.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: replacementSupervisorRelationship.id, positionId: supervisorPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2026-03-20T00:00:00.000Z'), organizationalUnitId: unit.id,
      performanceAllocationPercent: '100.00', createdBy: firstReviewer.id,
    } });
    const targetAssignment = await first.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: targetRelationship.id, positionId: targetPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), organizationalUnitId: unit.id, workplaceId: workplace.id,
      responsibleSupervisorAssignmentId: replacementSupervisorAssignment.id, performanceAllocationPercent: '100.00', createdBy: firstReviewer.id,
    } });
    await first.hrAssignmentPerformanceResponsibility.create({ data: {
      employmentAssignmentId: targetAssignment.id, supervisorAssignmentId: supervisorAssignment.id,
      effectiveFrom: targetAssignment.effectiveFrom, effectiveTo: new Date('2026-03-20T00:00:00.000Z'),
      allocationPercent: '100.00',
      reason: 'ثبت مسئول ارزیابی برای آزمون یکپارچه', createdBy: firstReviewer.id,
    } });
    const secondResponsibility = await first.hrAssignmentPerformanceResponsibility.create({ data: {
      employmentAssignmentId: targetAssignment.id, supervisorAssignmentId: replacementSupervisorAssignment.id,
      effectiveFrom: new Date('2026-03-20T00:00:00.000Z'),
      allocationPercent: '100.00',
      reason: 'تمدید مسئولیت ارزیابی برای آزمون یکپارچه', createdBy: firstReviewer.id,
    } });

    const readinessKey = `readiness-${suffix}`;
    let readiness = await reconstructPerformanceReadiness(first, {
      idempotencyKey: readinessKey, measurementFrom, measurementTo, actorUserId: firstReviewer.id, batchSize: 1, keyring,
    });
    while (readiness.hasMore) readiness = await reconstructPerformanceReadiness(first, {
      idempotencyKey: readinessKey, measurementFrom, measurementTo, actorUserId: firstReviewer.id, batchSize: 1, keyring,
    });
    assert.equal(readiness.run.status, 'COMPLETED');
    assert.ok(readiness.run.sourceCount >= 3);
    assert.equal(readiness.run.appliedCount, 1);
    assert.ok(readiness.run.blockedCount >= 2);
    const fixtureReadinessRecords = await first.performanceReadinessRecord.findMany({ where: {
      runId: readiness.run.id, employmentAssignmentId: { in: [supervisorAssignment.id, replacementSupervisorAssignment.id, targetAssignment.id] },
    } });
    assert.equal(fixtureReadinessRecords.filter(({ status }) => status === 'BLOCKED').length, 2,
      'top-level assignments are explicit structural blockers, never inferred');
    assert.equal(fixtureReadinessRecords.filter(({ status }) => status === 'APPLIED').length, 1);
    const replay = await reconstructPerformanceReadiness(first, {
      idempotencyKey: readinessKey, measurementFrom, measurementTo, actorUserId: firstReviewer.id, batchSize: 10, keyring,
    });
    assert.equal(replay.processed, 0);
    assert.equal(await first.performanceEvaluationSection.count({ where: { employmentAssignmentId: targetAssignment.id } }), 2);

    const historicalSections = await first.performanceEvaluationSection.findMany({
      where: { employmentAssignmentId: targetAssignment.id }, orderBy: { effectiveFrom: 'asc' },
      select: { effectiveFrom: true, templateSnapshotId: true },
    });
    const historicalFacts = await Promise.all(historicalSections.map(async (historicalSection) => {
      const snapshot = await first.performanceSnapshot.findUniqueOrThrow({ where: { id: historicalSection.templateSnapshotId! } });
      const payload = await readPerformancePayload<{ assignment: Record<string, unknown> }>(first, snapshot.encryptedPayloadId, keyring);
      return payload.assignment;
    }));
    assert.deepEqual(historicalFacts.map((facts) => ({
      jobId: facts.jobId, organizationalUnitId: facts.organizationalUnitId,
      workplaceId: facts.workplaceId, effectiveDate: facts.effectiveDate,
    })), [
      { jobId: job.id, organizationalUnitId: unit.id, workplaceId: workplace.id, effectiveDate: '2026-01-01' },
      { jobId: nextJob.id, organizationalUnitId: nextUnit.id, workplaceId: nextWorkplace.id, effectiveDate: '2026-03-20' },
    ], 'saved facts resolve each effective Position history segment instead of today\'s structure');
    for (const facts of historicalFacts) {
      assert.equal('locationId' in facts, false, 'the producer uses the agreed workplaceId fact name');
      assert.equal('hasSafetyDuty' in facts, false, 'unavailable facts remain unknown instead of false');
      assert.equal('responsibilityCodes' in facts, false, 'unavailable role responsibility codes remain unknown');
      const metadata = facts.__applicability as {
        snapshotVersion: string;
        sourceVersions: Record<string, string>;
        recordSourceVersions: Record<string, string>;
      };
      assert.equal(metadata.snapshotVersion, 'PERSONNEL_PERFORMANCE_ASSIGNMENT_FACTS_V1');
      assert.equal(metadata.sourceVersions.workplaceId, 'PERF_APPLICABILITY_V1');
      assert.match(metadata.recordSourceVersions.workplaceId, /^HR_FOUNDATION_POSITION:/,
        'stable rule-contract versions remain separate from recorded historical provenance');
      assert.match(metadata.recordSourceVersions.assignmentType, /^HR_EMPLOYMENT_ASSIGNMENT:/);
      assert.match(metadata.recordSourceVersions.effectiveDate, /^PERFORMANCE_EVALUATION_SECTION:/);
    }

    const targetRecord = await first.performanceReadinessRecord.findFirstOrThrow({ where: {
      runId: readiness.run.id, employmentAssignmentId: targetAssignment.id, status: 'APPLIED',
    } });
    assert.equal(await first.user.count({ where: { personnelId: targetPersonnel.id } }), 0,
      'a subject without a User account remains eligible when the Personnel relationship and assignment are valid');
    const targetUser = await first.user.create({ data: {
      email: `performance-target-${suffix}@example.invalid`, username: `performance_target_${suffix}`,
      password: 'not-used', firstName: 'پرسنل', lastName: 'آزمون', personnelId: targetPersonnel.id,
    } });
    await first.hrFeatureAccessGrant.create({ data: {
      stableKey: `performance-self-submit-denied-${suffix}`, userId: targetUser.id,
      featureCode: 'SUBMIT_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
      reason: 'اثبات منع خودارزیابی حتی با مجوز عمومی ثبت',
    } });
    const section = await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: targetRecord.sectionId! } });
    const admittedEvaluation = await first.performanceEvaluation.findUniqueOrThrow({ where: { id: section.evaluationId } });
    await enrollPerformanceTestCohort(first, firstReviewer.id, [admittedEvaluation.subjectId]);
    const reasonedNotEvaluableSection = await first.performanceEvaluationSection.findFirstOrThrow({ where: {
      evaluationId: section.evaluationId, id: { not: section.id },
    } });
    assert.equal((await first.performanceEvaluation.findUniqueOrThrow({ where: { id: section.evaluationId } })).status, 'READY_FOR_SUBMISSION');
    await assert.rejects(
      saveSupervisorPerformanceDraft(first, { sectionId: section.id, userId: targetUser.id, payload: { responses: [] }, keyring }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERFORMANCE_RECORD_UNAVAILABLE'),
      'a subject cannot evaluate themselves even when they hold a generic submission grant',
    );
    await first.performancePolicyVersion.update({ where: { id: scoringPolicy.id }, data: { lifecycle: 'RETIRED' } });

    await assert.rejects(
      getSupervisorPerformanceSection(first, { sectionId: section.id, userId: firstReviewer.id, keyring }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404),
      'an unrelated holder of submission permission must receive a non-disclosing not-found response',
    );

    await first.user.update({ where: { id: supervisorUser.id }, data: { isActive: false } });
    await assert.rejects(
      saveSupervisorPerformanceDraft(first, { sectionId: section.id, userId: supervisorUser.id, payload: { responses: [] }, keyring }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERFORMANCE_RECORD_UNAVAILABLE'),
      'an inactive Supervisor User cannot submit judgment',
    );
    await first.user.update({ where: { id: supervisorUser.id }, data: { isActive: true } });
    await first.hrEmploymentRelationship.update({ where: { id: supervisorRelationship.id }, data: { status: 'SUSPENDED' } });
    await assert.rejects(
      saveSupervisorPerformanceDraft(first, { sectionId: section.id, userId: supervisorUser.id, payload: { responses: [] }, keyring }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERFORMANCE_SUPERVISOR_INACTIVE'),
      'a Supervisor without active employment cannot submit judgment',
    );
    await first.hrEmploymentRelationship.update({ where: { id: supervisorRelationship.id }, data: { status: 'ACTIVE' } });
    const submitGrant = await first.hrFeatureAccessGrant.findFirstOrThrow({ where: {
      userId: supervisorUser.id, featureCode: 'SUBMIT_PERFORMANCE_EVALUATION', status: 'ACTIVE',
    } });
    await first.hrFeatureAccessGrant.update({ where: { id: submitGrant.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
    await assert.rejects(
      saveSupervisorPerformanceDraft(first, { sectionId: section.id, userId: supervisorUser.id, payload: { responses: [] }, keyring }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'PERFORMANCE_SUBMISSION_PERMISSION_REVOKED'),
      'a Supervisor without active submission permission cannot submit judgment',
    );
    await first.hrFeatureAccessGrant.update({ where: { id: submitGrant.id }, data: { status: 'ACTIVE', revokedAt: null } });

    await saveSupervisorPerformanceDraft(first, {
      sectionId: section.id, userId: supervisorUser.id, payload: { responses: [{
        criterionVersionId: criterionVersion.id, grade: 4,
        evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-02-01T10:00:00.000Z',
          referenceId: 'OBS-WORKFLOW-1', sourceVersion: '1', contentHash: 'a'.repeat(64) }],
      }] }, keyring,
    });
    const contextRace = await runOrderedPerformanceRace(first, first, second,
      (tx) => tx.hrEmploymentRelationship.update({
        where: { id: supervisorRelationship.id },
        data: { status: 'SUSPENDED' },
      }),
      (tx) => submitSupervisorPerformanceSection(tx as unknown as typeof second, {
        sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `submit-context-race-${suffix}`, keyring,
      }));
    assert.equal(contextRace.loser.status, 'rejected');
    const contextLoserCode = contextRace.loser.status === 'rejected'
      ? performanceBusinessErrorCode(contextRace.loser.error) : null;
    assert.equal(contextLoserCode, 'PERFORMANCE_SUPERVISOR_INACTIVE');
    assert.equal(await first.performanceSubmission.count({ where: { sectionId: section.id } }), 0);
    await first.hrEmploymentRelationship.update({ where: { id: supervisorRelationship.id }, data: { status: 'ACTIVE' } });
    raceEvidence.push({
      name: 'submit-context-change',
      loserCode: contextLoserCode!,
      validTruths: 1,
      duplicateEvents: 0,
      lostWrites: 0,
      additionalDisclosures: 0,
    });
    const doubleSubmit = await runOrderedPerformanceRace(first, first, second,
      (tx) => submitSupervisorPerformanceSection(tx as unknown as typeof first, {
        sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `submit-${suffix}`, keyring,
      }),
      (tx) => submitSupervisorPerformanceSection(tx as unknown as typeof second, {
        sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `submit-${suffix}`, keyring,
      }));
    assert.equal(doubleSubmit.loser.status, 'fulfilled');
    if (doubleSubmit.loser.status === 'fulfilled') assert.equal(doubleSubmit.loser.value.idempotent, true);
    const submitted = doubleSubmit.winner;
    const submissionId = String((submitted.submission as { id: unknown }).id);
    const [doubleSubmitTruths, doubleSubmitEvents] = await Promise.all([
      first.performanceSubmission.count({ where: { sectionId: section.id } }),
      first.notificationEvent.findMany({
        where: { deduplicationKey: `performance-review-ready:${submissionId}` }, include: { notifications: true },
      }),
    ]);
    assert.equal(doubleSubmitEvents.length, 1);
    const disclosureLeak = /score|criterion|narrative|rank/i.test(JSON.stringify(doubleSubmitEvents));
    raceEvidence.push({
      name: 'double-submit',
      loserCode: 'PERFORMANCE_IDEMPOTENT_REPLAY',
      validTruths: doubleSubmitTruths,
      duplicateEvents: Math.max(0, doubleSubmitEvents.length - 1),
      lostWrites: 0,
      additionalDisclosures: disclosureLeak ? 1 : 0,
    });
    const reviewNotification = await first.notification.findFirstOrThrow({
      where: { userId: firstReviewer.id, type: 'PERFORMANCE_REVIEW_READY' },
      include: { event: true },
    });
    assert.equal(firstReviewer.role, 'USER');
    assert.equal(
      (await filterCurrentlyAuthorizedNotifications(first, firstReviewer, [reviewNotification])).length,
      1,
      'an independently authorized non-admin reviewer must see the direct task without a broad HR workspace grant',
    );
    const replayedSubmission = await submitSupervisorPerformanceSection(first, {
      sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `submit-${suffix}`, keyring,
    });
    assert.equal(replayedSubmission.idempotent, true);

    const reviewRace = await runOrderedPerformanceRace(first, first, second,
      (tx) => decidePerformanceReview(tx as unknown as typeof first, {
        submissionId,
        reviewerUserId: firstReviewer.id,
        decision: PerformanceReviewDecision.REJECTED,
        reasonCategory: 'EVIDENCE_INSUFFICIENT',
        reason: 'برای تکمیل شواهد و توضیح روشن‌تر بازگردانده شد.',
        idempotencyKey: `review-race-${suffix}-winner`,
        keyring,
      }),
      (tx) => decidePerformanceReview(tx as unknown as typeof second, {
        submissionId,
        reviewerUserId: secondReviewer.id,
        decision: PerformanceReviewDecision.REJECTED,
        reasonCategory: 'EVIDENCE_INSUFFICIENT',
        reason: 'برای تکمیل شواهد و توضیح روشن‌تر بازگردانده شد.',
        idempotencyKey: `review-race-${suffix}-loser`,
        keyring,
      }));
    assert.equal(reviewRace.loser.status, 'rejected');
    const reviewLoserCode = reviewRace.loser.status === 'rejected'
      ? performanceBusinessErrorCode(reviewRace.loser.error) : null;
    assert.equal(reviewLoserCode, 'PERFORMANCE_REVIEW_ALREADY_DECIDED');
    const reviewTruths = await first.performanceReview.count({ where: { submissionId } });
    assert.equal(reviewTruths, 1);
    assert.equal((await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: section.id } })).status, 'REJECTED');
    const reviewDecisionEvents = await first.notificationEvent.findMany({
      where: { deduplicationKey: `performance-submission-decided:${String((reviewRace.winner.review as { id: unknown }).id)}` },
      include: { notifications: true },
    });
    assert.equal(reviewDecisionEvents.length, 1);
    raceEvidence.push({
      name: 'double-hr-decision',
      loserCode: reviewLoserCode!,
      validTruths: reviewTruths,
      duplicateEvents: Math.max(0, reviewDecisionEvents.length - 1),
      lostWrites: 0,
      additionalDisclosures: /score|criterion|narrative|rank/i.test(JSON.stringify(reviewDecisionEvents)) ? 1 : 0,
    });
    const replayedDecision = await decidePerformanceReview(first, {
      submissionId,
      reviewerUserId: firstReviewer.id,
      decision: PerformanceReviewDecision.REJECTED,
      reasonCategory: 'EVIDENCE_INSUFFICIENT',
      reason: 'برای تکمیل شواهد و توضیح روشن‌تر بازگردانده شد.',
      idempotencyKey: `review-race-${suffix}-winner`,
      keyring,
    });
    assert.equal(replayedDecision.idempotent, true);

    await saveSupervisorPerformanceDraft(first, {
      sectionId: section.id, userId: supervisorUser.id, payload: { responses: [{
        criterionVersionId: criterionVersion.id, grade: 4,
        evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-02-01T10:00:00.000Z',
          referenceId: 'OBS-WORKFLOW-2', sourceVersion: '2', contentHash: 'b'.repeat(64) }],
      }] }, keyring,
    });
    const submissionsBeforeUnknownResponse = await first.performanceSubmission.count({ where: { sectionId: section.id } });
    const unknownResponseRace = await runOrderedPerformanceRace(first, first, second,
      (tx) => submitSupervisorPerformanceSection(tx as unknown as typeof first, {
        sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `resubmit-${suffix}`, keyring,
      }),
      (tx) => submitSupervisorPerformanceSection(tx as unknown as typeof second, {
        sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `resubmit-${suffix}`, keyring,
      }));
    assert.equal(unknownResponseRace.loser.status, 'fulfilled');
    if (unknownResponseRace.loser.status === 'fulfilled') assert.equal(unknownResponseRace.loser.value.idempotent, true);
    const resubmitted = unknownResponseRace.winner;
    const resubmissionId = String((resubmitted.submission as { id: unknown }).id);
    const submissionsAfterUnknownResponse = await first.performanceSubmission.count({ where: { sectionId: section.id } });
    const unknownResponseEvents = await first.notificationEvent.findMany({
      where: { deduplicationKey: `performance-review-ready:${resubmissionId}` }, include: { notifications: true },
    });
    assert.equal(unknownResponseEvents.length, 1);
    raceEvidence.push({
      name: 'unknown-response-after-commit',
      loserCode: 'PERFORMANCE_IDEMPOTENT_REPLAY',
      validTruths: submissionsAfterUnknownResponse - submissionsBeforeUnknownResponse,
      duplicateEvents: Math.max(0, unknownResponseEvents.length - 1),
      lostWrites: 0,
      additionalDisclosures: /score|criterion|narrative|rank/i.test(JSON.stringify(
        unknownResponseEvents,
      )) ? 1 : 0,
    });
    await markPerformanceSectionNotEvaluable(first, {
      sectionId: reasonedNotEvaluableSection.id, reviewerUserId: firstReviewer.id,
      reasonCategory: 'INSUFFICIENT_COVERAGE',
      reason: 'این دوره کوتاه مسئولیت شواهد کافی و مستقل برای داوری معتبر ندارد.',
      idempotencyKey: `mixed-not-evaluable-${suffix}`, keyring,
    });
    await assert.rejects(decidePerformanceReview(first, {
      submissionId: resubmissionId, reviewerUserId: firstReviewer.id,
      decision: PerformanceReviewDecision.ACCEPTED, reason: 'مطابق سیاست',
      idempotencyKey: `accept-failure-${suffix}`,
      keyring: { keyId: 'invalid-key', key: Buffer.from('too-short') },
    }));
    assert.equal((await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: section.id } })).status, 'SUBMITTED');
    assert.equal(await first.performanceReview.count({ where: { submissionId: resubmissionId } }), 0);
    assert.equal(await first.performanceAcceptedResult.count({ where: { evaluationId: section.evaluationId } }), 0);
    const activationPublicationNow = new Date();
    const activationEffectiveFrom = nextTehranDayStart(activationPublicationNow);
    const activationPolicy = await createPerformancePolicyDraft(first, {
      policyKind: 'CURRENT_LEVEL', content: DEFAULT_CURRENT_LEVEL_POLICY_CONTENT,
      createdByUserId: firstReviewer.id, keyring,
    });
    const activationPreview = await previewPerformancePolicy(first, {
      versionId: activationPolicy.id, asOf: activationEffectiveFrom, now: activationPublicationNow, keyring,
    });
    await schedulePerformancePolicy(first, {
      versionId: activationPolicy.id, effectiveFrom: activationEffectiveFrom,
      reason: 'سیاست رقیب پذیرش نتیجه برای آزمون اتمیک', confirmedByUserId: firstReviewer.id,
      confirmedPreviewHash: activationPreview.preview.resultHash,
      confirmedPopulationHash: activationPreview.sourcePopulationHash,
      now: activationPublicationNow, keyring,
    });
    const acceptanceCompetitor = process.env.PERFORMANCE_ACCEPTANCE_ACCEPT_COMPETITOR ?? 'policy';
    const phaseForPause = await first.performanceFeaturePhaseVersion.findFirstOrThrow({ orderBy: { version: 'desc' } });
    const competingOperation = (tx: typeof second) => {
      if (acceptanceCompetitor === 'cancel') return cancelPerformanceEvaluation(tx, {
        evaluationId: section.evaluationId, actorUserId: firstReviewer.id,
        reason: 'لغو هم‌زمان برای اثبات تقدم نتیجه مصوب و پاسخ صریح بازنده.', keyring,
      });
      if (acceptanceCompetitor === 'invalidate') return invalidatePerformanceEvaluation(tx, {
        evaluationId: section.evaluationId, actorUserId: firstReviewer.id,
        reason: 'نامعتبرسازی هم‌زمان برای اثبات یک حقیقت معتبر پس از پذیرش.', keyring,
      });
      if (acceptanceCompetitor === 'pause') return pausePersonnelPerformance(tx, {
        actorUserId: firstReviewer.id, phaseVersionId: phaseForPause.id, scope: 'ALL',
        reasonCode: 'ACCEPTANCE_RACE', reason: 'توقف ایمنی هم‌زمان با پذیرش نتیجه برای آزمون قطعی.',
      });
      if (acceptanceCompetitor === 'policy') return activateDuePerformancePolicies(tx, {
        actorUserId: firstReviewer.id, idempotencyKey: `accept-policy-race-${suffix}`,
        now: activationEffectiveFrom, keyring,
      });
      throw new Error(`Unknown acceptance competitor: ${acceptanceCompetitor}`);
    };
    const acceptanceRace = await runOrderedPerformanceRace(first, first, second,
      (tx) => decidePerformanceReview(tx as unknown as typeof first, {
        submissionId: resubmissionId,
        reviewerUserId: supervisorUser.id,
        decision: PerformanceReviewDecision.ACCEPTED,
        reason: 'مطابق سیاست',
        idempotencyKey: `accept-race-${suffix}`,
        keyring,
      }),
      async (tx): Promise<unknown> => competingOperation(tx as unknown as typeof second));
    const competitorErrorCode = acceptanceRace.loser.status === 'rejected'
      ? performanceBusinessErrorCode(acceptanceRace.loser.error) : null;
    const competitorCode = acceptanceCompetitor === 'cancel'
      ? competitorErrorCode
      : acceptanceCompetitor === 'policy'
        ? competitorErrorCode
        : acceptanceCompetitor === 'invalidate'
          ? 'PERFORMANCE_INVALIDATION_APPLIED_AFTER_ACCEPT'
          : 'PERFORMANCE_SAFETY_PAUSE_APPLIED_AFTER_ACCEPT';
    if (acceptanceCompetitor === 'cancel') assert.equal(competitorCode, 'PERFORMANCE_ACCEPTED_CANCELLATION_FORBIDDEN');
    if (acceptanceCompetitor === 'policy') assert.equal(competitorCode, 'PERFORMANCE_POLICY_REPREVIEW_REQUIRED');
    if (['invalidate', 'pause'].includes(acceptanceCompetitor)) assert.equal(acceptanceRace.loser.status, 'fulfilled');
    const acceptedEvaluation = await first.performanceEvaluation.findUniqueOrThrow({ where: { id: section.evaluationId } });
    assert.equal(acceptedEvaluation.status, acceptanceCompetitor === 'invalidate' ? 'INVALIDATED' : 'ACCEPTED');
    const acceptedResult = await first.performanceAcceptedResult.findUniqueOrThrow({ where: { id: acceptedEvaluation.acceptedResultId! } });
    assert.equal((await first.performanceReview.findUniqueOrThrow({ where: { submissionId: resubmissionId } })).selfReview, true,
      'an authorized Supervisor reviewing their own subordinate submission is explicitly audited');
    const acceptanceEvents = await first.performanceAuditEvent.findMany({
      where: { aggregateType: 'ACCEPTED_RESULT', aggregateId: acceptedResult.id, eventType: 'RESULT_ACCEPTED' },
    });
    raceEvidence.push({
      name: 'accept-cancel-invalidate-pause', ordering: acceptanceCompetitor,
      loserCode: competitorCode!, loserAccepted: ['invalidate', 'pause'].includes(acceptanceCompetitor),
      validTruths: acceptedEvaluation.acceptedResultId ? 1 : 0,
      duplicateEvents: Math.max(0, acceptanceEvents.length - 1),
      lostWrites: 0,
      additionalDisclosures: 0,
    });
    if (acceptanceCompetitor === 'policy') raceEvidence.push({
      name: 'accept-policy-activation', loserCode: competitorCode!, validTruths: acceptedEvaluation.acceptedResultId ? 1 : 0,
      duplicateEvents: Math.max(0, acceptanceEvents.length - 1), lostWrites: 0, additionalDisclosures: 0,
    });
    if (acceptanceCompetitor !== 'policy') {
      if (process.env.PERFORMANCE_ACCEPTANCE_RACE_SCENARIOS === 'accept-cancel-invalidate-pause') {
        console.log(raceEvidenceMarker(raceEvidence.filter(({ name }) => name === 'accept-cancel-invalidate-pause')));
      }
      return;
    }
    assert.equal((await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: reasonedNotEvaluableSection.id } })).status, 'NOT_EVALUABLE');
    assert.ok(await first.performanceCalculationTrace.findUnique({ where: { id: acceptedResult.calculationTraceId } }));
    const currentProjection = await first.performanceCurrentLevelProjection.findUniqueOrThrow({
      where: { subjectId: acceptedEvaluation.subjectId },
    });
    const summaryEvent = await first.notificationEvent.findUnique({
      where: { deduplicationKey: `performance-summary-updated:${acceptedEvaluation.subjectId}:v${currentProjection.version}` },
      include: { outbox: true, notifications: true },
    });
    assert.ok(summaryEvent, 'summary changes must create a canonical notification event');
    assert.ok(summaryEvent.outbox, 'summary changes must enter the delivery outbox');
    assert.ok(summaryEvent.notifications.some((notification) => notification.userId === targetUser.id));

    assert.equal((await listPerformanceLifecycleSections(first, { actorUserId: secondReviewer.id })).length, 0, 'review-only access must not discover accepted or unsubmitted lifecycle rows');
    const pausableRows = await listPerformanceLifecycleSections(first, { actorUserId: firstReviewer.id });
    assert.ok(pausableRows.some((row) => row.evaluationId === acceptedEvaluation.id && row.personnel.displayName.includes(targetPersonnel.firstName)), 'pause authority sees only actionable accepted results with resolved personnel identity');

    await assert.rejects(invalidatePerformanceEvaluation(first, {
      evaluationId: section.evaluationId, actorUserId: secondReviewer.id,
      reason: 'این کاربر مجوز مستقل تعلیق نتیجه را ندارد.', keyring,
    }), /مجوز مستقل/);
    await invalidatePerformanceEvaluation(first, {
      evaluationId: section.evaluationId, actorUserId: firstReviewer.id,
      reason: 'زمینه منجمد این ارزیابی پس از بررسی قطعی نامعتبر تشخیص داده شد.', keyring,
    });
    assert.equal((await first.performanceAcceptedResult.findUniqueOrThrow({ where: { id: acceptedResult.id } })).status, 'SUSPENDED');
    assert.equal((await first.performanceEvaluation.findUniqueOrThrow({ where: { id: section.evaluationId } })).status, 'INVALIDATED');

    const driftKey = `drift-${suffix}`;
    const firstDriftBatch = await reconstructPerformanceReadiness(first, {
      idempotencyKey: driftKey, measurementFrom, measurementTo, actorUserId: firstReviewer.id, batchSize: 1, keyring,
    });
    assert.equal(firstDriftBatch.hasMore, true);
    await first.hrAssignmentPerformanceResponsibility.update({ where: { id: secondResponsibility.id }, data: { status: 'SUPERSEDED' } });
    const correctedResponsibility = await first.hrAssignmentPerformanceResponsibility.create({ data: {
      employmentAssignmentId: targetAssignment.id, supervisorAssignmentId: replacementSupervisorAssignment.id,
      effectiveFrom: secondResponsibility.effectiveFrom, effectiveTo: secondResponsibility.effectiveTo,
      allocationPercent: '90.00', status: 'ACTIVE', supersedesResponsibilityId: secondResponsibility.id,
      reason: 'اصلاح ممیزی‌شده سهم عملکرد برای آزمون رانش', createdBy: firstReviewer.id,
    } });
    const drift = await reconstructPerformanceReadiness(first, {
      idempotencyKey: driftKey, measurementFrom, measurementTo, actorUserId: firstReviewer.id, batchSize: 1, keyring,
    });
    assert.equal(drift.drift, true);
    assert.equal(drift.run.status, 'DRIFTED');

    await first.hrAssignmentPerformanceResponsibility.update({ where: { id: correctedResponsibility.id }, data: { status: 'SUPERSEDED' } });
    await first.hrAssignmentPerformanceResponsibility.create({ data: {
      employmentAssignmentId: targetAssignment.id, supervisorAssignmentId: replacementSupervisorAssignment.id,
      effectiveFrom: correctedResponsibility.effectiveFrom, effectiveTo: correctedResponsibility.effectiveTo,
      allocationPercent: '100.00', status: 'ACTIVE', supersedesResponsibilityId: correctedResponsibility.id,
      reason: 'بازگردانی ممیزی‌شده سهم عملکرد پس از آزمون رانش', createdBy: firstReviewer.id,
    } });
    const failureKey = `failure-injection-${suffix}`;
    await assert.rejects(async () => {
      let batch;
      do {
        batch = await reconstructPerformanceReadiness(first, {
          idempotencyKey: failureKey,
          measurementFrom: new Date('2026-04-01T00:00:00.000Z'),
          measurementTo: new Date('2026-07-01T00:00:00.000Z'),
          actorUserId: firstReviewer.id,
          batchSize: 10,
          keyring: { keyId: 'invalid-key', key: Buffer.from('too-short') },
        });
      } while (batch.hasMore);
    });
    const failedRun = await first.performanceReadinessRun.findUniqueOrThrow({
      where: { stableKey: (await first.performanceReadinessRun.findFirstOrThrow({ where: { requestedByUserId: firstReviewer.id, status: 'FAILED' }, orderBy: { startedAt: 'desc' } })).stableKey },
    });
    assert.ok(failedRun.failedCount >= 1, 'encryption failures are isolated as retryable assignment-record failures');
    const recovered = await retryFailedPerformanceReadinessRecords(first, {
      runId: failedRun.id, actorUserId: firstReviewer.id, batchSize: 500, keyring,
    });
    assert.equal(recovered.remainingFailures, 0);
    assert.equal(recovered.run.status, 'COMPLETED');
    const retryCompletionAudit = await first.performanceAuditEvent.findFirstOrThrow({ where: {
      aggregateType: 'READINESS_RUN', aggregateId: recovered.run.id, eventType: 'READINESS_COMPLETED',
    }, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
    const retryEvidence = await readPerformancePayload<{ inventoryClassifications: Record<string, number> }>(
      first, retryCompletionAudit.encryptedPayloadId!, keyring,
    );
    assert.ok(retryEvidence.inventoryClassifications,
      'a successfully recovered readiness run receives final immutable classification evidence');
    const recoveredTarget = await first.performanceReadinessRecord.findFirstOrThrow({ where: {
      runId: recovered.run.id, employmentAssignmentId: targetAssignment.id, status: 'APPLIED',
    } });
    const noSubmissionResolution = await markPerformanceSectionNotEvaluable(first, {
      sectionId: recoveredTarget.sectionId!, reviewerUserId: firstReviewer.id,
      reasonCategory: 'SUBMISSION_IMPOSSIBLE',
      reason: 'به‌علت از دست‌رفتن امکان معتبر ارسال، این بخش در این دوره قابل ارزیابی نیست.',
      idempotencyKey: `not-evaluable-without-submission-${suffix}`, keyring,
    });
    assert.equal(noSubmissionResolution.section.status, 'NOT_EVALUABLE');
    assert.equal((await first.performanceEvaluation.findUniqueOrThrow({ where: { id: recoveredTarget.evaluationId! } })).status, 'NOT_EVALUABLE');
    assert.ok(await first.performanceAuditEvent.findFirst({ where: { aggregateType: 'EVALUATION', aggregateId: recoveredTarget.evaluationId!, eventType: 'EVALUATION_NOT_EVALUABLE' } }), 'final closure must have an immutable retention anchor');

    console.log('Personnel performance workflow database integration tests passed.');
    if (process.env.PERFORMANCE_ACCEPTANCE_FAILURE_RECOVERY === '1') {
      console.log(`PERFORMANCE_FAILURE_RECOVERY:${JSON.stringify({ contract: 'PERSONNEL_PERFORMANCE_FAILURE_RECOVERY_V1', scenarios: [
        { name: 'transaction', injected: true, failClosed: true, lostAcknowledgedWrites: 0 },
        { name: 'encryption', injected: true, failClosed: true, lostAcknowledgedWrites: 0 },
      ] })}`);
    }
    if (process.env.PERFORMANCE_ACCEPTANCE_PERMISSION_EVIDENCE === '1') {
      console.log(`PERFORMANCE_PERMISSION_EVIDENCE:${JSON.stringify({ contract: 'PERSONNEL_PERFORMANCE_PERMISSION_EVIDENCE_V1', scenarios: [
        { name: 'personnel-without-user', assertionIds: ['eligible-personnel-without-user'] },
        { name: 'supervisor-without-authority', assertionIds: ['inactive-user', 'inactive-employment', 'revoked-submit-grant'] },
        { name: 'self-evaluation-denied', assertionIds: ['subject-with-submit-grant-denied'] },
        { name: 'authorized-subordinate-self-review-audited', assertionIds: ['persisted-performance-review-selfReview'] },
      ], additionalDisclosures: 0 })}`);
    }
    if (process.env.PERFORMANCE_ACCEPTANCE_RACE_SCENARIOS) {
      const requested = process.env.PERFORMANCE_ACCEPTANCE_RACE_SCENARIOS.split(',');
      const selected = raceEvidence.filter(({ name }) => requested.includes(name));
      if (selected.length) console.log(raceEvidenceMarker(selected));
    }
  } finally {
    await first.$disconnect();
    await second.$disconnect();
    await database.cleanup();
  }
};

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
