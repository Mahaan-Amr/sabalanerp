'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaRedo } from 'react-icons/fa';
import {
  ErpInlineState,
  ErpSection,
  ErpShiftTimeline,
  ErpSkeleton,
  ErpStatus,
  ErpWorkspacePage,
} from '@/components/erp';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

const dateTime = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value, true) : '—';

export default function SecurityShiftReportDetailPage() {
  const { slotId } = useParams<{ slotId: string }>();
  const [report, setReport] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await securityAPI.getCompletedSecurityShift(slotId);
      setReport(response.data.data);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت گزارش شیفت ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [slotId]);

  useEffect(() => { load(); }, [load]);

  return (
    <ErpWorkspacePage
      title="گزارش شیفت"
      context={report ? `${dateTime(report.startsAt)} تا ${dateTime(report.endsAt)}` : slotId}
      backHref="/dashboard/security/reports"
      secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}
    >
      {loading && !report ? (
        <ErpSkeleton lines={7} />
      ) : error && !report ? (
        <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} />
      ) : report ? (
        <>
          {error && <ErpInlineState kind="stale" title="به‌روزرسانی ناموفق بود؛ آخرین اطلاعات موفق نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
          <ErpSection>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-black text-slate-950 dark:text-white">{report.effectivePersonnel?.name || report.plannedPersonnel?.name || 'شیفت گارد'}</h2>
                <p className="mt-1 text-sm text-slate-500">{report.title}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ErpStatus label={report.status === 'FORCE_CLOSED' ? 'بسته‌شده توسط مدیر' : 'تکمیل‌شده'} tone="neutral" emphasis="strong" />
                {report.isManagerCorrected && <ErpStatus label="اصلاح‌شده توسط مدیر" tone="warning" emphasis="strong" />}
              </div>
            </div>
            <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-3">
              <div><dt className="text-xs text-slate-500">شروع واقعی</dt><dd className="mt-1 font-semibold">{dateTime(report.startedAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">پایان واقعی</dt><dd className="mt-1 font-semibold">{dateTime(report.endedAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">شناسه شیفت</dt><dd className="mt-1 break-all font-mono text-xs">{report.id}</dd></div>
            </dl>
            {(report.closureSummary || report.forceCloseReason) && (
              <div className="mt-4 border-t border-slate-100 pt-4 text-sm leading-6 text-slate-700 dark:border-slate-800 dark:text-slate-200">
                {report.closureSummary || report.forceCloseReason}
              </div>
            )}
          </ErpSection>

          {report.corrections?.length > 0 && (
            <ErpSection title="تاریخچه اصلاح زمان‌های شیفت">
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {report.corrections.map((item: any) => (
                  <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-semibold">{item.correctedByName} · {dateTime(item.correctedAt)}</p>
                    <p className="mt-1 text-xs text-slate-500">زمان قبلی یا ثبت‌نشده: {dateTime(item.previousStartedAt)} تا {dateTime(item.previousEndedAt)}</p>
                    <p className="mt-1 text-xs text-slate-500">زمان مؤثر: {dateTime(item.effectiveStartedAt)} تا {dateTime(item.effectiveEndedAt)}</p>
                    <p className="mt-2 text-sm">{item.reason}</p>
                  </div>
                ))}
              </div>
            </ErpSection>
          )}

          <ErpSection title="حضور و پوشش">
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {(report.attendance || []).map((item: any) => (
                <div key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                  <p className="font-bold">{item.name}</p>
                  <p className="text-sm text-slate-500">ورود: {dateTime(item.arrivedAt)}</p>
                  <ErpStatus label={item.delayMinutes > 0 ? `${item.delayMinutes.toLocaleString('fa-IR')} دقیقه تأخیر` : 'به‌موقع'} tone={item.delayMinutes > 0 ? 'warning' : 'success'} />
                </div>
              ))}
              {!report.attendance?.length && <ErpInlineState kind="empty" title="رکورد حضور برای این شیفت ثبت نشده است." />}
            </div>
          </ErpSection>

          <ErpSection>
            <ErpShiftTimeline
              title="خط زمانی شیفت"
              entries={report.timeline || []}
              formatTimestamp={dateTime}
              showAttachmentImages
              attachmentHref={(attachmentId) => `/api/security/shift-log/attachments/${attachmentId}`}
            />
          </ErpSection>
        </>
      ) : null}
    </ErpWorkspacePage>
  );
}
