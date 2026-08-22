import type { PrismaClient } from '@prisma/client';
import { hrWorkItemDutyAdapter } from './crossWorkspaceDutyAdapters/hrWorkItemDutyAdapter';
import {
  SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS,
  salesContractCorrectionDutyAdapter,
  syncSalesContractCorrectionDutyDefinitions,
} from './crossWorkspaceDutyAdapters/salesContractCorrectionDutyAdapter';
import type {
  CrossWorkspaceDutyDatabase,
  ClaimCrossWorkspaceDutyInput,
  ReassignCrossWorkspaceDutyInput,
  ListEligibleDutyAssigneesInput,
  CrossWorkspaceDutySourceProjectionInput,
  CrossWorkspaceDutySourceAdapter,
  ReconcileCrossWorkspaceDutyAssignmentInput,
  RespondToCrossWorkspaceDutyInput,
  SynchronizeCrossWorkspaceDutySourceInput,
} from './crossWorkspaceDutyAdapters/types';
import {
  evaluateHrDutyResponse,
  formatHrDutyDeadlineTehran,
  HR_DUTY_DEFINITIONS,
  planHrDutyDeadlineEvents,
  planHrDutyReassignment,
  processHrDutyDeadlines,
  syncHrDutyEnvelopeDefinitions,
} from './crossWorkspaceDutyAdapters/hrWorkItemDutyLifecycle';

const sourceAdapters = new Map<string, CrossWorkspaceDutySourceAdapter>([
  [hrWorkItemDutyAdapter.sourceType, hrWorkItemDutyAdapter],
  [salesContractCorrectionDutyAdapter.sourceType, salesContractCorrectionDutyAdapter],
]);

const registeredAdapter = (sourceType: string) => {
  const adapter = sourceAdapters.get(sourceType);
  if (!adapter) throw new Error('DUTY_SOURCE_ADAPTER_NOT_REGISTERED');
  return adapter;
};

const adapterForDuty = async (database: CrossWorkspaceDutyDatabase, dutyId: string) => {
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: dutyId }, select: { sourceType: true } });
  if (!duty) throw new Error('DUTY_NOT_AVAILABLE');
  return registeredAdapter(duty.sourceType);
};

export const CROSS_WORKSPACE_DUTY_DEFINITIONS = Object.freeze({
  ...HR_DUTY_DEFINITIONS,
  ...SALES_CONTRACT_CORRECTION_DUTY_DEFINITIONS,
});
export const evaluateCrossWorkspaceDutyResponse = evaluateHrDutyResponse;
export const formatCrossWorkspaceDutyDeadlineTehran = formatHrDutyDeadlineTehran;
export const planCrossWorkspaceDutyDeadlineEvents = planHrDutyDeadlineEvents;
export const planCrossWorkspaceDutyReassignment = planHrDutyReassignment;
export const synchronizeCrossWorkspaceDutyDefinitions = async (
  database: CrossWorkspaceDutyDatabase,
  actorUserId = 'SYSTEM',
) => {
  const hr = await syncHrDutyEnvelopeDefinitions(database, actorUserId);
  const salesCorrection = await syncSalesContractCorrectionDutyDefinitions(database, actorUserId);
  return [...hr, ...salesCorrection];
};

export const synchronizeCrossWorkspaceDutySource = async (
  database: CrossWorkspaceDutyDatabase,
  input: SynchronizeCrossWorkspaceDutySourceInput,
) => registeredAdapter(input.sourceType).synchronize(database, input);

export const loadCrossWorkspaceDutySourceProjection = (
  database: CrossWorkspaceDutyDatabase,
  input: CrossWorkspaceDutySourceProjectionInput,
) => registeredAdapter(input.sourceType).loadInboxProjection(database, input);

export const respondToCrossWorkspaceDuty = async (
  database: CrossWorkspaceDutyDatabase,
  input: RespondToCrossWorkspaceDutyInput,
) => {
  if ('$transaction' in database) {
    return database.$transaction(async (tx) => (
      (await adapterForDuty(tx, input.dutyId)).respond(tx, input)
    ));
  }
  return (await adapterForDuty(database, input.dutyId)).respond(database, input);
};

export const claimCrossWorkspaceDuty = async (
  database: CrossWorkspaceDutyDatabase,
  input: ClaimCrossWorkspaceDutyInput,
) => {
  if ('$transaction' in database) {
    return database.$transaction(async (tx) => (
      (await adapterForDuty(tx, input.dutyId)).claim(tx, input)
    ));
  }
  return (await adapterForDuty(database, input.dutyId)).claim(database, input);
};

export const canClaimCrossWorkspaceDuty = async (
  database: CrossWorkspaceDutyDatabase,
  input: ClaimCrossWorkspaceDutyInput,
) => (await adapterForDuty(database, input.dutyId)).canClaim(database, input);

export const crossWorkspaceDutyClaimRequiresReason = async (
  database: CrossWorkspaceDutyDatabase,
  input: ClaimCrossWorkspaceDutyInput,
) => (await adapterForDuty(database, input.dutyId)).claimRequiresReason(database, input);

export const crossWorkspaceDutyResponseRequiresReason = async (
  database: CrossWorkspaceDutyDatabase,
  input: { dutyId: string; actorUserId: string },
) => (await adapterForDuty(database, input.dutyId)).responseRequiresReason(database, input);

export const reassignCrossWorkspaceDuty = async (
  database: CrossWorkspaceDutyDatabase,
  input: ReassignCrossWorkspaceDutyInput,
) => {
  if ('$transaction' in database) {
    return database.$transaction(async (tx) => (
      (await adapterForDuty(tx, input.dutyId)).reassign(tx, input)
    ));
  }
  return (await adapterForDuty(database, input.dutyId)).reassign(database, input);
};

export const listEligibleCrossWorkspaceDutyAssignees = async (
  database: CrossWorkspaceDutyDatabase,
  input: ListEligibleDutyAssigneesInput,
) => (await adapterForDuty(database, input.dutyId)).listEligibleAssignees(database, input);

export const reconcileCrossWorkspaceDutyAssignment = async (
  database: CrossWorkspaceDutyDatabase,
  input: ReconcileCrossWorkspaceDutyAssignmentInput,
) => (await adapterForDuty(database, input.dutyId)).reconcileAssignment(database, input);

export const processCrossWorkspaceDutyDeadlines = processHrDutyDeadlines;

export const startCrossWorkspaceDutyDeadlineMaintenance = (prisma: PrismaClient) => {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try {
      await synchronizeCrossWorkspaceDutyDefinitions(prisma);
      await processCrossWorkspaceDutyDeadlines(prisma, { policyVersion: 1 });
    } catch (error) {
      console.error('Cross-workspace duty deadline maintenance failed:', error);
    } finally {
      running = false;
    }
  };
  void run();
  const timer = setInterval(() => void run(), 60_000);
  timer.unref?.();
  return () => clearInterval(timer);
};

export type {
  ClaimCrossWorkspaceDutyInput,
  ReassignCrossWorkspaceDutyInput,
  ListEligibleDutyAssigneesInput,
  ReconcileCrossWorkspaceDutyAssignmentInput,
  RespondToCrossWorkspaceDutyInput,
  SynchronizeCrossWorkspaceDutySourceInput,
};
