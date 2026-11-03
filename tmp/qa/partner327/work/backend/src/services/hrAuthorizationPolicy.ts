import {
  actionPermissionsForLegacyAuthority,
  expandHrActionPermissionSelection,
  getHrActionPermissionDefinition,
} from './hrActionPermissionCatalog';

export type HrAccessLevel = 'VIEW' | 'EDIT' | 'ADMIN';
export type HrAuthorizationLayer = 'WORKSPACE' | 'FEATURE' | 'ACTION_PERMISSION' | 'TASK_DUTY' | 'SYSTEM_ROLE';

type EffectiveGrant = {
  status: 'ACTIVE' | 'REVOKED' | 'EXPIRED';
  effectiveFrom: Date;
  effectiveTo: Date | null;
  bootstrapOnly?: boolean;
};

export type HrAuthorizationSnapshot = {
  user: { id: string; role: string; isActive: boolean };
  workspaceGrants: Array<EffectiveGrant & { workspaceCode: string; level: HrAccessLevel }>;
  featureGrants: Array<EffectiveGrant & { featureCode: string; level: HrAccessLevel }>;
  authorityGrants: Array<EffectiveGrant & { authorityCode: string }>;
  assignedDutyIds: string[];
};

export type HrAuthorizationRequirement = {
  workspaceLevel?: HrAccessLevel;
  feature?: { code: string; level: HrAccessLevel };
  authorityCodes?: string[];
  actionPermissionCodes?: string[];
  dutyId?: string;
  systemRoles?: string[];
};

const accessRank: Record<HrAccessLevel, number> = { VIEW: 1, EDIT: 2, ADMIN: 3 };

const isEffective = (grant: EffectiveGrant, at: Date) => (
  grant.status === 'ACTIVE'
  && grant.effectiveFrom <= at
  && (!grant.effectiveTo || grant.effectiveTo > at)
);

export const hasFullHrBaseline = (snapshot: HrAuthorizationSnapshot, at = new Date()) => {
  if (!snapshot.user.isActive) return false;
  if (snapshot.user.role === 'ADMIN') return true;
  if (snapshot.user.role !== 'MANAGER') return false;
  return snapshot.workspaceGrants.some((grant) => (
    grant.workspaceCode === 'HUMAN_RESOURCES'
    && grant.level === 'ADMIN'
    && isEffective(grant, at)
    && !grant.bootstrapOnly
  ));
};

export const evaluateHrAuthorization = (
  snapshot: HrAuthorizationSnapshot,
  requirement: HrAuthorizationRequirement,
  at = new Date(),
) => {
  if (!snapshot.user.isActive) {
    const missingLayers = new Set<HrAuthorizationLayer>();
    if (requirement.workspaceLevel) missingLayers.add('WORKSPACE');
    if (requirement.feature) missingLayers.add('FEATURE');
    if (requirement.actionPermissionCodes?.length || requirement.authorityCodes?.length) missingLayers.add('ACTION_PERMISSION');
    if (requirement.dutyId) missingLayers.add('TASK_DUTY');
    if (requirement.systemRoles?.length) missingLayers.add('SYSTEM_ROLE');
    return { allowed: false, missingLayers: [...missingLayers] };
  }

  const baseline = hasFullHrBaseline(snapshot, at);
  const missingLayers: HrAuthorizationLayer[] = [];
  if (requirement.workspaceLevel && !baseline) {
    const grant = snapshot.workspaceGrants.find((candidate) => (
      candidate.workspaceCode === 'HUMAN_RESOURCES'
      && isEffective(candidate, at)
      && !candidate.bootstrapOnly
      && accessRank[candidate.level] >= accessRank[requirement.workspaceLevel!]
    ));
    if (!grant) missingLayers.push('WORKSPACE');
  }
  if (requirement.feature && !baseline) {
    const grant = snapshot.featureGrants.find((candidate) => (
      candidate.featureCode === requirement.feature!.code
      && isEffective(candidate, at)
      && !candidate.bootstrapOnly
      && accessRank[candidate.level] >= accessRank[requirement.feature!.level]
    ));
    if (!grant) missingLayers.push('FEATURE');
  }
  const hasFeatureAt = (code: string, level: HrAccessLevel) => snapshot.featureGrants.some((candidate) => (
    candidate.featureCode === code && isEffective(candidate, at) && !candidate.bootstrapOnly
    && accessRank[candidate.level] >= accessRank[level]
  ));
  const hasActionPermission = (code: string) => expandHrActionPermissionSelection([code]).every((requiredCode) => (
    hasFeatureAt(requiredCode, getHrActionPermissionDefinition(requiredCode)?.level ?? 'VIEW')
  ));
  const actionPermissionCodes = requirement.actionPermissionCodes ?? [];
  if (actionPermissionCodes.length && !baseline) {
    const authorized = actionPermissionCodes.some(hasActionPermission);
    if (!authorized) missingLayers.push('ACTION_PERMISSION');
  }
  if (requirement.authorityCodes?.length && !baseline) {
    const authorized = requirement.authorityCodes.some((authorityCode) => {
      const bundle = actionPermissionsForLegacyAuthority(authorityCode).filter((code) => getHrActionPermissionDefinition(code));
      return bundle.length > 0 && bundle.every(hasActionPermission);
    });
    if (!authorized) missingLayers.push('ACTION_PERMISSION');
  }
  if (requirement.dutyId && !snapshot.assignedDutyIds.includes(requirement.dutyId)) {
    missingLayers.push('TASK_DUTY');
  }
  if (requirement.systemRoles?.length && !requirement.systemRoles.includes(snapshot.user.role)) {
    missingLayers.push('SYSTEM_ROLE');
  }
  return { allowed: missingLayers.length === 0, missingLayers };
};

