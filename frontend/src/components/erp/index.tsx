'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FaArrowRight, FaSearch } from 'react-icons/fa';
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

const toneClasses: Record<ErpTone, { badge: string; metric: string; icon: string; buttonSoft: string }> = {
  primary: {
    badge: 'border-[#074747]/20 bg-[#074747]/10 text-[#074747] dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-100',
    metric: 'border-[#074747]/20 bg-[#074747]/5 dark:border-teal-800 dark:bg-teal-950/30',
    icon: 'bg-[#074747]/10 text-[#074747] dark:bg-teal-900/40 dark:text-teal-100',
    buttonSoft: 'border-[#074747]/20 bg-[#074747]/10 text-[#074747] hover:bg-[#074747]/15 dark:border-teal-700 dark:bg-teal-900/30 dark:text-teal-100',
  },
  neutral: {
    badge: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
    metric: 'border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/70',
    icon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-200',
    buttonSoft: 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
  },
  success: {
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-200',
    metric: 'border-emerald-200 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-900/20',
    icon: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
    buttonSoft: 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/25 dark:text-emerald-200',
  },
  warning: {
    badge: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-200',
    metric: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    icon: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-200',
    buttonSoft: 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-900/25 dark:text-amber-200',
  },
  danger: {
    badge: 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/25 dark:text-red-200',
    metric: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
    icon: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200',
    buttonSoft: 'border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/25 dark:text-red-200',
  },
  info: {
    badge: 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/25 dark:text-blue-200',
    metric: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    icon: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-200',
    buttonSoft: 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/25 dark:text-blue-200',
  },
  purple: {
    badge: 'border-purple-200 bg-purple-50 text-purple-700 dark:border-purple-800 dark:bg-purple-900/25 dark:text-purple-200',
    metric: 'border-purple-200 bg-purple-50 dark:border-purple-800 dark:bg-purple-900/20',
    icon: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-200',
    buttonSoft: 'border-purple-200 bg-purple-50 text-purple-700 hover:bg-purple-100 dark:border-purple-800 dark:bg-purple-900/25 dark:text-purple-200',
  },
};

