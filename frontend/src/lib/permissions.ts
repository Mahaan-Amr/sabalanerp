/**
 * Permission utility functions for checking user access to features
 */

export interface User {
  id: string;
  role: string;
  departmentId?: string;
  permissions?: {
    features: Array<{
      feature: string;
      permissionLevel: string;
      workspace: string;
    }>;
    workspaces: Array<{
      workspace: string;
      permissionLevel: string;
    }>;
  };
}

export interface FeaturePermission {
  feature: string;
  permission: string;
  workspace: string;
}

/**
 * Check if user has access to a specific feature
 */
export const hasFeatureAccess = (
  user: User | null,
  feature: string,
  requiredPermission: string = 'view'
): boolean => {
  if (!user) return false;

  // Super admin has access to all features
  if (user.role === 'ADMIN') return true;


  // Check if user has the specific feature permission
  const featurePermission = user.permissions?.features?.find(
    p => p.feature === feature && hasPermissionLevel(p.permissionLevel, requiredPermission)
  );

  if (featurePermission) {
    return true;
  }

  // Check if user has workspace-level access that might include this feature
  const workspacePermission = user.permissions?.workspaces?.find(
    p => p.workspace === getFeatureWorkspace(feature) && 
         hasPermissionLevel(p.permissionLevel, requiredPermission)
  );

  if (workspacePermission) {
    return true;
  }

  return false;
};

/**
 * Check if user has access to approve contracts
 */
export const canApproveContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_approve', 'edit');
};

/**
 * Check if user has access to reject contracts
 */
export const canRejectContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_reject', 'edit');
};

/**
 * Check if user has access to sign contracts
 */
export const canSignContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_sign', 'edit');
};

/**
 * Check if user has access to print contracts
 */
export const canPrintContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_print', 'edit');
};

/**
 * Check if user has access to create contracts
 */
export const canCreateContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_create', 'edit');
};

/**
 * Check if user has access to edit contracts
 */
export const canEditContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_edit', 'edit');
};

/**
 * Check if user has access to view contracts
 */
export const canViewContracts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_contracts_view', 'view');
};

/**
 * Check if user has access to delete products
 */
export const canDeleteProducts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_products_delete', 'edit');
};

/**
 * Check if user has access to edit products
 */
export const canEditProducts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_products_edit', 'edit');
};

/**
 * Check if user has access to create products
 */
export const canCreateProducts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_products_create', 'edit');
};

/**
 * Check if user has access to view products
 */
export const canViewProducts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_products_view', 'view');
};

/**
 * Check if user has access to import products
 */
export const canImportProducts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_products_import', 'edit');
};

/**
 * Check if user has access to export products
 */
export const canExportProducts = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'sales_products_export', 'view');
};

/**
 * Get workspace for a feature
 */
const getFeatureWorkspace = (feature: string): string => {
  const featureWorkspaceMap: Record<string, string> = {
    'sales_contracts_view': 'sales',
    'sales_contracts_edit': 'sales',
    'sales_contracts_create': 'sales',
    'sales_contracts_approve': 'sales',
    'sales_contracts_reject': 'sales',
    'sales_contracts_sign': 'sales',
    'sales_contracts_print': 'sales',
    'sales_products_view': 'sales',
    'sales_products_edit': 'sales',
    'sales_products_create': 'sales',
    'sales_products_delete': 'sales',
    'sales_products_import': 'sales',
    'sales_products_export': 'sales',
    'crm_customers_view': 'crm',
    'crm_customers_edit': 'crm',
    'crm_customers_create': 'crm',
    'crm_customers_delete': 'crm',
    
    // Inventory Master Data Features
    'inventory_cut_types_view': 'inventory',
    'inventory_cut_types_edit': 'inventory',
    'inventory_cut_types_create': 'inventory',
    'inventory_cut_types_delete': 'inventory',
    
    'inventory_stone_materials_view': 'inventory',
    'inventory_stone_materials_edit': 'inventory',
    'inventory_stone_materials_create': 'inventory',
    'inventory_stone_materials_delete': 'inventory',
    
    'inventory_cut_widths_view': 'inventory',
    'inventory_cut_widths_edit': 'inventory',
    'inventory_cut_widths_create': 'inventory',
    'inventory_cut_widths_delete': 'inventory',
    
    'inventory_thicknesses_view': 'inventory',
    'inventory_thicknesses_edit': 'inventory',
    'inventory_thicknesses_create': 'inventory',
    'inventory_thicknesses_delete': 'inventory',
    
    'inventory_mines_view': 'inventory',
    'inventory_mines_edit': 'inventory',
    'inventory_mines_create': 'inventory',
    'inventory_mines_delete': 'inventory',
    
    'inventory_finish_types_view': 'inventory',
    'inventory_finish_types_edit': 'inventory',
    'inventory_finish_types_create': 'inventory',
    'inventory_finish_types_delete': 'inventory',
    
    'inventory_colors_view': 'inventory',
    'inventory_colors_edit': 'inventory',
    'inventory_colors_create': 'inventory',
    'inventory_colors_delete': 'inventory',
  };
  
  return featureWorkspaceMap[feature] || 'unknown';
};

/**
 * Check if permission level meets requirement
 */
