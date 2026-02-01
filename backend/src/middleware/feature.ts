import { Response, NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { AuthRequest } from './auth';

const prisma = new PrismaClient();

export interface FeatureRequest extends AuthRequest {
  featurePermission?: string;
}

// Feature permission levels
export const FEATURE_PERMISSIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  ADMIN: 'admin'
} as const;

export type FeaturePermission = typeof FEATURE_PERMISSIONS[keyof typeof FEATURE_PERMISSIONS];

// Available features across workspaces
export const FEATURES = {
  // CRM Features
  CRM_CUSTOMERS_VIEW: 'crm_customers_view',
  CRM_CUSTOMERS_EDIT: 'crm_customers_edit',
  CRM_CUSTOMERS_CREATE: 'crm_customers_create',
  CRM_CUSTOMERS_DELETE: 'crm_customers_delete',
  
  // Sales Features
  SALES_CONTRACTS_VIEW: 'sales_contracts_view',
  SALES_CONTRACTS_EDIT: 'sales_contracts_edit',
  SALES_CONTRACTS_CREATE: 'sales_contracts_create',
  SALES_CONTRACTS_APPROVE: 'sales_contracts_approve',
  SALES_CONTRACTS_REJECT: 'sales_contracts_reject',
  SALES_CONTRACTS_SIGN: 'sales_contracts_sign',
  SALES_CONTRACTS_PRINT: 'sales_contracts_print',
  SALES_PRODUCTS_VIEW: 'sales_products_view',
  SALES_PRODUCTS_EDIT: 'sales_products_edit',
  SALES_PRODUCTS_CREATE: 'sales_products_create',
  SALES_PRODUCTS_IMPORT: 'sales_products_import',
  SALES_PRODUCTS_EXPORT: 'sales_products_export',
  
  // Inventory Features
  INVENTORY_PRODUCTS_VIEW: 'inventory_products_view',
  INVENTORY_PRODUCTS_EDIT: 'inventory_products_edit',
  INVENTORY_PRODUCTS_CREATE: 'inventory_products_create',
  INVENTORY_STOCK_VIEW: 'inventory_stock_view',
  INVENTORY_STOCK_EDIT: 'inventory_stock_edit',
  
  // Inventory Master Data Features
  INVENTORY_CUT_TYPES_VIEW: 'inventory_cut_types_view',
  INVENTORY_CUT_TYPES_EDIT: 'inventory_cut_types_edit',
  INVENTORY_CUT_TYPES_CREATE: 'inventory_cut_types_create',
  INVENTORY_CUT_TYPES_DELETE: 'inventory_cut_types_delete',
  
  INVENTORY_STONE_MATERIALS_VIEW: 'inventory_stone_materials_view',
  INVENTORY_STONE_MATERIALS_EDIT: 'inventory_stone_materials_edit',
  INVENTORY_STONE_MATERIALS_CREATE: 'inventory_stone_materials_create',
  INVENTORY_STONE_MATERIALS_DELETE: 'inventory_stone_materials_delete',
  
  INVENTORY_CUT_WIDTHS_VIEW: 'inventory_cut_widths_view',
  INVENTORY_CUT_WIDTHS_EDIT: 'inventory_cut_widths_edit',
  INVENTORY_CUT_WIDTHS_CREATE: 'inventory_cut_widths_create',
  INVENTORY_CUT_WIDTHS_DELETE: 'inventory_cut_widths_delete',
  
  INVENTORY_THICKNESSES_VIEW: 'inventory_thicknesses_view',
  INVENTORY_THICKNESSES_EDIT: 'inventory_thicknesses_edit',
  INVENTORY_THICKNESSES_CREATE: 'inventory_thicknesses_create',
  INVENTORY_THICKNESSES_DELETE: 'inventory_thicknesses_delete',
  
  INVENTORY_MINES_VIEW: 'inventory_mines_view',
  INVENTORY_MINES_EDIT: 'inventory_mines_edit',
  INVENTORY_MINES_CREATE: 'inventory_mines_create',
  INVENTORY_MINES_DELETE: 'inventory_mines_delete',
  
  INVENTORY_FINISH_TYPES_VIEW: 'inventory_finish_types_view',
  INVENTORY_FINISH_TYPES_EDIT: 'inventory_finish_types_edit',
  INVENTORY_FINISH_TYPES_CREATE: 'inventory_finish_types_create',
  INVENTORY_FINISH_TYPES_DELETE: 'inventory_finish_types_delete',
  
  INVENTORY_COLORS_VIEW: 'inventory_colors_view',
  INVENTORY_COLORS_EDIT: 'inventory_colors_edit',
  INVENTORY_COLORS_CREATE: 'inventory_colors_create',
  INVENTORY_COLORS_DELETE: 'inventory_colors_delete',
  
  // HR Features
  HR_EMPLOYEES_VIEW: 'hr_employees_view',
  HR_EMPLOYEES_EDIT: 'hr_employees_edit',
  HR_EMPLOYEES_CREATE: 'hr_employees_create',
  HR_ATTENDANCE_VIEW: 'hr_attendance_view',
  HR_ATTENDANCE_EDIT: 'hr_attendance_edit',
  
  // Security Features
  SECURITY_ATTENDANCE_VIEW: 'security_attendance_view',
  SECURITY_ATTENDANCE_EDIT: 'security_attendance_edit',
  SECURITY_REPORTS_VIEW: 'security_reports_view',
  
  // Accounting Features
  ACCOUNTING_INVOICES_VIEW: 'accounting_invoices_view',
  ACCOUNTING_INVOICES_EDIT: 'accounting_invoices_edit',
  ACCOUNTING_INVOICES_CREATE: 'accounting_invoices_create',
  ACCOUNTING_REPORTS_VIEW: 'accounting_reports_view'
} as const;

