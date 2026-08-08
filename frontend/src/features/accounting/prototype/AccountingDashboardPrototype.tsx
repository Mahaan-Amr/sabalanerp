'use client';

// PROTOTYPE ONLY — three responsive Accounting dashboard compositions, switchable
// on the existing /dashboard/accounting route with ?prototype=accounting-dashboard&variant=A.

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import {
  FaArrowLeft,
  FaBalanceScale,
  FaChartLine,
  FaChevronLeft,
  FaChevronRight,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaFileInvoice,
  FaHistory,
  FaMoneyCheckAlt,
  FaReceipt,
  FaSync,
  FaUserClock,
  FaUserPlus,
} from 'react-icons/fa';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ErpButton, ErpIconButton, ErpInlineState, ErpSegmentedControl, ErpSelect, ErpSkeleton } from '@/components/erp';

type VariantKey = 'A' | 'B' | 'C';
type PrototypeState = 'ready' | 'loading' | 'empty' | 'stale' | 'error';
type HrMetricState = 'authorized' | 'loading' | 'unavailable' | 'error';
type ChartRange = '1m' | '3m' | '6m' | '1y';
type Tone = 'primary' | 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
type IconType = ComponentType<{ className?: string }>;

const variants: Array<{ key: VariantKey; label: string }> = [
  { key: 'A', label: 'متعادل' },
  { key: 'B', label: 'روند‌محور' },
  { key: 'C', label: 'اقدام‌محور' },
];

const metrics: Array<{
  id: string;
  label: string;
  value?: number;
  detail?: string;
  href: string;
  icon: IconType;
  tone: Tone;
  optional?: boolean;
}> = [
  { id: 'contracts', label: 'قراردادهای قابل بررسی', value: 18, href: '/dashboard/accounting/contracts?view=reviewable', icon: FaClipboardCheck, tone: 'primary' },
  { id: 'invoices', label: 'پیش‌نویس صورتحساب‌ها', value: 7, href: '/dashboard/accounting/invoice-candidates?view=actionable', icon: FaFileInvoice, tone: 'info' },
  { id: 'checks', label: 'دریافت‌ها و چک‌ها', value: 12, detail: 'سررسید گذشته یا ۷ روز آینده', href: '/dashboard/accounting/payments?view=due-soon', icon: FaMoneyCheckAlt, tone: 'warning' },
  { id: 'receivables', label: 'دریافتنی‌ها', value: 34, href: '/dashboard/accounting/receivables?view=open', icon: FaReceipt, tone: 'success' },
  { id: 'hiring-cases', label: 'استخدام: وثیقه و قرارداد', value: 4, href: '/dashboard/hr/hiring?view=collateral-contracts', icon: FaUserPlus, tone: 'info', optional: true },
  { id: 'templates', label: 'قالب وثیقه استخدام', value: 6, href: '/dashboard/hr/hiring/collateral-templates?view=active', icon: FaClipboardCheck, tone: 'neutral', optional: true },
  { id: 'tax', label: 'مالیات و سامانه مودیان', value: 9, href: '/dashboard/accounting/tax?view=needs-attention', icon: FaBalanceScale, tone: 'purple' },
  { id: 'corrections', label: 'بررسی اصلاحات', value: 5, href: '/dashboard/accounting/correction-requests?view=active', icon: FaExclamationTriangle, tone: 'warning' },
  { id: 'audit', label: 'سوابق عملیات', value: 248, href: '/dashboard/accounting/audit', icon: FaHistory, tone: 'neutral' },
  { id: 'performance', label: 'عملکرد حسابداران', value: 8, detail: 'فعال در ۳۰ روز اخیر', href: '/dashboard/accounting/performance?view=last30days', icon: FaUserClock, tone: 'primary' },
];

const trendRial = [
  { month: 'مهر', invoiced: 610, received: 520, outstanding: 320 },
  { month: 'آبان', invoiced: 690, received: 570, outstanding: 350 },
  { month: 'آذر', invoiced: 740, received: 620, outstanding: 390 },
  { month: 'دی', invoiced: 720, received: 650, outstanding: 460 },
  { month: 'بهمن', invoiced: 810, received: 680, outstanding: 510 },
  { month: 'اسفند', invoiced: 840, received: 720, outstanding: 590 },
  { month: 'فروردین', invoiced: 780, received: 610, outstanding: 420 },
  { month: 'اردیبهشت', invoiced: 920, received: 760, outstanding: 530 },
  { month: 'خرداد', invoiced: 860, received: 820, outstanding: 570 },
  { month: 'تیر', invoiced: 1120, received: 890, outstanding: 800 },
  { month: 'مرداد', invoiced: 980, received: 940, outstanding: 840 },
  { month: 'شهریور', invoiced: 1260, received: 1010, outstanding: 1090 },
];

