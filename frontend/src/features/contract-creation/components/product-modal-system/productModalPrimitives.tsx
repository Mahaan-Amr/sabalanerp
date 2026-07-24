'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  convertCompactLengthUnit,
  type CompactLengthUnit,
  type ProductModalView
} from './productModalState';

const cx = (...classes: Array<string | false | null | undefined>) =>
  classes.filter(Boolean).join(' ');

export interface SegmentedOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly disabled?: boolean;
}

export function CompactSegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  className
}: {
  label: string;
  value: Value;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  className?: string;
}) {
  const selectRelative = (direction: 1 | -1) => {
    const enabled = options.filter(option => !option.disabled);
    const currentIndex = enabled.findIndex(option => option.value === value);
    const nextIndex = (currentIndex + direction + enabled.length) % enabled.length;
    if (enabled[nextIndex]) onChange(enabled[nextIndex].value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        'inline-flex min-h-8 rounded-lg border border-slate-300 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-900',
        className
      )}
      onKeyDown={event => {
        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
          event.preventDefault();
          selectRelative(1);
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
          event.preventDefault();
          selectRelative(-1);
        }
      }}
    >
      {options.map(option => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cx(
            'min-h-7 rounded-md px-2.5 text-xs font-semibold transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500',
            option.value === value
              ? 'bg-teal-600 text-white shadow-sm'
              : 'text-slate-600 hover:bg-white dark:text-slate-300 dark:hover:bg-slate-800',
            option.disabled && 'cursor-not-allowed opacity-40'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CompactUnitSwitch({
  value,
  unit,
  onChange,
  label
}: {
  value: string;
  unit: CompactLengthUnit;
  onChange: (next: { value: string; unit: CompactLengthUnit }) => void;
  label: string;
}) {
  return (
    <CompactSegmentedControl
      label={label}
      value={unit}
      options={[
        { value: 'cm', label: 'cm' },
        { value: 'm', label: 'm' }
      ]}
      onChange={nextUnit => onChange({
        unit: nextUnit,
        value: convertCompactLengthUnit(value, unit, nextUnit)
      })}
      className="min-h-6 rounded-full border-slate-300 bg-transparent p-0 [&_button]:min-h-6 [&_button]:rounded-full [&_button]:px-1.5 [&_button]:text-[10px]"
    />
  );
}

export const AutoGrowingDescription = React.forwardRef<
  HTMLTextAreaElement,
  Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'placeholder'>
>(function AutoGrowingDescription({ className, onInput, ...props }, ref) {
  const internalRef = React.useRef<HTMLTextAreaElement>(null);
  React.useImperativeHandle(ref, () => internalRef.current as HTMLTextAreaElement);
  const resize = React.useCallback((element: HTMLTextAreaElement) => {
    element.style.height = 'auto';
    const lineHeight = Number.parseFloat(getComputedStyle(element).lineHeight) || 24;
    const maxHeight = lineHeight * 4 + 16;
    element.style.height = `${Math.min(element.scrollHeight, maxHeight)}px`;
    element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, []);
  React.useLayoutEffect(() => {
    if (internalRef.current) resize(internalRef.current);
  }, [props.value, resize]);
  return (
    <textarea
      {...props}
      ref={internalRef}
      rows={1}
      onInput={event => {
        resize(event.currentTarget);
        onInput?.(event);
      }}
      className={cx(
        'min-h-10 w-full resize-none rounded-lg border border-slate-300 bg-transparent px-3 py-2 text-sm',
        'focus:border-teal-500 focus:outline-none focus:ring-1 focus:ring-teal-500',
        'dark:border-slate-700',
        className
      )}
    />
  );
});

export function ReservedRowsSkeleton({
  rows = 3,
  rowHeight = 40,
  label = 'در حال بارگذاری'
}: {
  rows?: number;
  rowHeight?: number;
  label?: string;
}) {
  return (
    <div role="status" aria-label={label} className="space-y-2">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          style={{ height: rowHeight }}
          className="animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800"
        />
      ))}
    </div>
  );
}

const sectionResourceCache = new Map<string, unknown>();

export const clearProductModalSectionCache = (key?: string) => {
  if (key) sectionResourceCache.delete(key);
  else sectionResourceCache.clear();
};

export function useCachedProductModalSection<Data>(
  key: string,
  load: () => Promise<Data>,
  enabled = true
) {
  const cached = sectionResourceCache.get(key) as Data | undefined;
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const [state, setState] = React.useState<{
    data?: Data;
    loading: boolean;
    error?: Error;
  }>({ data: cached, loading: enabled && cached === undefined });

  React.useEffect(() => {
    if (!enabled) {
      setState(current => ({ ...current, loading: false }));
      return;
    }
    const current = sectionResourceCache.get(key) as Data | undefined;
    if (current !== undefined) {
      setState({ data: current, loading: false });
      return;
    }
    let active = true;
    setState({ loading: true });
    void loadRef.current().then(data => {
      sectionResourceCache.set(key, data);
      if (active) setState({ data, loading: false });
    }).catch(error => {
      if (active) {
        setState({
          loading: false,
          error: error instanceof Error ? error : new Error('Section request failed')
        });
      }
    });
    return () => {
      active = false;
    };
  }, [enabled, key]);

  return state;
}

export function InlineCollectionSection({
  title,
  actionLabel,
  onAction,
  emptyText,
  children
}: {
  title: string;
  actionLabel: string;
  onAction: () => void;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="border-t border-slate-200 py-3 dark:border-slate-800">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">{title}</h3>
        <button type="button" onClick={onAction} className="text-xs font-semibold text-teal-700 hover:underline dark:text-teal-300">
          {actionLabel}
        </button>
      </div>
      <div className="mt-2 text-sm text-slate-600 dark:text-slate-300">
        {children ?? <div className="min-h-9 border-y border-slate-100 py-2 dark:border-slate-800">{emptyText}</div>}
      </div>
    </section>
  );
}

export const focusProductModalError = (
  field: HTMLElement | null,
  reducedMotion: boolean
) => {
  if (!field) return;
  field.scrollIntoView({
    block: 'center',
    behavior: reducedMotion ? 'auto' : 'smooth'
  });
  field.focus({ preventScroll: true });
};

export function CentralProductModalShell({
  open,
  title,
  view,
  onClose,
  onBack,
  children,
  primaryLabel,
  pendingLabel = 'در حال ذخیره…',
  pending,
  onPrimary
}: {
  open: boolean;
  title: string;
  view: ProductModalView;
  onClose: () => void;
  onBack?: () => void;
  children: React.ReactNode;
  primaryLabel: string;
  pendingLabel?: string;
  pending: boolean;
  onPrimary: () => void;
}) {
  const reducedMotion = useReducedMotion();
  const dialogRef = React.useRef<HTMLElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusableSelector = [
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'textarea:not([disabled])',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const focusFirst = () => {
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector);
      focusable?.[0]?.focus();
    };
    const focusTimer = window.setTimeout(focusFirst, reducedMotion ? 0 : 30);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) {
        event.preventDefault();
        view === 'main' ? onClose() : onBack?.();
      } else if (event.key === 'Tab') {
        const focusable = Array.from(
          dialogRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []
        );
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused?.focus();
    };
  }, [onBack, onClose, open, pending, reducedMotion, view]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 p-3"
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.18 }}
          role="presentation"
        >
          <motion.section
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="central-product-modal-title"
            className="flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-950"
            initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
              <div className="flex min-w-0 items-center gap-3">
                {view !== 'main' && onBack && (
                  <button type="button" onClick={onBack} disabled={pending} className="text-xs font-semibold text-teal-700 dark:text-teal-300">
                    بازگشت
                  </button>
                )}
                <h2 id="central-product-modal-title" className="truncate text-base font-black">{title}</h2>
              </div>
              <button type="button" onClick={onClose} disabled={pending} aria-label="بستن" className="min-h-9 px-2 text-sm text-slate-500">
                بستن
              </button>
            </header>
            <motion.div
              key={view}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3"
              initial={reducedMotion ? false : { opacity: 0, x: 6 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: reducedMotion ? 0 : 0.17 }}
            >
              {children}
            </motion.div>
            <footer className="sticky bottom-0 z-10 flex min-h-16 items-center justify-end gap-2 border-t border-slate-200 bg-white px-4 dark:border-slate-800 dark:bg-slate-950">
              <button type="button" onClick={view === 'main' ? onClose : onBack} disabled={pending} className="min-h-10 rounded-lg px-4 text-sm font-semibold text-slate-600 dark:text-slate-300">
                {view === 'main' ? 'انصراف' : 'بازگشت'}
              </button>
              <button
                type="button"
                onClick={onPrimary}
                disabled={pending}
                aria-busy={pending}
                className="min-h-10 min-w-28 rounded-lg bg-teal-600 px-4 text-sm font-bold text-white disabled:cursor-wait disabled:opacity-70"
              >
                {pending ? pendingLabel : primaryLabel}
              </button>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
