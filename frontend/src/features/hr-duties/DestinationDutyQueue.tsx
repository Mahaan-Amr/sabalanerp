'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { FaClock, FaExclamationTriangle, FaInbox, FaSync, FaUserCheck, FaUserShield } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpField,
  ErpInput,
  ErpMetricGrid,
  ErpNeumorphicMetricGrid,
  type ErpNeumorphicMetric,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSkeleton,
} from '@/components/erp';
import { hrDutyApi, type DestinationDuty, type DestinationDutySummary, type DestinationDutyView } from './hrDutyApi';
import { initialDestinationDutyState, reduceDestinationDutyState } from './destinationDutyState';
import { useAuth } from '@/contexts/AuthContext';
import { announceCrossWorkspaceDutyChanged, CROSS_WORKSPACE_DUTY_CHANGED_EVENT, requestCrossWorkspaceDutySummary } from '@/features/cross-workspace-duties/crossWorkspaceDutyApi';
import { buildDutyQueueTabs, dutyQueueEmptyTitle } from '@/features/cross-workspace-duties/dutyQueuePresentation';
import { DestinationDutyClaimAction } from './DestinationDutyClaimAction';
import { destinationDutyHref } from '@/features/cross-workspace-duties/dutyDestination';
import { getSalesOperationalErrorMessage } from '@/features/sales/salesOperationalError';

const statusLabel: Record<string, string> = {
  OPEN: 'باز', COMPLETED: 'تکمیل‌شده', WAIVED: 'جایگزین‌شده', CANCELLED: 'لغوشده',
};
const actionLabel: Record<string, string> = {
  FINANCE_RECORDING: 'ثبت مالی',
  FINANCE_APPROVAL: 'تأیید مالی',
  COMPANY_MANAGER_REVIEW: 'بررسی مدیریت شرکت',
  COMPANY_MANAGER_DECISION: 'تصمیم مدیریت شرکت',
  RESPONSIBLE_SUPERVISOR_REVIEW: 'بررسی سرپرست مسئول',
  PAYROLL_PREPARATION: 'آماده‌سازی حقوق',
  PAYROLL_APPROVAL: 'تأیید حقوق',
};

type QueueData = { duties: DestinationDuty[]; view: DestinationDutyView; search: string; nextCursor?: string | null };
type QueueProps = { workspace: string; metricPresentation?: 'default' | 'neumorphic' };

export function DestinationDutyQueue(props: QueueProps) {
  const { user } = useAuth();
  return user && <WorkspaceDutyQueue key={`${user.id}:${props.workspace}`} {...props} />;
}