const buttonClasses = (tone: ErpTone, variant: ErpAction['variant']) => {
  if (variant === 'solid') {
    if (tone === 'primary') return 'border-[#074747] bg-[#074747] text-white hover:bg-[#0b5c5c]';
    if (tone === 'danger') return 'border-red-600 bg-red-600 text-white hover:bg-red-700';
    if (tone === 'success') return 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700';
    return 'border-slate-800 bg-slate-800 text-white hover:bg-slate-900 dark:border-slate-200 dark:bg-slate-100 dark:text-slate-950';
  }

  if (variant === 'outline') {
    return 'border-slate-200 bg-white text-slate-700 hover:border-[#074747]/40 hover:text-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:border-teal-600';
  }

  if (variant === 'ghost') {
    return 'border-transparent bg-transparent text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800';
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
    'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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
      <Link href={href} className={className} title={title}>
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
    'inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50',
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

export function ErpBadge({ children, tone = 'neutral', variant = 'soft' }: WithChildren & { tone?: ErpTone; variant?: 'soft' | 'outline' | 'solid' }) {
  const solid = tone === 'primary' ? 'border-[#074747] bg-[#074747] text-white' : 'border-slate-700 bg-slate-800 text-white';
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
        'rounded-lg border bg-white shadow-sm dark:bg-slate-900/70',
        tone === 'neutral' ? 'border-slate-200 dark:border-slate-700' : toneClasses[tone].metric,
        interactive && 'transition hover:border-[#074747]/40 hover:shadow-md dark:hover:border-teal-700',
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
            {title && <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>}
            {description && <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
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
                <p className="text-xs text-slate-500 dark:text-slate-400">{item.label}</p>
                <p className="mt-1 truncate text-lg font-semibold text-slate-900 dark:text-white">{item.value}</p>
                {item.hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{item.hint}</p>}
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
          'group flex h-full items-start gap-3 rounded-lg border bg-white p-4 text-right shadow-sm transition dark:bg-slate-900/70',
          tone === 'neutral' ? 'border-slate-200 dark:border-slate-700' : toneClasses[tone].metric,
          !item.disabled && 'hover:border-[#074747]/40 hover:shadow-md dark:hover:border-teal-700',
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
                <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</span>
                {item.badge && <span className="flex-shrink-0">{item.badge}</span>}
              </span>
              {item.description && <span className="mt-1 block text-xs leading-5 text-slate-500 dark:text-slate-400">{item.description}</span>}
              {item.meta && <span className="mt-2 block text-xs font-medium text-[#074747] dark:text-teal-200">{item.meta}</span>}
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
              {title && <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>}
              {description && <p className="mt-1 text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
              {meta && <p className="mt-1 text-xs font-medium text-[#074747] dark:text-teal-200">{meta}</p>}
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
                  <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={search.value}
                    placeholder={search.placeholder}
                    onChange={(event) => search.onChange(event.target.value)}
                    className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-4 pr-10 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400 dark:focus:border-teal-500 dark:focus:bg-slate-900"
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
    <div className="flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-100 p-1 dark:border-slate-700 dark:bg-slate-800 sm:flex-wrap">
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
                ? 'bg-white text-[#074747] shadow-sm dark:bg-slate-900 dark:text-teal-200'
                : 'text-slate-600 hover:bg-white/70 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-900/70 dark:hover:text-white'
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
        <p className="text-sm text-slate-500 dark:text-slate-400">
          نمایش {from.toLocaleString('fa-IR')} تا {to.toLocaleString('fa-IR')} از {totalItems.toLocaleString('fa-IR')} {itemLabel}
        </p>
      )}
      <div className="flex flex-wrap gap-1 sm:justify-end">
        <button
          type="button"
          onClick={() => onPageChange(Math.max(currentPage - 1, 1))}
          disabled={currentPage === 1}
          className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#074747]/40 hover:text-[#074747] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          قبلی
        </button>
        {pages.map((page, index) => {
          const previous = pages[index - 1];
          const needsGap = previous && page - previous > 1;
          return (
            <React.Fragment key={page}>
              {needsGap && <span className="px-2 py-2 text-sm text-slate-400">...</span>}
              <button
                type="button"
                onClick={() => onPageChange(page)}
                className={cx(
                  'min-h-10 min-w-10 rounded-lg border px-3 py-2 text-sm font-semibold transition',
                  page === currentPage
                    ? 'border-[#074747] bg-[#074747] text-white'
                    : 'border-slate-200 bg-white text-slate-700 hover:border-[#074747]/40 hover:text-[#074747] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200'
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
          className="min-h-10 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 transition hover:border-[#074747]/40 hover:text-[#074747] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
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
    <div className="mx-auto w-full max-w-7xl space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {backHref && (
            <ErpIconButton label="بازگشت" onClick={handleBack} icon={FaArrowRight} tone="neutral" />
          )}
          <div className="min-w-0">
            {eyebrow && <p className="text-xs font-semibold uppercase tracking-wide text-[#074747] dark:text-teal-200">{eyebrow}</p>}
            <h1 className="mt-1 text-2xl font-bold text-slate-950 dark:text-white sm:text-3xl">{title}</h1>
            {description && <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-300">{description}</p>}
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
    </div>
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
                <FaSearch className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={filter.value}
                  placeholder={filter.placeholder}
                  onChange={(event) => filter.onChange(event.target.value)}
                  className="min-h-12 w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-4 pr-10 text-sm text-slate-900 outline-none transition focus:border-[#074747] focus:bg-white focus:ring-2 focus:ring-[#074747]/15 dark:border-slate-700 dark:bg-slate-800 dark:text-white dark:placeholder-slate-400 dark:focus:border-teal-500 dark:focus:bg-slate-900"
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
    <div className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center dark:border-slate-700 dark:bg-slate-900/50">
      {Icon && (
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-300">
          <Icon className="h-5 w-5" />
        </div>
      )}
      <p className="text-base font-semibold text-slate-800 dark:text-slate-100">{title}</p>
      {description && <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>}
      {action && <div className="mt-5"><ErpButton {...action} /></div>}
    </div>
  );
}

export function ErpLoading() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-[#074747] dark:border-teal-300" />
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
                        {column.priority !== 'primary' && <span className="text-xs text-slate-500 dark:text-slate-400">{column.mobileLabel || column.header}</span>}
                        <div className={cx(column.priority === 'primary' ? '' : 'text-left text-slate-800 dark:text-slate-100')}>{column.cell(row)}</div>
                      </div>
                    ))}
                    {rowActions && (
                      <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
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
                  <tr className="border-b border-slate-200 dark:border-slate-700">
                    {columns.map((column) => (
                      <th key={column.id} className={cx('px-3 py-3 text-right text-xs font-semibold text-slate-500 dark:text-slate-400', column.align === 'end' && 'text-left', column.align === 'center' && 'text-center')}>
                        {column.header}
                      </th>
                    ))}
                    {rowActions && <th className="px-3 py-3 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">عملیات</th>}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={rowKey(row)} className="border-b border-slate-100 transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60">
                      {columns.map((column) => (
                        <td key={column.id} className={cx('px-3 py-4 text-slate-800 dark:text-slate-100', column.align === 'end' && 'text-left', column.align === 'center' && 'text-center')}>
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
            {footer && <div className="mt-4 border-t border-slate-100 pt-4 dark:border-slate-800">{footer}</div>}
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
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{value}</div>
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
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

export * from './DashboardPrimitives';
