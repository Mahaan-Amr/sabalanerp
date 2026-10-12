import type { Prisma } from '@prisma/client';
import { getEffectiveUserAccess } from '../../effectiveAccessService';
import { evaluateNarrowFeatureAccess } from '../../narrowFeatureAccess';

/** Shared operations use the same live workspace and narrow feature decisions
 * as ordinary contracts. This is not a replacement for Case authority or for
 * the command's commercial/integrity gates. */
export async function readSharedOperationAuthority(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId },
    select: { role: true, isActive: true, partnerProfile: { select: { id: true } } } });
  if (!actor?.isActive || actor.partnerProfile) return async () => false;
  const effective = await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role });
  if (!effective.workspaces.some(row => ['accounting', 'logistics', 'security'].includes(row.workspace))) return async () => false;
  const [userFeatures, roleFeatures, userWorkspaces, roleWorkspaces] = await Promise.all([
    tx.featurePermission.findMany({ where: { userId: actorId } }),
    tx.roleFeaturePermission.findMany({ where: { role: actor.role } }),
    tx.workspacePermission.findMany({ where: { userId: actorId } }),
    tx.roleWorkspacePermission.findMany({ where: { role: actor.role } }),
  ]);
  const now = new Date();
  return async (workspace: string, feature: string | null, required: 'view' | 'edit' | 'admin' = 'edit') => {
    if (feature && effective.disabledFeatures?.includes(feature)) return false;
    const level = effective.workspaces.find(row => row.workspace === workspace)?.permission;
    if (!(required === 'view' ? ['view', 'edit', 'admin'] : required === 'admin' ? ['admin'] : ['edit', 'admin']).includes(level || '')) return false;
    return feature === null || evaluateNarrowFeatureAccess({ role: actor.role, requiredPermission: required,
      userFeature: userFeatures.find(row => row.workspace === workspace && row.feature === feature) ?? null,
      roleFeature: roleFeatures.find(row => row.workspace === workspace && row.feature === feature) ?? null,
      userWorkspace: userWorkspaces.find(row => row.workspace === workspace) ?? null,
      roleWorkspace: roleWorkspaces.find(row => row.workspace === workspace) ?? null,
    }, now).allowed;
  };
}

export async function hasSharedOperationAuthority(tx: Prisma.TransactionClient, actorId: string,
  workspace: string, feature: string | null, required: 'view' | 'edit' = 'edit') {
  return (await readSharedOperationAuthority(tx, actorId))(workspace, feature, required);
}
