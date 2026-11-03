'use client';
import { useEffect, useMemo, useState } from 'react';
import { FaBuilding, FaCheck, FaDownload, FaEdit, FaEye, FaPlus, FaTimes, FaTrash, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpListPage, ErpLoading, ErpSection, type ErpColumn, type ErpMetric } from '@/components/erp';
import { departmentsAPI } from '@/lib/api';

interface Department {
  id: string;
  name: string;
  namePersian: string;
  description: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: {
    users: number;
  };
}

export default function DepartmentsManagementPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedStatus, setSelectedStatus] = useState('');
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [departmentToDelete, setDepartmentToDelete] = useState<Department | null>(null);

  useEffect(() => {
    fetchDepartments();
  }, []);

  const fetchDepartments = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await departmentsAPI.getDepartments();
      if (response.data.success) {
        setDepartments(response.data.data);
      }
    } catch (error: any) {
      console.error('Error fetching departments:', error);
      setError(error.response?.data?.error || 'خطا در دریافت دپارتمان‌ها');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteDepartment = (department: Department) => {
    setDepartmentToDelete(department);
    setShowDeleteModal(true);
  };

  const confirmDeleteDepartment = async () => {
    if (!departmentToDelete) return;

    try {
      await departmentsAPI.deleteDepartment(departmentToDelete.id);
      alert('دپارتمان با موفقیت حذف شد');
      fetchDepartments();
    } catch (error: any) {
      console.error('Error deleting department:', error);
      alert(error.response?.data?.error || 'خطا در حذف دپارتمان');
    } finally {
      setShowDeleteModal(false);
      setDepartmentToDelete(null);
    }
  };

  const filteredDepartments = useMemo(() => {
    return departments.filter((department) => {
      const matchesSearch =
        department.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        department.namePersian.includes(searchTerm) ||
        department.description.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus =
        !selectedStatus ||
        (selectedStatus === 'active' && department.isActive) ||
        (selectedStatus === 'inactive' && !department.isActive);

      return matchesSearch && matchesStatus;
    });
  }, [departments, searchTerm, selectedStatus]);

  const metrics: ErpMetric[] = [
    { label: 'کل دپارتمان‌ها', value: departments.length.toLocaleString('fa-IR'), icon: FaBuilding, tone: 'primary' },
    { label: 'فعال', value: departments.filter((department) => department.isActive).length.toLocaleString('fa-IR'), icon: FaCheck, tone: 'success' },
    { label: 'غیرفعال', value: departments.filter((department) => !department.isActive).length.toLocaleString('fa-IR'), icon: FaTimes, tone: 'danger' },
    { label: 'کل کاربران', value: departments.reduce((sum, department) => sum + (department._count?.users || 0), 0).toLocaleString('fa-IR'), icon: FaUsers, tone: 'purple' },
  ];

  const columns: ErpColumn<Department>[] = [
    {
      id: 'name',
      header: 'نام انگلیسی',
      priority: 'primary',
      cell: (department) => (
        <div>
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{department.name}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{department.namePersian}</p>
        </div>
      ),
    },
    {
      id: 'description',
      header: 'توضیحات',
      mobileLabel: 'توضیحات',
      priority: 'secondary',
      cell: (department) => <span className="line-clamp-2 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{department.description || 'بدون توضیح'}</span>,
    },
    {
      id: 'users',
      header: 'تعداد کاربران',
      mobileLabel: 'کاربران',
      priority: 'meta',
      align: 'center',
      cell: (department) => (
        <span className="inline-flex items-center gap-2 text-sm">
          <FaUsers className="h-4 w-4 text-[var(--sds-text-muted)]" />
          {(department._count?.users || 0).toLocaleString('fa-IR')}
        </span>
      ),
    },
    {
      id: 'status',
      header: 'وضعیت',
      mobileLabel: 'وضعیت',
      priority: 'meta',
      cell: (department) => <ErpBadge tone={department.isActive ? 'success' : 'danger'}>{department.isActive ? 'فعال' : 'غیرفعال'}</ErpBadge>,
    },
    {
      id: 'createdAt',
      header: 'تاریخ ایجاد',
      mobileLabel: 'تاریخ ایجاد',
      priority: 'hidden-mobile',
      cell: (department) => new Date(department.createdAt).toLocaleDateString('fa-IR'),
    },
  ];

  if (loading) {
    return <ErpLoading />;
  }

  if (error) {
    return (
      <ErpEmptyState
        icon={FaBuilding}
        title="خطا در بارگذاری"
        description={error}
        action={{ label: 'تلاش دوباره', onClick: fetchDepartments, variant: 'solid', tone: 'primary' }}
      />
    );
  }

  return (
    <>
      <ErpListPage
        eyebrow="مدیریت سازمان"
        title="مدیریت دپارتمان‌ها"
        metrics={metrics}
        actions={[
          { label: 'دپارتمان جدید', href: '/dashboard/departments/create', icon: FaPlus, tone: 'primary', variant: 'solid' },
          { label: 'مدیریت کاربران', href: '/dashboard/hr/users', icon: FaUsers, tone: 'neutral', variant: 'outline' },
          { label: 'دانلود', icon: FaDownload, tone: 'neutral', variant: 'ghost', title: 'دانلود' },
        ]}
        filters={[
          {
            id: 'search',
            label: 'جستجو',
            type: 'search',
            value: searchTerm,
            placeholder: 'جستجو بر اساس نام یا توضیحات...',
            onChange: setSearchTerm,
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
        rows={filteredDepartments}
        rowKey={(department) => department.id}
        columns={columns}
        rowActions={(department) => [
          { label: 'مشاهده جزئیات', href: `/dashboard/departments/${department.id}`, icon: FaEye, title: 'مشاهده جزئیات' },
          { label: 'ویرایش', href: `/dashboard/departments/${department.id}/edit`, icon: FaEdit, title: 'ویرایش' },
          { label: 'حذف', onClick: () => handleDeleteDepartment(department), icon: FaTrash, tone: 'danger', title: 'حذف' },
        ]}
        emptyState={<ErpEmptyState icon={FaBuilding} title="دپارتمانی یافت نشد" description="عبارت جستجو یا فیلتر وضعیت را تغییر دهید." />}
      />

      {showDeleteModal && departmentToDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sds-surface-raised)] p-4 backdrop-blur-sm">
          <ErpSection className="w-full max-w-md">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">حذف دپارتمان</h2>
              <ErpButton label="بستن" onClick={() => setShowDeleteModal(false)} icon={FaTimes} variant="ghost" tone="neutral" />
            </div>
            <p className="text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              آیا از حذف دپارتمان <span className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{departmentToDelete.namePersian}</span> مطمئن هستید؟
              این عملیات قابل بازگشت نیست.
            </p>
            {departmentToDelete._count?.users && departmentToDelete._count.users > 0 && (
              <div className="mt-4 rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-4 text-sm leading-6 text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                این دپارتمان دارای {departmentToDelete._count.users.toLocaleString('fa-IR')} کاربر است. برای حذف، ابتدا کاربران را به دپارتمان دیگری منتقل کنید.
              </div>
            )}
            <div className="mt-6 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <ErpButton
                label="حذف"
                onClick={confirmDeleteDepartment}
                disabled={!!(departmentToDelete._count?.users && departmentToDelete._count.users > 0)}
                tone="danger"
                variant="solid"
              />
              <ErpButton label="انصراف" onClick={() => setShowDeleteModal(false)} tone="neutral" variant="outline" />
            </div>
          </ErpSection>
        </div>
      )}
    </>
  );
}
