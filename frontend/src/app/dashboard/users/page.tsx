'use client';
import { ErpInput, ErpSelect } from '@/components/erp';
import { useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaBuilding, FaCog, FaDownload, FaEdit, FaEye, FaPlus, FaShieldAlt, FaTimes, FaTrash, FaUserCheck, FaUserTimes, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpListPage, ErpLoading, ErpSection, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { authAPI, departmentsAPI, usersAPI, workspacePermissionsAPI } from '@/lib/api';
import { WORKSPACE_CONFIG } from '@/contexts/WorkspaceContext';

interface User {
  id: string;
  email: string;
  username: string;
  firstName: string;
  lastName: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  creatorDisplayNameSnapshot?: string | null;
  creatorUsernameSnapshot?: string | null;
  createdByUser?: { erasedAt?: string | null } | null;
  department?: {
    id: string;
    name: string;
    namePersian: string;
  };
  profile?: {
    id: string;
    phone: string;
    address: string;
  };
}

interface WorkspacePermission {
  id: string;
  userId: string;
  workspace: string;
  permissionLevel: string;
  isActive: boolean;
  grantedAt: string;
  user: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    username: string;
    role: string;
  };
  granter: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
}

interface RoleWorkspacePermission {
  id: string;
  role: string;
  workspace: string;
  permissionLevel: string;
  isActive: boolean;
}

interface EffectiveWorkspacePermission {
  key: string;
  workspace: string;
  permissionLevel: string;
  source: 'direct' | 'role' | 'admin';
}

interface Department {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  isActive: boolean;
}

