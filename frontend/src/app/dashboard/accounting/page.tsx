'use client';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FaSync,
} from 'react-icons/fa';
import {
  ErpInlineState,
  ErpPage,
} from '@/components/erp';
import { accountingAPI, hrHiringMetricsAPI } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { AccountingFinancialTrend } from '@/features/accounting/AccountingFinancialTrend';
import {
  failFinancialTrend,
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
import {
  AccountingDashboardSkeleton,
  AccountingOperationalMetricGrid,
} from '@/features/accounting/AccountingDashboardPresentation';

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
  const [trendRange, setTrendRange] = useState<FinancialTrendRange>('6m');
  const [financialTrend, setFinancialTrend] = useState<FinancialTrendState>(pendingFinancialTrend);
  const hrRequestGeneration = useRef(0);
  const workspaceRequestGeneration = useRef(0);
  const trendRequestGeneration = useRef(0);
  const rawSearchParams = searchParams.toString();
  const dashboardQuery = useMemo(
    () => canonicalizeAccountingDashboardQuery(new URLSearchParams(rawSearchParams)),
    [rawSearchParams],
  );
  const workspace = workspaceState.data;
  const loading = workspaceState.loading;

  const loadWorkspace = useCallback(async () => {
    const requestGeneration = ++workspaceRequestGeneration.current;
    dispatchWorkspace({ type: 'start' });
    try {
      const response = await accountingAPI.getWorkspace({
        due: dashboardQuery.state.due || undefined,
        deadlineType: dashboardQuery.state.deadlineType === 'all' ? undefined : dashboardQuery.state.deadlineType,
      });
      if (requestGeneration !== workspaceRequestGeneration.current) return;
      if (!response.data.success) {
        dispatchWorkspace({ type: 'failure', message: 'داده‌های حسابداری دریافت نشد.' });
        return;
      }
      dispatchWorkspace({ type: 'success', data: response.data.data });
    } catch (error) {
      if (requestGeneration !== workspaceRequestGeneration.current) return;
      console.error('Error loading accounting workspace:', error);
      dispatchWorkspace({ type: 'failure', message: 'ارتباط با حسابداری برقرار نشد.' });
    }
  }, [dashboardQuery.state.deadlineType, dashboardQuery.state.due]);

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

  const loadFinancialTrend = useCallback(async (range: FinancialTrendRange) => {
    const requestGeneration = ++trendRequestGeneration.current;
    setFinancialTrend((previous) => pendingFinancialTrend(previous, range));
    try {
      const response = await accountingAPI.getFinancialTrend(range);
      if (requestGeneration !== trendRequestGeneration.current) return;
      if (!response.data.success) {
        setFinancialTrend((previous) => failFinancialTrend(previous));
        return;
      }
      setFinancialTrend((previous) => resolveFinancialTrend(previous, response.data.data));
    } catch {
      if (requestGeneration === trendRequestGeneration.current) {
        setFinancialTrend((previous) => failFinancialTrend(previous));
      }
    }
  }, []);

  useEffect(() => {
    void loadFinancialTrend(trendRange);
  }, [loadFinancialTrend, trendRange]);

  useEffect(() => {
    const canonicalSearch = dashboardQuery.params.toString();
    if (canonicalSearch !== rawSearchParams) {
      router.replace(`/dashboard/accounting${canonicalSearch ? `?${canonicalSearch}` : ''}`, { scroll: false });
      return;
    }
    void loadWorkspace();
  }, [dashboardQuery.params, loadWorkspace, rawSearchParams, router]);

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

  const financialTrendPanel = (
    <AccountingFinancialTrend
      range={trendRange}
      state={financialTrend}
      onRangeChange={setTrendRange}
      onRetry={() => void loadFinancialTrend(trendRange)}
      compact
    />
  );

  if (!workspace && loading) {
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
          action={{ label: 'تلاش دوباره', icon: FaSync, onClick: loadWorkspace, tone: 'primary' }}
        />
      </ErpPage>
    );
  }

  const commandCenter = workspace?.commandCenter || {};
  const refreshDashboard = () => {
    void loadWorkspace();
    void loadFinancialTrend(trendRange);
    if (currentUserId) void loadHrMetrics();
  };
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
      {workspaceState.stale && (
        <ErpInlineState
          kind="stale"
          title="آخرین نمایش موفق حفظ شده است؛ به‌روزرسانی انجام نشد."
          action={{ label: 'تلاش دوباره', icon: FaSync, onClick: loadWorkspace, tone: 'warning' }}
        />
      )}
      {loading && workspace && (
        <p role="status" className="sds-text-muted text-sm">در حال به‌روزرسانی داده‌های حسابداری…</p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(20rem,.9fr)]">
        <div className="min-w-0">{financialTrendPanel}</div>
        <div className="min-w-0">
          <AccountingDeadlinesPanel
            deadlines={workspace.deadlines}
            dashboardHref={dashboardHref}
            onTypeChange={(deadlineType) => router.replace(dashboardHref({ deadlineType }), { scroll: false })}
          />
        </div>
      </div>

      <AccountingOperationalMetricGrid commandCenter={commandCenter} hrMetrics={hrMetrics} />

      {hrMetrics.status === 'failed' && (
        <ErpInlineState
          kind="error"
          title="شاخص‌های استخدام در دسترس نیستند. برای تلاش دوباره از به‌روزرسانی استفاده کنید."
        />
      )}
    </ErpPage>
  );
}
