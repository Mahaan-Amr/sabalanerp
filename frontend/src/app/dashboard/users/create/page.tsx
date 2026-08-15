'use client';
import { ErpBadge, ErpButton, ErpCard, ErpCheckbox, ErpField, ErpInlineState, ErpInput, ErpPage, ErpPressable, ErpSection, ErpSegmentedControl, ErpSelect } from '@/components/erp';
import { useState, useEffect } from 'react';
import {
  FaUserPlus,
  FaShieldAlt,
  FaCheck,
  FaEye,
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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [personnel, setPersonnel] = useState<Personnel[]>([]);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ message: string; userId: string } | null>(null);
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
    setSuccess(null);

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
        setSuccess({
          userId: createdUserId,
          message: `کاربر با موفقیت ایجاد شد${permissionCount > 0 ? ` و ${permissionCount} دسترسی فضای کاری ثبت شد` : ''}.`,
        });
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
    <ErpPage title="ایجاد کاربر جدید" eyebrow="مدیریت کاربران" description="اطلاعات کاربر، نقش و دسترسی‌های سازمانی را تکمیل کنید." backHref="/dashboard/hr/users">
      {error && <ErpInlineState kind="error" title={error} />}
      {success && <ErpInlineState kind="success" title={success.message} action={{ label: 'بازگشت به فهرست کاربران', href: `/dashboard/hr/users?createdUserId=${success.userId}`, tone: 'neutral', variant: 'outline' }} />}
      <form onSubmit={handleSubmit} className="space-y-6">
        <ErpSection title="اطلاعات پایه">
          <div className="grid gap-4 md:grid-cols-2">
            <ErpField label="نام" required><ErpInput name="firstName" value={formData.firstName} onChange={handleInputChange} required /></ErpField>
            <ErpField label="نام خانوادگی" required><ErpInput name="lastName" value={formData.lastName} onChange={handleInputChange} required /></ErpField>
            <ErpField label="ایمیل" required><ErpInput type="email" name="email" value={formData.email} onChange={handleInputChange} dir="ltr" required /></ErpField>
            <ErpField label="نام کاربری" required><ErpInput name="username" value={formData.username} onChange={handleInputChange} required /></ErpField>
            <ErpField label="شماره تماس"><ErpInput type="tel" name="phone" value={formData.phone} onChange={handleInputChange} dir="ltr" /></ErpField>
            <ErpField label="رمز عبور" required><div className="flex gap-2"><ErpInput aria-label="رمز عبور" type={showPassword ? 'text' : 'password'} name="password" value={formData.password} onChange={handleInputChange} required /><ErpButton label={showPassword ? 'پنهان‌کردن رمز' : 'نمایش رمز'} icon={FaEye} variant="ghost" onClick={() => setShowPassword(!showPassword)} /></div></ErpField>
            <ErpField label="تکرار رمز عبور" required><div className="flex gap-2"><ErpInput aria-label="تکرار رمز عبور" type={showConfirmPassword ? 'text' : 'password'} name="confirmPassword" value={formData.confirmPassword} onChange={handleInputChange} required /><ErpButton label={showConfirmPassword ? 'پنهان‌کردن تکرار رمز' : 'نمایش تکرار رمز'} icon={FaEye} variant="ghost" onClick={() => setShowConfirmPassword(!showConfirmPassword)} /></div></ErpField>
          </div>
        </ErpSection>

        <ErpSection title="نقش و دپارتمان">
          <div className="grid gap-4 md:grid-cols-2">
            <ErpField label="نقش"><ErpSelect name="role" value={formData.role} onChange={handleInputChange}><option value="USER">کاربر</option><option value="MODERATOR">ناظر</option><option value="SALES">فروش</option>{currentUserRole !== 'MANAGER' && <><option value="MANAGER">مدیر</option><option value="ADMIN">مدیر سیستم</option></>}</ErpSelect></ErpField>
            <ErpField label="دپارتمان"><ErpSelect name="departmentId" value={formData.departmentId} onChange={handleInputChange}><option value="">انتخاب دپارتمان</option>{departments.map((dept) => <option key={dept.id} value={dept.id}>{dept.namePersian}</option>)}</ErpSelect></ErpField>
          </div>
          <ErpCheckbox className="mt-4" label="کاربر فعال" checked={formData.isActive} onChange={(event) => setFormData((current) => ({ ...current, isActive: event.target.checked }))} />
        </ErpSection>

        <ErpSection title="دسترسی‌های فضای کاری" description="انتخاب‌ها همزمان با ایجاد کاربر ذخیره می‌شوند." actions={workspacePermissions.length ? [{ label: 'پاک‌کردن دسترسی‌ها', tone: 'neutral', variant: 'ghost', onClick: clearWorkspacePermissions }] : []}>
          <h3 className="mb-3 text-sm font-semibold">الگوی دسترسی</h3>
          <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{availablePermissionPresets.map((preset) => <ErpPressable key={preset.id} type="button" aria-pressed={selectedPresetId === preset.id} tone="neutral" variant="outline" onClick={() => applyPermissionPreset(preset.id)}>{selectedPresetId === preset.id ? 'انتخاب‌شده: ' : ''}{preset.label} · نقش {preset.recommendedRole}</ErpPressable>)}</div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Object.values(WORKSPACES).map((workspace) => { const permission = getCurrentPermission(workspace); return <ErpCard key={workspace} className="space-y-3 p-4"><h3 className="font-semibold">{WORKSPACE_LABELS[workspace as keyof typeof WORKSPACE_LABELS]}</h3><ErpSegmentedControl value={permission} onChange={(value) => handleWorkspacePermissionChange(workspace, value)} options={[{ value: 'none', label: 'بدون دسترسی' }, ...availableWorkspacePermissionEntries.map(([, value]) => ({ value, label: PERMISSION_LABELS[value as keyof typeof PERMISSION_LABELS] }))]} /><p className="text-xs text-[var(--sds-text-secondary)]">وضعیت: {permission === 'none' ? 'بدون دسترسی' : PERMISSION_LABELS[permission as keyof typeof PERMISSION_LABELS]}</p></ErpCard>; })}</div>
        </ErpSection>

        <ErpSection title="پرسنل مرتبط" description="حساب کاربری هویت ورود است؛ پرونده پرسنلی معنای سازمانی مستقل خود را حفظ می‌کند.">
          <ErpSegmentedControl value={personnelMode} onChange={(value) => setPersonnelMode(value as 'none' | 'existing')} options={[{ value: 'none', label: 'بدون اتصال پرسنلی' }, { value: 'existing', label: 'اتصال به پرسنل موجود' }]} />
          {personnelMode === 'existing' && <div className="mt-4"><ErpField label="پرسنل موجود" required><ErpSelect value={selectedPersonnelId} onChange={(event) => setSelectedPersonnelId(event.target.value)}><option value="">انتخاب پرسنل</option>{personnel.filter((person) => !person.user || person.id === selectedPersonnelId).map((person) => <option key={person.id} value={person.id}>{person.firstName} {person.lastName} - {person.department?.namePersian || 'بدون بخش'}{person.user ? ' (متصل)' : ''}</option>)}</ErpSelect></ErpField></div>}
        </ErpSection>

        <ErpSection title="بازبینی نهایی">
          <div className="grid gap-4 md:grid-cols-2"><ErpCard className="space-y-2 p-4"><h3 className="font-semibold">کاربر</h3><p>{formData.firstName || 'نام'} {formData.lastName || 'نام خانوادگی'}</p><p className="text-sm text-[var(--sds-text-secondary)]">{formData.email || 'ایمیل وارد نشده'} · نقش {formData.role}</p>{selectedPreset && selectedPreset.recommendedRole !== formData.role && <ErpInlineState kind="stale" title={`نقش پیشنهادی الگو: ${selectedPreset.recommendedRole}`} />}</ErpCard><ErpCard className="p-4"><h3 className="mb-3 font-semibold">دسترسی‌ها</h3>{workspacePermissions.length ? <div className="flex flex-wrap gap-2">{workspacePermissions.map((permission) => <ErpBadge key={permission.workspace} tone="info">{getWorkspacePermissionLabel(permission)}</ErpBadge>)}</div> : <ErpInlineState kind="stale" title="هیچ دسترسی فضای کاری انتخاب نشده است" />}</ErpCard></div>
        </ErpSection>

        <div className="flex flex-wrap justify-end gap-3"><ErpButton label="انصراف" href="/dashboard/hr/users" variant="outline" /><ErpButton type="submit" label={loading ? 'در حال ایجاد...' : 'ایجاد کاربر'} icon={FaUserPlus} disabled={loading} /></div>
      </form>
    </ErpPage>
  );
}