const hasPermissionLevel = (userPermission: string, requiredPermission: string): boolean => {
  const levels = ['view', 'edit', 'admin'];
  const userLevel = levels.indexOf(userPermission);
  const requiredLevel = levels.indexOf(requiredPermission);
  
  return userLevel >= requiredLevel;
};

/**
 * Get all contract-related permissions for a user
 */
export const getContractPermissions = (user: User | null) => {
  return {
    canView: canViewContracts(user),
    canCreate: canCreateContracts(user),
    canEdit: canEditContracts(user),
    canApprove: canApproveContracts(user),
    canReject: canRejectContracts(user),
    canSign: canSignContracts(user),
    canPrint: canPrintContracts(user),
  };
};

/**
 * Get all CRM-related permissions for a user
 */
export const getCrmPermissions = (user: User | null) => {
  return {
    canViewCustomers: hasFeatureAccess(user, 'crm_customers_view', 'view'),
    canCreateCustomers:
      hasFeatureAccess(user, 'crm_customers_create', 'edit') ||
      hasFeatureAccess(user, 'sales_customers_create', 'edit'),
    canEditCustomers: hasFeatureAccess(user, 'crm_customers_edit', 'edit'),
    canDeleteCustomers: hasFeatureAccess(user, 'crm_customers_delete', 'edit'),
  };
};

// ==================== INVENTORY MASTER DATA PERMISSIONS ====================

/**
 * Cut Types Permissions
 */
export const canViewCutTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_types_view', 'view');
};

export const canCreateCutTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_types_create', 'edit');
};

export const canEditCutTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_types_edit', 'edit');
};

export const canDeleteCutTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_types_delete', 'edit');
};

/**
 * Stone Materials Permissions
 */
export const canViewStoneMaterials = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_stone_materials_view', 'view');
};

export const canCreateStoneMaterials = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_stone_materials_create', 'edit');
};

export const canEditStoneMaterials = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_stone_materials_edit', 'edit');
};

export const canDeleteStoneMaterials = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_stone_materials_delete', 'edit');
};

/**
 * Cut Widths Permissions
 */
export const canViewCutWidths = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_widths_view', 'view');
};

export const canCreateCutWidths = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_widths_create', 'edit');
};

export const canEditCutWidths = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_widths_edit', 'edit');
};

export const canDeleteCutWidths = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_cut_widths_delete', 'edit');
};

/**
 * Thicknesses Permissions
 */
export const canViewThicknesses = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_thicknesses_view', 'view');
};

export const canCreateThicknesses = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_thicknesses_create', 'edit');
};

export const canEditThicknesses = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_thicknesses_edit', 'edit');
};

export const canDeleteThicknesses = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_thicknesses_delete', 'edit');
};

/**
 * Mines Permissions
 */
export const canViewMines = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_mines_view', 'view');
};

export const canCreateMines = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_mines_create', 'edit');
};

export const canEditMines = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_mines_edit', 'edit');
};

export const canDeleteMines = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_mines_delete', 'edit');
};

/**
 * Finish Types Permissions
 */
export const canViewFinishTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_finish_types_view', 'view');
};

export const canCreateFinishTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_finish_types_create', 'edit');
};

export const canEditFinishTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_finish_types_edit', 'edit');
};

export const canDeleteFinishTypes = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_finish_types_delete', 'edit');
};

/**
 * Colors Permissions
 */
export const canViewColors = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_colors_view', 'view');
};

export const canCreateColors = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_colors_create', 'edit');
};

export const canEditColors = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_colors_edit', 'edit');
};

export const canDeleteColors = (user: User | null): boolean => {
  return hasFeatureAccess(user, 'inventory_colors_delete', 'edit');
};

/**
 * Get all inventory master data permissions for a user
 */
export const getInventoryMasterDataPermissions = (user: User | null) => {
  return {
    // Cut Types
    cutTypes: {
      canView: canViewCutTypes(user),
      canCreate: canCreateCutTypes(user),
      canEdit: canEditCutTypes(user),
      canDelete: canDeleteCutTypes(user),
    },
    // Stone Materials
    stoneMaterials: {
      canView: canViewStoneMaterials(user),
      canCreate: canCreateStoneMaterials(user),
      canEdit: canEditStoneMaterials(user),
      canDelete: canDeleteStoneMaterials(user),
    },
    // Cut Widths
    cutWidths: {
      canView: canViewCutWidths(user),
      canCreate: canCreateCutWidths(user),
      canEdit: canEditCutWidths(user),
      canDelete: canDeleteCutWidths(user),
    },
    // Thicknesses
    thicknesses: {
      canView: canViewThicknesses(user),
      canCreate: canCreateThicknesses(user),
      canEdit: canEditThicknesses(user),
      canDelete: canDeleteThicknesses(user),
    },
    // Mines
    mines: {
      canView: canViewMines(user),
      canCreate: canCreateMines(user),
      canEdit: canEditMines(user),
      canDelete: canDeleteMines(user),
    },
    // Finish Types
    finishTypes: {
      canView: canViewFinishTypes(user),
      canCreate: canCreateFinishTypes(user),
      canEdit: canEditFinishTypes(user),
      canDelete: canDeleteFinishTypes(user),
    },
    // Colors
    colors: {
      canView: canViewColors(user),
      canCreate: canCreateColors(user),
      canEdit: canEditColors(user),
      canDelete: canDeleteColors(user),
    },
  };
};
