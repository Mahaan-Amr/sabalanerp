'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  FaFileContract, 
  FaUsers, 
  FaChartLine, 
  FaBuilding, 
  FaPlus,
  FaEye,
  FaEdit,
  FaCheck,
  FaSignature,
  FaPrint,
  FaExclamationTriangle,
  FaTimes,
  FaClock,
  FaUserCog,
  FaShieldAlt,
  FaCog,
  FaUserShield
} from 'react-icons/fa';
import { dashboardAPI } from '@/lib/api';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import PersianCalendar from '@/lib/persian-calendar';

interface DashboardStats {
  contracts: {
    total: number;
    pending: number;
    signed: number;
    draft: number;
    approved: number;
    printed: number;
    cancelled: number;
    expired: number;
  };
  customers: {
    total: number;
  };
  revenue: {
    total: number;
    average: number;
    completionRate: number;
  };
  recentContracts: RecentContract[];
  monthlyRevenue: Array<{
    month: string;
    amount: number;
    count: number;
  }>;
}

interface RecentContract {
  id: string;
  contractNumber: string;
  titlePersian: string;
  status: string;
  totalAmount: number | null;
  currency: string;
  customer: {
    firstName: string;
    lastName: string;
    companyName: string | null;
  };
  department: {
    namePersian: string;
  };
  createdByUser: {
    firstName: string;
    lastName: string;
  };
  createdAt: string;
}

const statusColors = {
  DRAFT: 'text-gray-500 bg-gray-500/20',
  PENDING_APPROVAL: 'text-yellow-500 bg-yellow-500/20',
  APPROVED: 'text-blue-500 bg-blue-500/20',
  SIGNED: 'text-green-500 bg-green-500/20',
  PRINTED: 'text-purple-500 bg-purple-500/20',
  CANCELLED: 'text-red-500 bg-red-500/20',
  EXPIRED: 'text-gray-400 bg-gray-400/20'
};

