import { PrismaClient } from '@prisma/client';

type ContractCorrectionDatabase = Pick<PrismaClient, 'hrWorkItem' | 'hrJobApplication'>;

export class ContractCorrectionTaskConflict extends Error {
  statusCode = 409;
}

export const claimContractCorrectionTask = async (
  database: ContractCorrectionDatabase,
  input: { workItemId: string; actorUserId: string },
) => {
  const current = await database.hrWorkItem.findUniqueOrThrow({ where: { id: input.workItemId } });
  const match = current.sourceKey?.match(/^HIRING:([^:]+):RECORD_CONTRACT_CORRECTION:UNASSIGNED$/);
  if (current.sourceType !== 'HIRING_ACTION' || !match) {
    throw new ContractCorrectionTaskConflict('این وظیفه قابل دریافت شخصی نیست.');
  }
  const application = await database.hrJobApplication.findUniqueOrThrow({
    where: { id: match[1] }, select: { employmentRelationship: { select: { status: true } } },
  });
  if (application.employmentRelationship?.status !== 'PLANNED') {
    throw new ContractCorrectionTaskConflict('وظیفه اصلاح قرارداد فقط پیش از شروع واقعی همکاری قابل دریافت است.');
  }
  if (current.assignedToUserId === input.actorUserId && current.status === 'IN_PROGRESS') return current;
  const claimed = await database.hrWorkItem.updateMany({
    where: { id: current.id, status: 'PENDING', assignedToUserId: null },
    data: {
      status: 'IN_PROGRESS', assignedToUserId: input.actorUserId,
      assignmentReason: 'CLAIMED_BY_ELIGIBLE_USER',
    },
  });
  if (claimed.count !== 1) {
    throw new ContractCorrectionTaskConflict('این وظیفه هم‌زمان توسط شخص دیگری دریافت شده است.');
  }
  return database.hrWorkItem.findUniqueOrThrow({ where: { id: current.id } });
};
