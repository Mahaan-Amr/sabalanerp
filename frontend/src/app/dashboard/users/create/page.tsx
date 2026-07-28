'use client';
import { ErpInput, ErpPressable, ErpSelect } from '@/components/erp';
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
import { authAPI, usersAPI, departmentsAPI, personnelAPI } from '@/lib/api';

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

interface Personnel {
  id: string;
  firstName: string;
  lastName: string;
  isActive: boolean;
  department?: {
    id: string;
    namePersian: string;
  } | null;
  user?: {
    id: string;
    username: string;
  } | null;
}

const WORKSPACES = {
  SALES: 'sales',
  CRM: 'crm',
  HR: 'hr',
  ACCOUNTING: 'accounting',
  INVENTORY: 'inventory',
  SECURITY: 'security',
  BI: 'bi',
  LOGISTICS: 'logistics'
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
  security: 'گارد',
  bi: 'هوش تجاری',
  logistics: 'لجستیک'
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
    description: 'مدیریت فروش، CRM و مشاهده BI',
    recommendedRole: 'MANAGER',
    permissions: [
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.ADMIN },
      { workspace: WORKSPACES.CRM, permissionLevel: WORKSPACE_PERMISSIONS.ADMIN },
      { workspace: WORKSPACES.BI, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'bi_admin',
    label: 'مدیر BI',
    description: 'دسترسی مدیریتی به تحلیل کلان فروش',
    recommendedRole: 'MANAGER',
    permissions: [
      { workspace: WORKSPACES.BI, permissionLevel: WORKSPACE_PERMISSIONS.ADMIN },
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
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
    id: 'logistics_staff',
    label: 'کارشناس لجستیک',
    description: 'ثبت بارگیری، راننده‌ها و مشاهده فروش',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.LOGISTICS, permissionLevel: WORKSPACE_PERMISSIONS.EDIT },
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'logistics_manager',
    label: 'مدیر لجستیک',
    description: 'مدیریت لجستیک و مشاهده فروش و انبار',
    recommendedRole: 'MANAGER',
    permissions: [
      { workspace: WORKSPACES.LOGISTICS, permissionLevel: WORKSPACE_PERMISSIONS.ADMIN },
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW },
      { workspace: WORKSPACES.INVENTORY, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'operations_viewer',
    label: 'مشاهده عملیات',
    description: 'مشاهده فروش، CRM، انبار و لجستیک',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.SALES, permissionLevel: WORKSPACE_PERMISSIONS.VIEW },
      { workspace: WORKSPACES.CRM, permissionLevel: WORKSPACE_PERMISSIONS.VIEW },
      { workspace: WORKSPACES.INVENTORY, permissionLevel: WORKSPACE_PERMISSIONS.VIEW },
      { workspace: WORKSPACES.LOGISTICS, permissionLevel: WORKSPACE_PERMISSIONS.VIEW }
    ]
  },
  {
    id: 'security_staff',
    label: 'گارد',
    description: 'دسترسی کاری به گارد',
    recommendedRole: 'USER',
    permissions: [
      { workspace: WORKSPACES.SECURITY, permissionLevel: WORKSPACE_PERMISSIONS.EDIT }
    ]
  }
];

