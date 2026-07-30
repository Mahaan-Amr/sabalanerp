'use client';

import React from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FaArrowRight, FaCheck, FaEllipsisV, FaExclamationTriangle, FaInfoCircle, FaRedo, FaSearch, FaTimes } from 'react-icons/fa';
import EnhancedDropdown from '@/components/EnhancedDropdown';

type IconType = React.ComponentType<{ className?: string }>;

export type ErpTone = 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple';

export type ErpAction = {
  label: string;
  href?: string;
  onClick?: () => void;
  icon?: IconType;
  tone?: ErpTone;
  variant?: 'solid' | 'soft' | 'outline' | 'ghost';
  disabled?: boolean;
  title?: string;
  className?: string;
};

export type ErpMetric = {
  label: string;
  value: React.ReactNode;
  hint?: React.ReactNode;
  icon?: IconType;
  tone?: ErpTone;
};

export type ErpActionTile = {
  title: React.ReactNode;
  description?: React.ReactNode;
  href?: string;
  onClick?: () => void;
  icon?: IconType;
  tone?: ErpTone;
  badge?: React.ReactNode;
  meta?: React.ReactNode;
  disabled?: boolean;
};

export type ErpQuickFilter = {
  id: string;
  label: string;
  value: string;
  count?: number;
  tone?: ErpTone;
};

export type ErpSegmentOption<T extends string> = {
  value: T;
  label: React.ReactNode;
  icon?: IconType;
  disabled?: boolean;
};

export type ErpFilter =
  | {
      id: string;
      label: string;
      type: 'search';
      value: string;
      placeholder?: string;
      onChange: (value: string) => void;
    }
  | {
      id: string;
      label: string;
      type: 'select';
      value: string;
      options: Array<{ label: string; value: string; count?: number }>;
      onChange: (value: string) => void;
    };

export type ErpColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T) => React.ReactNode;
  mobileLabel?: React.ReactNode;
  priority?: 'primary' | 'secondary' | 'meta' | 'hidden-mobile';
  align?: 'start' | 'center' | 'end';
};

type WithChildren = {
  children: React.ReactNode;
  className?: string;
};

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

export const erpFieldClassName = 'sds-field w-full px-4 py-3 text-sm';
export const erpFieldLabelClassName = 'sds-text-secondary mb-2 block text-sm font-medium';

const toneClasses: Record<ErpTone, { badge: string; metric: string; icon: string; buttonSoft: string }> = {
  primary: {
    badge: 'sds-tone-primary sds-tone-surface',
    metric: 'sds-tone-primary sds-tone-surface',
    icon: 'sds-tone-primary sds-tone-surface',
    buttonSoft: 'sds-tone-primary sds-action-soft',
  },
  neutral: {
    badge: 'sds-tone-neutral sds-tone-surface',
    metric: 'sds-tone-neutral sds-tone-surface',
    icon: 'sds-tone-neutral sds-tone-surface',
    buttonSoft: 'sds-tone-neutral sds-action-soft',
  },
  success: {
    badge: 'sds-tone-success sds-tone-surface',
    metric: 'sds-tone-success sds-tone-surface',
    icon: 'sds-tone-success sds-tone-surface',
    buttonSoft: 'sds-tone-success sds-action-soft',
  },
  warning: {
    badge: 'sds-tone-warning sds-tone-surface',
    metric: 'sds-tone-warning sds-tone-surface',
    icon: 'sds-tone-warning sds-tone-surface',
    buttonSoft: 'sds-tone-warning sds-action-soft',
  },
  danger: {
    badge: 'sds-tone-danger sds-tone-surface',
    metric: 'sds-tone-danger sds-tone-surface',
    icon: 'sds-tone-danger sds-tone-surface',
    buttonSoft: 'sds-tone-danger sds-action-soft',
  },
  info: {
    badge: 'sds-tone-info sds-tone-surface',
    metric: 'sds-tone-info sds-tone-surface',
    icon: 'sds-tone-info sds-tone-surface',
    buttonSoft: 'sds-tone-info sds-action-soft',
  },
  purple: {
    badge: 'sds-tone-purple sds-tone-surface',
    metric: 'sds-tone-purple sds-tone-surface',
    icon: 'sds-tone-purple sds-tone-surface',
    buttonSoft: 'sds-tone-purple sds-action-soft',
  },
};

