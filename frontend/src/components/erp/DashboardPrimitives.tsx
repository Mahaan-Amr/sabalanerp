'use client';

import Link from 'next/link';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { FaArrowLeft, FaBan, FaCheck, FaClock, FaExclamationTriangle, FaPaperclip, FaShieldAlt, FaSyncAlt } from 'react-icons/fa';
import { useId, type ComponentType } from 'react';
import type { ErpTone } from './index';

type IconType = ComponentType<{ className?: string }>;

const cx = (...classes: Array<string | false | null | undefined>) => classes.filter(Boolean).join(' ');

const statusToneClasses: Record<ErpTone, string> = {
  primary: 'text-teal-700 dark:text-teal-200',
  neutral: 'text-slate-600 dark:text-slate-300',
  success: 'text-emerald-700 dark:text-emerald-200',
  warning: 'text-amber-700 dark:text-amber-200',
  danger: 'text-rose-700 dark:text-rose-200',
  info: 'text-sky-700 dark:text-sky-200',
  purple: 'text-violet-700 dark:text-violet-200',
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
      className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white/90 shadow-sm shadow-slate-950/5 dark:border-slate-800 dark:bg-slate-900/75"
    >
      <div className="flex items-center justify-between gap-3 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
        <h2 id={titleId} className="text-sm font-bold text-slate-950 dark:text-white">{title}</h2>
        {dateLabel && <span className="text-xs text-slate-500 dark:text-slate-400">{dateLabel}</span>}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4">
        {items.map((item, index) => {
          const Icon = item.icon;
          const isZero = item.value === 0;
          return (
            <Link
              key={item.id}
              href={item.href}
              className={cx(
                'group relative flex min-h-24 items-center justify-between gap-3 p-4 outline-none transition-colors hover:bg-slate-50 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600 dark:hover:bg-slate-800/70',
                index % 2 === 0 && 'border-l border-slate-200/70 dark:border-slate-800 sm:border-l-0',
                index < 2 && 'border-b border-slate-200/70 dark:border-slate-800 sm:border-b-0',
                index > 0 && 'sm:border-r sm:border-slate-200/70 sm:dark:border-slate-800',
                isZero && 'opacity-55 hover:opacity-80',
              )}
              aria-label={`${item.label}: ${item.value.toLocaleString('fa-IR')} نفر، مشاهده فهرست`}
            >
              <span>
                <span className="block text-xs font-semibold text-slate-500 dark:text-slate-400">{item.label}</span>
                <motion.span
                  key={item.value}
                  initial={reduceMotion ? false : { opacity: 0, y: 8, filter: 'blur(3px)' }}
                  animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                  className="mt-1 block text-2xl font-black tabular-nums text-slate-950 dark:text-white"
                >
                  {item.value.toLocaleString('fa-IR')}
                </motion.span>
              </span>
              <span className={cx('inline-flex h-10 w-10 items-center justify-center rounded-xl bg-current/10', statusToneClasses[item.tone])}>
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
        <h2 id={titleId} className="text-base font-bold text-slate-950 dark:text-white">{title}</h2>
      </div>
      {!populatedGroups.length ? (
        <div className="flex min-h-16 items-center gap-3 rounded-xl border border-emerald-200/70 bg-emerald-50/60 px-4 py-3 text-sm font-semibold text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/25 dark:text-emerald-200">
          <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 dark:bg-emerald-900/60"><FaCheck className="h-3.5 w-3.5" /></span>
          <span>موردی نیازمند پیگیری نیست</span>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {populatedGroups.map((group) => (
            <div key={group.id} className="overflow-hidden rounded-xl border border-slate-200/80 bg-white/75 dark:border-slate-800 dark:bg-slate-900/55">
              <div className="flex items-center justify-between border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <span className={cx('h-2 w-2 rounded-full', group.tone === 'danger' ? 'bg-rose-500' : 'bg-amber-500')} />
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white">{group.label}</h3>
                  <span className="text-xs text-slate-500 dark:text-slate-400">{group.count.toLocaleString('fa-IR')} نفر</span>
                </div>
                <Link href={group.href} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold text-teal-700 outline-none transition hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-200 dark:hover:bg-teal-950/40">
                  مشاهده همه <FaArrowLeft className="h-3 w-3" />
                </Link>
              </div>
              <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                {group.items.map((item) => (
                  <li key={item.id} className="flex min-h-14 items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm font-semibold text-slate-900 dark:text-white">{item.title}</span>
                    {item.meta && <span className="text-xs text-slate-500 dark:text-slate-400">{item.meta}</span>}
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
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/45 dark:text-emerald-100'
    : overdue
      ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/45 dark:text-amber-100'
      : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200';
  return (
    <motion.section
      aria-labelledby={titleId}
      initial={reduceMotion ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-teal-900/10 bg-gradient-to-l from-teal-950 to-[#073c3c] p-4 text-white shadow-lg shadow-teal-950/10 dark:border-teal-800/70 dark:from-teal-950 dark:to-slate-950 sm:p-5"
    >
      <div className="absolute -left-10 -top-14 h-36 w-36 rounded-full bg-teal-300/10 blur-2xl" aria-hidden="true" />
      <div className="relative flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-100"><FaShieldAlt className="h-4 w-4" /></span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id={titleId} className="text-sm font-bold">شیفت جاری حراست</h2>
              <span className={cx('rounded-full px-2.5 py-1 text-[11px] font-bold', badgeClass)}>{badge}</span>
              {overdue && <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-200"><FaExclamationTriangle className="h-3 w-3" /> شروع شیفت به تأخیر افتاده است</span>}
            </div>
            {state === 'NONE' ? (
              <p className="mt-3 text-sm text-teal-50/80">شیفت فعال یا برنامه‌ریزی‌شده‌ای وجود ندارد</p>
            ) : (
              <>
                <p className="mt-3 truncate text-lg font-black">{personnelName}</p>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-teal-50/70">
                  {personnelPosition && <span>{personnelPosition}</span>}
                  {coverageLabel && <span>{coverageLabel}</span>}
                  {plannedPersonnelName && <span>نیروی برنامه‌ریزی‌شده: {plannedPersonnelName}</span>}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-teal-50/80">
                  {scheduleLabel && <span className="inline-flex items-center gap-1.5"><FaClock className="h-3 w-3" /> {scheduleLabel}</span>}
                  {startedLabel && <span>شروع واقعی: {startedLabel}</span>}
                </div>
              </>
            )}
          </div>
        </div>
        {onRefresh && (
          <button type="button" onClick={onRefresh} disabled={refreshing} className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-teal-50 outline-none transition hover:bg-white/15 focus-visible:ring-2 focus-visible:ring-white disabled:opacity-50" aria-label="به‌روزرسانی وضعیت شیفت">
            <FaSyncAlt className={cx('h-3.5 w-3.5', refreshing && !reduceMotion && 'animate-spin')} />
          </button>
        )}
      </div>
      {(updatedLabel || refreshFailed) && (
        <div className="relative mt-4 border-t border-white/10 pt-3 text-[11px] text-teal-50/60">
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
  voidReason?: string | null;
  voidedAt?: string | null;
  attachmentCount?: number;
  attachments?: Array<{ id: string; name?: string | null }>;
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
        <h2 id={titleId} className="text-base font-bold text-slate-950 dark:text-white">{title}</h2>
        {action && (
          <Link href={action.href} className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-xs font-bold text-teal-700 outline-none transition hover:bg-teal-50 focus-visible:ring-2 focus-visible:ring-teal-600 dark:text-teal-200 dark:hover:bg-teal-950/40">
            {action.label} <FaArrowLeft className="h-3 w-3" />
          </Link>
        )}
      </div>
      {!entries.length ? (
        <div className="rounded-xl border border-dashed border-slate-300 px-4 py-7 text-center text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">گزارش لحظه‌ای ثبت نشده است</div>
      ) : (
        <div className="relative space-y-3 before:absolute before:bottom-5 before:right-[19px] before:top-5 before:w-px before:bg-slate-200 dark:before:bg-slate-800">
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
                  className={cx('relative mr-10 rounded-xl border border-slate-200/80 bg-white/80 shadow-sm shadow-slate-950/[0.03] dark:border-slate-800 dark:bg-slate-900/65', compact ? 'p-3.5' : 'p-4')}
                >
                  <span className={cx('absolute -right-[29px] top-4 h-3 w-3 rounded-full border-[3px] border-white dark:border-slate-950', voided ? 'bg-rose-500' : 'bg-teal-500')} aria-hidden="true" />
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {entry.rowNumber != null && <span className="text-xs font-bold text-slate-500 dark:text-slate-400">ردیف {entry.rowNumber.toLocaleString('fa-IR')}</span>}
                        <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-800 dark:bg-sky-900/40 dark:text-sky-100">{entry.title}</span>
                        {voided && <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-bold text-rose-800 dark:bg-rose-900/40 dark:text-rose-100"><FaBan className="h-3 w-3" /> باطل شده</span>}
                      </div>
                      {entry.typeDescription && <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{entry.typeDescription}</p>}
                      {entry.description && <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-200">{entry.description}</p>}
                      {entry.participants?.length ? <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">افراد مرتبط: {entry.participants.join('، ')}</p> : null}
                      {attachmentCount > 0 && !showAttachmentImages && <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 dark:text-slate-400"><FaPaperclip className="h-3 w-3" /> {attachmentCount.toLocaleString('fa-IR')} پیوست</p>}
                      {showAttachmentImages && attachments.length > 0 && attachmentHref && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {attachments.map((attachment) => <img key={attachment.id} src={attachmentHref(attachment.id)} alt={attachment.name || 'پیوست گزارش'} className="h-20 w-20 rounded-lg object-cover" />)}
                        </div>
                      )}
                      <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">ثبت: {formatTimestamp(entry.createdAt)}</p>
                      {voided && entry.voidReason && <p className="mt-2 text-xs font-semibold text-rose-700 dark:text-rose-300">دلیل ابطال: {entry.voidReason}{entry.voidedAt ? ` · ${formatTimestamp(entry.voidedAt)}` : ''}</p>}
                    </div>
                    {!voided && onVoid && (
                      <button type="button" onClick={() => onVoid(entry)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold text-rose-700 outline-none transition hover:bg-rose-50 focus-visible:ring-2 focus-visible:ring-rose-600 dark:text-rose-200 dark:hover:bg-rose-950/35">
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
      <h2 id={titleId} className="text-base font-bold text-slate-950 dark:text-white">{title}</h2>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {items.map((item, index) => {
          const Icon = item.icon;
          return (
            <motion.div key={item.id} initial={reduceMotion ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: reduceMotion ? 0 : index * 0.045, duration: 0.3 }}>
              <Link href={item.href} className="group flex min-h-24 h-full flex-col justify-between rounded-xl border border-slate-200/80 bg-white/70 p-3.5 text-right shadow-sm shadow-slate-950/[0.025] outline-none transition hover:-translate-y-0.5 hover:border-teal-700/30 hover:bg-white hover:shadow-md focus-visible:ring-2 focus-visible:ring-teal-600 motion-reduce:transform-none motion-reduce:transition-none dark:border-slate-800 dark:bg-slate-900/55 dark:hover:border-teal-700 dark:hover:bg-slate-900">
                <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition-colors group-hover:bg-teal-50 group-hover:text-teal-700 dark:bg-slate-800 dark:text-slate-300 dark:group-hover:bg-teal-950/60 dark:group-hover:text-teal-200"><Icon className="h-4 w-4" /></span>
                <span className="mt-3 text-sm font-bold leading-5 text-slate-900 dark:text-white">{item.title}</span>
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
    <div className="animate-pulse overflow-hidden rounded-2xl border border-slate-200/70 bg-white/70 p-4 motion-reduce:animate-none dark:border-slate-800 dark:bg-slate-900/55" role="status" aria-label="در حال دریافت اطلاعات">
      <div className="h-4 w-28 rounded bg-slate-200 dark:bg-slate-800" />
      <div className={cx('mt-4 grid gap-3', variant === 'summary' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-1')}>
        {Array.from({ length: rows }, (_, index) => <div key={index} className={cx('rounded-xl bg-slate-100 dark:bg-slate-800/70', variant === 'summary' ? 'h-20' : 'h-12')} />)}
      </div>
    </div>
  );
}

export function ErpInlineError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex min-h-16 flex-col gap-3 rounded-xl border border-rose-200 bg-rose-50/70 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950/25 dark:text-rose-100 sm:flex-row sm:items-center sm:justify-between">
      <span className="inline-flex items-center gap-2 font-semibold"><FaExclamationTriangle className="h-3.5 w-3.5" /> {message}</span>
      <button type="button" onClick={onRetry} className="min-h-11 rounded-lg px-3 text-xs font-bold outline-none transition hover:bg-rose-100 focus-visible:ring-2 focus-visible:ring-rose-600 dark:hover:bg-rose-900/40">تلاش مجدد</button>
    </div>
  );
}
