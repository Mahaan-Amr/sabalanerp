'use client';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FaBalanceScale,
  FaFileInvoice,
  FaSync,
} from 'react-icons/fa';
import {
  ErpInlineState,
  ErpNeumorphicActionGrid,
  ErpPage,
} from '@/components/erp';
import { accountingAPI, hrHiringMetricsAPI } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AccountingFinancialTrend } from '@/features/accounting/AccountingFinancialTrend';
import { AccountingDashboardSkeleton, AccountingOperationalMetricGrid } from '@/features/accounting/AccountingDashboardPresentation';
import {
  pendingFinancialTrend,
  resolveFinancialTrend,
  type FinancialTrendRange,
  type FinancialTrendState,
} from '@/features/accounting/accountingFinancialTrendState';
import {
  clearHrHiringMetrics,
  pendingHrHiringMetrics,
  resolveHrHiringMetrics,
  type HrHiringMetricsState,
} from '@/features/accounting/hrHiringMetricsState';
import AccountingDeadlinesPanel from '@/features/accounting/AccountingDeadlinesPanel';
import {
  reduceAccountingWorkspaceLoad,
  type DeadlineBucket,
} from '@/features/accounting/accountingDeadlines';
import {
  canonicalizeAccountingDashboardQuery,
  patchAccountingDashboardQuery,
} from '@/features/accounting/accountingQueryState';

