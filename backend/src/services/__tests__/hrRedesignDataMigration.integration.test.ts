import assert from 'node:assert/strict';
import { PrismaClient } from '@prisma/client';
import { HR_REDESIGN_CATALOG, runHrRedesignBackfill } from '../hrRedesignDataContracts';

const prisma = new PrismaClient();

const run = async () => {
  const planCountBefore = await prisma.hrFormalAssessmentPlan.count();
  await runHrRedesignBackfill(prisma, { apply: true });
  const repeatReport = await runHrRedesignBackfill(prisma, { apply: true });

  assert.equal(repeatReport.totals.safeBackfills, 0);
  assert.equal(await prisma.hrWorkspaceCatalog.count(), 1);
  assert.equal(await prisma.hrFeatureCatalog.count(), HR_REDESIGN_CATALOG.workspaceFeatures.length);
  assert.equal(await prisma.hrAuthorityCatalog.count(), HR_REDESIGN_CATALOG.businessAuthorities.length);
  assert.equal(await prisma.hrResponsibilityTypeCatalog.count(), HR_REDESIGN_CATALOG.responsibilityTypes.length);
  assert.equal(await prisma.hrFormalAssessmentPlan.count(), planCountBefore, 'legacy evidence must not create an assessment plan');
  assert.equal(
    await prisma.hrAssessmentMigrationEvent.count(),
    await prisma.hrJobApplication.count(),
    'each legacy Application receives exactly one neutral migration event',
  );

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
      } }), undefined, 'a result kind must match its exact plan selection');
    } finally {
      await prisma.hrFormalAssessmentPlanSelection.delete({ where: { id: selection.id } });
      await prisma.hrFormalAssessmentPlan.delete({ where: { id: plan.id } });
    }
  }

  console.log('HR redesign data migration integration tests passed.');
};

run().finally(() => prisma.$disconnect());
