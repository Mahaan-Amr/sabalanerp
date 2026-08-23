'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { FaClock, FaExclamationTriangle, FaInbox, FaSync, FaUserCheck, FaUserShield } from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpMetricGrid,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSkeleton,
} from '@/components/erp';
import { hrDutyApi, type DestinationDuty, type DestinationDutySummary, type DestinationDutyView } from './hrDutyApi';
import { initialDestinationDutyState, reduceDestinationDutyState } from './destinationDutyState';
import { buildDutyQueueTabs, dutyQueueEmptyTitle } from '@/features/cross-workspace-duties/dutyQueuePresentation';
import { DestinationDutyClaimAction } from './DestinationDutyClaimAction';

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

type QueueData = { summary: DestinationDutySummary; duties: DestinationDuty[]; view: DestinationDutyView };

export function DestinationDutyQueue({ workspace }: { workspace: string }) {
  const [view, setView] = useState<DestinationDutyView>('assigned');
  const [state, dispatch] = useReducer(
    reduceDestinationDutyState<QueueData>,
    initialDestinationDutyState as typeof initialDestinationDutyState & { data: QueueData | null },
  );

  const load = useCallback(async () => {
    dispatch({ type: 'start' });
    try {
      const [summary, duties] = await Promise.all([
        hrDutyApi.summary(workspace),
        hrDutyApi.list(workspace, view),
      ]);
      let resolvedSummary = summary.data.data;
      if (view === 'history' && duties.data.data.length > 0) {
        const seenThrough = duties.data.data.reduce((latest, duty) => (
          duty.updatedAt > latest ? duty.updatedAt : latest
        ), duties.data.data[0].updatedAt);
        try {
          await hrDutyApi.markHistorySeen(workspace, seenThrough);
          resolvedSummary = (await hrDutyApi.summary(workspace)).data.data;
        } catch {
          // History remains readable; the badge stays until the acknowledgement succeeds.
        }
      }
      if (view === 'available' && duties.data.data.length > 0) {
        const seenThrough = duties.data.data.reduce((latest, duty) => (
          duty.updatedAt > latest ? duty.updatedAt : latest
        ), duties.data.data[0].updatedAt);
        try {
          await hrDutyApi.markAvailableSeen(workspace, seenThrough);
          resolvedSummary = (await hrDutyApi.summary(workspace)).data.data;
        } catch {
          // Available work remains readable; the badge stays until acknowledgement succeeds.
        }
      }
      dispatch({ type: 'success', data: { summary: resolvedSummary, duties: duties.data.data, view } });
    } catch {
      dispatch({ type: 'failure', message: 'به‌روزرسانی وظایف انجام نشد.' });
    }
  }, [view, workspace]);

  useEffect(() => { void load(); }, [load]);

  if (!state.data && state.loading) {
    return (
      <ErpPage eyebrow="وظایف بین‌واحدی" title="وظایف بین‌واحدی" backHref={`/dashboard/${workspace}`}>
        <ErpSkeleton lines={5} label="در حال بارگذاری وظایف" />
      </ErpPage>
    );
  }
  if (!state.data) {
    return (
      <ErpPage eyebrow="وظایف بین‌واحدی" title="وظایف بین‌واحدی" backHref={`/dashboard/${workspace}`}>
        <ErpInlineState kind="error" title={state.error || 'وظایف در دسترس نیست.'} action={{ label: 'تلاش دوباره', icon: FaSync, onClick: load }} />
      </ErpPage>
    );
  }

  const { summary, duties } = state.data;
  const displayedView = state.loading || state.stale ? state.data.view : view;
  const options = buildDutyQueueTabs(summary);
  return (
    <ErpPage
      eyebrow="وظایف بین‌واحدی"
      title="وظایف بین‌واحدی"
      description="فقط اطلاعات لازم برای همین وظیفه نمایش داده می‌شود."
      backHref={`/dashboard/${workspace}`}
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: state.loading }]}
    >
      {state.stale && <ErpInlineState kind="stale" title={`${state.error} آخرین نمایش موفق حفظ شده است.`} action={{ label: 'تلاش دوباره', onClick: load }} />}
      <ErpMetricGrid items={[
        { label: 'باز', value: summary.open.toLocaleString('fa-IR'), icon: FaInbox, tone: 'info' },
        { label: 'تا ۲۴ ساعت', value: summary.dueSoon.toLocaleString('fa-IR'), icon: FaClock, tone: 'warning' },
        { label: 'گذشته از موعد', value: summary.overdue.toLocaleString('fa-IR'), icon: FaExclamationTriangle, tone: summary.overdue ? 'danger' : 'neutral' },
        { label: 'قابل دریافت', value: summary.available.toLocaleString('fa-IR'), icon: FaUserCheck, tone: 'success' },
        ...(summary.canManageTriage ? [{ label: 'بدون مسئول', value: summary.triage.toLocaleString('fa-IR'), icon: FaUserShield, tone: 'purple' as const }] : []),
      ]} />
      <ErpSection>
        <ErpSegmentedControl options={options} value={displayedView} onChange={setView} />
      </ErpSection>
      {state.loading && <ErpInlineState kind="empty" title="در حال به‌روزرسانی" />}
      {!duties.length ? (
        <ErpEmptyState
          title={dutyQueueEmptyTitle(displayedView)}
          description="این شمارش واقعی است و با به‌روزرسانی تغییر می‌کند."
          icon={FaInbox}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {duties.map((duty) => (
            <ErpCard key={duty.id} className="flex min-h-44 flex-col justify-between gap-4 p-4">
              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="sds-text-primary text-base font-semibold">{duty.fields.title || actionLabel[duty.sourceActionCode] || 'وظیفه سازمانی'}</h2>
                  <ErpBadge tone={duty.overdue ? 'danger' : duty.status === 'OPEN' ? 'info' : 'neutral'}>{statusLabel[duty.status] || duty.status}</ErpBadge>
                </div>
                <p className="sds-text-muted text-sm">مهلت: {duty.dueAtDisplay}</p>
                {duty.overdue && <p className="text-sm font-semibold text-[var(--sds-danger)]">مهلت انجام گذشته است.</p>}
              </div>
              {duty.access === 'AVAILABLE' ? (
                <DestinationDutyClaimAction duty={duty} disabled={state.loading} onClaimed={() => setView('assigned')} />
              ) : duty.detailAvailable ? (
                <ErpButton label="مشاهده وظیفه" href={`/dashboard/${workspace}/duties/${duty.id}`} tone="primary" variant="solid" />
              ) : (
                <p className="sds-text-muted text-sm">این سابقه بسته شده و دیگر پیوند عملیاتی ندارد.</p>
              )}
            </ErpCard>
          ))}
        </div>
      )}
    </ErpPage>
  );
}
