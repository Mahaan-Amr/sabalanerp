import { prisma } from '../lib/prisma';
import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';
import { resolveNarrowFeatureAccess } from '../services/narrowFeatureAccess';


const isPermissionActiveAndNotExpired = (
  permission: { isActive: boolean; expiresAt?: Date | null } | null | undefined
): boolean => {
  if (!permission || !permission.isActive) return false;
  if (!permission.expiresAt) return true;
  return permission.expiresAt.getTime() > Date.now();
};

export interface FeatureRequest extends AuthRequest {
  featurePermission?: string;
}

// Feature permission levels
import {FEATURE_PERMISSIONS,FEATURES,FEATURE_WORKSPACE_MAP,FEATURE_LABELS,type Feature,type FeaturePermission} from './featureCatalog';
export {FEATURE_PERMISSIONS,FEATURES,FEATURE_WORKSPACE_MAP,FEATURE_LABELS};
export type {Feature,FeaturePermission};
const permissionLevels: FeaturePermission[] = [
  FEATURE_PERMISSIONS.VIEW,
  FEATURE_PERMISSIONS.EDIT,
  FEATURE_PERMISSIONS.ADMIN
];

const hasRequiredPermissionLevel = (
  currentPermission: FeaturePermission,
  requiredPermission: FeaturePermission
): boolean => {
  const userLevel = permissionLevels.indexOf(currentPermission);
  const requiredLevel = permissionLevels.indexOf(requiredPermission);
  return userLevel >= requiredLevel;
};

/**
 * Middleware to check feature-level access
 */
export const requireFeatureAccess = (feature: Feature, requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const disabled = await prisma.featurePermission.findUnique({ where: { userId_workspace_feature: { userId: req.user.id, workspace: FEATURE_WORKSPACE_MAP[feature], feature } } });
      if (isPermissionActiveAndNotExpired(disabled) && disabled!.permissionLevel === 'none') return res.status(403).json({ success: false, error: 'مجوز این عملیات برای شما فعال نیست.' });

      // Super admin has access to all unrevoked features
      if (req.user.role === 'ADMIN') {
        req.featurePermission = FEATURE_PERMISSIONS.ADMIN;
        return next();
      }

      const workspace = FEATURE_WORKSPACE_MAP[feature];

      // Check user-specific feature permissions
      const userFeaturePermission = disabled;

      // Check role-based feature permissions
      const roleFeaturePermission = await prisma.roleFeaturePermission.findUnique({
        where: {
          role_workspace_feature: {
            role: req.user.role,
            workspace: workspace,
            feature: feature
          }
        }
      });

      // Check if user has workspace-level access (fallback)
      const userWorkspacePermission = await prisma.workspacePermission.findUnique({
        where: {
          userId_workspace: {
            userId: req.user.id,
            workspace: workspace
          }
        }
      });

      const roleWorkspacePermission = await prisma.roleWorkspacePermission.findUnique({
        where: {
          role_workspace: {
            role: req.user.role,
            workspace: workspace
          }
        }
      });

      // Determine effective permission level
      let effectivePermission: FeaturePermission | null = null;

      // Priority: user-specific overrides > role defaults.
      if (feature === FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE) {
          effectivePermission = isPermissionActiveAndNotExpired(userFeaturePermission) ? userFeaturePermission!.permissionLevel as FeaturePermission
            : isPermissionActiveAndNotExpired(roleFeaturePermission) ? roleFeaturePermission!.permissionLevel as FeaturePermission : null;
        } else if (isPermissionActiveAndNotExpired(userFeaturePermission)) {
        effectivePermission = userFeaturePermission!.permissionLevel as FeaturePermission;
      } else if (isPermissionActiveAndNotExpired(userWorkspacePermission)) {
        effectivePermission = userWorkspacePermission!.permissionLevel as FeaturePermission;
      } else if (isPermissionActiveAndNotExpired(roleFeaturePermission)) {
        effectivePermission = roleFeaturePermission!.permissionLevel as FeaturePermission;
      } else if (isPermissionActiveAndNotExpired(roleWorkspacePermission)) {
        effectivePermission = roleWorkspacePermission!.permissionLevel as FeaturePermission;
      }

      if (!effectivePermission) {
        return res.status(403).json({
          success: false,
          error: `Access denied to feature: ${feature}`
        });
      }

      if (!hasRequiredPermissionLevel(effectivePermission, requiredPermission)) {
        return res.status(403).json({
          success: false,
          error: `Insufficient permissions for feature: ${feature}. Required: ${requiredPermission}, Current: ${effectivePermission}`
        });
      }

      req.featurePermission = effectivePermission;
      next();
    } catch (error) {
      console.error('Feature access check error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };
};

// Sensitive and independently owned features do not inherit ordinary workspace view/edit.
// Explicit feature grants are accepted; workspace admin and global ADMIN/MANAGER retain oversight.
export const requireNarrowFeatureAccess = (feature: Feature, requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) return res.status(401).json({ success: false, error: 'Authentication required' });
      const workspace = FEATURE_WORKSPACE_MAP[feature];
      const access = await resolveNarrowFeatureAccess(prisma, { userId: req.user.id, role: req.user.role, workspace, feature, requiredPermission });
      if (!access.allowed) {
        return res.status(403).json({ success: false, error: `Access denied to independently scoped feature: ${feature}` });
      }
      req.featurePermission = access.permissionLevel!;
      return next();
    } catch (error) {
      console.error('Narrow feature access check error:', error);
      return res.status(500).json({ success: false, error: 'Internal server error' });
    }
  };
};

