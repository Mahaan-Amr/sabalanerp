import type { Prisma, PrismaClient } from '@prisma/client';
import { FEATURE_WORKSPACE_MAP, type Feature } from '../middleware/feature';
import { HR_REDESIGN_CATALOG } from './hrRedesignDataContracts';
import { HR_ACTION_PERMISSIONS } from './hrActionPermissionCatalog';

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
  provenance: {
    workspaces: Array<EffectiveWorkspaceAccess & { source: AuthorizationProvenanceSource; grantId: string | null }>;
    features: Array<EffectiveFeatureAccess & { source: AuthorizationProvenanceSource; grantId: string | null }>;
  };
};

export type AuthorizationProvenanceSource =
  | 'SYSTEM_ADMIN_OVERRIDE'
  | 'DIRECT_WORKSPACE'
  | 'ROLE_WORKSPACE'
  | 'DIRECT_FEATURE'
  | 'ROLE_FEATURE'
  | 'CANONICAL_HR_WORKSPACE'
  | 'CANONICAL_HR_FEATURE'
  | 'HR_MANAGER_OVERRIDE';

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
const HR_ACTION_CODES = new Set(HR_ACTION_PERMISSIONS.map(({ code }) => code));

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
    const workspaces = ADMIN_WORKSPACES.map((workspace) => ({ workspace, permission: 'admin' as const }));
    const features = [
        ...Object.entries(FEATURE_WORKSPACE_MAP)
          .filter(([, workspace]) => workspace !== 'hr')
          .map(([feature, workspace]) => ({ feature, workspace, permission: 'admin' as const })),
        ...HR_FEATURE_CODES.map((feature) => ({ feature, workspace: 'hr', permission: 'admin' as const })),
      ];
    return {
      workspaces,
      features,
      provenance: {
        workspaces: workspaces.map((grant) => ({ ...grant, source: 'SYSTEM_ADMIN_OVERRIDE', grantId: null })),
        features: features.map((grant) => ({ ...grant, source: 'SYSTEM_ADMIN_OVERRIDE', grantId: null })),
      },
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
    const effective = directWorkspace?.permissionLevel.toLowerCase() === 'admin'
      ? directWorkspace
      : directFeature ?? directWorkspace ?? roleFeature ?? roleWorkspace;
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
  const independentActionFeatures = activeCanonicalFeatures
    .filter((grant) => HR_ACTION_CODES.has(grant.featureCode))
    .map((grant) => ({ feature: grant.featureCode, permission: permission(grant.level), workspace: 'hr' }));
  const hrFeatures = !effectiveHrWorkspaceLevel
    ? independentActionFeatures
    : broadManagerOverride
      ? HR_FEATURE_CODES.map((feature) => ({
        feature,
        permission: 'admin' as const,
        workspace: 'hr',
      }))
      : [...hrFeatureCodes].map((feature) => {
    const direct = directHrFeatures.get(feature);
    const inherited = inheritedHrFeatures.find((grant) => grant.feature === feature);
    const resolvedLevel = direct?.level ?? inherited!.permissionLevel;
    return {
      feature,
      // Action permissions are independently scoped authorization. A VIEW
      // workspace grant admits the user to the destination without reducing
      // an explicitly granted EDIT action to VIEW.
      permission: HR_ACTION_CODES.has(feature)
        ? permission(resolvedLevel)
        : capAtWorkspaceLevel(resolvedLevel, effectiveHrWorkspaceLevel),
      workspace: 'hr',
    };
      });

  const features = [...nonHrFeatures, ...hrFeatures];
  const workspaceProvenance = workspaces.map((grant) => {
    if (grant.workspace === 'hr') {
      return { ...grant, source: canonicalHr ? 'CANONICAL_HR_WORKSPACE' as const : 'ROLE_WORKSPACE' as const,
        grantId: canonicalHr?.id ?? inheritedHr?.id ?? null };
    }
    const direct = activeDirect.find((candidate) => candidate.workspace === grant.workspace);
    const inherited = roleWorkspaces.find((candidate) => candidate.workspace === grant.workspace && activeLegacyGrant(candidate, at));
    return { ...grant, source: direct ? 'DIRECT_WORKSPACE' as const : 'ROLE_WORKSPACE' as const,
      grantId: direct?.id ?? inherited?.id ?? null };
  });
  const featureProvenance = features.map((grant) => {
    if (grant.workspace === 'hr') {
      if (broadManagerOverride) return { ...grant, source: 'HR_MANAGER_OVERRIDE' as const, grantId: canonicalHr?.id ?? null };
      const direct = directHrFeatures.get(grant.feature);
      const inherited = inheritedHrFeatures.find((candidate) => candidate.feature === grant.feature);
      return { ...grant, source: direct ? 'CANONICAL_HR_FEATURE' as const : 'ROLE_FEATURE' as const,
        grantId: direct?.id ?? inherited?.id ?? null };
    }
    const directFeature = activeDirectFeatures.find((candidate) => candidate.feature === grant.feature);
    const directWorkspace = activeDirect.find((candidate) => candidate.workspace === grant.workspace);
    const roleFeature = activeRoleFeatures.find((candidate) => candidate.feature === grant.feature);
    const roleWorkspace = roleWorkspaces.find((candidate) => candidate.workspace === grant.workspace && activeLegacyGrant(candidate, at));
    if (directWorkspace?.permissionLevel.toLowerCase() === 'admin') {
      return { ...grant, source: 'DIRECT_WORKSPACE' as const, grantId: directWorkspace.id };
    }
    if (directFeature) return { ...grant, source: 'DIRECT_FEATURE' as const, grantId: directFeature.id };
    if (directWorkspace) return { ...grant, source: 'DIRECT_WORKSPACE' as const, grantId: directWorkspace.id };
    if (roleFeature) return { ...grant, source: 'ROLE_FEATURE' as const, grantId: roleFeature.id };
    return { ...grant, source: 'ROLE_WORKSPACE' as const, grantId: roleWorkspace?.id ?? null };
  });
  return { workspaces, features, provenance: { workspaces: workspaceProvenance, features: featureProvenance } };
};
