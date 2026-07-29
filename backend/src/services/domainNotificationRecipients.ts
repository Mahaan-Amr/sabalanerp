import type { Prisma, PrismaClient } from '@prisma/client';

type Database = PrismaClient | Prisma.TransactionClient;
const permissionRank: Record<string, number> = { view: 0, edit: 1, admin: 2 };

export const resolveWorkspaceRecipientIds = async (
  database: Database,
  workspace: string,
  minimumPermission: 'view' | 'edit' | 'admin' = 'view',
) => {
  const now = new Date();
  const [userPermissions, rolePermissions, admins] = await Promise.all([
    database.workspacePermission.findMany({
      where: { workspace, isActive: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      select: { userId: true, permissionLevel: true },
    }),
    database.roleWorkspacePermission.findMany({
      where: { workspace, isActive: true },
      select: { role: true, permissionLevel: true },
    }),
    database.user.findMany({ where: { role: 'ADMIN', isActive: true }, select: { id: true } }),
  ]);
  const minimum = permissionRank[minimumPermission];
  const direct = userPermissions
    .filter((permission) => (permissionRank[permission.permissionLevel] ?? -1) >= minimum)
    .map((permission) => permission.userId);
  const roles = rolePermissions
    .filter((permission) => (permissionRank[permission.permissionLevel] ?? -1) >= minimum)
    .map((permission) => permission.role);
  const roleUsers = roles.length
    ? await database.user.findMany({ where: { role: { in: roles as any }, isActive: true }, select: { id: true } })
    : [];
  return [...new Set([...admins.map((user) => user.id), ...direct, ...roleUsers.map((user) => user.id)])];
};
