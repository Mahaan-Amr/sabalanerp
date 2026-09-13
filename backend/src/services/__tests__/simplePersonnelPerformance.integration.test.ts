import assert from 'node:assert/strict';
import { prisma } from '../../lib/prisma';
import {
  assignSimplePerformanceProfile,
  createSimplePerformanceCorrection,
  createSimplePerformanceEvaluation,
  createSimplePerformanceProfile,
  finalizeSimplePerformanceEvaluation,
  getSimplePerformanceBadges,
  getSimplePerformanceHistory,
  getSimplePerformanceWorkspace,
  resolveSimpleEvaluationAuthority,
  saveSimplePerformanceDraft,
} from '../simplePersonnelPerformanceStore';

const rollback = Symbol('rollback');
const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const main = async () => {
try {
  await prisma.$transaction(async (tx) => {
    const actor = await tx.user.create({ data: {
      email: 'simple-performance@example.invalid', username: 'simple_performance_test', password: 'not-used',
      firstName: 'مدیر', lastName: 'آزمون',
    } });
    const personnel = await tx.personnel.create({ data: { firstName: 'پرسنل', lastName: 'آزمون' } });
    const targetRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: personnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-test-grant', userId: actor.id, featureCode: 'EVALUATE_ALL_PERSONNEL',
      level: 'EDIT', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون ارزیابی ساده',
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

    const first = await createSimplePerformanceEvaluation(tx, { actorUserId: actor.id, personnelId: personnel.id, evaluationDate: today });
    await saveSimplePerformanceDraft(tx, {
      actorUserId: actor.id, evaluationId: first.id,
      values: profile.indicators.map((indicator) => ({ indicatorId: indicator.id, actual: indicator.target.toString() })),
    });
    const finalized = await finalizeSimplePerformanceEvaluation(tx, { actorUserId: actor.id, evaluationId: first.id });
    assert.equal(finalized.employmentRelationshipId, targetRelationship.id);
    assert.equal(finalized.score?.toString(), '100');
    assert.equal(finalized.levelCode, 'OUTSTANDING');

    const second = await createSimplePerformanceEvaluation(tx, { actorUserId: actor.id, personnelId: personnel.id, evaluationDate: today });
    assert.notEqual(second.id, first.id, 'more than one evaluation is allowed on the same day');

    const correction = await createSimplePerformanceCorrection(tx, { actorUserId: actor.id, evaluationId: first.id, reason: 'اصلاح مقدار فروش' });
    await finalizeSimplePerformanceEvaluation(tx, { actorUserId: actor.id, evaluationId: correction.id });
    const replaced = await tx.simplePerformanceEvaluation.findUniqueOrThrow({ where: { id: first.id } });
    assert.ok(replaced.supersededAt, 'a finalized correction replaces only its source result');
    assert.equal(second.status, 'DRAFT', 'an independent evaluation is not replaced by a correction');

    const badges = await getSimplePerformanceBadges(tx, [personnel.id]);
    assert.equal((badges[personnel.id] as { levelCode: string }).levelCode, 'OUTSTANDING');
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
      actorUserId: actor.id, stableKey: profile.stableKey, nameFa: profile.nameFa,
      indicators: profile.indicators.map((indicator) => ({
        code: indicator.code, categoryFa: indicator.categoryFa ?? undefined, titleFa: indicator.titleFa,
        unitFa: indicator.unitFa, target: indicator.target.toString(),
        direction: indicator.direction as 'HIGHER_IS_BETTER' | 'LOWER_IS_BETTER', weightPercent: indicator.weightPercent.toString(),
      })),
    });
    const movedAssignment = await tx.simplePerformanceProfileAssignment.findUniqueOrThrow({ where: { personnelId: personnel.id } });
    assert.equal(movedAssignment.profileId, nextProfile.id, 'a new profile version applies only to future evaluations');
    assert.equal(finalized.profileId, profile.id, 'a finalized evaluation keeps its original profile version');
    assert.equal(await tx.simplePerformanceAudit.count({ where: {
      actorUserId: actor.id, eventType: 'PROFILE_VERSION_CREATED',
    } }), 1, 'profile version creation is audited');
    assert.equal(await tx.simplePerformanceAudit.count({ where: {
      actorUserId: actor.id, personnelId: personnel.id, eventType: 'PROFILE_REASSIGNED',
    } }), 1, 'automatic profile reassignment is audited');

    const supervisorPersonnel = await tx.personnel.create({ data: { firstName: 'سرپرست', lastName: 'آزمون' } });
    const supervisor = await tx.user.create({ data: {
      email: 'simple-supervisor@example.invalid', username: 'simple_supervisor_test', password: 'not-used',
      firstName: 'سرپرست', lastName: 'آزمون', personnelId: supervisorPersonnel.id,
    } });
    await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: 'simple-performance-supervisor-grant', userId: supervisor.id, featureCode: 'EVALUATE_DIRECT_REPORTS',
      level: 'EDIT', effectiveFrom: new Date(Date.now() - 60_000), reason: 'آزمون دسترسی سرپرست',
    } });
    const supervisorRelationship = await tx.hrEmploymentRelationship.create({ data: {
      personnelId: supervisorPersonnel.id, status: 'ACTIVE', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    const supervisorAssignment = await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: supervisorRelationship.id, type: 'PRIMARY', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'), createdBy: actor.id,
    } });
    await tx.hrEmploymentAssignment.create({ data: {
      employmentRelationshipId: targetRelationship.id, type: 'PRIMARY', effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      responsibleSupervisorAssignmentId: supervisorAssignment.id, createdBy: actor.id,
    } });
    assert.equal(await resolveSimpleEvaluationAuthority(tx, { actorUserId: supervisor.id, personnelId: personnel.id }), 'SUPERVISOR');
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
    assert.equal((await getSimplePerformanceBadges(tx, [personnel.id]))[personnel.id], undefined,
      'a badge from a previous employment relationship must not transfer to a new relationship');
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
