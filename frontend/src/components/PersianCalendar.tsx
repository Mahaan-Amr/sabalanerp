'use client';

import { ErpButton, ErpPressable, ErpSelect, useErpOverlayPortalContainer } from '@/components/erp';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FaCalendarAlt, FaCheck, FaChevronLeft, FaChevronRight, FaTimes } from 'react-icons/fa';
import moment from 'moment-jalaali';
import PersianCalendar from '@/lib/persian-calendar';
import PersianTimePicker from './PersianTimePicker';
import { isCalendarOwnedInteraction } from './calendarOverlayPolicy';
import { resolveDateTimeSelection } from './persianCalendarCommitPolicy';
import { normalizeYearOnlyValue, yearOnlyOptions } from './persianCalendarYearPolicy';

export interface PersianCalendarProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean | 'true' | 'false';
  value?: string;
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  showTime?: boolean;
  autoCommitDateTime?: boolean;
  enableYearSelection?: boolean;
  minYear?: number;
  maxYear?: number;
  disablePastDates?: boolean;
  disableFutureDates?: boolean;
  clearable?: boolean;
  yearOnly?: boolean;
}

const splitDateTime = (raw?: string) => {
  if (!raw) return { date: '', time: '' };
  const [datePart, timePart = ''] = raw.trim().split(/\s+/, 2);
  return { date: datePart, time: timePart };
};

