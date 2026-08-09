import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { HR_REDESIGN_CATALOG, runHrRedesignBackfill } from '../hrRedesignDataContracts';
import { resolveHrNamedResponsibility } from '../hrAuthorizationService';

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
    const viewerBeforeRepeat = await tx.user.findUniqueOrThrow({ where: { username: 'qa_hr_viewer' } });
    const excessViewerGrant = await tx.hrFeatureAccessGrant.create({ data: {
      stableKey: `test:excess-viewer-grant:${suffix}`,
      userId: viewerBeforeRepeat.id,
      featureCode: 'PERSONNEL',
      level: 'ADMIN',
      effectiveFrom: new Date(),
      reason: 'Regression fixture',
    } });
    const repeatReport = await runHrRedesignBackfill(tx, { apply: true });

    assert.equal(repeatReport.totals.safeBackfills, 0);
    assert.equal(await tx.hrWorkspaceCatalog.count(), 1);
    assert.equal(await tx.hrFeatureCatalog.count(), HR_REDESIGN_CATALOG.workspaceFeatures.length);
    assert.equal(await tx.hrAuthorityCatalog.count(), HR_REDESIGN_CATALOG.businessAuthorities.length);
    assert.equal(await tx.hrResponsibilityTypeCatalog.count(), HR_REDESIGN_CATALOG.responsibilityTypes.length);
    assert.equal((await tx.hrFeatureAccessGrant.findUniqueOrThrow({ where: { id: excessViewerGrant.id } })).status, 'REVOKED');
    assert.equal(await tx.hrAuthorizationAuditEvent.count({ where: {
      entityType: 'FEATURE_GRANT', entityId: excessViewerGrant.id, action: 'QA_MATRIX_REVOKED',
    } }), 1, 'QA matrix revocations preserve before/after audit history');
    const financeManagerQa = await tx.user.findUniqueOrThrow({ where: { username: 'qa_finance_manager' } });
    assert.equal(await tx.hrWorkspaceAccessGrant.count({ where: { userId: financeManagerQa.id, status: 'ACTIVE' } }), 0, 'Finance QA receives no ordinary HR workspace access');
    assert.equal(await tx.hrFeatureAccessGrant.count({ where: { userId: financeManagerQa.id, status: 'ACTIVE' } }), 0, 'Finance QA receives no ordinary HR feature access');
    assert.equal(await tx.hrBusinessAuthorityGrant.count({ where: { userId: financeManagerQa.id, authorityCode: 'FINANCE_MANAGER', status: 'ACTIVE' } }), 1);
    const financeResolution = await resolveHrNamedResponsibility(tx, {
      sourceActionCode: 'QA_FINANCE_APPROVAL', responsibilityTypeCode: 'FINANCE_MANAGER',
      scopeType: 'GLOBAL', scopeId: null,
    });
    assert.equal(financeResolution.status, 'RESOLVED');
    if (financeResolution.status === 'RESOLVED') {
      assert.equal(financeResolution.assignedUserId, financeManagerQa.id);
      assert.equal(financeResolution.destination.workspaceCode, 'ACCOUNTING');
    }
    const hrViewerQa = await tx.user.findUniqueOrThrow({ where: { username: 'qa_hr_viewer' } });
    assert.equal(await tx.hrWorkspaceAccessGrant.count({ where: { userId: hrViewerQa.id, status: 'ACTIVE', level: 'VIEW' } }), 1);
    assert.equal(await tx.hrBusinessAuthorityGrant.count({ where: { userId: hrViewerQa.id, status: 'ACTIVE' } }), 0);
    const hiringManagerQa = await tx.user.findUniqueOrThrow({ where: { username: 'qa_hiring_manager' } });
    const hiringResponsibilities = await tx.hrNamedResponsibility.findMany({
      where: { assignedUserId: hiringManagerQa.id, responsibilityTypeCode: 'HIRING_MANAGER', effectiveTo: null },
    });
    assert.equal(hiringResponsibilities.every(({ scopeType, scopeId }) => scopeType === 'POSITION' && Boolean(scopeId)), true);
    assert.equal(await tx.hrResponsibilityDestination.count({ where: {
      responsibilityTypeCode: 'HIRING_MANAGER', isActive: true, workspaceCode: 'PERSONAL',
      stableKey: { startsWith: 'hr-redesign-v1:qa-destination:' },
    } }), 0, 'Hiring Manager routing never falls back to a personal/global destination');
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
    assert.equal(unlinkedReconciliation.primaryState, 'NEEDS_REVIEW');
    assert.equal(unlinkedReconciliation.cutoverBlocker, true);
    assert.equal(unlinkedReconciliation.attentionFlags.some((flag) => flag.flagCode === 'USER_PERSONNEL_LINKAGE' && flag.isActive), true);
    const personnelReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: `hr-redesign-v1:reconciliation:PERSONNEL:${personnelWithoutLogin.id}` },
      include: { attentionFlags: true },
    });
    assert.equal(personnelReconciliation.primaryState, 'READY');
    assert.equal(personnelReconciliation.attentionFlags.some((flag) => flag.flagCode === 'USER_PERSONNEL_LINKAGE'), false);
    const sameNameReconciliation = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { stableKey: `hr-redesign-v1:reconciliation:PERSONNEL:${sameNamePersonnel.id}` },
      include: { attentionFlags: true },
    });
    assert.equal(sameNameReconciliation.primaryState, 'READY');
    assert.equal(sameNameReconciliation.attentionFlags.some((flag) => flag.flagCode === 'IDENTITY_AMBIGUITY'), false);

    await tx.hrReconciliationReview.createMany({ data: [
      {
        stableKey: `review:access-only:${suffix}`,
        reconciliationId: unlinkedReconciliation.id,
        version: 1,
        outcome: 'ACCEPTED_ACCESS_ONLY',
        reason: 'Confirmed non-workforce system access',
        reviewedByUserId: unlinkedUser.id,
      },
      {
        stableKey: `review:legacy-only:${suffix}`,
        reconciliationId: personnelReconciliation.id,
        version: 1,
        outcome: 'ACCEPTED_LEGACY_ONLY',
        reason: 'Confirmed historical evidence with no operational dependency',
        reviewedByUserId: unlinkedUser.id,
      },
    ] });
    await tx.hrReconciliationAttentionFlag.create({ data: {
      stableKey: `staged-identity-ambiguity:${suffix}`,
      reconciliationId: sameNameReconciliation.id,
      flagCode: 'IDENTITY_AMBIGUITY',
      version: 1,
      detailsJson: { evidenceSource: 'HUMAN_REVIEW' },
    } });
    await runHrRedesignBackfill(tx, { apply: true });
    const reviewedAccessOnly = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { id: unlinkedReconciliation.id }, include: { attentionFlags: { orderBy: { version: 'desc' } } },
    });
    assert.equal(reviewedAccessOnly.cutoverBlocker, false);
    assert.equal(reviewedAccessOnly.attentionFlags.find((flag) => flag.flagCode === 'USER_PERSONNEL_LINKAGE')?.isActive, false);
    const reviewedLegacyOnly = await tx.hrReconciliationRecord.findUniqueOrThrow({ where: { id: personnelReconciliation.id } });
    assert.equal(reviewedLegacyOnly.primaryState, 'LEGACY_ONLY_HISTORY');
    const stagedAmbiguity = await tx.hrReconciliationRecord.findUniqueOrThrow({
      where: { id: sameNameReconciliation.id }, include: { attentionFlags: true },
    });
    assert.equal(stagedAmbiguity.cutoverBlocker, true);
    assert.equal(stagedAmbiguity.attentionFlags.some((flag) => flag.flagCode === 'IDENTITY_AMBIGUITY' && flag.isActive), true);

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
