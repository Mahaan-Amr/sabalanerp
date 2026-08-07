import express from 'express';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../middleware/auth';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess, requireNarrowFeatureAccess } from '../middleware/feature';
import { appendDispatchMasterDataAudit } from '../services/dispatchMasterDataAudit';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';
import { activeAt, actor, fail, internalInclude, parsedDate, prisma, projectDriver, requiredText } from './dispatch-master-data.shared';

const router = express.Router();
const view = requireFeatureAccess(FEATURES.HR_INTERNAL_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW);
const manage = requireNarrowFeatureAccess(FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE, FEATURE_PERMISSIONS.EDIT);

router.get('/internal-drivers/personnel/:personnelId', view, async (req: AuthRequest, res) => {
  try {
    const at = req.query.at ? parsedDate(req.query.at, 'at') : new Date();
    const [personnel, driver, manageAccess] = await Promise.all([
      prisma.personnel.findUnique({ where: { id: req.params.personnelId } }),
      prisma.internalDriverProfile.findUnique({ where: { personnelId: req.params.personnelId }, include: internalInclude }),
      resolveNarrowFeatureAccess(prisma, { userId: actor(req), role: req.user!.role, workspace: 'hr', feature: FEATURES.HR_INTERNAL_DRIVER_ELIGIBILITY_MANAGE, requiredPermission: 'edit' }, at),
    ]);
    if (!personnel) return res.status(404).json({ success: false, error: 'Personnel was not found.' });
    return res.json({ success: true, data: { personnel, driver: driver ? projectDriver(driver, at) : null }, capabilities: { canManageEligibility: manageAccess.allowed } });
  } catch (error) { return fail(res, error, 'Read Personnel-owned driver eligibility'); }
});

router.get('/internal-drivers', view, async (req, res) => {
  try {
    const at = req.query.at ? parsedDate(req.query.at, 'at') : new Date();
    const drivers = await prisma.internalDriverProfile.findMany({ include: internalInclude, orderBy: { createdAt: 'desc' } });
    return res.json({ success: true, data: drivers.map((driver) => projectDriver(driver, at)) });
  } catch (error) { return fail(res, error, 'List HR internal drivers'); }
});

router.post('/internal-drivers', manage, async (req: AuthRequest, res) => {
  try {
    const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom');
    const reason = requiredText(req.body.reason, 'reason');
    const created = await prisma.$transaction(async (tx) => {
      const personnel = await tx.personnel.findUnique({ where: { id: requiredText(req.body.personnelId, 'personnelId') } });
      if (!personnel || !personnel.isActive || personnel.archivedAt) throw new Error('An active Personnel record is required.');
      const driver = await tx.internalDriverProfile.create({ data: { personnelId: personnel.id, createdBy: actor(req) } });
      await tx.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status: 'ELIGIBLE', effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'HR', subjectType: 'INTERNAL_DRIVER_ELIGIBILITY', subjectId: driver.id, eventType: 'INTERNAL_DRIVER_DESIGNATED', payload: { personnelId: personnel.id, effectiveFrom, reason }, actorId: actor(req) });
      return tx.internalDriverProfile.findUniqueOrThrow({ where: { id: driver.id }, include: internalInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.status(201).json({ success: true, data: projectDriver(created) });
  } catch (error) { return fail(res, error, 'Designate internal driver'); }
});

router.post('/internal-drivers/:id/eligibility', manage, async (req: AuthRequest, res) => {
  try {
    const status = requiredText(req.body.status, 'status') as 'ELIGIBLE' | 'SUSPENDED' | 'ENDED';
    if (!['ELIGIBLE', 'SUSPENDED', 'ENDED'].includes(status)) throw new Error('Unsupported eligibility status.');
    const effectiveFrom = parsedDate(req.body.effectiveFrom, 'effectiveFrom');
    const reason = requiredText(req.body.reason, 'reason');
    const result = await prisma.$transaction(async (tx) => {
      const driver = await tx.internalDriverProfile.findUnique({ where: { id: req.params.id } });
      if (!driver) throw new Error('Internal driver was not found.');
      const current = await tx.internalDriverEligibilityPeriod.findFirst({ where: { driverId: driver.id, ...activeAt(effectiveFrom) }, orderBy: { effectiveFrom: 'desc' } });
      if (current?.effectiveFrom.getTime() === effectiveFrom.getTime()) throw new Error('A recorded eligibility transition already exists at this time.');
      if (current) await tx.internalDriverEligibilityPeriod.update({ where: { id: current.id }, data: { effectiveTo: effectiveFrom } });
      const period = await tx.internalDriverEligibilityPeriod.create({ data: { driverId: driver.id, status, effectiveFrom, reason, recordedBy: actor(req) } });
      await appendDispatchMasterDataAudit(tx, { ownerScope: 'HR', subjectType: 'INTERNAL_DRIVER_ELIGIBILITY', subjectId: driver.id, eventType: `ELIGIBILITY_${status}`, payload: { periodId: period.id, effectiveFrom, reason }, actorId: actor(req) });
      return tx.internalDriverProfile.findUniqueOrThrow({ where: { id: driver.id }, include: internalInclude });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    return res.json({ success: true, data: projectDriver(result) });
  } catch (error) { return fail(res, error, 'Transition internal-driver eligibility'); }
});

export default router;
