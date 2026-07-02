'use client';

import { useEffect, useMemo, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import { ErpButton } from '@/components/erp';
import { toFiniteNumber } from '@/lib/numberFormat';

export type AccountingActionField =
  | {
      id: string;
      label: string;
      type: 'text' | 'textarea' | 'date' | 'number';
      required?: boolean;
      placeholder?: string;
      defaultValue?: string | number;
    }
  | {
      id: string;
      label: string;
      type: 'select';
      required?: boolean;
      options: Array<{ label: string; value: string }>;
      defaultValue?: string;
    };

type AccountingActionModalProps = {
  open: boolean;
  title: string;
  description?: string;
  fields: AccountingActionField[];
  submitLabel?: string;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: Record<string, string | number>) => void | Promise<void>;
};

export default function AccountingActionModal({
  open,
  title,
  description,
  fields,
  submitLabel = 'ثبت',
  busy = false,
  error,
  onClose,
  onSubmit,
}: AccountingActionModalProps) {
  const [values, setValues] = useState<Record<string, string | number>>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const fieldDefaultsKey = useMemo(
    () => fields.map((field) => `${field.id}:${field.type}:${String(field.defaultValue ?? '')}`).join('|'),
    [fields]
  );

  useEffect(() => {
    if (!open) return;
    const nextValues: Record<string, string | number> = {};
    fields.forEach((field) => {
      if (field.defaultValue !== undefined) nextValues[field.id] = field.defaultValue;
      else if (field.type === 'date') nextValues[field.id] = PersianCalendar.now();
      else if (field.type === 'number') nextValues[field.id] = 0;
      else if (field.type === 'select') nextValues[field.id] = field.options[0]?.value || '';
      else nextValues[field.id] = '';
    });
    setValues(nextValues);
    setTouched({});
    // fields are intentionally represented by fieldDefaultsKey so typing into the modal does not reset on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, fieldDefaultsKey]);

  if (!open) return null;

  const setValue = (id: string, value: string | number) => {
    setValues((current) => ({ ...current, [id]: value }));
  };

  const missingFields = fields.filter((field) => {
    if (!field.required) return false;
    const value = values[field.id];
    return value == null || String(value).trim() === '' || (field.type === 'number' && toFiniteNumber(value) <= 0);
  });

  const submit = () => {
    if (missingFields.length) {
      setTouched(fields.reduce((acc, field) => ({ ...acc, [field.id]: true }), {}));
      return;
    }
    onSubmit(values);
  };

  const fieldClass = (invalid: boolean) =>
    `min-h-11 w-full rounded-lg border bg-slate-50 px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:bg-slate-900 dark:text-white dark:focus:border-teal-500 ${
      invalid ? 'border-red-500 dark:border-red-400' : 'border-slate-200 dark:border-slate-700'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-950 dark:text-white">{title}</h2>
            {description && <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            aria-label="بستن"
          >
            <FaTimes className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {fields.map((field) => {
            const invalid = Boolean(touched[field.id] && missingFields.some((item) => item.id === field.id));
            const value = values[field.id] ?? '';
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600 dark:text-slate-300">
                  {field.label}
                  {field.required && <span className="text-red-500"> *</span>}
                </span>
                {field.type === 'textarea' ? (
                  <textarea
                    value={String(value)}
                    onBlur={() => setTouched((current) => ({ ...current, [field.id]: true }))}
                    onChange={(event) => setValue(field.id, event.target.value)}
                    placeholder={field.placeholder}
                    rows={4}
                    className={fieldClass(invalid)}
                  />
                ) : field.type === 'date' ? (
                  <div className={fieldClass(invalid)}>
                    <PersianCalendarComponent value={String(value)} onChange={(next) => setValue(field.id, next)} placeholder={field.placeholder || field.label} />
                  </div>
                ) : field.type === 'number' ? (
                  <FormattedNumberInput
                    value={toFiniteNumber(value)}
                    onChange={(next) => setValue(field.id, next)}
                    min={0}
                    placeholder={field.placeholder}
                    className={fieldClass(invalid)}
                  />
                ) : field.type === 'select' ? (
                  <select
                    value={String(value)}
                    onChange={(event) => setValue(field.id, event.target.value)}
                    className={fieldClass(invalid)}
                  >
                    {field.options.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    value={String(value)}
                    onBlur={() => setTouched((current) => ({ ...current, [field.id]: true }))}
                    onChange={(event) => setValue(field.id, event.target.value)}
                    placeholder={field.placeholder}
                    className={fieldClass(invalid)}
                  />
                )}
                {invalid && <p className="mt-1 text-xs text-red-600 dark:text-red-300">این فیلد الزامی است.</p>}
              </label>
            );
          })}
        </div>

        {error && <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-200">{error}</p>}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ErpButton label="انصراف" tone="neutral" variant="outline" onClick={onClose} disabled={busy} />
          <ErpButton label={submitLabel} tone="primary" onClick={submit} disabled={busy} />
        </div>
      </div>
    </div>
  );
}
