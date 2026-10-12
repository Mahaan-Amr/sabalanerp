import { Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma';

export const OPERATION_MINIMUM_FEATURE = 'inventory_operation_minimum_edit';
export async function canEditOperationMinimum(user: { id: string; role: string }, db: Pick<PrismaClient, 'featurePermission' | 'roleFeaturePermission'> = prisma) {
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  const [direct, inherited] = await Promise.all([
    db.featurePermission.findUnique({ where: { userId_workspace_feature: { userId: user.id, workspace: 'inventory', feature: OPERATION_MINIMUM_FEATURE } } }),
    db.roleFeaturePermission.findUnique({ where: { role_workspace_feature: { role: user.role, workspace: 'inventory', feature: OPERATION_MINIMUM_FEATURE } } }),
  ]);
  const active = (value: { isActive: boolean; expiresAt?: Date | null } | null) =>
    value?.isActive && (!value.expiresAt || value.expiresAt > new Date());
  const grant = active(direct) ? direct : active(inherited) ? inherited : null;
  // Inventory administration/editing cannot replace this independently granted privilege.
  return Boolean(grant && ['edit', 'admin'].includes(grant.permissionLevel));
}

/** Null and zero are unrestricted. Reject excess precision instead of rounding the rule. */
export function parseOperationMinimum(value: unknown): Prisma.Decimal | null {
  if (value === undefined || value === null || value === '') return null;
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      !/^\d{1,15}(?:\.\d{1,3})?$/.test(String(value))) {
    throw new Error('حداقل مقدار باید عددی نامنفی با حداکثر سه رقم اعشار باشد.');
  }
  const result = new Prisma.Decimal(value);
  return result.isZero() ? null : result;
}

export async function authorizeOperationMinimumChange(user: { id: string; role: string }, value: unknown,
  previous: Prisma.Decimal | null = null) {
  const minimum = parseOperationMinimum(value);
  if (minimum?.eq(previous ?? 0) || (!minimum && (!previous || previous.isZero()))) return minimum;
  if (!await canEditOperationMinimum(user)) {
    const error = new Error('مجوز تغییر حداقل مقدار ابزار و فرآوری سنگ برای شما فعال نیست.');
    Object.assign(error, { status: 403 });
    throw error;
  }
  return minimum;
}
