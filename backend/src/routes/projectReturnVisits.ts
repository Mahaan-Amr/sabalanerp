import express, { type Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { protect } from '../middleware/auth';
import { FEATURES, FEATURE_PERMISSIONS, requireFeatureAccess, type FeatureRequest } from '../middleware/feature';
import { requireWorkspaceAccess, WORKSPACES, WORKSPACE_PERMISSIONS, type WorkspaceRequest } from '../middleware/workspace';
import { GuardQueueConflictError, GuardQueueValidationError } from '../services/guardDriverQueue';
import { cancelProjectReturnVisit, listProjectReturnVisits } from '../services/projectReturnGuardVisits';

const router = express.Router();
router.use(protect, (_req, res, next) => {
  res.set('Cache-Control', 'private, no-store');
  next();
});

function fail(res: Response, error: unknown) {
  if (error instanceof GuardQueueValidationError) return res.status(400).json({ success: false, error: error.message });
  if (error instanceof GuardQueueConflictError) return res.status(409).json({ success: false, error: error.message });
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034') {
    return res.status(409).json({ success: false, error: 'وضعیت مراجعه تغییر کرده است. دوباره تلاش کنید.' });
  }
  console.error('Logistics project return visit command failed:', error);
  return res.status(500).json({ success: false, error: 'انجام عملیات مراجعهٔ مرجوعی ناموفق بود.' });
}

router.get('/', requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.VIEW),
  requireFeatureAccess(FEATURES.LOGISTICS_STONE_RETURNS, FEATURE_PERMISSIONS.VIEW),
  async (req: WorkspaceRequest & FeatureRequest, res) => {
    try {
      const canCancel = [req.workspacePermission, req.featurePermission].every(level => level === 'edit' || level === 'admin');
      return res.json({ success: true, data: await listProjectReturnVisits(prisma), capabilities: { canCancel } });
    } catch (error) {
      return fail(res, error);
    }
  });

router.post('/:id/cancel', requireWorkspaceAccess(WORKSPACES.LOGISTICS, WORKSPACE_PERMISSIONS.EDIT),
  requireFeatureAccess(FEATURES.LOGISTICS_STONE_RETURNS, FEATURE_PERMISSIONS.EDIT),
  async (req: WorkspaceRequest, res) => {
    try {
      const visit = await cancelProjectReturnVisit(prisma, { turnId: req.params.id, actorId: req.user!.id });
      return res.json({ success: true, data: visit });
    } catch (error) {
      return fail(res, error);
    }
  });

export default router;