function WorkspaceDutyQueue({ workspace, metricPresentation = 'default' }: QueueProps) {
  const { user } = useAuth();
  const [view, setView] = useState<DestinationDutyView>('assigned');
  const [search, setSearch] = useState('');
  const [historySearch, setHistorySearch] = useState('');
  const queueSequence = useRef({ value: 0 });
  const summarySequence = useRef({ value: 0 });
  useEffect(() => {
    const timer = window.setTimeout(() => setHistorySearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const [state, dispatch] = useReducer(reduceDestinationDutyState<QueueData>, initialDestinationDutyState);
  const [summaryState, dispatchSummary] = useReducer(
    reduceDestinationDutyState<DestinationDutySummary>, initialDestinationDutyState,
  );

  const loadSummary = useCallback(async (change?: Event) => {
    if (!user) return;
    const sequence = ++summarySequence.current.value;
    dispatchSummary({ type: 'start' });
    try {
      const summary = await requestCrossWorkspaceDutySummary(user, workspace, change);
      if (sequence === summarySequence.current.value) dispatchSummary({ type: 'success', data: summary });
    } catch {
      if (sequence === summarySequence.current.value) {
        dispatchSummary({ type: 'failure', message: 'شمارش وظایف در دسترس نیست.' });
      }
    }
  }, [user, workspace]);

  const query = view === 'history' ? historySearch : '';
  const load = useCallback(async (previous?: QueueData) => {
    const sequence = ++queueSequence.current.value;
    dispatch({ type: 'start' });
    try {
      const result: { data: DestinationDuty[]; nextCursor?: string | null } = view === 'history'
        ? (await hrDutyApi.historyPage(workspace, query, previous?.nextCursor ?? undefined)).data
        : (await hrDutyApi.list(workspace, view)).data;
      if (sequence !== queueSequence.current.value) return;
      const duties = result.data;
      dispatch({
        type: 'success',
        data: {
          duties: previous ? [...previous.duties, ...duties] : duties,
          view,
          search: query,
          nextCursor: result.nextCursor ?? null,
        },
      });

      const acknowledge = view === 'available' ? hrDutyApi.markAvailableSeen
        : view === 'history' && !query ? hrDutyApi.markHistorySeen : null;
      if (!acknowledge || !duties.length) return;
      const seenThrough = duties.reduce((latest, duty) => duty.updatedAt > latest ? duty.updatedAt : latest, duties[0].updatedAt);
      try {
        await acknowledge(workspace, seenThrough);
        announceCrossWorkspaceDutyChanged();
      } catch {
        // Keep the current count until the receipt can be confirmed.
      }
    } catch (error) {
      if (sequence !== queueSequence.current.value) return;
      dispatch({ type: 'failure', message: getSalesOperationalErrorMessage(error, {
        failedAction: 'به‌روزرسانی وظایف',
        nextStep: 'صفحه را تازه‌سازی و دوباره تلاش کنید.',
      }) });
    }
  }, [view, workspace, query]);

  useEffect(() => {
    const sequence = queueSequence.current;
    void load();
    return () => { sequence.value++; };
  }, [load]);
  useEffect(() => {
    const sequence = summarySequence.current;
    const onChange = (event: Event) => void loadSummary(event);
    void loadSummary();
    window.addEventListener(CROSS_WORKSPACE_DUTY_CHANGED_EVENT, onChange);
    return () => {
      sequence.value++;
      window.removeEventListener(CROSS_WORKSPACE_DUTY_CHANGED_EVENT, onChange);
    };
  }, [loadSummary]);

  const refresh = () => {
    void load();
    void loadSummary();
  };
  const summary = summaryState.data;
  const duties = state.data?.duties ?? [];
  const displayedView = state.data?.view ?? view;
  const options = buildDutyQueueTabs(summary ?? undefined);
  const metrics: ErpNeumorphicMetric[] = summary ? [
    { id: 'open', label: 'باز', value: summary.open.toLocaleString('fa-IR'), icon: FaInbox, tone: 'info' },
    { id: 'due-soon', label: 'تا ۲۴ ساعت', value: summary.dueSoon.toLocaleString('fa-IR'), icon: FaClock, tone: 'warning' },
    { id: 'overdue', label: 'گذشته از موعد', value: summary.overdue.toLocaleString('fa-IR'), icon: FaExclamationTriangle, tone: summary.overdue ? 'danger' : 'neutral' },
    { id: 'available', label: 'قابل دریافت', value: summary.available.toLocaleString('fa-IR'), icon: FaUserCheck, tone: 'success' },
    ...(summary.canManageTriage ? [{ id: 'triage', label: 'بدون مسئول', value: summary.triage.toLocaleString('fa-IR'), icon: FaUserShield, tone: 'purple' as const }] : []),
  ] : [];
  return (
    <ErpPage
      eyebrow="وظایف بین‌واحدی"
      title="وظایف بین‌واحدی"
      description="فقط اطلاعات لازم برای همین وظیفه نمایش داده می‌شود."
      backHref={`/dashboard/${workspace}`}
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: refresh, disabled: state.loading }]}
    >
      {state.stale && <ErpInlineState kind="stale" title={`${state.error} آخرین نمایش موفق حفظ شده است.`} action={{ label: 'تلاش دوباره', onClick: () => void load() }} />}
      {summaryState.error && <ErpInlineState
        kind={summaryState.stale ? 'stale' : 'error'}
        title={summaryState.error}
        action={{ label: 'تلاش دوباره', onClick: () => void loadSummary() }}
      />}
      {!summary && summaryState.loading && <ErpSkeleton lines={1} label="در حال بارگذاری شمارش وظایف" />}
      {summary && (metricPresentation === 'neumorphic'
        ? <ErpNeumorphicMetricGrid items={metrics} />
        : <ErpMetricGrid items={metrics} />)}
      <ErpSection>
        <ErpSegmentedControl options={options} value={displayedView} onChange={setView} />
        {view === 'history' && <ErpField label="جست‌وجوی سوابق" className="mt-4">
          <ErpInput type="search" value={search} onChange={event => setSearch(event.target.value)}
            placeholder="شماره قرارداد، نام مشتری یا عنوان وظیفه" maxLength={200} />
        </ErpField>}
      </ErpSection>
      {state.loading && <ErpSkeleton lines={state.data ? 1 : 5} label="در حال بارگذاری وظایف" />}
      {!state.data && state.error && <ErpInlineState
        kind="error" title={state.error} action={{ label: 'تلاش دوباره', icon: FaSync, onClick: () => void load() }}
      />}
      {state.data && (duties.length === 0 ? (
        <ErpEmptyState
          title={displayedView === 'history' && state.data.search ? 'سابقه‌ای با این عبارت پیدا نشد.' : dutyQueueEmptyTitle(displayedView)}
          icon={FaInbox}
        />
      ) : (
        <div className={metricPresentation === "neumorphic" ? "space-y-3" : "grid grid-cols-1 gap-3 lg:grid-cols-2"}>
          {duties.map((duty) => (
            <ErpCard key={duty.id} className={metricPresentation === "neumorphic" ? "flex flex-col justify-between gap-4 p-4 sm:flex-row sm:items-center" : "flex min-h-44 flex-col justify-between gap-4 p-4"}>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="sds-text-primary text-base font-semibold">{duty.fields.title || actionLabel[duty.sourceActionCode] || 'وظیفه سازمانی'}</h2>
                  <ErpBadge tone={duty.overdue ? 'danger' : duty.status === 'OPEN' ? 'info' : 'neutral'}>{(duty.result as { actionCode?: string } | null)?.actionCode === 'EDIT_PERIOD_EXPIRED' ? 'مهلت پایان‌یافته؛ ارجاع به حسابداری' : statusLabel[duty.status] || 'وضعیت نامشخص'}</ErpBadge>
                </div>
                <p className="sds-text-muted text-sm">مهلت: {duty.dueAtDisplay}</p>
                {duty.overdue && <p className="text-sm font-semibold text-[var(--sds-danger)]">مهلت انجام گذشته است.</p>}
              </div>
              {duty.access === 'AVAILABLE' ? (
                <DestinationDutyClaimAction duty={duty} disabled={state.loading} onClaimed={() => setView('assigned')} />
              ) : duty.detailAvailable ? (
                <ErpButton label="مشاهده وظیفه" href={destinationDutyHref(workspace, duty)} tone="primary" variant="solid" />
              ) : (
                <p className="sds-text-muted text-sm">این سابقه بسته شده و دیگر پیوند عملیاتی ندارد.</p>
              )}
            </ErpCard>
          ))}
        </div>
      ))}
      {state.data?.nextCursor && displayedView === view && state.data.search === query && <ErpButton
        label="نمایش سوابق بیشتر"
        disabled={state.loading}
        onClick={() => { if (state.data) void load(state.data); }}
      />}
    </ErpPage>
  );
}
