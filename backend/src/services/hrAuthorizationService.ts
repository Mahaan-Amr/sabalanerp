import type { Prisma, PrismaClient } from '@prisma/client';
import {
  evaluateHrAuthorization,
  resolveNamedResponsibility,
  type HrAuthorizationRequirement,
  type HrAuthorizationSnapshot,
} from './hrAuthorizationPolicy';
import { HR_ACTION_PERMISSIONS, actionPermissionsForLegacyAuthority } from './hrActionPermissionCatalog';

type HrAuthorizationClient = PrismaClient | Prisma.TransactionClient;

export const activeHrGrantWhere = (at = new Date()) => ({
  status: 'ACTIVE' as const,
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
});

export const loadHrAuthorizationSnapshot = async (
  client: HrAuthorizationClient,
  userId: string,
): Promise<HrAuthorizationSnapshot> => {
  const user = await client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } });
  const [workspaceGrants, featureGrants, roleWorkspaceGrants, roleFeatureGrants, duties] = await Promise.all([
    client.hrWorkspaceAccessGrant.findMany({
      where: { userId, workspaceCode: 'HUMAN_RESOURCES' },
      select: { workspaceCode: true, level: true, status: true, effectiveFrom: true, effectiveTo: true, reason: true },
    }),
    client.hrFeatureAccessGrant.findMany({
      where: { userId },
      select: { featureCode: true, level: true, status: true, effectiveFrom: true, effectiveTo: true, reason: true },
    }),
    client.roleWorkspacePermission.findMany({
      where: { role: user?.role ?? 'USER', workspace: 'hr', isActive: true },
      select: { permissionLevel: true },
    }),
    client.roleFeaturePermission.findMany({
      where: { role: user?.role ?? 'USER', workspace: 'hr', isActive: true },
      select: { feature: true, permissionLevel: true },
    }),
    client.crossWorkspaceDuty.findMany({
      where: { currentAssigneeUserId: userId, status: 'OPEN' },
      select: { id: true },
    }),
  ]);
  return {
    user: user ?? { id: userId, role: 'USER', isActive: false },
    workspaceGrants: [
      ...workspaceGrants.map(({ reason, ...grant }) => ({ ...grant, bootstrapOnly: reason === 'HR redesign baseline' })),
      ...roleWorkspaceGrants.map((grant) => ({
        workspaceCode: 'HUMAN_RESOURCES', level: grant.permissionLevel.toUpperCase() as 'VIEW' | 'EDIT' | 'ADMIN',
        status: 'ACTIVE' as const, effectiveFrom: new Date(0), effectiveTo: null,
      })),
    ],
    featureGrants: [
      ...featureGrants.map(({ reason, ...grant }) => ({ ...grant, bootstrapOnly: reason === 'HR redesign baseline' })),
      ...roleFeatureGrants.map((grant) => ({
        featureCode: grant.feature, level: grant.permissionLevel.toUpperCase() as 'VIEW' | 'EDIT' | 'ADMIN',
        status: 'ACTIVE' as const, effectiveFrom: new Date(0), effectiveTo: null,
      })),
    ],
    // Legacy business-authority rows are retained as history but are not authorization input.
    authorityGrants: [],
    assignedDutyIds: duties.map(({ id }) => id),
  };
};

export const authorizeHrUser = async (
  client: HrAuthorizationClient,
  userId: string,
  requirement: HrAuthorizationRequirement,
  at = new Date(),
) => evaluateHrAuthorization(await loadHrAuthorizationSnapshot(client, userId), requirement, at);

export const authorizeHrAction = async (
  client: HrAuthorizationClient,
  userId: string,
  actionPermissionCodes: string[],
  at = new Date(),
) => authorizeHrUser(client, userId, { workspaceLevel: 'EDIT', actionPermissionCodes }, at);

export const activeHrActionPermissionsForUser = async (
  client: HrAuthorizationClient,
  userId: string,
  at = new Date(),
) => {
  const snapshot = await loadHrAuthorizationSnapshot(client, userId);
  if (!snapshot.user.isActive) return [];
  return HR_ACTION_PERMISSIONS
    .map(({ code }) => code)
    .filter((code) => evaluateHrAuthorization(snapshot, { workspaceLevel: 'VIEW', actionPermissionCodes: [code] }, at).allowed);
};