const buttonClasses = (tone: ErpTone, variant: ErpAction['variant']) => {
  if (variant === 'solid') {
    return `sds-tone-${tone} sds-action-solid`;
  }

  if (variant === 'outline') {
    return `sds-tone-${tone} sds-action-outline`;
  }

  if (variant === 'ghost') {
    return `sds-tone-${tone} sds-action-ghost`;
  }

  return toneClasses[tone].buttonSoft;
};

export function ErpButton({
  label,
  href,
  onClick,
  icon: Icon,
  tone = 'primary',
  variant = 'soft',
  disabled,
  title,
  className: extraClassName,
}: ErpAction) {
  const className = cx(
    'sds-action inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50',
    buttonClasses(tone, variant),
    extraClassName
  );

  const content = (
    <>
      {Icon && <Icon className="h-4 w-4" />}
      <span>{label}</span>
    </>
  );

  if (href && !disabled) {
    return (
      <Link href={href} onClick={onClick} className={className} title={title}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className} title={title}>
      {content}
    </button>
  );
}

export function ErpIconButton({ label, icon: Icon, href, onClick, tone = 'neutral', disabled, title }: ErpAction) {
  const className = cx(
    'sds-action inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-sm disabled:cursor-not-allowed disabled:opacity-50',
    buttonClasses(tone, 'ghost')
  );

  const content = Icon ? <Icon className="h-4 w-4" /> : <span className="text-xs">{label}</span>;

  if (href && !disabled) {
    return (
      <Link href={href} className={className} aria-label={label} title={title || label}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} disabled={disabled} className={className} aria-label={label} title={title || label}>
      {content}
    </button>
  );
}

export const ErpInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(function ErpInput({ className, type, ...props }, ref) {
  const controlClassName =
    type === 'checkbox'
      ? 'h-5 w-5 shrink-0 rounded border-[var(--sds-border-default)] accent-[var(--sds-accent)]'
      : type === 'radio'
        ? 'h-5 w-5 shrink-0 rounded-full border-[var(--sds-border-default)] accent-[var(--sds-accent)]'
        : type === 'range'
          ? 'h-11 w-full accent-[var(--sds-accent)]'
          : type === 'file'
            ? 'sds-file-input'
          : type === 'hidden'
            ? undefined
            : erpFieldClassName;
  return <input ref={ref} type={type} className={cx(controlClassName, className)} {...props} />;
});

export const ErpSelect = React.forwardRef<
  HTMLSelectElement,
  React.SelectHTMLAttributes<HTMLSelectElement>
>(function ErpSelect({ className, children, ...props }, ref) {
  return (
    <select ref={ref} className={cx(erpFieldClassName, className)} {...props}>
      {children}
    </select>
  );
});

export const ErpTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement>
>(function ErpTextarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cx(erpFieldClassName, 'min-h-24 resize-y', className)} {...props} />;
});

export const ErpCheckboxControl = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>
>(function ErpCheckboxControl({ className, ...props }, ref) {
  return (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      className={cx(
        'h-5 w-5 shrink-0 rounded border-[var(--sds-border-default)] accent-[var(--sds-accent)]',
        className
      )}
    />
  );
});

export function ErpCheckbox({
  label,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: React.ReactNode;
}) {
  return (
    <label className={cx('sds-text-secondary inline-flex min-h-11 cursor-pointer items-center gap-2 text-sm', className)}>
      <ErpCheckboxControl {...props} />
      <span>{label}</span>
    </label>
  );
}

type ErpPressableProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ErpTone;
  variant?: ErpAction['variant'];
};

export const ErpPressable = React.forwardRef<HTMLButtonElement, ErpPressableProps>(function ErpPressable({
  children,
  className,
  tone = 'neutral',
  variant = 'ghost',
  ...props
}, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={props.type || 'button'}
      className={cx('sds-action', buttonClasses(tone, variant), className)}
    >
      {children}
    </button>
  );
});

export function ErpBadge({ children, tone = 'neutral', variant = 'soft' }: WithChildren & { tone?: ErpTone; variant?: 'soft' | 'outline' | 'solid' }) {
  const solid = `sds-tone-${tone} sds-action-solid`;
  return (
    <span className={cx('inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold', variant === 'solid' ? solid : toneClasses[tone].badge)}>
      {children}
    </span>
  );
}

