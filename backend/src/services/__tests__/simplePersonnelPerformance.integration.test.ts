import assert from 'node:assert/strict';
import { prisma } from '../../lib/prisma';
import {
  assignSimplePerformanceProfile,
  appealSimplePerformanceEvaluation,
  createSimplePerformanceCorrection,
  createSimplePerformanceEvaluation,
  createSimplePerformanceProfile,
  finalizeSimplePerformanceEvaluation,
  getSimplePerformanceBadges,
  getSimplePerformanceHistory,
  getSimplePerformanceWorkspace,
  resolveSimpleEvaluationAuthority,
  resolveSimplePerformanceAppeal,
  publishSimplePerformanceEvaluation,
  saveSimplePerformanceDraft,
  visibleSimplePerformancePersonnelIds,
} from '../simplePersonnelPerformanceStore';
import { sellerPerformancePeriodFor } from '../sellerPerformancePolicy';

const rollback = Symbol('rollback');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const completedEvaluationDay = '2026-03-20';
const proposalNow = new Date('2026-03-21T12:00:00.000Z');
const publicationNow = new Date('2026-03-29T12:00:00.000Z');
const currentPeriod = sellerPerformancePeriodFor(new Date());
const nextEffectivePeriodKey = currentPeriod.half === 1 ? `${currentPeriod.persianYear}-H2` : `${currentPeriod.persianYear + 1}-H1`;

