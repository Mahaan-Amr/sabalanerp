import { NextFunction, Response } from 'express';
import { AuthRequest } from './auth';
import { prisma } from '../lib/prisma';
import { activeHrAuthoritiesForUser } from '../services/hrAuthorizationService';
import { getEffectiveUserAccess } from '../services/effectiveAccessService';

export async function attendanceCapabilities(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, isActive: true } });
  if (!user?.isActive) return { manage: false, review: false, view: false, report: false };
  const authorities = await activeHrAuthoritiesForUser(prisma, userId);
  const manage = user.role === 'ADMIN' || authorities.some(a => ['COMPANY_MANAGER', 'HR_MANAGER', 'HR_PROCESSOR'].includes(a));
  const [guard, access] = await Promise.all([
    prisma.securityPersonnel.findUnique({ where: { userId }, select: { isActive: true } }),
    getEffectiveUserAccess(prisma, { userId, userRole: user.role }),
  ]);
  const workspace = access.workspaces.find(w => w.workspace === 'security');
  return { manage, report: ['ADMIN', 'MANAGER'].includes(user.role) && (user.role === 'ADMIN' || workspace?.permission === 'admin'), review: manage || Boolean(guard?.isActive && workspace), view: manage || Boolean(workspace) };
}
const gate = (capability: 'view' | 'review' | 'manage') => async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user || !(await attendanceCapabilities(req.user.id))[capability]) { res.status(403).json({ success: false, error: 'مجوز حضور و غیاب لازم است.' }); return; }
    next();
  } catch { res.status(500).json({ success: false, error: 'بررسی مجوز حضور و غیاب ناموفق بود.' }); }
};
export const attendanceDeviceView = gate('view');
export const attendanceDeviceReview = gate('review');
export const attendanceDeviceManage = gate('manage');