export const activeHrAuthoritiesForUser = async (
  client: HrAuthorizationClient,
  userId: string,
  at = new Date(),
) => {
  const snapshot = await loadHrAuthorizationSnapshot(client, userId);
  if (!snapshot.user.isActive) return [];
  const broadOverride = evaluateHrAuthorization(snapshot, { workspaceLevel: 'ADMIN' }, at).allowed
    && (snapshot.user.role === 'ADMIN' || snapshot.user.role === 'MANAGER');
  const legacyCodes = ['HR_PROCESSOR', 'HR_MANAGER', 'COMPANY_MANAGER', 'HR_PAYROLL_PROCESSOR', 'HR_PAYROLL_MANAGER', 'FINANCE_RECORDER', 'FINANCE_MANAGER'];
  if (broadOverride) return legacyCodes;
  const activeFeatureCodes = new Set(snapshot.featureGrants
    .filter((grant) => !grant.bootstrapOnly && grant.status === 'ACTIVE' && grant.effectiveFrom <= at && (!grant.effectiveTo || grant.effectiveTo > at))
    .map((grant) => grant.featureCode));
  return legacyCodes.filter((legacyCode) => {
    const requiredActions = actionPermissionsForLegacyAuthority(legacyCode).filter((code) => HR_ACTION_PERMISSIONS.some((permission) => permission.code === code));
    return requiredActions.length > 0 && requiredActions.every((code) => activeFeatureCodes.has(code));
  });
};

export const activeCompanyManagerUserIds = async (
  client: HrAuthorizationClient,
  options: { excludeGrantId?: string; at?: Date } = {},
) => {
  const at = options.at ?? new Date();
  const users = await client.user.findMany({ where: { isActive: true }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const authoritySets = await Promise.all(userIds.map((userId) => activeHrAuthoritiesForUser(client, userId, at)));
  return userIds.filter((_userId, index) => authoritySets[index].includes('COMPANY_MANAGER'));
};

type SeparationRule = {
  disallowSourceActor?: boolean;
  disallowedUserIds?: string[];
};

export const resolveHrNamedResponsibility = async (
  client: HrAuthorizationClient,
  input: {
    sourceActionCode: string;
    responsibilityTypeCode: string;
    scopeType: string;
    scopeId: string | null;
    sourceActorUserId?: string;
    disallowedUserIds?: string[];
    now?: Date;
  },
) => {
  const now = input.now ?? new Date();
  const [responsibilities, destinations, constraints] = await Promise.all([
    client.hrNamedResponsibility.findMany({
      where: {
        responsibilityTypeCode: input.responsibilityTypeCode,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
      select: {
        id: true, responsibilityTypeCode: true, scopeType: true, scopeId: true,
        assignedUserId: true, assignmentKind: true, principalResponsibilityId: true,
        effectiveFrom: true, effectiveTo: true,
      },
    }),
    client.hrResponsibilityDestination.findMany({
      where: {
        responsibilityTypeCode: input.responsibilityTypeCode,
        scopeType: input.scopeType,
        scopeId: input.scopeId,
      },
      select: {
        id: true, responsibilityTypeCode: true, scopeType: true, scopeId: true,
        workspaceCode: true, featureCode: true, queueCode: true, version: true, isActive: true,
      },
    }),
    client.hrSeparationOfDutyConstraint.findMany({
      where: { sourceActionCode: input.sourceActionCode, responsibilityTypeCode: input.responsibilityTypeCode, isActive: true },
      select: { conflictRuleJson: true },
    }),
  ]);
  const assignedUserIds = [...new Set(responsibilities.map(({ assignedUserId }) => assignedUserId).filter(Boolean) as string[])];
  const users = await client.user.findMany({ where: { id: { in: assignedUserIds } }, select: { id: true, role: true, isActive: true } });
  const requiredActionPermissions = actionPermissionsForLegacyAuthority(input.responsibilityTypeCode)
    .filter((code) => HR_ACTION_PERMISSIONS.some((permission) => permission.code === code));
  const permissionSets = await Promise.all(assignedUserIds.map(async (userId) => ({
    userId,
    permissions: new Set(await activeHrActionPermissionsForUser(client, userId, now)),
  })));
  const authorityEligibleUserIds = requiredActionPermissions.length
    ? permissionSets
      .filter(({ permissions }) => requiredActionPermissions.every((code) => permissions.has(code)))
      .map(({ userId }) => userId)
    : undefined;
  const conflictedUserIds = new Set(input.disallowedUserIds ?? []);
  for (const constraint of constraints) {
    const rule = constraint.conflictRuleJson as SeparationRule;
    if (rule.disallowSourceActor && input.sourceActorUserId) conflictedUserIds.add(input.sourceActorUserId);
    for (const userId of rule.disallowedUserIds ?? []) conflictedUserIds.add(userId);
  }
  return resolveNamedResponsibility({
    ...input,
    responsibilities,
    destinations,
    users,
    authorityEligibleUserIds,
    conflictedUserIds: [...conflictedUserIds],
    now,
  });
};
