import express from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from '../middleware/auth';
import { requireHrAuthorization } from '../middleware/hrAuthorization';
import { PERFORMANCE_ACTION_PERMISSION_CODES } from '../services/hrActionPermissionCatalog';
import { activeHrActionPermissionsForUser } from '../services/hrAuthorizationService';

const router = express.Router();
const performancePermissionCodes = new Set<string>(PERFORMANCE_ACTION_PERMISSION_CODES);

export const projectPersonnelPerformanceCapabilities = (featureCodes: readonly string[]) => Object.fromEntries(
  featureCodes
    .filter((code) => performancePermissionCodes.has(code))
    .map((code) => [code, true]),
);

router.get('/capabilities', async (req: AuthRequest, res, next) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'نشست شما معتبر نیست.' });
    const permissions = await activeHrActionPermissionsForUser(prisma, req.user.id);
    return res.json({ success: true, capabilities: projectPersonnelPerformanceCapabilities(permissions) });
  } catch (error) {
    next(error);
  }
});

router.get('/rollout', requireHrAuthorization({ actionPermissionCodes: ['MANAGE_PERFORMANCE_ROLLOUT'] }), async (_req, res, next) => {
  try {
    const now = new Date();
    const phase = await prisma.performanceFeaturePhaseVersion.findFirst({
      where: { effectiveFrom: { lte: now } },
      orderBy: [{ effectiveFrom: 'desc' }, { version: 'desc' }],
      select: {
        id: true,
        version: true,
        phase: true,
        releaseEnabled: true,
        cohortVersionId: true,
        effectiveFrom: true,
      },
    });
    const pause = phase ? await prisma.performanceSafetyPause.findFirst({
      where: {
        phaseVersionId: phase.id,
        status: 'ACTIVE',
      },
      select: { scope: true, startedAt: true, reasonCode: true },
      orderBy: { startedAt: 'desc' },
    }) : null;
    if (!phase) return res.json({ success: true, rollout: null });
    const { id: _phaseId, ...publicPhase } = phase;
    return res.json({ success: true, rollout: { ...publicPhase, paused: Boolean(pause), pause } });
  } catch (error) {
    next(error);
  }
});

export default router;
