'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FaChevronDown, FaClock } from 'react-icons/fa';

interface PersianTimePickerProps { value?: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; className?: string }

const parseTime = (value?: string) => {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const hour24 = match ? Number(match[1]) : 8;
  return { hour: hour24 % 12 || 12, minute: match ? Number(match[2]) : 0, period: hour24 >= 12 ? 'PM' as const : 'AM' as const };
};

const to24Hour = (hour: number, minute: number, period: 'AM' | 'PM') => {
  const hour24 = period === 'AM' ? hour % 12 : (hour % 12) + 12;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
};

export const formatTime12 = (value?: string | null) => {
  if (!value) return '';
  const parsed = parseTime(value);
  return `${String(parsed.hour).padStart(2, '0')}:${String(parsed.minute).padStart(2, '0')} ${parsed.period}`;
};

export default function PersianTimePicker({ value, onChange, placeholder = 'انتخاب ساعت', disabled = false, className = '' }: PersianTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(() => parseTime(value));
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0, width: 320 });

  useEffect(() => setSelection(parseTime(value)), [value]);
  const updatePosition = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(340, window.innerWidth - 32);
    const left = Math.max(16, Math.min(rect.right - width, window.innerWidth - width - 16));
    const top = rect.bottom + 330 > window.innerHeight ? Math.max(16, rect.top - 338) : rect.bottom + 8;
    setPosition({ top, left, width });
  };
  useEffect(() => {
    if (!open) return;
    updatePosition();
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!anchorRef.current?.contains(target) && !document.querySelector('.persian-time-picker-portal')?.contains(target)) setOpen(false);
    };
    window.addEventListener('resize', updatePosition); window.addEventListener('scroll', updatePosition); document.addEventListener('mousedown', close);
    return () => { window.removeEventListener('resize', updatePosition); window.removeEventListener('scroll', updatePosition); document.removeEventListener('mousedown', close); };
  }, [open]);
  const commit = (next: typeof selection) => { setSelection(next); onChange(to24Hour(next.hour, next.minute, next.period)); };

  return <div className={className} dir="ltr">
    <button ref={anchorRef} type="button" disabled={disabled} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }} className="glass-liquid-input flex min-h-12 w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50">
      <span className="flex items-center gap-2"><FaClock className="text-teal-500" /><span>{value ? formatTime12(value) : placeholder}</span></span><FaChevronDown className={`text-xs text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
    </button>
    {open && typeof window !== 'undefined' && createPortal(<div className="persian-time-picker-portal glass-liquid-card fixed z-[99999] border border-slate-200 p-4 shadow-2xl dark:border-white/20" style={{ top: position.top, left: position.left, width: position.width }} dir="rtl">
      <div className="mb-4 flex items-center justify-between gap-3"><div><p className="font-bold text-primary">انتخاب ساعت</p><p className="text-xs text-secondary">{formatTime12(to24Hour(selection.hour, selection.minute, selection.period))} · {selection.period === 'AM' ? 'قبل‌ازظهر' : 'بعدازظهر'}</p></div><div className="flex rounded-lg border border-slate-200 p-1 dark:border-slate-700" dir="ltr">{(['AM', 'PM'] as const).map((period) => <button key={period} type="button" onClick={() => commit({ ...selection, period })} className={`rounded-md px-3 py-2 text-sm font-bold ${selection.period === period ? 'bg-teal-500 text-white' : 'text-secondary hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{period}<span className="mr-1 text-[10px] font-normal">{period === 'AM' ? 'قبل‌ازظهر' : 'بعدازظهر'}</span></button>)}</div></div>
      <p className="mb-2 text-xs font-semibold text-secondary">ساعت</p><div className="grid grid-cols-6 gap-1" dir="ltr">{Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <button key={hour} type="button" onClick={() => commit({ ...selection, hour })} className={`rounded-lg py-2 text-sm ${selection.hour === hour ? 'bg-teal-500 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{hour}</button>)}</div>
      <p className="mb-2 mt-4 text-xs font-semibold text-secondary">دقیقه</p><div className="grid max-h-24 grid-cols-10 gap-1 overflow-y-auto" dir="ltr">{Array.from({ length: 60 }, (_, minute) => minute).map((minute) => <button key={minute} type="button" onClick={() => commit({ ...selection, minute })} className={`rounded-md py-1.5 text-xs ${selection.minute === minute ? 'bg-teal-500 text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{String(minute).padStart(2, '0')}</button>)}</div>
      <div className="mt-4 flex justify-between border-t border-slate-200 pt-3 dark:border-slate-700"><button type="button" onClick={() => { onChange(''); setOpen(false); }} className="glass-liquid-btn px-3 py-2 text-sm">پاک‌کردن</button><button type="button" onClick={() => setOpen(false)} className="glass-liquid-btn-primary px-4 py-2 text-sm">تأیید</button></div>
    </div>, document.body)}
  </div>;
}
