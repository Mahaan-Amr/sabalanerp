'use client';

import { ErpButton, ErpPressable, ErpSegmentedControl, ErpSheet } from '@/components/erp';
import { useEffect, useRef, useState } from 'react';
import { FaChevronDown, FaClock } from 'react-icons/fa';
import {
  formatTime12,
  parseTimeSelection,
  to24HourTime,
  type PersianTimeSelection,
} from './persianTimeState';

interface PersianTimePickerProps { value?: string; onChange: (value: string) => void; placeholder?: string; disabled?: boolean; className?: string; ariaLabel?: string }

export { formatTime12 } from './persianTimeState';

export default function PersianTimePicker({ value, onChange, placeholder = 'انتخاب ساعت', disabled = false, className = '', ariaLabel }: PersianTimePickerProps) {
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState(() => parseTimeSelection(value));
  const anchorRef = useRef<HTMLButtonElement>(null);

  useEffect(() => setSelection(parseTimeSelection(value)), [value]);
  const commit = (next: PersianTimeSelection) => { setSelection(next); onChange(to24HourTime(next)); };

  return <div className={className} dir="ltr">
    <ErpPressable ref={anchorRef} type="button" disabled={disabled} aria-label={ariaLabel || placeholder} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((current) => !current)} variant="outline" className="flex min-h-12 w-full items-center justify-between gap-3 text-left disabled:cursor-not-allowed disabled:opacity-50">
      <span className="flex items-center gap-2"><FaClock className="text-[var(--sds-accent)]" /><span>{value ? formatTime12(value) : placeholder}</span></span><FaChevronDown className={`text-xs sds-text-muted transition ${open ? 'rotate-180' : ''}`} />
    </ErpPressable>
    <ErpSheet open={open} onClose={() => setOpen(false)} title="انتخاب ساعت" presentation="modal" returnFocusElement={anchorRef.current} footer={<div className="flex justify-between"><ErpButton label="پاک‌کردن" tone="neutral" variant="ghost" onClick={() => { onChange(''); setOpen(false); }} /><ErpButton label="تأیید ساعت" variant="solid" onClick={() => setOpen(false)} /></div>}>
      <div dir="rtl">
      <div className="mb-4 flex flex-col items-start justify-between gap-3 sm:flex-row"><div><p className="text-xs sds-text-secondary">{formatTime12(to24HourTime(selection))} · {selection.period === 'AM' ? 'قبل‌ازظهر' : 'بعدازظهر'}</p></div><div className="w-full sm:min-w-40 sm:w-auto" dir="ltr"><ErpSegmentedControl value={selection.period} onChange={(period) => commit({ ...selection, period })} options={[{ value: 'AM', label: 'AM · قبل‌ازظهر' }, { value: 'PM', label: 'PM · بعدازظهر' }]} /></div></div>
      <p className="mb-2 text-xs font-semibold sds-text-secondary">ساعت</p><div className="grid grid-cols-6 gap-1" dir="ltr">{Array.from({ length: 12 }, (_, index) => index + 1).map((hour) => <ErpPressable key={hour} type="button" aria-label={`ساعت ${hour}`} aria-pressed={selection.hour === hour} onClick={() => commit({ ...selection, hour })} tone={selection.hour === hour ? 'primary' : 'neutral'} variant={selection.hour === hour ? 'solid' : 'ghost'} className="min-h-11 text-sm">{hour}</ErpPressable>)}</div>
      <p className="mb-2 mt-4 text-xs font-semibold sds-text-secondary">دقیقه</p><div className="grid max-h-32 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-10" dir="ltr">{Array.from({ length: 60 }, (_, minute) => minute).map((minute) => <ErpPressable key={minute} type="button" aria-label={`دقیقه ${minute}`} aria-pressed={selection.minute === minute} onClick={() => commit({ ...selection, minute })} tone={selection.minute === minute ? 'primary' : 'neutral'} variant={selection.minute === minute ? 'solid' : 'ghost'} className="min-h-11 text-xs">{String(minute).padStart(2, '0')}</ErpPressable>)}</div>
      </div>
    </ErpSheet>
  </div>;
}
