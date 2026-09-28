'use client';

import React, { type ReactNode } from 'react';
import PersianCalendarComponent, { type PersianCalendarProps } from '@/components/PersianCalendar';
import { fromPersianDateFieldValue, toPersianDateFieldValue, type PersianDateFieldValueFormat } from './persianDateFieldValue';

export default function ErpPersianDateField({
  label,
  value,
  onChange,
  placeholder,
  valueFormat = 'persian',
  required = false,
  disableFutureDates = false,
  ...calendarProps
}: {
  label?: ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
  valueFormat?: PersianDateFieldValueFormat;
} & Omit<PersianCalendarProps, 'value' | 'onChange'>) {
  const calendar = <PersianCalendarComponent {...calendarProps} value={toPersianDateFieldValue(value, valueFormat)}
    onChange={(next) => onChange(fromPersianDateFieldValue(next, valueFormat))} placeholder={placeholder}
    enableYearSelection={calendarProps.enableYearSelection ?? valueFormat !== 'persian'}
    showTime={valueFormat === 'local-datetime' || calendarProps.showTime} disableFutureDates={disableFutureDates} />;
  if (!label) return calendar;
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)]">{label}{required ? <span aria-hidden="true"> *</span> : null}</span>
      {calendar}
    </label>
  );
}
