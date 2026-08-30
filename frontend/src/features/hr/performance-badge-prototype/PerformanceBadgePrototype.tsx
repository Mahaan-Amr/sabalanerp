"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { FaFilter, FaHistory, FaInfoCircle, FaTimes } from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpField,
  ErpInput,
  ErpPage,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
} from "@/components/erp";

export type PerformanceBadgeVariant = "A" | "B" | "C";
export type PerformanceLevelId =
  | "urgent"
  | "improve"
  | "meets"
  | "exceeds"
  | "outstanding"
  | "unevaluated"
  | "renew";

type PerformanceLevel = {
  id: PerformanceLevelId;
  label: string;
  fantasyLabel?: string;
  meaning: string;
  tone:
    | "danger"
    | "warning"
    | "success"
    | "info"
    | "primary"
    | "purple"
    | "neutral";
};

const levels: Record<PerformanceLevelId, PerformanceLevel> = {
  urgent: {
    id: "urgent",
    label: "نیازمند بهبود فوری",
    fantasyLabel: "عقیق",
    meaning: "عملکرد مصوب به‌طور جدی پایین‌تر از انتظارهای نقش بوده است.",
    tone: "danger",
  },
  improve: {
    id: "improve",
    label: "نیازمند بهبود",
    fantasyLabel: "کهربا",
    meaning: "عملکرد مصوب در بخشی از انتظارهای نقش نیازمند بهبود است.",
    tone: "warning",
  },
  meets: {
    id: "meets",
    label: "مطابق انتظار",
    fantasyLabel: "زمرد",
    meaning: "عملکرد مصوب با انتظارهای نقش هم‌خوان است.",
    tone: "success",
  },
  exceeds: {
    id: "exceeds",
    label: "فراتر از انتظار",
    fantasyLabel: "یاقوت",
    meaning: "عملکرد مصوب در مجموع فراتر از انتظارهای نقش بوده است.",
    tone: "primary",
  },
  outstanding: {
    id: "outstanding",
    label: "عملکرد برجسته",
    fantasyLabel: "الماس",
    meaning:
      "عملکرد مصوب به‌شکلی پایدار و برجسته فراتر از انتظارهای نقش بوده است.",
    tone: "purple",
  },
  unevaluated: {
    id: "unevaluated",
    label: "ارزیابی‌نشده",
    meaning: "هنوز نتیجه مصوب امتیازداری برای این رابطه استخدامی وجود ندارد.",
    tone: "neutral",
  },
  renew: {
    id: "renew",
    label: "نیازمند ارزیابی جدید",
    meaning: "اعتبار همه نتایج مؤثر پایان یافته و ارزیابی تازه لازم است.",
    tone: "neutral",
  },
};

const people = [
  {
    id: "1",
    name: "سارا احمدی",
    employee: "پرسنلی ۱۰۲۴",
    position: "سرپرست برنامه‌ریزی",
    unit: "برنامه‌ریزی",
    level: levels.outstanding,
    decreased: false,
  },
  {
    id: "2",
    name: "علی رضایی",
    employee: "پرسنلی ۱۰۸۷",
    position: "کارشناس فروش",
    unit: "فروش",
    level: levels.exceeds,
    decreased: true,
  },
  {
    id: "3",
    name: "مریم کریمی",
    employee: "پرسنلی ۱۱۲۰",
    position: "کارشناس منابع انسانی",
    unit: "منابع انسانی",
    level: levels.meets,
    decreased: false,
  },
  {
    id: "4",
    name: "حسین محمدی",
    employee: "پرسنلی ۱۱۷۳",
    position: "کارشناس انبار",
    unit: "موجودی",
    level: levels.improve,
    decreased: true,
  },
  {
    id: "5",
    name: "نگار حسینی",
    employee: "پرسنلی ۱۲۱۴",
    position: "حسابدار",
    unit: "حسابداری",
    level: levels.urgent,
    decreased: false,
  },
  {
    id: "6",
    name: "رضا اکبری",
    employee: "پرسنلی ۱۲۶۸",
    position: "کارشناس پشتیبانی",
    unit: "پشتیبانی",
    level: levels.unevaluated,
    decreased: false,
  },
  {
    id: "7",
    name: "الهام مرادی",
    employee: "پرسنلی ۱۳۰۱",
    position: "کارشناس لجستیک",
    unit: "لجستیک",
    level: levels.renew,
    decreased: false,
  },
];