const dailyTrendRial = Array.from({ length: 30 }, (_, index) => {
  const invoiceVariation = [0, 35, -18, 42, 12, -25, 28][index % 7];
  const receivedVariation = [12, -14, 26, 4, 32, -18, 20][index % 7];
  const outstandingVariation = [0, 18, 9, 31, 22, 37, 28][index % 7];
  return {
    month: (index + 1).toLocaleString('fa-IR'),
    invoiced: 260 + (index * 9) + invoiceVariation,
    received: 220 + (index * 8) + receivedVariation,
    outstanding: 720 + (index * 13) + outstandingVariation,
  };
});

const chartRanges: Array<{ value: ChartRange; label: string; months: number }> = [
  { value: '1m', label: '۱ ماه', months: 1 },
  { value: '3m', label: '۳ ماه', months: 3 },
  { value: '6m', label: '۶ ماه', months: 6 },
  { value: '1y', label: '۱ سال', months: 12 },
];

const deadlines = [
  { id: 'overdue', label: 'گذشته', count: 8, amount: '۱٫۸ میلیارد ریال', due: 'overdue', tone: 'danger' as Tone },
  { id: 'next7', label: '۷ روز آینده', count: 12, amount: '۲٫۴ میلیارد ریال', due: 'next7', tone: 'warning' as Tone },
  { id: 'days8to30', label: '۸ تا ۳۰ روز', count: 17, amount: '۳٫۱ میلیارد ریال', due: 'days8to30', tone: 'info' as Tone },
  { id: 'later30', label: 'بیش از ۳۰ روز', count: 9, amount: '۱٫۳ میلیارد ریال', due: 'later30', tone: 'neutral' as Tone },
];

const toneClass: Record<Tone, string> = {
  primary: 'sds-tone-primary',
  neutral: 'sds-tone-neutral',
  success: 'sds-tone-success',
  warning: 'sds-tone-warning',
  danger: 'sds-tone-danger',
  info: 'sds-tone-info',
  purple: 'sds-tone-purple',
};

function updatePrototypeQuery(updates: Record<string, string>) {
  const params = new URLSearchParams(window.location.search);
  Object.entries(updates).forEach(([key, value]) => params.set(key, value));
  window.history.replaceState(null, '', `${window.location.pathname}?${params.toString()}`);
}

function PrototypeHeader({ onRefresh }: { onRefresh: () => void }) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2">
        <ErpIconButton label="بازگشت" icon={FaArrowLeft} href="/dashboard" />
        <div>
          <p className="text-xs font-bold text-[var(--sds-accent)]">حسابداری</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-[var(--sds-text-primary)] sm:text-3xl">داشبورد حسابداری</h1>
        </div>
      </div>
      <ErpButton label="به‌روزرسانی" icon={FaSync} onClick={onRefresh} tone="neutral" variant="soft" />
    </header>
  );
}

function PrototypeMetricTile({ item, compact = false }: { item: (typeof metrics)[number]; compact?: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={`sds-neumorphic-card sds-neumorphic-interactive ${toneClass[item.tone]} group flex min-h-24 items-center justify-between gap-3 p-4 text-right outline-none motion-reduce:transform-none motion-reduce:transition-none ${compact ? 'sm:min-h-20 sm:p-3' : ''}`}
    >
      <div className="min-w-0">
        <p className="text-xs font-semibold leading-5 text-[var(--sds-text-muted)]">{item.label}</p>
        <div className="mt-1 flex items-baseline gap-2">
          {item.value !== undefined && (
            <strong className="text-2xl font-black tabular-nums text-[var(--sds-text-primary)]">{item.value.toLocaleString('fa-IR')}</strong>
          )}
        </div>
        {item.detail && <p className="mt-1 truncate text-[11px] text-[var(--sds-text-muted)]">{item.detail}</p>}
      </div>
      <span className="sds-neumorphic-icon sds-tone-surface inline-flex h-11 w-11 shrink-0 items-center justify-center">
        <Icon className="h-4 w-4" />
      </span>
    </Link>
  );
}

function MetricGrid({ items = metrics, compact = false }: { items?: typeof metrics; compact?: boolean }) {
  return (
    <section aria-label="شاخص‌های عملیاتی" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
      {items.map((item) => <PrototypeMetricTile key={item.id} item={item} compact={compact} />)}
    </section>
  );
}