export function ErpCard({ children, className, tone = 'neutral', interactive = false }: WithChildren & { tone?: ErpTone; interactive?: boolean }) {
  return (
    <div
      className={cx(
        'sds-card',
        tone === 'neutral' ? null : toneClasses[tone].metric,
        interactive && 'sds-card-interactive',
        className
      )}
    >
      {children}
    </div>
  );
}

export function ErpSection({ title, description, actions, children, className }: WithChildren & { title?: React.ReactNode; description?: React.ReactNode; actions?: ErpAction[] }) {
  return (
    <ErpCard className={cx('p-4 sm:p-5', className)}>
      {(title || description || actions?.length) && (
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            {title && <h2 className="sds-text-primary text-base font-semibold">{title}</h2>}
            {description && <p className="sds-text-muted mt-1 text-sm leading-6">{description}</p>}
          </div>
          {actions?.length ? (
            <div className="flex flex-wrap gap-2">
              {actions.map((action) => <ErpButton key={action.label} {...action} />)}
            </div>
          ) : null}
        </div>
      )}
      {children}
    </ErpCard>
  );
}

export function ErpMetricGrid({ items }: { items: ErpMetric[] }) {
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const tone = item.tone || 'neutral';
        const Icon = item.icon;
        return (
          <ErpCard key={item.label} tone={tone} className="p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="sds-text-muted text-xs">{item.label}</p>
                <p className="sds-text-primary mt-1 truncate text-lg font-semibold">{item.value}</p>
                {item.hint && <p className="sds-text-muted mt-1 text-xs">{item.hint}</p>}
              </div>
              {Icon && (
                <span className={cx('inline-flex h-9 w-9 items-center justify-center rounded-lg', toneClasses[tone].icon)}>
                  <Icon className="h-4 w-4" />
                </span>
              )}
            </div>
          </ErpCard>
        );
      })}
    </div>
  );
}

