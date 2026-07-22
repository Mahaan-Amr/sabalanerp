'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FaCalendarAlt, FaCheck, FaChevronLeft, FaChevronRight, FaTimes } from 'react-icons/fa';
import moment from 'moment-jalaali';
import PersianCalendar from '@/lib/persian-calendar';
import PersianTimePicker from './PersianTimePicker';

export interface PersianCalendarProps {
  value?: string;
  onChange: (date: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  showTime?: boolean;
  enableYearSelection?: boolean;
  minYear?: number;
  maxYear?: number;
  disablePastDates?: boolean;
  clearable?: boolean;
}

const splitDateTime = (raw?: string) => {
  if (!raw) return { date: '', time: '' };
  const [datePart, timePart = ''] = raw.trim().split(/\s+/, 2);
  return { date: datePart, time: timePart };
};

const dateOnly = (year: number, month: number, day: number) => `${year}/${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}`;

export default function PersianCalendarComponent({
  value,
  onChange,
  placeholder = 'انتخاب تاریخ',
  className = '',
  disabled = false,
  showTime = false,
  enableYearSelection = false,
  minYear = 1300,
  maxYear = 1410,
  disablePastDates = false,
  clearable = false,
}: PersianCalendarProps) {
  const initial = splitDateTime(value);
  const [open, setOpen] = useState(false);
  const [draftDate, setDraftDate] = useState(initial.date);
  const [draftTime, setDraftTime] = useState(initial.time);
  const [currentMonth, setCurrentMonth] = useState((initial.date || PersianCalendar.now()).slice(0, 7));
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

  useEffect(() => {
    if (open) return;
    const next = splitDateTime(value);
    setDraftDate(next.date);
    setDraftTime(next.time);
    if (next.date) setCurrentMonth(next.date.slice(0, 7));
  }, [open, value]);

  const updateLayout = useCallback(() => {
    const isMobile = window.matchMedia('(max-width: 639px)').matches;
    setMobile(isMobile);
    if (isMobile || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.min(Math.max(rect.width, 344), window.innerWidth - 32);
    const height = showTime ? 510 : 440;
    const top = rect.bottom + height + 12 <= window.innerHeight ? rect.bottom + 8 : Math.max(16, rect.top - height - 8);
    const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16));
    setPosition({ top, left, width, maxHeight: Math.min(height, window.innerHeight - 32) });
  }, [showTime]);

