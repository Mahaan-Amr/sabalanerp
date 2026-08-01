'use client';

import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FaArrowLeft, FaBan, FaCheck, FaClock, FaExclamationTriangle, FaPaperclip, FaShieldAlt, FaSyncAlt } from 'react-icons/fa';
import { useId, type ComponentType } from 'react';
import type { ErpTone } from './index';

type IconType = ComponentType<{ className?: string }>;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

const statusToneClasses: Record<ErpTone, string> = {
  primary: 'sds-tone-primary',
  neutral: 'sds-tone-neutral',
  success: 'sds-tone-success',
  warning: 'sds-tone-warning',
  danger: 'sds-tone-danger',
  info: 'sds-tone-info',
  purple: 'sds-tone-purple',
};

export interface ErpStatusSummaryItem {
  id: string;
  label: string;
  value: number;
  href: string;
  icon: IconType;
  tone: ErpTone;
}

export function ErpStatusSummary({ title, dateLabel, items }: { title: string; dateLabel?: string; items: ErpStatusSummaryItem[] }) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  return (
    <motion.section
      aria-labelledby={titleId}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
      className="sds-neumorphic-card overflow-hidden"
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--sds-border-subtle)] px-4 py-3">
        <h2 id={titleId} className="text-sm font-bold text-[var(--sds-text-primary)]">{title}</h2>
        {dateLabel && <span className="text-xs text-[var(--sds-text-muted)]">{dateLabel}</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cx(
                'group relative flex min-h-24 items-center justify-between gap-3 p-4 outline-none transition-colors hover:bg-[var(--sds-surface-subtle)] focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sds-focus-ring)]',
                index % 2 === 0 && 'border-l border-[var(--sds-border-subtle)] sm:border-l-0',
                index < 2 && 'border-b border-[var(--sds-border-subtle)] sm:border-b-0',
                index > 0 && 'sm:border-r sm:border-[var(--sds-border-subtle)]',
              )}
              aria-label={`${item.label}: ${item.value.toLocaleString('fa-IR')} نفر، مشاهده فهرست`}
            >
              <span>
                <span className="block text-xs font-semibold text-[var(--sds-text-muted)]">{item.label}</span>
                <motion.span
                  key={item.value}
                  initial={reduceMotion ? false : { opacity: 0, y: 8, filter: 'blur(3px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  className="mt-1 block text-2xl font-black tabular-nums text-[var(--sds-text-primary)]"
                >
                  {item.value.toLocaleString('fa-IR')}
                </motion.span>
              </span>
              <span className={cx('sds-neumorphic-icon sds-tone-surface inline-flex h-11 w-11 items-center justify-center', statusToneClasses[item.tone])}>
                <Icon className="h-4 w-4" />
              </span>
            </Link>
          );
        })}
      </div>
    </motion.section>
  );
}

export interface ErpAttentionItem {
  id: string;
  title: string;
  meta?: string;
}

export interface ErpAttentionGroup {
  id: string;
  label: string;
  count: number;
  href: string;
  tone: 'danger' | 'warning';
  items: ErpAttentionItem[];
}

