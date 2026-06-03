'use client';

import { useEffect, useState } from 'react';
import { FaBan, FaBuilding, FaCheckCircle, FaEdit, FaEnvelope, FaExclamationTriangle, FaEye, FaLock, FaMapMarkerAlt, FaPhone, FaPlus, FaUser, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpFieldView, ErpListPage, ErpLoading, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { crmAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getCrmPermissions, User as PermissionUser } from '@/lib/permissions';

interface CrmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  customerType: string;
  status: string;
  nationalCode?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
  brandName?: string;
  isBlacklisted: boolean;
  isLocked: boolean;
  primaryContact?: {
    id: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone?: string;
  };
  projectAddresses: Array<{
    id: string;
    address: string;
    city: string;
    projectName?: string;
    projectType?: string;
    isActive: boolean;
  }>;
  phoneNumbers: Array<{
    id: string;
    number: string;
    type: string;
    isPrimary: boolean;
    isActive: boolean;
  }>;
  ownerUserId?: string | null;
  ownerUser?: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    username?: string | null;
  } | null;
  createdAt: string;
  updatedAt: string;
}

interface CustomerFilters {
  search: string;
  status: string;
  customerType: string;
  isBlacklisted: boolean | null;
  isLocked: boolean | null;
}

interface User extends PermissionUser {}

