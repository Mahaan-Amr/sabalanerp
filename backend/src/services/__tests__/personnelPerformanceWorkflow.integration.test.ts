import { enablePerformanceTestRelease } from './personnelPerformanceTestRelease';
import assert from 'node:assert/strict';
import path from 'node:path';
import { PerformanceReviewDecision } from '@prisma/client';
import { createDispatchDocumentsTemporaryDatabase } from './dispatchDocumentsTemporaryDatabase';
import { reconstructPerformanceReadiness, retryFailedPerformanceReadinessRecords } from '../personnelPerformanceReadinessStore';
import { DEFAULT_LEVEL_POLICY_CONTENT } from '../personnelPerformancePolicy';
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
import {
  decidePerformanceReview,
  getSupervisorPerformanceSection,
  invalidatePerformanceEvaluation,
  listPerformanceLifecycleSections,
  markPerformanceSectionNotEvaluable,
  saveSupervisorPerformanceDraft,
  submitSupervisorPerformanceSection,
} from '../personnelPerformanceWorkflowStore';

const repositoryRoot = path.resolve(process.cwd(), '..');
const sourceDatabaseUrl = process.env.DATABASE_URL
  ?? 'postgresql://postgres:sabalanerp-local-only@127.0.0.1:55432/sabalanerp?schema=public&connection_limit=4&pool_timeout=10';
const keyring = { keyId: 'workflow-integration-v1', key: Buffer.from('0123456789abcdef0123456789abcdef') };

