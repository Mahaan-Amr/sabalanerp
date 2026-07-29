'use client';

import { useEffect, useState } from 'react';
import { FaClock, FaSave } from 'react-icons/fa';
import { supportTicketsAPI } from '@/lib/api';
import { ErpBadge, ErpButton, ErpCard, ErpInput, ErpLoading, ErpPage, ErpTextarea, erpFieldLabelClassName } from '@/components/erp';

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const response = await supportTicketsAPI.getSlaPolicies();
      const rows = response.data.data;
      setPolicies(rows);
      if (rows[0]) {
        setCalendar(rows[0].calendar);
        setTargets(rows[0].targets);
        setHolidays((rows[0].calendar.holidays || []).join('\n'));
      }
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'دریافت سیاست زمان پاسخ ممکن نشد.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

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
      await load();
    } catch (requestError: any) {
      setError(requestError.response?.data?.error || 'ثبت نسخه سیاست انجام نشد.');
    } finally {
      setSaving(false);
    }
  };

  if (loading || !calendar || !targets) return <ErpLoading />;

  return (
    <ErpPage
      eyebrow="مدیریت پشتیبانی"
      title="اهداف زمانی و تقویم پشتیبانی"
      description="اهداف با تقویم صریح محاسبه می‌شوند و وعده خودکار برای بستن یا واگذاری تیکت نیستند. تیکت‌های قبلی نسخه خود را حفظ می‌کنند."
      actions={[{ label: 'بازخوانی', onClick: () => void load(), icon: FaClock, tone: 'neutral', variant: 'outline' }]}
    >
      <div className="space-y-5" dir="rtl">
        {error && <ErpCard tone="danger"><p role="alert" className="text-sm font-bold">{error}</p></ErpCard>}
        <ErpCard>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold">نسخه جاری</h2>
            <ErpBadge tone="info">نسخه {policies[0]?.version?.toLocaleString('fa-IR')}</ErpBadge>
          </div>
          <p className="mt-2 text-sm text-[var(--sds-text-muted)]">{policies[0]?.changeReason}</p>
        </ErpCard>
        <ErpCard>
          <h2 className="mb-4 font-bold">اهداف بر حسب دقیقه کاری</h2>
          <div className="grid gap-4 lg:grid-cols-2">
            {priorities.map(([priority, label]) => (
              <div key={priority} className="rounded-xl border border-[var(--sds-border-subtle)] p-4">
                <h3 className="mb-3 font-bold">{label}</h3>
                <div className="grid gap-3 sm:grid-cols-2">
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
          <label className="mt-4 block">
            <span className={erpFieldLabelClassName}>تعطیلات (هر تاریخ میلادی YYYY-MM-DD در یک خط)</span>
            <ErpTextarea value={holidays} onChange={(event) => setHolidays(event.target.value)} />
          </label>
        </ErpCard>
        <ErpCard tone="warning">
          <label>
            <span className={erpFieldLabelClassName}>دلیل نسخه جدید</span>
            <ErpInput value={reason} onChange={(event) => setReason(event.target.value)} minLength={5} maxLength={1000} />
          </label>
          <div className="mt-4">
            <ErpButton label="ثبت نسخه جدید" icon={FaSave} onClick={() => void save()} disabled={saving || reason.trim().length < 5} />
          </div>
        </ErpCard>
      </div>
    </ErpPage>
  );
}