const rankBadgeAssets: Partial<
  Record<PerformanceLevelId, { light: string; dark: string }>
> = {
  urgent: {
    light: "/assets/performance-rank-badges-v2/light/agate-v2.png",
    dark: "/assets/performance-rank-badges-v2/dark/agate.png",
  },
  improve: {
    light: "/assets/performance-rank-badges-v2/light/amber-v2.png",
    dark: "/assets/performance-rank-badges-v2/dark/amber.png",
  },
  meets: {
    light: "/assets/performance-rank-badges-v2/light/emerald-v2.png",
    dark: "/assets/performance-rank-badges-v2/dark/emerald-v2.png",
  },
  exceeds: {
    light: "/assets/performance-rank-badges-v2/light/ruby.png",
    dark: "/assets/performance-rank-badges-v2/dark/ruby.png",
  },
  outstanding: {
    light: "/assets/performance-rank-badges-v2/light/diamond.png",
    dark: "/assets/performance-rank-badges-v2/dark/diamond.png",
  },
  unevaluated: {
    light: "/assets/performance-rank-badges-v2/light/neutral-frame.png",
    dark: "/assets/performance-rank-badges-v2/dark/neutral-frame.png",
  },
  renew: {
    light: "/assets/performance-rank-badges-v2/light/neutral-frame.png",
    dark: "/assets/performance-rank-badges-v2/dark/neutral-frame.png",
  },
};

function PerformanceJewelIcon({
  level,
  large = false,
}: {
  level: PerformanceLevel;
  large?: boolean;
}) {
  const size = large ? "h-28 w-28" : "h-14 w-14";
  const assets = rankBadgeAssets[level.id];
  const needsEvaluation = level.id === "unevaluated" || level.id === "renew";
  return (
    <span className={`${size} relative block shrink-0`} aria-hidden="true">
      {assets ? (
        <>
          <Image
            src={assets.light}
            alt=""
            fill
            sizes={large ? "112px" : "56px"}
            className="object-contain dark:hidden"
            unoptimized
          />
          <Image
            src={assets.dark}
            alt=""
            fill
            sizes={large ? "112px" : "56px"}
            className="hidden object-contain dark:block"
            unoptimized
          />
        </>
      ) : (
        <span className="absolute inset-[18%] border-2 border-[var(--sds-border-strong)] bg-[var(--sds-surface-subtle)] [clip-path:polygon(50%_0,94%_25%,94%_75%,50%_100%,6%_75%,6%_25%)]" />
      )}
      {needsEvaluation && (
        <span className="absolute inset-0 flex items-center justify-center text-[var(--sds-text-muted)] drop-shadow-sm">
          <FaTimes className={large ? "h-10 w-10" : "h-5 w-5"} />
        </span>
      )}
    </span>
  );
}

function CompactPerformanceBadge({
  level,
  onOpen,
  showLabel = true,
}: {
  level: PerformanceLevel;
  onOpen: () => void;
  showLabel?: boolean;
}) {
  const displayLabel = level.fantasyLabel || level.label;
  return (
    <ErpPressable
      type="button"
      onClick={onOpen}
      aria-label={`سطح عملکرد: ${level.label}؛ مشاهده جزئیات`}
      tone={level.tone}
      variant="ghost"
      className="min-h-12 whitespace-nowrap px-1"
    >
      <span className="inline-flex min-w-14 flex-col items-center justify-center gap-0.5 py-0.5">
        <PerformanceJewelIcon level={level} />
        {showLabel && (
          <span className="text-xs font-black text-[var(--sds-text-primary)]">
            {displayLabel}
          </span>
        )}
      </span>
    </ErpPressable>
  );
}

export function PersonnelPerformanceBadgePrototype({
  levelId,
  onOpen,
}: {
  levelId: PerformanceLevelId;
  onOpen: () => void;
}) {
  return (
    <CompactPerformanceBadge
      level={levels[levelId]}
      onOpen={onOpen}
    />
  );
}

