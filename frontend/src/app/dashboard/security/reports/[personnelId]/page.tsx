'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaChevronDown, FaChevronUp, FaHistory, FaRedo } from 'react-icons/fa';
import PersianCalendarComponent from '@/components/PersianCalendar';
import { ErpButton, ErpInlineState, ErpSection, ErpShiftTimeline, ErpSkeleton, ErpStatus, ErpWorkspacePage } from '@/components/erp';
import { ErpPressable } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

const dateTime = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value, true) : '—';

export default function SecurityPersonnelHistoryPage() {
  const { personnelId } = useParams<{ personnelId: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [range, setRange] = useState<{ startDate: string; endDate: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await securityAPI.getSecurityPersonnelShiftHistory(personnelId, range ? {
        startDate: PersianCalendar.toGregorianDateOnly(range.startDate),
        endDate: PersianCalendar.toGregorianDateOnly(range.endDate),
      } : undefined);
      setData(response.data.data);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت تاریخچه ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [personnelId, range]);

  useEffect(() => { load(); }, [load]);

  return (
    <ErpWorkspacePage
      title={data?.personnel?.name || 'تاریخچه شیفت‌ها'}
      context={data?.personnel?.shift ? `گروه ${data.personnel.shift}` : personnelId}
      backHref="/dashboard/security/reports"
      secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}
    >
      <ErpSection title="بازه اختیاری">
        <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto]">
          <PersianCalendarComponent value={range?.startDate || ''} onChange={(startDate) => setRange((current) => ({ startDate, endDate: current?.endDate || startDate }))} placeholder="از تاریخ" clearable />
          <PersianCalendarComponent value={range?.endDate || ''} onChange={(endDate) => setRange((current) => ({ startDate: current?.startDate || endDate, endDate }))} placeholder="تا تاریخ" clearable />
          {range && <ErpButton label="پاک‌کردن بازه" variant="ghost" onClick={() => setRange(null)} />}
        </div>
      </ErpSection>

      {loading && !data ? (
        <ErpSkeleton lines={6} />
      ) : error && !data ? (
        <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} />
      ) : data ? (
        <>
          {error && <ErpInlineState kind="stale" title="به‌روزرسانی ناموفق بود؛ آخرین اطلاعات موفق نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
          <ErpSection title="شیفت‌های پایان‌یافته">
            {!data.shifts.length ? (
              <ErpInlineState kind="empty" title="شیفت پایان‌یافته‌ای در این بازه وجود ندارد." />
            ) : (
              <div className="divide-y divide-[var(--sds-border-subtle)] dark:divide-[var(--sds-border-subtle)]">
                {data.shifts.map((slot: any) => {
                  const open = expanded === slot.id;
                  const session = slot.session;
                  const timeline = (session?.logEntries || []).map((entry: any) => ({
                    id: entry.id,
                    rowNumber: entry.rowNumber,
                    status: entry.status,
                    title: `${entry.categoryNameSnapshot || entry.reportType?.category?.name || 'گزارش'}${entry.reportTypeNameSnapshot || entry.reportType?.name ? ` / ${entry.reportTypeNameSnapshot || entry.reportType?.name}` : ''}`,
                    typeDescription: entry.reportType?.description,
                    description: entry.description,
                    participants: [],
                    createdAt: entry.createdAt,
                    voidReason: entry.voidReason,
                    voidedAt: entry.voidedAt,
                    attachments: entry.attachments || [],
                  }));
                  return (
                    <article key={slot.id} className="py-3 first:pt-0 last:pb-0">
                      <ErpPressable type="button" onClick={() => setExpanded(open ? null : slot.id)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-2 text-right outline-none transition hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] dark:hover:bg-[var(--sds-surface-subtle)]" aria-expanded={open}>
                        <span className="min-w-0">
                          <span className="block font-bold">{dateTime(slot.startsAt)} تا {dateTime(slot.endsAt)}</span>
                          <span className="mt-1 block text-xs sds-text-muted">پایان واقعی: {dateTime(session?.endedAt)}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <ErpStatus label={session?.status === 'FORCE_CLOSED' ? 'بسته‌شده توسط مدیر' : 'تکمیل‌شده'} tone="neutral" />
                          {open ? <FaChevronUp aria-hidden="true" /> : <FaChevronDown aria-hidden="true" />}
                        </span>
                      </ErpPressable>
                      {open && (
                        <div className="mr-2 mt-4 border-r border-[var(--sds-border-subtle)] pr-4 dark:border-[var(--sds-border-subtle)]">
                          <ErpShiftTimeline title="خط زمانی" entries={timeline} formatTimestamp={dateTime} compact />
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </ErpSection>
        </>
      ) : (
        <ErpInlineState kind="empty" title="تاریخچه‌ای در دسترس نیست." />
      )}
    </ErpWorkspacePage>
  );
}
