'use client';

// PROTOTYPE ONLY: three BI overview hierarchies, switchable with ?prototype=1&variant=A|B|C on /dashboard/bi.

import {
  ErpBadge,
  ErpButton,
  ErpNeumorphicCard,
  ErpNeumorphicInteractiveCard,
  ErpPressable,
} from '@/components/erp';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  FaArrowLeft,
  FaArrowRight,
  FaChartLine,
  FaClipboardCheck,
  FaCoins,
  FaFileContract,
  FaFilter,
  FaMoneyCheckAlt,
  FaProjectDiagram,
  FaSync,
  FaTruck,
  FaUsers,
} from 'react-icons/fa';

type VariantKey = 'A' | 'B' | 'C';
type SelectHandler = (label: string) => void;

const variants: Array<{ key: VariantKey; name: string }> = [
  { key: 'A', name: 'صف تصمیم' },
  { key: 'B', name: 'میز فرمان دو بخشی' },
  { key: 'C', name: 'زنجیره تجاری' },
];

const recommendations = [
  {
    id: 'collection',
    title: '۳ وصول از ۲ قرارداد سررسید گذشته است',
    meta: '۲٫۴ میلیارد تومان · قدیمی‌ترین: ۱۲ روز',
    source: 'حسابداری',
    tone: 'danger' as const,
    icon: FaMoneyCheckAlt,
  },
  {
    id: 'delivery',
    title: '۲ تحویل امروز هنوز خروج نگهبانی ندارند',
    meta: 'پوشش تطبیق: ۸ از ۱۰ بارگیری',
    source: 'لجستیک + نگهبانی',
    tone: 'warning' as const,
    icon: FaTruck,
  },
  {
    id: 'pipeline',
    title: 'پایپ‌لاین فروشنده غرب ۱۸٪ افت کرده است',
    meta: 'کاهش ۱٫۱ میلیارد تومان نسبت به دوره قبل',
    source: 'فروش',
    tone: 'warning' as const,
    icon: FaChartLine,
  },
  {
    id: 'crm',
    title: '۷ پیگیری CRM از موعد گذشته است',
    meta: '۳ فروشنده · ۲ فرصت با ارزش بالا',
    source: 'CRM',
    tone: 'info' as const,
    icon: FaUsers,
  },
];

const metrics = [
  {
    id: 'realized',
    label: 'فروش قطعی خالص',
    value: '۱۲٫۸ میلیارد',
    hint: '۸٪ بیشتر از دوره قبل',
    tone: 'success' as const,
    icon: FaCoins,
  },
  {
    id: 'pipeline',
    label: 'پایپ‌لاین فعال',
    value: '۹٫۶ میلیارد',
    hint: '۲۱ قرارداد باز',
    tone: 'primary' as const,
    icon: FaFileContract,
  },
  {
    id: 'receivable',
    label: 'مانده قابل دریافت',
    value: '۴٫۱ میلیارد',
    hint: 'پوشش ۱۸ از ۲۴ قرارداد',
    tone: 'warning' as const,
    icon: FaMoneyCheckAlt,
  },
  {
    id: 'delivery',
    label: 'ریسک اجرای تحویل',
    value: '۵ تعهد',
    hint: '۲ معوق · ۳ نزدیک سررسید',
    tone: 'danger' as const,
    icon: FaTruck,
  },
];

const sources = [
  { name: 'فروش', state: 'کامل', tone: 'success' as const },
  { name: 'CRM', state: '۲۴ دقیقه پیش', tone: 'info' as const },
  { name: 'حسابداری', state: '۱۸ از ۲۴', tone: 'warning' as const },
  { name: 'لجستیک', state: '۱۰ از ۱۲', tone: 'warning' as const },
  { name: 'نگهبانی', state: '۸ از ۱۰', tone: 'warning' as const },
];

