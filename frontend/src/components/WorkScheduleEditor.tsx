'use client';

import React from 'react';
import HrPersianCalendar from '@/features/hr/HrPersianCalendar';
import PersianTimePicker, { formatTime12 } from '@/components/PersianTimePicker';
import PersianCalendar from '@/lib/persian-calendar';

export interface WorkScheduleDayValue { weekday: number; startTime: string; endTime: string }
export interface WorkScheduleValue { effectiveDate: string; days: WorkScheduleDayValue[] }
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
  const bulkStart = value.days[0]?.startTime || '08:00';
  const bulkEnd = value.days[0]?.endTime || '17:00';
  const selected = new Set(value.days.map((day) => day.weekday));
  const setDays = (weekdays: number[]) => onChange({ ...value, days: weekdays.map((weekday) => value.days.find((day) => day.weekday === weekday) || { weekday, startTime: bulkStart, endTime: bulkEnd }).sort((a, b) => a.weekday - b.weekday) });
  const toggleDay = (weekday: number) => setDays(selected.has(weekday) ? value.days.filter((day) => day.weekday !== weekday).map((day) => day.weekday) : [...Array.from(selected), weekday]);
  const updateDay = (weekday: number, field: 'startTime' | 'endTime', nextValue: string) => onChange({ ...value, days: value.days.map((day) => day.weekday === weekday ? { ...day, [field]: nextValue } : day) });
  const applyBulk = (startTime: string, endTime: string) => {
    const differs = value.days.some((day) => day.startTime !== startTime || day.endTime !== endTime);
    if (differs && !window.confirm('زمان بعضی روزهای انتخاب‌شده متفاوت است. مقادیر همه روزهای انتخاب‌شده جایگزین شود؟')) return;
    onChange({ ...value, days: value.days.map((day) => ({ ...day, startTime, endTime })) });
  };
  return <div className="space-y-5 rounded-xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-900/30">
    <div><h3 className="font-bold text-primary">ساعت کاری</h3><p className="mt-1 text-xs text-secondary">برنامه هفتگی پرسنل؛ برای حذف برنامه همه روزها را پاک کنید.</p></div>
    <label className="block"><span className="mb-2 block text-sm font-medium">تاریخ اجرا</span><HrPersianCalendar value={value.effectiveDate} onChange={(effectiveDate) => onChange({ ...value, effectiveDate })} disablePastDates /></label>
    <div><div className="mb-2 flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium">روزهای کاری</span><div className="flex flex-wrap gap-2"><button type="button" className="glass-liquid-btn px-3 py-2 text-xs" onClick={() => setDays([0, 1, 2, 3, 4, 5])}>روزهای کاری</button><button type="button" className="glass-liquid-btn px-3 py-2 text-xs" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>انتخاب همه</button><button type="button" className="glass-liquid-btn px-3 py-2 text-xs text-red-600" onClick={() => onChange({ ...value, days: [] })}>پاک‌کردن ساعت کاری</button></div></div>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">{PERSIAN_WEEKDAYS.map((day, weekday) => <button key={day} type="button" onClick={() => toggleDay(weekday)} className={`rounded-lg border px-2 py-3 text-sm transition ${selected.has(weekday) ? 'border-teal-500 bg-teal-500 text-white' : 'border-slate-200 bg-white text-secondary dark:border-slate-700 dark:bg-slate-800'}`}>{day}</button>)}</div></div>
    {value.days.length > 0 && <><BulkTimes initialStart={bulkStart} initialEnd={bulkEnd} onApply={applyBulk} /><div className="space-y-3"><p className="text-sm font-bold text-primary">جزئیات هر روز</p>{value.days.map((day) => <div key={day.weekday} className="grid items-end gap-3 rounded-lg border border-slate-200 bg-white p-3 sm:grid-cols-[120px_1fr_1fr] dark:border-slate-700 dark:bg-slate-800/70"><p className="pb-3 font-semibold">{PERSIAN_WEEKDAYS[day.weekday]}</p><label><span className="mb-1 block text-xs text-secondary">از</span><PersianTimePicker value={day.startTime} onChange={(next) => updateDay(day.weekday, 'startTime', next)} /></label><label><span className="mb-1 block text-xs text-secondary">تا</span><PersianTimePicker value={day.endTime} onChange={(next) => updateDay(day.weekday, 'endTime', next)} /></label><p className="col-span-full text-left text-xs text-secondary" dir="ltr">{formatTime12(day.startTime)} – {formatTime12(day.endTime)}</p></div>)}</div></>}
  </div>;
}

function BulkTimes({ initialStart, initialEnd, onApply }: { initialStart: string; initialEnd: string; onApply: (start: string, end: string) => void }) {
  const [startTime, setStartTime] = React.useState(initialStart); const [endTime, setEndTime] = React.useState(initialEnd);
  React.useEffect(() => { setStartTime(initialStart); setEndTime(initialEnd); }, [initialStart, initialEnd]);
  return <div className="grid items-end gap-3 rounded-lg border border-teal-200 bg-teal-50/60 p-3 sm:grid-cols-[1fr_1fr_auto] dark:border-teal-900 dark:bg-teal-950/20"><label><span className="mb-1 block text-xs font-medium">از برای روزهای انتخاب‌شده</span><PersianTimePicker value={startTime} onChange={setStartTime} /></label><label><span className="mb-1 block text-xs font-medium">تا برای روزهای انتخاب‌شده</span><PersianTimePicker value={endTime} onChange={setEndTime} /></label><button type="button" className="glass-liquid-btn-primary min-h-12 px-4" disabled={!startTime || !endTime} onClick={() => onApply(startTime, endTime)}>اعمال برای روزهای انتخاب‌شده</button></div>;
}
