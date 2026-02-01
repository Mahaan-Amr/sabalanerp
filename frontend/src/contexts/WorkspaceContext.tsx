'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { workspacePermissionsAPI } from '@/lib/api';

// Workspace Types
export enum WORKSPACES {
  SALES = 'sales',
  CRM = 'crm',
  HR = 'hr',
  ACCOUNTING = 'accounting',
  INVENTORY = 'inventory',
  SECURITY = 'security'
}

export enum WORKSPACE_PERMISSIONS {
  VIEW = 'view',
  EDIT = 'edit',
  ADMIN = 'admin'
}

export interface WorkspacePermission {
  id: string;
  userId: string;
  workspace: WORKSPACES;
  permission: WORKSPACE_PERMISSIONS;
  grantedBy: string;
  grantedAt: string;
  expiresAt?: string;
}

export interface RoleWorkspacePermission {
  id: string;
  role: string;
  workspace: WORKSPACES;
  permission: WORKSPACE_PERMISSIONS;
  grantedBy: string;
  grantedAt: string;
}

export interface WorkspaceInfo {
  id: WORKSPACES;
  name: string;
  namePersian: string;
  description: string;
  icon: string;
  color: string;
  path: string;
  permissions: WORKSPACE_PERMISSIONS[];
}

// Workspace Configuration
export const WORKSPACE_CONFIG: Record<WORKSPACES, WorkspaceInfo> = {
  [WORKSPACES.SALES]: {
    id: WORKSPACES.SALES,
    name: 'Sales',
    namePersian: 'فروش',
    description: 'مدیریت قراردادها و فرآیندهای فروش',
    icon: 'FaFileContract',
    color: 'teal',
    path: '/dashboard/sales',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.CRM]: {
    id: WORKSPACES.CRM,
    name: 'CRM',
    namePersian: 'مدیریت ارتباط با مشتری',
    description: 'مدیریت مشتریان، مخاطبین و فرصت‌های فروش',
    icon: 'FaUsers',
    color: 'blue',
    path: '/dashboard/crm',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.HR]: {
    id: WORKSPACES.HR,
    name: 'Human Resources',
    namePersian: 'منابع انسانی',
    description: 'مدیریت پرسنل، حقوق و دستمزد',
    icon: 'FaUserTie',
    color: 'purple',
    path: '/dashboard/hr',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.ACCOUNTING]: {
    id: WORKSPACES.ACCOUNTING,
    name: 'Accounting',
    namePersian: 'حسابداری',
    description: 'مدیریت مالی و حسابداری',
    icon: 'FaCalculator',
    color: 'green',
    path: '/dashboard/accounting',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.INVENTORY]: {
    id: WORKSPACES.INVENTORY,
    name: 'Inventory',
    namePersian: 'موجودی',
    description: 'مدیریت موجودی و انبار',
    icon: 'FaWarehouse',
    color: 'orange',
    path: '/dashboard/inventory',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.SECURITY]: {
    id: WORKSPACES.SECURITY,
    name: 'Security',
    namePersian: 'امنیت',
    description: 'مدیریت امنیت و حضور و غیاب',
    icon: 'FaShieldAlt',
    color: 'red',
    path: '/dashboard/security',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  }
};

// Context Types
interface WorkspaceContextType {
  currentWorkspace: WORKSPACES | null;
  userPermissions: Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>;
  accessibleWorkspaces: WorkspaceInfo[];
  setCurrentWorkspace: (workspace: WORKSPACES | null) => void;
  hasPermission: (workspace: WORKSPACES, permission: WORKSPACE_PERMISSIONS) => boolean;
  getWorkspacePermission: (workspace: WORKSPACES) => WORKSPACE_PERMISSIONS | null;
  refreshPermissions: () => Promise<void>;
  loading: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (context === undefined) {
    throw new Error('useWorkspace must be used within a WorkspaceProvider');
  }
  return context;
};