export const requireAnyNarrowFeatureAccess = (
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW,
) => async (req: FeatureRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.user) return res.status(401).json({ success: false, message: 'برای ادامه وارد سامانه شوید.' });
    for (const feature of features) {
      const workspace = FEATURE_WORKSPACE_MAP[feature];
      const access = await resolveNarrowFeatureAccess(prisma, {
        userId: req.user.id,
        role: req.user.role,
        workspace,
        feature,
        requiredPermission,
      });
      if (access.allowed) {
        req.featurePermission = access.permissionLevel!;
        return next();
      }
    }
    return res.status(403).json({
      success: false,
      message: 'مجوز انجام این عملیات برای شما فعال نیست. از مدیر همان فضای کاری درخواست دسترسی کنید.',
    });
  } catch (error) {
    const trackingId = `AUTH-${Date.now().toString(36).toUpperCase()}`;
    console.error('Narrow feature access resolution failed:', { trackingId, error });
    return res.status(500).json({
      success: false,
      message: `بررسی مجوز انجام نشد. دوباره تلاش کنید یا کد پیگیری ${trackingId} را به پشتیبانی اعلام کنید.`,
      trackingId,
    });
  }
};

/**
 * Middleware to check access against multiple features (OR logic)
 */
export const requireAnyFeatureAccess = (
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW
) => requireAnyFeatureAccessWithClient(prisma, features, requiredPermission);

type FeaturePermissionClient = Pick<PrismaClient, 'featurePermission' | 'roleFeaturePermission' | 'workspacePermission' | 'roleWorkspacePermission'>;

export const requireAnyFeatureAccessWithClient = (
  permissionClient: FeaturePermissionClient,
  features: Feature[],
  requiredPermission: FeaturePermission = FEATURE_PERMISSIONS.VIEW,
  globallyEligibleRoles: readonly string[] = ['ADMIN'],
) => {
  return async (req: FeatureRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }


      for (const feature of features) {
        const workspace = FEATURE_WORKSPACE_MAP[feature];

        const userFeaturePermission = await permissionClient.featurePermission.findUnique({
          where: {
            userId_workspace_feature: {
              userId: req.user.id,
              workspace,
              feature
            }
          }
        });

        if (isPermissionActiveAndNotExpired(userFeaturePermission) && userFeaturePermission!.permissionLevel === 'none') continue;
        if (globallyEligibleRoles.includes(req.user.role)) { req.featurePermission = FEATURE_PERMISSIONS.ADMIN; return next(); }

        const roleFeaturePermission = await permissionClient.roleFeaturePermission.findUnique({
          where: {
            role_workspace_feature: {
              role: req.user.role,
              workspace,
              feature
            }
          }
        });

        const userWorkspacePermission = await permissionClient.workspacePermission.findUnique({
          where: {
            userId_workspace: {
              userId: req.user.id,
              workspace
            }
          }
        });

        const roleWorkspacePermission = await permissionClient.roleWorkspacePermission.findUnique({
          where: {
            role_workspace: {
              role: req.user.role,
              workspace
            }
          }
        });

        let effectivePermission: FeaturePermission | null = null;

        if (feature === FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE) {
          effectivePermission = isPermissionActiveAndNotExpired(userFeaturePermission) ? userFeaturePermission!.permissionLevel as FeaturePermission
            : isPermissionActiveAndNotExpired(roleFeaturePermission) ? roleFeaturePermission!.permissionLevel as FeaturePermission : null;
        } else if (isPermissionActiveAndNotExpired(userFeaturePermission)) {
          effectivePermission = userFeaturePermission!.permissionLevel as FeaturePermission;
        } else if (isPermissionActiveAndNotExpired(userWorkspacePermission)) {
          effectivePermission = userWorkspacePermission!.permissionLevel as FeaturePermission;
        } else if (isPermissionActiveAndNotExpired(roleFeaturePermission)) {
          effectivePermission = roleFeaturePermission!.permissionLevel as FeaturePermission;
        } else if (isPermissionActiveAndNotExpired(roleWorkspacePermission)) {
          effectivePermission = roleWorkspacePermission!.permissionLevel as FeaturePermission;
        }

        if (effectivePermission && hasRequiredPermissionLevel(effectivePermission, requiredPermission)) {
          req.featurePermission = effectivePermission;
          return next();
        }
      }

      return res.status(403).json({
        success: false,
        error: `Access denied to required features: ${features.join(', ')}`
      });
    } catch (error) {
      console.error('Feature access check error:', error);
      return res.status(500).json({
        success: false,
        error: 'Server error during feature access validation'
      });
    }
  };
};

