import type { Prisma } from '@prisma/client';

export const eraseJobApplicationRecords = async (
  client: Prisma.TransactionClient,
  applicationId: string,
  employmentRelationshipId?: string | null,
) => {
  await client.hrWorkItem.deleteMany({
    where: {
      sourceType: 'HIRING_ACTION',
      sourceKey: { startsWith: `HIRING:${applicationId}:` },
    },
  });
  await client.hrCandidatePersonnelIdentityConflict.deleteMany({ where: { applicationId } });
  await client.hrCompanyEvaluationAssignmentHistory.deleteMany({
    where: { occurrence: { applicationId } },
  });
  await client.hrCompanyEvaluationOccurrence.deleteMany({ where: { applicationId } });
  await client.hrFormalAssessmentEvidenceLink.deleteMany({
    where: { attempt: { result: { applicationId } } },
  });
  await client.hrFormalAssessmentAttempt.deleteMany({
    where: { result: { applicationId } },
  });
  await client.hrFormalAssessmentResult.deleteMany({ where: { applicationId } });
  await client.hrFormalAssessmentPlanSelection.deleteMany({
    where: { plan: { applicationId } },
  });
  await client.hrFormalAssessmentPlan.deleteMany({ where: { applicationId } });
  await client.hrAssessmentMigrationEvent.deleteMany({ where: { applicationId } });
  if (employmentRelationshipId) {
    await client.hrEmploymentRelationship.update({
      where: { id: employmentRelationshipId },
      data: { hiringApplicationId: null },
    });
  }
  await client.hrPlannedStartRevision.deleteMany({ where: { applicationId } });
  await client.hrJobApplication.delete({ where: { id: applicationId } });
};