interface WorkspaceProviderProps {
  children: ReactNode;
}

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({ children }) => {
  const [currentWorkspace, setCurrentWorkspaceState] = useState<WORKSPACES | null>(null);
  const [userPermissions, setUserPermissions] = useState<Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>>({} as Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>);
  const [accessibleWorkspaces, setAccessibleWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();

  // Initialize permissions for all workspaces
  const initializePermissions = () => {
    const initialPermissions = {} as Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>;
    Object.values(WORKSPACES).forEach(workspace => {
      initialPermissions[workspace] = [];
    });
    return initialPermissions;
  };

  // Load user permissions from API
  const loadUserPermissions = async () => {
    try {
      setLoading(true);
      
      // Get user data from localStorage
      const userData = localStorage.getItem('user');
      if (!userData) {
        setUserPermissions(initializePermissions());
        setAccessibleWorkspaces([]);
        return;
      }

      const user = JSON.parse(userData);
      
      // Fetch real workspace permissions from API
      const response = await workspacePermissionsAPI.getUserWorkspaces();
      
      if (response.data.success) {
        const workspacePermissions = response.data.data;
        const permissions = initializePermissions();
        
        // Process the API response and set permissions
        workspacePermissions.forEach(({ workspace, permission }: { workspace: string; permission: string }) => {
          const permissionLevels = [WORKSPACE_PERMISSIONS.VIEW];
          
          if (permission === WORKSPACE_PERMISSIONS.EDIT || permission === WORKSPACE_PERMISSIONS.ADMIN) {
            permissionLevels.push(WORKSPACE_PERMISSIONS.EDIT);
          }
          
          if (permission === WORKSPACE_PERMISSIONS.ADMIN) {
            permissionLevels.push(WORKSPACE_PERMISSIONS.ADMIN);
          }
          
          permissions[workspace as WORKSPACES] = permissionLevels;
        });

        setUserPermissions(permissions);
        
        // Set accessible workspaces based on actual permissions
        const accessible = Object.values(WORKSPACE_CONFIG).filter(workspace => 
          permissions[workspace.id] && permissions[workspace.id].length > 0
        );
        setAccessibleWorkspaces(accessible);
      } else {
        // Fallback to empty permissions if API fails
        setUserPermissions(initializePermissions());
        setAccessibleWorkspaces([]);
      }

    } catch (error) {
      console.error('Error loading user permissions:', error);
      setUserPermissions(initializePermissions());
      setAccessibleWorkspaces([]);
    } finally {
      setLoading(false);
    }
  };

  // Determine current workspace from pathname
  const determineCurrentWorkspace = () => {
    if (pathname.startsWith('/dashboard/sales')) {
      return WORKSPACES.SALES;
    } else if (pathname.startsWith('/dashboard/crm')) {
      return WORKSPACES.CRM;
    } else if (pathname.startsWith('/dashboard/hr')) {
      return WORKSPACES.HR;
    } else if (pathname.startsWith('/dashboard/accounting')) {
      return WORKSPACES.ACCOUNTING;
    } else if (pathname.startsWith('/dashboard/inventory')) {
      return WORKSPACES.INVENTORY;
    } else if (pathname.startsWith('/dashboard/security')) {
      return WORKSPACES.SECURITY;
    }
    return null;
  };

  // Set current workspace
  const setCurrentWorkspace = (workspace: WORKSPACES | null) => {
    setCurrentWorkspaceState(workspace);
    
    if (workspace) {
      const workspaceConfig = WORKSPACE_CONFIG[workspace];
      router.push(workspaceConfig.path);
    } else {
      router.push('/dashboard');
    }
  };

  // Check if user has specific permission for workspace
  const hasPermission = (workspace: WORKSPACES, permission: WORKSPACE_PERMISSIONS): boolean => {
    const workspacePermissions = userPermissions[workspace] || [];
    return workspacePermissions.includes(permission);
  };

  // Get highest permission level for workspace
  const getWorkspacePermission = (workspace: WORKSPACES): WORKSPACE_PERMISSIONS | null => {
    const workspacePermissions = userPermissions[workspace] || [];
    
    if (workspacePermissions.includes(WORKSPACE_PERMISSIONS.ADMIN)) {
      return WORKSPACE_PERMISSIONS.ADMIN;
    } else if (workspacePermissions.includes(WORKSPACE_PERMISSIONS.EDIT)) {
      return WORKSPACE_PERMISSIONS.EDIT;
    } else if (workspacePermissions.includes(WORKSPACE_PERMISSIONS.VIEW)) {
      return WORKSPACE_PERMISSIONS.VIEW;
    }
    
    return null;
  };

  // Refresh permissions from API
  const refreshPermissions = async () => {
    await loadUserPermissions();
  };

  // Initialize on mount and pathname change
  useEffect(() => {
    loadUserPermissions();
  }, []);

  useEffect(() => {
    const workspace = determineCurrentWorkspace();
    setCurrentWorkspaceState(workspace);
  }, [pathname]);

  const value: WorkspaceContextType = {
    currentWorkspace,
    userPermissions,
    accessibleWorkspaces,
    setCurrentWorkspace,
    hasPermission,
    getWorkspacePermission,
    refreshPermissions,
    loading
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};