export default function UsersManagementPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (pathname !== '/dashboard/users') return;
    const query = searchParams.toString();
    router.replace(`/dashboard/hr/users${query ? `?${query}` : ''}`);
  }, [pathname, router, searchParams]);
  const createdUserId = searchParams.get('createdUserId');
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RoleWorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOperation, setBulkOperation] = useState('DEACTIVATE');
  const [bulkValue, setBulkValue] = useState('');
  const [bulkPreview, setBulkPreview] = useState<any>(null);
  const [bulkResult, setBulkResult] = useState<any>(null);
  const [bulkWorkspacePermissions, setBulkWorkspacePermissions] = useState<Record<string, string>>({});
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deleteError, setDeleteError] = useState('');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    fetchData();
  }, [currentPage, searchTerm, selectedDepartment, selectedRole, selectedStatus]);

  useEffect(() => {
    fetchCurrentUser();
  }, []);

  const fetchCurrentUser = async () => {
    try {
      const response = await authAPI.getMe();
      if (response.data.success) {
        setCurrentUserRole(response.data.data.role);
        setCurrentUserId(response.data.data.id);
      }
    } catch (error) {
      console.error('Error fetching current user:', error);
    }
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      const [usersResponse, departmentsResponse, permissionsResponse, rolePermissionsResponse] = await Promise.all([
        usersAPI.getUsers(currentPage, 10),
        departmentsAPI.getDepartments(),
        workspacePermissionsAPI.getUserPermissions({ page: 1, limit: 1000 }),
        workspacePermissionsAPI.getRolePermissions(),
      ]);

      if (usersResponse.data.success) {
        setUsers(usersResponse.data.data);
        setTotalPages(usersResponse.data.pagination.pages);
      }

      if (departmentsResponse.data.success) {
        setDepartments(departmentsResponse.data.data);
      }

      if (permissionsResponse.data.success) {
        setPermissions(permissionsResponse.data.data);
      }

      if (rolePermissionsResponse.data.success) {
        setRolePermissions(rolePermissionsResponse.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching users data:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteUser = (user: User) => {
    setUserToDelete(user);
    setDeleteConfirmation('');
    setDeleteError('');
    setShowDeleteModal(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete || deleteConfirmation !== userToDelete.username) return;
    try {
      setDeleting(true);
      setDeleteError('');
      await usersAPI.deleteUser(userToDelete.id, deleteConfirmation);
      setShowDeleteModal(false);
      setUserToDelete(null);
      setDeleteConfirmation('');
      await fetchData();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      setDeleteError(error.response?.data?.error || 'خطا در حذف کاربر');
    } finally {
      setDeleting(false);
    }
  };

  const getUserWorkspacePermissions = (userId: string) => permissions.filter((permission) => permission.userId === userId && permission.isActive);

  const getEffectiveWorkspacePermissions = (user: User): EffectiveWorkspacePermission[] => {
    if (user.role === 'ADMIN') {
      return ['sales', 'crm', 'hr', 'accounting', 'inventory', 'security', 'bi', 'logistics'].map((workspace) => ({
        key: `admin-${workspace}`,
        workspace,
        permissionLevel: 'admin',
        source: 'admin',
      }));
    }

    const directPermissions = getUserWorkspacePermissions(user.id);
    const roleDefaults = rolePermissions.filter((permission) => permission.role === user.role && permission.isActive);
    const directWorkspaces = new Set(directPermissions.map((permission) => permission.workspace));

    return [
      ...directPermissions.map((permission) => ({
        key: permission.id,
        workspace: permission.workspace,
        permissionLevel: permission.permissionLevel,
        source: 'direct' as const,
      })),
      ...roleDefaults
        .filter((permission) => !directWorkspaces.has(permission.workspace))
        .map((permission) => ({
          key: permission.id,
          workspace: permission.workspace,
          permissionLevel: permission.permissionLevel,
          source: 'role' as const,
        })),
    ];
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'ADMIN': return 'مدیر';
      case 'USER': return 'کاربر';
      case 'MODERATOR': return 'ناظر';
      case 'SALES': return 'فروش';
      case 'MANAGER': return 'مدیر فروش';
      default: return role;
    }
  };

  const getRoleTone = (role: string): ErpTone => {
    switch (role) {
      case 'ADMIN': return 'danger';
      case 'USER': return 'info';
      case 'MODERATOR': return 'warning';
      case 'SALES': return 'success';
      case 'MANAGER': return 'purple';
      default: return 'neutral';
    }
  };

  const getWorkspaceLabel = (workspace: string) => {
    switch (workspace) {
      case 'sales': return 'فروش';
      case 'crm': return 'CRM';
      case 'hr': return 'منابع انسانی';
      case 'accounting': return 'حسابداری';
      case 'inventory': return 'انبار';
      case 'security': return 'امنیت';
      case 'bi': return 'هوش تجاری';
      case 'logistics': return 'لجستیک';
      default: return workspace;
    }
  };

  const getPermissionLabel = (permission: string) => {
    switch (permission) {
      case 'view': return 'مشاهده';
      case 'edit': return 'ویرایش';
      case 'admin': return 'مدیریت';
      default: return permission;
    }
  };

  const getPermissionSourceLabel = (source: EffectiveWorkspacePermission['source']) => {
    switch (source) {
      case 'direct': return 'مستقیم';
      case 'role': return 'از نقش';
      case 'admin': return 'مدیر سیستم';
      default: return source;
    }
  };

  const getPermissionSourceTone = (source: EffectiveWorkspacePermission['source']): ErpTone => {
    switch (source) {
      case 'direct': return 'primary';
      case 'role': return 'info';
      case 'admin': return 'danger';
      default: return 'neutral';
    }
  };

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesSearch =
        user.firstName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.lastName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        user.username.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesDepartment = !selectedDepartment || user.department?.id === selectedDepartment;
      const matchesRole = !selectedRole || user.role === selectedRole;
      const matchesStatus =
        !selectedStatus ||
        (selectedStatus === 'active' && user.isActive) ||
        (selectedStatus === 'inactive' && !user.isActive);

      return matchesSearch && matchesDepartment && matchesRole && matchesStatus;
    });
  }, [users, searchTerm, selectedDepartment, selectedRole, selectedStatus]);

  const createdUser = createdUserId ? users.find((user) => user.id === createdUserId) : null;

  const metrics: ErpMetric[] = [
    { label: 'کل کاربران', value: users.length.toLocaleString('fa-IR'), icon: FaUsers, tone: 'primary' },
    { label: 'کاربران فعال', value: users.filter((user) => user.isActive).length.toLocaleString('fa-IR'), icon: FaUserCheck, tone: 'success' },
    { label: 'مدیران', value: users.filter((user) => user.role === 'ADMIN').length.toLocaleString('fa-IR'), icon: FaShieldAlt, tone: 'danger' },
    { label: 'کل بخش‌ها', value: departments.length.toLocaleString('fa-IR'), icon: FaBuilding, tone: 'purple' },
  ];

  const columns: ErpColumn<User>[] = [
    {
      id: 'selection',
      header: <ErpInput aria-label="انتخاب همه کاربران" type="checkbox" checked={filteredUsers.length > 0 && filteredUsers.every((item) => selectedIds.includes(item.id))} onChange={(event) => setSelectedIds(event.target.checked ? filteredUsers.map((item) => item.id) : [])} />,
      priority: 'secondary',
      cell: (user) => <ErpInput aria-label={`انتخاب ${user.firstName} ${user.lastName}`} type="checkbox" checked={selectedIds.includes(user.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? Array.from(new Set([...current, user.id])) : current.filter((id) => id !== user.id))} />,
    },
    {
      id: 'user',
      header: 'کاربر',
      priority: 'primary',
      cell: (user) => (
        <div>
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{user.firstName} {user.lastName}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{user.email}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-secondary)]">@{user.username}</p>
        </div>
      ),
    },
    {
      id: 'role',
      header: 'نقش',
      mobileLabel: 'نقش',
      priority: 'secondary',
      cell: (user) => <ErpBadge tone={getRoleTone(user.role)}>{getRoleLabel(user.role)}</ErpBadge>,
    },
    {
      id: 'department',
      header: 'بخش',
      mobileLabel: 'بخش',
      priority: 'meta',
      cell: (user) => user.department ? user.department.namePersian : 'بدون بخش',
    },
    {
      id: 'workspaces',
      header: 'فضاهای کاری',
      mobileLabel: 'فضاهای کاری',
      priority: 'secondary',
      cell: (user) => {
        const userPermissions = getEffectiveWorkspacePermissions(user);
        if (userPermissions.length === 0) {
          return <span className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">بدون دسترسی</span>;
        }
        return (
          <div className="flex max-w-lg flex-wrap gap-1.5">
            {userPermissions.map((permission) => (
              <span key={permission.key} title={`منبع دسترسی: ${getPermissionSourceLabel(permission.source)}`}>
                <ErpBadge tone={getPermissionSourceTone(permission.source)}>
                  {getWorkspaceLabel(permission.workspace)} ({getPermissionLabel(permission.permissionLevel)} - {getPermissionSourceLabel(permission.source)})
                </ErpBadge>
              </span>
            ))}
          </div>
        );
      },
    },
    {
      id: 'status',
      header: 'وضعیت',
      mobileLabel: 'وضعیت',
      priority: 'meta',
      cell: (user) => <ErpBadge tone={user.isActive ? 'success' : 'danger'}>{user.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>,
    },
    {
      id: 'creator',
      header: 'ایجادکننده',
      mobileLabel: 'ایجادکننده',
      priority: 'meta',
      cell: (user) => user.creatorDisplayNameSnapshot
        ? <span>{user.createdByUser?.erasedAt ? `کاربر حذف‌شده — ${user.creatorDisplayNameSnapshot}` : `${user.creatorDisplayNameSnapshot}${user.creatorUsernameSnapshot ? ` (@${user.creatorUsernameSnapshot})` : ''}`}</span>
        : <ErpBadge tone="warning">نامشخص — داده تاریخی</ErpBadge>,
    },
    {
      id: 'createdAt',
      header: 'تاریخ ایجاد',
      mobileLabel: 'تاریخ ایجاد',
      priority: 'hidden-mobile',
      cell: (user) => new Date(user.createdAt).toLocaleDateString('fa-IR'),
    },
  ];

  if (loading) {
    return <ErpLoading />;
  }

  if (error) {
    return (
      <ErpEmptyState
        icon={FaUsers}
        title="خطا در بارگذاری"
        description={error}
        action={{ label: 'تلاش مجدد', onClick: fetchData, variant: 'solid', tone: 'primary' }}
      />
    );
  }

  return (
    <>
      <ErpListPage
        eyebrow="مدیریت سیستم"
        title="مدیریت کاربران"
        metrics={metrics}
        actions={[
          { label: 'کاربر جدید', href: '/dashboard/hr/users/create', icon: FaPlus, tone: 'primary', variant: 'solid' },
          { label: 'مدیریت بخش‌ها', href: '/dashboard/departments', icon: FaBuilding, tone: 'neutral', variant: 'outline' },
          { label: 'صادرات', icon: FaDownload, tone: 'neutral', variant: 'ghost', title: 'صادرات' },
        ]}
        filters={[
          {
            id: 'search',
            label: 'جستجو',
            type: 'search',
            value: searchTerm,
            placeholder: 'جستجو در نام، ایمیل یا نام کاربری...',
            onChange: setSearchTerm,
          },
          {
            id: 'department',
            label: 'بخش',
            type: 'select',
            value: selectedDepartment,
            onChange: setSelectedDepartment,
            options: [
              { label: 'همه بخش‌ها', value: '' },
              ...departments.map((department) => ({ label: department.namePersian, value: department.id })),
            ],
          },
          {
            id: 'role',
            label: 'نقش',
            type: 'select',
            value: selectedRole,
            onChange: setSelectedRole,
            options: [
              { label: 'همه نقش‌ها', value: '' },
              { label: 'مدیر', value: 'ADMIN' },
              { label: 'مدیر فروش', value: 'MANAGER' },
              { label: 'فروش', value: 'SALES' },
              { label: 'کاربر', value: 'USER' },
              { label: 'ناظر', value: 'MODERATOR' },
            ],
          },
          {
            id: 'status',
            label: 'وضعیت',
            type: 'select',
            value: selectedStatus,
            onChange: setSelectedStatus,
            options: [
              { label: 'همه وضعیت‌ها', value: '' },
              { label: 'فعال', value: 'active' },
              { label: 'غیرفعال', value: 'inactive' },
            ],
          },
        ]}
        rows={filteredUsers}
        rowKey={(user) => user.id}
        columns={columns}
        rowActions={(user) => {
          const disableAdminActions = currentUserRole === 'MANAGER' && user.role === 'ADMIN';
          const disableDelete = currentUserRole !== 'ADMIN' || user.id === currentUserId;
          return [
            { label: 'مشاهده جزئیات', href: `/dashboard/hr/users/${user.id}`, icon: FaEye, title: 'مشاهده جزئیات' },
            { label: 'ویرایش', href: `/dashboard/hr/users/${user.id}/edit`, icon: FaEdit, disabled: disableAdminActions, title: disableAdminActions ? 'دسترسی برای مدیر فروش محدود است' : 'ویرایش' },
            { label: 'مدیریت دسترسی‌ها', href: `/dashboard/hr/permissions?userId=${user.id}`, icon: FaCog, disabled: disableAdminActions, title: disableAdminActions ? 'دسترسی برای مدیر فروش محدود است' : 'مدیریت دسترسی‌ها' },
            { label: 'حذف حساب استفاده‌نشده', onClick: () => handleDeleteUser(user), icon: FaTrash, tone: 'danger', disabled: disableDelete, title: user.id === currentUserId ? 'حذف حساب فعلی مجاز نیست' : currentUserRole !== 'ADMIN' ? 'فقط مدیر سیستم می‌تواند حساب را حذف کند' : 'حذف قطعی فقط در صورت نداشتن سابقه عملیاتی' },
          ];
        }}
        emptyState={<ErpEmptyState icon={FaUserTimes} title="هیچ کاربری یافت نشد" description="عبارت جستجو یا فیلترها را تغییر دهید." />}
        footer={
          totalPages > 1 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                صفحه {currentPage.toLocaleString('fa-IR')} از {totalPages.toLocaleString('fa-IR')}
              </span>
              <div className="flex items-center gap-2">
                <ErpButton label="قبلی" onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))} disabled={currentPage === 1} tone="neutral" variant="outline" />
                <ErpButton label="بعدی" onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))} disabled={currentPage === totalPages} tone="neutral" variant="outline" />
              </div>
            </div>
          ) : null
        }
      >
        <ErpSection title="عملیات گروهی کاربران" description="اجرای نهایی فقط پس از پیش‌نمایش و بررسی تعارض‌ها انجام می‌شود.">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <ErpSelect className="min-h-12 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3" value={bulkOperation} onChange={(e) => { setBulkOperation(e.target.value); setBulkValue(''); setBulkPreview(null); setBulkResult(null); }}><option value="ACTIVATE">فعال‌سازی</option><option value="DEACTIVATE">غیرفعال‌سازی</option><option value="ASSIGN_DEPARTMENT">تخصیص بخش</option>{currentUserRole === 'ADMIN' && <><option value="ASSIGN_ROLE">تخصیص نقش</option><option value="APPLY_WORKSPACE_PERMISSIONS">اعمال دسترسی فضاهای کاری</option></>}</ErpSelect>
            {bulkOperation === 'ASSIGN_DEPARTMENT' && <ErpSelect className="min-h-12 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="">بدون بخش</option>{departments.map((item) => <option key={item.id} value={item.id}>{item.namePersian}</option>)}</ErpSelect>}
            {bulkOperation === 'ASSIGN_ROLE' && <ErpSelect className="min-h-12 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] px-3" value={bulkValue} onChange={(e) => setBulkValue(e.target.value)}><option value="USER">کاربر</option><option value="SALES">فروش</option><option value="MODERATOR">ناظر</option><option value="MANAGER">مدیر</option><option value="ADMIN">مدیر سیستم</option></ErpSelect>}
            <div className="flex flex-wrap items-center gap-2 md:col-span-2"><ErpBadge tone="info">{selectedIds.length.toLocaleString('fa-IR')} انتخاب</ErpBadge><ErpButton label="پیش‌نمایش" disabled={!selectedIds.length} onClick={async () => { const workspacePermissions = Object.entries(bulkWorkspacePermissions).filter(([, level]) => level).map(([workspace, permissionLevel]) => ({ workspace, permissionLevel })); const response = await usersAPI.previewBulk({ ids: selectedIds, operation: bulkOperation, departmentId: bulkOperation === 'ASSIGN_DEPARTMENT' ? bulkValue || null : undefined, role: bulkOperation === 'ASSIGN_ROLE' ? bulkValue || 'USER' : undefined, workspacePermissions: bulkOperation === 'APPLY_WORKSPACE_PERMISSIONS' ? workspacePermissions : undefined }); setBulkPreview(response.data.data); setBulkResult(null); }} /></div>
          </div>
          {bulkOperation === 'APPLY_WORKSPACE_PERMISSIONS' && <div className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2">{Object.values(WORKSPACE_CONFIG).map((workspace) => <label key={workspace.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><span>{workspace.namePersian}</span><ErpSelect className="rounded-lg border px-2 py-1" value={bulkWorkspacePermissions[workspace.id] || ''} onChange={(event) => setBulkWorkspacePermissions((current) => ({ ...current, [workspace.id]: event.target.value }))}><option value="">بدون دسترسی مستقیم</option><option value="view">مشاهده</option><option value="edit">ویرایش</option><option value="admin">مدیریت</option></ErpSelect></label>)}</div>}
          {bulkPreview && <div className="mt-4 rounded-xl border p-4"><div className="flex flex-wrap gap-2"><ErpBadge tone="success">قابل اجرا: {bulkPreview.eligible.length.toLocaleString('fa-IR')}</ErpBadge><ErpBadge tone="neutral">ردشده: {bulkPreview.skipped.length.toLocaleString('fa-IR')}</ErpBadge><ErpBadge tone="danger">متعارض: {bulkPreview.conflicting.length.toLocaleString('fa-IR')}</ErpBadge></div><div className="mt-3"><ErpButton label="تایید و اجرا" tone="success" disabled={!bulkPreview.eligible.length} onClick={async () => { const response = await usersAPI.executeBulk({ previewToken: bulkPreview.previewToken }); setBulkResult(response.data.data); setBulkPreview(null); setSelectedIds([]); await fetchData(); }} /></div></div>}
          {bulkResult && <div className="mt-4 rounded-xl border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-4"><div className="flex flex-wrap gap-2"><ErpBadge tone="success">اعمال‌شده: {bulkResult.applied.length.toLocaleString('fa-IR')}</ErpBadge><ErpBadge tone="neutral">ردشده: {bulkResult.skipped.length.toLocaleString('fa-IR')}</ErpBadge><ErpBadge tone="danger">متعارض: {bulkResult.conflicting.length.toLocaleString('fa-IR')}</ErpBadge></div><div className="mt-3"><ErpButton label="دانلود نتیجه" icon={FaDownload} variant="outline" onClick={() => { const blob = new Blob([JSON.stringify(bulkResult, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = `user-bulk-${Date.now()}.json`; anchor.click(); URL.revokeObjectURL(url); }} /></div></div>}
        </ErpSection>
        {createdUserId && (
          <ErpCard tone="primary" className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  کاربر {createdUser ? `${createdUser.firstName} ${createdUser.lastName}` : 'جدید'} ایجاد شد
                </p>
                <p className="mt-1 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                  برای موارد خاص، می‌توانید مجوزهای جزئی و استثناها را مدیریت کنید.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ErpButton label="مدیریت استثناها" href={`/dashboard/hr/permissions?userId=${createdUserId}&section=exceptions`} tone="primary" variant="solid" />
                <ErpButton label="بستن" href="/dashboard/hr/users" tone="neutral" variant="outline" />
              </div>
            </div>
          </ErpCard>
        )}
      </ErpListPage>

      {showDeleteModal && userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sds-surface-raised)] p-4 backdrop-blur-sm">
          <ErpSection className="w-full max-w-md">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">تأیید حذف حساب استفاده‌نشده</h2>
              <ErpButton label="بستن" onClick={() => setShowDeleteModal(false)} icon={FaTimes} variant="ghost" tone="neutral" disabled={deleting} />
            </div>
            <p className="text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              حساب <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{userToDelete.firstName} {userToDelete.lastName}</span> فقط در صورتی حذف می‌شود که هیچ سابقه عملیاتی نداشته باشد. برای حساب‌های استفاده‌شده، از صفحه جزئیات و جریان حذف هویت ممیزی‌شده استفاده کنید.
            </p>
            <label className="mt-4 block text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
              برای تأیید، نام کاربری <span dir="ltr" className="font-bold">{userToDelete.username}</span> را وارد کنید.
              <ErpInput
                dir="ltr"
                autoComplete="off"
                value={deleteConfirmation}
                onChange={(event) => setDeleteConfirmation(event.target.value)}
                className="mt-2 w-full rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-left text-sm outline-none focus:border-[var(--sds-danger-border)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]"
              />
            </label>
            {deleteError && <p className="mt-3 rounded-xl bg-[var(--sds-danger-surface)] p-3 text-sm text-[var(--sds-danger)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">{deleteError}</p>}
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ErpButton label={deleting ? 'در حال حذف...' : 'حذف قطعی حساب'} onClick={confirmDeleteUser} tone="danger" variant="solid" disabled={deleting || deleteConfirmation !== userToDelete.username} />
              <ErpButton label="لغو" onClick={() => setShowDeleteModal(false)} tone="neutral" variant="outline" disabled={deleting} />
            </div>
          </ErpSection>
        </div>
      )}
    </>
  );
}