const statusTone: Record<string, ErpTone> = {
  Active: 'success',
  Inactive: 'neutral',
  Prospect: 'info',
  Lead: 'warning',
};

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [crmPermissions, setCrmPermissions] = useState({
    canViewCustomers: false,
    canCreateCustomers: false,
    canEditCustomers: false,
    canDeleteCustomers: false,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CustomerFilters>({
    search: '',
    status: '',
    customerType: '',
    isBlacklisted: null,
    isLocked: null,
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0,
  });
  const { hasPermission } = useWorkspace();

  useEffect(() => {
    fetchCustomers();
    loadCurrentUser();
  }, [filters, pagination.page]);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user: User = response.data.data;
        setCrmPermissions(getCrmPermissions(user));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const fetchCustomers = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {
        page: pagination.page,
        limit: pagination.limit,
        search: filters.search || undefined,
        status: filters.status || undefined,
        customerType: filters.customerType || undefined,
      };

      const response = await crmAPI.getCustomers(params);

      if (response.data.success) {
        let filteredCustomers = response.data.data;

        if (filters.isBlacklisted !== null) {
          filteredCustomers = filteredCustomers.filter((customer: CrmCustomer) => customer.isBlacklisted === filters.isBlacklisted);
        }

        if (filters.isLocked !== null) {
          filteredCustomers = filteredCustomers.filter((customer: CrmCustomer) => customer.isLocked === filters.isLocked);
        }

        setCustomers(filteredCustomers);
        setPagination((prev) => ({
          ...prev,
          total: response.data.pagination.total,
          pages: response.data.pagination.pages,
        }));
      } else {
        setError('خطا در بارگذاری مشتریان');
      }
    } catch (error: any) {
      console.error('Error fetching customers:', error);
      setError('خطا در بارگذاری مشتریان');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (value: string) => {
    setFilters((prev) => ({ ...prev, search: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleFilterChange = (key: keyof CustomerFilters, value: any) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const handleToggleBlacklist = async (customerId: string) => {
    try {
      const response = await crmAPI.toggleBlacklist(customerId);
      if (response.data.success) {
        fetchCustomers();
      }
    } catch (error) {
      console.error('Error toggling blacklist:', error);
    }
  };

  const handleToggleLock = async (customerId: string) => {
    try {
      const response = await crmAPI.toggleLock(customerId);
      if (response.data.success) {
        fetchCustomers();
      }
    } catch (error) {
      console.error('Error toggling lock:', error);
    }
  };

  const getStatusLabel = (status: string) => {
    switch (status) {
      case 'Active': return 'فعال';
      case 'Inactive': return 'غیرفعال';
      case 'Prospect': return 'بالقوه';
      case 'Lead': return 'سرنخ';
      default: return status;
    }
  };

  const getCustomerTypeLabel = (type: string) => {
    switch (type) {
      case 'Individual': return 'حقیقی';
      case 'Company': return 'حقوقی';
      case 'Government': return 'دولتی';
      default: return type;
    }
  };

  const getOwnerLabel = (customer: CrmCustomer) => {
    const ownerName = [customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ').trim();
    return ownerName || customer.ownerUser?.username || 'بدون مسئول فروش';
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: '',
      customerType: '',
      isBlacklisted: null,
      isLocked: null,
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const metrics: ErpMetric[] = [
    { label: 'کل نتایج', value: pagination.total.toLocaleString('fa-IR'), icon: FaUsers, tone: 'primary' },
    { label: 'نمایش فعلی', value: customers.length.toLocaleString('fa-IR'), icon: FaBuilding, tone: 'info' },
    { label: 'بلک‌لیست', value: customers.filter((customer) => customer.isBlacklisted).length.toLocaleString('fa-IR'), icon: FaBan, tone: 'danger' },
    { label: 'قفل‌شده', value: customers.filter((customer) => customer.isLocked).length.toLocaleString('fa-IR'), icon: FaLock, tone: 'warning' },
  ];

  const columns: ErpColumn<CrmCustomer>[] = [
    {
      id: 'customer',
      header: 'مشتری',
      priority: 'primary',
      cell: (customer) => (
        <div>
          <p className="font-semibold text-slate-900 dark:text-white">{customer.firstName} {customer.lastName}</p>
          {customer.companyName && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{customer.companyName}</p>}
          <p className="mt-1 text-xs text-purple-600 dark:text-purple-300">مسئول فروش: {getOwnerLabel(customer)}</p>
          {customer.nationalCode && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">کد ملی: {customer.nationalCode}</p>}
        </div>
      ),
    },
    {
      id: 'status',
      header: 'وضعیت',
      mobileLabel: 'وضعیت',
      priority: 'secondary',
      cell: (customer) => (
        <div className="flex flex-wrap gap-1.5">
          <ErpBadge tone={statusTone[customer.status] || 'neutral'}>{getStatusLabel(customer.status)}</ErpBadge>
          <ErpBadge tone="neutral">{getCustomerTypeLabel(customer.customerType)}</ErpBadge>
        </div>
      ),
    },
    {
      id: 'contact',
      header: 'اطلاعات تماس',
      mobileLabel: 'تماس',
      priority: 'secondary',
      cell: (customer) => (
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          {customer.primaryContact && (
            <p className="flex items-center gap-1"><FaUser className="h-3 w-3" />{customer.primaryContact.firstName} {customer.primaryContact.lastName}</p>
          )}
          {customer.primaryContact?.email && (
            <p className="flex items-center gap-1"><FaEnvelope className="h-3 w-3" />{customer.primaryContact.email}</p>
          )}
          {customer.phoneNumbers.length > 0 && (
            <p className="flex items-center gap-1"><FaPhone className="h-3 w-3" />{customer.phoneNumbers.find((phone) => phone.isPrimary)?.number || customer.phoneNumbers[0].number}</p>
          )}
        </div>
      ),
    },
    {
      id: 'project',
      header: 'پروژه',
      mobileLabel: 'پروژه',
      priority: 'meta',
      cell: (customer) => (
        <div className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
          {customer.projectManagerName && <p className="flex items-center gap-1"><FaUser className="h-3 w-3" />مدیر پروژه: {customer.projectManagerName}</p>}
          {customer.projectAddresses.length > 0 && <p className="flex items-center gap-1"><FaMapMarkerAlt className="h-3 w-3" />{customer.projectAddresses.length.toLocaleString('fa-IR')} پروژه</p>}
          {customer.brandName && <p className="flex items-center gap-1"><FaBuilding className="h-3 w-3" />برند: {customer.brandName}</p>}
        </div>
      ),
    },
    {
      id: 'flags',
      header: 'نشانگرها',
      mobileLabel: 'نشانگرها',
      priority: 'meta',
      cell: (customer) => (
        <div className="flex flex-wrap gap-1.5">
          {customer.isBlacklisted && <ErpBadge tone="danger">بلک‌لیست</ErpBadge>}
          {customer.isLocked && <ErpBadge tone="warning">قفل‌شده</ErpBadge>}
          {!customer.isBlacklisted && !customer.isLocked && <span className="text-xs text-slate-500 dark:text-slate-400">بدون محدودیت</span>}
        </div>
      ),
    },
  ];

  if (loading) {
    return <ErpLoading />;
  }

  if (error) {
    return (
      <ErpEmptyState
        icon={FaExclamationTriangle}
        title="خطا در دریافت اطلاعات"
        description={error}
        action={{ label: 'تلاش مجدد', onClick: fetchCustomers, variant: 'solid', tone: 'primary' }}
      />
    );
  }

  return (
    <ErpListPage
      eyebrow="CRM"
      title="مدیریت مشتریان"
      description="جستجو، بررسی وضعیت همکاری، مشاهده اطلاعات تماس و مدیریت محدودیت‌های مشتریان."
      metrics={metrics}
      actions={crmPermissions.canCreateCustomers ? [{ label: 'مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaPlus, tone: 'primary', variant: 'solid' }] : []}
      filters={[
        {
          id: 'search',
          label: 'جستجو',
          type: 'search',
          value: filters.search,
          placeholder: 'جستجو بر اساس نام، شماره تماس یا شرکت...',
          onChange: handleSearch,
        },
        {
          id: 'status',
          label: 'وضعیت',
          type: 'select',
          value: filters.status,
          onChange: (value) => handleFilterChange('status', value),
          options: [
            { label: 'همه وضعیت‌ها', value: '' },
            { label: 'فعال', value: 'Active' },
            { label: 'غیرفعال', value: 'Inactive' },
            { label: 'بالقوه', value: 'Prospect' },
            { label: 'سرنخ', value: 'Lead' },
          ],
        },
        {
          id: 'customerType',
          label: 'نوع مشتری',
          type: 'select',
          value: filters.customerType,
          onChange: (value) => handleFilterChange('customerType', value),
          options: [
            { label: 'همه انواع', value: '' },
            { label: 'حقیقی', value: 'Individual' },
            { label: 'حقوقی', value: 'Company' },
            { label: 'دولتی', value: 'Government' },
          ],
        },
        {
          id: 'blacklist',
          label: 'بلک‌لیست',
          type: 'select',
          value: filters.isBlacklisted === null ? '' : filters.isBlacklisted.toString(),
          onChange: (value) => handleFilterChange('isBlacklisted', value === '' ? null : value === 'true'),
          options: [
            { label: 'همه', value: '' },
            { label: 'خیر', value: 'false' },
            { label: 'بله', value: 'true' },
          ],
        },
      ]}
      rows={customers}
      rowKey={(customer) => customer.id}
      columns={columns}
      rowActions={(customer) => [
        { label: 'مشاهده مشتری', href: `/dashboard/crm/customers/${customer.id}`, icon: FaEye, title: 'مشاهده مشتری' },
        ...(hasPermission('crm' as any, 'edit' as any) ? [{ label: 'ویرایش', href: `/dashboard/crm/customers/${customer.id}/edit`, icon: FaEdit, title: 'ویرایش' }] : []),
        ...(hasPermission('crm' as any, 'admin' as any)
          ? [
              {
                label: customer.isBlacklisted ? 'حذف از بلک‌لیست' : 'افزودن به بلک‌لیست',
                onClick: () => handleToggleBlacklist(customer.id),
                icon: customer.isBlacklisted ? FaCheckCircle : FaBan,
                tone: customer.isBlacklisted ? 'success' as ErpTone : 'danger' as ErpTone,
                title: customer.isBlacklisted ? 'حذف از بلک‌لیست' : 'افزودن به بلک‌لیست',
              },
              {
                label: customer.isLocked ? 'باز کردن قفل' : 'قفل کردن',
                onClick: () => handleToggleLock(customer.id),
                icon: customer.isLocked ? FaCheckCircle : FaLock,
                tone: customer.isLocked ? 'success' as ErpTone : 'warning' as ErpTone,
                title: customer.isLocked ? 'باز کردن قفل' : 'قفل کردن',
              },
            ]
          : []),
      ]}
      emptyState={
        <ErpEmptyState
          icon={FaUsers}
          title="مشتری یافت نشد"
          description={filters.search || filters.status || filters.customerType || filters.isBlacklisted !== null || filters.isLocked !== null ? 'با این فیلترها نتیجه‌ای پیدا نشد.' : 'هنوز مشتری ثبت نشده است.'}
          action={crmPermissions.canCreateCustomers ? { label: 'افزودن مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaPlus, tone: 'primary', variant: 'solid' } : undefined}
        />
      }
      footer={
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <ErpFieldView label="قفل" value={filters.isLocked === null ? 'همه' : filters.isLocked ? 'بله' : 'خیر'} tone="warning" />
            <ErpFieldView label="بلک‌لیست" value={filters.isBlacklisted === null ? 'همه' : filters.isBlacklisted ? 'بله' : 'خیر'} tone="danger" />
            <div className="flex items-end">
              <ErpButton label="پاک کردن فیلترها" onClick={clearFilters} tone="neutral" variant="outline" />
            </div>
          </div>
          {pagination.pages > 1 && (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="text-sm text-slate-500 dark:text-slate-400">
                نمایش {(((pagination.page - 1) * pagination.limit) + 1).toLocaleString('fa-IR')} تا {Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString('fa-IR')} از {pagination.total.toLocaleString('fa-IR')} مشتری
              </span>
              <div className="flex items-center gap-2">
                <ErpButton label="قبلی" onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))} disabled={pagination.page === 1} tone="neutral" variant="outline" />
                <span className="text-sm text-slate-500 dark:text-slate-400">
                  صفحه {pagination.page.toLocaleString('fa-IR')} از {pagination.pages.toLocaleString('fa-IR')}
                </span>
                <ErpButton label="بعدی" onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))} disabled={pagination.page === pagination.pages} tone="neutral" variant="outline" />
              </div>
            </div>
          )}
        </div>
      }
    />
  );
}
