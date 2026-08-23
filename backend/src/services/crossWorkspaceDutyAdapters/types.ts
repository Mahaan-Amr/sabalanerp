import type { Prisma, PrismaClient } from '@prisma/client';

export type CrossWorkspaceDutyDatabase = PrismaClient | Prisma.TransactionClient;

export type SynchronizeCrossWorkspaceDutySourceInput = {
  sourceType: string;
  sourceId: string;
  dutyTypeCode: string;
  actorUserId: string;
  policyVersion: number;
  now?: Date;
};

export type RespondToCrossWorkspaceDutyInput = {
  dutyId: string;
  actorUserId: string;
  actionCode: string;
  expectedSourceVersion: number;
  expectedEnvelopeVersion: number;
  reason: string | null;
  policyVersion: number;
  targetUserId?: string;
  now?: Date;
};

export type ClaimCrossWorkspaceDutyInput = {
  dutyId: string;
  actorUserId: string;
  policyVersion: number;
  reason?: string | null;
  now?: Date;
};

export type ReassignCrossWorkspaceDutyInput = {
  dutyId: string;
  actorUserId: string;
  targetUserId: string;
  expectedAssigneeUserId: string | null;
  reason: string;
  policyVersion: number;
  now?: Date;
};

export type ListEligibleDutyAssigneesInput = {
  dutyId: string;
  actorUserId: string;
  workspaceCode: string;
  now?: Date;
};

export type ReconcileCrossWorkspaceDutyAssignmentInput = {
  dutyId: string;
  actorUserId: string;
  policyVersion: number;
  now?: Date;
  resetDueAt?: Date | null;
};

export type CrossWorkspaceDutySourceProjectionInput = {
  sourceType: string;
  sourceId: string;
  sourceActionCode: string;
  sourceVersion: number;
};

export type CrossWorkspaceDutySourceProjection = {
  title: string;
  description: string | null;
  destinationHref?: string;
  sourceIsCurrent: boolean;
};

export interface CrossWorkspaceDutySourceAdapter {
  readonly sourceType: string;
  synchronize(
    database: CrossWorkspaceDutyDatabase,
    input: SynchronizeCrossWorkspaceDutySourceInput,
  ): Promise<any>;
  respond(
    database: CrossWorkspaceDutyDatabase,
    input: RespondToCrossWorkspaceDutyInput,
  ): Promise<any>;
  claim(
    database: CrossWorkspaceDutyDatabase,
    input: ClaimCrossWorkspaceDutyInput,
  ): Promise<any>;
  canClaim(
    database: CrossWorkspaceDutyDatabase,
    input: ClaimCrossWorkspaceDutyInput,
  ): Promise<boolean>;
  claimRequiresReason(
    database: CrossWorkspaceDutyDatabase,
    input: ClaimCrossWorkspaceDutyInput,
  ): Promise<boolean>;
  responseRequiresReason(
    database: CrossWorkspaceDutyDatabase,
    input: { dutyId: string; actorUserId: string },
  ): Promise<boolean>;
  canAccessSharedDecision(
    database: CrossWorkspaceDutyDatabase,
    input: { dutyId: string; actorUserId: string; includeCompleted?: boolean; now?: Date },
  ): Promise<boolean>;
  sharedDecisionAccessProvenance?(
    database: CrossWorkspaceDutyDatabase,
    input: { dutyId: string; actorUserId: string; now?: Date },
  ): Promise<string[]>;
  canReassign(
    database: CrossWorkspaceDutyDatabase,
    input: { dutyId: string; actorUserId: string; now?: Date },
  ): Promise<boolean>;
  reassign(
    database: CrossWorkspaceDutyDatabase,
    input: ReassignCrossWorkspaceDutyInput,
  ): Promise<any>;
  listEligibleAssignees(
    database: CrossWorkspaceDutyDatabase,
    input: ListEligibleDutyAssigneesInput,
  ): Promise<Array<{ id: string; displayName: string; username: string; role: string }>>;
  reconcileAssignment(
    database: CrossWorkspaceDutyDatabase,
    input: ReconcileCrossWorkspaceDutyAssignmentInput,
  ): Promise<any>;
  loadInboxProjection(
    database: CrossWorkspaceDutyDatabase,
    input: CrossWorkspaceDutySourceProjectionInput,
  ): Promise<CrossWorkspaceDutySourceProjection>;
}