const main = async () => {
try {
  await prisma.$transaction(async (tx) => {
    const actor = await tx.user.create({ data: {
      email: 'simple-performance@example.invalid', username: 'simple_performance_test', password: 'not-used',
      firstName: 'مدیر', lastName: 'آزمون',
    } });
    const personnel = await tx.personnel.create({ data: { firstName: 'پرسنل', lastName: 'آزمون' } });
    const personnelUser = await tx.user.create({ data: {
      email: 'simple-performance-target@example.invalid', username: 'simple_performance_target', password: 'not-used',
      firstName: 'پرسنل', lastName: 'آزمون', personnelId: personnel.id,
    } });
    const targetRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: targetRelationship.id, type: 'PRIMARY',
      effectiveFrom: new Date('2025-01-01T00:00:00.000Z'), performanceAllocationPercent: 100, createdBy: actor.id,
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-test-grant', userId: actor.id, featureCode: 'EVALUATE_ALL_PERSONNEL',
      level: 'EDIT', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون ارزیابی ساده',
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-finalize-grant', userId: actor.id, featureCode: 'FINALIZE_PERFORMANCE_RESULTS',
      level: 'ADMIN', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون نهایی‌سازی ارزیابی',
    } });
    const profile = await tx.simplePerformanceProfile.findUniqueOrThrow({
      where: { id: 'simple-profile-sales-v1' }, include: { indicators: { orderBy: { sortOrder: 'asc' } } },
    });
    await assignSimplePerformanceProfile(tx, { actorUserId: actor.id, personnelId: personnel.id, profileId: profile.id });

    const unresolvedDraft = await tx.simplePerformanceEvaluation.create({ data: {
      personnelId: personnel.id, employmentRelationshipId: null, employmentBindingStatus: 'LEGACY_UNRESOLVED',
      profileId: profile.id, evaluationDate: new Date(`${today}T00:00:00.000Z`), evaluatorUserId: actor.id,
      evaluatorAuthority: 'HR_MANAGER',
    } });
    await assert.rejects(
      saveSimplePerformanceDraft(tx, { actorUserId: actor.id, evaluationId: unresolvedDraft.id, values: [] }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SIMPLE_EVALUATION_EMPLOYMENT_UNRESOLVED'),
    );

    const first = await createSimplePerformanceEvaluation(tx, { actorUserId: actor.id, personnelId: personnel.id, evaluationDate: completedEvaluationDay });
    await saveSimplePerformanceDraft(tx, {
      actorUserId: actor.id, evaluationId: first.id,
      values: profile.indicators.map((indicator) => ({ indicatorId: indicator.id, actual: indicator.target.toString() })),
    });
    assert.equal(await tx.simplePerformanceValueRevision.count({ where: { evaluationId: first.id } }), profile.indicators.length);
    await assert.rejects(saveSimplePerformanceDraft(tx, {
      actorUserId: actor.id, evaluationId: first.id,
      values: profile.indicators.map((indicator, index) => ({ indicatorId: indicator.id, actual: index ? indicator.target.toString() : indicator.target.add(1).toString() })),
    }), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SIMPLE_VALUE_CHANGE_REASON_REQUIRED'));
    await saveSimplePerformanceDraft(tx, {
      actorUserId: actor.id, evaluationId: first.id, reason: 'اصلاح مقدار بر پایه گزارش منبع',
      values: profile.indicators.map((indicator) => ({ indicatorId: indicator.id, actual: indicator.target.toString() })),
    });
    const proposed = await finalizeSimplePerformanceEvaluation(tx, { actorUserId: actor.id, evaluationId: first.id, now: proposalNow });
    assert.equal(proposed.status, 'PENDING_APPEAL');
    await appealSimplePerformanceEvaluation(tx, {
      actorUserId: personnelUser.id, evaluationId: first.id, text: 'این نتیجه نیاز به بازبینی شواهد وصول دارد.', now: proposalNow,
    });
    await assert.rejects(publishSimplePerformanceEvaluation(tx, {
      actorUserId: actor.id, evaluationId: first.id, now: publicationNow,
    }), (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SIMPLE_APPEAL_UNRESOLVED'));
    await resolveSimplePerformanceAppeal(tx, {
      actorUserId: actor.id, evaluationId: first.id, resolution: 'شواهد بررسی و نتیجه پیشنهادی تأیید شد.', now: publicationNow,
    });
    const finalized = await publishSimplePerformanceEvaluation(tx, { actorUserId: actor.id, evaluationId: first.id, now: publicationNow });
    assert.equal(finalized.employmentRelationshipId, targetRelationship.id);
    assert.equal(finalized.score?.toString(), '75');
    assert.equal(finalized.levelCode, 'CAPABLE');

    const second = await createSimplePerformanceEvaluation(tx, { actorUserId: actor.id, personnelId: personnel.id, evaluationDate: completedEvaluationDay });
    assert.notEqual(second.id, first.id, 'more than one evaluation is allowed on the same day');

    const correction = await createSimplePerformanceCorrection(tx, { actorUserId: actor.id, evaluationId: first.id, reason: 'اصلاح مقدار فروش' });
    await finalizeSimplePerformanceEvaluation(tx, { actorUserId: actor.id, evaluationId: correction.id, now: proposalNow });
    await publishSimplePerformanceEvaluation(tx, { actorUserId: actor.id, evaluationId: correction.id, now: publicationNow });
    const replaced = await tx.simplePerformanceEvaluation.findUniqueOrThrow({ where: { id: first.id } });
    assert.ok(replaced.supersededAt, 'a finalized correction replaces only its source result');
    assert.equal(second.status, 'DRAFT', 'an independent evaluation is not replaced by a correction');

    const badges = await getSimplePerformanceBadges(tx, [personnel.id]);
    assert.equal((badges[personnel.id] as { levelCode: string }).levelCode, 'CAPABLE');
    assert.ok(!(badges[personnel.id] as { meaningFa: string }).meaningFa.includes('100'));

    const evaluatorOnlyWorkspace = await getSimplePerformanceWorkspace(tx, actor.id);
    assert.ok(evaluatorOnlyWorkspace.evaluations.every((item) => item.status === 'DRAFT' && item.evaluatorUserId === actor.id));
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-view-history-grant', userId: actor.id, featureCode: 'VIEW_PERFORMANCE_EVALUATIONS',
      level: 'VIEW', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون مشاهده سابقه',
    } });
    const firstHistoryPage = await getSimplePerformanceHistory(tx, {
      actorUserId: actor.id, personnelId: personnel.id, page: 1, pageSize: 1,
    });
    assert.equal(firstHistoryPage.evaluations.length, 1);
    assert.equal(firstHistoryPage.total, 2);
    assert.equal(firstHistoryPage.hasMore, true);

    const nextProfile = await createSimplePerformanceProfile(tx, {
      actorUserId: actor.id, stableKey: profile.stableKey, nameFa: profile.nameFa, effectivePeriodKey: nextEffectivePeriodKey,
      indicators: profile.indicators.map((indicator) => ({
        code: indicator.code, categoryFa: indicator.categoryFa ?? undefined, titleFa: indicator.titleFa,
        unitFa: indicator.unitFa, target: indicator.target.toString(),
        direction: indicator.direction as 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER', weightPercent: indicator.weightPercent.toString(),
      })),
    });
    const movedAssignment = await tx.simplePerformanceProfileAssignment.findUniqueOrThrow({ where: { personnelId: personnel.id } });
    assert.equal(movedAssignment.profileId, profile.id, 'a future profile version does not reassign the started period');
    assert.equal(finalized.profileId, profile.id, 'a finalized evaluation keeps its original profile version');
    assert.equal(await tx.simplePerformanceAudit.count({ where: {
      actorUserId: actor.id, eventType: 'PROFILE_VERSION_CREATED',
    } }), 1, 'profile version creation is audited');
    assert.equal(await tx.simplePerformanceAudit.count({ where: {
      actorUserId: actor.id, personnelId: personnel.id, eventType: 'PROFILE_REASSIGNED',
    } }), 0, 'future target versions do not rewrite current assignments');

    const supervisorPersonnel = await tx.personnel.create({ data: { firstName: 'سرپرست', lastName: 'آزمون' } });
    const supervisor = await tx.user.create({ data: {
      email: 'simple-supervisor@example.invalid', username: 'simple_supervisor_test', password: 'not-used',
      firstName: 'سرپرست', lastName: 'آزمون', personnelId: supervisorPersonnel.id,
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-supervisor-grant', userId: supervisor.id, featureCode: 'EVALUATE_DIRECT_REPORTS',
      level: 'EDIT', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون دسترسی سرپرست',
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-supervisor-view-grant', userId: supervisor.id, featureCode: 'VIEW_PERFORMANCE_EVALUATIONS',
      level: 'VIEW', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون مشاهده سابقه افراد زیرمجموعه',
    } });
    const supervisorRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: supervisorPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    const unit = await tx.hrOrganizationalUnit.create({ data: {
      code: 'SIMPLE-PERFORMANCE-UNIT', name: 'فروش', type: 'DEPARTMENT', createdBy: actor.id,
    } });
    const job = await tx.hrJob.create({ data: { code: 'SIMPLE-PERFORMANCE-JOB', title: 'شغل آزمون', createdBy: actor.id } });
    const supervisorPosition = await tx.hrPosition.create({ data: {
      code: 'SIMPLE-PERFORMANCE-SUPERVISOR', title: 'سرپرست آزمون', capacity: 2,
      organizationalUnitId: unit.id, jobId: job.id, createdBy: actor.id,
    } });
    const targetPosition = await tx.hrPosition.create({ data: {
      code: 'SIMPLE-PERFORMANCE-TARGET', title: 'کارشناس آزمون',
      organizationalUnitId: unit.id, jobId: job.id, supervisorPositionId: supervisorPosition.id, createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: supervisorRelationship.id, positionId: supervisorPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), organizationalUnitId: unit.id, createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: targetRelationship.id, positionId: targetPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), organizationalUnitId: unit.id, createdBy: actor.id,
    } });
    assert.equal(await resolveSimpleEvaluationAuthority(tx, { actorUserId: supervisor.id, personnelId: personnel.id }), 'SUPERVISOR');
    assert.deepEqual(await visibleSimplePerformancePersonnelIds(tx, {
      actorUserId: supervisor.id, personnelIds: [personnel.id, supervisorPersonnel.id],
    }), [personnel.id], 'badge visibility is limited to current direct reports');
    assert.ok((await getSimplePerformanceHistory(tx, {
      actorUserId: supervisor.id, personnelId: personnel.id,
    })).evaluations.length > 0, 'a supervisor may view a current direct report history');
    await assert.rejects(
      createSimplePerformanceCorrection(tx, { actorUserId: supervisor.id, evaluationId: correction.id, reason: 'اصلاح آزمون سرپرست' }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'SIMPLE_CORRECTION_FORBIDDEN'),
      'a supervisor may not correct a result finalized by another evaluator',
    );
    const automaticProfilePersonnel = await tx.personnel.create({ data: { firstName: 'فرم', lastName: 'خودکار' } });
    const automaticProfileRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: automaticProfilePersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: automaticProfileRelationship.id, positionId: targetPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), organizationalUnitId: unit.id, createdBy: actor.id,
    } });
    const automaticProfileEvaluation = await createSimplePerformanceEvaluation(tx, {
      actorUserId: actor.id, personnelId: automaticProfilePersonnel.id, evaluationDate: today,
    });
    assert.equal(automaticProfileEvaluation.profileId, profile.id,
      'the active workbook profile matching the organizational unit applies without a personnel assignment');
    const automaticProfileWorkspace = await getSimplePerformanceWorkspace(tx, actor.id);
    assert.equal(
      automaticProfileWorkspace.assignments.find(({ personnelId }) => personnelId === automaticProfilePersonnel.id)?.profileId,
      profile.id,
      'the evaluation form exposes the automatically selected workbook profile',
    );
    const hrUnit = await tx.hrOrganizationalUnit.create({ data: {
      code: 'SIMPLE-PERFORMANCE-HR-UNIT', name: 'واحد آزمایشی منابع انسانی', type: 'DEPARTMENT', createdBy: actor.id,
    } });
    const hrPosition = await tx.hrPosition.create({ data: {
      code: 'SIMPLE-PERFORMANCE-HR-POSITION', title: 'کارشناس منابع انسانی',
      organizationalUnitId: hrUnit.id, jobId: job.id, createdBy: actor.id,
    } });
    const hrPersonnel = await tx.personnel.create({ data: { firstName: 'منابع', lastName: 'انسانی' } });
    const hrRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: hrPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: hrRelationship.id, positionId: hrPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), organizationalUnitId: hrUnit.id, createdBy: actor.id,
    } });
    const hrProfileEvaluation = await createSimplePerformanceEvaluation(tx, {
      actorUserId: actor.id, personnelId: hrPersonnel.id, evaluationDate: today,
    });
    assert.equal(hrProfileEvaluation.profileId, 'simple-profile-hr-v1',
      'common organizational-unit wording resolves to the matching workbook profile');
    const secondSupervisorPersonnel = await tx.personnel.create({ data: { firstName: 'سرپرست', lastName: 'دوم' } });
    const secondSupervisor = await tx.user.create({ data: {
      email: 'simple-second-supervisor@example.invalid', username: 'simple_second_supervisor_test', password: 'not-used',
      firstName: 'سرپرست', lastName: 'دوم', personnelId: secondSupervisorPersonnel.id,
    } });
    const secondSupervisorRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: secondSupervisorPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: secondSupervisorRelationship.id, positionId: supervisorPosition.id, type: 'PRIMARY',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), organizationalUnitId: unit.id, createdBy: actor.id,
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-second-supervisor-grant', userId: secondSupervisor.id, featureCode: 'EVALUATE_DIRECT_REPORTS',
      level: 'EDIT', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون دسترسی سرپرست دوم',
    } });
    await assert.rejects(
      resolveSimpleEvaluationAuthority(tx, { actorUserId: supervisor.id, personnelId: personnel.id }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
      'a multiply occupied supervisor position grants nobody automatic authority',
    );
    await assert.rejects(
      getSimplePerformanceHistory(tx, { actorUserId: supervisor.id, personnelId: personnel.id }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
      'a former or ambiguous supervisor loses access to the personnel history',
    );
    const unrelated = await tx.personnel.create({ data: { firstName: 'خارج', lastName: 'دامنه' } });
    await assert.rejects(
      resolveSimpleEvaluationAuthority(tx, { actorUserId: supervisor.id, personnelId: unrelated.id }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
    );

    const viewOnlyActor = await tx.user.create({ data: {
      email: 'simple-view-only@example.invalid', username: 'simple_view_only_test', password: 'not-used',
      firstName: 'مشاهده', lastName: 'آزمون',
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-view-level-edit-action', userId: viewOnlyActor.id, featureCode: 'EVALUATE_ALL_PERSONNEL',
      level: 'VIEW', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون سطح مجوز',
    } });
    await assert.rejects(
      resolveSimpleEvaluationAuthority(tx, { actorUserId: viewOnlyActor.id, personnelId: personnel.id }),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'status' in error && error.status === 403),
    );

    await tx.hrEmploymentRelationship.update({ where: { id: targetRelationship.id }, data: {
      status: 'ENDED', effectiveTo: new Date(Date.now() - 1_000),
    } });
    await tx.hrEmploymentRelationship.create({ data: {
      personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date(), createdBy: actor.id,
    } });
    assert.deepEqual((await getSimplePerformanceBadges(tx, [personnel.id]))[personnel.id], {
      state: 'LEVEL', levelCode: 'COMPANION', labelFa: 'همراه',
      meaningFa: 'هنوز نتیجه رسمی هفت‌سطحی ثبت نشده است.', version: 2, officialResult: false,
    }, 'a rehire starts at the visible companion level without transferring the former result');
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  await prisma.$disconnect();
}

console.log('Simple personnel performance integration tests passed.');
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
