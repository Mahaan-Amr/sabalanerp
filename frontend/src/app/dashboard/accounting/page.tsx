'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FaBalanceScale,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFileInvoice,
  FaHistory,
  FaMoneyCheckAlt,
  FaReceipt,
  FaSync,
  FaUserClock,
  FaUserPlus,
} from 'react-icons/fa';
import {
  ErpActionGrid,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
} from '@/components/erp';
import { accountingAPI, hrHiringMetricsAPI } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import {
  CompactQueueItem,
  QueueList,
  StatusBadge,
  accountingIcons,
  dateFa,
  money,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';
import { AccountingDashboardPrototype } from '@/features/accounting/prototype/AccountingDashboardPrototype';
import { HR_HIRING_METRIC_VIEWS } from '@/features/hr-hiring/hrHiringMetricViews';
import {
  clearHrHiringMetrics,
  pendingHrHiringMetrics,
  resolveHrHiringMetrics,
  type HrHiringMetricsState,
} from '@/features/accounting/hrHiringMetricsState';

export default function AccountingDashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const currentUserId = user?.id;
  const [workspace, setWorkspace] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showPrototype, setShowPrototype] = useState(false);
  const [hrMetrics, setHrMetrics] = useState<HrHiringMetricsState>(pendingHrHiringMetrics);
  const hrRequestGeneration = useRef(0);

  const loadWorkspace = async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getWorkspace();
      if (response.data.success) {
        setWorkspace(response.data.data);
      }
    } catch (error) {
      console.error('Error loading accounting workspace:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadHrMetrics = useCallback(async () => {
    const requestGeneration = ++hrRequestGeneration.current;
    setHrMetrics(pendingHrHiringMetrics());
    try {
      const response = await hrHiringMetricsAPI.getDashboardMetrics();
      if (requestGeneration !== hrRequestGeneration.current) return;
      if (!response.data.success) {
        setHrMetrics(clearHrHiringMetrics('failed'));
        return;
      }
      setHrMetrics(resolveHrHiringMetrics(response.data.data));
    } catch {
      if (requestGeneration === hrRequestGeneration.current) {
        setHrMetrics(clearHrHiringMetrics('failed'));
      }
    }
  }, []);

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUserId) {
      hrRequestGeneration.current += 1;
      setHrMetrics(clearHrHiringMetrics('unavailable'));
      return;
    }
    void loadHrMetrics();
  }, [authLoading, currentUserId, loadHrMetrics]);

  useEffect(() => {
    const revalidateOnFocus = () => {
      if (document.visibilityState === 'visible' && currentUserId) void loadHrMetrics();
    };
    window.addEventListener('focus', revalidateOnFocus);
    document.addEventListener('visibilitychange', revalidateOnFocus);
    return () => {
      window.removeEventListener('focus', revalidateOnFocus);
      document.removeEventListener('visibilitychange', revalidateOnFocus);
    };
  }, [currentUserId, loadHrMetrics]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setShowPrototype(
      process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES === '1'
      && params.get('prototype') === 'accounting-dashboard',
    );
  }, []);

  if (showPrototype) {
    return <AccountingDashboardPrototype />;
  }

  if (loading) {
    return <ErpLoading />;
  }

  const queues = workspace?.queues || {};
  const commandCenter = workspace?.commandCenter || {};
  const refreshDashboard = () => {
    void loadWorkspace();
    if (currentUserId) void loadHrMetrics();
  };
  const hrMetricsAvailable = hrMetrics.status === 'available';

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="داشبورد حسابداری"
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: refreshDashboard, tone: 'neutral' },
      ]}
    >
      <ErpActionGrid
        columns={4}
        items={[
          {
            title: 'قراردادهای قابل بررسی',
            href: '/dashboard/accounting/contracts?view=reviewable',
            icon: FaClipboardCheck,
            tone: 'primary',
            badge: <StatusBadge label={(commandCenter.reviewableContracts?.count || 0).toLocaleString('fa-IR')} tone="primary" />,
          },
          {
            title: 'پیش‌نویس صورتحساب‌ها',
            href: '/dashboard/accounting/invoice-candidates?view=actionable',
            icon: FaFileInvoice,
            tone: 'info',
            badge: <StatusBadge label={(commandCenter.invoiceCandidates?.count || 0).toLocaleString('fa-IR')} tone="info" />,
          },
          {
            title: 'دریافت‌ها و چک‌ها',
            href: '/dashboard/accounting/payments',
            icon: FaMoneyCheckAlt,
            tone: 'warning',
            badge: <StatusBadge label={(commandCenter.checksDue?.count || 0).toLocaleString('fa-IR')} tone="warning" />,
          },
          {
            title: 'دریافتنی‌ها',
            href: '/dashboard/accounting/receivables',
            icon: FaReceipt,
            tone: 'success',
            badge: <StatusBadge label={(commandCenter.openReceivables?.count || 0).toLocaleString('fa-IR')} tone="success" />,
          },
          {
            title: 'استخدام: وثیقه و قرارداد',
            href: `/dashboard/hr/hiring?view=${HR_HIRING_METRIC_VIEWS.actionableCollateralOrContracts}`,
            icon: FaUserPlus,
            tone: 'info',
            badge: hrMetricsAvailable
              ? <StatusBadge label={hrMetrics.actionableCollateralOrContractCases.toLocaleString('fa-IR')} tone="info" />
              : undefined,
          },
          {
            title: 'قالب وثیقه استخدام',
            href: `/dashboard/hr/hiring/collateral-templates?view=${HR_HIRING_METRIC_VIEWS.activeCollateralTemplates}`,
            icon: FaClipboardCheck,
            tone: 'neutral',
            badge: hrMetricsAvailable
              ? <StatusBadge label={hrMetrics.activeCollateralTemplates.toLocaleString('fa-IR')} tone="neutral" />
              : undefined,
          },
          {
            title: 'مالیات و سامانه مودیان',
            href: '/dashboard/accounting/tax?view=needs-attention',
            icon: FaBalanceScale,
            tone: 'purple',
            badge: <StatusBadge label={(commandCenter.taxNotReady?.count || 0).toLocaleString('fa-IR')} tone="purple" />,
          },
          {
            title: 'بررسی اصلاحات',
            href: '/dashboard/accounting/correction-requests?view=active',
            icon: FaExclamationTriangle,
            tone: 'warning',
            badge: <StatusBadge label={(commandCenter.correctionRequests?.count || 0).toLocaleString('fa-IR')} tone="warning" />,
          },
          {
            title: 'سوابق عملیات',
            href: '/dashboard/accounting/audit',
            icon: FaHistory,
            tone: 'neutral',
            badge: <StatusBadge label={(commandCenter.auditHistory?.count || 0).toLocaleString('fa-IR')} tone="neutral" />,
          },
          {
            title: 'عملکرد حسابداران',
            href: '/dashboard/accounting/performance?view=last30days',
            icon: FaUserClock,
            tone: 'primary',
            badge: <StatusBadge label={(commandCenter.accountantPerformance?.count || 0).toLocaleString('fa-IR')} tone="primary" />,
          },
        ]}
      />

      {hrMetrics.status === 'failed' && (
        <ErpInlineState
          kind="error"
          title="شاخص‌های استخدام در دسترس نیستند. برای تلاش دوباره از به‌روزرسانی استفاده کنید."
        />
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <QueueList
          title="دریافتنی‌های نزدیک سررسید"
          items={queues.receivables || []}
          emptyText="دریافتنی بازی برای نمایش وجود ندارد."
          actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/receivables', icon: FaReceipt, tone: 'success' }]}
          renderItem={(item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={accountingIcons.receivable}
              title="دریافتنی قرارداد"
              meta={`سررسید: ${dateFa(item.dueDate)}`}
              amount={money(item.remainingAmount, item.currency)}
              status={<StatusBadge status={item.status} />}
            />
          )}
        />

        <QueueList
          title="مالیات و سامانه مودیان"
          items={queues.tax || []}
          emptyText="پرونده مالیاتی فعالی در صف نیست."
          actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/tax', icon: FaBalanceScale, tone: 'purple' }]}
          renderItem={(item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={FaBalanceScale}
              title={taxStatusLabels[item.submissionStatus] || item.submissionStatus}
              meta={item.trackingCode ? `کد پیگیری: ${item.trackingCode}` : `آخرین تغییر: ${dateFa(item.updatedAt)}`}
              amount={money(item.taxableAmount)}
              status={<StatusBadge status={item.submissionStatus} />}
            />
          )}
        />
      </div>

      <ErpSection
        title="بررسی اصلاحات"
        description="درخواست‌هایی که حسابداری برای تکمیل اطلاعات فروش، مشتری، پرداخت، تحویل یا مالیات ثبت کرده است."
        actions={[{ label: 'مشاهده همه', href: '/dashboard/accounting/correction-requests', icon: FaExclamationTriangle, tone: 'warning' }]}
      >
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {(queues.corrections || []).slice(0, 6).map((item: any) => (
            <CompactQueueItem
              key={item.id}
              icon={FaExclamationTriangle}
              title={item.accountantNote}
              meta={`اولویت: ${item.priority} · ${dateFa(item.createdAt)}`}
              status={<StatusBadge status={item.status} />}
            />
          ))}
          {(!queues.corrections || queues.corrections.length === 0) && (
            <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">درخواست اصلاح بازی وجود ندارد.</p>
          )}
        </div>
      </ErpSection>
    </ErpPage>
  );
}