function CommandHeader({ selected }: { selected: string }) {
  return (
    <header className="sds-neumorphic-card p-4 sm:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-black text-[var(--sds-text-primary)] sm:text-2xl">هوش تجاری</h1>
            <ErpBadge tone="primary">نمونه نمایشی</ErpBadge>
          </div>
          <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">
            کل شرکت · ماه جاری · آخرین به‌روزرسانی ۱۴:۳۲
          </p>
          <p className="mt-1 text-xs text-[var(--sds-text-muted)]" aria-live="polite">
            وضعیت نمونه: {selected}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <ErpButton label="فیلترها" icon={FaFilter} tone="neutral" variant="soft" />
          <ErpButton label="به‌روزرسانی" icon={FaSync} tone="primary" variant="solid" />
        </div>
      </div>
    </header>
  );
}

function SourceHealth({ compact = false }: { compact?: boolean }) {
  return (
    <section aria-label="وضعیت منابع" className="flex flex-wrap gap-2">
      {sources.map((source) => (
        <ErpBadge key={source.name} tone={source.tone} variant="outline">
          {source.name}: {source.state}
        </ErpBadge>
      ))}
      {!compact && <span className="self-center text-xs text-[var(--sds-text-muted)]">جزئیات در «تطبیق»</span>}
    </section>
  );
}

function RecommendationRows({ onSelect, limit = recommendations.length }: { onSelect: SelectHandler; limit?: number }) {
  return (
    <div className="divide-y divide-[var(--sds-border-subtle)]">
      {recommendations.slice(0, limit).map((item, index) => {
        const Icon = item.icon;
        return (
          <ErpPressable
            key={item.id}
            onClick={() => onSelect(`پیشنهاد ${index + 1}: ${item.title}`)}
            className="group flex min-h-16 w-full items-start gap-3 rounded-lg px-1 py-3 text-right outline-none transition hover:bg-[var(--sds-surface-subtle)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"
          >
            <span className={`sds-tone-${item.tone} sds-tone-surface inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl`}>
              <Icon className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-bold leading-6 text-[var(--sds-text-primary)]">{item.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-[var(--sds-text-muted)]">{item.meta} · {item.source}</span>
            </span>
            <FaArrowLeft className="mt-3 h-3.5 w-3.5 shrink-0 text-[var(--sds-text-muted)]" />
          </ErpPressable>
        );
      })}
    </div>
  );
}

function MetricButtons({ onSelect, stacked = false }: { onSelect: SelectHandler; stacked?: boolean }) {
  return (
    <section
      aria-label="شاخص‌های اصلی"
      className={stacked ? 'grid gap-3' : 'grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4'}
    >
      {metrics.map((metric) => {
        const Icon = metric.icon;
        return (
          <ErpNeumorphicInteractiveCard
            key={metric.id}
            onClick={() => onSelect(`شاخص: ${metric.label}`)}
            className="flex min-h-28 items-center justify-between gap-3 p-4 text-right"
          >
            <span className="min-w-0">
              <span className="block text-xs text-[var(--sds-text-secondary)]">{metric.label}</span>
              <span className="mt-1 block text-xl font-black text-[var(--sds-text-primary)]">{metric.value}</span>
              <span className="mt-1 block text-xs text-[var(--sds-text-muted)]">{metric.hint}</span>
            </span>
            <span className={`sds-tone-${metric.tone} sds-tone-surface inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl`}>
              <Icon className="h-5 w-5" />
            </span>
          </ErpNeumorphicInteractiveCard>
        );
      })}
    </section>
  );
}

function TrendChart({ condensed = false }: { condensed?: boolean }) {
  const points = '8,82 58,67 108,72 158,45 208,53 258,30 308,36 358,16';
  return (
    <div className={condensed ? 'mt-3' : 'mt-4'}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-bold text-[var(--sds-text-primary)]">روند فروش قطعی خالص</span>
        <span className="text-xs text-[var(--sds-text-muted)]">قدیمی‌تر ← جدیدتر</span>
      </div>
      <svg
        role="img"
        aria-label="روند فروش قطعی خالص در هشت بازه؛ مقدار کلی افزایشی است و در بازه پنجم افت کوتاه دارد"
        viewBox="0 0 366 100"
        className={condensed ? 'mt-2 h-24 w-full' : 'mt-3 h-36 w-full'}
      >
        <line x1="8" y1="88" x2="358" y2="88" stroke="var(--sds-border-default)" strokeWidth="1" />
        <line x1="8" y1="50" x2="358" y2="50" stroke="var(--sds-border-subtle)" strokeWidth="1" strokeDasharray="4 5" />
        <polyline points={points} fill="none" stroke="var(--sds-accent)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.split(' ').map((point) => {
          const [cx, cy] = point.split(',');
          return <circle key={point} cx={cx} cy={cy} r="4" fill="var(--sds-surface-raised)" stroke="var(--sds-accent)" strokeWidth="3" />;
        })}
      </svg>
    </div>
  );
}

