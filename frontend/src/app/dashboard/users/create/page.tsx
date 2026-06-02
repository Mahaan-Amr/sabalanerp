'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { 
  FaUserPlus, 
  FaArrowRight, 
  FaBuilding, 
  FaShieldAlt,
  FaCheck,
  FaTimes,
  FaEye,
  FaEyeSlash
} from 'react-icons/fa';
import { authAPI, usersAPI, departmentsAPI } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  isActive: boolean;
}

interface WorkspacePermission {
  workspace: string;
  permissionLevel: string;
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
  security: 'حراست'
};

const PERMISSION_LABELS = {
  view: 'مشاهده',
  edit: 'ویرایش',
  admin: 'مدیر'
};

const PERMISSION_PRESETS: Array<{
  id: string;
  label: string;
  description: string;
  recommendedRole: string;
  permissions: WorkspacePermission[];
}> = [
  {
    id: 'crm_staff',
    label: 'کارشناس CRM',
    description: 'دسترسی کاری به CRM و مشاهده فروش',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.CRM, permissionLevel: WORKSPACE_PERMISSIONS.EDIT },
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'sales_staff',
    label: 'کارشناس فروش',
    description: 'دسترسی کاری به فروش و مشاهده CRM',
    recommendedRole: 'SALES',
    permissions: [
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.EDIT },
      { workspace: WORKSPACES.CRM, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'sales_manager',
    label: 'مدیر فروش',
    description: 'مدیریت فروش و CRM',
    recommendedRole: 'MANAGER',
    permissions: [
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.ADMIN },
      { workspace: WORKSPACES.CRM, permissionLevel: WORKSPACE_PERMISSIONS.ADMIN }
    ]
  },
  {
    id: 'inventory_editor',
    label: 'کارشناس انبار',
    description: 'ویرایش انبار و مشاهده فروش',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.INVENTORY, permissionLevel: WORKSPACE_PERMISSIONS.EDIT },
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'operations_viewer',
    label: 'مشاهده عملیات',
    description: 'مشاهده فروش، CRM و انبار',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW },
      { workspace: WORKSPACES.CRM, permissionLevel: WORKSPACE_PERMISSIONS.VIEW },
      { workspace: WORKSPACES.INVENTORY, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'security_staff',
    label: 'حراست',
    description: 'دسترسی کاری به حراست',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.SECURITY, permissionLevel: WORKSPACE_PERMISSIONS.EDIT }
    ]
  }
];

