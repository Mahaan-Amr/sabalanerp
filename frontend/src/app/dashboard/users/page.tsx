'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { FaBuilding, FaCog, FaDownload, FaEdit, FaEye, FaPlus, FaShieldAlt, FaTimes, FaTrash, FaUserCheck, FaUserTimes, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpListPage, ErpLoading, ErpSection, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { authAPI, departmentsAPI, usersAPI, workspacePermissionsAPI } from '@/lib/api';

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
  const searchParams = useSearchParams();
  const createdUserId = searchParams.get('createdUserId');
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [permissions, setPermissions] = useState<WorkspacePermission[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RoleWorkspacePermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [userToDelete, setUserToDelete] = useState<User | null>(null);

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
    setShowDeleteModal(true);
  };

  const confirmDeleteUser = async () => {
    if (!userToDelete) return;

    try {
      await usersAPI.deleteUser(userToDelete.id);
      alert('کاربر با موفقیت حذف شد');
      fetchData();
    } catch (error: any) {
      console.error('Error deleting user:', error);
      alert(error.response?.data?.error || 'خطا در حذف کاربر');
    } finally {
      setShowDeleteModal(false);
      setUserToDelete(null);
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
      id: 'user',
      header: 'کاربر',
      priority: 'primary',
      cell: (user) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{user.firstName} {user.lastName}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{user.email}</p>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">@{user.username}</p>
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
          return <span className="text-xs text-slate-500 dark:text-slate-400">بدون دسترسی</span>;
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
        description="مدیریت کاربران، نقش‌ها، وضعیت حساب و دسترسی‌های موثر در فضاهای کاری ERP."
        metrics={metrics}
        actions={[
          { label: 'کاربر جدید', href: '/dashboard/users/create', icon: FaPlus, tone: 'primary', variant: 'solid' },
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
          return [
            { label: 'مشاهده جزئیات', href: `/dashboard/users/${user.id}`, icon: FaEye, title: 'مشاهده جزئیات' },
            { label: 'ویرایش', href: `/dashboard/users/${user.id}/edit`, icon: FaEdit, disabled: disableAdminActions, title: disableAdminActions ? 'دسترسی برای مدیر فروش محدود است' : 'ویرایش' },
            { label: 'مدیریت دسترسی‌ها', href: `/dashboard/admin/permissions?userId=${user.id}`, icon: FaCog, disabled: disableAdminActions, title: disableAdminActions ? 'دسترسی برای مدیر فروش محدود است' : 'مدیریت دسترسی‌ها' },
            { label: 'حذف', onClick: () => handleDeleteUser(user), icon: FaTrash, tone: 'danger', disabled: disableAdminActions, title: disableAdminActions ? 'دسترسی برای مدیر فروش محدود است' : 'حذف' },
          ];
        }}
        emptyState={<ErpEmptyState icon={FaUserTimes} title="هیچ کاربری یافت نشد" description="عبارت جستجو یا فیلترها را تغییر دهید." />}
        footer={
          totalPages > 1 ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">
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
        {createdUserId && (
          <ErpCard tone="primary" className="p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">
                  کاربر {createdUser ? `${createdUser.firstName} ${createdUser.lastName}` : 'جدید'} ایجاد شد
                </p>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                  برای موارد خاص، می‌توانید مجوزهای جزئی و استثناها را مدیریت کنید.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ErpButton label="مدیریت استثناها" href={`/dashboard/admin/permissions?userId=${createdUserId}&section=exceptions`} tone="primary" variant="solid" />
                <ErpButton label="بستن" href="/dashboard/users" tone="neutral" variant="outline" />
              </div>
            </div>
          </ErpCard>
        )}
      </ErpListPage>

      {showDeleteModal && userToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
          <ErpSection className="w-full max-w-md">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">تایید حذف</h2>
              <ErpButton label="بستن" onClick={() => setShowDeleteModal(false)} icon={FaTimes} variant="ghost" tone="neutral" />
            </div>
            <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
              آیا مطمئن هستید که می‌خواهید کاربر{' '}
              <span className="font-semibold text-slate-900 dark:text-white">
                {userToDelete.firstName} {userToDelete.lastName}
              </span>{' '}
              را حذف کنید؟ این عمل قابل بازگشت نیست.
            </p>
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ErpButton label="حذف" onClick={confirmDeleteUser} tone="danger" variant="solid" />
              <ErpButton label="لغو" onClick={() => setShowDeleteModal(false)} tone="neutral" variant="outline" />
            </div>
          </ErpSection>
        </div>
      )}
    </>
  );
}
