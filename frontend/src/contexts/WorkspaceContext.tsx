'use client';

import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { workspacePermissionsAPI } from '@/lib/api';

// Workspace Types
export enum WORKSPACES {
  PURCHASING = 'purchasing',
  SALES = 'sales',
  CRM = 'crm',
  HR = 'hr',
  ACCOUNTING = 'accounting',
  INVENTORY = 'inventory',
  SECURITY = 'security',
  BI = 'bi',
  LOGISTICS = 'logistics'
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
  [WORKSPACES.PURCHASING]: { id: WORKSPACES.PURCHASING, name: 'Purchasing', namePersian: 'خرید', description: 'درخواست، سفارش و دریافت خرید', icon: 'FaShoppingCart', color: 'teal', path: '/dashboard/purchasing', permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN] },
  [WORKSPACES.SALES]: {
    id: WORKSPACES.SALES,
    name: 'Sales',
    namePersian: 'فروش',
    description: 'مدیریت فروش و قراردادها',
    icon: 'FaFileContract',
    color: 'teal',
    path: '/dashboard/sales',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.CRM]: {
    id: WORKSPACES.CRM,
    name: 'CRM',
    namePersian: 'مدیریت ارتباط با مشتری',
    description: 'مدیریت مشتریان و ارتباطات',
    icon: 'FaUsers',
    color: 'blue',
    path: '/dashboard/crm',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.HR]: {
    id: WORKSPACES.HR,
    name: 'Human Resources',
    namePersian: 'منابع انسانی',
    description: 'مدیریت کارکنان و حقوق',
    icon: 'FaUserTie',
    color: 'purple',
    path: '/dashboard/hr',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.ACCOUNTING]: {
    id: WORKSPACES.ACCOUNTING,
    name: 'Accounting',
    namePersian: 'حسابداری',
    description: 'مدیریت مالی و حساب‌ها',
    icon: 'FaCalculator',
    color: 'green',
    path: '/dashboard/accounting',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.INVENTORY]: {
    id: WORKSPACES.INVENTORY,
    name: 'Inventory',
    namePersian: 'انبار',
    description: 'مدیریت موجودی و کالاها',
    icon: 'FaWarehouse',
    color: 'orange',
    path: '/dashboard/inventory',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.SECURITY]: {
    id: WORKSPACES.SECURITY,
    name: 'Security',
    namePersian: 'گارد',
    description: 'مدیریت تردد و امنیت',
    icon: 'FaShieldAlt',
    color: 'red',
    path: '/dashboard/security',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.BI]: {
    id: WORKSPACES.BI,
    name: 'Business Intelligence',
    namePersian: 'هوش تجاری',
    description: 'تحلیل مدیریتی فروش',
    icon: 'FaChartPie',
    color: 'teal',
    path: '/dashboard/bi',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.ADMIN]
  },
  [WORKSPACES.LOGISTICS]: {
    id: WORKSPACES.LOGISTICS,
    name: 'Logistics',
    namePersian: 'لجستیک',
    description: 'بارگیری، راننده‌ها و مانده ارسال پروژه‌ها',
    icon: 'FaTruck',
    color: 'cyan',
    path: '/dashboard/logistics',
    permissions: [WORKSPACE_PERMISSIONS.VIEW, WORKSPACE_PERMISSIONS.EDIT, WORKSPACE_PERMISSIONS.ADMIN]
  }
};

export function workspaceForPathname(pathname: string): WORKSPACES | null {
  return Object.values(WORKSPACE_CONFIG)
    .find(({ path }) => pathname === path || pathname.startsWith(path + '/'))?.id ?? null;
}

export const LAST_WORKSPACE_STORAGE_KEY = 'sabalan:lastWorkspace';

