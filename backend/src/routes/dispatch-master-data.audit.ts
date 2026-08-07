import express from 'express';
import { FEATURE_PERMISSIONS, FEATURES, requireFeatureAccess } from '../middleware/feature';
import { fail, prisma } from './dispatch-master-data.shared';

const router = express.Router();
const read = async (ownerScope: 'HR' | 'VEHICLE_OPERATIONS' | 'GUARD', subjectType: string, subjectId: string, res: any) => {
  try {
    const data = await prisma.dispatchMasterDataAudit.findMany({ where: { ownerScope, subjectType, subjectId }, orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }] });
    return res.json({ success: true, data });
  } catch (error) { return fail(res, error, 'Read workspace-owned dispatch master-data audit'); }
};

router.get('/audit/hr/internal-driver/:subjectId', requireFeatureAccess(FEATURES.HR_INTERNAL_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW), (req, res) => read('HR', 'INTERNAL_DRIVER_ELIGIBILITY', req.params.subjectId, res));
router.get('/audit/vehicle-operations/:subjectType/:subjectId', requireFeatureAccess(FEATURES.HR_VEHICLE_OPERATIONS_VIEW, FEATURE_PERMISSIONS.VIEW), (req, res) => {
  if (!['INTERNAL_DRIVER_PROFILE', 'COMPANY_VEHICLE'].includes(req.params.subjectType)) return res.status(404).json({ success: false, error: 'Evidence subject was not found.' });
  return read('VEHICLE_OPERATIONS', req.params.subjectType, req.params.subjectId, res);
});
router.get('/audit/guard/:subjectType/:subjectId', requireFeatureAccess(FEATURES.SECURITY_EXTERNAL_DRIVERS_VIEW, FEATURE_PERMISSIONS.VIEW), (req, res) => {
  if (!['EXTERNAL_DRIVER', 'EXTERNAL_VEHICLE'].includes(req.params.subjectType)) return res.status(404).json({ success: false, error: 'Evidence subject was not found.' });
  return read('GUARD', req.params.subjectType, req.params.subjectId, res);
});

export default router;
