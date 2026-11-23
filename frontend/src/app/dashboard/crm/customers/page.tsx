'use client';
import { CustomerActivityCategoryBadge } from '@/features/crm/customer-workflow/CustomerActivityCategory';
import { useEffect, useRef, useState } from 'react';
import { FaBan, FaBuilding, FaCheckCircle, FaEdit, FaEnvelope, FaExclamationTriangle, FaEye, FaLock, FaMapMarkerAlt, FaPhone, FaPlus, FaTrash, FaUser, FaUsers } from 'react-icons/fa';
import { ErpBadge, ErpButton, ErpEmptyState, ErpFieldView, ErpListPage, ErpInlineState, type ErpColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { crmAPI, dashboardAPI } from '@/lib/api';
import { CustomerPermanentDeletion } from '@/features/crm/customer-workflow/CustomerPermanentDeletion';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { getCrmPermissions } from '@/lib/permissions';

interface CrmCustomer {
  id: string;
  firstName: string;
  lastName: string;
  companyName?: string;
  activityCategory?: string | null;
  customerType: string;
  status: string;
  nationalCode?: string;
  projectManagerName?: string;
  projectManagerNumber?: string;
  brandName?: string;
  isBlacklisted: boolean;
  isLocked: boolean;
  primaryContact?: { firstName: string; lastName: string; email?: string };
  projectCount?: number;
  projectAddresses?: { id: string }[];
  phoneNumbers: { number: string; isPrimary: boolean }[];
  trustCategory?: string;
  partnerOwnerProfileId?: string | null;
  managementReadOnly?: boolean;
  canManageCustomerCard?: boolean;
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
  trustCategory: string;
  ownership: string;
  search: string;
  status: string;
  customerType: string;
  isBlacklisted: boolean | null;
  isLocked: boolean | null;
}

const statusTone: Record<string, ErpTone> = {
  Active: 'success',
  Inactive: 'neutral',
  Prospect: 'info',
  Lead: 'warning',
};

export default function CustomersPage() {
  const [deletionId, setDeletionId] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [management, setManagement] = useState({ canViewAllCustomers: false, canDeleteCustomers: false });
  const [summary, setSummary] = useState({ blacklisted: 0, locked: 0 });
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [canCreateCustomers, setCanCreateCustomers] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const lastRequestedSearch = useRef<string>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<CustomerFilters>({
    ownership: '',
    search: '',
    status: '',
    customerType: '',
      trustCategory: '',
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
    let active = true;
    dashboardAPI.getProfile().then(response => {
      if (active && response.data.success) {
        setCanCreateCustomers(getCrmPermissions(response.data.data).canCreateCustomers);
      }
    }).catch(error => { if (active) console.error('Error loading user profile:', error); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = {
      page: pagination.page,
      limit: pagination.limit,
      search: filters.search.trim() || undefined,
      status: filters.status || undefined,
      customerType: filters.customerType || undefined,
      trustCategory: filters.trustCategory || undefined,
      ownership: filters.ownership || undefined,
      isBlacklisted: filters.isBlacklisted ?? undefined,
      isLocked: filters.isLocked ?? undefined,
      view: 'directory' as const,
    };

    async function fetchCustomers() {
      try {
        const { data } = await crmAPI.getCustomers(params, controller.signal);
        if (controller.signal.aborted) return;
        if (!data.success) throw new Error('Customer directory request failed');

        // Older API deployments report totals but omit the restriction summary.
        let restrictionSummary = data.summary;
        if (!restrictionSummary) {
          const [blacklisted, locked] = await Promise.all([
            crmAPI.getCustomers({ ...params, page: 1, limit: 1, isBlacklisted: true }, controller.signal),
            crmAPI.getCustomers({ ...params, page: 1, limit: 1, isLocked: true }, controller.signal),
          ]);
          restrictionSummary = { blacklisted: blacklisted.data.pagination.total, locked: locked.data.pagination.total };
        }
        if (controller.signal.aborted) return;

        setManagement(data.permissions || { canViewAllCustomers: false, canDeleteCustomers: false });
        setSummary(restrictionSummary);
        setCustomers((data.data as CrmCustomer[]).filter(customer =>
          (filters.isBlacklisted === null || customer.isBlacklisted === filters.isBlacklisted)
          && (filters.isLocked === null || customer.isLocked === filters.isLocked),
        ));
        setPagination(previous => ({ ...previous, total: data.pagination.total, pages: data.pagination.pages }));
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error('Error fetching customers:', error);
          setError('خطا در بارگذاری مشتریان');
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    setLoading(true);
    setError(null);
    const delay = params.search && params.search !== lastRequestedSearch.current ? 180 : 0;
    const timer = window.setTimeout(() => {
      lastRequestedSearch.current = params.search;
      void fetchCustomers();
    }, delay);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [filters, pagination.page, pagination.limit, refresh]);

  const refreshCustomers = () => setRefresh(previous => previous + 1);

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
        refreshCustomers();
      }
    } catch (error) {
      console.error('Error toggling blacklist:', error);
    }
  };

  const handleToggleLock = async (customerId: string) => {
    try {
      const response = await crmAPI.toggleLock(customerId);
      if (response.data.success) {
        refreshCustomers();
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
      case 'Collaborative': return 'همکاری';
      default: return type;
    }
  };

  const getOwnerLabel = (customer: CrmCustomer) => {
    const ownerName = [customer.ownerUser?.firstName, customer.ownerUser?.lastName].filter(Boolean).join(' ').trim();
    return ownerName || customer.ownerUser?.username || 'بدون مسئول فروش';
  };

  const clearFilters = () => {
    setFilters({
      ownership: '',
    search: '',
      status: '',
      customerType: '',
      trustCategory: '',
      isBlacklisted: null,
      isLocked: null,
    });
    setPagination((prev) => ({ ...prev, page: 1 }));
  };

  const metrics: ErpMetric[] = [
    { label: 'کل نتایج', value: pagination.total.toLocaleString('fa-IR'), icon: FaUsers, tone: 'primary' },
    { label: 'نمایش فعلی', value: customers.length.toLocaleString('fa-IR'), icon: FaBuilding, tone: 'info' },
    { label: 'بلک‌لیست', value: summary.blacklisted.toLocaleString('fa-IR'), icon: FaBan, tone: 'danger', onClick: () => handleFilterChange('isBlacklisted', true) },
    { label: 'قفل‌شده', value: summary.locked.toLocaleString('fa-IR'), icon: FaLock, tone: 'warning', onClick: () => handleFilterChange('isLocked', true) },
  ];

  const columns: ErpColumn<CrmCustomer>[] = [
    {
      id: 'customer',
      header: 'مشتری',
      priority: 'primary',
      cell: (customer) => (
        <div>
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{customer.firstName} {customer.lastName}</p>
          {customer.companyName && <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{customer.companyName}</p>}
          <ErpBadge tone="neutral">{customer.partnerOwnerProfileId ? 'همکار فروش' : 'داخلی'}</ErpBadge>
          {!customer.partnerOwnerProfileId && <ErpBadge tone={customer.trustCategory === 'SPECIAL' ? 'purple' : 'neutral'}>{customer.trustCategory === 'SPECIAL' ? 'مشتری خاص' : 'مشتری عادی'}</ErpBadge>}
          <p className="mt-1 text-xs text-[var(--sds-info)] dark:text-[var(--sds-info)]">مسئول فروش: {getOwnerLabel(customer)}</p>
          {customer.nationalCode && <p className="mt-1 text-xs text-[var(--sds-text-muted)] dark:text-[var(--sds-text-secondary)]">کد ملی: {customer.nationalCode}</p>}
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
          <CustomerActivityCategoryBadge value={customer.activityCategory} />
        </div>
      ),
    },
    {
      id: 'contact',
      header: 'اطلاعات تماس',
      mobileLabel: 'تماس',
      priority: 'secondary',
      cell: (customer) => (
        <div className="space-y-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
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
      cell: (customer) => {
        const projectCount = customer.projectCount ?? customer.projectAddresses?.length ?? 0;
        return <div className="space-y-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
          {customer.projectManagerName && <p className="flex items-center gap-1"><FaUser className="h-3 w-3" />مدیر پروژه: {customer.projectManagerName}</p>}
          {projectCount > 0 && <p className="flex items-center gap-1"><FaMapMarkerAlt className="h-3 w-3" />{projectCount.toLocaleString('fa-IR')} پروژه</p>}
          {customer.brandName && <p className="flex items-center gap-1"><FaBuilding className="h-3 w-3" />برند: {customer.brandName}</p>}
        </div>;
      },
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
          {!customer.isBlacklisted && !customer.isLocked && <span className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">بدون محدودیت</span>}
        </div>
      ),
    },
  ];

  if (error) {
    return (
      <ErpEmptyState
        icon={FaExclamationTriangle}
        title="خطا در دریافت اطلاعات"
        description={error}
        action={{ label: 'تلاش مجدد', onClick: refreshCustomers, variant: 'solid', tone: 'primary' }}
      />
    );
  }

  return (
    <>
    {receiptId && <ErpInlineState kind="success" title={`مشتری حذف شد. رسید حذف: ${receiptId}`} />}
    <ErpListPage
      eyebrow="ارتباط با مشتری"
      title="مدیریت مشتریان"
      metrics={metrics}
      actions={canCreateCustomers ? [{ label: 'مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaPlus, tone: 'primary', variant: 'solid' }] : []}
      filters={[
        ...(management.canViewAllCustomers ? [{ id: 'ownership', label: 'مالکیت', type: 'select' as const, value: filters.ownership,
          onChange: (value: string) => handleFilterChange('ownership', value), options: [
            { label: 'همه مشتریان', value: '' }, { label: 'داخلی', value: 'internal' }, { label: 'همکار فروش', value: 'partner' },
          ] }] : []),
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
          id: 'trustCategory', label: 'دسته مشتری', type: 'select', value: filters.trustCategory,
          onChange: (value) => handleFilterChange('trustCategory', value),
          options: [{ label: 'همه دسته‌ها', value: '' }, { label: 'مشتریان عادی', value: 'NORMAL' }, { label: 'مشتریان خاص', value: 'SPECIAL' }],
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
            { label: 'همکاری', value: 'Collaborative' },
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
        {
          id: 'lock',
          label: 'قفل',
          type: 'select',
          value: filters.isLocked === null ? '' : filters.isLocked.toString(),
          onChange: (value) => handleFilterChange('isLocked', value === '' ? null : value === 'true'),
          options: [
            { label: 'همه وضعیت‌های قفل', value: '' },
            { label: 'بدون قفل', value: 'false' },
            { label: 'قفل‌شده', value: 'true' },
          ],
        },
      ]}
      isLoading={loading}
      rows={customers}
      rowKey={(customer) => customer.id}
      columns={columns}
      rowActions={(customer) => [
        ...(management.canDeleteCustomers ? [{ label: 'حذف دائمی', onClick: () => { setReceiptId(null); setDeletionId(customer.id); }, icon: FaTrash, tone: 'danger' as ErpTone, title: 'حذف دائمی' }] : []),
        { label: 'مشاهده مشتری', href: `/dashboard/crm/customers/${customer.id}`, icon: FaEye, title: 'مشاهده مشتری' },
        ...((!customer.managementReadOnly || customer.canManageCustomerCard) && hasPermission('crm' as any, 'edit' as any) ? [{ label: 'ویرایش', href: `/dashboard/crm/customers/${customer.id}/edit`, icon: FaEdit, title: 'ویرایش' }] : []),
        ...((!customer.managementReadOnly || customer.canManageCustomerCard) && hasPermission('crm' as any, 'admin' as any)
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
          action={canCreateCustomers ? { label: 'افزودن مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaPlus, tone: 'primary', variant: 'solid' } : undefined}
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
              <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                نمایش {(((pagination.page - 1) * pagination.limit) + 1).toLocaleString('fa-IR')} تا {Math.min(pagination.page * pagination.limit, pagination.total).toLocaleString('fa-IR')} از {pagination.total.toLocaleString('fa-IR')} مشتری
              </span>
              <div className="flex items-center gap-2">
                <ErpButton label="قبلی" onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))} disabled={pagination.page === 1} tone="neutral" variant="outline" />
                <span className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                  صفحه {pagination.page.toLocaleString('fa-IR')} از {pagination.pages.toLocaleString('fa-IR')}
                </span>
                <ErpButton label="بعدی" onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))} disabled={pagination.page === pagination.pages} tone="neutral" variant="outline" />
              </div>
            </div>
          )}
        </div>
      }
    />
    <CustomerPermanentDeletion customerId={deletionId} onClose={() => setDeletionId(null)} onDeleted={receipt => { setDeletionId(null); setReceiptId(receipt); refreshCustomers(); }} />
    </>
  );
}