export type Feature = typeof FEATURES[keyof typeof FEATURES];

// Feature to workspace mapping
export const FEATURE_WORKSPACE_MAP: Record<Feature, string> = {
  // CRM Features
  [FEATURES.CRM_CUSTOMERS_VIEW]: 'crm',
  [FEATURES.CRM_CUSTOMERS_EDIT]: 'crm',
  [FEATURES.CRM_CUSTOMERS_CREATE]: 'crm',
  [FEATURES.CRM_CUSTOMERS_DELETE]: 'crm',
  
  // Sales Features
  [FEATURES.SALES_CONTRACTS_VIEW]: 'sales',
  [FEATURES.SALES_CONTRACTS_EDIT]: 'sales',
  [FEATURES.SALES_CONTRACTS_CREATE]: 'sales',
  [FEATURES.SALES_CONTRACTS_APPROVE]: 'sales',
  [FEATURES.SALES_CONTRACTS_REJECT]: 'sales',
  [FEATURES.SALES_CONTRACTS_SIGN]: 'sales',
  [FEATURES.SALES_CONTRACTS_PRINT]: 'sales',
  [FEATURES.SALES_PRODUCTS_VIEW]: 'sales',
  [FEATURES.SALES_PRODUCTS_EDIT]: 'sales',
  [FEATURES.SALES_PRODUCTS_CREATE]: 'sales',
  [FEATURES.SALES_PRODUCTS_IMPORT]: 'sales',
  [FEATURES.SALES_PRODUCTS_EXPORT]: 'sales',
  
  // Inventory Features
  [FEATURES.INVENTORY_PRODUCTS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_PRODUCTS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_PRODUCTS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_STOCK_VIEW]: 'inventory',
  [FEATURES.INVENTORY_STOCK_EDIT]: 'inventory',
  
  // Inventory Master Data Features
  [FEATURES.INVENTORY_CUT_TYPES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_CUT_TYPES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_CUT_TYPES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_CUT_TYPES_DELETE]: 'inventory',
  
  [FEATURES.INVENTORY_STONE_MATERIALS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_STONE_MATERIALS_DELETE]: 'inventory',
  
  [FEATURES.INVENTORY_CUT_WIDTHS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_CUT_WIDTHS_DELETE]: 'inventory',
  
  [FEATURES.INVENTORY_THICKNESSES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_THICKNESSES_DELETE]: 'inventory',
  
  [FEATURES.INVENTORY_MINES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_MINES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_MINES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_MINES_DELETE]: 'inventory',
  
  [FEATURES.INVENTORY_FINISH_TYPES_VIEW]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_EDIT]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_CREATE]: 'inventory',
  [FEATURES.INVENTORY_FINISH_TYPES_DELETE]: 'inventory',
  
  [FEATURES.INVENTORY_COLORS_VIEW]: 'inventory',
  [FEATURES.INVENTORY_COLORS_EDIT]: 'inventory',
  [FEATURES.INVENTORY_COLORS_CREATE]: 'inventory',
  [FEATURES.INVENTORY_COLORS_DELETE]: 'inventory',
  
  // HR Features
  [FEATURES.HR_EMPLOYEES_VIEW]: 'hr',
  [FEATURES.HR_EMPLOYEES_EDIT]: 'hr',
  [FEATURES.HR_EMPLOYEES_CREATE]: 'hr',
  [FEATURES.HR_ATTENDANCE_VIEW]: 'hr',
  [FEATURES.HR_ATTENDANCE_EDIT]: 'hr',
  
  // Security Features
  [FEATURES.SECURITY_ATTENDANCE_VIEW]: 'security',
  [FEATURES.SECURITY_ATTENDANCE_EDIT]: 'security',
  [FEATURES.SECURITY_REPORTS_VIEW]: 'security',
  
  // Accounting Features
  [FEATURES.ACCOUNTING_INVOICES_VIEW]: 'accounting',
  [FEATURES.ACCOUNTING_INVOICES_EDIT]: 'accounting',
  [FEATURES.ACCOUNTING_INVOICES_CREATE]: 'accounting',
  [FEATURES.ACCOUNTING_REPORTS_VIEW]: 'accounting'
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

      // Super admin has access to all features
      if (req.user.role === 'ADMIN') {
        req.featurePermission = FEATURE_PERMISSIONS.ADMIN;
        return next();
      }

      const workspace = FEATURE_WORKSPACE_MAP[feature];

      // Check user-specific feature permissions
      const userFeaturePermission = await prisma.featurePermission.findUnique({
        where: {
          userId_workspace_feature: {
            userId: req.user.id,
            workspace: workspace,
            feature: feature
          }
        }
      });

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

      // Priority: Feature-specific > Workspace-level
      if (userFeaturePermission && userFeaturePermission.isActive) {
        effectivePermission = userFeaturePermission.permissionLevel as FeaturePermission;
      } else if (roleFeaturePermission && roleFeaturePermission.isActive) {
        effectivePermission = roleFeaturePermission.permissionLevel as FeaturePermission;
      } else if (userWorkspacePermission && userWorkspacePermission.isActive) {
        effectivePermission = userWorkspacePermission.permissionLevel as FeaturePermission;
      } else if (roleWorkspacePermission && roleWorkspacePermission.isActive) {
        effectivePermission = roleWorkspacePermission.permissionLevel as FeaturePermission;
      }

      if (!effectivePermission) {
        return res.status(403).json({
          success: false,
          error: `Access denied to feature: ${feature}`
        });
      }

      // Check if user has required permission level
      const permissionLevels = [FEATURE_PERMISSIONS.VIEW, FEATURE_PERMISSIONS.EDIT, FEATURE_PERMISSIONS.ADMIN];
      const userLevel = permissionLevels.indexOf(effectivePermission);
      const requiredLevel = permissionLevels.indexOf(requiredPermission);

      if (userLevel < requiredLevel) {
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

/**
 * Get user's accessible features
 */
export const getUserFeatures = async (userId: string, userRole: string): Promise<{ feature: Feature; permission: FeaturePermission; workspace: string }[]> => {
  try {
    const features: { feature: Feature; permission: FeaturePermission; workspace: string }[] = [];

    // Super admin has access to all features
    if (userRole === 'ADMIN') {
      return Object.entries(FEATURE_WORKSPACE_MAP).map(([feature, workspace]) => ({
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
      const workspace = FEATURE_WORKSPACE_MAP[feature as Feature];
      
      const userFeaturePermission = userFeaturePermissions.find(p => p.feature === feature);
      const roleFeaturePermission = roleFeaturePermissions.find(p => p.feature === feature);
      const userWorkspacePermission = userWorkspacePermissions.find(p => p.workspace === workspace);
      const roleWorkspacePermission = roleWorkspacePermissions.find(p => p.workspace === workspace);

      let permission: FeaturePermission;
      if (userFeaturePermission) {
        permission = userFeaturePermission.permissionLevel as FeaturePermission;
      } else if (roleFeaturePermission) {
        permission = roleFeaturePermission.permissionLevel as FeaturePermission;
      } else if (userWorkspacePermission) {
        permission = userWorkspacePermission.permissionLevel as FeaturePermission;
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
