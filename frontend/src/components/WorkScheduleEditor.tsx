'use client';
import { ErpButton, ErpCard, ErpInlineState, ErpPressable, ErpSection } from '@/components/erp';
import React from 'react';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import PersianTimePicker, { formatTime12 } from '@/components/PersianTimePicker';
import PersianCalendar from '@/lib/persian-calendar';
import {
  applyBulkTimes,
  shouldConfirmBulkTimeReplacement,
  type WorkScheduleDayValue,
  type WorkScheduleValue,
} from './workScheduleState';

export type { WorkScheduleDayValue, WorkScheduleValue } from './workScheduleState';
export const PERSIAN_WEEKDAYS = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه'];
export const emptyWorkSchedule = (): WorkScheduleValue => ({ effectiveDate: PersianCalendar.now(), days: [] });
export const workScheduleFromApi = (schedule?: any): WorkScheduleValue => {
  if (!schedule) return emptyWorkSchedule();
  const today = PersianCalendar.now();
  const savedEffectiveDate = PersianCalendar.toPersian(schedule.effectiveFrom);
  return {
    // An existing historical version is copied into a new version effective today.
    // A future version keeps its selected effective date.
    effectiveDate: savedEffectiveDate >= today ? savedEffectiveDate : today,
    days: (schedule.days || []).map((day: any) => ({ weekday: day.weekday, startTime: day.startTime, endTime: day.endTime }))
  };
};
export const workSchedulePayload = (value: WorkScheduleValue) => ({ effectiveDate: PersianCalendar.toGregorianDateOnly(value.effectiveDate), days: value.days.map((day) => ({ ...day })) });

export default function WorkScheduleEditor({ value, onChange }: { value: WorkScheduleValue; onChange: (value: WorkScheduleValue) => void }) {
  const [pendingBulk, setPendingBulk] = React.useState<{ startTime: string; endTime: string } | null>(null);
  const bulkStart = value.days[0]?.startTime || '08:00';
  const bulkEnd = value.days[0]?.endTime || '17:00';
  const selected = new Set(value.days.map((day) => day.weekday));
  const setDays = (weekdays: number[]) => onChange({ ...value, days: weekdays.map((weekday) => value.days.find((day) => day.weekday === weekday) || { weekday, startTime: bulkStart, endTime: bulkEnd }).sort((a, b) => a.weekday - b.weekday) });
  const toggleDay = (weekday: number) => setDays(selected.has(weekday) ? value.days.filter((day) => day.weekday !== weekday).map((day) => day.weekday) : [...Array.from(selected), weekday]);
  const updateDay = (weekday: number, field: 'startTime' | 'endTime', nextValue: string) => onChange({ ...value, days: value.days.map((day) => day.weekday === weekday ? { ...day, [field]: nextValue } : day) });
  const applyBulk = (startTime: string, endTime: string) => {
    if (shouldConfirmBulkTimeReplacement(value.days, startTime, endTime)) {
      setPendingBulk({ startTime, endTime });
      return;
    }
    onChange({ ...value, days: applyBulkTimes(value.days, startTime, endTime) });
  };
  return <ErpSection title="ساعت کاری" description="برنامه هفتگی پرسنل؛ برای حذف برنامه همه روزها را پاک کنید.">
    <div className="space-y-5">
      <label className="block"><span className="mb-2 block text-sm font-medium">تاریخ اجرا</span><HrPersianCalendar value={value.effectiveDate} onChange={(effectiveDate) => onChange({ ...value, effectiveDate })} disablePastDates /></label>
      <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">روزهای کاری</span><div className="flex flex-wrap gap-2"><ErpButton label="روزهای کاری" variant="outline" onClick={() => setDays([0, 1, 2, 3, 4, 5])} /><ErpButton label="انتخاب همه" variant="outline" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} /><ErpButton label="پاک‌کردن ساعت کاری" tone="danger" variant="ghost" onClick={() => onChange({ ...value, days: [] })} /></div></div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{PERSIAN_WEEKDAYS.map((day, weekday) => <ErpPressable key={day} type="button" aria-pressed={selected.has(weekday)} onClick={() => toggleDay(weekday)} tone={selected.has(weekday) ? 'primary' : 'neutral'} variant={selected.has(weekday) ? 'solid' : 'outline'} className="min-h-11 px-2 text-sm">{day}</ErpPressable>)}</div></div>
      {pendingBulk && <ErpInlineState kind="stale" title="زمان روزهای انتخاب‌شده متفاوت است. همه با زمان جدید جایگزین شوند؟" actions={[{ label: 'جایگزینی همه', tone: 'warning', variant: 'solid', onClick: () => { onChange({ ...value, days: applyBulkTimes(value.days, pendingBulk.startTime, pendingBulk.endTime) }); setPendingBulk(null); } }, { label: 'انصراف', tone: 'neutral', variant: 'ghost', onClick: () => setPendingBulk(null) }]} />}
      {value.days.length > 0 && <><BulkTimes initialStart={bulkStart} initialEnd={bulkEnd} onApply={applyBulk} /><div className="space-y-3"><p className="text-sm font-bold text-primary">جزئیات هر روز</p>{value.days.map((day) => <ErpCard key={day.weekday} className="grid items-end gap-3 p-3 sm:grid-cols-[120px_1fr_1fr]"><p className="pb-3 font-semibold">{PERSIAN_WEEKDAYS[day.weekday]}</p><label><span className="mb-1 block text-xs text-secondary">از</span><PersianTimePicker ariaLabel={`زمان شروع ${PERSIAN_WEEKDAYS[day.weekday]}`} value={day.startTime} onChange={(next) => updateDay(day.weekday, 'startTime', next)} /></label><label><span className="mb-1 block text-xs text-secondary">تا</span><PersianTimePicker ariaLabel={`زمان پایان ${PERSIAN_WEEKDAYS[day.weekday]}`} value={day.endTime} onChange={(next) => updateDay(day.weekday, 'endTime', next)} /></label><p className="col-span-full text-left text-xs text-secondary" dir="ltr">{formatTime12(day.startTime)} – {formatTime12(day.endTime)}</p></ErpCard>)}</div></>}
    </div>
  </ErpSection>;
}

function BulkTimes({ initialStart, initialEnd, onApply }: { initialStart: string; initialEnd: string; onApply: (start: string, end: string) => void }) {
  const [startTime, setStartTime] = React.useState(initialStart); const [endTime, setEndTime] = React.useState(initialEnd);
  React.useEffect(() => { setStartTime(initialStart); setEndTime(initialEnd); }, [initialStart, initialEnd]);
  return <ErpCard tone="info" className="grid items-end gap-3 p-3 sm:grid-cols-[1fr_1fr_auto]"><label><span className="mb-1 block text-xs font-medium">از برای روزهای انتخاب‌شده</span><PersianTimePicker ariaLabel="زمان شروع همه روزهای انتخاب‌شده" value={startTime} onChange={setStartTime} /></label><label><span className="mb-1 block text-xs font-medium">تا برای روزهای انتخاب‌شده</span><PersianTimePicker ariaLabel="زمان پایان همه روزهای انتخاب‌شده" value={endTime} onChange={setEndTime} /></label><ErpButton label="اعمال برای روزهای انتخاب‌شده" variant="solid" disabled={!startTime || !endTime} onClick={() => onApply(startTime, endTime)} /></ErpCard>;
}
