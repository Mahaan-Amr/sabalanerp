import { Prisma, type PrismaClient } from '@prisma/client';
import type { ReassignCrossWorkspaceDutyInput } from './crossWorkspaceDutyAdapters/types';
import { lockCrossWorkspaceDuty } from './crossWorkspaceDutyLock';

type Database = PrismaClient | Prisma.TransactionClient;
const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value));

export const reassignIndividualDuty = async (
  database: Database,
  input: ReassignCrossWorkspaceDutyInput,
  authorize: (duty: any) => Promise<void>,
) => {
  const now = input.now ?? new Date();
  const reason = input.reason.trim();
  if (reason.length < 3) throw new Error('REASON_REQUIRED');
  await lockCrossWorkspaceDuty(database, input.dutyId);
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  if (!duty || duty.status !== 'OPEN') throw new Error('DUTY_NOT_OPEN');
  if (duty.currentAssigneeUserId !== input.expectedAssigneeUserId) throw new Error('ASSIGNEE_CHANGED');
  await authorize(duty);
  const changed = await database.crossWorkspaceDuty.updateMany({
    where: { id: duty.id, status: 'OPEN', currentAssigneeUserId: input.expectedAssigneeUserId },
    data: { currentAssigneeUserId: input.targetUserId, responsibilityId: null },
  });
  if (!changed.count) throw new Error('DUTY_REASSIGN_CONFLICT');
  await database.crossWorkspaceDutyAssignmentHistory.updateMany({
    where: { dutyId: duty.id, endedAt: null },
    data: { endedAt: now, endReason: 'REASSIGNED', changedByUserId: input.actorUserId },
  });
  const latest = await database.crossWorkspaceDutyAssignmentHistory.aggregate({
    where: { dutyId: duty.id }, _max: { sequence: true },
  });
  await database.crossWorkspaceDutyAssignmentHistory.create({ data: {
    dutyId: duty.id, sequence: (latest._max.sequence ?? 0) + 1,
    assignedUserId: input.targetUserId, responsibilityId: null,
    destinationWorkspaceCode: duty.destinationWorkspaceCode,
    destinationQueueCode: duty.destinationQueueCode, startedAt: now,
    changedByUserId: input.actorUserId, policyVersion: input.policyVersion,
  } });
  const audit = await database.crossWorkspaceDutyAuditVersion.aggregate({
    where: { dutyId: duty.id }, _max: { version: true },
  });
  await database.crossWorkspaceDutyAuditVersion.create({ data: {
    dutyId: duty.id, version: (audit._max.version ?? 0) + 1, eventCode: 'REASSIGNED',
    actorUserId: input.actorUserId, sourceVersion: duty.sourceVersion,
    envelopeVersion: duty.envelopeVersion, policyVersion: input.policyVersion, reason,
    beforeJson: json({ currentAssigneeUserId: input.expectedAssigneeUserId }),
    afterJson: json({ currentAssigneeUserId: input.targetUserId }),
  } });
  return database.crossWorkspaceDuty.findUniqueOrThrow({ where: { id: duty.id } });
};
