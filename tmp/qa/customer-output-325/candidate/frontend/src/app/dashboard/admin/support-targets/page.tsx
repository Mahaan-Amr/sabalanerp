'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { FaClock, FaPlus, FaSave, FaTimes } from 'react-icons/fa';
import { supportTicketsAPI } from '@/lib/api';
import { PersianCalendar } from '@/lib/persian-calendar';
import { ErpBadge, ErpButton, ErpCard, ErpInlineState, ErpInput, ErpLoading, ErpSheet, ErpWorkspacePage, erpFieldLabelClassName } from '@/components/erp';

const priorities = [
  ['URGENT', 'فوری'],
  ['HIGH', 'بالا'],
  ['NORMAL', 'عادی'],
  ['LOW', 'کم'],
] as const;
const weekdayLabels: Record<string, string> = {
  SATURDAY: 'شنبه',
  SUNDAY: 'یکشنبه',
  MONDAY: 'دوشنبه',
  TUESDAY: 'سه‌شنبه',
  WEDNESDAY: 'چهارشنبه',
  THURSDAY: 'پنجشنبه',
  FRIDAY: 'جمعه',
};
const formatWorkingMinute = (minute: number) =>
  `${Math.floor(minute / 60).toLocaleString('fa-IR')}:${String(minute % 60).padStart(2, '0').replace(/\d/g, (digit) => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)])}`;