const statusLabels = {
  DRAFT: 'پیش Ù†Ùˆیس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده'
};

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  departmentId?: string;
}

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { accessibleWorkspaces, currentWorkspace } = useWorkspace();

  useEffect(() => {
    fetchDashboardData();
    loadCurrentUser();
  }, []);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const response = await dashboardAPI.getStats();
      
      if (response.data.success) {
        setStats(response.data.data);
      } else {
        setError('خطا در دریافت اطلاعات Ø¯Ø§Ø´Ø¨Ùˆرد');
      }
    } catch (error: any) {
      console.error('Error fetching dashboard data:', error);
      setError(error.response?.data?.error || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  };

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user = response.data.data;
        setCurrentUser(user);
        
        // Role-based redirection: Sales users should be redirected to sales dashboard
        if (user.role === 'SALES') {
          router.push('/dashboard/sales');
          return;
        }
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const formatAmount = (amount: number) => {
    return `${amount.toLocaleString('fa-IR')} ریال`;
  };

  const formatDate = (dateString: string) => {
    return PersianCalendar.formatForDisplay(dateString);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'DRAFT':
        return <FaEdit className="h-4 w-4" />;
      case 'PENDING_APPROVAL':
        return <FaClock className="h-4 w-4" />;
      case 'APPROVED':
        return <FaCheck className="h-4 w-4" />;
      case 'SIGNED':
        return <FaSignature className="h-4 w-4" />;
      case 'PRINTED':
        return <FaPrint className="h-4 w-4" />;
      case 'CANCELLED':
        return <FaTimes className="h-4 w-4" />;
      case 'EXPIRED':
        return <FaExclamationTriangle className="h-4 w-4" />;
      default:
        return <FaFileContract className="h-4 w-4" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-teal-500"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-liquid-card p-6 text-center">
        <FaExclamationTriangle className="mx-auto text-4xl text-red-400 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">خطا در دریافت اطلاعات</h2>
        <p className="text-gray-400 mb-4">{error}</p>
        <button 
          onClick={fetchDashboardData}
          className="glass-liquid-btn-primary px-6 py-2"
        >
          تلاش مجدد
        </button>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="glass-liquid-card p-6 text-center">
        <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
        <h2 className="text-xl font-semibold text-white mb-2">اطلاعاتی یافت نشد</h2>
        <p className="text-gray-400">Ù‡Ù†Ùˆز داده‌ای برای نمایش ÙˆØ¬Ùˆد ندارد</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Welcome Section */}
      <div className="glass-liquid-card p-6">
        <h1 className="text-2xl font-bold text-white mb-2">Ø®Ùˆش آمدید به Ø¯Ø§Ø´Ø¨Ùˆرد سبلان ERP</h1>
        <p className="text-gray-300">نگاهی کلی به فعالیت‌ها و آمار سیستم</p>
      </div>

      {/* Workspace Overview */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">فضاهای کاری در دسترس</h2>
        <WorkspaceSwitcher variant="grid" />
      </div>

      {/* Admin Management Section */}
      {currentUser?.role === 'ADMIN' && (
        <div className="glass-liquid-card p-6">
          <h2 className="text-xl font-semibold text-white mb-4">مدیریت سیستم</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* User Management Card */}
            <Link 
              href="/dashboard/users" 
              className="glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 hover:scale-105"
            >
              <div className="flex items-center gap-4">
                <div className="glass-liquid-card p-3">
                  <FaUserCog className="h-6 w-6 text-blue-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">مدیریت کاربران</h3>
                  <p className="text-gray-400 text-sm">ایجاد، Ùˆیرایش و مدیریت کاربران سیستم</p>
                </div>
              </div>
            </Link>

            {/* Permissions Management Card */}
            <Link 
              href="/dashboard/admin/permissions" 
              className="glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 hover:scale-105"
            >
              <div className="flex items-center gap-4">
                <div className="glass-liquid-card p-3">
                  <FaShieldAlt className="h-6 w-6 text-purple-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">مدیریت دسترسی‌ها</h3>
                  <p className="text-gray-400 text-sm">تنظیم Ù…Ø¬Ùˆزها و دسترسی‌های کاربران</p>
                </div>
              </div>
            </Link>

            {/* Departments Management Card */}
            <Link 
              href="/dashboard/departments" 
              className="glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 hover:scale-105"
            >
              <div className="flex items-center gap-4">
                <div className="glass-liquid-card p-3">
                  <FaBuilding className="h-6 w-6 text-green-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">مدیریت بخش‌ها</h3>
                  <p className="text-gray-400 text-sm">ایجاد و مدیریت بخش‌های سازمانی</p>
                </div>
              </div>
            </Link>

            {/* System Settings Card */}
            <Link 
              href="/dashboard/admin/settings" 
              className="glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 hover:scale-105"
            >
              <div className="flex items-center gap-4">
                <div className="glass-liquid-card p-3">
                  <FaCog className="h-6 w-6 text-orange-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">تنظیمات سیستم</h3>
                  <p className="text-gray-400 text-sm">پیکربندی و تنظیمات کلی سیستم</p>
                </div>
              </div>
            </Link>

            {/* Security Management Card */}
            <Link 
              href="/dashboard/admin/security" 
              className="glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 hover:scale-105"
            >
              <div className="flex items-center gap-4">
                <div className="glass-liquid-card p-3">
                  <FaUserShield className="h-6 w-6 text-red-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">امنیت سیستم</h3>
                  <p className="text-gray-400 text-sm">نظارت بر امنیت و فعالیت‌های کاربران</p>
                </div>
              </div>
            </Link>

            {/* Reports & Analytics Card */}
            <Link 
              href="/dashboard/admin/reports" 
              className="glass-liquid-card p-6 cursor-pointer transition-all duration-200 hover:bg-white/10 hover:scale-105"
            >
              <div className="flex items-center gap-4">
                <div className="glass-liquid-card p-3">
                  <FaChartLine className="h-6 w-6 text-teal-400" />
                </div>
                <div className="flex-1">
                  <h3 className="text-white font-semibold">گزارشات مدیریتی</h3>
                  <p className="text-gray-400 text-sm">گزارشات جامع و تحلیل‌های سیستم</p>
                </div>
              </div>
            </Link>
          </div>
        </div>
      )}

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">کل قراردادها</p>
              <p className="text-2xl font-bold text-white">{stats.contracts.total}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaFileContract className="h-6 w-6 text-teal-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">در انتظار تایید</p>
              <p className="text-2xl font-bold text-white">{stats.contracts.pending}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaClock className="h-6 w-6 text-yellow-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">امضا شده</p>
              <p className="text-2xl font-bold text-white">{stats.contracts.signed}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaSignature className="h-6 w-6 text-green-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">کل مشتریان</p>
              <p className="text-2xl font-bold text-white">{stats.customers.total}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaUsers className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Additional Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">پیش Ù†Ùˆیس</p>
              <p className="text-2xl font-bold text-white">{stats.contracts.draft}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaEdit className="h-6 w-6 text-gray-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">تایید شده</p>
              <p className="text-2xl font-bold text-white">{stats.contracts.approved}</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaCheck className="h-6 w-6 text-blue-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">نرخ تکمیل</p>
              <p className="text-2xl font-bold text-white">{stats.revenue.completionRate}%</p>
            </div>
            <div className="glass-liquid-card p-3">
              <FaChartLine className="h-6 w-6 text-teal-400" />
            </div>
          </div>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="glass-liquid-card p-6">
        <h2 className="text-xl font-semibold text-white mb-4">عملیات سریع</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Link 
            href="/dashboard/contracts/create" 
            className="glass-liquid-btn-primary p-4 flex items-center gap-3 hover:bg-teal-600/20 transition-all duration-200"
          >
            <FaPlus className="h-5 w-5" />
            <span>ایجاد قرارداد جدید</span>
          </Link>
          
          <Link 
            href="/dashboard/customers/create" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaUsers className="h-5 w-5" />
            <span>Ø§ÙØ²Ùˆدن مشتری جدید</span>
          </Link>
          
          <Link 
            href="/dashboard/reports" 
            className="glass-liquid-btn p-4 flex items-center gap-3 hover:bg-white/10 transition-all duration-200"
          >
            <FaChartLine className="h-5 w-5" />
            <span>مشاهده گزارشات</span>
          </Link>
        </div>
      </div>

      {/* Recent Contracts */}
      <div className="glass-liquid-card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold text-white">قراردادهای اخیر</h2>
          <Link 
            href="/dashboard/contracts" 
            className="text-teal-400 hover:text-teal-300 text-sm"
          >
            مشاهده همه
          </Link>
        </div>
        
        <div className="space-y-4">
          {stats.recentContracts.length === 0 ? (
            <div className="text-center py-8">
              <FaFileContract className="mx-auto text-4xl text-gray-400 mb-4" />
              <p className="text-gray-400">Ù‡Ù†Ùˆز قراردادی ایجاد نشده است</p>
            </div>
          ) : (
            stats.recentContracts.map((contract) => (
              <div key={contract.id} className="flex items-center justify-between p-4 bg-white/5 rounded-lg hover:bg-white/10 transition-all duration-200">
                <div className="flex items-center gap-4">
                  <div className="glass-liquid-card p-3">
                    {getStatusIcon(contract.status)}
                  </div>
                  <div>
                    <h3 className="text-white font-medium">{contract.titlePersian}</h3>
                    <p className="text-gray-400 text-sm">
                      {contract.customer.firstName} {contract.customer.lastName}
                      {contract.customer.companyName && ` (${contract.customer.companyName})`}
                    </p>
                    <p className="text-gray-500 text-xs">
                      {contract.department.namePersian} ⬢ {contract.createdByUser.firstName} {contract.createdByUser.lastName}
                    </p>
                    <p className="text-gray-500 text-xs">{formatDate(contract.createdAt)}</p>
                  </div>
                </div>
                
                <div className="flex items-center gap-4">
                  <div className="text-left">
                    <p className="text-white font-semibold">
                      {contract.totalAmount ? formatAmount(contract.totalAmount) : 'نامشخص'}
                    </p>
                    <p className="text-gray-400 text-sm">{contract.contractNumber}</p>
                  </div>
                  <span className={`px-3 py-1 rounded-full text-sm font-medium ${statusColors[contract.status as keyof typeof statusColors]}`}>
                    {statusLabels[contract.status as keyof typeof statusLabels]}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Revenue Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">کل درآمد</h2>
              <p className="text-3xl font-bold text-teal-400">{formatAmount(stats.revenue.total)}</p>
              <p className="text-gray-400 text-sm">از قراردادهای امضا شده</p>
            </div>
            <div className="glass-liquid-card p-4">
              <FaChartLine className="h-8 w-8 text-teal-400" />
            </div>
          </div>
        </div>

        <div className="glass-liquid-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold text-white mb-2">میانگین قرارداد</h2>
              <p className="text-3xl font-bold text-gold-400">{formatAmount(stats.revenue.average)}</p>
              <p className="text-gray-400 text-sm">ارزش Ù…ØªÙˆسط هر قرارداد</p>
            </div>
            <div className="glass-liquid-card p-4">
              <FaFileContract className="h-8 w-8 text-gold-400" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
