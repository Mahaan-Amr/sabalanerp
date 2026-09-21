import { prisma } from '../lib/prisma';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';
import { getEffectiveUserAccess } from '../services/effectiveAccessService';


const isPermissionActiveAndNotExpired = (
  permission: { isActive: boolean; expiresAt?: Date | null } | null | undefined
): boolean => {
  if (!permission || !permission.isActive) return false;
  if (!permission.expiresAt) return true;
  return permission.expiresAt.getTime() > Date.now();
};

export interface WorkspaceRequest extends AuthRequest {
  workspace?: string;
  workspacePermission?: string;
}

// Workspace permission levels
export const WORKSPACE_PERMISSIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  ADMIN: 'admin'
} as const;

export type WorkspacePermission = typeof WORKSPACE_PERMISSIONS[keyof typeof WORKSPACE_PERMISSIONS];

// Available workspaces
export const WORKSPACES = {
  SALES: 'sales',
  CRM: 'crm',
  HR: 'hr',
  ACCOUNTING: 'accounting',
  INVENTORY: 'inventory',
  SECURITY: 'security',
  BI: 'bi',
  LOGISTICS: 'logistics'
} as const;

export type Workspace = typeof WORKSPACES[keyof typeof WORKSPACES];

type WorkspaceAccessDenied = (input: {
  req: WorkspaceRequest;
  workspace: Workspace;
  requiredPermission: WorkspacePermission;
  effectivePermission: WorkspacePermission | null;
  reason: 'UNAUTHENTICATED' | 'NO_PERMISSION' | 'INSUFFICIENT_PERMISSION';
}) => Promise<void>;

/**
 * Middleware to check workspace access
 */
export const requireWorkspaceAccessWithClient = (
  prismaClient: Pick<PrismaClient, 'workspacePermission' | 'roleWorkspacePermission'>,
  workspace: Workspace,
  requiredPermission: WorkspacePermission = WORKSPACE_PERMISSIONS.VIEW,
  onDenied?: WorkspaceAccessDenied,
) => {
  return async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        await onDenied?.({ req, workspace, requiredPermission, effectivePermission: null, reason: 'UNAUTHENTICATED' });
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Accounting is deliberately explicit even for technical administrators:
      // the accounting workspace level is the simple Viewer/Accountant/Manager
      // profile selected in central access management. Other workspaces retain
      // their established technical-administrator behavior.
      if (req.user.role === 'ADMIN' && workspace !== WORKSPACES.ACCOUNTING) {
        req.workspace = workspace;
        req.workspacePermission = WORKSPACE_PERMISSIONS.ADMIN;
        return next();
      }

      // Check user-specific workspace permissions
      const userPermission = await prismaClient.workspacePermission.findUnique({
        where: {
          userId_workspace: {
            userId: req.user.id,
            workspace: workspace
          }
        }
      });

      // Check role-based workspace permissions
      const rolePermission = await prismaClient.roleWorkspacePermission.findUnique({
        where: {
          role_workspace: {
            role: req.user.role,
            workspace: workspace
          }
        }
      });

      // Determine effective permission level
      let effectivePermission: WorkspacePermission | null = null;

      if (isPermissionActiveAndNotExpired(userPermission)) {
        effectivePermission = userPermission!.permissionLevel as WorkspacePermission;
      } else if (isPermissionActiveAndNotExpired(rolePermission)) {
        effectivePermission = rolePermission!.permissionLevel as WorkspacePermission;
      }

      if (!effectivePermission) {
        await onDenied?.({ req, workspace, requiredPermission, effectivePermission: null, reason: 'NO_PERMISSION' });
        return res.status(403).json({
          success: false,
          error: workspace === WORKSPACES.ACCOUNTING
            ? 'دسترسی به فضای حسابداری برای این کاربر فعال نیست.'
            : `Access denied to ${workspace} workspace`
        });
      }

      // Check if user has required permission level
      const permissionLevels = [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN];
      const userLevel = permissionLevels.indexOf(effectivePermission);
      const requiredLevel = permissionLevels.indexOf(requiredPermission);

      if (userLevel < requiredLevel) {
        await onDenied?.({ req, workspace, requiredPermission, effectivePermission, reason: 'INSUFFICIENT_PERMISSION' });
        return res.status(403).json({
          success: false,
          error: workspace === WORKSPACES.ACCOUNTING
            ? 'سطح دسترسی حسابداری برای این عملیات کافی نیست.'
            : `Insufficient permissions for ${workspace} workspace. Required: ${requiredPermission}, Current: ${effectivePermission}`
        });
      }

      req.workspace = workspace;
      req.workspacePermission = effectivePermission;
      next();
    } catch (error) {
      console.error('Workspace access check error:', error);
      res.status(500).json({
        success: false,
        error: 'Internal server error'
      });
    }
  };
};

export const requireWorkspaceAccess = (workspace: Workspace, requiredPermission: WorkspacePermission = WORKSPACE_PERMISSIONS.VIEW) => (
  requireWorkspaceAccessWithClient(prisma, workspace, requiredPermission)
);

/**
 * Middleware to extract workspace from URL
 */
export const extractWorkspace = (req: WorkspaceRequest, res: Response, next: NextFunction) => {
  const pathParts = req.path.split('/');
  const workspaceIndex = pathParts.indexOf('api') + 1;
  
  if (workspaceIndex < pathParts.length) {
    const workspace = pathParts[workspaceIndex];
    if (Object.values(WORKSPACES).includes(workspace as Workspace)) {
      req.workspace = workspace as Workspace;
    }
  }
  
  next();
};

/**
 * Get user's accessible workspaces
 */
export const getUserWorkspaces = async (userId: string, userRole: string): Promise<{ workspace: Workspace; permission: WorkspacePermission }[]> => {
  try {
    const access = await getEffectiveUserAccess(prisma, { userId, userRole });
    return access.workspaces as Array<{ workspace: Workspace; permission: WorkspacePermission }>;
  } catch (error) {
    console.error('Get user workspaces error:', error);
    return [];
  }
};