export function ErpActionGrid({ items, columns = 3, compact = false }: { items: ErpActionTile[]; columns?: 1 | 2 | 3 | 4; compact?: boolean }) {
  if (!items.length) return null;

  const gridClass =
    columns === 1
      ? ''
      : columns === 4
      ? 'sm:grid-cols-2 xl:grid-cols-4'
      : columns === 2
        ? 'sm:grid-cols-2'
        : 'sm:grid-cols-2 xl:grid-cols-3';

  return (
    <div className={cx('grid grid-cols-1 gap-3', gridClass)}>
      {items.map((item, index) => {
        const tone = item.tone || 'neutral';
        const Icon = item.icon;
        const className = cx(
          'group flex h-full items-start gap-3 rounded-lg border bg-[var(--sds-surface-raised)] p-4 text-right shadow-sm transition dark:bg-[var(--sds-surface-raised)]',
          tone === 'neutral' ? 'border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]' : toneClasses[tone].metric,
          !item.disabled && 'hover:border-[var(--sds-accent)]/40 hover:shadow-md dark:hover:border-[var(--sds-border-strong)]',
          item.disabled && 'cursor-not-allowed opacity-60',
          compact && 'p-3'
        );

        const content = (
          <>
            {Icon && (
              <span className={cx('inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg', toneClasses[tone].icon)}>
                <Icon className="h-4 w-4" />
              </span>
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-start justify-between gap-3">
                <span className="text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{item.title}</span>
                {item.badge && <span className="flex-shrink-0">{item.badge}</span>}
              </span>
              {item.description && <span className="mt-1 block text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{item.description}</span>}
              {item.meta && <span className="mt-2 block text-xs font-medium text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{item.meta}</span>}
            </span>
          </>
        );

        if (item.href && !item.disabled) {
          return (
            <Link key={`${item.href}-${index}`} href={item.href} className={className}>
              {content}
            </Link>
          );
        }

        if (item.onClick && !item.disabled) {
          return (
            <button key={`${String(item.title)}-${index}`} type="button" onClick={item.onClick} className={className}>
              {content}
            </button>
          );
        }

        return (
          <div key={`${String(item.title)}-${index}`} className={className}>
            {content}
          </div>
        );
      })}
    </div>
  );
}

export function ErpToolbar({ title, description, search, filters, actions = [], meta }: {
  title?: React.ReactNode;
  description?: React.ReactNode;
  search?: {
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
  };
  filters?: React.ReactNode;
  actions?: ErpAction[];
  meta?: React.ReactNode;
}) {
  return (
    <ErpSection className="p-4">
      <div className="flex flex-col gap-3">
        {(title || description || actions.length > 0 || meta) && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              {title && <h2 className="text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</h2>}
              {description && <p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{description}</p>}
              {meta && <p className="mt-1 text-xs font-medium text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{meta}</p>}
            </div>
            {actions.length > 0 && (
              <div className="flex flex-wrap gap-2 sm:justify-end">
                {actions.map((action) => <ErpButton key={action.label} {...action} />)}
              </div>
            )}
          </div>
        )}
        {(search || filters) && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            {search && (
              <label className="block">
                <span className="sr-only">جستجو</span>
                <div className="relative">
                  <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sds-text-muted)]" />
                  <input
                    type="text"
                    value={search.value}
                    placeholder={search.placeholder}
                    onChange={(event) => search.onChange(event.target.value)}
                    className="sds-field min-h-12 w-full py-3 pl-4 pr-10"
                  />
                </div>
              </label>
            )}
            {filters && <div className="flex flex-wrap items-center gap-2">{filters}</div>}
          </div>
        )}
      </div>
    </ErpSection>
  );
}

export function ErpQuickFilters({ items, value, onChange }: { items: ErpQuickFilter[]; value: string; onChange: (value: string) => void }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => {
        const active = item.value === value;
        const tone = item.tone || 'neutral';
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onChange(item.value)}
            className={cx(
              'inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition',
              active ? buttonClasses(tone, 'solid') : buttonClasses(tone, 'soft')
            )}
          >
            <span>{item.label}</span>
            {item.count != null && <span className="text-xs opacity-80">{item.count.toLocaleString('fa-IR')}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function ErpSegmentedControl<T extends string>({ options, value, onChange }: {
  options: ErpSegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  if (!options.length) return null;
  return (
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-1 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] sm:flex-wrap">
      {options.map((option) => {
        const Icon = option.icon;
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              'inline-flex min-h-10 flex-shrink-0 items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'bg-[var(--sds-surface-raised)] text-[var(--sds-accent)] shadow-sm dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-accent)]'
                : 'text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-raised)] hover:text-[var(--sds-text-primary)] dark:text-[var(--sds-text-muted)] dark:hover:bg-[var(--sds-surface-raised)] dark:hover:text-[var(--sds-text-primary)]'
            )}
          >
            {Icon && <Icon className="h-4 w-4" />}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function ErpPagination({ currentPage, totalPages, totalItems, itemsPerPage, onPageChange, itemLabel = 'مورد' }: {
  currentPage: number;
  totalPages: number;
  totalItems?: number;
  itemsPerPage?: number;
  onPageChange: (page: number) => void;
  itemLabel?: string;
}) {
  if (totalPages <= 1 && !totalItems) return null;

  const pages = Array.from({ length: totalPages }, (_, index) => index + 1).filter((page) => {
    if (totalPages <= 7) return true;
    return page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2;
  });
  const from = totalItems && itemsPerPage ? ((currentPage - 1) * itemsPerPage) + 1 : null;
  const to = totalItems && itemsPerPage ? Math.min(currentPage * itemsPerPage, totalItems) : null;

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      {totalItems != null && from != null && to != null && (
        <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
          نمایش {from.toLocaleString('fa-IR')} تا {to.toLocaleString('fa-IR')} از {totalItems.toLocaleString('fa-IR')} {itemLabel}
        </p>
      )}
      <div className="flex flex-wrap gap-1 sm:justify-end">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage === 1}
          className="min-h-10 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--sds-text-primary)] transition hover:border-[var(--sds-accent)]/40 hover:text-[var(--sds-accent)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
        >
          قبلی
        </button>
        {pages.map((page, index) => {
          const previous = pages[index - 1];
          const needsGap = previous && page - previous > 1;
          return (
            <React.Fragment key={page}>
              {needsGap && <span className="px-2 py-2 text-sm text-[var(--sds-text-muted)]">...</span>}
              <button
                type="button"
                onClick={() => onPageChange(page)}
                className={cx(
                  'min-h-10 min-w-10 rounded-lg border px-3 py-2 text-sm font-semibold transition',
                  page === currentPage
                    ? 'border-[var(--sds-accent)] bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]'
                    : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-[var(--sds-text-primary)] hover:border-[var(--sds-accent)]/40 hover:text-[var(--sds-accent)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]'
                )}
              >
                {page.toLocaleString('fa-IR')}
              </button>
            </React.Fragment>
          );
        })}
        <button
          type="button"
          onClick={() => onPageChange(Math.min(currentPage + 1, totalPages))}
          disabled={currentPage === totalPages}
          className="min-h-10 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm font-semibold text-[var(--sds-text-primary)] transition hover:border-[var(--sds-accent)]/40 hover:text-[var(--sds-accent)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
        >
          بعدی
        </button>
      </div>
    </div>
  );
}

export function ErpSummaryGrid({ items, columns = 2 }: {
  items: Array<{ label: React.ReactNode; value: React.ReactNode; hint?: React.ReactNode; tone?: ErpTone }>;
  columns?: 2 | 3;
}) {
  if (!items.length) return null;
  return (
    <div className={cx('grid grid-cols-1 gap-3', columns === 3 ? 'md:grid-cols-3' : 'md:grid-cols-2')}>
      {items.map((item, index) => (
        <ErpFieldView key={index} label={item.label} value={item.value} hint={item.hint} tone={item.tone} />
      ))}
    </div>
  );
}

export function ErpPage({ eyebrow, title, description, actions = [], metrics = [], children, backHref }: WithChildren & {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: ErpAction[];
  metrics?: ErpMetric[];
  backHref?: string;
}) {
  const router = useRouter();
  React.useEffect(() => {
    const currentPath = `${window.location.pathname}${window.location.search}`;
    const previousCurrentPath = window.sessionStorage.getItem('sabalanerp:currentPath');
    if (previousCurrentPath && previousCurrentPath !== currentPath) {
      window.sessionStorage.setItem('sabalanerp:previousPath', previousCurrentPath);
    }
    window.sessionStorage.setItem('sabalanerp:currentPath', currentPath);
  }, []);

  const handleBack = React.useCallback(() => {
    if (!backHref) return;

    const hasBrowserHistory = typeof window !== 'undefined' && window.history.length > 1;
    const currentPath = `${window.location.pathname}${window.location.search}`;
    const previousPath = window.sessionStorage.getItem('sabalanerp:previousPath');
    const hasTrackedInAppHistory = Boolean(previousPath && previousPath !== currentPath);
    const hasSameOriginReferrer = typeof document !== 'undefined'
      && Boolean(document.referrer)
      && document.referrer.startsWith(window.location.origin);

    if (hasBrowserHistory && (hasTrackedInAppHistory || hasSameOriginReferrer)) {
      router.back();
      return;
    }

    router.push(backHref);
  }, [backHref, router]);

  return (
    <main className="sds-workspace mx-auto w-full max-w-7xl space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {backHref && (
            <ErpIconButton label="بازگشت" onClick={handleBack} icon={FaArrowRight} tone="neutral" />
          )}
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{eyebrow}</p>}
            <h1 className="mt-1 text-2xl font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)] sm:text-3xl">{title}</h1>
            {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{description}</p>}
          </div>
        </div>
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2 sm:justify-end">
            {actions.map((action) => <ErpButton key={action.label} {...action} />)}
          </div>
        )}
      </div>
      <ErpMetricGrid items={metrics} />
      {children}
    </main>
  );
}

