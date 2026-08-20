import type { Prisma, PrismaClient } from '@prisma/client';
import { FEATURE_WORKSPACE_MAP, type Feature } from '../middleware/feature';
import { HR_REDESIGN_CATALOG } from './hrRedesignDataContracts';

export type EffectiveWorkspacePermission = 'view' | 'edit' | 'admin';

export type EffectiveWorkspaceAccess = {
  workspace: string;
  permission: EffectiveWorkspacePermission;
};

export type EffectiveFeatureAccess = {
  feature: string;
  permission: EffectiveWorkspacePermission;
  workspace: string;
};

export type EffectiveUserAccess = {
  workspaces: EffectiveWorkspaceAccess[];
  features: EffectiveFeatureAccess[];
};

type EffectiveAccessClient = Pick<
  PrismaClient | Prisma.TransactionClient,
  | 'workspacePermission'
  | 'roleWorkspacePermission'
  | 'featurePermission'
  | 'roleFeaturePermission'
  | 'hrWorkspaceAccessGrant'
  | 'hrFeatureAccessGrant'
>;

const ADMIN_WORKSPACES = ['sales', 'crm', 'hr', 'accounting', 'inventory', 'security', 'bi', 'logistics'];
const HR_FEATURE_CODES = HR_REDESIGN_CATALOG.workspaceFeatures.map(({ code }) => code);

const activeLegacyGrant = (
  grant: { isActive: boolean; expiresAt?: Date | null },
  at: Date,
) => grant.isActive && (!grant.expiresAt || grant.expiresAt > at);

const activeCanonicalGrant = (
  grant: { status: string; effectiveFrom: Date; effectiveTo: Date | null },
  at: Date,
) => grant.status === 'ACTIVE' && grant.effectiveFrom <= at && (!grant.effectiveTo || grant.effectiveTo > at);

const permission = (value: string): EffectiveWorkspacePermission => value.toLowerCase() as EffectiveWorkspacePermission;
const PERMISSION_RANK: Record<EffectiveWorkspacePermission, number> = { view: 1, edit: 2, admin: 3 };
const capAtWorkspaceLevel = (featureLevel: string, workspaceLevel: string): EffectiveWorkspacePermission => {
  const featurePermission = permission(featureLevel);
  const workspacePermission = permission(workspaceLevel);
  return PERMISSION_RANK[featurePermission] <= PERMISSION_RANK[workspacePermission]
    ? featurePermission
    : workspacePermission;
};

