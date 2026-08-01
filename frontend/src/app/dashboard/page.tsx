'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FaBuilding,
  FaCalendarAlt,
  FaChartLine,
  FaCheck,
  FaClock,
  FaCog,
  FaDatabase,
  FaEdit,
  FaExclamationTriangle,
  FaFileContract,
  FaPercent,
  FaPlus,
  FaPrint,
  FaShieldAlt,
  FaSignature,
  FaSync,
  FaTimes,
  FaUserCog,
  FaUserShield,
  FaUsers,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpEmptyState,
  ErpInlineState,
  ErpLoading,
  ErpNeumorphicActionGrid,
  ErpNeumorphicCard,
  ErpNeumorphicMetricGrid,
  type ErpTone,
} from '@/components/erp';
import { WorkspaceSwitcher } from '@/components/WorkspaceSwitcher';
import { LAST_WORKSPACE_STORAGE_KEY, useWorkspace, WORKSPACES } from '@/contexts/WorkspaceContext';
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
  customers: { total: number };
  realizedSales: {
    total: number;
    average: number | null;
    successRate: number | null;
    realizedContracts: number;
  };
  recentContracts: RecentContract[];
}

interface RecentContract {
  id: string;
  contractNumber: string;
  titlePersian: string;
  status: string;
  totalAmount: number | string | null;
  currency: string;
  customer: { firstName: string; lastName: string; companyName: string | null };
  department: { namePersian: string };
  createdByUser: { firstName: string; lastName: string };
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

const statusIcon = (status: string) => {
  switch (status) {
    case 'DRAFT': return FaEdit;
    case 'PENDING_APPROVAL': return FaClock;
    case 'APPROVED': return FaCheck;
    case 'SIGNED': return FaSignature;
    case 'PRINTED': return FaPrint;
    case 'CANCELLED': return FaTimes;
    case 'EXPIRED': return FaExclamationTriangle;
    default: return FaFileContract;
  }
};

export default function DashboardPage() {
  const router = useRouter();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { accessibleWorkspaces, loading: workspaceLoading } = useWorkspace();

  const fetchDashboardData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await dashboardAPI.getStats();
      if (!response.data.success) throw new Error('خطا در دریافت اطلاعات داشبورد');
      setStats(response.data.data);
    } catch (reason: any) {
      setError(reason.response?.data?.error || reason.message || 'خطا در ارتباط با سرور');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    dashboardAPI.getProfile()
      .then((response) => {
        if (response.data.success) setCurrentUser(response.data.data);
      })
      .catch((reason) => {
        setError(reason.response?.data?.error || 'خطا در دریافت اطلاعات کاربر');
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    if (!currentUser || workspaceLoading) return;
    if (accessibleWorkspaces.length === 1) {
      router.replace(accessibleWorkspaces[0].path);
      return;
    }
    if (accessibleWorkspaces.length > 1) {
      const lastWorkspace = localStorage.getItem(LAST_WORKSPACE_STORAGE_KEY) as WORKSPACES | null;
      const lastAccessibleWorkspace = accessibleWorkspaces.find((workspace) => workspace.id === lastWorkspace);
      if (lastAccessibleWorkspace) {
        router.replace(lastAccessibleWorkspace.path);
        return;
      }
      if (currentUser.role !== 'ADMIN' && currentUser.role !== 'MANAGER') {
        router.replace(accessibleWorkspaces[0].path);
        return;
      }
    }
    if (currentUser.role === 'ADMIN' || currentUser.role === 'MANAGER') void fetchDashboardData();
    else setLoading(false);
  }, [accessibleWorkspaces, currentUser, fetchDashboardData, router, workspaceLoading]);

  if (loading && !stats) return <ErpLoading />;
  if (error && !stats) {
    return (
      <ErpEmptyState
        icon={FaExclamationTriangle}
        title="خطا در دریافت اطلاعات"
        description={error}
        action={{ label: 'تلاش دوباره', onClick: fetchDashboardData, variant: 'solid', tone: 'primary' }}
      />
    );
  }
  if (!stats) return <ErpEmptyState icon={FaFileContract} title="اطلاعاتی برای نمایش وجود ندارد" />;

  const amount = (value: number | string | null | undefined) => formatPrice(value, 'تومان');
  const count = (value: number) => value.toLocaleString('fa-IR');

  return (
    <main dir="rtl" lang="fa" className="sds-workspace sds-neumorphic-scope mx-auto w-full max-w-7xl space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-black tracking-tight text-[var(--sds-text-primary)] sm:text-3xl">داشبورد اصلی</h1>
        <ErpButton
          label={loading ? 'در حال به‌روزرسانی' : 'به‌روزرسانی'}
          icon={FaSync}
          onClick={fetchDashboardData}
          disabled={loading}
          tone="neutral"
          variant="soft"
        />
      </header>

      {error && <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: fetchDashboardData }} />}

