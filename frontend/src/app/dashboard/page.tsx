'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaBuilding,
  FaChartLine,
  FaCheck,
  FaClock,
  FaCog,
  FaEdit,
  FaExclamationTriangle,
  FaFileContract,
  FaPlus,
  FaPercent,
  FaPrint,
  FaShieldAlt,
  FaSignature,
  FaTimes,
  FaUserCog,
  FaUserShield,
  FaUsers,
} from 'react-icons/fa';
import { ErpActionGrid, ErpBadge, ErpEmptyState, ErpFieldView, ErpLoading, ErpPage, ErpSection, ErpTwoColumn, type ErpMetric, type ErpTone } from '@/components/erp';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { useWorkspace, WORKSPACE_CONFIG } from '@/contexts/WorkspaceContext';
import { dashboardAPI } from '@/lib/api';
import { formatPrice } from '@/lib/numberFormat';
import PersianCalendar from '@/lib/persian-calendar';
import { CONTRACT_STATUS_LABELS } from '@/lib/persianText';

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
    total: number | string | null;
    average: number | string | null;
    completionRate: number;
  };
  recentContracts: RecentContract[];
  monthlyRevenue: Array<{
    month: string;
    amount: number | string | null;
    count: number;
  }>;
}

interface RecentContract {
  id: string;
  contractNumber: string;
  titlePersian: string;
  status: string;
  totalAmount: number | string | null;
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

interface User {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  role: string;
  departmentId?: string;
}

const statusTone: Record<string, ErpTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SIGNED: 'success',
  PRINTED: 'purple',
  CANCELLED: 'danger',
  EXPIRED: 'neutral',
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { accessibleWorkspaces, currentWorkspace, loading: workspaceLoading } = useWorkspace();
  const activeWorkspaceName = currentWorkspace ? WORKSPACE_CONFIG[currentWorkspace].namePersian : 'انتخاب نشده';

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (!currentUser || workspaceLoading) return;

    if (currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
      const firstWorkspace = accessibleWorkspaces[0];
      if (firstWorkspace) {
        router.replace(firstWorkspace.path);
        return;
      }
      setLoading(false);
      return;
    }