export default function CreateUserPage() {
  const router = useRouter();
  const [departments, setDepartments] = useState<Department[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
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
  const [personnelMode, setPersonnelMode] = useState<'none' | 'existing'>('none');
  const [selectedPersonnelId, setSelectedPersonnelId] = useState('');
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
    fetchPersonnel();
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

  const fetchPersonnel = async () => {
    try {
      const response = await personnelAPI.getPersonnel({ includeInactive: true });
      if (response.data.success) {
        setPersonnel(response.data.data || []);
      }
    } catch (error) {
      console.error('Error fetching personnel:', error);
    }
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
    if (personnelMode === 'existing' && !selectedPersonnelId) {
      setError('برای اتصال به پرسنل موجود، یک پرسنل را انتخاب کنید');
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
        personnelMode,
        personnelId: personnelMode === 'existing' ? selectedPersonnelId : undefined,
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
    <main className="sds-workspace space-y-6">
      {/* Header */}
      <div className="sds-workspace-surface p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-4 space-x-reverse">
            <FaUserPlus className="h-8 w-8 text-[var(--sds-accent)]" />
            <div>
              <h1 className="text-2xl font-bold text-primary">ایجاد کاربر جدید</h1>
              <p className="text-secondary">اطلاعات کاربر و نقش سازمانی را تکمیل کنید</p>
            </div>
          </div>
          <Link
            href="/dashboard/users"
            className="sds-action px-6 py-2 flex items-center space-x-2 space-x-reverse"
          >
            <FaArrowRight />
            <span>بازگشت به لیست</span>
          </Link>
        </div>
      </div>

      {error && (
        <div className="sds-workspace-surface p-4 bg-[var(--sds-danger-surface)] border border-[var(--sds-danger-border)]">
          <div className="flex items-center space-x-2 space-x-reverse">
            <FaTimes className="text-[var(--sds-danger)]" />
            <p className="text-[var(--sds-danger)]">{error}</p>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Information */}
        <div className="sds-workspace-surface p-6">
          <h2 className="text-xl font-bold text-primary mb-4">اطلاعات پایه</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-secondary mb-2">نام *</label>
              <ErpInput
                type="text"
                name="firstName"
                value={formData.firstName}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="نام"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">نام خانوادگی *</label>
              <ErpInput
                type="text"
                name="lastName"
                value={formData.lastName}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="نام خانوادگی"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">ایمیل *</label>
              <ErpInput
                type="email"
                name="email"
                value={formData.email}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="example@domain.com"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">نام کاربری *</label>
              <ErpInput
                type="text"
                name="username"
                value={formData.username}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="نام کاربری"
                required
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">شماره تماس</label>
              <ErpInput
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleInputChange}
                className="sds-field w-full"
                placeholder="09123456789"
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">رمز عبور *</label>
              <div className="relative">
                <ErpInput
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  value={formData.password}
                  onChange={handleInputChange}
                  className="sds-field w-full pr-10"
                  placeholder="رمز عبور"
                  required
                />
                <ErpPressable
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]"
                >
                  {showPassword ? <FaEyeSlash /> : <FaEye />}
                </ErpPressable>
              </div>
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">تکرار رمز عبور *</label>
              <div className="relative">
                <ErpInput
                  type={showConfirmPassword ? 'text' : 'password'}
                  name="confirmPassword"
                  value={formData.confirmPassword}
                  onChange={handleInputChange}
                  className="sds-field w-full pr-10"
                  placeholder="تکرار رمز عبور"
                  required
                />
                <ErpPressable
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]"
                >
                  {showConfirmPassword ? <FaEyeSlash /> : <FaEye />}
                </ErpPressable>
              </div>
            </div>
          </div>
        </div>

        {/* Role and Department */}
        <div className="sds-workspace-surface p-6">
          <h2 className="text-xl font-bold text-primary mb-4">نقش و دپارتمان</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm text-secondary mb-2">نقش</label>
              <ErpSelect
                name="role"
                value={formData.role}
                onChange={handleInputChange}
                className="sds-field w-full"
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
              </ErpSelect>
            </div>

            <div>
              <label className="block text-sm text-secondary mb-2">دپارتمان</label>
              <ErpSelect
                name="departmentId"
                value={formData.departmentId}
                onChange={handleInputChange}
                className="sds-field w-full"
              >
                <option value="">انتخاب دپارتمان</option>
                {departments.map(dept => (
                  <option key={dept.id} value={dept.id}>
                    {dept.namePersian}
                  </option>
                ))}
              </ErpSelect>
            </div>
          </div>

          <div className="mt-4">
            <label className="flex items-center space-x-2 space-x-reverse">
              <ErpInput
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleInputChange}
                className="rounded border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-accent)] focus:ring-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-accent)] dark:focus:ring-[var(--sds-focus-ring)]"
              />
              <span className="text-secondary">کاربر فعال</span>
            </label>
          </div>
        </div>

        {/* Workspace Permissions */}
        <div className="sds-workspace-surface p-6">
          <h2 className="text-xl font-bold text-primary mb-4">دسترسی‌های فضای کاری</h2>
          <p className="text-secondary mb-6">
            دسترسی‌های انتخاب‌شده همزمان با ایجاد کاربر ذخیره می‌شوند.
          </p>

          <div className="mb-6">
            <div className="flex items-center justify-between gap-4 mb-3">
              <h3 className="text-lg font-semibold text-primary flex items-center gap-2">
                <FaShieldAlt className="text-[var(--sds-accent)]" />
                الگوی دسترسی
              </h3>
              {workspacePermissions.length > 0 && (
                <ErpPressable
                  type="button"
                  onClick={clearWorkspacePermissions}
                  className="sds-action px-4 py-2 text-sm"
                >
                  پاک کردن دسترسی‌ها
                </ErpPressable>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {availablePermissionPresets.map((preset) => (
                <ErpPressable
                  key={preset.id}
                  type="button"
                  onClick={() => applyPermissionPreset(preset.id)}
                  className={`text-right p-4 rounded-lg border transition-all duration-200 ${
                    selectedPresetId === preset.id
                      ? 'border-[var(--sds-accent)]/50 bg-[var(--sds-accent)]/10 text-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]'
                      : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-accent)]/40 hover:bg-[var(--sds-accent)]/5 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-inverse)] dark:hover:border-[var(--sds-border-strong)] dark:hover:bg-[var(--sds-accent-surface)]'
                  }`}
                >
                  <span className="block text-primary font-medium mb-1">{preset.label}</span>
                  <span className="block text-sm text-secondary">{preset.description}</span>
                  <span className="mt-3 block text-xs font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
                    نقش پیشنهادی: {preset.recommendedRole}
                  </span>
                </ErpPressable>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Object.entries(WORKSPACES).map(([key, workspace]) => (
              <div key={workspace} className="sds-workspace-surface p-4">
                <h3 className="font-medium text-primary mb-3">
                  {WORKSPACE_LABELS[workspace as keyof typeof WORKSPACE_LABELS]}
                </h3>

                <div className="space-y-2">
                  {availableWorkspacePermissionEntries.map(([permKey, permission]) => (
                    <label key={permission} className="flex items-center space-x-2 space-x-reverse">
                      <ErpInput
                        type="radio"
                        name={`workspace_${workspace}`}
                        value={permission}
                        checked={getCurrentPermission(workspace) === permission}
                        onChange={() => handleWorkspacePermissionChange(workspace, permission)}
                        className="text-[var(--sds-accent)] focus:ring-[var(--sds-accent)] dark:text-[var(--sds-accent)] dark:focus:ring-[var(--sds-focus-ring)]"
                      />
                      <span className="text-secondary text-sm">
                        {PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS]}
                      </span>
                    </label>
                  ))}

                  <label className="flex items-center space-x-2 space-x-reverse">
                    <ErpInput
                      type="radio"
                      name={`workspace_${workspace}`}
                      value="none"
                      checked={getCurrentPermission(workspace) === 'none'}
                      onChange={() => handleWorkspacePermissionChange(workspace, 'none')}
                      className="text-[var(--sds-text-secondary)] focus:ring-[var(--sds-focus-ring)]"
                    />
                    <span className="text-sm text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)]">بدون دسترسی</span>
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Personnel Link */}
        <div className="sds-workspace-surface p-6">
          <h2 className="text-xl font-bold text-primary mb-4">پرسنل مرتبط</h2>
          <p className="text-secondary mb-4">
            حساب کاربری برای ورود به سیستم است؛ پرسنل برای حضور و غیاب و عملیات سازمانی استفاده می‌شود.
          </p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={`rounded-lg border p-4 transition ${personnelMode === 'none' ? 'border-[var(--sds-accent)]/50 bg-[var(--sds-accent)]/10 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)]' : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]'}`}>
              <span className="flex items-center gap-2">
                <ErpInput
                  type="radio"
                  checked={personnelMode === 'none'}
                  onChange={() => setPersonnelMode('none')}
                  className="text-[var(--sds-accent)] focus:ring-[var(--sds-accent)]"
                />
                <span className="font-semibold text-primary">بدون اتصال پرسنلی</span>
              </span>
              <span className="mt-2 block text-sm text-secondary">حساب فقط هویت دسترسی است؛ HR می‌تواند بعداً آن را به پرونده پرسنلی متصل کند.</span>
            </label>
            <label className={`rounded-lg border p-4 transition ${personnelMode === 'existing' ? 'border-[var(--sds-accent)]/50 bg-[var(--sds-accent)]/10 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)]' : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]'}`}>
              <span className="flex items-center gap-2">
                <ErpInput
                  type="radio"
                  checked={personnelMode === 'existing'}
                  onChange={() => setPersonnelMode('existing')}
                  className="text-[var(--sds-accent)] focus:ring-[var(--sds-accent)]"
                />
                <span className="font-semibold text-primary">اتصال به پرسنل موجود</span>
              </span>
              <span className="mt-2 block text-sm text-secondary">برای فردی که قبلاً در مدیریت پرسنل ثبت شده است.</span>
            </label>
          </div>
          {personnelMode === 'existing' && (
            <div className="mt-4">
              <label className="block text-sm text-secondary mb-2">پرسنل موجود</label>
              <ErpSelect
                value={selectedPersonnelId}
                  onChange={(event) => {
                    const nextId = event.target.value;
                    setSelectedPersonnelId(nextId);
                  }}
                className="sds-field w-full"
              >
                <option value="">انتخاب پرسنل</option>
                {personnel.filter((person) => !person.user || person.id === selectedPersonnelId).map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.firstName} {person.lastName} - {person.department?.namePersian || 'بدون بخش'}{person.user ? ' (متصل)' : ''}
                  </option>
                ))}
              </ErpSelect>
            </div>
          )}
        </div>

        {/* Review */}
        <div className="sds-workspace-surface p-6">
          <h2 className="text-xl font-bold text-primary mb-4">بازبینی نهایی</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
            <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
              <p className="text-secondary mb-2">کاربر</p>
              <p className="text-primary font-medium">
                {formData.firstName || 'نام'} {formData.lastName || 'نام خانوادگی'}
              </p>
              <p className="text-secondary mt-1">{formData.email || 'ایمیل وارد نشده'}</p>
              <p className="text-secondary mt-2">نقش انتخاب‌شده: {formData.role}</p>
              <p className="text-secondary mt-2">
                پرسنل مرتبط: {personnelMode === 'none' ? 'بدون اتصال؛ قابل تکمیل توسط HR' : personnel.find((person) => person.id === selectedPersonnelId) ? `${personnel.find((person) => person.id === selectedPersonnelId)?.firstName} ${personnel.find((person) => person.id === selectedPersonnelId)?.lastName}` : 'انتخاب نشده'}
              </p>
              {selectedPreset && selectedPreset.recommendedRole !== formData.role && (
                <p className="mt-2 font-medium text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">
                  نقش پیشنهادی این الگو: {selectedPreset.recommendedRole}
                </p>
              )}
            </div>
            <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-4 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
              <p className="text-secondary mb-2">دسترسی‌ها</p>
              {workspacePermissions.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {workspacePermissions.map((permission) => (
                    <span
                      key={permission.workspace}
                      className="rounded-full border border-[var(--sds-accent)]/25 bg-[var(--sds-accent)]/10 px-3 py-1 text-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]"
                    >
                      {getWorkspacePermissionLabel(permission)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3">
                  <p className="font-medium text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">هیچ دسترسی فضای کاری انتخاب نشده است</p>
                  <p className="mt-1 text-[var(--sds-warning)] dark:text-[var(--sds-warning)]">
                    کاربر ایجاد می‌شود، اما تا زمان افزودن دسترسی مستقیم یا نقش مناسب، دسترسی عملی محدودی خواهد داشت.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Submit Buttons */}
        <div className="sds-workspace-surface p-6">
          <div className="flex items-center justify-end space-x-4 space-x-reverse">
            <Link
              href="/dashboard/users"
              className="sds-action px-6 py-2"
            >
              انصراف
            </Link>
            <ErpPressable
              type="submit"
              disabled={loading}
              className="sds-action sds-tone-primary sds-action-solid px-6 py-2 flex items-center space-x-2 space-x-reverse disabled:opacity-50"
            >
              {loading ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-[var(--sds-border-default)]"></div>
              ) : (
                <FaCheck />
              )}
              <span>{loading ? 'در حال ایجاد...' : 'ایجاد کاربر'}</span>
            </ErpPressable>
          </div>
        </div>
      </form>
    </main>
  );
}
