'use client';

import React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  ErpInlineState,
  ErpPressable,
  ErpSkeleton,
  ErpTextarea
} from '@/components/erp';
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
  className,
  compactVisual = false
}: {
  label: string;
  value: Value | null;
  options: readonly SegmentedOption<Value>[];
  onChange: (value: Value) => void;
  className?: string;
  compactVisual?: boolean;
}) {
  const selectRelative = (direction: 1 | -1) => {
    const enabled = options.filter(option => !option.disabled);
    const currentIndex = enabled.findIndex(option => option.value === value);
    if (currentIndex < 0) {
      const first = direction === 1 ? enabled[0] : enabled[enabled.length - 1];
      if (first) onChange(first.value);
      return;
    }
    const nextIndex = (currentIndex + direction + enabled.length) % enabled.length;
    if (enabled[nextIndex]) onChange(enabled[nextIndex].value);
  };
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cx(
        'inline-flex min-h-11 rounded-[var(--sds-radius-control)] border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-0.5',
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
        <ErpPressable
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cx(
            'rounded-[var(--sds-radius-control)] text-xs font-semibold transition-colors',
            compactVisual ? 'min-h-11 border-transparent bg-transparent px-0.5' : 'min-h-10 px-2.5',
            !compactVisual && (option.value === value
              ? 'sds-tone-primary sds-action-solid'
              : 'sds-action-ghost sds-text-secondary'),
            option.disabled && 'cursor-not-allowed opacity-40'
          )}
        >
          <span className={cx(
            'inline-flex items-center justify-center',
            compactVisual && 'h-6 rounded-full px-1.5 text-[10px]',
            compactVisual && (option.value === value
              ? 'bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
              : 'text-[var(--sds-text-secondary)]')
          )}>
            {option.label}
          </span>
        </ErpPressable>
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
      compactVisual
      className="min-h-11 rounded-full border-0 bg-transparent p-0"
    />
  );
}

export function CompactSwitch({
  checked,
  onChange,
  label,
  disabled = false
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <ErpPressable
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={`${label}: ${checked ? 'روشن' : 'خاموش'}`}
      dir="ltr"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative h-11 !min-h-11 w-[51px] shrink-0 border-transparent !bg-transparent p-0',
        disabled && 'cursor-not-allowed opacity-40'
      )}
    >
      <span
        data-switch-track
        aria-hidden="true"
        className={cx(
          'absolute left-0 top-1/2 h-[31px] w-[51px] -translate-y-1/2 rounded-full border transition-colors',
          checked
            ? 'border-[var(--sds-accent)] bg-[var(--sds-accent)]'
            : 'border-[var(--sds-border-strong)] bg-[var(--sds-surface-subtle)]'
        )}
      >
        <span
          data-switch-thumb
          className={cx(
            'absolute left-px top-px h-[27px] w-[27px] rounded-full shadow-sm transition-[transform,background-color]',
            checked
              ? 'translate-x-5 bg-[var(--sds-text-inverse)]'
              : 'translate-x-0 bg-[var(--sds-text-secondary)]'
          )}
        />
      </span>
    </ErpPressable>
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
    <ErpTextarea
      {...props}
      ref={internalRef}
      rows={1}
      onInput={event => {
        resize(event.currentTarget);
        onInput?.(event);
      }}
      className={cx(
        'min-h-11 w-full resize-none px-3 py-2 text-sm',
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
        <div key={index} style={{ minHeight: rowHeight }}>
          <ErpSkeleton lines={1} className="rounded-[var(--sds-radius-control)]" />
        </div>
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
  actionLabel?: string;
  onAction?: () => void;
  emptyText: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="border-t border-[var(--sds-border-default)] py-3">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <h3 className="sds-text-primary text-sm font-bold">{title}</h3>
        {actionLabel && onAction && (
          <ErpPressable type="button" onClick={onAction} tone="primary" variant="outline" className="inline-flex min-h-11 items-center justify-center px-4 py-2 text-sm font-semibold">
            {actionLabel}
          </ErpPressable>
        )}
      </div>
      <div className="sds-text-secondary mt-2 text-sm">
        {children ?? <div className="min-h-11 border-y border-[var(--sds-border-subtle)] py-2">{emptyText}</div>}
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
  onPrimary,
  error
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
  error?: string;
}) {
  const reducedMotion = useReducedMotion();
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const onCloseRef = React.useRef(onClose);
  const onBackRef = React.useRef(onBack);
  const pendingRef = React.useRef(pending);
  onCloseRef.current = onClose;
  onBackRef.current = onBack;
  pendingRef.current = pending;
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
      if (event.key === 'Escape' && !pendingRef.current) {
        event.preventDefault();
        view === 'main' ? onCloseRef.current() : onBackRef.current?.();
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
  }, [open, reducedMotion, view]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sds-surface-overlay)] p-3"
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
              className="sds-neumorphic-card sds-text-primary flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-[var(--sds-radius-dialog)]"
            initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.99 }}
            transition={{ duration: reducedMotion ? 0 : 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            <header className="sticky top-0 z-10 flex min-h-14 items-center justify-between gap-3 border-b border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-4">
              <div className="flex min-w-0 items-center gap-3">
                {view !== 'main' && onBack && (
                  <ErpPressable type="button" onClick={onBack} disabled={pending} tone="primary" variant="ghost" className="text-xs font-semibold">
                    بازگشت
                  </ErpPressable>
                )}
                <h2 id="central-product-modal-title" className="truncate text-base font-black">{title}</h2>
              </div>
              <ErpPressable type="button" onClick={onClose} disabled={pending} aria-label="بستن" variant="ghost" className="px-2 text-sm">
                بستن
              </ErpPressable>
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
            <footer className="sticky bottom-0 z-10 border-t border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]">
              {error && (
                <ErpInlineState
                  kind="error"
                  title={error}
                  className="border-x-0 border-t-0"
                />
              )}
              <div className="flex min-h-16 items-center justify-end gap-2 px-4">
                <ErpPressable type="button" onClick={view === 'main' ? onClose : onBack} disabled={pending} variant="ghost" className="px-4 text-sm font-semibold">
                  {view === 'main' ? 'انصراف' : 'بازگشت'}
                </ErpPressable>
                <ErpPressable
                  type="button"
                  onClick={onPrimary}
                  disabled={pending}
                  aria-busy={pending}
                  tone="primary"
                  variant="solid"
                  className="min-w-28 px-4 text-sm font-bold disabled:cursor-wait disabled:opacity-70"
                >
                  {pending ? pendingLabel : primaryLabel}
                </ErpPressable>
              </div>
            </footer>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
