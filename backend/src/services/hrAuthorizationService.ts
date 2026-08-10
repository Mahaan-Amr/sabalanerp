import type { Prisma, PrismaClient } from '@prisma/client';
import {
  evaluateHrAuthorization,
  resolveNamedResponsibility,
  type HrAuthorizationRequirement,
  type HrAuthorizationSnapshot,
} from './hrAuthorizationPolicy';

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
  const [user, workspaceGrants, featureGrants, authorityGrants, duties] = await Promise.all([
    client.user.findUnique({ where: { id: userId }, select: { id: true, role: true, isActive: true } }),
    client.hrWorkspaceAccessGrant.findMany({
      where: { userId, workspaceCode: 'HUMAN_RESOURCES' },
      select: { workspaceCode: true, level: true, status: true, effectiveFrom: true, effectiveTo: true, reason: true },
    }),
    client.hrFeatureAccessGrant.findMany({
      where: { userId },
      select: { featureCode: true, level: true, status: true, effectiveFrom: true, effectiveTo: true, reason: true },
    }),
    client.hrBusinessAuthorityGrant.findMany({
      where: { userId },
      select: { authorityCode: true, status: true, effectiveFrom: true, effectiveTo: true, reason: true },
    }),
    client.hrDuty.findMany({
      where: { currentAssigneeUserId: userId, status: 'OPEN' },
      select: { id: true },
    }),
  ]);
  return {
    user: user ?? { id: userId, role: 'USER', isActive: false },
    workspaceGrants: workspaceGrants.map(({ reason, ...grant }) => ({ ...grant, bootstrapOnly: reason === 'HR redesign baseline' })),
    featureGrants: featureGrants.map(({ reason, ...grant }) => ({ ...grant, bootstrapOnly: reason === 'HR redesign baseline' })),
    authorityGrants: authorityGrants.map(({ reason, ...grant }) => ({ ...grant, bootstrapOnly: reason === 'HR redesign baseline' })),
    assignedDutyIds: duties.map(({ id }) => id),
  };
};

export const authorizeHrUser = async (
  client: HrAuthorizationClient,
  userId: string,
  requirement: HrAuthorizationRequirement,
  at = new Date(),
) => evaluateHrAuthorization(await loadHrAuthorizationSnapshot(client, userId), requirement, at);

export const activeHrAuthoritiesForUser = async (
  client: HrAuthorizationClient,
  userId: string,
  at = new Date(),
) => {
  const snapshot = await loadHrAuthorizationSnapshot(client, userId);
  if (!snapshot.user.isActive) return [];
  if (snapshot.user.role === 'ADMIN') {
    const catalog = await client.hrAuthorityCatalog.findMany({ where: { isActive: true }, select: { code: true } });
    return catalog.map(({ code }) => code);
  }
  return snapshot.authorityGrants
    .filter((grant) => !grant.bootstrapOnly && grant.status === 'ACTIVE' && grant.effectiveFrom <= at && (!grant.effectiveTo || grant.effectiveTo > at))
    .map((grant) => grant.authorityCode);
};

export const activeCompanyManagerUserIds = async (
  client: HrAuthorizationClient,
  options: { excludeGrantId?: string; at?: Date } = {},
) => {
  const at = options.at ?? new Date();
  const grants = await client.hrBusinessAuthorityGrant.findMany({
    where: {
      authorityCode: 'COMPANY_MANAGER',
      id: options.excludeGrantId ? { not: options.excludeGrantId } : undefined,
      ...activeHrGrantWhere(at),
    },
    select: { userId: true },
  });
  const userIds = [...new Set(grants.map(({ userId }) => userId))];
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
  const [users, authorityGrants, authorityCatalog] = await Promise.all([
    client.user.findMany({ where: { id: { in: assignedUserIds } }, select: { id: true, role: true, isActive: true } }),
    client.hrBusinessAuthorityGrant.findMany({
      where: { userId: { in: assignedUserIds }, authorityCode: input.responsibilityTypeCode, ...activeHrGrantWhere(now) },
      select: { userId: true, reason: true },
    }),
    client.hrAuthorityCatalog.findUnique({ where: { code: input.responsibilityTypeCode }, select: { code: true } }),
  ]);
  const baselineIds = users.filter((user) => user.isActive && user.role === 'ADMIN').map(({ id }) => id);
  const authorityEligibleUserIds = authorityCatalog
    ? [...new Set([
      ...authorityGrants.filter(({ reason }) => reason !== 'HR redesign baseline').map(({ userId }) => userId),
      ...baselineIds,
    ])]
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