function VariantA({ onSelect }: { onSelect: SelectHandler }) {
  return (
    <div className="space-y-4">
      <ErpNeumorphicCard className="p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-[var(--sds-text-primary)]">نیازمند توجه</h2>
          <ErpBadge tone="danger">۴ مورد</ErpBadge>
        </div>
        <RecommendationRows onSelect={onSelect} />
      </ErpNeumorphicCard>
      <MetricButtons onSelect={onSelect} />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <ErpNeumorphicCard className="p-4 sm:p-5"><TrendChart /></ErpNeumorphicCard>
        <ErpNeumorphicCard className="p-4 sm:p-5">
          <h2 className="text-base font-black text-[var(--sds-text-primary)]">سلامت منابع</h2>
          <div className="mt-4"><SourceHealth compact /></div>
        </ErpNeumorphicCard>
      </div>
    </div>
  );
}

function VariantB({ onSelect }: { onSelect: SelectHandler }) {
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(19rem,0.85fr)_minmax(0,2.15fr)]">
      <aside className="space-y-4 xl:order-2">
        <ErpNeumorphicCard className="p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-[var(--sds-text-primary)]">نیازمند توجه</h2>
            <ErpBadge tone="danger">۴</ErpBadge>
          </div>
          <RecommendationRows onSelect={onSelect} limit={3} />
          <div className="mt-3"><ErpButton label="همه پیشنهادها" tone="neutral" variant="ghost" /></div>
        </ErpNeumorphicCard>
        <ErpNeumorphicCard className="p-4"><SourceHealth compact /></ErpNeumorphicCard>
      </aside>
      <section className="space-y-4 xl:order-1">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(16rem,0.75fr)]">
          <ErpNeumorphicCard className="p-4 sm:p-5"><TrendChart /></ErpNeumorphicCard>
          <MetricButtons onSelect={onSelect} stacked />
        </div>
        <ErpNeumorphicCard className="p-4">
          <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--sds-text-secondary)]">
            <strong className="text-[var(--sds-text-primary)]">تصویر دوره:</strong>
            <span>۱۲ قرارداد قطعی</span><span>·</span><span>۲۱ قرارداد باز</span><span>·</span><span>۴ تعدیل</span><span>·</span><span>۳ قرارداد از دست‌رفته</span>
          </div>
        </ErpNeumorphicCard>
      </section>
    </div>
  );
}

const lifecycle = [
  { title: 'فرصت', value: '۳۲ فعال', detail: '۷ پیگیری معوق', icon: FaProjectDiagram, tone: 'info' as const },
  { title: 'قرارداد', value: '۹٫۶ میلیارد', detail: '۲۱ در پایپ‌لاین', icon: FaFileContract, tone: 'primary' as const },
  { title: 'وصول', value: '۴٫۱ میلیارد', detail: '۳ وصول معوق', icon: FaMoneyCheckAlt, tone: 'warning' as const },
  { title: 'تحویل و خروج', value: '۵ ریسک', detail: '۲ عدم تطبیق', icon: FaTruck, tone: 'danger' as const },
];