export default function CreateUserPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    username: '',
    phone: '',
    password: '',
    confirmPassword: '',
    role: 'USER',
    departmentId: '',
    isActive: true
  });

  const [workspacePermissions, setWorkspacePermissions] = useState<WorkspacePermission[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const selectedPreset = PERMISSION_PRESETS.find(item => item.id === selectedPresetId) || null;
  const canGrantAdminPermissions = currentUserRole !== 'MANAGER';
  const availablePermissionPresets = PERMISSION_PRESETS.filter((preset) =>
    canGrantAdminPermissions || !preset.permissions.some((permission) => permission.permissionLevel === WORKSPACE_PERMISSIONS.ADMIN)
  );
  const availableWorkspacePermissionEntries = Object.entries(WORKSPACE_PERMISSIONS).filter(([, permission]) =>
    canGrantAdminPermissions || permission !== WORKSPACE_PERMISSIONS.ADMIN
  );

  useEffect(() => {
    fetchDepartments();
    fetchCurrentUser();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const response = await authAPI.getMe();
      if (response.data.success) {
        setCurrentUserRole(response.data.data.role);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchDepartments = async () => {
    try {
      const response = await departmentsAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
      }
    } catch (error) {
      console.error('Error fetching departments:', error);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value
    }));
  };

  const handleWorkspacePermissionChange = (workspace: string, permissionLevel: string) => {
    if (!canGrantAdminPermissions && permissionLevel === WORKSPACE_PERMISSIONS.ADMIN) {
      setError('مدیر نمی‌تواند سطح دسترسی مدیریت را اعطا کند');
      return;
    }
    setSelectedPresetId(null);
    setWorkspacePermissions(prev => {
      const existing = prev.find(p => p.workspace === workspace);
      if (existing) {
        if (permissionLevel === 'none') {
          return prev.filter(p => p.workspace !== workspace);
        } else {
          return prev.map(p => 
            p.workspace === workspace 
              ? { ...p, permissionLevel }
              : p
          );
        }
      } else {
        if (permissionLevel !== 'none') {
          return [...prev, { workspace, permissionLevel }];
        }
        return prev;
      }
    });
  };

  const applyPermissionPreset = (presetId: string) => {
    const preset = PERMISSION_PRESETS.find(item => item.id === presetId);
    if (!preset) return;
    if (!canGrantAdminPermissions && preset.permissions.some((permission) => permission.permissionLevel === WORKSPACE_PERMISSIONS.ADMIN)) {
      setError('این الگو شامل سطح دسترسی مدیریت است و فقط مدیر سیستم می‌تواند آن را اعمال کند');
      return;
    }

    setSelectedPresetId(preset.id);
    setWorkspacePermissions(preset.permissions);
  };

  const clearWorkspacePermissions = () => {
    setSelectedPresetId(null);
    setWorkspacePermissions([]);
  };

  const getCurrentPermission = (workspace: string) => {
    const permission = workspacePermissions.find(p => p.workspace === workspace);
    return permission ? permission.permissionLevel : 'none';
  };

  const getWorkspacePermissionLabel = (permission: WorkspacePermission) => {
    const workspaceLabel = WORKSPACE_LABELS[permission.workspace as keyof typeof WORKSPACE_LABELS] || permission.workspace;
    const permissionLabel = PERMISSION_LABELS[permission.permissionLevel as keyof typeof PERMISSION_LABELS] || permission.permissionLevel;
    return `${workspaceLabel}: ${permissionLabel}`;
  };

  const validateForm = () => {
    if (!formData.firstName.trim()) {
      setError('نام الزامی است');
      return false;
    }
    if (!formData.lastName.trim()) {
      setError('نام خانوادگی الزامی است');
      return false;
    }
    if (!formData.email.trim()) {
      setError('ایمیل الزامی است');
      return false;
    }
    if (!formData.username.trim()) {
      setError('نام کاربری الزامی است');
      return false;
    }
    if (!formData.password.trim()) {
      setError('رمز عبور الزامی است');
      return false;
    }
    if (formData.password.length < 6) {
      setError('رمز عبور باید حداقل ۶ کاراکتر باشد');
      return false;
    }
    if (formData.password !== formData.confirmPassword) {
      setError('رمز عبور و تکرار آن یکسان نیستند');
      return false;
    }
    if (!canGrantAdminPermissions && workspacePermissions.some((permission) => permission.permissionLevel === WORKSPACE_PERMISSIONS.ADMIN)) {
      setError('مدیر نمی‌تواند سطح دسترسی مدیریت را اعطا کند');
      return false;
    }
    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Create user
      const userResponse = await usersAPI.createUser({
        firstName: formData.firstName,
        lastName: formData.lastName,
        email: formData.email,
        username: formData.username,
        phone: formData.phone,
        password: formData.password,
        role: formData.role,
        departmentId: formData.departmentId,
        isActive: formData.isActive,
        workspacePermissions
      });

      if (userResponse.data.success) {
        const createdUserId = userResponse.data.data.id;
        const permissionCount = userResponse.data.data.permissionSummary?.workspacePermissions || workspacePermissions.length;
        alert(`کاربر با موفقیت ایجاد شد${permissionCount > 0 ? ` و ${permissionCount} دسترسی فضای کاری ثبت شد` : ''}.`);
        router.push(`/dashboard/users?createdUserId=${createdUserId}`);
      }
    } catch (error: any) {
      console.error('Error creating user:', error);
      const details = error.response?.data?.details;
      const detailMessage = Array.isArray(details) && details.length > 0
        ? details[0].msg
        : null;
      setError(detailMessage || error.response?.data?.error || 'خطا در ایجاد کاربر');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaUserPlus className="h-8 w-8 text-teal-500" />
            <div>
              <h1 className="text-2xl font-bold text-primary">ایجاد کاربر جدید</h1>
              <p className="text-secondary">اطلاعات کاربر و نقش سازمانی را تکمیل کنید</p>
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

      {error && (
        <div className="glass-liquid-card p-4 bg-red-500/20 border border-red-500/30">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaTimes className="text-red-500" />
            <p className="text-red-400">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">اطلاعات پایه</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-secondary mb-2">نام *</label>
              <input
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="نام"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">نام خانوادگی *</label>
              <input
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="نام خانوادگی"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">ایمیل *</label>
              <input
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="example@domain.com"
                required
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">نام کاربری *</label>
              <input
                type="text"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="نام کاربری"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">شماره تماس</label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
                placeholder="09123456789"
                dir="ltr"
              />
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">رمز عبور *</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="glass-liquid-input w-full pr-10"
                  placeholder="رمز عبور"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">تکرار رمز عبور *</label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className="glass-liquid-input w-full pr-10"
                  placeholder="تکرار رمز عبور"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400"
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Role and Department */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">نقش و دپارتمان</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-secondary mb-2">نقش</label>
              <select
                name="role"
                value={formData.role}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
              >
                <option value="USER">کاربر</option>
                <option value="MODERATOR">ناظر</option>
                <option value="SALES">فروش</option>
                {currentUserRole !== 'MANAGER' && (
                  <>
                    <option value="MANAGER">مدیر</option>
                    <option value="ADMIN">مدیر سیستم</option>
                  </>
                )}
              </select>
            </div>
            
            <div>
              <label className="block text-sm text-secondary mb-2">دپارتمان</label>
              <select
                name="departmentId"
                value={formData.departmentId}
                onChange={handleInputChange}
                className="glass-liquid-input w-full"
              >
                <option value="">انتخاب دپارتمان</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>
                    {dept.namePersian}
                  </option>
                ))}
              </select>
            </div>
          </div>
          
          <div className="mt-4">
            <label className="flex items-center space-x-2 space-x-reverse">
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleInputChange}
                className="rounded border-gray-600 bg-gray-700 text-teal-500 focus:ring-teal-500"
              />
              <span className="text-secondary">کاربر فعال</span>
            </label>
          </div>
        </div>

        {/* Workspace Permissions */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">دسترسی‌های فضای کاری</h2>
          <p className="text-secondary mb-6">
            دسترسی‌های انتخاب‌شده همزمان با ایجاد کاربر ذخیره می‌شوند.
          </p>

          <div className="mb-6">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                <FaShieldAlt className="text-teal-500" />
                الگوی دسترسی
              </h3>
              {workspacePermissions.length > 0 && (
                <button
                  type="button"
                  onClick={clearWorkspacePermissions}
                  className="glass-liquid-btn px-4 py-2 text-sm"
                >
                  پاک کردن دسترسی‌ها
                </button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {availablePermissionPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => applyPermissionPreset(preset.id)}
                  className={`text-right p-4 rounded-lg border transition-all duration-200 ${
                    selectedPresetId === preset.id
                      ? 'bg-teal-500/20 border-teal-400/60 text-teal-100'
                      : 'bg-gray-800/40 border-gray-700 text-secondary hover:border-teal-500/40 hover:bg-teal-500/10'
                  }`}
                >
                  <span className="block text-primary font-medium mb-1">{preset.label}</span>
                  <span className="block text-sm text-secondary">{preset.description}</span>
                  <span className="block text-xs text-teal-300 mt-3">
                    نقش پیشنهادی: {preset.recommendedRole}
                  </span>
                </button>
              ))}
            </div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(WORKSPACES).map(([key, workspace]) => (
              <div key={workspace} className="glass-liquid-card p-4">
                <h3 className="font-medium text-primary mb-3">
                  {WORKSPACE_LABELS[workspace as keyof typeof WORKSPACE_LABELS]}
                </h3>
                
                <div className="space-y-2">
                  {availableWorkspacePermissionEntries.map(([permKey, permission]) => (
                    <label key={permission} className="flex items-center space-x-2 space-x-reverse">
                      <input
                        type="radio"
                        name={`workspace_${workspace}`}
                        value={permission}
                        checked={getCurrentPermission(workspace) === permission}
                        onChange={() => handleWorkspacePermissionChange(workspace, permission)}
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
                      onChange={() => handleWorkspacePermissionChange(workspace, 'none')}
                      className="text-gray-500 focus:ring-gray-500"
                    />
                    <span className="text-gray-500 text-sm">بدون دسترسی</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Review */}
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-bold text-primary mb-4">بازبینی نهایی</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="p-4 rounded-lg bg-gray-800/40 border border-gray-700">
              <p className="text-secondary mb-2">کاربر</p>
              <p className="text-primary font-medium">
                {formData.firstName || 'نام'} {formData.lastName || 'نام خانوادگی'}
              </p>
              <p className="text-secondary mt-1">{formData.email || 'ایمیل وارد نشده'}</p>
              <p className="text-secondary mt-2">نقش انتخاب‌شده: {formData.role}</p>
              {selectedPreset && selectedPreset.recommendedRole !== formData.role && (
                <p className="text-amber-300 mt-2">
                  نقش پیشنهادی این الگو: {selectedPreset.recommendedRole}
                </p>
              )}
            </div>
            <div className="p-4 rounded-lg bg-gray-800/40 border border-gray-700">
              <p className="text-secondary mb-2">دسترسی‌ها</p>
              {workspacePermissions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {workspacePermissions.map((permission) => (
                    <span
                      key={permission.workspace}
                      className="px-3 py-1 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-200"
                    >
                      {getWorkspacePermissionLabel(permission)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                  <p className="text-amber-200 font-medium">هیچ دسترسی فضای کاری انتخاب نشده است</p>
                  <p className="text-amber-100/80 mt-1">
                    کاربر ایجاد می‌شود، اما تا زمان افزودن دسترسی مستقیم یا نقش مناسب، دسترسی عملی محدودی خواهد داشت.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-end space-x-4 space-x-reverse">
            <Link
              href="/dashboard/users"
              className="glass-liquid-btn px-6 py-2"
            >
              انصراف
            </Link>
            <button
              type="submit"
              disabled={loading}
              className="glass-liquid-btn-primary px-6 py-2 flex items-center space-x-2 space-x-reverse disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <FaCheck />
              )}
              <span>{loading ? 'در حال ایجاد...' : 'ایجاد کاربر'}</span>
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}