  useEffect(() => {
    if (!open) return;
    updateLayout();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !panelRef.current?.contains(target)) setOpen(false);
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
      triggerRef.current?.focus();
    };
  }, [open, updateLayout]);

  const displayValue = useMemo(() => {
    if (!draftDate) return '';
    return PersianCalendar.formatForDisplay(showTime && draftTime ? `${draftDate} ${draftTime}` : draftDate, showTime && Boolean(draftTime));
  }, [draftDate, draftTime, showTime]);

  const commit = (date: string, time = draftTime) => {
    onChange(showTime && time ? `${date} ${time}` : date);
    setOpen(false);
  };

  const chooseDate = (date: string) => {
    if (isPast(date)) return;
    setDraftDate(date);
    if (!showTime) commit(date);
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
    const next = splitDateTime(value);
    setDraftDate(next.date);
    setDraftTime(next.time);
    setCurrentMonth((next.date || PersianCalendar.now()).slice(0, 7));
    setOpen((current) => !current);
  };

  const panel = (
    <motion.div
      ref={panelRef}
      className="persian-calendar-portal fixed z-[99999] overflow-hidden border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-950 sm:rounded-2xl"
      style={mobile ? { inset: 'auto 0 0 0', maxHeight: '92dvh' } : { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }}
      initial={reduceMotion ? false : mobile ? { opacity: 0, y: 28 } : { opacity: 0, y: -6, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={reduceMotion ? { opacity: 0 } : mobile ? { opacity: 0, y: 20 } : { opacity: 0, y: -4, scale: 0.98 }}
      transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.22, 1, 0.36, 1] }}
      role="dialog"
      aria-modal={mobile}
      aria-label="انتخاب تاریخ شمسی"
      dir="rtl"
    >
      <div className="max-h-[92dvh] overflow-y-auto p-4">
        {mobile && <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />}
        <div className="mb-4 flex items-center justify-between gap-2">
          <button type="button" onClick={() => moveMonth(-1)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#074747] disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800" disabled={year <= minYear && month === 1} aria-label="ماه قبل"><FaChevronRight /></button>
          <div className="flex min-w-0 items-center justify-center gap-2">
            <select value={month} onChange={(event) => setCurrentMonth(`${year}/${String(event.target.value).padStart(2, '0')}`)} className="h-11 rounded-xl border border-slate-200 bg-white px-2 text-sm font-bold text-slate-900 outline-none focus-visible:ring-2 focus-visible:ring-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-white" aria-label="ماه">
              {monthNames.map((name, index) => <option key={name} value={index + 1}>{name}</option>)}
            </select>
            {enableYearSelection ? <button type="button" onClick={() => setShowYearSelector((current) => !current)} className="h-11 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-900 outline-none transition hover:border-[#074747]/40 focus-visible:ring-2 focus-visible:ring-[#074747] dark:border-slate-700 dark:text-white" aria-expanded={showYearSelector}>{year.toLocaleString('fa-IR')}</button> : <span className="px-2 text-sm font-bold text-slate-900 dark:text-white">{year.toLocaleString('fa-IR')}</span>}
          </div>
          <button type="button" onClick={() => moveMonth(1)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-600 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#074747] disabled:opacity-40 dark:text-slate-200 dark:hover:bg-slate-800" disabled={year >= maxYear && month === 12} aria-label="ماه بعد"><FaChevronLeft /></button>
        </div>

        <AnimatePresence initial={false}>
          {showYearSelector && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="mb-4 overflow-hidden">
              <div className="grid max-h-36 grid-cols-4 gap-1 overflow-y-auto rounded-xl bg-slate-50 p-2 dark:bg-slate-900">
                {Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index).map((option) => (
                  <button key={option} type="button" onClick={() => { setCurrentMonth(`${option}/${String(month).padStart(2, '0')}`); setShowYearSelector(false); }} className={`min-h-11 rounded-lg text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-[#074747] ${option === year ? 'bg-[#074747] text-white' : 'text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800'}`}>{option.toLocaleString('fa-IR')}</button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="grid grid-cols-7 gap-1" aria-hidden="true">
          {dayNames.map((name, index) => <div key={name} className="py-2 text-center text-xs font-semibold text-slate-500"><span className="sm:hidden">{compactDayNames[index]}</span><span className="hidden sm:inline">{name}</span></div>)}
        </div>
        <div className="grid grid-cols-7 gap-1" role="grid">
          {Array.from({ length: firstWeekday }).map((_, index) => <span key={`empty-${index}`} />)}
          {Array.from({ length: daysInMonth }, (_, index) => index + 1).map((day) => {
            const date = dateOnly(year, month, day);
            const selected = draftDate === date;
            const today = PersianCalendar.now() === date;
            const past = isPast(date);
            return (
              <button
                key={date}
                data-date={date}
                type="button"
                role="gridcell"
                disabled={past}
                aria-selected={selected}
                aria-label={PersianCalendar.formatForDisplay(date)}
                onClick={() => chooseDate(date)}
                onKeyDown={(event) => {
                  const moves: Record<string, number> = { ArrowRight: -1, ArrowLeft: 1, ArrowUp: -7, ArrowDown: 7 };
                  if (moves[event.key] != null) { event.preventDefault(); moveFocusedDate(date, moves[event.key]); }
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); chooseDate(date); }
                }}
                className={`relative inline-flex min-h-11 items-center justify-center rounded-xl text-sm font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-[#074747] ${past ? 'cursor-not-allowed text-slate-300 dark:text-slate-700' : selected ? 'bg-[#074747] text-white shadow-sm' : 'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'} ${today && !selected ? 'ring-1 ring-inset ring-teal-500' : ''}`}
              >
                {day.toLocaleString('fa-IR')}
              </button>
            );
          })}
        </div>

        {showTime && (
          <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-800">
            <span className="mb-2 block text-xs font-semibold text-slate-500">زمان</span>
            <PersianTimePicker value={draftTime} onChange={setDraftTime} className="w-full" />
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-slate-200 pt-4 dark:border-slate-800">
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => chooseDate(PersianCalendar.now())} disabled={isPast(PersianCalendar.now())} className="min-h-11 rounded-xl px-3 text-sm font-bold text-[#074747] outline-none transition hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-[#074747] dark:text-teal-200 dark:hover:bg-teal-950/40">امروز</button>
            {clearable && <button type="button" onClick={() => { setDraftDate(''); setDraftTime(''); onChange(''); setOpen(false); }} className="min-h-11 rounded-xl px-3 text-sm font-semibold text-slate-500 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#074747] dark:hover:bg-slate-800">پاک‌کردن</button>}
          </div>
          {showTime ? (
            <button type="button" onClick={() => draftDate && commit(draftDate)} disabled={!draftDate} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#074747] px-4 text-sm font-bold text-white outline-none transition hover:bg-[#0b5c5c] focus-visible:ring-2 focus-visible:ring-[#074747] focus-visible:ring-offset-2 disabled:opacity-50"><FaCheck />تأیید</button>
          ) : (
            <button type="button" onClick={() => setOpen(false)} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 outline-none transition hover:bg-slate-100 focus-visible:ring-2 focus-visible:ring-[#074747] dark:hover:bg-slate-800" aria-label="بستن"><FaTimes /></button>
          )}
        </div>
      </div>
    </motion.div>
  );

  return (
    <div className={`relative ${className}`}>
      <button ref={triggerRef} type="button" disabled={disabled} onClick={openCalendar} aria-haspopup="dialog" aria-expanded={open} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-3 text-right text-sm outline-none transition hover:border-[#074747]/35 focus-visible:border-[#074747] focus-visible:ring-2 focus-visible:ring-[#074747]/20 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-teal-700">
        <span className="flex min-w-0 items-center gap-2"><FaCalendarAlt className="h-4 w-4 flex-shrink-0 text-teal-600 dark:text-teal-300" /><span className={`truncate ${draftDate ? 'font-semibold text-slate-900 dark:text-white' : 'text-slate-500'}`}>{draftDate ? displayValue : placeholder}</span></span>
        <FaChevronLeft className={`h-3.5 w-3.5 flex-shrink-0 text-slate-400 transition-transform ${open ? '-rotate-90' : ''}`} />
      </button>
      {typeof document !== 'undefined' && createPortal(<AnimatePresence>{open && panel}</AnimatePresence>, document.body)}
    </div>
  );
}

export function PersianDateRangePicker({ value, onChange, className = '', disablePastDates = false }: { value: { startDate: string; endDate: string }; onChange: (value: { startDate: string; endDate: string }) => void; className?: string; disablePastDates?: boolean }) {
  return (
    <div className={`grid grid-cols-1 gap-3 sm:grid-cols-2 ${className}`}>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">از تاریخ</span><PersianCalendarComponent value={value.startDate} onChange={(startDate) => onChange({ ...value, startDate })} disablePastDates={disablePastDates} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">تا تاریخ</span><PersianCalendarComponent value={value.endDate} onChange={(endDate) => onChange({ ...value, endDate })} disablePastDates={disablePastDates} /></label>
    </div>
  );
}
