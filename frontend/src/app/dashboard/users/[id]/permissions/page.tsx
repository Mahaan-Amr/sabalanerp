'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  FaShieldAlt, 
  FaArrowRight, 
  FaCheck,
  FaTimes,
  FaSave,
  FaUser,
  FaBuilding
} from 'react-icons/fa';
import { usersAPI, workspacePermissionsAPI } from '@/lib/api';

interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  department?: {
    id: string;
    name: string;
    namePersian: string;
  };
}

interface WorkspacePermission {
  id: string;
  userId: string;
  workspace: string;
  permissionLevel: string;
  isActive: boolean;
  grantedAt: string;
  granter: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
}

const WORKSPACES = {
  SALES: 'sales',
  CRM: 'crm',
  HR: 'hr',
  ACCOUNTING: 'accounting',
  INVENTORY: 'inventory',
  SECURITY: 'security'
};

const WORKSPACE_PERMISSIONS = {
  VIEW: 'view',
  EDIT: 'edit',
  ADMIN: 'admin'
};

const WORKSPACE_LABELS = {
  sales: 'فروش',
  crm: 'CRM',
  hr: 'منابع انسانی',
  accounting: 'حسابداری',
  inventory: 'انبار',
  security: 'امنیت'
};

const PERMISSION_LABELS = {
  view: 'مشاهده',
  edit: 'ویرایش',
  admin: 'مدیریت'
};

const PERMISSION_COLORS = {
  view: 'text-blue-500 bg-blue-500/20',
  edit: 'text-yellow-500 bg-yellow-500/20',
  admin: 'text-red-500 bg-red-500/20'
};

