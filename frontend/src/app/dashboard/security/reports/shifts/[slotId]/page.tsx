'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaChevronLeft, FaChevronRight, FaRedo, FaSearchMinus, FaSearchPlus, FaUndo } from 'react-icons/fa';
import {
  ErpButton,
  ErpInlineState,
  ErpSection,
  ErpSheet,
  ErpShiftTimeline,
  type ErpShiftTimelineEntry,
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
  const [preview, setPreview] = useState<{ entry: ErpShiftTimelineEntry; index: number } | null>(null);
  const [zoom, setZoom] = useState(1);

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

  const openAttachmentPreview = (entry: ErpShiftTimelineEntry, index: number) => {
    setPreview({ entry, index });
    setZoom(1);
  };
  const movePreview = useCallback((direction: -1 | 1) => {
    setPreview((current) => {
      if (!current) return current;
      const attachmentCount = current.entry.attachments?.length || 0;
      if (attachmentCount < 2) return current;
      return { ...current, index: (current.index + direction + attachmentCount) % attachmentCount };
    });
    setZoom(1);
  }, []);

  useEffect(() => {
    if (!preview) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') movePreview(1);
      if (event.key === 'ArrowRight') movePreview(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [movePreview, preview]);

  const previewAttachments = preview?.entry.attachments || [];
  const previewAttachment = preview ? previewAttachments[preview.index] : null;

  return (
    <ErpWorkspacePage
      className="guard-workspace"
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
                <h2 className="text-lg font-black sds-text-primary ">{report.effectivePersonnel?.name || report.plannedPersonnel?.name || 'شیفت گارد'}</h2>
                <p className="mt-1 text-sm sds-text-muted">{report.title}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <ErpStatus label={report.status === 'FORCE_CLOSED' ? 'بسته‌شده توسط مدیر' : 'تکمیل‌شده'} tone="neutral" emphasis="strong" />
                {report.isManagerCorrected && <ErpStatus label="اصلاح‌شده توسط مدیر" tone="warning" emphasis="strong" />}
              </div>
            </div>
            <dl className="mt-5 grid gap-4 border-t border-[var(--sds-border-subtle)] pt-4 text-sm dark:border-[var(--sds-border-subtle)] sm:grid-cols-3">
              <div><dt className="text-xs sds-text-muted">شروع واقعی</dt><dd className="mt-1 font-semibold">{dateTime(report.startedAt)}</dd></div>
              <div><dt className="text-xs sds-text-muted">پایان واقعی</dt><dd className="mt-1 font-semibold">{dateTime(report.endedAt)}</dd></div>
              <div><dt className="text-xs sds-text-muted">شناسه شیفت</dt><dd className="mt-1 break-all font-mono text-xs">{report.id}</dd></div>
            </dl>
            {(report.closureSummary || report.forceCloseReason) && (
              <div className="mt-4 border-t border-[var(--sds-border-subtle)] pt-4 text-sm leading-6 sds-text-secondary dark:border-[var(--sds-border-subtle)] ">
                {report.closureSummary || report.forceCloseReason}
              </div>
            )}
          </ErpSection>

          {report.corrections?.length > 0 && (
            <ErpSection title="تاریخچه اصلاح زمان‌های شیفت">
              <div className="divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
                {report.corrections.map((item: any) => (
                  <div key={item.id} className="py-3 first:pt-0 last:pb-0">
                    <p className="font-semibold">{item.correctedByName} · {dateTime(item.correctedAt)}</p>
                    <p className="mt-1 text-xs sds-text-muted">زمان قبلی یا ثبت‌نشده: {dateTime(item.previousStartedAt)} تا {dateTime(item.previousEndedAt)}</p>
                    <p className="mt-1 text-xs sds-text-muted">زمان مؤثر: {dateTime(item.effectiveStartedAt)} تا {dateTime(item.effectiveEndedAt)}</p>
                    <p className="mt-2 text-sm">{item.reason}</p>
                  </div>
                ))}
              </div>
            </ErpSection>
          )}

          <ErpSection title="حضور و پوشش">
            <div className="divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
              {(report.attendance || []).map((item: any) => (
                <div key={item.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center">
                  <p className="font-bold">{item.name}</p>
                  <p className="text-sm sds-text-muted">ورود: {dateTime(item.arrivedAt)}</p>
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
              onAttachmentOpen={openAttachmentPreview}
            />
          </ErpSection>

          <ErpSheet
            open={Boolean(preview && previewAttachment)}
            onClose={() => setPreview(null)}
            title={previewAttachment?.name || 'پیش‌نمایش تصویر گزارش'}
            presentation="modal"
            size="wide"
            footer={previewAttachment ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs font-semibold sds-text-muted">
                  تصویر {(preview!.index + 1).toLocaleString('fa-IR')} از {previewAttachments.length.toLocaleString('fa-IR')}
                </p>
                <div className="flex flex-wrap gap-2">
                  {previewAttachments.length > 1 && <ErpButton label="قبلی" icon={FaChevronRight} tone="neutral" variant="outline" onClick={() => movePreview(-1)} />}
                  <ErpButton label="کوچک‌نمایی" icon={FaSearchMinus} tone="neutral" variant="outline" onClick={() => setZoom((current) => Math.max(1, current - 0.25))} disabled={zoom <= 1} />
                  <ErpButton label="بازنشانی" icon={FaUndo} tone="neutral" variant="ghost" onClick={() => setZoom(1)} disabled={zoom === 1} />
                  <ErpButton label="بزرگ‌نمایی" icon={FaSearchPlus} tone="neutral" variant="outline" onClick={() => setZoom((current) => Math.min(3, current + 0.25))} disabled={zoom >= 3} />
                  {previewAttachments.length > 1 && <ErpButton label="بعدی" icon={FaChevronLeft} tone="neutral" variant="outline" onClick={() => movePreview(1)} />}
                </div>
              </div>
            ) : undefined}
          >
            {previewAttachment && (
              <div className="flex min-h-[55dvh] items-center justify-center overflow-auto rounded-xl bg-[var(--sds-surface-canvas)] p-2 sm:min-h-[65dvh]">
                <img
                  src={`/api/security/shift-log/attachments/${previewAttachment.id}`}
                  alt={previewAttachment.name || 'تصویر گزارش شیفت'}
                  className="max-h-[65dvh] max-w-full object-contain transition-transform duration-200 motion-reduce:transition-none"
                  style={{ transform: `scale(${zoom})` }}
                />
              </div>
            )}
          </ErpSheet>
        </>
      ) : null}
    </ErpWorkspacePage>
  );
}