const dateOnly = (year: number, month: number, day: number) => `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

export default function PersianCalendarComponent({
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  value,
  onChange,
  placeholder = 'انتخاب تاریخ',
  className = '',
  disabled = false,
  showTime = false,
  autoCommitDateTime = false,
  enableYearSelection = false,
  minYear = 1300,
  maxYear = 1410,
  disablePastDates = false,
  disableFutureDates = false,
  clearable = false,
  yearOnly = false,
}: PersianCalendarProps) {
  const overlayPortalContainer = useErpOverlayPortalContainer();
  const initial = yearOnly
    ? { date: normalizeYearOnlyValue(value, minYear, maxYear), time: '' }
    : splitDateTime(value);
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(initial.date);
  const [draftTime, setDraftTime] = useState(initial.time);
  const [currentMonth, setCurrentMonth] = useState(yearOnly
    ? `${initial.date || PersianCalendar.now().slice(0, 4)}/01`
    : (initial.date || PersianCalendar.now()).slice(0, 7));
  const [showYearSelector, setShowYearSelector] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 344, maxHeight: 520 });
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  const monthNames = PersianCalendar.getMonthNames();
  const dayNames = PersianCalendar.getDayNames();
  const compactDayNames = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];
  const [year, month] = currentMonth.split('/').map(Number);
  const daysInMonth = moment().jYear(year).jMonth(month - 1).daysInMonth();
  const firstWeekday = (() => {
    const weekday = moment().jYear(year).jMonth(month - 1).jDate(1).day();
    return weekday === 6 ? 0 : weekday + 1;
  })();

  const isPast = useCallback((date: string) => disablePastDates && moment(date, 'jYYYY/jMM/jDD').isBefore(moment().startOf('day'), 'day'), [disablePastDates]);
  const isFuture = useCallback((date: string) => disableFutureDates && moment(date, 'jYYYY/jMM/jDD').isAfter(moment().startOf('day'), 'day'), [disableFutureDates]);

  useEffect(() => {
    if (open) return;
    const next = yearOnly
      ? { date: normalizeYearOnlyValue(value, minYear, maxYear), time: '' }
      : splitDateTime(value);
    setDraftDate(next.date);
    setDraftTime(next.time);
    if (next.date) setCurrentMonth(yearOnly ? `${next.date}/01` : next.date.slice(0, 7));
  }, [maxYear, minYear, open, value, yearOnly]);

  const updateLayout = useCallback(() => {
    const isMobile = window.matchMedia('(max-width: 639px)').matches;
    setMobile(isMobile);
    if (isMobile || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 344), window.innerWidth - 32);
    const height = yearOnly ? 360 : showTime ? 510 : 440;
    const top = rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 8 : Math.max(16, rect.top - height - 8);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    setPosition({ top, left, width, maxHeight: Math.min(height, window.innerHeight - 32) });
  }, [showTime, yearOnly]);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    updateLayout();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!isCalendarOwnedInteraction({
        target: target instanceof Element ? target : null,
        triggerContains: Boolean(triggerRef.current?.contains(target)),
        panelContains: Boolean(panelRef.current?.contains(target)),
      })) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', updateLayout, true);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('resize', updateLayout);
      window.removeEventListener('scroll', updateLayout, true);
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      trigger?.focus();
    };
  }, [open, updateLayout]);

  const displayValue = useMemo(() => {
    if (!draftDate) return '';
    if (yearOnly) return draftDate;
    return PersianCalendar.formatForDisplay(showTime && draftTime ? `${draftDate} ${draftTime}` : draftDate, showTime && Boolean(draftTime));
  }, [draftDate, draftTime, showTime, yearOnly]);

  const commit = (date: string, time = draftTime) => {
    onChange(showTime && time ? `${date} ${time}` : date);
    setOpen(false);
  };

  const chooseDate = (date: string) => {
    if (isPast(date) || isFuture(date)) return;
    if (showTime && autoCommitDateTime) {
      const selection = resolveDateTimeSelection({
        initialValue: value || '', draftDate, draftTime,
        changedPart: 'date', nextValue: date,
      });
      setDraftDate(selection.date);
      if (selection.commitValue) commit(selection.date, selection.time);
      return;
    }
    setDraftDate(date);
    if (!showTime) commit(date);
  };

  const chooseTime = (time: string) => {
    if (!autoCommitDateTime) {
      setDraftTime(time);
      return;
    }
    const selection = resolveDateTimeSelection({
      initialValue: value || '', draftDate, draftTime,
      changedPart: 'time', nextValue: time,
    });
    setDraftTime(selection.time);
    if (selection.commitValue) commit(selection.date, selection.time);
  };

  const moveMonth = (amount: number) => {
    const next = moment(`${currentMonth}/01`, 'jYYYY/jMM/jDD').add(amount, 'jMonth');
    const nextYear = next.jYear();
    if (nextYear < minYear || nextYear > maxYear) return;
    setCurrentMonth(next.format('jYYYY/jMM'));
  };

  const moveFocusedDate = (date: string, amount: number) => {
    const next = moment(date, 'jYYYY/jMM/jDD').add(amount, 'day');
    const nextDate = next.format('jYYYY/jMM/jDD');
    if (next.jYear() < minYear || next.jYear() > maxYear || isPast(nextDate)) return;
    setDraftDate(nextDate);
    setCurrentMonth(next.format('jYYYY/jMM'));
    window.requestAnimationFrame(() => panelRef.current?.querySelector<HTMLButtonElement>(`[data-date="${nextDate}"]`)?.focus());
  };

  const openCalendar = () => {
    if (disabled) return;
    const next = yearOnly
      ? { date: normalizeYearOnlyValue(value, minYear, maxYear), time: '' }
      : splitDateTime(value);
    setDraftDate(next.date);
    setDraftTime(next.time);
    setCurrentMonth(yearOnly
      ? `${next.date || PersianCalendar.now().slice(0, 4)}/01`
      : (next.date || PersianCalendar.now()).slice(0, 7));
    setOpen((current) => !current);
  };

  const chooseYear = (selectedYear: number) => {
    const next = String(selectedYear);
    setDraftDate(next);
    setCurrentMonth(`${next}/01`);
    onChange(next);
    setOpen(false);
  };

  const panel = (
    <motion.div
      data-erp-overlay-root
      ref={panelRef}
      className="persian-calendar-portal fixed z-[99999] overflow-hidden rounded-[var(--sds-radius-dialog)] border border-[var(--sds-border-default)] bg-[var(--sds-surface-panel)] shadow-[var(--sds-shadow-raised)]"
      style={mobile ? { inset: 'auto 0 0 0', maxHeight: '92dvh' } : { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      initial={reduceMotion ? false : mobile ? { opacity: 0, y: 28 } : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : mobile ? { opacity: 0, y: 20 } : { opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-modal={mobile}
      aria-label={yearOnly ? "انتخاب سال شمسی" : "انتخاب تاریخ شمسی"}
      dir="rtl"
    >
      <div className="max-h-[92dvh] overflow-y-auto p-4">
        {mobile && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-[var(--sds-border-default)] dark:bg-[var(--sds-surface-subtle)]" />}
        {yearOnly ? (
          <div className="space-y-3">
            <p className="text-sm font-bold sds-text-primary">سال اخذ مدرک را انتخاب کنید</p>
            <div className="grid max-h-64 grid-cols-3 gap-2 overflow-y-auto rounded-xl bg-[var(--sds-surface-subtle)] p-2 sm:grid-cols-4">
              {yearOnlyOptions(minYear, maxYear).map((option) => (
                <ErpPressable
                  key={option}
                  type="button"
                  onClick={() => chooseYear(option)}
                  tone={draftDate === String(option) ? 'primary' : 'neutral'}
                  variant={draftDate === String(option) ? 'solid' : 'ghost'}
                  className="min-h-11 font-semibold"
                  aria-pressed={draftDate === String(option)}
                >
                  {option}
                </ErpPressable>
              ))}
            </div>
            <div className="flex justify-between border-t border-[var(--sds-border-subtle)] pt-3">
              {clearable ? <ErpButton label="پاک‌کردن" variant="ghost" onClick={() => { setDraftDate(''); onChange(''); setOpen(false); }} /> : <span />}
              <ErpButton label="بستن" variant="soft" onClick={() => setOpen(false)} />
            </div>
          </div>
        ) : <>
        <div className="mb-4 flex items-center justify-between gap-2">
          <ErpPressable type="button" onClick={() => moveMonth(-1)} className="h-11 w-11 p-0" disabled={year <= minYear && month === 1} aria-label="ماه قبل"><FaChevronRight /></ErpPressable>
          <div className="flex min-w-0 items-center justify-center gap-2">
            <ErpSelect value={month} onChange={(event) => setCurrentMonth(`${year}/${String(event.target.value).padStart(2, '0')}`)} className="h-11 px-2 font-bold" aria-label="ماه">
              {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </ErpSelect>
            {enableYearSelection ? <ErpPressable type="button" onClick={() => setShowYearSelector((current) => !current)} variant="outline" className="h-11 px-3 font-bold" aria-expanded={showYearSelector}>{year.toLocaleString('fa-IR')}</ErpPressable> : <span className="px-2 text-sm font-bold sds-text-primary">{year.toLocaleString('fa-IR')}</span>}
          </div>
          <ErpPressable type="button" onClick={() => moveMonth(1)} className="h-11 w-11 p-0" disabled={year >= maxYear && month === 12} aria-label="ماه بعد"><FaChevronLeft /></ErpPressable>
        </div>

        <AnimatePresence initial={false}>
          {showYearSelector && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
              <div className="grid max-h-36 grid-cols-4 gap-1 overflow-y-auto rounded-xl bg-[var(--sds-surface-subtle)] p-2">
                {Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index).map((option) => (
                  <ErpPressable key={option} type="button" onClick={() => { setCurrentMonth(`${option}/${String(month).padStart(2, '0')}`); setShowYearSelector(false); }} tone={option === year ? 'primary' : 'neutral'} variant={option === year ? 'solid' : 'ghost'} className="min-h-11 font-semibold">{option.toLocaleString('fa-IR')}</ErpPressable>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {dayNames.map((name, index) => <div key={name} className="py-2 text-center text-xs font-semibold sds-text-muted"><span className="sm:hidden">{compactDayNames[index]}</span><span className="hidden sm:inline">{name}</span></div>)}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid">
          {Array.from({ length: firstWeekday }).map((_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
            const date = dateOnly(year, month, day);
            const selected = draftDate === date;
            const today = PersianCalendar.now() === date;
            const unavailable = isPast(date) || isFuture(date);
            return (
              <ErpPressable
                key={date}
                data-date={date}
                type="button"
                role="gridcell"
                disabled={unavailable}
                aria-selected={selected}
                aria-label={PersianCalendar.formatForDisplay(date)}
                onClick={() => chooseDate(date)}
                onKeyDown={(event) => {
                  const moves: Record<string, number> = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 };
                  if (moves[event.key] != null) { event.preventDefault(); moveFocusedDate(date, moves[event.key]); }
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseDate(date); }
                }}
                tone={selected ? 'primary' : 'neutral'}
                variant={selected ? 'solid' : 'ghost'}
                className={`relative min-h-11 p-0 font-semibold ${unavailable ? 'cursor-not-allowed' : ''} ${today && !selected ? 'ring-1 ring-inset ring-[var(--sds-focus-ring)]' : ''}`}
              >
                {day.toLocaleString('fa-IR')}
              </ErpPressable>
            );
          })}
        </div>

        {showTime && (
          <div className="mt-4 border-t border-[var(--sds-border-subtle)] pt-4">
            <span className="mb-2 block text-xs font-semibold sds-text-muted">زمان</span>
            <PersianTimePicker value={draftTime} onChange={chooseTime} className="w-full" presentation="inline" />
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-[var(--sds-border-subtle)] pt-4">
          <div className="flex items-center gap-1">
            <ErpPressable type="button" onClick={() => chooseDate(PersianCalendar.now())} disabled={isPast(PersianCalendar.now())} tone="primary" className="min-h-11 px-3 font-bold">امروز</ErpPressable>
            {clearable && <ErpPressable type="button" onClick={() => { setDraftDate(''); setDraftTime(''); onChange(''); setOpen(false); }} className="min-h-11 px-3 font-semibold">پاک‌کردن</ErpPressable>}
          </div>
          {showTime && !autoCommitDateTime ? (
            <ErpPressable type="button" onClick={() => draftDate && commit(draftDate)} disabled={!draftDate} tone="primary" variant="solid" className="min-h-11 px-4 font-bold"><FaCheck />تأیید</ErpPressable>
          ) : (
            <ErpPressable type="button" onClick={() => setOpen(false)} className="h-11 w-11 p-0" aria-label="بستن"><FaTimes /></ErpPressable>
          )}
        </div>
        </>}
      </div>
    </motion.div>
  );

  return (
    <div className={`relative ${className}`}>
      <ErpPressable id={id} ref={triggerRef} type="button" disabled={disabled} onClick={openCalendar} aria-haspopup="dialog" aria-expanded={open} aria-describedby={ariaDescribedBy} aria-invalid={ariaInvalid} className="sds-field flex min-h-12 w-full items-center justify-between gap-3 px-3 text-right">
        <span className="flex min-w-0 items-center gap-2"><FaCalendarAlt className="h-4 w-4 flex-shrink-0 text-[var(--sds-accent)] " /><span className={`truncate ${draftDate ? 'font-semibold sds-text-primary ' : 'sds-text-muted'}`}>{draftDate ? displayValue : placeholder}</span></span>
        <FaChevronLeft className={`h-3.5 w-3.5 flex-shrink-0 sds-text-muted transition-transform ${open ? '-rotate-90' : ''}`} />
      </ErpPressable>
      {typeof document !== 'undefined' && createPortal(<AnimatePresence>{open && panel}</AnimatePresence>, overlayPortalContainer?.current || document.body)}
    </div>
  );
}

export function PersianDateRangePicker({ value, onChange, className = '', disablePastDates = false }: { value: { startDate: string; endDate: string }; onChange: (value: { startDate: string; endDate: string }) => void; className?: string; disablePastDates?: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold sds-text-muted">از تاریخ</span><PersianCalendarComponent value={value.startDate} onChange={(startDate) => onChange({ ...value, startDate })} disablePastDates={disablePastDates} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold sds-text-muted">تا تاریخ</span><PersianCalendarComponent value={value.endDate} onChange={(endDate) => onChange({ ...value, endDate })} disablePastDates={disablePastDates} /></label>
    </div>
  );
}