export function ErpAttentionList({ title, groups }: { title: string; groups: ErpAttentionGroup[] }) {
  const populatedGroups = groups.filter((group) => group.count > 0);
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-bold text-[var(--sds-text-primary)]">{title}</h2>
      </div>
      {!populatedGroups.length ? (
        <div className="sds-tone-success sds-tone-surface flex min-h-16 items-center gap-3 rounded-xl border px-4 py-3 text-sm font-semibold">
          <span className="sds-neumorphic-icon inline-flex h-9 w-9 items-center justify-center"><FaCheck className="h-3.5 w-3.5" /></span>
          <span>موردی نیازمند پیگیری نیست</span>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {populatedGroups.map((group) => (
            <div key={group.id} className="sds-neumorphic-card overflow-hidden">
              <div className="flex items-center justify-between border-b border-[var(--sds-border-subtle)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={cx('h-2 w-2 rounded-full', group.tone === 'danger' ? 'bg-[var(--sds-danger)]' : 'bg-[var(--sds-warning)]')} />
                  <h3 className="text-sm font-bold text-[var(--sds-text-primary)]">{group.label}</h3>
                  <span className="text-xs text-[var(--sds-text-muted)]">{group.count.toLocaleString('fa-IR')} نفر</span>
                </div>
                <Link href={group.href} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold text-[var(--sds-accent)] outline-none transition hover:bg-[var(--sds-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
                  مشاهده همه <FaArrowLeft className="h-3 w-3" />
                </Link>
              </div>
              <ul className="divide-y divide-[var(--sds-border-subtle)]">
                {group.items.map((item) => (
                  <li key={item.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm font-semibold text-[var(--sds-text-primary)]">{item.title}</span>
                    {item.meta && <span className="text-xs text-[var(--sds-text-muted)]">{item.meta}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export interface ErpCurrentShiftPanelProps {
  state: 'ACTIVE' | 'SCHEDULED_NOT_STARTED' | 'NONE';
  personnelName?: string | null;
  personnelPosition?: string | null;
  plannedPersonnelName?: string | null;
  coverageLabel?: string | null;
  scheduleLabel?: string | null;
  startedLabel?: string | null;
  overdue?: boolean;
  updatedLabel?: string | null;
  refreshing?: boolean;
  refreshFailed?: boolean;
  onRefresh?: () => void;
}

export function ErpCurrentShiftPanel({
  state,
  personnelName,
  personnelPosition,
  plannedPersonnelName,
  coverageLabel,
  scheduleLabel,
  startedLabel,
  overdue,
  updatedLabel,
  refreshing,
  refreshFailed,
  onRefresh,
}: ErpCurrentShiftPanelProps) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const badge = state === 'ACTIVE' ? 'فعال' : state === 'SCHEDULED_NOT_STARTED' ? 'شروع نشده' : 'بدون شیفت';
  const badgeClass = state === 'ACTIVE'
    ? 'sds-tone-success'
    : overdue
      ? 'sds-tone-warning'
      : 'sds-tone-neutral';
  return (
    <motion.section
      aria-labelledby={titleId}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="sds-neumorphic-card relative overflow-hidden p-4 sm:p-5"
    >
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="sds-neumorphic-icon sds-tone-primary sds-tone-surface inline-flex h-11 w-11 flex-shrink-0 items-center justify-center"><FaShieldAlt className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-sm font-bold text-[var(--sds-text-primary)]">شیفت جاری گارد</h2>
              <span className={cx('sds-tone-surface rounded-full border px-2.5 py-1 text-[11px] font-bold', badgeClass)}>{badge}</span>
              {overdue && <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--sds-warning)]"><FaExclamationTriangle className="h-3 w-3" /> شروع شیفت به تأخیر افتاده است</span>}
            </div>
            {state === 'NONE' ? (
              <p className="mt-3 text-sm text-[var(--sds-text-secondary)]">شیفت فعال یا برنامه‌ریزی‌شده‌ای وجود ندارد</p>
            ) : (
              <>
                <p className="mt-3 truncate text-lg font-black text-[var(--sds-text-primary)]">{personnelName}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--sds-text-muted)]">
                  {personnelPosition && <span>{personnelPosition}</span>}
                  {coverageLabel && <span>{coverageLabel}</span>}
                  {plannedPersonnelName && <span>نیروی برنامه‌ریزی‌شده: {plannedPersonnelName}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-[var(--sds-text-secondary)]">
                  {scheduleLabel && <span className="inline-flex items-center gap-1.5"><FaClock className="h-3 w-3" /> {scheduleLabel}</span>}
                  {startedLabel && <span>شروع واقعی: {startedLabel}</span>}
                </div>
              </>
            )}
          </div>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshing} className="sds-neumorphic-icon inline-flex h-11 w-11 flex-shrink-0 items-center justify-center text-[var(--sds-accent)] outline-none transition focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)] disabled:opacity-50" aria-label="به‌روزرسانی وضعیت شیفت">
            <FaSyncAlt className={cx('h-3.5 w-3.5', refreshing && !reduceMotion && 'animate-spin')} />
          </button>
        )}
      </div>
      {(updatedLabel || refreshFailed) && (
        <div className="relative mt-4 border-t border-[var(--sds-border-subtle)] pt-3 text-[11px] text-[var(--sds-text-muted)]">
          {refreshFailed ? 'به‌روزرسانی ناموفق بود؛ آخرین اطلاعات موفق نمایش داده می‌شود.' : `آخرین به‌روزرسانی: ${updatedLabel}`}
        </div>
      )}
    </motion.section>
  );
}

export interface ErpShiftTimelineEntry {
  id: string;
  rowNumber?: number | null;
  status: string;
  title: string;
  typeDescription?: string | null;
  description?: string | null;
  participants?: string[];
  createdAt: string;
  author?: string | null;
  voidReason?: string | null;
  voidedAt?: string | null;
  voidedBy?: string | null;
  attachmentCount?: number;
  attachments?: Array<{ id: string; name?: string | null }>;
  voidable?: boolean;
}

export function ErpShiftTimeline({
  title,
  entries,
  formatTimestamp,
  action,
  compact = false,
  showAttachmentImages = false,
  attachmentHref,
  onVoid,
}: {
  title: string;
  entries: ErpShiftTimelineEntry[];
  formatTimestamp: (value: string) => string;
  action?: { label: string; href: string } | null;
  compact?: boolean;
  showAttachmentImages?: boolean;
  attachmentHref?: (attachmentId: string) => string;
  onVoid?: (entry: ErpShiftTimelineEntry) => void;
}) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 id={titleId} className="text-base font-bold text-[var(--sds-text-primary)]">{title}</h2>
        {action && (
          <Link href={action.href} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold text-[var(--sds-accent)] outline-none transition hover:bg-[var(--sds-accent-soft)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
            {action.label} <FaArrowLeft className="h-3 w-3" />
          </Link>
        )}
      </div>
      {!entries.length ? (
        <div className="rounded-xl border border-dashed border-[var(--sds-border-strong)] px-4 py-7 text-center text-sm text-[var(--sds-text-muted)]">گزارش لحظه‌ای ثبت نشده است</div>
      ) : (
        <div className="relative space-y-3 before:absolute before:bottom-5 before:right-[19px] before:top-5 before:w-px before:bg-[var(--sds-border-strong)]">
          <AnimatePresence initial={false}>
            {entries.map((entry, index) => {
              const voided = entry.status === 'VOIDED';
              const attachments = entry.attachments || [];
              const attachmentCount = entry.attachmentCount ?? attachments.length;
              return (
                <motion.article
                  layout={!reduceMotion}
                  key={entry.id}
                  initial={reduceMotion ? false : { opacity: 0, x: 18, scale: 0.985 }}
                  animate={{ opacity: voided ? 0.7 : 1, x: 0, scale: 1 }}
                  exit={reduceMotion ? undefined : { opacity: 0, height: 0 }}
                  transition={{ duration: 0.35, delay: reduceMotion ? 0 : Math.min(index * 0.035, 0.18), ease: [0.22, 1, 0.36, 1] }}
                  className={cx('sds-neumorphic-card relative mr-10', compact ? 'p-3.5' : 'p-4')}
                >
                  <span className={cx('absolute -right-[29px] top-4 h-3 w-3 rounded-full border-[3px] border-[var(--sds-surface-canvas)]', voided ? 'bg-[var(--sds-danger)]' : 'bg-[var(--sds-accent)]')} aria-hidden="true" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.rowNumber != null && <span className="text-xs font-bold text-[var(--sds-text-muted)]">ردیف {entry.rowNumber.toLocaleString('fa-IR')}</span>}
                        <span className="sds-tone-info sds-tone-surface rounded-full px-2.5 py-1 text-[11px] font-bold">{entry.title}</span>
                        {voided && <span className="sds-tone-danger sds-tone-surface inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold"><FaBan className="h-3 w-3" /> باطل شده</span>}
                      </div>
                      {entry.typeDescription && <p className="mt-2 text-xs leading-5 text-[var(--sds-text-muted)]">{entry.typeDescription}</p>}
                      {entry.description && <p className="mt-2 text-sm leading-6 text-[var(--sds-text-secondary)]">{entry.description}</p>}
                      {entry.participants?.length ? <p className="mt-2 text-xs text-[var(--sds-text-muted)]">افراد مرتبط: {entry.participants.join('، ')}</p> : null}
                      {attachmentCount > 0 && !showAttachmentImages && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--sds-text-muted)]"><FaPaperclip className="h-3 w-3" /> {attachmentCount.toLocaleString('fa-IR')} پیوست</p>}
                      {showAttachmentImages && attachments.length > 0 && attachmentHref && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {attachments.map((attachment) => <img key={attachment.id} src={attachmentHref(attachment.id)} alt={attachment.name || 'پیوست گزارش'} className="h-20 w-20 rounded-lg object-cover" />)}
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-[var(--sds-text-muted)]">ثبت: {formatTimestamp(entry.createdAt)}{entry.author ? ` · توسط ${entry.author}` : ''}</p>
                      {voided && entry.voidReason && <p className="mt-2 text-xs font-semibold text-[var(--sds-danger)]">دلیل ابطال: {entry.voidReason}{entry.voidedAt ? ` · ${formatTimestamp(entry.voidedAt)}` : ''}{entry.voidedBy ? ` · عامل: ${entry.voidedBy}` : ''}</p>}
                    </div>
                    {!voided && onVoid && entry.voidable !== false && (
                      <button type="button" onClick={() => onVoid(entry)} className="sds-tone-danger inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold outline-none transition hover:bg-[var(--sds-danger-surface)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
                        <FaBan className="h-3.5 w-3.5" /> ابطال گزارش
                      </button>
                    )}
                  </div>
                </motion.article>
              );
            })}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

export interface ErpQuickAccessItem {
  id: string;
  title: string;
  href: string;
  icon: IconType;
}

export function ErpQuickAccessGrid({ title, items }: { title: string; items: ErpQuickAccessItem[] }) {
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="space-y-4">
      <h2 id={titleId} className="text-base font-bold text-[var(--sds-text-primary)]">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div key={item.id} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : index * 0.045, duration: 0.3 }}>
              <Link href={item.href} className="sds-neumorphic-card sds-neumorphic-interactive group flex min-h-24 h-full flex-col justify-between p-3.5 text-right outline-none motion-reduce:transform-none motion-reduce:transition-none">
                <span className="sds-neumorphic-icon inline-flex h-11 w-11 items-center justify-center text-[var(--sds-text-secondary)] transition-colors group-hover:text-[var(--sds-accent)]"><Icon className="h-4 w-4" /></span>
                <span className="mt-3 text-sm font-bold leading-5 text-[var(--sds-text-primary)]">{item.title}</span>
              </Link>
            </motion.div>
          );
        })}
      </div>
    </section>
  );
}

export function ErpDashboardSkeleton({ variant = 'panel' }: { variant?: 'panel' | 'summary' | 'list' }) {
  const rows = variant === 'summary' ? 4 : variant === 'list' ? 3 : 2;
  return (
    <div className="sds-neumorphic-card animate-pulse overflow-hidden p-4 motion-reduce:animate-none" role="status" aria-label="در حال دریافت اطلاعات">
      <div className="sds-skeleton h-4 w-28 rounded" />
      <div className={cx('mt-4 grid gap-3', variant === 'summary' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1')}>
        {Array.from({ length: rows }, (_, index) => <div key={index} className={cx('sds-skeleton rounded-xl', variant === 'summary' ? 'h-20' : 'h-12')} />)}
      </div>
    </div>
  );
}

export function ErpInlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="sds-tone-danger sds-tone-surface flex min-h-16 flex-col gap-3 rounded-xl border px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <span className="inline-flex items-center gap-2 font-semibold"><FaExclamationTriangle className="h-3.5 w-3.5" /> {message}</span>
      <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-3 text-xs font-bold outline-none transition hover:bg-[var(--sds-danger-surface)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">تلاش مجدد</button>
    </div>
  );
}