function TrendChart({ compact = false, range, onRangeChange }: { compact?: boolean; range: ChartRange; onRangeChange: (range: ChartRange) => void }) {
  const rangeConfig = chartRanges.find(item => item.value === range) || chartRanges[2];
  const sourceTrend = range === '1m' ? dailyTrendRial : trendRial.slice(-rangeConfig.months);
  const xAxisTicks = range === '1m' ? ['۱', '۸', '۱۵', '۲۲', '۳۰'] : undefined;
  const trend = sourceTrend.map(item => ({
    ...item,
    invoiced: item.invoiced / 10,
    received: item.received / 10,
    outstanding: item.outstanding / 10,
  }));
  return (
    <section className="sds-neumorphic-card overflow-hidden p-4 sm:p-5" aria-labelledby="accounting-trend-title">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 id="accounting-trend-title" className="font-black text-[var(--sds-text-primary)]">روند مالی قراردادها</h2>
          <p className="mt-1 text-xs text-[var(--sds-text-muted)]">
            {range === '1m' ? 'مبالغ روزانه به میلیون تومان · ماه جاری با نشانگر هفتگی' : `مبالغ ماهانه به میلیون تومان · ${rangeConfig.label} اخیر`}
          </p>
        </div>
        <span className="sds-neumorphic-icon inline-flex h-11 w-11 items-center justify-center text-[var(--sds-accent)]"><FaChartLine className="h-4 w-4" /></span>
      </div>
      <div className="mb-4" role="group" aria-label="بازه زمانی نمودار">
        <ErpSegmentedControl options={chartRanges.map(({ value, label }) => ({ value, label }))} value={range} onChange={onRangeChange} />
      </div>
      <div className={compact ? 'h-52' : 'h-72'} dir="ltr">
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: compact ? 208 : 288 }}>
          <AreaChart data={trend} margin={{ top: 8, right: 4, bottom: 0, left: -18 }}>
            <defs>
              <linearGradient id="invoiced-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="var(--sds-accent)" stopOpacity={0.28} /><stop offset="95%" stopColor="var(--sds-accent)" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid stroke="var(--sds-border-subtle)" strokeDasharray="3 5" vertical={false} />
            <XAxis dataKey="month" ticks={xAxisTicks} interval="preserveStartEnd" minTickGap={18} tick={{ fill: 'var(--sds-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: 'var(--sds-text-muted)', fontSize: 11 }} axisLine={false} tickLine={false} />
            <Tooltip contentStyle={{ background: 'var(--sds-surface-overlay)', border: '1px solid var(--sds-border-default)', borderRadius: 'var(--sds-radius-card)', color: 'var(--sds-text-primary)' }} />
            <Legend wrapperStyle={{ color: 'var(--sds-text-secondary)', fontSize: 11 }} />
            <Area name="فاکتور‌شده" dataKey="invoiced" type="monotone" stroke="var(--sds-accent)" fill="url(#invoiced-fill)" strokeWidth={2.5} activeDot={{ r: 6 }} />
            <Area name="دریافت‌شده" dataKey="received" type="monotone" stroke="var(--sds-success)" fill="transparent" strokeWidth={2.5} />
            <Area name="مانده مطالبات" dataKey="outstanding" type="monotone" stroke="var(--sds-warning)" fill="transparent" strokeWidth={2.5} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

function DeadlinePanel({ condensed = false }: { condensed?: boolean }) {
  return (
    <section className="sds-neumorphic-card overflow-hidden" aria-labelledby="deadline-title">
      <div className="flex items-center justify-between border-b border-[var(--sds-border-subtle)] px-4 py-4">
        <div>
          <h2 id="deadline-title" className="font-black text-[var(--sds-text-primary)]">سررسیدها</h2>
          <p className="mt-1 text-xs text-[var(--sds-text-muted)]">دریافتنی‌ها و چک‌های تسویه‌نشده</p>
        </div>
        <Link href="/dashboard/accounting?due=overdue" className="inline-flex min-h-11 items-center gap-2 px-2 text-xs font-bold text-[var(--sds-accent)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">مشاهده <FaChevronLeft className="h-3 w-3" /></Link>
      </div>
      <div className={condensed ? 'grid grid-cols-2' : 'divide-y divide-[var(--sds-border-subtle)]'}>
        {deadlines.map((item) => (
          <Link key={item.id} href={`/dashboard/accounting?due=${item.due}`} className={`group flex min-h-16 items-center justify-between gap-3 px-4 py-3 outline-none transition hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--sds-focus-ring)] ${condensed ? 'border-b border-l border-[var(--sds-border-subtle)]' : ''}`}>
            <div className="flex min-w-0 items-center gap-3">
              <span className={`${toneClass[item.tone]} sds-tone-surface inline-flex h-9 min-w-9 items-center justify-center rounded-full px-2 text-sm font-black`}>{item.count.toLocaleString('fa-IR')}</span>
              <span className="text-sm font-bold text-[var(--sds-text-primary)]">{item.label}</span>
            </div>
            {!condensed && <span className="text-xs text-[var(--sds-text-muted)]">{item.amount}</span>}
          </Link>
        ))}
      </div>
    </section>
  );
}

function VariantA({ items, range, onRangeChange }: { items: typeof metrics; range: ChartRange; onRangeChange: (range: ChartRange) => void }) {
  return <><MetricGrid items={items} /><div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,.85fr)]"><TrendChart range={range} onRangeChange={onRangeChange} /><DeadlinePanel /></div></>;
}

