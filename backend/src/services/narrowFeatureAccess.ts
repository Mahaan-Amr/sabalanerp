export type NarrowPermissionLevel = 'view' | 'edit' | 'admin';

export type NarrowPermissionRecord = {
  isActive: boolean;
  expiresAt?: Date | null;
  permissionLevel: string;
} | null;

const levels: NarrowPermissionLevel[] = ['view', 'edit', 'admin'];
const activeAt = (permission: NarrowPermissionRecord, at: Date) => Boolean(
  permission?.isActive && (!permission.expiresAt || permission.expiresAt.getTime() > at.getTime()),
);

export const evaluateNarrowFeatureAccess = (input: {
  role: string;
  requiredPermission: NarrowPermissionLevel;
  userFeature: NarrowPermissionRecord;
  roleFeature: NarrowPermissionRecord;
  userWorkspace: NarrowPermissionRecord;
  roleWorkspace: NarrowPermissionRecord;
}, at = new Date()): { allowed: boolean; permissionLevel: NarrowPermissionLevel | null } => {
  if (input.role === 'ADMIN' || input.role === 'MANAGER') return { allowed: true, permissionLevel: 'admin' };
  const explicit = activeAt(input.userFeature, at) ? input.userFeature : activeAt(input.roleFeature, at) ? input.roleFeature : null;
  const workspaceAdmin = [input.userWorkspace, input.roleWorkspace].some((permission) => activeAt(permission, at) && permission?.permissionLevel === 'admin');
  const permissionLevel = workspaceAdmin ? 'admin' : explicit?.permissionLevel as NarrowPermissionLevel | undefined;
  const allowed = Boolean(permissionLevel && levels.indexOf(permissionLevel) >= levels.indexOf(input.requiredPermission));
  return { allowed, permissionLevel: allowed ? permissionLevel! : null };
};

type NarrowAccessPrisma = Pick<PrismaClient,
  'featurePermission' | 'roleFeaturePermission' | 'workspacePermission' | 'roleWorkspacePermission'
>;

type NarrowAuthorityPrisma = NarrowAccessPrisma & Pick<PrismaClient, 'user'>;

export const resolveNarrowFeatureAccess = async (prisma: NarrowAccessPrisma, input: {
  userId: string; role: string; workspace: string; feature: string; requiredPermission: NarrowPermissionLevel;
}, at = new Date()) => {
  const [userFeature, roleFeature, userWorkspace, roleWorkspace] = await Promise.all([
    prisma.featurePermission.findUnique({ where: { userId_workspace_feature: { userId: input.userId, workspace: input.workspace, feature: input.feature } } }),
    prisma.roleFeaturePermission.findUnique({ where: { role_workspace_feature: { role: input.role, workspace: input.workspace, feature: input.feature } } }),
    prisma.workspacePermission.findUnique({ where: { userId_workspace: { userId: input.userId, workspace: input.workspace } } }),
    prisma.roleWorkspacePermission.findUnique({ where: { role_workspace: { role: input.role, workspace: input.workspace } } }),
  ]);
  return evaluateNarrowFeatureAccess({ role: input.role, requiredPermission: input.requiredPermission, userFeature, roleFeature, userWorkspace, roleWorkspace }, at);
};

export const resolveEffectiveNarrowAuthority = async (prisma: NarrowAuthorityPrisma, input: {
  userId: string; workspace: string; feature: string; requiredPermission: NarrowPermissionLevel;
}, at = new Date()) => {
  const actor = await prisma.user.findUnique({ where: { id: input.userId }, select: { id: true, role: true, isActive: true } });
  if (!actor?.isActive) throw new Error('Effective authority requires an active actor.');
  const access = await resolveNarrowFeatureAccess(prisma, { userId: actor.id, role: actor.role,
    workspace: input.workspace, feature: input.feature, requiredPermission: input.requiredPermission }, at);
  if (!access.allowed || !access.permissionLevel) throw new Error('Actor lacks current narrow feature authority.');
  return { actorRole: actor.role, workspace: input.workspace, workspacePermission: access.permissionLevel,
    feature: input.feature, featurePermission: access.permissionLevel } as const;
};
import type { PrismaClient } from '@prisma/client';