export default function AccountingDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const currentUserId = user?.id;
  const [workspaceState, dispatchWorkspace] = useReducer(reduceAccountingWorkspaceLoad<any>, {
    data: null,
    loading: true,
    stale: false,
    error: null,
  });
  const [hrMetrics, setHrMetrics] = useState<HrHiringMetricsState>(pendingHrHiringMetrics);
  const [hrMetricsOwnerId, setHrMetricsOwnerId] = useState<string | null>(null);
  const [trendRange, setTrendRange] = useState<FinancialTrendRange>('6m');
  const [financialTrend, setFinancialTrend] = useState<FinancialTrendState>(pendingFinancialTrend);
  const hrRequestGeneration = useRef(0);
  const workspaceRequestGeneration = useRef(0);
  const trendRequestGeneration = useRef(0);
  const trendRangeRef = useRef<FinancialTrendRange>('6m');
  const dashboardOwnerRef = useRef<string | null>(null);
  const rawSearchParams = searchParams.toString();
  const dashboardQuery = useMemo(
    () => canonicalizeAccountingDashboardQuery(new URLSearchParams(rawSearchParams)),
    [rawSearchParams],
  );
  const workspace = workspaceState.data;
  const loading = workspaceState.loading;

  const loadDashboard = useCallback(async () => {
    const requestGeneration = ++workspaceRequestGeneration.current;
    const trendGeneration = ++trendRequestGeneration.current;
    const requestedRange = trendRangeRef.current;
    dispatchWorkspace({ type: 'start' });
    setFinancialTrend((previous) => pendingFinancialTrend(previous, requestedRange));
    try {
      const response = await accountingAPI.getDashboard({
        range: requestedRange,
        due: dashboardQuery.state.due || undefined,
        deadlineType: dashboardQuery.state.deadlineType === 'all' ? undefined : dashboardQuery.state.deadlineType,
      });
      if (requestGeneration !== workspaceRequestGeneration.current) return;
      if (!response.data.success) {
        dispatchWorkspace({ type: 'failure', message: 'داده‌های حسابداری دریافت نشد.' });
        if (trendGeneration === trendRequestGeneration.current) setFinancialTrend({ status: 'error', data: null });
        return;
      }
      dispatchWorkspace({ type: 'success', data: response.data.data.workspace });
      if (trendGeneration === trendRequestGeneration.current) {
        setFinancialTrend(response.data.data.trendError || !response.data.data.trend
          ? { status: 'error', data: null }
          : { status: 'available', data: response.data.data.trend });
      }
    } catch (error) {
      if (requestGeneration !== workspaceRequestGeneration.current) return;
      console.error('Error loading accounting workspace:', error);
      dispatchWorkspace({ type: 'failure', message: 'ارتباط با حسابداری برقرار نشد.' });
      if (trendGeneration === trendRequestGeneration.current) setFinancialTrend({ status: 'error', data: null });
    }
  }, [dashboardQuery.state.deadlineType, dashboardQuery.state.due]);

  const loadHrMetrics = useCallback(async (userId: string) => {
    const requestGeneration = ++hrRequestGeneration.current;
    setHrMetricsOwnerId(userId);
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

  const loadFinancialTrend = useCallback(async (range: FinancialTrendRange) => {
    const requestGeneration = ++trendRequestGeneration.current;
    setFinancialTrend((previous) => pendingFinancialTrend(previous, range));
    try {
      const response = await accountingAPI.getFinancialTrend(range);
      if (requestGeneration !== trendRequestGeneration.current) return;
      if (!response.data.success) {
        setFinancialTrend({ status: 'error', data: null });
        return;
      }
      setFinancialTrend((previous) => resolveFinancialTrend(previous, response.data.data));
    } catch {
      if (requestGeneration === trendRequestGeneration.current) {
        setFinancialTrend({ status: 'error', data: null });
      }
    }
  }, []);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUserId) {
      dashboardOwnerRef.current = null;
      workspaceRequestGeneration.current += 1;
      trendRequestGeneration.current += 1;
      dispatchWorkspace({ type: 'reset' });
      setFinancialTrend(pendingFinancialTrend());
      return;
    }
    if (dashboardOwnerRef.current !== currentUserId) {
      dashboardOwnerRef.current = currentUserId;
      workspaceRequestGeneration.current += 1;
      trendRequestGeneration.current += 1;
      dispatchWorkspace({ type: 'reset' });
      setFinancialTrend(pendingFinancialTrend());
    }
    const canonicalSearch = dashboardQuery.params.toString();
    if (canonicalSearch !== rawSearchParams) {
      router.replace(`/dashboard/accounting${canonicalSearch ? `?${canonicalSearch}` : ''}`, { scroll: false });
      return;
    }
    void loadDashboard();
  }, [authLoading, currentUserId, dashboardQuery.params, loadDashboard, rawSearchParams, router]);

  useEffect(() => {
    if (authLoading) return;
    if (!currentUserId) {
      hrRequestGeneration.current += 1;
      setHrMetricsOwnerId(null);
      setHrMetrics(clearHrHiringMetrics('unavailable'));
      return;
    }
    void loadHrMetrics(currentUserId);
  }, [authLoading, currentUserId, loadHrMetrics]);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | null = null;
    const revalidateOnFocus = () => {
      if (document.visibilityState === 'visible' && currentUserId) {
        if (focusTimer) clearTimeout(focusTimer);
        focusTimer = setTimeout(() => {
          focusTimer = null;
          if (document.visibilityState !== 'visible') return;
          void loadHrMetrics(currentUserId);
          void loadDashboard();
        }, 100);
      }
    };
    window.addEventListener('focus', revalidateOnFocus);
    document.addEventListener('visibilitychange', revalidateOnFocus);
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      window.removeEventListener('focus', revalidateOnFocus);
      document.removeEventListener('visibilitychange', revalidateOnFocus);
    };
  }, [currentUserId, loadHrMetrics, loadDashboard]);

  const financialTrendPanel = (
    <AccountingFinancialTrend
      range={trendRange}
      state={financialTrend}
      onRangeChange={(range) => {
        trendRangeRef.current = range;
        setTrendRange(range);
        void loadFinancialTrend(range);
      }}
      onRetry={() => void loadFinancialTrend(trendRange)}
      compact
    />
  );

  const hrMetricsPending = Boolean(currentUserId &&
    (hrMetricsOwnerId !== currentUserId || hrMetrics.status === 'pending'));
  if (!authLoading && !currentUserId) {
    return <ErpPage eyebrow="حسابداری" title="داشبورد حسابداری" backHref="/dashboard">
      <ErpInlineState kind="permission" title="برای مشاهده حسابداری وارد حساب خود شوید." />
    </ErpPage>;
  }
  if (authLoading || dashboardOwnerRef.current !== currentUserId || loading ||
      (workspace && hrMetricsPending)) {
    return (
      <ErpPage eyebrow="حسابداری" title="داشبورد حسابداری" backHref="/dashboard">
        <AccountingDashboardSkeleton />
      </ErpPage>
    );
  }

  if (!workspace) {
    return (
      <ErpPage eyebrow="حسابداری" title="داشبورد حسابداری" backHref="/dashboard">
        {financialTrendPanel}
        <ErpInlineState
          kind="error"
          title={workspaceState.error || 'داده‌های حسابداری در دسترس نیست.'}
          action={{ label: 'تلاش دوباره', icon: FaSync, onClick: loadDashboard, tone: 'primary' }}
        />
      </ErpPage>
    );
  }

  const commandCenter = workspace?.commandCenter || {};
  const refreshDashboard = () => {
    void loadDashboard();
    if (currentUserId) void loadHrMetrics(currentUserId);
  };
  const hrMetricsBelongToCurrentUser = Boolean(currentUserId && hrMetricsOwnerId === currentUserId);
  const dashboardHrMetrics = hrMetricsBelongToCurrentUser ? hrMetrics : { status: 'unavailable' as const };
  const dashboardHref = (patch: { due?: DeadlineBucket | ''; deadlineType?: 'all' | 'receivable' | 'check' }) => {
    const result = patchAccountingDashboardQuery(new URLSearchParams(rawSearchParams), patch);
    const query = result.params.toString();
    return `/dashboard/accounting${query ? `?${query}` : ''}`;
  };

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="داشبورد حسابداری"
      backHref="/dashboard"
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: refreshDashboard, tone: 'neutral' },
      ]}
    >
      <ErpInlineState
        kind="permission"
        title={<span>مرجع رسمی حسابداری، دفترکل جدید است.<small className="mt-1 block font-normal">رکوردهای مالی قدیمی فقط نمای عملیاتی و ارجاع سپیدار هستند و مانده رسمی نمی‌سازند.</small></span>}
        action={{ label: 'ورود به دفترکل و کدینگ', onClick: () => router.push('/dashboard/accounting/ledger'), tone: 'primary' }}
      />
      {workspaceState.stale && (
        <ErpInlineState
          kind="stale"
          title="آخرین نمایش موفق حفظ شده است؛ به‌روزرسانی انجام نشد."
          action={{ label: 'تلاش دوباره', icon: FaSync, onClick: loadDashboard, tone: 'warning' }}
        />
      )}
      {loading && workspace && (
        <p role="status" className="sds-text-muted text-sm">در حال به‌روزرسانی داده‌های حسابداری…</p>
      )}

      <AccountingOperationalMetricGrid commandCenter={commandCenter} hrMetrics={dashboardHrMetrics} />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,.9fr)]">
        <div className="min-w-0">{financialTrendPanel}</div>
        <div className="min-w-0">
          <AccountingDeadlinesPanel
            deadlines={workspace.deadlines}
            dashboardHref={dashboardHref}
            onTypeChange={(deadlineType) => router.replace(dashboardHref({ deadlineType }), { scroll: false })}
          />
        </div>
      </div>

      <ErpNeumorphicActionGrid
        title="دسترسی‌های مالی"
        desktopColumns={2}
        items={[
          {
            id: 'ledger',
            title: 'دفترکل و کدینگ',
            description: 'اسناد قطعی، دفتر روزنامه و تراز آزمایشی رسمی',
            href: '/dashboard/accounting/ledger',
            icon: FaBalanceScale,
          },
          {
            id: 'dispatch-documents',
            title: 'اسناد ارسال مشتری',
            description: 'بررسی و صدور بارنامه و صورت‌حساب محموله',
            href: '/dashboard/accounting/dispatch-documents',
            icon: FaFileInvoice,
          },
        ]}
      />

      {hrMetrics.status === 'failed' && (
        <ErpInlineState
          kind="error"
          title="شاخص‌های استخدام در دسترس نیستند. برای تلاش دوباره از به‌روزرسانی استفاده کنید."
        />
      )}
    </ErpPage>
  );
}
