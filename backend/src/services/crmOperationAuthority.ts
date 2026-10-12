import type { Prisma } from '@prisma/client';
import { customerManagementCapabilities, CustomerManagementError } from './crmCustomerManagement';
import { getEffectiveUserAccess } from './effectiveAccessService';
import { evaluateNarrowFeatureAccess } from './narrowFeatureAccess';

export async function readManagedCrmOperations(tx: Prisma.TransactionClient, actorId: string) {
  const actor = await tx.user.findUnique({ where: { id: actorId }, select: { role: true, isActive: true, partnerProfile: { select: { id: true } } } });
  const visible = Boolean(actor?.isActive && !actor.partnerProfile && (await customerManagementCapabilities(tx, actorId)).canViewAllCustomers);
  const effective = visible && actor ? await getEffectiveUserAccess(tx, { userId: actorId, userRole: actor.role }) : null;
  const [userFeatures, roleFeatures, userWorkspaces, roleWorkspaces] = visible && actor ? await Promise.all([
    tx.featurePermission.findMany({ where: { userId: actorId } }),
    tx.roleFeaturePermission.findMany({ where: { role: actor.role } }),
    tx.workspacePermission.findMany({ where: { userId: actorId } }),
    tx.roleWorkspacePermission.findMany({ where: { role: actor.role } }),
  ]) : [[], [], [], []];
  const has = async (feature: string, workspace = 'crm', required: 'view' | 'edit' = 'edit') => {
    if (!visible || !actor || effective?.disabledFeatures?.includes(feature)) return false;
    const level = effective?.workspaces.find(row => row.workspace === workspace)?.permission;
    if (!(required === 'view' ? ['view', 'edit', 'admin'] : ['edit', 'admin']).includes(level || '')) return false;
    return evaluateNarrowFeatureAccess({ role: actor.role, requiredPermission: required,
      userFeature: userFeatures.find(row => row.workspace === workspace && row.feature === feature) ?? null,
      roleFeature: roleFeatures.find(row => row.workspace === workspace && row.feature === feature) ?? null,
      userWorkspace: userWorkspaces.find(row => row.workspace === workspace) ?? null,
      roleWorkspace: roleWorkspaces.find(row => row.workspace === workspace) ?? null,
    }).allowed;
  };
  return { visible, isAdmin: actor?.role === 'ADMIN', has };
}

export async function requireManagedCrmOperation(tx: Prisma.TransactionClient, actorId: string, feature: string) {
  if (!await (await readManagedCrmOperations(tx, actorId)).has(feature)) {
    throw new CustomerManagementError(403, 'CRM_OPERATION_FORBIDDEN', 'مجوز این عملیات برای این مشتری فعال نیست.');
  }
}