const main = async () => {
  const database = await createDispatchDocumentsTemporaryDatabase({ repositoryRoot, sourceDatabaseUrl });
  const first = database.client();
  const second = database.client();
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
      { stableKey: `performance-review-a-${suffix}`, userId: firstReviewer.id, featureCode: 'REVIEW_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-pause-a-${suffix}`, userId: firstReviewer.id, featureCode: 'PAUSE_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-review-b-${suffix}`, userId: secondReviewer.id, featureCode: 'REVIEW_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون یکپارچه' },
      { stableKey: `performance-submit-nondisclosure-${suffix}`, userId: firstReviewer.id, featureCode: 'SUBMIT_PERFORMANCE_EVALUATION', level: 'EDIT', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), reason: 'آزمون عدم افشا' },
    ] });
    const unit = await first.hrOrganizationalUnit.create({ data: {
      code: `PERF-UNIT-${suffix}`, name: 'واحد آزمون عملکرد', type: 'DEPARTMENT', createdBy: firstReviewer.id,
    } });
    const job = await first.hrJob.create({ data: { code: `PERF-JOB-${suffix}`, title: 'شغل آزمون عملکرد', createdBy: firstReviewer.id } });
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
      reason: 'انتشار معیار آزمون گردش عملکرد', publishedByUserId: firstReviewer.id, now: publicationNow,
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
      reason: 'انتشار الگوی آزمون گردش عملکرد', publishedByUserId: firstReviewer.id, now: publicationNow,
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
      organizationalUnitId: unit.id, jobId: job.id, supervisorPositionId: supervisorPosition.id, createdBy: firstReviewer.id,
    } });
    const measurementFrom = new Date('2026-01-01T00:00:00.000Z');
    const measurementTo = new Date('2026-04-01T00:00:00.000Z');
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
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), organizationalUnitId: unit.id,
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
    assert.equal(readiness.run.sourceCount, 3);
    assert.equal(readiness.run.appliedCount, 1);
    assert.equal(readiness.run.blockedCount, 2, 'top-level assignments are explicit structural blockers, never inferred');
    const replay = await reconstructPerformanceReadiness(first, {
      idempotencyKey: readinessKey, measurementFrom, measurementTo, actorUserId: firstReviewer.id, batchSize: 10, keyring,
    });
    assert.equal(replay.processed, 0);
    assert.equal(await first.performanceEvaluationSection.count({ where: { employmentAssignmentId: targetAssignment.id } }), 2);

    const targetRecord = await first.performanceReadinessRecord.findFirstOrThrow({ where: {
      runId: readiness.run.id, employmentAssignmentId: targetAssignment.id, status: 'APPLIED',
    } });
    const section = await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: targetRecord.sectionId! } });
    const reasonedNotEvaluableSection = await first.performanceEvaluationSection.findFirstOrThrow({ where: {
      evaluationId: section.evaluationId, id: { not: section.id },
    } });
    assert.equal((await first.performanceEvaluation.findUniqueOrThrow({ where: { id: section.evaluationId } })).status, 'READY_FOR_SUBMISSION');
    await first.performancePolicyVersion.update({ where: { id: scoringPolicy.id }, data: { lifecycle: 'RETIRED' } });

    await assert.rejects(
      getSupervisorPerformanceSection(first, { sectionId: section.id, userId: firstReviewer.id, keyring }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 404),
      'an unrelated holder of submission permission must receive a non-disclosing not-found response',
    );

    await saveSupervisorPerformanceDraft(first, {
      sectionId: section.id, userId: supervisorUser.id, payload: { responses: [{
        criterionVersionId: criterionVersion.id, grade: 4,
        evidence: [{ kind: 'STRUCTURED_OBSERVATION', quality: 'RELIABLE', occurredAt: '2026-02-01T10:00:00.000Z',
          referenceId: 'OBS-WORKFLOW-1', sourceVersion: '1', contentHash: 'a'.repeat(64) }],
      }] }, keyring,
    });
    const submitted = await submitSupervisorPerformanceSection(first, {
      sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `submit-${suffix}`, keyring,
    });
    const submissionId = String((submitted.submission as { id: unknown }).id);
    const replayedSubmission = await submitSupervisorPerformanceSection(first, {
      sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `submit-${suffix}`, keyring,
    });
    assert.equal(replayedSubmission.idempotent, true);

    const races = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => decidePerformanceReview(
      index % 2 ? first : second,
      {
        submissionId,
        reviewerUserId: index % 2 ? firstReviewer.id : secondReviewer.id,
        decision: PerformanceReviewDecision.REJECTED,
        reasonCategory: 'EVIDENCE_INSUFFICIENT',
        reason: 'برای تکمیل شواهد و توضیح روشن‌تر بازگردانده شد.',
        idempotencyKey: `review-race-${suffix}-${index}`,
        keyring,
      },
    )));
    assert.equal(races.filter(({ status }) => status === 'fulfilled').length, 1, 'the first valid HR decision wins all deterministic contenders');
    assert.equal(await first.performanceReview.count({ where: { submissionId } }), 1);
    assert.equal((await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: section.id } })).status, 'REJECTED');
    const winningIndex = races.findIndex(({ status }) => status === 'fulfilled');
    const replayedDecision = await decidePerformanceReview(winningIndex % 2 ? first : second, {
      submissionId,
      reviewerUserId: winningIndex % 2 ? firstReviewer.id : secondReviewer.id,
      decision: PerformanceReviewDecision.REJECTED,
      reasonCategory: 'EVIDENCE_INSUFFICIENT',
      reason: 'برای تکمیل شواهد و توضیح روشن‌تر بازگردانده شد.',
      idempotencyKey: `review-race-${suffix}-${winningIndex}`,
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
    const resubmitted = await submitSupervisorPerformanceSection(first, {
      sectionId: section.id, userId: supervisorUser.id, idempotencyKey: `resubmit-${suffix}`, keyring,
    });
    const resubmissionId = String((resubmitted.submission as { id: unknown }).id);
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
    const acceptanceRaces = await Promise.allSettled(Array.from({ length: 100 }, (_, index) => decidePerformanceReview(
      index % 2 ? first : second,
      {
        submissionId: resubmissionId,
        reviewerUserId: index % 2 ? firstReviewer.id : secondReviewer.id,
        decision: PerformanceReviewDecision.ACCEPTED,
        reason: 'مطابق سیاست',
        idempotencyKey: `accept-race-${suffix}-${index}`,
        keyring,
      },
    )));
    assert.equal(
      acceptanceRaces.filter(({ status }) => status === 'fulfilled').length,
      1,
      `last-section acceptance has one atomic winner: ${acceptanceRaces.filter(({ status }) => status === 'rejected').slice(0, 3).map((result) => String((result as PromiseRejectedResult).reason)).join(' | ')}`,
    );
    const acceptedEvaluation = await first.performanceEvaluation.findUniqueOrThrow({ where: { id: section.evaluationId } });
    assert.equal(acceptedEvaluation.status, 'ACCEPTED');
    const acceptedResult = await first.performanceAcceptedResult.findUniqueOrThrow({ where: { id: acceptedEvaluation.acceptedResultId! } });
    assert.equal((await first.performanceEvaluationSection.findUniqueOrThrow({ where: { id: reasonedNotEvaluableSection.id } })).status, 'NOT_EVALUABLE');
    assert.ok(await first.performanceCalculationTrace.findUnique({ where: { id: acceptedResult.calculationTraceId } }));
    assert.ok(await first.performanceCurrentLevelProjection.findUnique({ where: { subjectId: acceptedEvaluation.subjectId } }));

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
    await assert.rejects(reconstructPerformanceReadiness(first, {
      idempotencyKey: failureKey,
      measurementFrom: new Date('2026-04-01T00:00:00.000Z'),
      measurementTo: new Date('2026-07-01T00:00:00.000Z'),
      actorUserId: firstReviewer.id,
      batchSize: 10,
      keyring: { keyId: 'invalid-key', key: Buffer.from('too-short') },
    }));
    const failedRun = await first.performanceReadinessRun.findUniqueOrThrow({
      where: { stableKey: (await first.performanceReadinessRun.findFirstOrThrow({ where: { requestedByUserId: firstReviewer.id, status: 'FAILED' }, orderBy: { startedAt: 'desc' } })).stableKey },
    });
    assert.equal(failedRun.failedCount, 1, 'encryption failure is isolated as a retryable record failure');
    const recovered = await retryFailedPerformanceReadinessRecords(first, {
      runId: failedRun.id, actorUserId: firstReviewer.id, batchSize: 10, keyring,
    });
    assert.equal(recovered.remainingFailures, 0);
    assert.equal(recovered.run.status, 'COMPLETED');
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

    console.log('Personnel performance workflow database integration tests passed.');
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
