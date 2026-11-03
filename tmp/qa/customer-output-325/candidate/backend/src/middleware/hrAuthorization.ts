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
    if (!req.user) return res.status(401).json({
      success: false,
      message: 'نشست شما معتبر نیست. دوباره وارد سامانه شوید و عملیات را تکرار کنید.',
    });
    const { dutyIdFromRequest, ...fixedRequirement } = requirement;
    const decision = await authorizeHrUser(prisma, req.user.id, {
      ...fixedRequirement,
      dutyId: dutyIdFromRequest?.(req),
    });
    req.hrAuthorization = { missingLayers: decision.missingLayers };
    if (!decision.allowed) {
      const trackingId = `HR-AUTH-${Date.now().toString(36).toUpperCase()}`;
      console.warn('HR authorization rejected.', {
        trackingId,
        actorId: req.user.id,
        missingLayers: decision.missingLayers,
      });
      return res.status(403).json({
        success: false,
        message: `این عملیات متوقف شد چون مجوز فعال لازم در منابع انسانی را ندارید. از مدیر منابع انسانی بخواهید مجوز این اقدام را بررسی کند. کد پیگیری ${trackingId}`,
        trackingId,
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
