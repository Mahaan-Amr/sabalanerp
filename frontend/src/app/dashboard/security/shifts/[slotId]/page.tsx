'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaRedo } from 'react-icons/fa';
import { ErpBadge, ErpInlineState, ErpSection, ErpSkeleton, ErpWorkspacePage } from '@/components/erp';
import { securityAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';

const dateTime = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value, true) : '—';
const personName = (personnel: any) => personnel?.user ? `${personnel.user.firstName} ${personnel.user.lastName}`.trim() : '—';

export default function SecurityPlannedShiftDetailPage() {
  const { slotId } = useParams<{ slotId: string }>();
  const [slot, setSlot] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const response = await securityAPI.getShiftPlanSlot(slotId);
      setSlot(response.data.data);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت جزئیات برنامه شیفت ناموفق بود.');
    } finally {
      setLoading(false);
    }
  }, [slotId]);

  useEffect(() => { void load(); }, [load]);

  const status = slot?.operationalState === 'MANAGER_REVIEW'
    ? 'نیازمند بررسی مدیر'
    : slot?.operationalState === 'NO_SHIFT_CONFIRMED'
      ? 'عدم انجام شیفت تأیید شد'
      : 'در انتظار';

  return (
    <ErpWorkspacePage
      title="جزئیات برنامه شیفت"
      context={slot ? `${dateTime(slot.startsAt)} تا ${dateTime(slot.endsAt)}` : slotId}
      backHref="/dashboard/security/shifts"
      secondaryActions={[{ label: 'به‌روزرسانی', icon: FaRedo, onClick: load }]}
    >
      {loading && !slot ? <ErpSkeleton lines={6} /> : error && !slot ? (
        <ErpInlineState kind="error" title={error} action={{ label: 'تلاش مجدد', onClick: load }} />
      ) : slot ? (
        <>
          {error && <ErpInlineState kind="stale" title="به‌روزرسانی ناموفق بود؛ آخرین اطلاعات موفق نمایش داده می‌شود." action={{ label: 'تلاش مجدد', onClick: load }} />}
          <ErpSection>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-black">{personName(slot.replacementPersonnel || slot.plannedPersonnel)}</h2>
                <p className="mt-1 text-sm text-slate-500">{slot.plan?.title || 'برنامه شیفت حراست'}</p>
              </div>
              <ErpBadge tone={slot.operationalState === 'MANAGER_REVIEW' ? 'warning' : 'neutral'}>{status}</ErpBadge>
            </div>
            <dl className="mt-5 grid gap-4 border-t border-slate-100 pt-4 text-sm dark:border-slate-800 sm:grid-cols-3">
              <div><dt className="text-xs text-slate-500">بازه برنامه</dt><dd className="mt-1 font-semibold">{dateTime(slot.startsAt)} تا {dateTime(slot.endsAt)}</dd></div>
              <div><dt className="text-xs text-slate-500">نیروی برنامه‌ریزی‌شده</dt><dd className="mt-1 font-semibold">{personName(slot.plannedPersonnel)}</dd></div>
              <div><dt className="text-xs text-slate-500">جایگزین</dt><dd className="mt-1 font-semibold">{personName(slot.replacementPersonnel)}</dd></div>
            </dl>
          </ErpSection>

          {slot.managerReviewRequired && <ErpInlineState kind="stale" title="بازه برنامه پایان یافته اما جلسه شیفت ثبت نشده است؛ تصمیم مدیر در صفحه شیفت‌ها لازم است." />}
          {slot.noShiftConfirmedAt && (
            <ErpSection title="تصمیم مدیر">
              <p className="text-sm font-semibold">عدم انجام شیفت در {dateTime(slot.noShiftConfirmedAt)} توسط {slot.noShiftConfirmedByName || 'مدیر حراست'} تأیید شد.</p>
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{slot.noShiftConfirmReason}</p>
            </ErpSection>
          )}

          <ErpSection title="حضور ثبت‌شده">
            {slot.attendance?.length ? slot.attendance.map((attendance: any) => (
              <p key={attendance.id} className="border-b border-slate-100 py-3 text-sm last:border-0 dark:border-slate-800">
                {dateTime(attendance.arrivedAt)} · {attendance.delayMinutes.toLocaleString('fa-IR')} دقیقه تأخیر
              </p>
            )) : <ErpInlineState kind="empty" title="حضور برای این بازه ثبت نشده است." />}
          </ErpSection>
        </>
      ) : null}
    </ErpWorkspacePage>
  );
}
