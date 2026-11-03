import {
  createHrDutyFromLegacyWorkItem,
  reconcileHrDutyAssignment,
  respondToHrDuty,
  canAccessHrWorkItemSharedDecision,
  HR_DUTY_DEFINITIONS,
} from './hrWorkItemDutyLifecycle';
import type { CrossWorkspaceDutySourceAdapter } from './types';
import { authorizeHrUser } from '../hrAuthorizationService';
import { getEffectiveUserAccess } from '../effectiveAccessService';
import { reassignIndividualDuty } from '../crossWorkspaceDutyReassignment';
import { resolveWorkspaceDutyAuthority } from '../crossWorkspaceDutyAuthority';

const definitionFor = (code: string) => Object.values(HR_DUTY_DEFINITIONS)
  .find((definition) => definition.sourceActionCode === code);

const assertReassignmentManager = async (database: any, duty: any, userId: string, now: Date) => {
  const definition = definitionFor(duty.sourceActionCode);
  const workspace = duty.destinationWorkspaceCode === 'HUMAN_RESOURCES' ? 'hr' : duty.destinationWorkspaceCode.toLowerCase();
  const authority = await resolveWorkspaceDutyAuthority(database, {
    userId, workspace, feature: definition?.actionPermissionCode ?? '__duty_reassignment__', at: now,
  });
  if (!authority.canSelfDecide) throw new Error('DUTY_REASSIGN_FORBIDDEN');
};

const reassign: CrossWorkspaceDutySourceAdapter['reassign'] = (database, input) =>
  reassignIndividualDuty(database, input, async (duty) => {
    const definition = definitionFor(duty.sourceActionCode);
    if (duty.sourceType !== 'HR_WORK_ITEM' || definition?.accountabilityModel !== 'INDIVIDUAL_EXECUTION') {
      throw new Error('DUTY_REASSIGN_NOT_SUPPORTED');
    }
    const now = input.now ?? new Date();
    await assertReassignmentManager(database, duty, input.actorUserId, now);
    if (definition.actionPermissionCode && !(await authorizeHrUser(database, input.targetUserId, {
      actionPermissionCodes: [definition.actionPermissionCode],
    }, now)).allowed) throw new Error('DUTY_ASSIGNEE_INELIGIBLE');
    if (duty.sourceActorUserId === input.targetUserId) throw new Error('SEPARATION_OF_DUTIES_CONFLICT');
  });

const listEligibleAssignees: CrossWorkspaceDutySourceAdapter['listEligibleAssignees'] = async (database, input) => {
  const now = input.now ?? new Date();
  const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
  const definition = duty && definitionFor(duty.sourceActionCode);
  if (!duty || duty.sourceType !== 'HR_WORK_ITEM' || definition?.accountabilityModel !== 'INDIVIDUAL_EXECUTION') return [];
  await assertReassignmentManager(database, duty, input.actorUserId, now);
  const users = await database.user.findMany({
    where: { isActive: true, erasedAt: null, id: { notIn: [duty.currentAssigneeUserId, duty.sourceActorUserId].filter(Boolean) as string[] } },
    select: { id: true, firstName: true, lastName: true, username: true, role: true },
  });
  const eligible = await Promise.all(users.map(async (user) => !definition.actionPermissionCode || (await authorizeHrUser(database, user.id, {
    actionPermissionCodes: [definition.actionPermissionCode],
  }, now)).allowed));
  return users.filter((_user, index) => eligible[index]).map((user) => ({
    id: user.id, displayName: `${user.firstName} ${user.lastName}`.trim() || user.username,
    username: user.username, role: user.role,
  }));
};

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
  canAccessSharedDecision: (database, input) => canAccessHrWorkItemSharedDecision(database, input),
  sharedDecisionAccessProvenance: async (database, input) => {
    const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
    const definition = duty && definitionFor(duty.sourceActionCode);
    if (!definition?.actionPermissionCode) return [];
    const user = await database.user.findUnique({ where: { id: input.actorUserId }, select: { role: true } });
    if (!user) return [];
    const effective = await getEffectiveUserAccess(database, { userId: input.actorUserId, userRole: user.role, at: input.now });
    const source = effective.provenance.features.find(({ feature }) => feature === definition.actionPermissionCode)?.source;
    return source === 'SYSTEM_ADMIN_OVERRIDE' ? ['اختیار مدیر سیستم']
      : source === 'CANONICAL_HR_FEATURE' || source === 'DIRECT_FEATURE' ? ['مجوز مستقیم قابلیت تخصصی']
        : source === 'ROLE_FEATURE' || source === 'HR_MANAGER_OVERRIDE' ? ['مجوز قابلیت تخصصی از نقش'] : [];
  },
  reassign,
  canReassign: async (database, input) => {
    const duty = await database.crossWorkspaceDuty.findUnique({ where: { id: input.dutyId } });
    if (!duty || duty.status !== 'OPEN' || duty.sourceType !== 'HR_WORK_ITEM'
      || definitionFor(duty.sourceActionCode)?.accountabilityModel !== 'INDIVIDUAL_EXECUTION') return false;
    try { await assertReassignmentManager(database, duty, input.actorUserId, input.now ?? new Date()); return true; }
    catch { return false; }
  },
  listEligibleAssignees,
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