export default function SupportTargetsPage() {
  const [policies, setPolicies] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<any>(null);
  const [targets, setTargets] = useState<any>(null);
  const [holidays, setHolidays] = useState('');
  const [reason, setReason] = useState('');
  const [holidayDraft, setHolidayDraft] = useState('');
  const [reviewOpen, setReviewOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const loadedOnceRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (replaceDrafts = false) => {
    if (loadedOnceRef.current) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const response = await supportTicketsAPI.getSlaPolicies();
      const rows = response.data.data;
      setPolicies(rows);
      if (rows[0] && (replaceDrafts || !loadedOnceRef.current)) {
        setCalendar(rows[0].calendar);
        setTargets(rows[0].targets);
        setHolidays((rows[0].calendar.holidays || []).join('\n'));
      }
      loadedOnceRef.current = true;
      setLoadedOnce(true);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت سیاست زمان پاسخ ممکن نشد.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(true); }, [load]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await supportTicketsAPI.createSlaPolicy({
        calendar: { ...calendar, holidays: holidays.split(/\s+/).filter(Boolean) },
        targets,
        changeReason: reason,
      });
      setReason('');
      setReviewOpen(false);
      await load(true);
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'ثبت نسخه سیاست انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !loadedOnce) return <ErpLoading />;
  if (!calendar || !targets) return (
    <ErpWorkspacePage title="اهداف زمانی پشتیبانی">
      <ErpInlineState kind="error" title={error || 'سیاست زمان پاسخ در دسترس نیست.'} action={{ label: 'تلاش دوباره', onClick: () => void load(true) }} />
    </ErpWorkspacePage>
  );

  const holidayValues = holidays.split(/\s+/).filter(Boolean);
  const addHoliday = () => {
    if (!/^\d{4}\/\d{2}\/\d{2}$/.test(holidayDraft.trim())) { setError('تاریخ تعطیل را به صورت ۱۴۰۵/۰۱/۰۱ وارد کنید.'); return; }
    const iso = PersianCalendar.toGregorian(holidayDraft.trim()).toISOString().slice(0, 10);
    setHolidays(Array.from(new Set([...holidayValues, iso])).join('\n'));
    setHolidayDraft(''); setError('');
  };

  return (
    <ErpWorkspacePage title="اهداف زمانی پشتیبانی" primaryAction={{ label: 'به‌روزرسانی', onClick: () => void load(false), icon: FaClock, tone: 'neutral', variant: 'outline', disabled: refreshing }}>
      <div className="space-y-5" dir="rtl">
        {error && <ErpInlineState kind="stale" title={error} action={{ label: 'تلاش دوباره', onClick: () => void load(false) }} />}
        <ErpCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">نسخه جاری</h2>
            <ErpBadge tone="info">نسخه {policies[0]?.version?.toLocaleString('fa-IR')}</ErpBadge>
          </div>
          <p className="mt-2 text-sm text-[var(--sds-text-muted)]">{policies[0]?.changeReason}</p>
        </ErpCard>
        <ErpCard>
          <h2 className="mb-4 font-bold">اهداف بر حسب دقیقه کاری</h2>
          <div className="grid gap-3">
            {priorities.map(([priority, label]) => (
              <div key={priority} className="grid gap-3 rounded-xl border border-[var(--sds-border-subtle)] p-3 sm:grid-cols-[10rem_minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
                <h3 className="pb-2 font-bold">{label}</h3>
                <div className="contents">
                  <label>
                    <span className={erpFieldLabelClassName}>تأیید دریافت</span>
                    <ErpInput type="number" min={1} value={targets[priority].acknowledgmentMinutes} onChange={(event) => setTargets({ ...targets, [priority]: { ...targets[priority], acknowledgmentMinutes: Number(event.target.value) } })} />
                  </label>
                  <label>
                    <span className={erpFieldLabelClassName}>حل مسئله</span>
                    <ErpInput type="number" min={1} value={targets[priority].resolutionMinutes} onChange={(event) => setTargets({ ...targets, [priority]: { ...targets[priority], resolutionMinutes: Number(event.target.value) } })} />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </ErpCard>
        <ErpCard>
          <h2 className="font-bold">تقویم کاری</h2>
          <p className="mt-2 text-sm">منطقه زمانی: {calendar.timezone}</p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(calendar.schedule).map(([weekday, interval]: any) => (
              <div key={weekday} className="rounded-lg border border-[var(--sds-border-subtle)] p-3 text-sm">
                <p className="font-bold">{weekdayLabels[weekday] || weekday}</p>
                <p className="mt-1 text-[var(--sds-text-muted)]">{interval ? `${formatWorkingMinute(interval[0])} تا ${formatWorkingMinute(interval[1])}` : 'تعطیل'}</p>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <span className={erpFieldLabelClassName}>تعطیلات رسمی</span>
            <div className="flex gap-2"><ErpInput value={holidayDraft} onChange={(event) => setHolidayDraft(event.target.value)} placeholder="۱۴۰۵/۰۱/۰۱" dir="ltr" /><ErpButton label="افزودن" icon={FaPlus} onClick={addHoliday} variant="outline" /></div>
            {holidayValues.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{holidayValues.map((value) => <ErpButton key={value} label={PersianCalendar.toPersian(value)} icon={FaTimes} tone="neutral" variant="soft" onClick={() => setHolidays(holidayValues.filter((item) => item !== value).join('\n'))} />)}</div>}
          </div>
        </ErpCard>
        <ErpCard tone="warning">
          <label>
            <span className={erpFieldLabelClassName}>دلیل نسخه جدید</span>
            <ErpInput value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={1000} />
          </label>
          <div className="mt-4">
            <ErpButton label="بررسی نسخه جدید" icon={FaSave} onClick={() => setReviewOpen(true)} disabled={saving || reason.trim().length < 5} />
          </div>
        </ErpCard>
      </div>
      <ErpSheet open={reviewOpen} onClose={() => setReviewOpen(false)} title="بررسی تغییرات" presentation="modal" footer={<div className="flex justify-end gap-2"><ErpButton label="بازگشت" variant="ghost" onClick={() => setReviewOpen(false)} /><ErpButton label="ثبت نسخه جدید" icon={FaSave} onClick={() => void save()} disabled={saving} /></div>}>
        <div className="space-y-4" dir="rtl"><p className="text-sm sds-text-muted">نسخه جاری حفظ می‌شود و این تنظیمات به‌عنوان یک نسخه جدید فعال خواهند شد.</p><div className="grid gap-3 sm:grid-cols-2"><ErpCard className="p-3"><p className="text-xs font-bold sds-text-muted">نسخه جاری</p><p className="mt-2 text-sm">نسخه {policies[0]?.version?.toLocaleString('fa-IR')}</p><p className="mt-1 text-xs sds-text-muted">{policies[0]?.changeReason}</p></ErpCard><ErpCard className="p-3"><p className="text-xs font-bold sds-text-muted">نسخه پیشنهادی</p><p className="mt-2 text-sm">۴ سطح هدف · {holidayValues.length.toLocaleString('fa-IR')} تعطیلی</p><p className="mt-1 text-xs sds-text-muted">{reason}</p></ErpCard></div></div>
      </ErpSheet>
    </ErpWorkspacePage>
  );
}