function LevelDetails({ level }: { level: PerformanceLevel }) {
  const displayLabel = level.fantasyLabel || level.label;
  return (
    <div className="space-y-4" dir="rtl">
      <ErpCard tone={level.tone} className="flex items-center gap-3 p-4">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-[var(--sds-text-secondary)]">
            نام نمایشی پیشنهادی
          </p>
          <p className="mt-1 text-lg font-black text-[var(--sds-text-primary)]">
            {displayLabel}
          </p>
          <p className="mt-1 text-xs font-semibold text-[var(--sds-text-muted)]">
            نام رسمی فعلی: {level.label}
          </p>
        </div>
        <PerformanceJewelIcon level={level} large />
      </ErpCard>
      <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">
        {level.meaning}
      </p>
      <dl className="grid gap-3 sm:grid-cols-2">
        <ErpCard className="p-3">
          <dt className="text-xs text-[var(--sds-text-muted)]">
            پایان تازه‌ترین بازه سنجش
          </dt>
          <dd className="mt-1 text-sm font-bold">۳۱ مرداد ۱۴۰۵</dd>
        </ErpCard>
        <ErpCard className="p-3">
          <dt className="text-xs text-[var(--sds-text-muted)]">
            بازبینی بعدی محاسبه
          </dt>
          <dd className="mt-1 text-sm font-bold">۳۰ آبان ۱۴۰۵</dd>
        </ErpCard>
      </dl>
      <p className="flex items-start gap-2 text-xs leading-6 text-[var(--sds-text-muted)]">
        <FaInfoCircle className="mt-1 shrink-0" aria-hidden="true" />
        نتیجه مصوب تازه می‌تواند پیش از این تاریخ سطح را تغییر دهد.
      </p>
    </div>
  );
}

export function PerformanceBadgeHeaderPrototype({
  variant,
}: {
  variant: PerformanceBadgeVariant;
}) {
  const [open, setOpen] = useState(false);
  const level = levels.exceeds;
  return (
    <>
      <div className="flex items-center gap-2" data-performance-badge-prototype>
        {variant === "B" && (
          <span className="hidden text-xs font-semibold text-[var(--sds-text-muted)] md:inline">
            سطح من
          </span>
        )}
        <CompactPerformanceBadge
          level={level}
          onOpen={() => setOpen(true)}
          showLabel={false}
        />
      </div>
      <ErpSheet
        open={open}
        onClose={() => setOpen(false)}
        title="خلاصه شخصی سطح عملکرد"
        presentation="modal"
      >
        <LevelDetails level={level} />
      </ErpSheet>
    </>
  );
}

function Filters({
  analysis,
  setAnalysis,
}: {
  analysis: boolean;
  setAnalysis: (value: boolean) => void;
}) {
  return (
    <ErpCard className="grid gap-3 p-3 md:grid-cols-[minmax(0,1fr)_220px_auto] md:items-end">
      <ErpField label="جست‌وجوی پرسنل">
        <ErpInput placeholder="نام، شماره پرسنلی یا جایگاه" />
      </ErpField>
      <ErpField label="سطح عملکرد">
        <ErpSelect defaultValue="all">
          <option value="all">همه سطح‌ها</option>
          <option value="outstanding">عملکرد برجسته</option>
          <option value="exceeds">فراتر از انتظار</option>
          <option value="meets">مطابق انتظار</option>
          <option value="improve">نیازمند بهبود</option>
          <option value="urgent">نیازمند بهبود فوری</option>
          <option value="unevaluated">ارزیابی‌نشده</option>
          <option value="renew">نیازمند ارزیابی جدید</option>
        </ErpSelect>
      </ErpField>
      <ErpSegmentedControl
        value={analysis ? "analysis" : "list"}
        onChange={(value) => setAnalysis(value === "analysis")}
        options={[
          { value: "list", label: "فهرست" },
          { value: "analysis", label: "تحلیل نام‌دار" },
        ]}
      />
    </ErpCard>
  );
}

