import type { Prisma, PrismaClient } from '@prisma/client';
import { getEffectiveUserAccess, type AuthorizationProvenanceSource } from './effectiveAccessService';

type PermissionLevel = 'view' | 'edit' | 'admin';
type Grant = { permissionLevel: PermissionLevel } | null;

const rank: Record<PermissionLevel, number> = { view: 1, edit: 2, admin: 3 };

export const evaluateWorkspaceDutyAuthority = (input: {
  role: string;
  directWorkspace: Grant;
  roleWorkspace: Grant;
  directFeature: Grant;
  roleFeature: Grant;
}) => {
  if (input.role === 'ADMIN') {
    return { isWorkspaceAdmin: true, hasFeatureEdit: true, canSelfDecide: true };
  }
  const workspace = input.directWorkspace ?? input.roleWorkspace;
  // A current direct feature grant is an intentional narrowing override.
  const feature = input.directFeature ?? input.roleFeature;
  const isWorkspaceAdmin = workspace?.permissionLevel === 'admin';
  const hasFeatureEdit = Boolean(feature && rank[feature.permissionLevel] >= rank.edit);
  return { isWorkspaceAdmin, hasFeatureEdit, canSelfDecide: isWorkspaceAdmin && hasFeatureEdit };
};

type Database = PrismaClient | Prisma.TransactionClient;
export type DutyAccessProvenance = {
  workspace: { source: AuthorizationProvenanceSource; grantId: string | null } | null;
  feature: { source: AuthorizationProvenanceSource; grantId: string | null } | null;
};

export const resolveWorkspaceDutyAuthority = async (
  database: Database,
  input: { userId: string; workspace: string; feature: string; at?: Date },
) => {
  const at = input.at ?? new Date();
  const actor = await database.user.findUnique({
    where: { id: input.userId },
    select: { role: true, isActive: true },
  });
  if (!actor?.isActive) {
    return { isWorkspaceAdmin: false, hasFeatureEdit: false, canSelfDecide: false,
      provenance: { workspace: null, feature: null } satisfies DutyAccessProvenance };
  }
  const effective = await getEffectiveUserAccess(database, {
    userId: input.userId, userRole: actor.role, at,
  });
  const [directWorkspaceRow, directFeatureRow, roleFeatureRow, canonicalWorkspaceRow, canonicalFeatureRow] = await Promise.all([
    database.workspacePermission.findUnique({
      where: { userId_workspace: { userId: input.userId, workspace: input.workspace } },
    }),
    database.featurePermission.findUnique({
      where: { userId_workspace_feature: { userId: input.userId, workspace: input.workspace, feature: input.feature } },
    }),
    database.roleFeaturePermission.findUnique({
      where: { role_workspace_feature: { role: actor.role, workspace: input.workspace, feature: input.feature } },
    }),
    input.workspace === 'hr' ? database.hrWorkspaceAccessGrant.findFirst({
      where: { userId: input.userId, workspaceCode: 'HUMAN_RESOURCES', reason: { not: 'HR redesign baseline' } }, orderBy: { effectiveFrom: 'desc' },
    }) : null,
    database.hrFeatureAccessGrant.findFirst({
      where: { userId: input.userId, featureCode: input.feature, reason: { not: 'HR redesign baseline' } }, orderBy: { effectiveFrom: 'desc' },
    }),
  ]);
  const active = (grant: { isActive: boolean; expiresAt?: Date | null } | null) => Boolean(
    grant?.isActive && (!grant.expiresAt || grant.expiresAt > at),
  );
  const activeCanonical = (grant: { status: string; effectiveFrom: Date; effectiveTo: Date | null } | null) => Boolean(
    grant?.status === 'ACTIVE' && grant.effectiveFrom <= at && (!grant.effectiveTo || grant.effectiveTo > at),
  );
  const workspace = effective.provenance.workspaces.find((grant) => grant.workspace === input.workspace) ?? null;
  const systemAdmin = actor.role === 'ADMIN';
  // The centralized result is authoritative, while the duty projection treats
  // any direct row as an explicit veto of inherited authority after expiry,
  // revocation, or narrowing.
  const workspaceDirectVeto = Boolean(
    directWorkspaceRow ? !active(directWorkspaceRow) : canonicalWorkspaceRow && !activeCanonical(canonicalWorkspaceRow),
  );
  const isWorkspaceAdmin = systemAdmin || (!workspaceDirectVeto && workspace?.permission === 'admin');
  // Workspace admin establishes scope; an explicit feature checkbox establishes
  // permission for this action. A broad workspace grant alone is insufficient.
  const selectedFeature = directFeatureRow ?? canonicalFeatureRow ?? roleFeatureRow;
  const selectedFeatureLevel = selectedFeature
    ? ('permissionLevel' in selectedFeature ? selectedFeature.permissionLevel : selectedFeature.level).toLowerCase() as PermissionLevel
    : undefined;
  const featureActive = systemAdmin || (selectedFeature && 'status' in selectedFeature
    ? activeCanonical(selectedFeature) : active(selectedFeature));
  const hasFeatureEdit = Boolean(systemAdmin || (featureActive && selectedFeatureLevel
    && rank[selectedFeatureLevel] >= rank.edit));
  return {
    isWorkspaceAdmin,
    hasFeatureEdit,
    canSelfDecide: isWorkspaceAdmin && hasFeatureEdit,
    provenance: {
      workspace: workspace ? { source: workspace.source, grantId: workspace.grantId } : null,
      feature: systemAdmin ? { source: 'SYSTEM_ADMIN_OVERRIDE', grantId: null }
        : selectedFeature ? {
          source: directFeatureRow ? 'DIRECT_FEATURE'
            : canonicalFeatureRow ? 'CANONICAL_HR_FEATURE' : 'ROLE_FEATURE', grantId: selectedFeature.id,
        } : null,
    } satisfies DutyAccessProvenance,
  };
};