// Context Types
interface WorkspaceContextType {
  currentWorkspace: WORKSPACES | null;
  userPermissions: Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>;
  accessibleWorkspaces: WorkspaceInfo[];
  setCurrentWorkspace: (workspace: WORKSPACES | null) => void;
  hasPermission: (workspace: WORKSPACES, permission: WORKSPACE_PERMISSIONS) => boolean;
  getWorkspacePermission: (workspace: WORKSPACES) => WORKSPACE_PERMISSIONS | null;
  refreshPermissions: () => Promise<void>;
  permissionsReady: boolean;
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

const initializePermissions = () => {
  const initialPermissions = {} as Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>;
  Object.values(WORKSPACES).forEach(workspace => {
    initialPermissions[workspace] = [];
  });
  return initialPermissions;
};
const emptyWorkspacePermissions = initializePermissions();
const emptyAccessibleWorkspaces: WorkspaceInfo[] = [];

export const WorkspaceProvider: React.FC<WorkspaceProviderProps> = ({ children }) => {
  const [currentWorkspace, setCurrentWorkspaceState] = useState<WORKSPACES | null>(null);
  const [userPermissions, setUserPermissions] = useState<Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>>({} as Record<WORKSPACES, WORKSPACE_PERMISSIONS[]>);
  const [accessibleWorkspaces, setAccessibleWorkspaces] = useState<WorkspaceInfo[]>([]);
  const [permissionOwner, setPermissionOwner] = useState<string>();
  const permissionRequest = useRef(0);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading: authLoading } = useAuth();
  const actorId = user?.id;
  const permissionsReady = Boolean(actorId && permissionOwner === actorId);

  // Load user permissions from API
  const loadUserPermissions = useCallback(async () => {
    if (authLoading) return;
    const request = ++permissionRequest.current;
    if (!actorId) {
      setPermissionOwner(undefined);
      setUserPermissions(emptyWorkspacePermissions);
      setAccessibleWorkspaces(emptyAccessibleWorkspaces);
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      
      // Fetch real workspace permissions from API
      const response = await workspacePermissionsAPI.getUserWorkspaces(actorId);
      if (request !== permissionRequest.current) return;
      
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
      if (request !== permissionRequest.current) return;
      console.error('Error loading user permissions:', error);
      setUserPermissions(initializePermissions());
      setAccessibleWorkspaces([]);
    } finally {
      if (request === permissionRequest.current) {
        setPermissionOwner(actorId);
        setLoading(false);
      }
    }
  }, [actorId, authLoading]);

  // Set current workspace
  const setCurrentWorkspace = (workspace: WORKSPACES | null) => {
    setCurrentWorkspaceState(workspace);
    
    if (workspace) {
      const workspaceConfig = WORKSPACE_CONFIG[workspace];
      localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspace);
      router.push(workspaceConfig.path);
    } else {
      localStorage.removeItem(LAST_WORKSPACE_STORAGE_KEY);
      router.push('/dashboard');
    }
  };

  // Check if user has specific permission for workspace
  const hasPermission = (workspace: WORKSPACES, permission: WORKSPACE_PERMISSIONS): boolean => {
    const workspacePermissions = permissionsReady ? userPermissions[workspace] || [] : [];
    return workspacePermissions.includes(permission);
  };

  // Get highest permission level for workspace
  const getWorkspacePermission = (workspace: WORKSPACES): WORKSPACE_PERMISSIONS | null => {
    const workspacePermissions = permissionsReady ? userPermissions[workspace] || [] : [];
    
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

  useEffect(() => {
    const workspace = workspaceForPathname(pathname);
    setCurrentWorkspaceState(workspace);
    if (workspace) localStorage.setItem(LAST_WORKSPACE_STORAGE_KEY, workspace);

    if (pathname.startsWith('/dashboard') && !authLoading) {
      loadUserPermissions();
    } else if (!authLoading) {
      setLoading(false);
    }
  }, [pathname, loadUserPermissions, authLoading]);

  const value: WorkspaceContextType = {
    currentWorkspace,
    userPermissions: permissionsReady ? userPermissions : emptyWorkspacePermissions,
    accessibleWorkspaces: permissionsReady ? accessibleWorkspaces : emptyAccessibleWorkspaces,
    setCurrentWorkspace,
    hasPermission,
    getWorkspacePermission,
    refreshPermissions,
    permissionsReady,
    loading: loading || Boolean(actorId && pathname.startsWith('/dashboard') && !permissionsReady)
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};

