'use client';

import type { ReactNode } from 'react';
import PersianCalendarComponent from '@/components/PersianCalendar';

export default function ErpPersianDateField({
  label,
  value,
  onChange,
  placeholder,
  required = false,
  disableFutureDates = false,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  disableFutureDates?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)]">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
      <PersianCalendarComponent value={value} onChange={onChange} placeholder={placeholder} disableFutureDates={disableFutureDates} />
    </label>
  );
}