      <ErpNeumorphicMetricGrid
        items={[
          { id: 'contracts', label: 'کل قراردادها', value: count(stats.contracts.total), icon: FaFileContract, tone: 'primary', href: '/dashboard/sales/contracts' },
          { id: 'pending', label: 'در انتظار تأیید', value: count(stats.contracts.pending), icon: FaClock, tone: 'warning', href: '/dashboard/sales/contracts?status=PENDING_APPROVAL' },
          { id: 'signed', label: 'امضا شده', value: count(stats.contracts.signed), icon: FaSignature, tone: 'success', href: '/dashboard/sales/contracts?status=SIGNED' },
          { id: 'customers', label: 'کل مشتریان', value: count(stats.customers.total), icon: FaUsers, tone: 'info', href: '/dashboard/crm/customers' },
        ]}
      />

      <div className="space-y-5">
        <section className="space-y-3" aria-labelledby="contract-summary-title">
          <h2 id="contract-summary-title" className="text-lg font-black text-[var(--sds-text-primary)]">خلاصه قراردادها</h2>
          <ErpNeumorphicMetricGrid
            label="خلاصه وضعیت قراردادها"
            columns={4}
            items={[
              { id: 'draft', label: 'پیش‌نویس', value: count(stats.contracts.draft), icon: FaEdit, tone: 'neutral', href: '/dashboard/sales/contracts?status=DRAFT' },
              { id: 'approved', label: 'تأیید شده', value: count(stats.contracts.approved), icon: FaCheck, tone: 'info', href: '/dashboard/sales/contracts?status=APPROVED' },
              { id: 'printed', label: 'چاپ شده', value: count(stats.contracts.printed), icon: FaPrint, tone: 'purple', href: '/dashboard/sales/contracts?status=PRINTED' },
              { id: 'lost', label: 'لغو یا منقضی', value: count(stats.contracts.cancelled + stats.contracts.expired), icon: FaTimes, tone: 'danger', href: '/dashboard/sales/contracts?status=CANCELLED%2CEXPIRED' },
            ]}
          />
        </section>

        <section className="space-y-3" aria-labelledby="realized-sales-title">
          <h2 id="realized-sales-title" className="text-lg font-black text-[var(--sds-text-primary)]">فروش قطعی</h2>
          <ErpNeumorphicMetricGrid
            label="شاخص‌های فروش قطعی از ابتدا تا امروز"
            columns={3}
            mobileColumns={1}
            items={[
              { id: 'realized-total', label: 'فروش قطعی خالص', value: amount(stats.realizedSales.total), hint: 'از ابتدا تا امروز', icon: FaChartLine, tone: 'primary', href: '/dashboard/sales/reports?period=all' },
              { id: 'realized-average', label: 'میانگین قرارداد قطعی', value: stats.realizedSales.average == null ? '—' : amount(stats.realizedSales.average), icon: FaFileContract, tone: 'warning', href: '/dashboard/sales/reports?period=all' },
              { id: 'success-rate', label: 'نرخ موفقیت', value: stats.realizedSales.successRate == null ? '—' : `${count(stats.realizedSales.successRate)}٪`, icon: FaCheck, tone: 'success', href: '/dashboard/sales/reports?period=all' },
            ]}
          />
        </section>
      </div>

      <ErpNeumorphicActionGrid
        title="عملیات سریع"
        items={[
          { id: 'new-contract', title: 'قرارداد جدید', href: '/dashboard/sales/contracts/create', icon: FaPlus },
          { id: 'new-customer', title: 'مشتری جدید', href: '/dashboard/crm/customers/create', icon: FaUsers },
          { id: 'reports', title: 'گزارش فروش', href: '/dashboard/sales/reports', icon: FaChartLine },
        ]}
      />

