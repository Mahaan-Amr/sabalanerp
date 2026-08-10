'use client';

import { useCallback, useEffect, useReducer, useState } from 'react';
import { FaClock, FaExclamationTriangle, FaHistory, FaInbox, FaSync, FaUserShield } from 'react-icons/fa';
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
      dispatch({ type: 'success', data: { summary: summary.data.data, duties: duties.data.data, view } });
    } catch {
      dispatch({ type: 'failure', message: 'به‌روزرسانی وظایف انجام نشد.' });
    }
  }, [view, workspace]);

  useEffect(() => { void load(); }, [load]);

  if (!state.data && state.loading) {
    return (
      <ErpPage eyebrow="وظایف بین‌واحدی" title="وظایف منابع انسانی" backHref={`/dashboard/${workspace}`}>
        <ErpSkeleton lines={5} label="در حال بارگذاری وظایف" />
      </ErpPage>
    );
  }
  if (!state.data) {
    return (
      <ErpPage eyebrow="وظایف بین‌واحدی" title="وظایف منابع انسانی" backHref={`/dashboard/${workspace}`}>
        <ErpInlineState kind="error" title={state.error || 'وظایف در دسترس نیست.'} action={{ label: 'تلاش دوباره', icon: FaSync, onClick: load }} />
      </ErpPage>
    );
  }

  const { summary, duties } = state.data;
  const displayedView = state.loading || state.stale ? state.data.view : view;
  const options = [
    { value: 'assigned' as const, label: 'وظایف من', icon: FaInbox, count: summary.open },
    ...(summary.canManageTriage ? [{ value: 'triage' as const, label: 'نیازمند تعیین مسئول', icon: FaUserShield, count: summary.triage }] : []),
    { value: 'history' as const, label: 'تاریخچه', icon: FaHistory },
  ];

  return (
    <ErpPage
      eyebrow="وظایف بین‌واحدی"
      title="وظایف منابع انسانی"
      description="فقط اطلاعات لازم برای همین وظیفه نمایش داده می‌شود."
      backHref={`/dashboard/${workspace}`}
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: load, disabled: state.loading }]}
    >
      {state.stale && <ErpInlineState kind="stale" title={`${state.error} آخرین نمایش موفق حفظ شده است.`} action={{ label: 'تلاش دوباره', onClick: load }} />}
      <ErpMetricGrid items={[
        { label: 'باز', value: summary.open.toLocaleString('fa-IR'), icon: FaInbox, tone: 'info' },
        { label: 'تا ۲۴ ساعت', value: summary.dueSoon.toLocaleString('fa-IR'), icon: FaClock, tone: 'warning' },
        { label: 'گذشته از موعد', value: summary.overdue.toLocaleString('fa-IR'), icon: FaExclamationTriangle, tone: summary.overdue ? 'danger' : 'neutral' },
        ...(summary.canManageTriage ? [{ label: 'بدون مسئول', value: summary.triage.toLocaleString('fa-IR'), icon: FaUserShield, tone: 'purple' as const }] : []),
      ]} />
      <ErpSection>
        <ErpSegmentedControl options={options} value={displayedView} onChange={setView} />
      </ErpSection>
      {state.loading && <ErpInlineState kind="empty" title="در حال به‌روزرسانی" />}
      {!duties.length ? (
        <ErpEmptyState
          title={displayedView === 'triage' ? 'وظیفه بدون مسئول وجود ندارد' : displayedView === 'history' ? 'تاریخچه‌ای وجود ندارد' : 'وظیفه بازی ندارید'}
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
              {duty.detailAvailable ? (
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