export function ErpFilters({ filters }: { filters: ErpFilter[] }) {
  if (!filters.length) return null;
  return (
    <ErpSection>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        {filters.map((filter) => (
          <label key={filter.id} className="block">
            <span className="sr-only">{filter.label}</span>
            {filter.type === 'search' ? (
              <div className="relative">
                <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--sds-text-muted)]" />
                <input
                  type="text"
                  value={filter.value}
                  placeholder={filter.placeholder}
                  onChange={(event) => filter.onChange(event.target.value)}
                  className="sds-field min-h-12 w-full py-3 pl-4 pr-10"
                />
              </div>
            ) : (
              <EnhancedDropdown
                value={filter.value}
                onChange={filter.onChange}
                placeholder={filter.label}
                options={filter.options.map((option) => ({
                  value: option.value,
                  label: `${option.label}${option.count != null ? ` (${option.count})` : ''}`,
                }))}
                searchable
                clearable
              />
            )}
          </label>
        ))}
      </div>
    </ErpSection>
  );
}

export function ErpEmptyState({ title, description, action, icon: Icon }: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: ErpAction;
  icon?: IconType;
}) {
  return (
    <div className="rounded-lg border border-dashed border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-8 text-center dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
      {Icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-[var(--sds-surface-subtle)] text-[var(--sds-text-secondary)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-muted)]">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-base font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{description}</p>}
      {action && <div className="mt-5"><ErpButton {...action} /></div>}
    </div>
  );
}

