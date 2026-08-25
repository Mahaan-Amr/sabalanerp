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
  if (employmentRelationshipId) {
    await client.hrEmploymentRelationship.update({
      where: { id: employmentRelationshipId },
      data: { hiringApplicationId: null },
    });
  }
  await client.hrPlannedStartRevision.deleteMany({ where: { applicationId } });
  await client.hrJobApplication.delete({ where: { id: applicationId } });
};