/**
 * Get user's accessible features
 */
export const getUserFeatures = async (userId: string, userRole: string): Promise<{ feature: Feature; permission: FeaturePermission; workspace: string }[]> => {
  try {
    const features: { feature: Feature; permission: FeaturePermission; workspace: string }[] = [];

    const disabledRows = await prisma.featurePermission.findMany({ where: { userId, isActive: true, permissionLevel: 'none' } });
    const disabled = new Set(disabledRows.filter(row => row.permissionLevel === 'none' && isPermissionActiveAndNotExpired(row)).map(row => row.feature));
    // Super admin has access to all unrevoked features
    if (userRole === 'ADMIN') {
      return Object.entries(FEATURE_WORKSPACE_MAP).filter(([feature]) => !disabled.has(feature)).map(([feature, workspace]) => ({
        feature: feature as Feature,
        permission: FEATURE_PERMISSIONS.ADMIN,
        workspace
      }));
    }

    // Get user-specific feature permissions
    const userFeaturePermissions = await prisma.featurePermission.findMany({
      where: {
        userId,
        isActive: true
      }
    });

    // Get role-based feature permissions
    const roleFeaturePermissions = await prisma.roleFeaturePermission.findMany({
      where: {
        role: userRole,
        isActive: true
      }
    });

    // Get workspace permissions (fallback)
    const userWorkspacePermissions = await prisma.workspacePermission.findMany({
      where: {
        userId,
        isActive: true
      }
    });

    const roleWorkspacePermissions = await prisma.roleWorkspacePermission.findMany({
      where: {
        role: userRole,
        isActive: true
      }
    });

    // Combine all permissions
    const allFeatures = new Set([
      ...userFeaturePermissions.map(p => p.feature),
      ...roleFeaturePermissions.map(p => p.feature),
      ...Object.keys(FEATURE_WORKSPACE_MAP).filter(feature => {
        const workspace = FEATURE_WORKSPACE_MAP[feature as Feature];
        return userWorkspacePermissions.some(p => p.workspace === workspace) ||
               roleWorkspacePermissions.some(p => p.workspace === workspace);
      })
    ]);

    for (const feature of allFeatures) {
      if (disabled.has(feature)) continue;
      const workspace = FEATURE_WORKSPACE_MAP[feature as Feature];
      
      const userFeaturePermission = userFeaturePermissions.find(
        (p) => p.feature === feature && isPermissionActiveAndNotExpired(p)
      );
      const roleFeaturePermission = roleFeaturePermissions.find(
        (p) => p.feature === feature && isPermissionActiveAndNotExpired(p)
      );
      const userWorkspacePermission = userWorkspacePermissions.find(
        (p) => p.workspace === workspace && isPermissionActiveAndNotExpired(p)
      );
      const roleWorkspacePermission = roleWorkspacePermissions.find(
        (p) => p.workspace === workspace && isPermissionActiveAndNotExpired(p)
      );

      if (feature === FEATURES.CRM_PARTNER_CUSTOMER_TRANSFERS_MANAGE) {
        const explicit = userFeaturePermission ?? roleFeaturePermission;
        if (explicit) features.push({ feature: feature as Feature, permission: explicit.permissionLevel as FeaturePermission, workspace });
        continue;
      }
      let permission: FeaturePermission;
      if (userFeaturePermission) {
        permission = userFeaturePermission.permissionLevel as FeaturePermission;
      } else if (userWorkspacePermission) {
        permission = userWorkspacePermission.permissionLevel as FeaturePermission;
      } else if (roleFeaturePermission) {
        permission = roleFeaturePermission.permissionLevel as FeaturePermission;
      } else if (roleWorkspacePermission) {
        permission = roleWorkspacePermission.permissionLevel as FeaturePermission;
      } else {
        continue;
      }

      features.push({ 
        feature: feature as Feature, 
        permission, 
        workspace 
      });
    }

    return features;
  } catch (error) {
    console.error('Get user features error:', error);
    return [];
  }
};