function VariantC({ onSelect }: { onSelect: SelectHandler }) {
  return (
    <div className="space-y-4">
      <ErpNeumorphicCard className="overflow-hidden p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-black text-[var(--sds-text-primary)]">زنجیره تجاری امروز</h2>
          <ErpBadge tone="warning">۱۶ نشانه</ErpBadge>
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-4">
          {lifecycle.map((stage, index) => {
            const Icon = stage.icon;
            return (
              <div key={stage.title} className="flex min-w-0 items-center gap-2">
                <ErpNeumorphicInteractiveCard
                  onClick={() => onSelect(`مرحله زنجیره: ${stage.title}`)}
                  className="flex min-h-32 min-w-0 flex-1 flex-col items-start justify-between p-4 text-right"
                >
                  <span className={`sds-tone-${stage.tone} sds-tone-surface inline-flex h-10 w-10 items-center justify-center rounded-xl`}><Icon className="h-4 w-4" /></span>
                  <span><span className="block text-xs text-[var(--sds-text-muted)]">{stage.title}</span><strong className="mt-1 block text-lg text-[var(--sds-text-primary)]">{stage.value}</strong><span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{stage.detail}</span></span>
                </ErpNeumorphicInteractiveCard>
                {index < lifecycle.length - 1 && <FaArrowLeft className="hidden h-4 w-4 shrink-0 text-[var(--sds-text-muted)] lg:block" aria-hidden="true" />}
              </div>
            );
          })}
        </div>
      </ErpNeumorphicCard>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <ErpNeumorphicCard className="p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-black text-[var(--sds-text-primary)]">اولویت‌های زنجیره</h2>
            <FaClipboardCheck className="h-5 w-5 text-[var(--sds-accent)]" />
          </div>
          <RecommendationRows onSelect={onSelect} />
        </ErpNeumorphicCard>
        <div className="space-y-4">
          <ErpNeumorphicCard className="p-4 sm:p-5"><TrendChart condensed /></ErpNeumorphicCard>
          <ErpNeumorphicCard className="p-4"><SourceHealth /></ErpNeumorphicCard>
        </div>
      </div>
      <section aria-label="چهار شاخص اصلی" className="sr-only">
        {metrics.map((metric) => <span key={metric.id}>{metric.label}: {metric.value}</span>)}
      </section>
    </div>
  );
}

function PrototypeSwitcher({ current }: { current: VariantKey }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const index = variants.findIndex((item) => item.key === current);

  const go = (delta: number) => {
    const next = variants[(index + delta + variants.length) % variants.length];
    const params = new URLSearchParams(searchParams.toString());
    params.set('prototype', '1');
    params.set('variant', next.key);
    router.replace(`/dashboard/bi?${params.toString()}`, { scroll: false });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); go(1); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  return (
    <div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-text-primary)] p-1.5 text-[var(--sds-text-inverse)] shadow-[var(--sds-shadow-overlay)]">
      <ErpPressable onClick={() => go(-1)} aria-label="طرح قبلی" className="flex h-11 w-11 items-center justify-center rounded-full outline-none hover:bg-[var(--sds-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"><FaArrowRight /></ErpPressable>
      <span className="min-w-36 text-center text-xs font-bold">{current} — {variants[index].name}</span>
      <ErpPressable onClick={() => go(1)} aria-label="طرح بعدی" className="flex h-11 w-11 items-center justify-center rounded-full outline-none hover:bg-[var(--sds-surface-overlay)] focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"><FaArrowLeft /></ErpPressable>
    </div>
  );
}

export default function BiWorkspacePrototype({ fallback }: { fallback: ReactNode }) {
  const searchParams = useSearchParams();
  const enabled = searchParams.get('prototype') === '1';
  const requested = searchParams.get('variant')?.toUpperCase();
  const variant = (variants.some((item) => item.key === requested) ? requested : 'A') as VariantKey;
  const [selected, setSelected] = useState('هیچ مدرکی انتخاب نشده است');
  const content = useMemo(() => {
    if (variant === 'B') return <VariantB onSelect={setSelected} />;
    if (variant === 'C') return <VariantC onSelect={setSelected} />;
    return <VariantA onSelect={setSelected} />;
  }, [variant]);

  if (!enabled) return fallback;

  return (
    <main dir="rtl" className="sds-workspace min-h-screen pb-24 text-right">
      <div className="mx-auto max-w-[1500px] space-y-4">
        <CommandHeader selected={selected} />
        {content}
      </div>
      <PrototypeSwitcher current={variant} />
    </main>
  );
}
