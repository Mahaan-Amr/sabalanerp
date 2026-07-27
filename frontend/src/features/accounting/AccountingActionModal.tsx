'use client';
import { ErpInput, ErpPressable, ErpTextarea } from '@/components/erp';
import { useEffect, useMemo, useState } from 'react';
import { FaTimes } from 'react-icons/fa';
import FormattedNumberInput from '@/components/FormattedNumberInput';
import PersianCalendarComponent from '@/components/PersianCalendar';
import EnhancedDropdown from '@/components/EnhancedDropdown';
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
      placeholder?: string;
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
    `min-h-11 w-full rounded-lg border bg-[var(--sds-surface-subtle)] px-3 py-2 text-sm text-[var(--sds-text-primary)] outline-none transition focus:border-[var(--sds-accent)] focus:bg-[var(--sds-surface-raised)] focus:ring-2 focus:ring-[var(--sds-accent)]/15 dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)] dark:focus:border-[var(--sds-border-strong)] ${
      invalid ? 'border-[var(--sds-danger-border)] dark:border-[var(--sds-danger-border)]' : 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]'
    }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sds-surface-raised)] p-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-xl rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 shadow-2xl dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</h2>
            {description && <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{description}</p>}
          </div>
          <ErpPressable
            type="button"
            onClick={onClose}
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--sds-border-default)] text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] dark:border-[var(--sds-border-strong)] dark:text-[var(--sds-text-muted)] dark:hover:bg-[var(--sds-surface-raised)]"
            aria-label="بستن"
          >
            <FaTimes className="h-4 w-4" />
          </ErpPressable>
        </div>

        <div className="mt-5 space-y-4">
          {fields.map((field) => {
            const invalid = Boolean(touched[field.id] && missingFields.some((item) => item.id === field.id));
            const value = values[field.id] ?? '';
            return (
              <label key={field.id} className="block">
                <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                  {field.label}
                  {field.required && <span className="text-[var(--sds-danger)]"> *</span>}
                </span>
                {field.type === 'textarea' ? (
                  <ErpTextarea
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
                  <EnhancedDropdown
                    value={String(value)}
                    onChange={(next) => setValue(field.id, next)}
                    options={field.options}
                    placeholder={field.placeholder || field.label}
                    searchable
                    required={field.required}
                    error={invalid ? 'این فیلد الزامی است.' : undefined}
                  />
                ) : (
                  <ErpInput
                    value={String(value)}
                    onBlur={() => setTouched((current) => ({ ...current, [field.id]: true }))}
                    onChange={(event) => setValue(field.id, event.target.value)}
                    placeholder={field.placeholder}
                    className={fieldClass(invalid)}
                  />
                )}
                {invalid && <p className="mt-1 text-xs text-[var(--sds-danger)] dark:text-[var(--sds-danger)]">این فیلد الزامی است.</p>}
              </label>
            );
          })}
        </div>

        {error && <p className="mt-4 rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] px-3 py-2 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">{error}</p>}

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ErpButton label="انصراف" tone="neutral" variant="outline" onClick={onClose} disabled={busy} />
          <ErpButton label={submitLabel} tone="primary" onClick={submit} disabled={busy} />
        </div>
      </div>
    </div>
  );
}
