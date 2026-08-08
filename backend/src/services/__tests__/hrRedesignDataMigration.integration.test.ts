import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { HR_REDESIGN_CATALOG, runHrRedesignBackfill } from '../hrRedesignDataContracts';

const prisma = new PrismaClient();
const rollback = new Error('ROLLBACK_HR_REDESIGN_INTEGRATION_TEST');

const run = async () => {
  await assert.rejects(prisma.$transaction(async (tx) => {
    const suffix = `${Date.now()}`;
    const unlinkedUser = await tx.user.create({ data: {
      email: `hr-reconciliation-${suffix}@example.invalid`,
      username: `hr-reconciliation-${suffix}`,
      password: 'not-a-login-secret',
      firstName: 'Reconciliation',
      lastName: 'User',
    } });
    const personnelWithoutLogin = await tx.personnel.create({ data: {
      firstName: 'Same Name',
      lastName: `WithoutLogin-${suffix}`,
      isActive: false,
    } });
    const sameNamePersonnel = await tx.personnel.create({ data: {
      firstName: 'Same Name',
      lastName: `WithoutLogin-${suffix}`,
      isActive: false,
    } });
    const currentPersonnel = await tx.personnel.create({ data: {
      firstName: 'Current',
      lastName: `WithoutAssignment-${suffix}`,
      isActive: true,
    } });
    const planCountBefore = await tx.hrFormalAssessmentPlan.count();
    await runHrRedesignBackfill(tx, { apply: true });
    const repeatReport = await runHrRedesignBackfill(tx, { apply: true });

    assert.equal(repeatReport.totals.safeBackfills, 0);
    assert.equal(await tx.hrWorkspaceCatalog.count(), 1);
    assert.equal(await tx.hrFeatureCatalog.count(), HR_REDESIGN_CATALOG.workspaceFeatures.length);
    assert.equal(await tx.hrAuthorityCatalog.count(), HR_REDESIGN_CATALOG.businessAuthorities.length);
    assert.equal(await tx.hrResponsibilityTypeCatalog.count(), HR_REDESIGN_CATALOG.responsibilityTypes.length);
    assert.equal(await tx.hrFormalAssessmentPlan.count(), planCountBefore, 'legacy evidence must not create an assessment plan');
    assert.equal(
      await tx.hrAssessmentMigrationEvent.count(),
      await tx.hrJobApplication.count(),
      'each legacy Application receives exactly one neutral migration event',
    );
    const userReconciliationKey = `hr-redesign-v1:reconciliation:USER:${unlinkedUser.id}`;
    const unlinkedReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: userReconciliationKey }, include: { attentionFlags: true },
    });
    assert.equal(unlinkedReconciliation.primaryState, 'READY');
    assert.equal(unlinkedReconciliation.cutoverBlocker, false);
    assert.equal(unlinkedReconciliation.attentionFlags.some((flag) => flag.flagCode === 'USER_PERSONNEL_LINKAGE'), false);
    const personnelReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: `hr-redesign-v1:reconciliation:PERSONNEL:${personnelWithoutLogin.id}` },
      include: { attentionFlags: true },
    });
    assert.equal(personnelReconciliation.primaryState, 'LEGACY_ONLY_HISTORY');
    assert.equal(personnelReconciliation.attentionFlags.some((flag) => flag.flagCode === 'USER_PERSONNEL_LINKAGE'), false);
    const sameNameReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: `hr-redesign-v1:reconciliation:PERSONNEL:${sameNamePersonnel.id}` },
      include: { attentionFlags: true },
    });
    assert.equal(sameNameReconciliation.primaryState, 'LEGACY_ONLY_HISTORY');
    assert.equal(sameNameReconciliation.attentionFlags.some((flag) => flag.flagCode === 'IDENTITY_AMBIGUITY'), false);

    const currentKey = `hr-redesign-v1:reconciliation:PERSONNEL:${currentPersonnel.id}`;
    const currentReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: currentKey }, include: { attentionFlags: true },
    });
    assert.equal(currentReconciliation.cutoverBlocker, true);
    assert.equal(currentReconciliation.attentionFlags.some((flag) => flag.flagCode === 'CURRENT_ASSIGNMENT_GAP' && flag.isActive), true);
    await tx.personnel.update({ where: { id: currentPersonnel.id }, data: { isActive: false } });
    await runHrRedesignBackfill(tx, { apply: true });
    const resolvedReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: currentKey },
      include: { attentionFlags: { orderBy: { version: 'desc' } }, cutoverBlockers: true },
    });
    assert.equal(resolvedReconciliation.cutoverBlocker, false);
    assert.equal(resolvedReconciliation.attentionFlags.filter((flag) => ['CURRENT_ASSIGNMENT_GAP', 'EMPLOYMENT_INCONSISTENCY'].includes(flag.flagCode)).every((flag) => !flag.isActive), true);
    assert.equal(resolvedReconciliation.cutoverBlockers.every((blocker) => !blocker.isActive), true);
    throw rollback;
  }, { timeout: 180_000 }), (error) => error === rollback);

  const position = await prisma.hrPosition.findFirst({ select: { id: true } });
  if (position) {
    await assert.rejects(prisma.hrPositionCapacityChange.create({
      data: {
        stableKey: `constraint-test:${Date.now()}`,
        positionId: position.id,
        version: 2_147_483_647,
        previousCapacity: 1,
        newCapacity: 0,
        effectiveAt: new Date(),
        reason: 'constraint verification',
        changedByUserId: 'constraint-test',
      },
    }));
  }

  const application = await prisma.hrJobApplication.findFirst({ select: { id: true } });
  if (application) {
    const suffix = `${Date.now()}`;
    const plan = await prisma.hrFormalAssessmentPlan.create({ data: {
      stableKey: `constraint-plan:${suffix}`,
      applicationId: application.id,
      version: 2_147_483_647,
      status: 'SUPERSEDED',
      finalizedByUserId: 'constraint-test',
    } });
    const selection = await prisma.hrFormalAssessmentPlanSelection.create({ data: {
      planId: plan.id,
      assessmentKind: 'DISC',
      selected: true,
      executionMethod: 'APPLICANT',
    } });
    try {
      await assert.rejects(prisma.hrFormalAssessmentResult.create({ data: {
        stableKey: `constraint-result:${suffix}`,
        applicationId: application.id,
        planId: plan.id,
        planSelectionId: selection.id,
        assessmentKind: 'EQ',
        resultVersion: 1,
      } }), (error) => error instanceof Error, 'a result kind must match its exact plan selection');
    } finally {
      await prisma.hrFormalAssessmentPlanSelection.delete({ where: { id: selection.id } });
      await prisma.hrFormalAssessmentPlan.delete({ where: { id: plan.id } });
    }

    await assert.rejects(prisma.$transaction(async (tx) => {
      const explicitNoAssessmentPlan = await tx.hrFormalAssessmentPlan.create({ data: {
        stableKey: `constraint-no-assessment:${Date.now()}`,
        applicationId: application.id,
        version: 2_147_483_646,
        status: 'SUPERSEDED',
        explicitlyNoAssessment: true,
        finalizedByUserId: 'constraint-test',
      } });
      await tx.hrFormalAssessmentPlanSelection.create({ data: {
        planId: explicitNoAssessmentPlan.id,
        assessmentKind: 'DISC',
        selected: true,
        executionMethod: 'APPLICANT',
      } });
    }), (error) => error instanceof Error, 'an explicit no-assessment plan cannot contain selected assessments');
  }

  console.log('HR redesign data migration integration tests passed.');
};

run().finally(() => prisma.$disconnect());
