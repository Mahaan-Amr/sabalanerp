import { prisma } from '../lib/prisma';
import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';


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

/**
 * Middleware to check workspace access
 */
export const requireWorkspaceAccessWithClient = (prismaClient: Pick<PrismaClient, 'workspacePermission' | 'roleWorkspacePermission'>, workspace: Workspace, requiredPermission: WorkspacePermission = WORKSPACE_PERMISSIONS.VIEW) => {
  return async (req: WorkspaceRequest, res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Super admin has access to all workspaces
      if (req.user.role === 'ADMIN') {
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
        return res.status(403).json({
          success: false,
          error: `Access denied to ${workspace} workspace`
        });
      }

      // Check if user has required permission level
      const permissionLevels = [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN];
      const userLevel = permissionLevels.indexOf(effectivePermission);
      const requiredLevel = permissionLevels.indexOf(requiredPermission);

      if (userLevel < requiredLevel) {
        return res.status(403).json({
          success: false,
          error: `Insufficient permissions for ${workspace} workspace. Required: ${requiredPermission}, Current: ${effectivePermission}`
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
    const workspaces: { workspace: Workspace; permission: WorkspacePermission }[] = [];

    // Super admin has access to all workspaces
    if (userRole === 'ADMIN') {
      return Object.values(WORKSPACES).map(workspace => ({
        workspace,
        permission: WORKSPACE_PERMISSIONS.ADMIN
      }));
    }

    // Get user-specific permissions
    const userPermissions = await prisma.workspacePermission.findMany({
      where: {
        userId,
        isActive: true
      }
    });

    // Get role-based permissions
    const rolePermissions = await prisma.roleWorkspacePermission.findMany({
      where: {
        role: userRole,
        isActive: true
      }
    });

    // Combine permissions (user-specific overrides role-based)
    const allWorkspaces = new Set([...userPermissions.map(p => p.workspace), ...rolePermissions.map(p => p.workspace)]);

    for (const workspace of allWorkspaces) {
      const userPermission = userPermissions.find(
        (p) => p.workspace === workspace && isPermissionActiveAndNotExpired(p)
      );
      const rolePermission = rolePermissions.find(
        (p) => p.workspace === workspace && isPermissionActiveAndNotExpired(p)
      );

      let permission: WorkspacePermission;
      if (userPermission) {
        permission = userPermission.permissionLevel as WorkspacePermission;
      } else if (rolePermission) {
        permission = rolePermission.permissionLevel as WorkspacePermission;
      } else {
        continue;
      }

      workspaces.push({ workspace: workspace as Workspace, permission });
    }

    return workspaces;
  } catch (error) {
    console.error('Get user workspaces error:', error);
    return [];
  }
};