      <section className="space-y-3" aria-labelledby="recent-contracts-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="recent-contracts-title" className="text-lg font-black text-[var(--sds-text-primary)]">قراردادهای اخیر</h2>
          <ErpButton label="مشاهده همه" href="/dashboard/sales/contracts" tone="neutral" variant="ghost" />
        </div>
        {stats.recentContracts.length === 0 ? (
          <ErpNeumorphicCard className="p-5 text-center text-sm text-[var(--sds-text-muted)]">هنوز قراردادی ثبت نشده است</ErpNeumorphicCard>
        ) : (
          <ErpNeumorphicCard className="overflow-hidden">
            <div className="divide-y divide-[var(--sds-border-subtle)]">
              {stats.recentContracts.map((contract) => {
                const Icon = statusIcon(contract.status);
                return (
                  <Link
                    key={contract.id}
                    href={`/dashboard/sales/contracts/${contract.id}`}
                    className="sds-neumorphic-interactive flex min-h-16 items-center justify-between gap-3 px-4 py-3 outline-none"
                  >
                    <span className="flex min-w-0 items-center gap-3">
                      <span className={`sds-neumorphic-icon sds-tone-${statusTone[contract.status] || 'neutral'} sds-tone-surface inline-flex h-10 w-10 shrink-0 items-center justify-center`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <span className="min-w-0">
                        <strong className="block truncate text-sm text-[var(--sds-text-primary)]">{contract.titlePersian || contract.contractNumber}</strong>
                        <span className="mt-0.5 block truncate text-xs text-[var(--sds-text-muted)]">
                          {contract.customer.companyName || `${contract.customer.firstName} ${contract.customer.lastName}`.trim()} · {PersianCalendar.formatForDisplay(contract.createdAt)}
                        </span>
                      </span>
                    </span>
                    <span className="shrink-0 text-left">
                      <strong className="block text-sm text-[var(--sds-text-primary)]">{contract.totalAmount == null ? '—' : amount(contract.totalAmount)}</strong>
                      <ErpBadge tone={statusTone[contract.status] || 'neutral'}>{CONTRACT_STATUS_LABELS[contract.status] || contract.status}</ErpBadge>
                    </span>
                  </Link>
                );
              })}
            </div>
          </ErpNeumorphicCard>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="workspaces-title">
        <h2 id="workspaces-title" className="text-lg font-black text-[var(--sds-text-primary)]">فضاهای کاری</h2>
        <WorkspaceSwitcher variant="grid" compact />
      </section>

      {currentUser?.role === 'ADMIN' && (
        <ErpNeumorphicActionGrid
          title="مدیریت سیستم"
          items={[
            { id: 'users', title: 'کاربران', href: '/dashboard/users', icon: FaUserCog },
            { id: 'personnel', title: 'پرسنل', href: '/dashboard/hr/personnel', icon: FaUsers },
            { id: 'permissions', title: 'دسترسی‌ها', href: '/dashboard/admin/permissions', icon: FaShieldAlt },
            { id: 'departments', title: 'بخش‌ها', href: '/dashboard/departments', icon: FaBuilding },
            { id: 'settings', title: 'تنظیمات', href: '/dashboard/admin/settings', icon: FaCog },
            { id: 'discount-settings', title: 'تخفیف قرارداد', href: '/dashboard/admin/discount-settings', icon: FaPercent },
            { id: 'calendar', title: 'تقویم سالیانه', href: '/dashboard/admin/sabalan-calendar', icon: FaCalendarAlt },
            { id: 'security', title: 'امنیت سیستم', href: '/dashboard/admin/security', icon: FaUserShield },
            { id: 'management-reports', title: 'گزارش‌های مدیریتی', href: '/dashboard/admin/reports', icon: FaChartLine },
            { id: 'recovery', title: 'پشتیبان‌گیری و بازیابی', href: '/dashboard/admin/system-recovery', icon: FaDatabase },
          ]}
        />
      )}
    </main>
  );
}