function DecreaseSignal() {
  return (
    <ErpBadge tone="warning" variant="outline">
      <span className="inline-flex items-center gap-1.5">
        <FaHistory aria-hidden="true" />
        کاهش سطح · نیازمند بازبینی
      </span>
    </ErpBadge>
  );
}

export default function PerformanceBadgePrototype() {
  const [analysis, setAnalysis] = useState(false);
  const [selected, setSelected] = useState<PerformanceLevel | null>(null);
  const sortedPeople = useMemo(() => people, []);

  return (
    <ErpPage
      eyebrow="Prototype موقت · منابع انسانی"
      title="نشان سطح عملکرد در فهرست پرسنل"
      description="مدال جواهری تطبیقی · قاب و سنگ سه‌بعدی متناسب با پوستهٔ روشن یا تیره نمایش داده می‌شوند."
      actions={[
        {
          label: "بازگشت به فهرست پرسنل",
          href: "/dashboard/hr/personnel",
          tone: "neutral",
        },
      ]}
    >
      <Filters analysis={analysis} setAnalysis={setAnalysis} />

      <ErpSection
        title="فهرست پرسنل"
        description="چیدمان مصوب ثابت است؛ مدال جواهری منتخب در سرآیند و فهرست استفاده می‌شود."
      >
        <div className="space-y-3 md:hidden">
          {sortedPeople.map((person) => (
            <ErpCard key={person.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{person.name}</p>
                  <p className="mt-1 text-xs text-[var(--sds-text-muted)]">
                    {person.employee} · {person.position}
                  </p>
                </div>
                <CompactPerformanceBadge
                  level={person.level}
                  onOpen={() => setSelected(person.level)}
                />
              </div>
              {analysis && person.decreased ? (
                <div className="mt-3">
                  <DecreaseSignal />
                </div>
              ) : null}
            </ErpCard>
          ))}
        </div>
        <div className="hidden overflow-x-auto rounded-xl border border-[var(--sds-border-subtle)] md:block">
          <div className="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_minmax(170px,1fr)_250px_210px] gap-3 border-b border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] px-4 py-3 text-xs font-bold text-[var(--sds-text-muted)]">
            <span>پرسنل</span>
            <span>جایگاه</span>
            <span>سطح عملکرد جاری</span>
            <span>{analysis ? "بازبینی" : "وضعیت استخدام"}</span>
          </div>
          <div className="divide-y divide-[var(--sds-border-subtle)]">
            {sortedPeople.map((person) => (
              <div
                key={person.id}
                className="grid min-w-[760px] grid-cols-[minmax(220px,1fr)_minmax(170px,1fr)_250px_210px] items-center gap-3 bg-[var(--sds-surface-panel)] p-4"
              >
                <div>
                  <p className="font-bold">{person.name}</p>
                  <p className="mt-1 text-xs text-[var(--sds-text-muted)]">
                    {person.employee}
                  </p>
                </div>
                <p className="text-sm text-[var(--sds-text-secondary)]">
                  {person.position}
                  <span className="block text-xs">{person.unit}</span>
                </p>
                <CompactPerformanceBadge
                  level={person.level}
                  onOpen={() => setSelected(person.level)}
                />
                {analysis && person.decreased ? (
                  <DecreaseSignal />
                ) : (
                  <ErpBadge tone="success">رابطه فعال</ErpBadge>
                )}
              </div>
            ))}
          </div>
        </div>
      </ErpSection>

      <ErpCard className="flex items-start gap-2 p-4 text-xs leading-6 text-[var(--sds-text-secondary)]">
        <FaFilter className="mt-1 shrink-0" aria-hidden="true" />
        مرتب‌سازی و فیلتر بر اساس سطح فقط در همین فهرست مجاز است. «کاهش سطح» فقط
        پس از انتخاب نمای تحلیل نام‌دار ظاهر می‌شود و در Badge شخصی یا مجوز ساده
        فهرست افشا نمی‌شود.
      </ErpCard>

      <ErpSheet
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        title="جزئیات سطح عملکرد"
        presentation="modal"
      >
        {selected ? <LevelDetails level={selected} /> : null}
      </ErpSheet>
    </ErpPage>
  );
}
