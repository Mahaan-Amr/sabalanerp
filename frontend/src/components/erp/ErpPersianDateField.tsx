'use client';

import type { ReactNode } from 'react';
import PersianCalendarComponent from '@/components/PersianCalendar';

export default function ErpPersianDateField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)]">{label}</span>
      <PersianCalendarComponent value={value} onChange={onChange} placeholder={placeholder} />
    </label>
  );
}
