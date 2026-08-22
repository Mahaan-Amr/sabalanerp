import {
  createHrDutyFromLegacyWorkItem,
  reconcileHrDutyAssignment,
  respondToHrDuty,
} from './hrWorkItemDutyLifecycle';
import type { CrossWorkspaceDutySourceAdapter } from './types';

export const hrWorkItemDutyAdapter = {
  sourceType: 'HR_WORK_ITEM',
  synchronize: (database, input) => createHrDutyFromLegacyWorkItem(database, {
    sourceWorkItemId: input.sourceId,
    sourceActionCode: input.dutyTypeCode,
    actorUserId: input.actorUserId,
    policyVersion: input.policyVersion,
    now: input.now,
  }),
  respond: (database, input) => respondToHrDuty(database, input),
  claim: async () => { throw new Error('DUTY_CLAIM_NOT_SUPPORTED'); },
  canClaim: async () => false,
  claimRequiresReason: async () => false,
  responseRequiresReason: async () => false,
  reassign: async () => { throw new Error('DUTY_REASSIGN_NOT_SUPPORTED'); },
  listEligibleAssignees: async () => [],
  reconcileAssignment: (database, input) => reconcileHrDutyAssignment(database, input),
  loadInboxProjection: async (database, input) => {
    const source = await database.hrWorkItem.findUnique({
      where: { id: input.sourceId },
      select: { id: true, title: true, description: true },
    });
    if (!source) throw new Error('DUTY_SOURCE_CHANGED');
    const currentSourceVersion = (await database.hrWorkItemAudit.count({
      where: { workItemId: source.id, NOT: { eventType: { startsWith: 'DUTY_' } } },
    })) + 1;
    return {
      title: source.title,
      description: source.description,
      sourceIsCurrent: currentSourceVersion === input.sourceVersion,
    };
  },
} satisfies CrossWorkspaceDutySourceAdapter;
