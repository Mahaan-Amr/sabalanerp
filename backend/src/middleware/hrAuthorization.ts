import type { NextFunction, Response } from 'express';
import { prisma } from '../lib/prisma';
import type { AuthRequest } from './auth';
import type { HrAccessLevel, HrAuthorizationLayer } from '../services/hrAuthorizationPolicy';
import { authorizeHrUser } from '../services/hrAuthorizationService';

export type HrAuthorizedRequest = AuthRequest & {
  hrAuthorization?: { missingLayers: HrAuthorizationLayer[] };
};

export const requireHrAuthorization = (requirement: {
  workspaceLevel?: HrAccessLevel;
  feature?: { code: string; level: HrAccessLevel };
  authorityCodes?: string[];
  dutyIdFromRequest?: (req: AuthRequest) => string | undefined;
  systemRoles?: string[];
}) => async (req: HrAuthorizedRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
    const { dutyIdFromRequest, ...fixedRequirement } = requirement;
    const decision = await authorizeHrUser(prisma, req.user.id, {
      ...fixedRequirement,
      dutyId: dutyIdFromRequest?.(req),
    });
    req.hrAuthorization = { missingLayers: decision.missingLayers };
    if (!decision.allowed) {
      return res.status(403).json({
        success: false,
        error: 'HR_AUTHORIZATION_DENIED',
        missingLayers: decision.missingLayers,
      });
    }
    return next();
  } catch (error) {
    next(error);
  }
};

export const requireHrFeature = (
  code: string,
  level: HrAccessLevel = 'VIEW',
  authorityCodes?: string[],
) => requireHrAuthorization({ workspaceLevel: level, feature: { code, level }, authorityCodes });
