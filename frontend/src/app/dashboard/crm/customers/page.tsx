'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  FaUsers, 
  FaPlus, 
  FaSearch, 
  FaFilter, 
  FaEye, 
  FaEdit, 
  FaTrash,
  FaPhone,
  FaEnvelope,
  FaMapMarkerAlt,
  FaBuilding,
  FaUser,
  FaExclamationTriangle,
  FaLock,
  FaBan,
  FaCheckCircle,
  FaTimesCircle
} from 'react-icons/fa';
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

export default function CustomersPage() {
  const [customers, setCustomers] = useState<CrmCustomer[]>([]);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
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
    isLocked: null
  });
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 10,
    total: 0,
    pages: 0
  });
  const [showFilters, setShowFilters] = useState(false);
  const { hasPermission } = useWorkspace();

  useEffect(() => {
    fetchCustomers();
    loadCurrentUser();
  }, [filters, pagination.page]);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user = response.data.data;
        setCurrentUser(user);
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
        customerType: filters.customerType || undefined
      };

      const response = await crmAPI.getCustomers(params);
      
      if (response.data.success) {
        let filteredCustomers = response.data.data;
        
        // Apply blacklist/lock filters on frontend (since API doesn't support them yet)
        if (filters.isBlacklisted !== null) {
          filteredCustomers = filteredCustomers.filter((customer: CrmCustomer) => 
            customer.isBlacklisted === filters.isBlacklisted
          );
        }
        
        if (filters.isLocked !== null) {
          filteredCustomers = filteredCustomers.filter((customer: CrmCustomer) => 
            customer.isLocked === filters.isLocked
          );
        }
        
        setCustomers(filteredCustomers);
        setPagination(prev => ({
          ...prev,
          total: response.data.pagination.total,
          pages: response.data.pagination.pages
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
    setFilters(prev => ({ ...prev, search: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleFilterChange = (key: keyof CustomerFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const clearFilters = () => {
    setFilters({
      search: '',
      status: '',
      customerType: '',
      isBlacklisted: null,
      isLocked: null
    });
    setPagination(prev => ({ ...prev, page: 1 }));
  };

  const handleToggleBlacklist = async (customerId: string) => {
    try {
      const response = await crmAPI.toggleBlacklist(customerId);
      if (response.data.success) {
        fetchCustomers(); // Refresh the list
      }
    } catch (error) {
      console.error('Error toggling blacklist:', error);
    }
  };

  const handleToggleLock = async (customerId: string) => {
    try {
      const response = await crmAPI.toggleLock(customerId);
      if (response.data.success) {
        fetchCustomers(); // Refresh the list
      }
    } catch (error) {
      console.error('Error toggling lock:', error);
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Active': return 'bg-green-500/20 text-green-400';
      case 'Inactive': return 'bg-gray-500/20 text-gray-400';
      case 'Prospect': return 'bg-blue-500/20 text-blue-400';
      case 'Lead': return 'bg-yellow-500/20 text-yellow-400';
      default: return 'bg-gray-500/20 text-gray-400';
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">مدیریت مشتریان</h1>
          <p className="text-gray-300">مدیریت کامل اطلاعات مشتریان</p>
        </div>
        {crmPermissions.canCreateCustomers && (
          <Link 
            href="/dashboard/crm/customers/create" 
            className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
          >
            <FaPlus className="text-lg" />
            مشتری جدید
          </Link>
        )}
      </div>

      {/* Search and Filters */}
      <div className="glass-liquid-card p-6">
        <div className="flex flex-col lg:flex-row gap-4">
          {/* Search */}
          <div className="flex-1">
            <div className="relative">
              <FaSearch className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
              <input
                type="text"
                placeholder="جستجو بر اساس نام، شماره تماس یا شرکت..."
                value={filters.search}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pr-10 pl-4 py-3 bg-white/10 border border-white/20 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </div>
          </div>

          {/* Filter Toggle */}
          <button
            onClick={() => setShowFilters(!showFilters)}
            className="glass-liquid-btn inline-flex items-center gap-2 px-4 py-3"
          >
            <FaFilter className="text-lg" />
            فیلتر
          </button>
        </div>

        {/* Advanced Filters */}
        {showFilters && (
          <div className="mt-6 pt-6 border-t border-white/10">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Status Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">وضعیت</label>
                <select
                  value={filters.status}
                  onChange={(e) => handleFilterChange('status', e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">همه وضعیت‌ها</option>
                  <option value="Active">فعال</option>
                  <option value="Inactive">غیرفعال</option>
                  <option value="Prospect">بالقوه</option>
                  <option value="Lead">سرنخ</option>
                </select>
              </div>

              {/* Customer Type Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">نوع مشتری</label>
                <select
                  value={filters.customerType}
                  onChange={(e) => handleFilterChange('customerType', e.target.value)}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">همه انواع</option>
                  <option value="Individual">حقیقی</option>
                  <option value="Company">حقوقی</option>
                  <option value="Government">دولتی</option>
                </select>
              </div>

              {/* Blacklist Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">بلک‌لیست</label>
                <select
                  value={filters.isBlacklisted === null ? '' : filters.isBlacklisted.toString()}
                  onChange={(e) => handleFilterChange('isBlacklisted', e.target.value === '' ? null : e.target.value === 'true')}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">همه</option>
                  <option value="false">خیر</option>
                  <option value="true">بله</option>
                </select>
              </div>

              {/* Lock Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">قفل</label>
                <select
                  value={filters.isLocked === null ? '' : filters.isLocked.toString()}
                  onChange={(e) => handleFilterChange('isLocked', e.target.value === '' ? null : e.target.value === 'true')}
                  className="w-full px-3 py-2 bg-white/10 border border-white/20 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">همه</option>
                  <option value="false">خیر</option>
                  <option value="true">بله</option>
                </select>
              </div>
            </div>

            {/* Clear Filters */}
            <div className="mt-4 flex justify-end">
              <button
                onClick={clearFilters}
                className="text-gray-400 hover:text-white text-sm"
              >
                پاک کردن فیلترها
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Error State */}
      {error && (
        <div className="glass-liquid-card p-6 text-center">
          <FaExclamationTriangle className="mx-auto text-4xl text-red-400 mb-4" />
          <h2 className="text-xl font-semibold text-white mb-2">خطا در دریافت اطلاعات</h2>
          <p className="text-gray-400 mb-4">{error}</p>
          <button 
            onClick={fetchCustomers}
            className="glass-liquid-btn-primary px-6 py-2"
          >
            تلاش مجدد
          </button>
        </div>
      )}

      {/* Customers List */}
      {!error && (
        <div className="glass-liquid-card">
          <div className="p-6 border-b border-white/10">
            <h2 className="text-xl font-semibold text-white">
              همه مشتریان ({pagination.total})
            </h2>
          </div>

          <div className="divide-y divide-white/10">
            {customers.length === 0 ? (
              <div className="p-12 text-center">
                <FaUsers className="mx-auto text-4xl text-gray-400 mb-4" />
                <h3 className="text-lg font-semibold text-white mb-2">مشتری یافت نشد</h3>
                <p className="text-gray-400 mb-4">
                  {filters.search || filters.status || filters.customerType || filters.isBlacklisted !== null || filters.isLocked !== null
                    ? 'با این فیلترها نتیجه‌ای پیدا نشد'
                    : 'هنوز مشتری ثبت نشده است'
                  }
                </p>
                {hasPermission('crm' as any, 'edit' as any) && (
                  <Link 
                    href="/dashboard/crm/customers/create" 
                    className="glass-liquid-btn-primary inline-flex items-center gap-2 px-6 py-3"
                  >
                    <FaPlus className="text-lg" />
                    افزودن مشتری جدید
                  </Link>
                )}
              </div>
            ) : (
              customers.map((customer) => (
                <div key={customer.id} className="p-6 hover:bg-white/5 transition-all duration-200">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-4 mb-3">
                        <div className="glass-liquid-card p-3">
                          <FaBuilding className="h-6 w-6 text-blue-400" />
                        </div>
                        <div>
                          <h3 className="text-lg font-semibold text-white">
                            {customer.firstName} {customer.lastName}
                          </h3>
                          {customer.companyName && (
                            <p className="text-gray-400">{customer.companyName}</p>
                          )}
                          <div className="flex items-center gap-4 mt-1">
                            <span className={`px-3 py-1 rounded-full text-sm font-medium ${getStatusColor(customer.status)}`}>
                              {getStatusLabel(customer.status)}
                            </span>
                            <span className="text-gray-500 text-sm">
                              {getCustomerTypeLabel(customer.customerType)}
                            </span>
                            {customer.nationalCode && (
                              <span className="text-gray-500 text-sm">
                                کد ملی: {customer.nationalCode}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Contact Information */}
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                        {/* Primary Contact */}
                        {customer.primaryContact && (
                          <div className="flex items-center gap-2 text-gray-400">
                            <FaUser className="h-4 w-4" />
                            <span className="text-sm">
                              {customer.primaryContact.firstName} {customer.primaryContact.lastName}
                            </span>
                          </div>
                        )}

                        {/* Phone Numbers */}
                        {customer.phoneNumbers.length > 0 && (
                          <div className="flex items-center gap-2 text-gray-400">
                            <FaPhone className="h-4 w-4" />
                            <span className="text-sm">
                              {customer.phoneNumbers.find(p => p.isPrimary)?.number || customer.phoneNumbers[0].number}
                            </span>
                          </div>
                        )}

                        {/* Project Manager */}
                        {customer.projectManagerName && (
                          <div className="flex items-center gap-2 text-gray-400">
                            <FaUser className="h-4 w-4" />
                            <span className="text-sm">
                              مدیر پروژه: {customer.projectManagerName}
                            </span>
                          </div>
                        )}

                        {/* Project Addresses */}
                        {customer.projectAddresses.length > 0 && (
                          <div className="flex items-center gap-2 text-gray-400">
                            <FaMapMarkerAlt className="h-4 w-4" />
                            <span className="text-sm">
                              {customer.projectAddresses.length} پروژه
                            </span>
                          </div>
                        )}

                        {/* Brand */}
                        {customer.brandName && (
                          <div className="flex items-center gap-2 text-gray-400">
                            <FaBuilding className="h-4 w-4" />
                            <span className="text-sm">
                              برند: {customer.brandName}
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Status Indicators */}
                      <div className="flex items-center gap-2">
                        {customer.isBlacklisted && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-red-500/20 text-red-400">
                            <FaBan className="h-3 w-3" />
                            بلک‌لیست
                          </span>
                        )}
                        {customer.isLocked && (
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-orange-500/20 text-orange-400">
                            <FaLock className="h-3 w-3" />
                            قفل‌شده
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/dashboard/crm/customers/${customer.id}`}
                        className="glass-liquid-btn p-2 hover:bg-white/10"
                        title="مشاهده مشتری"
                      >
                        <FaEye className="h-4 w-4" />
                      </Link>
                      
                      {hasPermission('crm' as any, 'edit' as any) && (
                        <Link
                          href={`/dashboard/crm/customers/${customer.id}/edit`}
                          className="glass-liquid-btn p-2 hover:bg-white/10"
                          title="ویرایش"
                        >
                          <FaEdit className="h-4 w-4" />
                        </Link>
                      )}

                      {hasPermission('crm' as any, 'admin' as any) && (
                        <>
                          <button
                            onClick={() => handleToggleBlacklist(customer.id)}
                            className={`p-2 rounded-lg transition-all duration-200 ${
                              customer.isBlacklisted 
                                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                : 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                            }`}
                            title={customer.isBlacklisted ? 'حذف از بلک‌لیست' : 'افزودن به بلک‌لیست'}
                          >
                            {customer.isBlacklisted ? <FaCheckCircle className="h-4 w-4" /> : <FaBan className="h-4 w-4" />}
                          </button>

                          <button
                            onClick={() => handleToggleLock(customer.id)}
                            className={`p-2 rounded-lg transition-all duration-200 ${
                              customer.isLocked 
                                ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                                : 'bg-orange-500/20 text-orange-400 hover:bg-orange-500/30'
                            }`}
                            title={customer.isLocked ? 'باز کردن قفل' : 'قفل کردن'}
                          >
                            {customer.isLocked ? <FaCheckCircle className="h-4 w-4" /> : <FaLock className="h-4 w-4" />}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {pagination.pages > 1 && (
            <div className="p-6 border-t border-white/10">
              <div className="flex items-center justify-between">
                <div className="text-sm text-gray-400">
                  نمایش {((pagination.page - 1) * pagination.limit) + 1} تا {Math.min(pagination.page * pagination.limit, pagination.total)} از {pagination.total} مشتری
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page - 1 }))}
                    disabled={pagination.page === 1}
                    className="glass-liquid-btn p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    قبلی
                  </button>
                  <span className="px-4 py-2 text-sm text-gray-300">
                    صفحه {pagination.page} از {pagination.pages}
                  </span>
                  <button
                    onClick={() => setPagination(prev => ({ ...prev, page: prev.page + 1 }))}
                    disabled={pagination.page === pagination.pages}
                    className="glass-liquid-btn p-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    بعدی
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

