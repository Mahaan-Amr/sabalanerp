import { prisma } from '../lib/prisma';
import express, { Response } from 'express';
import { PrismaClient } from '@prisma/client';
import { protect, AuthRequest } from '../middleware/auth';
import { getUserWorkspaces } from '../middleware/workspace';
import { getDispatchCaseTimeline, listDispatchCases } from '../services/dispatchCaseTimeline';
import { FEATURES } from '../middleware/feature';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';

const router = express.Router();
const allowed = new Set(['hr', 'vehicle-operations', 'security', 'logistics', 'accounting']);
const requiredFeature: Record<string, string> = {
  hr: FEATURES.HR_INTERNAL_DRIVERS_VIEW,
  'vehicle-operations': FEATURES.HR_VEHICLE_OPERATIONS_VIEW,
  security: FEATURES.SECURITY_DISPATCH_EVIDENCE_VIEW,
  logistics: FEATURES.LOGISTICS_LOADINGS_VIEW,
  accounting: FEATURES.ACCOUNTING_DISPATCH_CANDIDATES_VIEW,
};

const accessFor = async (req: AuthRequest) => {
  const requested = String(req.query.workspace || '').trim();
  if (!allowed.has(requested)) return null;
  const actual = requested === 'vehicle-operations' ? 'hr' : requested;
  const grants = await getUserWorkspaces(req.user!.id, req.user!.role);
  const grant = grants.find((item) => item.workspace === actual);
  if (!grant) return null;
  const feature = await resolveNarrowFeatureAccess(prisma, { userId: req.user!.id, role: req.user!.role,
    workspace: actual, feature: requiredFeature[requested], requiredPermission: 'view' });
  return feature.allowed ? { workspace: requested, permission: feature.permissionLevel || grant.permission } : null;
};

router.get('/', protect, async (req: AuthRequest, res: Response) => {
  try {
    const access = await accessFor(req);
    if (!access) return res.status(403).json({ success: false, error: 'Dispatch case access denied.' });
    const filters = { subjectId: typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined,
      loadingId: typeof req.query.loadingId === 'string' ? req.query.loadingId : undefined };
    return res.json({ success: true, data: await listDispatchCases(prisma, access, filters), access });
  } catch (error) {
    console.error('Dispatch case list error:', error);
    return res.status(500).json({ success: false, error: 'Dispatch cases are temporarily unavailable.' });
  }
});

router.get('/:queueTurnId', protect, async (req: AuthRequest, res: Response) => {
  try {
    const access = await accessFor(req);
    if (!access) return res.status(403).json({ success: false, error: 'Dispatch case access denied.' });
    const filters = { subjectId: typeof req.query.subjectId === 'string' ? req.query.subjectId : undefined,
      loadingId: typeof req.query.loadingId === 'string' ? req.query.loadingId : undefined };
    const data = await getDispatchCaseTimeline(prisma, req.params.queueTurnId, access, filters);
    if (!data) return res.status(404).json({ success: false, error: 'Dispatch case was not found.' });
    return res.json({ success: true, data });
  } catch (error) {
    console.error('Dispatch case detail error:', error);
    return res.status(500).json({ success: false, error: 'Dispatch case timeline is temporarily unavailable.' });
  }
});

export default router;
