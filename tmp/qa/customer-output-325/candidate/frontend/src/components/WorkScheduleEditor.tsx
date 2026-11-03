'use client';
import { ErpButton, ErpCard, ErpInlineState, ErpPressable } from '@/components/erp';
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

export default function WorkScheduleEditor({ value, onChange, readOnly = false }: { value: WorkScheduleValue; onChange: (value: WorkScheduleValue) => void; readOnly?: boolean }) {
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
  return (
    <div className="sds-neumorphic-workflow-scope mx-auto max-w-5xl space-y-4">
      <ErpCard className="sds-neumorphic-card grid gap-4 p-4 lg:grid-cols-[minmax(15rem,0.8fr)_minmax(0,2fr)]">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-[var(--sds-text-secondary)]">تاریخ اجرا</span>
          <HrPersianCalendar
            value={value.effectiveDate}
            onChange={(effectiveDate) => onChange({ ...value, effectiveDate })}
            disablePastDates
            disabled={readOnly}
          />
        </label>
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--sds-text-secondary)]">روزهای کاری</span>
            {!readOnly && (
              <div className="flex flex-wrap gap-1.5">
                <ErpButton label="شنبه تا پنجشنبه" variant="ghost" onClick={() => setDays([0, 1, 2, 3, 4, 5])} />
                <ErpButton label="همه روزها" variant="ghost" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])} />
                <ErpButton label="پاک‌کردن" tone="danger" variant="ghost" onClick={() => onChange({ ...value, days: [] })} />
              </div>
            )}
          </div>
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
            {PERSIAN_WEEKDAYS.map((day, weekday) => (
              <ErpPressable
                key={day}
                type="button"
                disabled={readOnly}
                aria-pressed={selected.has(weekday)}
                onClick={() => toggleDay(weekday)}
                tone={selected.has(weekday) ? 'primary' : 'neutral'}
                variant={selected.has(weekday) ? 'solid' : 'outline'}
                className="min-h-10 px-2 text-sm"
              >
                {day}
              </ErpPressable>
            ))}
          </div>
        </div>
      </ErpCard>

      {pendingBulk && (
        <ErpInlineState
          kind="stale"
          title="زمان روزهای انتخاب‌شده متفاوت است. همه با زمان جدید جایگزین شوند؟"
          actions={[
            {
              label: 'جایگزینی همه',
              tone: 'warning',
              variant: 'solid',
              onClick: () => {
                onChange({ ...value, days: applyBulkTimes(value.days, pendingBulk.startTime, pendingBulk.endTime) });
                setPendingBulk(null);
              },
            },
            { label: 'انصراف', tone: 'neutral', variant: 'ghost', onClick: () => setPendingBulk(null) },
          ]}
        />
      )}

      {value.days.length > 0 && (
        <>
          {!readOnly && <BulkTimes initialStart={bulkStart} initialEnd={bulkEnd} onApply={applyBulk} />}
          <ErpCard className="sds-neumorphic-card overflow-hidden p-0">
            <div className="border-b border-[var(--sds-border-subtle)] px-4 py-3">
              <p className="text-sm font-bold text-[var(--sds-text-primary)]">ساعت هر روز</p>
            </div>
            <div className="divide-y divide-[var(--sds-border-subtle)]">
              {value.days.map((day) => (
                <div key={day.weekday} className="grid items-end gap-3 px-4 py-3 sm:grid-cols-[7rem_1fr_1fr_auto]">
                  <p className="pb-3 font-semibold">{PERSIAN_WEEKDAYS[day.weekday]}</p>
                  <label>
                    <span className="mb-1 block text-xs text-[var(--sds-text-secondary)]">از</span>
                    <PersianTimePicker ariaLabel={`زمان شروع ${PERSIAN_WEEKDAYS[day.weekday]}`} value={day.startTime} onChange={(next) => updateDay(day.weekday, 'startTime', next)} disabled={readOnly} />
                  </label>
                  <label>
                    <span className="mb-1 block text-xs text-[var(--sds-text-secondary)]">تا</span>
                    <PersianTimePicker ariaLabel={`زمان پایان ${PERSIAN_WEEKDAYS[day.weekday]}`} value={day.endTime} onChange={(next) => updateDay(day.weekday, 'endTime', next)} disabled={readOnly} />
                  </label>
                  <p className="pb-3 text-left text-xs text-[var(--sds-text-secondary)]" dir="ltr">{formatTime12(day.startTime)} – {formatTime12(day.endTime)}</p>
                </div>
              ))}
            </div>
          </ErpCard>
        </>
      )}
    </div>
  );
}

function BulkTimes({ initialStart, initialEnd, onApply }: { initialStart: string; initialEnd: string; onApply: (start: string, end: string) => void }) {
  const [startTime, setStartTime] = React.useState(initialStart); const [endTime, setEndTime] = React.useState(initialEnd);
  React.useEffect(() => { setStartTime(initialStart); setEndTime(initialEnd); }, [initialStart, initialEnd]);
  return <ErpCard className="sds-neumorphic-card grid items-end gap-3 p-4 sm:grid-cols-[1fr_1fr_auto]"><label><span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)]">شروع همه روزهای انتخاب‌شده</span><PersianTimePicker ariaLabel="زمان شروع همه روزهای انتخاب‌شده" value={startTime} onChange={setStartTime} /></label><label><span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)]">پایان همه روزهای انتخاب‌شده</span><PersianTimePicker ariaLabel="زمان پایان همه روزهای انتخاب‌شده" value={endTime} onChange={setEndTime} /></label><ErpButton label="اعمال زمان" variant="solid" disabled={!startTime || !endTime} onClick={() => onApply(startTime, endTime)} /></ErpCard>;
}
