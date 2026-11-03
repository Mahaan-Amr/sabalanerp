/** @deprecated Use crossWorkspaceDutyModule. */
export {
  CROSS_WORKSPACE_DUTY_DEFINITIONS as HR_DUTY_DEFINITIONS,
  evaluateCrossWorkspaceDutyResponse as evaluateHrDutyResponse,
  formatCrossWorkspaceDutyDeadlineTehran as formatHrDutyDeadlineTehran,
  planCrossWorkspaceDutyDeadlineEvents as planHrDutyDeadlineEvents,
  planCrossWorkspaceDutyReassignment as planHrDutyReassignment,
  processCrossWorkspaceDutyDeadlines as processHrDutyDeadlines,
  reconcileCrossWorkspaceDutyAssignment as reconcileHrDutyAssignment,
  respondToCrossWorkspaceDuty as respondToHrDuty,
  startCrossWorkspaceDutyDeadlineMaintenance as startHrDutyDeadlineMaintenance,
  synchronizeCrossWorkspaceDutyDefinitions as syncHrDutyEnvelopeDefinitions,
  synchronizeCrossWorkspaceDutySource,
} from './crossWorkspaceDutyModule';

export { deriveHrDutyRoutingContext } from './crossWorkspaceDutyAdapters/hrWorkItemDutyLifecycle';

export const createHrDutyFromLegacyWorkItem = async (
  ...args: Parameters<typeof import('./crossWorkspaceDutyAdapters/hrWorkItemDutyLifecycle').createHrDutyFromLegacyWorkItem>
) => {
  const [database, input] = args;
  const { synchronizeCrossWorkspaceDutySource } = await import('./crossWorkspaceDutyModule');
  return synchronizeCrossWorkspaceDutySource(database, {
    sourceType: 'HR_WORK_ITEM',
    sourceId: input.sourceWorkItemId,
    dutyTypeCode: input.sourceActionCode,
    actorUserId: input.actorUserId,
    policyVersion: input.policyVersion,
    now: input.now,
  });
};

export type {
  CreateHrDutyFromLegacyWorkItemInput,
  HrDutyActionCode,
  HrDutyDeadlineEventCode,
  HrDutyResponseDenialCode,
  HrDutyTerminalStatus,
} from './crossWorkspaceDutyAdapters/hrWorkItemDutyLifecycle';
export type { RespondToCrossWorkspaceDutyInput as RespondToHrDutyInput } from './crossWorkspaceDutyModule';