export const getEffectiveUserAccess = async (
  client: EffectiveAccessClient,
  input: { userId: string; userRole: string; at?: Date },
): Promise<EffectiveUserAccess> => {
  if (input.userRole === 'ADMIN') {
    return {
      workspaces: ADMIN_WORKSPACES.map((workspace) => ({ workspace, permission: 'admin' })),
      features: [
        ...Object.entries(FEATURE_WORKSPACE_MAP)
          .filter(([, workspace]) => workspace !== 'hr')
          .map(([feature, workspace]) => ({ feature, workspace, permission: 'admin' as const })),
        ...HR_FEATURE_CODES.map((feature) => ({ feature, workspace: 'hr', permission: 'admin' as const })),
      ],
    };
  }

  const at = input.at ?? new Date();
  const [
    directWorkspaces,
    roleWorkspaces,
    directFeatures,
    roleFeatures,
    canonicalHrWorkspaces,
    canonicalHrFeatures,
  ] = await Promise.all([
    client.workspacePermission.findMany({ where: { userId: input.userId, isActive: true } }),
    client.roleWorkspacePermission.findMany({ where: { role: input.userRole, isActive: true } }),
    client.featurePermission.findMany({ where: { userId: input.userId, isActive: true } }),
    client.roleFeaturePermission.findMany({ where: { role: input.userRole, isActive: true } }),
    client.hrWorkspaceAccessGrant.findMany({
      where: { userId: input.userId, workspaceCode: 'HUMAN_RESOURCES' },
      orderBy: { effectiveFrom: 'desc' },
    }),
    client.hrFeatureAccessGrant.findMany({
      where: { userId: input.userId },
      orderBy: { effectiveFrom: 'desc' },
    }),
  ]);

  const activeDirect = directWorkspaces.filter((grant) => grant.workspace !== 'hr' && activeLegacyGrant(grant, at));
  const directWorkspaceCodes = new Set(activeDirect.map((grant) => grant.workspace));
  const canonicalHr = canonicalHrWorkspaces.find((grant) => (
    grant.reason !== 'HR redesign baseline' && activeCanonicalGrant(grant, at)
  ));
  const inheritedHr = roleWorkspaces.find((grant) => grant.workspace === 'hr' && activeLegacyGrant(grant, at));

  const workspaces: EffectiveWorkspaceAccess[] = [
    ...activeDirect.map((grant) => ({ workspace: grant.workspace, permission: permission(grant.permissionLevel) })),
    ...(canonicalHr
      ? [{ workspace: 'hr', permission: permission(canonicalHr.level) }]
      : inheritedHr
        ? [{ workspace: 'hr', permission: permission(inheritedHr.permissionLevel) }]
        : []),
    ...roleWorkspaces
      .filter((grant) => grant.workspace !== 'hr' && !directWorkspaceCodes.has(grant.workspace) && activeLegacyGrant(grant, at))
      .map((grant) => ({ workspace: grant.workspace, permission: permission(grant.permissionLevel) })),
  ];

  const activeDirectFeatures = directFeatures.filter((grant) => grant.workspace !== 'hr' && activeLegacyGrant(grant, at));
  const activeRoleFeatures = roleFeatures.filter((grant) => grant.workspace !== 'hr' && activeLegacyGrant(grant, at));
  const nonHrFeatureCodes = new Set([
    ...activeDirectFeatures.map((grant) => grant.feature),
    ...activeRoleFeatures.map((grant) => grant.feature),
    ...Object.entries(FEATURE_WORKSPACE_MAP)
      .filter(([, workspace]) => workspace !== 'hr' && (
        activeDirect.some((grant) => grant.workspace === workspace)
        || roleWorkspaces.some((grant) => grant.workspace === workspace && activeLegacyGrant(grant, at))
      ))
      .map(([feature]) => feature),
  ]);
  const nonHrFeatures = [...nonHrFeatureCodes].flatMap((feature) => {
    const workspace = FEATURE_WORKSPACE_MAP[feature as Feature];
    if (!workspace || workspace === 'hr') return [];
    const directFeature = activeDirectFeatures.find((grant) => grant.feature === feature);
    const directWorkspace = activeDirect.find((grant) => grant.workspace === workspace);
    const roleFeature = activeRoleFeatures.find((grant) => grant.feature === feature);
    const roleWorkspace = roleWorkspaces.find((grant) => grant.workspace === workspace && activeLegacyGrant(grant, at));
    const effective = directFeature ?? directWorkspace ?? roleFeature ?? roleWorkspace;
    return effective ? [{ feature, permission: permission(effective.permissionLevel), workspace }] : [];
  });

  const effectiveHrWorkspaceLevel = canonicalHr?.level ?? inheritedHr?.permissionLevel;
  const broadManagerOverride = input.userRole === 'MANAGER' && effectiveHrWorkspaceLevel?.toUpperCase() === 'ADMIN';
  const activeCanonicalFeatures = canonicalHrFeatures.filter((grant) => (
    grant.reason !== 'HR redesign baseline' && activeCanonicalGrant(grant, at)
  ));
  const directHrFeatures = new Map<string, typeof activeCanonicalFeatures[number]>();
  for (const grant of activeCanonicalFeatures) {
    if (!directHrFeatures.has(grant.featureCode)) directHrFeatures.set(grant.featureCode, grant);
  }
  const inheritedHrFeatures = roleFeatures.filter((grant) => grant.workspace === 'hr' && activeLegacyGrant(grant, at));
  const hrFeatureCodes = new Set([
    ...directHrFeatures.keys(),
    ...inheritedHrFeatures.map((grant) => grant.feature),
  ]);
  const hrFeatures = !effectiveHrWorkspaceLevel
    ? []
    : broadManagerOverride
      ? HR_FEATURE_CODES.map((feature) => ({
        feature,
        permission: 'admin' as const,
        workspace: 'hr',
      }))
      : [...hrFeatureCodes].map((feature) => {
    const direct = directHrFeatures.get(feature);
    const inherited = inheritedHrFeatures.find((grant) => grant.feature === feature);
    return {
      feature,
      permission: capAtWorkspaceLevel(
        direct?.level ?? inherited!.permissionLevel,
        effectiveHrWorkspaceLevel,
      ),
      workspace: 'hr',
    };
      });

  return { workspaces, features: [...nonHrFeatures, ...hrFeatures] };
};