function VariantB({ items, range, onRangeChange }: { items: typeof metrics; range: ChartRange; onRangeChange: (range: ChartRange) => void }) {
  return (
    <>
      <TrendChart range={range} onRangeChange={onRangeChange} />
      <MetricGrid items={items} compact />
      <DeadlinePanel condensed />
    </>
  );
}

function VariantC({ items, range, onRangeChange }: { items: typeof metrics; range: ChartRange; onRangeChange: (range: ChartRange) => void }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(20rem,.9fr)_minmax(0,1.5fr)]">
        <div className="order-2 xl:order-1"><DeadlinePanel /></div>
        <div className="order-1 xl:order-2"><TrendChart compact range={range} onRangeChange={onRangeChange} /></div>
      </div>
      <MetricGrid items={items} compact />
    </>
  );
}

function StateSurface({ state, retry }: { state: Exclude<PrototypeState, 'ready' | 'stale'>; retry: () => void }) {
  if (state === 'loading') return <div className="grid gap-5"><ErpSkeleton lines={4} /><div className="grid gap-4 xl:grid-cols-2"><ErpSkeleton lines={5} /><ErpSkeleton lines={5} /></div></div>;
  if (state === 'empty') {
    const emptyMetrics = metrics.map(item => ({ ...item, value: 0, detail: item.detail }));
    return <div className="space-y-5"><ErpInlineState kind="empty" title="هنوز داده مالی ثبت نشده است؛ همه مسیرها با شمارش صفر در دسترس‌اند." /><MetricGrid items={emptyMetrics} /><div className="grid gap-5 xl:grid-cols-2"><section className="sds-neumorphic-card p-5"><ErpInlineState kind="empty" title="برای نمایش روند مالی هنوز رویدادی ثبت نشده است." /></section><section className="sds-neumorphic-card p-5"><ErpInlineState kind="empty" title="سررسید فعالی وجود ندارد." /></section></div></div>;
  }
  return <ErpInlineState kind="error" title="داشبورد حسابداری در دسترس نیست و نمای موفق قبلی وجود ندارد." action={{ label: 'تلاش مجدد', icon: FaSync, onClick: retry }} />;
}

function PrototypeSwitcher({ variant, state, hrState, onVariant, onState, onHrState }: { variant: VariantKey; state: PrototypeState; hrState: HrMetricState; onVariant: (key: VariantKey) => void; onState: (state: PrototypeState) => void; onHrState: (state: HrMetricState) => void }) {
  const index = variants.findIndex(item => item.key === variant);
  const cycle = useCallback((direction: -1 | 1) => onVariant(variants[(index + direction + variants.length) % variants.length].key), [index, onVariant]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') cycle(-1);
      if (event.key === 'ArrowRight') cycle(1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cycle]);

  return (
    <aside className="sds-neumorphic-card fixed bottom-[max(.75rem,env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-1.5rem)] -translate-x-1/2 items-center gap-1 border border-[var(--sds-border-strong)] bg-[var(--sds-surface-overlay)] p-1.5 shadow-[var(--sds-shadow-raised)]" aria-label="کنترل نمونه آزمایشی">
      <ErpIconButton label="طرح قبلی" icon={FaChevronRight} onClick={() => cycle(-1)} />
      <span className="min-w-24 px-2 text-center text-xs font-black text-[var(--sds-text-primary)]">{variant} — {variants[index].label}</span>
      <ErpIconButton label="طرح بعدی" icon={FaChevronLeft} onClick={() => cycle(1)} />
      <span className="mx-1 h-7 w-px bg-[var(--sds-border-default)]" aria-hidden="true" />
      <label className="sr-only" htmlFor="prototype-state">حالت داده</label>
      <ErpSelect id="prototype-state" value={state} onChange={event => onState(event.target.value as PrototypeState)} className="min-h-11 px-2 text-xs font-bold">
        <option value="ready">عادی</option><option value="loading">بارگذاری</option><option value="empty">خالی</option><option value="stale">کهنه</option><option value="error">خطا</option>
      </ErpSelect>
      <label className="sr-only" htmlFor="prototype-hr-state">حالت نشان منابع انسانی</label>
      <ErpSelect id="prototype-hr-state" value={hrState} onChange={event => onHrState(event.target.value as HrMetricState)} className="hidden min-h-11 px-2 text-xs font-bold sm:block">
        <option value="authorized">HR مجاز</option><option value="loading">HR در انتظار</option><option value="unavailable">HR بی‌اختیار</option><option value="error">HR خطا</option>
      </ErpSelect>
    </aside>
  );
}