export default function UserPermissionsPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const [workspacePermissions, setWorkspacePermissions] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchUserData();
  }, [params.id]);

  const fetchUserData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const [userResponse, permissionsResponse] = await Promise.all([
        usersAPI.getUser(params.id),
        workspacePermissionsAPI.getUserPermissions()
      ]);
      
      if (userResponse.data.success) {
        setUser(userResponse.data.data);
      }
      
      if (permissionsResponse.data.success) {
        const userPermissions = permissionsResponse.data.data.filter(
          (p: WorkspacePermission) => p.userId === params.id
        );
        setPermissions(userPermissions);
        
        // Initialize workspace permissions state
        const initialPermissions: Record<string, string> = {};
        userPermissions.forEach((permission: WorkspacePermission) => {
          if (permission.isActive) {
            initialPermissions[permission.workspace] = permission.permissionLevel;
          }
        });
        setWorkspacePermissions(initialPermissions);
      }
    } catch (error: any) {
      console.error('Error fetching user data:', error);
      setError(error.response?.data?.error || 'خطا در بارگذاری اطلاعات');
    } finally {
      setLoading(false);
    }
  };

  const handlePermissionChange = (workspace: string, permissionLevel: string) => {
    setWorkspacePermissions(prev => ({
      ...prev,
      [workspace]: permissionLevel
    }));
  };

  const getCurrentPermission = (workspace: string) => {
    return workspacePermissions[workspace] || 'none';
  };

  const handleSave = async () => {
    if (!user) return;
    
    setSaving(true);
    setError(null);
    setSuccess(null);

    try {
      // Get current permissions from database
      const currentPermissions = permissions.filter(p => p.isActive);
      
      // Determine which permissions to add/update/remove
      const permissionsToProcess = Object.entries(workspacePermissions);
      
      for (const [workspace, permissionLevel] of permissionsToProcess) {
        const existingPermission = currentPermissions.find(p => p.workspace === workspace);
        
        if (permissionLevel === 'none') {
          // Remove permission if it exists
          if (existingPermission) {
            await workspacePermissionsAPI.deleteUserPermission(existingPermission.id);
          }
        } else {
          // Add or update permission
          const permissionData = {
            userId: user.id,
            workspace,
            permissionLevel
          };
          
          if (existingPermission) {
            // Update existing permission
            await workspacePermissionsAPI.updateUserPermission(existingPermission.id, permissionData);
          } else {
            // Create new permission
            await workspacePermissionsAPI.createUserPermission(permissionData);
          }
        }
      }
      
      // Remove permissions that are no longer needed
      for (const permission of currentPermissions) {
        if (!workspacePermissions[permission.workspace] || workspacePermissions[permission.workspace] === 'none') {
          await workspacePermissionsAPI.deleteUserPermission(permission.id);
        }
      }
      
      setSuccess('دسترسی‌ها با موفقیت به‌روزرسانی شدند');
      fetchUserData(); // Refresh data
    } catch (error: any) {
      console.error('Error saving permissions:', error);
      setError(error.response?.data?.error || 'خطا در ذخیره دسترسی‌ها');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error && !user) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 flex items-center justify-center">
        <div className="glass-liquid-card p-8 text-center">
          <h2 className="text-xl font-bold text-primary mb-2">خطا در بارگذاری</h2>
          <p className="text-secondary mb-4">{error}</p>
          <button 
            onClick={fetchUserData}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            تلاش مجدد
          </button>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaShieldAlt className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">مدیریت دسترسی‌ها</h1>
              <p className="text-secondary">تنظیم دسترسی‌های فضای کاری برای کاربر</p>
            </div>
          </div>
          <Link
            href="/dashboard/users"
            className="glass-liquid-btn px-6 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaArrowRight />
            <span>بازگشت به لیست</span>
          </Link>
        </div>
      </div>

      {/* User Info */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-bold text-primary mb-4">اطلاعات کاربر</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="flex items-center space-x-3 space-x-reverse">
            <FaUser className="h-6 w-6 text-blue-500" />
            <div>
              <p className="text-sm text-secondary">نام</p>
              <p className="text-primary font-medium">
                {user.firstName} {user.lastName}
              </p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 space-x-reverse">
            <FaShieldAlt className="h-6 w-6 text-yellow-500" />
            <div>
              <p className="text-sm text-secondary">نقش</p>
              <p className="text-primary font-medium">{user.role}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-3 space-x-reverse">
            <FaBuilding className="h-6 w-6 text-purple-500" />
            <div>
              <p className="text-sm text-secondary">بخش</p>
              <p className="text-primary font-medium">
                {user.department ? user.department.namePersian : 'بدون بخش'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Current Permissions */}
      {permissions.length > 0 && (
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">دسترسی‌های فعلی</h2>
          <div className="flex flex-wrap gap-2">
            {permissions.filter(p => p.isActive).map(permission => (
              <span
                key={permission.id}
                className={`px-3 py-1 rounded-full text-sm font-medium ${PERMISSION_COLORS[permission.permissionLevel as keyof typeof PERMISSION_COLORS]}`}
              >
                {WORKSPACE_LABELS[permission.workspace as keyof typeof WORKSPACE_LABELS]} - {PERMISSION_LABELS[permission.permissionLevel as keyof typeof PERMISSION_LABELS]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Permission Management */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-bold text-primary mb-4">تنظیم دسترسی‌ها</h2>
        <p className="text-secondary mb-6">
          دسترسی‌های کاربر به فضاهای کاری مختلف را تعیین کنید
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {Object.entries(WORKSPACES).map(([key, workspace]) => (
            <div key={workspace} className="glass-liquid-card p-4">
              <h3 className="font-medium text-primary mb-3">
                {WORKSPACE_LABELS[workspace as keyof typeof WORKSPACE_LABELS]}
              </h3>
              
              <div className="space-y-2">
                {Object.entries(WORKSPACE_PERMISSIONS).map(([permKey, permission]) => (
                  <label key={permission} className="flex items-center space-x-2 space-x-reverse">
                    <input
                      type="radio"
                      name={`workspace_${workspace}`}
                      value={permission}
                      checked={getCurrentPermission(workspace) === permission}
                      onChange={() => handlePermissionChange(workspace, permission)}
                      className="text-teal-500 focus:ring-teal-500"
                    />
                    <span className="text-secondary text-sm">
                      {PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS]}
                    </span>
                  </label>
                ))}
                
                <label className="flex items-center space-x-2 space-x-reverse">
                  <input
                    type="radio"
                    name={`workspace_${workspace}`}
                    value="none"
                    checked={getCurrentPermission(workspace) === 'none'}
                    onChange={() => handlePermissionChange(workspace, 'none')}
                    className="text-gray-500 focus:ring-gray-500"
                  />
                  <span className="text-gray-500 text-sm">بدون دسترسی</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Messages */}
      {error && (
        <div className="glass-liquid-card p-4 bg-red-500/20 border border-red-500/30">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaTimes className="text-red-500" />
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      {success && (
        <div className="glass-liquid-card p-4 bg-green-500/20 border border-green-500/30">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaCheck className="text-green-500" />
            <p className="text-green-400">{success}</p>
          </div>
        </div>
      )}

      {/* Save Button */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-end space-x-4 space-x-reverse">
          <Link
            href="/dashboard/users"
            className="glass-liquid-btn px-6 py-2"
          >
            لغو
          </Link>
          <button
            onClick={handleSave}
            disabled={saving}
            className="glass-liquid-btn-primary px-6 py-2 flex items-center space-x-2 space-x-reverse disabled:opacity-50"
          >
            {saving ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
            ) : (
              <FaSave />
            )}
            <span>{saving ? 'در حال ذخیره...' : 'ذخیره تغییرات'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