export type NamedResponsibilityAssignment = {
  id: string;
  responsibilityTypeCode: string;
  scopeType: string;
  scopeId: string | null;
  assignedUserId: string | null;
  assignmentKind: 'PRIMARY' | 'ACTING' | 'SUBSTITUTE';
  principalResponsibilityId: string | null;
  effectiveFrom: Date;
  effectiveTo: Date | null;
};

export type ResponsibilityDestination = {
  id: string;
  responsibilityTypeCode: string;
  scopeType: string;
  scopeId: string | null;
  workspaceCode: string;
  featureCode: string | null;
  queueCode: string;
  version: number;
  isActive: boolean;
};

export type NamedResponsibilityResolution =
  | {
    status: 'RESOLVED';
    responsibilityId: string;
    assignedUserId: string;
    assignmentKind: NamedResponsibilityAssignment['assignmentKind'];
    destination: ResponsibilityDestination;
  }
  | {
    status: 'UNRESOLVED';
    reason:
      | 'MISSING_ASSIGNMENT'
      | 'INACTIVE_OR_EXPIRED_ASSIGNMENT'
      | 'AMBIGUOUS_ASSIGNMENT'
      | 'INELIGIBLE_ASSIGNEE'
      | 'DESTINATION_MISSING'
      | 'DESTINATION_AMBIGUOUS'
      | 'SEPARATION_OF_DUTY_CONFLICT';
  };

const sameScope = (value: { scopeType: string; scopeId: string | null }, scopeType: string, scopeId: string | null) => (
  value.scopeType === scopeType && value.scopeId === scopeId
);

const assignmentPriority = (kind: NamedResponsibilityAssignment['assignmentKind']) => (
  kind === 'PRIMARY' ? 1 : 2
);

export const resolveNamedResponsibility = (input: {
  sourceActionCode: string;
  responsibilityTypeCode: string;
  scopeType: string;
  scopeId: string | null;
  responsibilities: NamedResponsibilityAssignment[];
  destinations: ResponsibilityDestination[];
  users: Array<{ id: string; isActive: boolean }>;
  authorityEligibleUserIds?: string[];
  conflictedUserIds: string[];
  now?: Date;
}): NamedResponsibilityResolution => {
  const at = input.now ?? new Date();
  const scoped = input.responsibilities.filter((candidate) => (
    candidate.responsibilityTypeCode === input.responsibilityTypeCode
    && sameScope(candidate, input.scopeType, input.scopeId)
  ));
  const effective = scoped.filter((candidate) => (
    candidate.effectiveFrom <= at && (!candidate.effectiveTo || candidate.effectiveTo > at)
  ));
  if (effective.length === 0) {
    return { status: 'UNRESOLVED', reason: scoped.length ? 'INACTIVE_OR_EXPIRED_ASSIGNMENT' : 'MISSING_ASSIGNMENT' };
  }

  const highestPriority = Math.max(...effective.map((candidate) => assignmentPriority(candidate.assignmentKind)));
  const selected = effective.filter((candidate) => assignmentPriority(candidate.assignmentKind) === highestPriority);
  if (selected.length !== 1) return { status: 'UNRESOLVED', reason: 'AMBIGUOUS_ASSIGNMENT' };

  const responsibility = selected[0];
  if (!responsibility.assignedUserId) return { status: 'UNRESOLVED', reason: 'INELIGIBLE_ASSIGNEE' };
  const user = input.users.find((candidate) => candidate.id === responsibility.assignedUserId);
  if (!user?.isActive) return { status: 'UNRESOLVED', reason: 'INELIGIBLE_ASSIGNEE' };
  if (input.authorityEligibleUserIds && !input.authorityEligibleUserIds.includes(user.id)) {
    return { status: 'UNRESOLVED', reason: 'INELIGIBLE_ASSIGNEE' };
  }
  if (input.conflictedUserIds.includes(user.id)) {
    return { status: 'UNRESOLVED', reason: 'SEPARATION_OF_DUTY_CONFLICT' };
  }

  const destinations = input.destinations.filter((candidate) => (
    candidate.isActive
    && candidate.responsibilityTypeCode === input.responsibilityTypeCode
    && sameScope(candidate, input.scopeType, input.scopeId)
  ));
  if (destinations.length === 0) return { status: 'UNRESOLVED', reason: 'DESTINATION_MISSING' };
  if (destinations.length > 1) return { status: 'UNRESOLVED', reason: 'DESTINATION_AMBIGUOUS' };

  return {
    status: 'RESOLVED',
    responsibilityId: responsibility.id,
    assignedUserId: user.id,
    assignmentKind: responsibility.assignmentKind,
    destination: destinations[0],
  };
};