export function AccountingDashboardPrototype() {
  const initial = useMemo(() => {
    if (typeof window === 'undefined') return { variant: 'A' as VariantKey, state: 'ready' as PrototypeState, hrState: 'authorized' as HrMetricState, range: '6m' as ChartRange };
    const params = new URLSearchParams(window.location.search);
    const variant = params.get('variant');
    const state = params.get('state');
    return {
      variant: (variants.some(item => item.key === variant) ? variant : 'A') as VariantKey,
      state: (['ready', 'loading', 'empty', 'stale', 'error'].includes(state || '') ? state : 'ready') as PrototypeState,
      hrState: (['authorized', 'loading', 'unavailable', 'error'].includes(params.get('hr') || '') ? params.get('hr') : 'authorized') as HrMetricState,
      range: (chartRanges.some(item => item.value === params.get('range')) ? params.get('range') : '6m') as ChartRange,
    };
  }, []);
  const [variant, setVariant] = useState<VariantKey>(initial.variant);
  const [state, setState] = useState<PrototypeState>(initial.state);
  const [hrState, setHrState] = useState<HrMetricState>(initial.hrState || 'authorized');
  const [range, setRange] = useState<ChartRange>(initial.range || '6m');

  const chooseVariant = useCallback((next: VariantKey) => { setVariant(next); updatePrototypeQuery({ variant: next }); }, []);
  const chooseState = useCallback((next: PrototypeState) => { setState(next); updatePrototypeQuery({ state: next }); }, []);
  const chooseHrState = useCallback((next: HrMetricState) => { setHrState(next); updatePrototypeQuery({ hr: next }); }, []);
  const chooseRange = useCallback((next: ChartRange) => { setRange(next); updatePrototypeQuery({ range: next }); }, []);
  const presentedMetrics = useMemo(() => metrics.map(item => item.optional && hrState !== 'authorized' ? { ...item, value: undefined, detail: hrState === 'loading' ? 'در حال بررسی دسترسی' : undefined } : item), [hrState]);
  const content = variant === 'B'
    ? <VariantB items={presentedMetrics} range={range} onRangeChange={chooseRange} />
    : variant === 'C'
      ? <VariantC items={presentedMetrics} range={range} onRangeChange={chooseRange} />
      : <VariantA items={presentedMetrics} range={range} onRangeChange={chooseRange} />;

  return (
    <main dir="rtl" lang="fa" className="sds-workspace sds-neumorphic-scope mx-auto w-full max-w-7xl space-y-6 pb-28 lg:pb-20">
      <PrototypeHeader onRefresh={() => chooseState('ready')} />
      {state === 'stale' && <ErpInlineState kind="stale" title="به‌روزرسانی انجام نشد؛ آخرین نمای موفق بدون تغییر نمایش داده می‌شود." action={{ label: 'تلاش مجدد', icon: FaSync, onClick: () => chooseState('ready') }} />}
      {hrState === 'error' && (state === 'ready' || state === 'stale') && <ErpInlineState kind="error" title="شمارش منابع انسانی در دسترس نیست؛ کارت‌ها و تازه‌سازی داشبورد همچنان فعال‌اند." />}
      {state === 'ready' || state === 'stale' ? content : <StateSurface state={state} retry={() => chooseState('ready')} />}
      <PrototypeSwitcher variant={variant} state={state} hrState={hrState} onVariant={chooseVariant} onState={chooseState} onHrState={chooseHrState} />
    </main>
  );
}