export function ErpLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[var(--sds-accent)] dark:border-[var(--sds-border-strong)]" />
    </div>
  );
}

export function ErpListPage<T>({ rows, rowKey, columns, filters = [], rowActions, emptyState, isLoading, footer, children, ...pageProps }: {
  rows: T[];
  rowKey: (row: T) => string;
  columns: ErpColumn<T>[];
  filters?: ErpFilter[];
  rowActions?: (row: T) => ErpAction[];
  emptyState?: React.ReactNode;
  isLoading?: boolean;
  footer?: React.ReactNode;
} & Omit<Parameters<typeof ErpPage>[0], 'children'> & { children?: React.ReactNode }) {
  return (
    <ErpPage {...pageProps}>
      <ErpFilters filters={filters} />
      {children}
      <ErpSection>
        {isLoading ? (
          <ErpLoading />
        ) : rows.length === 0 ? (
          emptyState
        ) : (
          <>
            <div className="space-y-3 lg:hidden">
              {rows.map((row) => (
                <ErpCard key={rowKey(row)} interactive className="p-4">
                  <div className="space-y-3">
                    {columns.filter((column) => column.priority !== 'hidden-mobile').map((column) => (
                      <div key={column.id} className={column.priority === 'primary' ? '' : 'flex items-start justify-between gap-3 text-sm'}>
                        {column.priority !== 'primary' && <span className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{column.mobileLabel || column.header}</span>}
                        <div className={cx(column.priority === 'primary' ? '' : 'text-left text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]')}>{column.cell(row)}</div>
                      </div>
                    ))}
                    {rowActions && (
                      <div className="flex flex-wrap gap-2 border-t border-[var(--sds-border-default)] pt-3 dark:border-[var(--sds-border-strong)]">
                        {rowActions(row).map((action) => <ErpIconButton key={action.label} {...action} />)}
                      </div>
                    )}
                  </div>
                </ErpCard>
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)]">
                    {columns.map((column) => (
                      <th key={column.id} className={cx('px-3 py-3 text-right text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]', column.align === 'end' && 'text-left', column.align === 'center' && 'text-center')}>
                        {column.header}
                      </th>
                    ))}
                    {rowActions && <th className="px-3 py-3 text-left text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">عملیات</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={rowKey(row)} className="border-b border-[var(--sds-border-default)] transition hover:bg-[var(--sds-surface-subtle)] dark:border-[var(--sds-border-strong)] dark:hover:bg-[var(--sds-surface-raised)]">
                      {columns.map((column) => (
                        <td key={column.id} className={cx('px-3 py-4 text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]', column.align === 'end' && 'text-left', column.align === 'center' && 'text-center')}>
                          {column.cell(row)}
                        </td>
                      ))}
                      {rowActions && (
                        <td className="px-3 py-4">
                          <div className="flex justify-end gap-1">
                            {rowActions(row).map((action) => <ErpIconButton key={action.label} {...action} />)}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {footer && <div className="mt-4 border-t border-[var(--sds-border-default)] pt-4 dark:border-[var(--sds-border-strong)]">{footer}</div>}
          </>
        )}
      </ErpSection>
    </ErpPage>
  );
}

export function ErpFieldView({ label, value, hint, tone = 'neutral' }: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: ErpTone;
}) {
  return (
    <div className={cx('rounded-lg border p-3', toneClasses[tone].metric)}>
      <p className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{label}</p>
      <div className="mt-1 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{value}</div>
      {hint && <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{hint}</p>}
    </div>
  );
}

export function ErpTwoColumn({ main, aside }: { main: React.ReactNode; aside: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,360px)]">
      <div className="space-y-5">{main}</div>
      <aside className="space-y-5 lg:sticky lg:top-4 lg:self-start">{aside}</aside>
    </div>
  );
}

export type ErpSemanticStatus = {
  label: string;
  tone?: ErpTone;
  icon?: IconType;
  emphasis?: 'compact' | 'strong';
};

export function ErpStatus({ label, tone = 'neutral', icon: Icon, emphasis = 'compact' }: ErpSemanticStatus) {
  return (
    <span
      className={cx(
        'inline-flex min-h-7 items-center gap-1.5 rounded-full border font-semibold',
        emphasis === 'strong' ? 'px-3 py-1.5 text-sm' : 'px-2.5 py-1 text-xs',
        toneClasses[tone].badge,
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" aria-hidden="true" />}
      <span>{label}</span>
    </span>
  );
}

export function ErpWorkspacePage({
  title,
  context,
  primaryAction,
  secondaryActions = [],
  backHref,
  children,
  className,
}: WithChildren & {
  title: React.ReactNode;
  context?: React.ReactNode;
  primaryAction?: ErpAction;
  secondaryActions?: ErpAction[];
  backHref?: string;
}) {
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const handleBack = React.useCallback(() => {
    if (!backHref) return;
    if (typeof window !== 'undefined' && window.history.length > 1) router.back();
    else router.push(backHref);
  }, [backHref, router]);

  return (
    <motion.main
      className={cx('sds-workspace mx-auto w-full max-w-7xl space-y-5', className)}
      initial={reduceMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
    >
      <header className="flex min-h-14 items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          {backHref && <ErpIconButton label="بازگشت" onClick={handleBack} icon={FaArrowRight} tone="neutral" />}
          <div className="min-w-0 py-0.5">
            <h1 className="sds-text-primary truncate text-2xl font-black tracking-tight">{title}</h1>
            {context && <div className="sds-text-muted mt-1 text-xs font-medium">{context}</div>}
          </div>
        </div>
        {(primaryAction || secondaryActions.length > 0) && (
          <div className="flex flex-shrink-0 items-center gap-2">
            {primaryAction && <ErpButton {...primaryAction} className={cx('min-h-11', primaryAction.className)} />}
            {secondaryActions.length > 0 && <ErpActionMenu label="اقدامات بیشتر" actions={secondaryActions} />}
          </div>
        )}
      </header>
      {children}
    </motion.main>
  );
}

export function ErpMotionSection({ children, className, delay = 0 }: WithChildren & { delay?: number }) {
  const reduceMotion = useReducedMotion();
  return (
    <motion.section
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.24, delay: reduceMotion ? 0 : Math.min(delay, 0.16), ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.section>
  );
}

export function ErpSkeleton({ lines = 3, className, label = 'در حال بارگذاری' }: { lines?: number; className?: string; label?: string }) {
  return (
    <div className={cx('sds-card animate-pulse space-y-3 p-4 motion-reduce:animate-none', className)} role="status" aria-label={label}>
      <span className="sr-only">{label}</span>
      <div className="sds-skeleton h-4 w-28 rounded-full" />
      {Array.from({ length: lines }).map((_, index) => (
        <div key={index} className={cx('sds-skeleton h-11 rounded-xl', index === lines - 1 && 'w-4/5')} />
      ))}
    </div>
  );
}

export function ErpInlineState({
  kind,
  title,
  action,
  className,
}: {
  kind: 'empty' | 'success' | 'error' | 'stale' | 'permission';
  title: React.ReactNode;
  action?: ErpAction;
  className?: string;
}) {
  const config = {
    empty: { Icon: FaInfoCircle, classes: 'sds-tone-neutral' },
    success: { Icon: FaCheck, classes: 'sds-tone-success' },
    error: { Icon: FaExclamationTriangle, classes: 'sds-tone-danger' },
    stale: { Icon: FaRedo, classes: 'sds-tone-warning' },
    permission: { Icon: FaInfoCircle, classes: 'sds-tone-neutral' },
  }[kind];
  const Icon = config.Icon;
  return (
    <div className={cx('sds-tone-surface flex min-h-12 items-center justify-between gap-3 border-y px-3 py-3 text-sm', config.classes, className)} role={kind === 'error' ? 'alert' : 'status'}>
      <span className="inline-flex items-center gap-2 font-semibold"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{title}</span>
      {action && <ErpButton {...action} variant={action.variant || 'ghost'} className={cx('min-h-11', action.className)} />}
    </div>
  );
}

export function ErpActionMenu({ label, actions }: { label: string; actions: ErpAction[] }) {
  const [open, setOpen] = React.useState(false);
  const rootRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div ref={rootRef} className="relative">
      <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label={label} className="sds-action sds-action-outline inline-flex h-11 w-11 items-center justify-center">
        <FaEllipsisV className="h-4 w-4" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, scale: 0.97, y: -4 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97, y: -4 }} transition={{ duration: 0.16 }} className="absolute left-0 z-40 mt-2 min-w-48 overflow-hidden rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-1.5 shadow-xl dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
            {actions.map((action) => (
              <ErpButton
                {...action}
                key={action.label}
                onClick={() => {
                  setOpen(false);
                  action.onClick?.();
                }}
                variant="ghost"
                className="w-full justify-start border-0"
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function ErpSheet({ open, onClose, title, children, footer, presentation = 'sheet', dismissible = true }: WithChildren & { open: boolean; onClose: () => void; title: React.ReactNode; footer?: React.ReactNode; presentation?: 'sheet' | 'modal'; dismissible?: boolean }) {
  const [mounted, setMounted] = React.useState(false);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);
  const dialogRef = React.useRef<HTMLDivElement>(null);
  const restoreFocusRef = React.useRef<HTMLElement | null>(null);
  const onCloseRef = React.useRef(onClose);
  const titleId = React.useId();
  const reduceMotion = useReducedMotion();
  const isModal = presentation === 'modal';
  React.useEffect(() => setMounted(true), []);
  React.useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  React.useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = document.activeElement as HTMLElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.setTimeout(() => closeButtonRef.current?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onCloseRef.current();
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'));
      if (!focusable.length) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [dismissible, open]);
  const sheet = (
    <AnimatePresence>
      {open && (
        <div className={isModal ? "fixed inset-0 z-[80] !m-0 flex items-center justify-center p-3 sm:p-4" : "fixed inset-0 z-[80] !m-0 flex items-end justify-center sm:items-stretch sm:justify-start"} role="presentation">
          <motion.button type="button" aria-label="بستن" disabled={!dismissible} onClick={onClose} className="absolute inset-0 bg-[var(--sds-surface-overlay)] backdrop-blur-sm disabled:cursor-wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            initial={reduceMotion ? false : isModal ? { opacity: 0, scale: 0.96, y: 12 } : { opacity: 0, y: 32 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={isModal ? { opacity: 0, scale: 0.97, y: 8 } : { opacity: 0, y: 24 }}
            transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
            className={isModal
              ? "relative z-10 flex max-h-[calc(100dvh-1.5rem)] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] shadow-2xl dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] sm:max-h-[calc(100dvh-2rem)]"
              : "relative flex max-h-[92dvh] w-full flex-col rounded-t-3xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] shadow-2xl dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] sm:mr-auto sm:h-full sm:max-h-none sm:max-w-lg sm:rounded-none sm:rounded-r-3xl"}
          >
            <header className="flex min-h-16 shrink-0 items-center justify-between gap-3 border-b border-[var(--sds-border-default)] px-4 dark:border-[var(--sds-border-strong)]">
              <h2 id={titleId} className="text-base font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</h2>
              <button ref={closeButtonRef} type="button" disabled={!dismissible} onClick={onClose} className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-[var(--sds-text-secondary)] outline-none transition hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--sds-accent)] disabled:cursor-wait disabled:opacity-50 dark:hover:bg-[var(--sds-surface-raised)]" aria-label="بستن"><FaTimes /></button>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
            {footer && <footer className="shrink-0 border-t border-[var(--sds-border-default)] p-4 dark:border-[var(--sds-border-strong)]">{footer}</footer>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
  return mounted ? createPortal(sheet, document.body) : null;
}

export * from './DashboardPrimitives';
export * from './NeumorphicPrimitives';