    fetchDashboardData();
  }, [currentUser, workspaceLoading, accessibleWorkspaces, router]);

  const fetchDashboardData = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await dashboardAPI.getStats();

      if (response.data.success) {
        setStats(response.data.data);
      } else {
        setError('خطا در دریافت اطلاعات داشبورد');
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
      }
    } catch (error: any) {
      console.error('Error loading user profile:', error);
      setError(error.response?.data?.error || 'خطا در دریافت اطلاعات کاربر');
      setLoading(false);
    }
  };

  const formatAmount = (amount: number | string | null | undefined) => formatPrice(amount, 'ریال');
  const formatDate = (dateString: string) => PersianCalendar.formatForDisplay(dateString);

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
    return <ErpLoading />;
  }

  if (error) {
    return (
      <ErpEmptyState
        icon={FaExclamationTriangle}
        title="خطا در دریافت اطلاعات"
        description={error}
        action={{ label: 'تلاش دوباره', onClick: fetchDashboardData, variant: 'solid', tone: 'primary' }}
      />
    );
  }

  if (!stats) {
    return (
      <ErpEmptyState
        icon={FaFileContract}
        title="اطلاعاتی یافت نشد"
        description="هنوز داده‌ای برای نمایش وجود ندارد."
      />
    );
  }

  const metrics: ErpMetric[] = [
    { label: 'کل قراردادها', value: stats.contracts.total.toLocaleString('fa-IR'), icon: FaFileContract, tone: 'primary' },
    { label: 'در انتظار تایید', value: stats.contracts.pending.toLocaleString('fa-IR'), icon: FaClock, tone: 'warning' },
    { label: 'امضا شده', value: stats.contracts.signed.toLocaleString('fa-IR'), icon: FaSignature, tone: 'success' },
    { label: 'کل مشتریان', value: stats.customers.total.toLocaleString('fa-IR'), icon: FaUsers, tone: 'info' },
  ];

  return (
    <ErpPage
      eyebrow="داشبورد ERP"
      title="مرکز عملیات سبلان"
      description="نمای کلی فروش، مشتریان، درآمد و دسترسی‌های مدیریتی در یک صفحه موبایل‌اول و قابل استفاده در حالت روشن و تاریک."
      metrics={metrics}
      actions={[
        { label: 'قرارداد جدید', href: '/dashboard/contracts/create', icon: FaPlus, tone: 'primary', variant: 'solid' },
        { label: 'مشاهده قراردادها', href: '/dashboard/contracts', icon: FaFileContract, tone: 'neutral', variant: 'outline' },
      ]}
    >
      <ErpTwoColumn
        main={
          <>
            <ErpSection title="فضاهای کاری" description={`فضای فعال: ${activeWorkspaceName} | ${accessibleWorkspaces.length.toLocaleString('fa-IR')} فضای کاری در دسترس`}>
              <WorkspaceSwitcher variant="grid" />
            </ErpSection>

            {currentUser?.role === 'ADMIN' && (
              <ErpSection title="مدیریت سیستم" description="میانبرهای اصلی برای نگهداری ساختار سازمانی، کاربران، امنیت و گزارش‌های مدیریتی.">
                <ErpActionGrid
                  columns={3}
                  items={[
                    { title: 'مدیریت کاربران', description: 'ایجاد، ویرایش و کنترل وضعیت کاربران', href: '/dashboard/users', icon: FaUserCog, tone: 'info' },
                    { title: 'مدیریت دسترسی‌ها', description: 'تنظیم مجوزها و نقش‌های سیستمی', href: '/dashboard/admin/permissions', icon: FaShieldAlt, tone: 'purple' },
                    { title: 'مدیریت بخش‌ها', description: 'واحدهای سازمانی و ارتباط آنها با کاربران', href: '/dashboard/departments', icon: FaBuilding, tone: 'success' },
                    { title: 'تنظیمات سیستم', description: 'پیکربندی عمومی ERP', href: '/dashboard/admin/settings', icon: FaCog, tone: 'warning' },
                    { title: 'تنظیمات تخفیف قرارداد', description: 'تعریف بازه‌ها و سقف درصد تخفیف فروش', href: '/dashboard/admin/discount-settings', icon: FaPercent, tone: 'success' },
                    { title: 'امنیت سیستم', description: 'نظارت بر امنیت و فعالیت‌ها', href: '/dashboard/admin/security', icon: FaUserShield, tone: 'danger' },
                    { title: 'گزارشات مدیریتی', description: 'گزارش‌های جامع و تحلیل‌های سیستم', href: '/dashboard/admin/reports', icon: FaChartLine, tone: 'primary' },
                  ]}
                />
              </ErpSection>
            )}

            <ErpSection
              title="قراردادهای اخیر"
              description="آخرین قراردادهای ثبت‌شده در سیستم."
              actions={[{ label: 'مشاهده همه', href: '/dashboard/contracts', variant: 'outline', tone: 'neutral' }]}
            >
              {stats.recentContracts.length === 0 ? (
                <ErpEmptyState title="هنوز قراردادی ایجاد نشده است" icon={FaFileContract} />
              ) : (
                <div className="space-y-3">
                  {stats.recentContracts.map((contract) => (
                    <Link
                      key={contract.id}
                      href={`/dashboard/contracts/${contract.id}`}
                      className="block rounded-lg border border-slate-200 bg-slate-50 p-4 transition hover:border-[#074747]/40 hover:bg-white dark:border-slate-800 dark:bg-slate-800/50 dark:hover:border-teal-700 dark:hover:bg-slate-800"
                    >
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div className="flex min-w-0 items-start gap-3">
                          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/40 dark:text-teal-100">
                            {getStatusIcon(contract.status)}
                          </span>
                          <div className="min-w-0">
                            <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-white">{contract.titlePersian}</h3>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {contract.customer.firstName} {contract.customer.lastName}
                              {contract.customer.companyName && ` (${contract.customer.companyName})`}
                            </p>
                            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {contract.department.namePersian} | {contract.createdByUser.firstName} {contract.createdByUser.lastName} | {formatDate(contract.createdAt)}
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2 sm:justify-end sm:text-left">
                          <div>
                            <p className="text-sm font-semibold text-slate-900 dark:text-white">
                              {contract.totalAmount ? formatAmount(contract.totalAmount) : 'نامشخص'}
                            </p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">{contract.contractNumber}</p>
                          </div>
                          <ErpBadge tone={statusTone[contract.status] || 'neutral'}>
                            {CONTRACT_STATUS_LABELS[contract.status] || contract.status}
                          </ErpBadge>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </ErpSection>
          </>
        }
        aside={
          <>
            <ErpSection title="عملیات سریع">
              <ErpActionGrid
                columns={1}
                compact
                items={[
                  { title: 'ایجاد قرارداد جدید', href: '/dashboard/contracts/create', icon: FaPlus, tone: 'primary' },
                  { title: 'افزودن مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaUsers, tone: 'info' },
                  { title: 'مشاهده گزارشات', href: '/dashboard/admin/reports', icon: FaChartLine, tone: 'neutral' },
                ]}
              />
            </ErpSection>

            <ErpSection title="خلاصه قراردادها">
              <div className="grid grid-cols-1 gap-3">
                <ErpFieldView label="پیش‌نویس" value={stats.contracts.draft.toLocaleString('fa-IR')} tone="neutral" />
                <ErpFieldView label="تایید شده" value={stats.contracts.approved.toLocaleString('fa-IR')} tone="info" />
                <ErpFieldView label="چاپ شده" value={stats.contracts.printed.toLocaleString('fa-IR')} tone="purple" />
                <ErpFieldView label="لغو یا منقضی" value={(stats.contracts.cancelled + stats.contracts.expired).toLocaleString('fa-IR')} tone="danger" />
              </div>
            </ErpSection>

            <ErpSection title="درآمد">
              <div className="space-y-3">
                <ErpFieldView label="کل درآمد" value={formatAmount(stats.revenue.total)} hint="از قراردادهای امضا شده" tone="primary" />
                <ErpFieldView label="میانگین قرارداد" value={formatAmount(stats.revenue.average)} hint="ارزش متوسط هر قرارداد" tone="warning" />
                <ErpFieldView label="نرخ تکمیل" value={`${stats.revenue.completionRate.toLocaleString('fa-IR')}٪`} tone="success" />
              </div>
            </ErpSection>
          </>
        }
      />
    </ErpPage>
  );
}
