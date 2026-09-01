"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FaArchive,
  FaArrowLeft,
  FaArrowRight,
  FaCodeBranch,
  FaCalculator,
  FaCalendarAlt,
  FaCheckCircle,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaEye,
  FaHistory,
  FaLock,
  FaPlus,
  FaProjectDiagram,
  FaShieldAlt,
  FaTimesCircle,
} from "react-icons/fa";
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
  ErpSummaryGrid,
  ErpTextarea,
} from "@/components/erp";

type Variant = "A" | "B" | "C" | "D";
type PermissionProfile = "administrator" | "publisher" | "auditor";
type DetailTab = "definition" | "anchors" | "rules" | "history";
type GuidedStep = "identity" | "structure" | "anchors" | "rules" | "release";
type Dialog =
  | "simple"
  | "simpleNew"
  | "branch"
  | "review"
  | "editor"
  | "schedule"
  | "cancel"
  | "retire"
  | "impact"
  | "trace"
  | null;

const persianDateNumber = (value: string) => Number(value
  .replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
  .replace(/\D/g, ""));

const isFuturePersianDate = (value: string) => {
  const today = new Intl.DateTimeFormat("fa-IR-u-ca-persian", {
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return /^([۰-۹0-9]{4})\/[۰-۹0-9]{2}\/[۰-۹0-9]{2}$/.test(value.trim())
    && persianDateNumber(value) > persianDateNumber(today);
};

type Criterion = {
  id: string;
  title: string;
  code: string;
  version: string;
  lineage: string;
  category: string;
  weight: string;
  status: "پیش‌نویس" | "زمان‌بندی‌شده" | "فعال" | "بازنشسته";
  effective: string;
  evidence: string;
};

const variants: Array<{ id: Variant; label: string; short: string }> = [
  { id: "A", label: "کتابخانه و جزئیات", short: "معیارمحور" },
  { id: "B", label: "راهنمای ساخت نسخه", short: "گام‌محور" },
  { id: "C", label: "مرکز انتشار", short: "چرخه‌عمرمحور" },
  { id: "D", label: "مسیر ساده", short: "کارمحور" },
];

const criteria: Criterion[] = [
  {
    id: "quality",
    title: "کیفیت اجرای مسئولیت",
    code: "PERF-QLT-014",
    version: "۳",
    lineage: "شاخه از نسخه ۲",
    category: "کیفیت و دقت",
    weight: "۲۵٪",
    status: "پیش‌نویس",
    effective: "هنوز منتشر نشده",
    evidence: "حداقل ۱ شاهد قابل اتکا",
  },
  {
    id: "delivery",
    title: "تحویل به‌موقع تعهدها",
    code: "PERF-DLV-008",
    version: "۵",
    lineage: "جانشین نسخه ۴",
    category: "تعهد و نتیجه",
    weight: "۲۰٪",
    status: "زمان‌بندی‌شده",
    effective: "۱۴۰۵/۰۷/۰۱",
    evidence: "ارجاع عملیاتی یا مشاهده ساختاریافته",
  },
  {
    id: "teamwork",
    title: "همکاری حرفه‌ای",
    code: "PERF-COL-003",
    version: "۴",
    lineage: "جانشین نسخه ۳",
    category: "رفتار حرفه‌ای",
    weight: "۱۵٪",
    status: "فعال",
    effective: "از ۱۴۰۵/۰۱/۰۱",
    evidence: "۲ مشاهده در بازه",
  },
  {
    id: "safety",
    title: "رعایت الزامات ایمنی",
    code: "PERF-SAF-011",
    version: "۲",
    lineage: "جانشین نسخه ۱",
    category: "انضباط عملیاتی",
    weight: "۲۰٪",
    status: "فعال",
    effective: "از ۱۴۰۴/۱۰/۰۱",
    evidence: "سند کنترل‌شده الزامی",
  },
  {
    id: "legacy",
    title: "ثبت منظم گزارش روزانه",
    code: "PERF-RPT-002",
    version: "۱",
    lineage: "نسخه آغازین",
    category: "مستندسازی",
    weight: "۱۰٪",
    status: "بازنشسته",
    effective: "بازنشسته در ۱۴۰۵/۰۱/۰۱",
    evidence: "ارجاع گزارش روزانه",
  },
];

const anchors = [
  {
    score: "۱",
    label: "به‌طور جدی پایین‌تر از انتظار",
    text: "خروجی مکرراً نیازمند بازکاری اساسی است و مسئولیت‌های روشن‌شده کامل نمی‌شوند.",
  },
  {
    score: "۲",
    label: "پایین‌تر از انتظار",
    text: "بخشی از خروجی با تأخیر یا خطا تحویل می‌شود و اصلاح مستقیم سرپرست لازم است.",
  },
  {
    score: "۳",
    label: "مطابق انتظار",
    text: "مسئولیت‌های تعریف‌شده با کیفیت و زمان مورد انتظار انجام می‌شوند.",
  },
  {
    score: "۴",
    label: "بالاتر از انتظار",
    text: "خروجی پایدارتر از انتظار است و پیش از ایجاد مسئله، اقدام اصلاحی مناسب انجام می‌شود.",
  },
  {
    score: "۵",
    label: "به‌طور استثنایی بالاتر از انتظار",
    text: "در موقعیت‌های دشوار، نتیجه‌ای ممتاز و قابل‌تکرار می‌سازد و کیفیت کار جمع را بالا می‌برد.",
  },
];

const statusTone = (status: Criterion["status"]) =>
  status === "فعال"
    ? "success"
    : status === "زمان‌بندی‌شده"
      ? "info"
      : status === "پیش‌نویس"
        ? "warning"
        : "neutral";

function PermissionPreview({
  profile,
  onChange,
}: {
  profile: PermissionProfile;
  onChange: (value: PermissionProfile) => void;
}) {
  const traceAllowed = profile !== "publisher";
  const editAllowed = profile !== "auditor";
  return (
    <ErpCard
      tone="info"
      className="grid gap-4 p-4 lg:grid-cols-[minmax(240px,0.65fr)_minmax(0,1fr)] lg:items-end"
    >
      <ErpField label="پروفایل نمایشی مجوز مؤثر">
        <ErpSelect
          value={profile}
          onChange={(event) =>
            onChange(event.target.value as PermissionProfile)
          }
        >
          <option value="administrator">
            مدیریت معیار و سیاست + ردپای محاسبه
          </option>
          <option value="publisher">مدیریت و انتشار، بدون داده محرمانه</option>
          <option value="auditor">مشاهده فقط‌خواندنی و ردپای محاسبه</option>
        </ErpSelect>
      </ErpField>
      <div>
        <div className="flex flex-wrap gap-2">
          <ErpBadge tone={editAllowed ? "success" : "neutral"}>
            {editAllowed ? "ساخت و ویرایش پیش‌نویس" : "فقط‌خواندنی"}
          </ErpBadge>
          <ErpBadge tone={editAllowed ? "success" : "neutral"}>
            زمان‌بندی و بازنشستگی
          </ErpBadge>
          <ErpBadge tone={traceAllowed ? "success" : "neutral"}>
            {traceAllowed ? "ردپای محاسبه مجاز" : "جزئیات Personnel پنهان"}
          </ErpBadge>
        </div>
        <p className="mt-2 text-xs leading-6 text-[var(--sds-text-secondary)]">
          این انتخاب فقط مرز مجوزها را در Prototype شبیه‌سازی می‌کند؛ عنوان شغلی
          یا سازمانی هیچ دسترسی‌ای ایجاد نمی‌کند.
        </p>
      </div>
    </ErpCard>
  );
}

function CriterionList({
  selected,
  onSelect,
  compact = false,
}: {
  selected: string;
  onSelect: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className="space-y-2">
      {criteria.map((criterion) => (
        <ErpPressable
          key={criterion.id}
          type="button"
          onClick={() => onSelect(criterion.id)}
          tone={selected === criterion.id ? "primary" : "neutral"}
          variant={selected === criterion.id ? "soft" : "ghost"}
          className="w-full p-3 text-right"
        >
          <span className="flex items-start justify-between gap-3">
            <span className="min-w-0">
              <span className="block font-bold">{criterion.title}</span>
              <span
                className="mt-1 block text-xs text-[var(--sds-text-muted)]"
                dir="ltr"
              >
                {criterion.code} · v{criterion.version}
              </span>
              {!compact ? (
                <span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">
                  {criterion.category} · وزن {criterion.weight}
                </span>
              ) : null}
            </span>
            <ErpBadge tone={statusTone(criterion.status)} variant="outline">
              {criterion.status}
            </ErpBadge>
          </span>
        </ErpPressable>
      ))}
    </div>
  );
}

function AnchorList({
  editable,
  onDraftChange,
}: {
  editable: boolean;
  onDraftChange?: () => void;
}) {
  return (
    <div className="space-y-3">
      {anchors.map((anchor) => (
        <ErpCard
          key={anchor.score}
          className="grid gap-3 p-4 md:grid-cols-[180px_minmax(0,1fr)]"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--sds-accent-soft)] font-black text-[var(--sds-accent-on-soft)]">
              {anchor.score}
            </span>
            <p className="text-sm font-bold leading-6">{anchor.label}</p>
          </div>
          {editable ? (
            <ErpTextarea
              defaultValue={anchor.text}
              aria-label={`توضیح درجه ${anchor.score}`}
              rows={2}
              onChange={onDraftChange}
            />
          ) : (
            <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">
              {anchor.text}
            </p>
          )}
        </ErpCard>
      ))}
    </div>
  );
}

function ValidationPanel() {
  return (
    <ErpCard tone="warning" className="space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="font-bold">آمادگی انتشار</p>
        <ErpBadge tone="warning">۲ مانع</ErpBadge>
      </div>
      <ul className="space-y-2 text-sm leading-7">
        <li className="flex gap-2">
          <FaTimesCircle className="mt-1.5 shrink-0" aria-hidden="true" />
          <span>
            جمع وزن معیارهای «کیفیت و دقت» برابر ۹۵٪ است؛ باید دقیقاً ۱۰۰٪ شود.
          </span>
        </li>
        <li className="flex gap-2">
          <FaTimesCircle className="mt-1.5 shrink-0" aria-hidden="true" />
          <span>
            برای درجه ۵ معیار «دقت ثبت» توضیح رفتاری اختصاصی نوشته نشده است.
          </span>
        </li>
        <li className="flex gap-2">
          <FaCheckCircle className="mt-1.5 shrink-0" aria-hidden="true" />
          <span>
            قواعد کاربردپذیری فقط از واقعیت‌های Snapshot استفاده می‌کنند.
          </span>
        </li>
        <li className="flex gap-2">
          <FaCheckCircle className="mt-1.5 shrink-0" aria-hidden="true" />
          <span>حداقل شاهد و بازه نگاه‌به‌عقب مشخص است.</span>
        </li>
      </ul>
    </ErpCard>
  );
}

type VariantProps = {
  selected: Criterion;
  selectedId: string;
  onSelect: (id: string) => void;
  profile: PermissionProfile;
  open: (dialog: Dialog) => void;
};

function LibraryVariant({
  selected,
  selectedId,
  onSelect,
  profile,
  open,
}: VariantProps) {
  const [tab, setTab] = useState<DetailTab>("definition");
  const editable = profile !== "auditor" && selected.status === "پیش‌نویس";
  return (
    <div className="grid gap-5 2xl:grid-cols-[360px_minmax(0,1fr)]">
      <ErpSection
        title="کتابخانه معیارها"
        description="هر مفهوم یک هویت پایدار و نسخه‌های تغییرناپذیر دارد."
        actions={
          profile !== "auditor"
            ? [
                {
                  label: "معیار تازه",
                  icon: FaPlus,
                  onClick: () => open("editor"),
                  tone: "primary",
                  variant: "solid",
                },
              ]
            : []
        }
      >
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
          <ErpField label="جست‌وجو">
            <ErpInput placeholder="نام یا شناسه معیار" />
          </ErpField>
          <ErpField label="وضعیت نسخه">
            <ErpSelect defaultValue="all">
              <option value="all">همه وضعیت‌ها</option>
              <option>پیش‌نویس</option>
              <option>زمان‌بندی‌شده</option>
              <option>فعال</option>
              <option>بازنشسته</option>
            </ErpSelect>
          </ErpField>
        </div>
        <div className="mt-4">
          <CriterionList selected={selectedId} onSelect={onSelect} />
        </div>
      </ErpSection>
      <div className="space-y-5">
        <ErpCard className="p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-xl font-black">{selected.title}</h2>
                <ErpBadge tone={statusTone(selected.status)}>
                  {selected.status}
                </ErpBadge>
              </div>
              <p
                className="mt-2 text-sm text-[var(--sds-text-muted)]"
                dir="ltr"
              >
                {selected.code} · v{selected.version}
              </p>
              <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">
                {selected.lineage} · {selected.effective}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {selected.status === "فعال" && profile !== "auditor" ? (
                <ErpButton
                  label="ساخت نسخه تازه"
                  icon={FaCodeBranch}
                  onClick={() => open("editor")}
                  tone="primary"
                  variant="outline"
                />
              ) : null}
              {editable ? (
                <ErpButton
                  label="ادامه ویرایش"
                  onClick={() => open("editor")}
                  tone="primary"
                  variant="solid"
                />
              ) : null}
            </div>
          </div>
          <div className="mt-5">
            <ErpSegmentedControl
              value={tab}
              onChange={setTab}
              options={[
                { value: "definition", label: "تعریف و وزن" },
                { value: "anchors", label: "پنج توصیف" },
                { value: "rules", label: "کاربرد و شاهد" },
                { value: "history", label: "نسخه‌ها" },
              ]}
            />
          </div>
        </ErpCard>
        {tab === "definition" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <ErpSection title="جایگاه در الگو">
              <ErpSummaryGrid
                columns={2}
                items={[
                  { label: "دسته", value: selected.category },
                  { label: "وزن در دسته", value: selected.weight },
                  { label: "سهم الگوی Job", value: "۸۰٪" },
                  {
                    label: "افزوده Position",
                    value: "۲۰٪",
                    hint: "معیار پایه را حذف نمی‌کند",
                  },
                ]}
              />
            </ErpSection>
            <ValidationPanel />
          </div>
        ) : null}
        {tab === "anchors" ? (
          <ErpSection
            title="توصیف رفتاری پنج درجه"
            description="هر درجه معنای فارسی اختصاصی دارد؛ صفر با بی‌پاسخ یا نامرتبط یکی نیست."
          >
            <AnchorList editable={editable} />
          </ErpSection>
        ) : null}
        {tab === "rules" ? (
          <div className="grid gap-5 lg:grid-cols-2">
            <ErpSection title="کاربردپذیری">
              <ul className="space-y-3 text-sm leading-7">
                <li>
                  Job یکی از «کارشناس برنامه‌ریزی» یا «سرپرست برنامه‌ریزی» باشد.
                </li>
                <li>نوع مأموریت «عملیاتی» باشد.</li>
                <li>
                  اگر واقعیت لازم در Snapshot مفقود است، ارزیابی متوقف شود.
                </li>
                <li>
                  درخواست نامرتبط‌بودن به دلیل و تأیید منابع انسانی نیاز دارد.
                </li>
              </ul>
            </ErpSection>
            <ErpSection title="نیاز شاهد">
              <ErpSummaryGrid
                items={[
                  { label: "حداقل", value: selected.evidence },
                  { label: "کیفیت قابل قبول", value: "قابل اتکا" },
                  { label: "بازه رخداد", value: "هم‌پوشان با بخش مأموریت" },
                  { label: "اصلاح", value: "نسخه تازه؛ سابقه محفوظ" },
                ]}
              />
            </ErpSection>
          </div>
        ) : null}
        {tab === "history" ? (
          <ErpSection title="نسب نسخه‌ها">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <ErpBadge tone="neutral">نسخه ۱ · بازنشسته</ErpBadge>
              <FaArrowLeft aria-hidden="true" />
              <ErpBadge tone="neutral">نسخه ۲ · بازنشسته</ErpBadge>
              <FaArrowLeft aria-hidden="true" />
              <ErpBadge tone={statusTone(selected.status)}>
                نسخه {selected.version} · {selected.status}
              </ErpBadge>
            </div>
            <p className="mt-4 text-sm leading-7 text-[var(--sds-text-secondary)]">
              نسخه تازه فقط ارزیابی‌های آینده را تغییر می‌دهد؛ هیچ Snapshot یا
              نتیجه تاریخی بازنویسی نمی‌شود.
            </p>
          </ErpSection>
        ) : null}
      </div>
    </div>
  );
}

function GuidedVariant({
  selected,
  selectedId,
  onSelect,
  profile,
  open,
}: VariantProps) {
  const [step, setStep] = useState<GuidedStep>("structure");
  const steps: Array<{ value: GuidedStep; label: string }> = [
    { value: "identity", label: "۱. هویت" },
    { value: "structure", label: "۲. دسته و وزن" },
    { value: "anchors", label: "۳. پنج توصیف" },
    { value: "rules", label: "۴. قواعد و شاهد" },
    { value: "release", label: "۵. انتشار" },
  ];
  return (
    <div className="space-y-5">
      <ErpCard className="grid gap-5 p-5 xl:grid-cols-[minmax(0,1fr)_300px]">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <ErpBadge tone="warning">پیش‌نویس</ErpBadge>
            <span className="text-xs text-[var(--sds-text-muted)]" dir="ltr">
              PERF-QLT-014 · v3
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-black">
            ساخت نسخه «کیفیت اجرای مسئولیت»
          </h2>
          <p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">
            هر گام یک قرارداد انتشار را کامل می‌کند؛ خروج آزاد است و پیش‌نویس در
            Prototype فقط در حافظه می‌ماند.
          </p>
        </div>
        <ErpSummaryGrid
          columns={2}
          items={[
            { label: "پیشرفت ساختاری", value: "۳ از ۵ گام" },
            { label: "مانع انتشار", value: "۲ مورد", tone: "warning" },
          ]}
        />
      </ErpCard>
      <div className="overflow-x-auto">
        <ErpSegmentedControl value={step} onChange={setStep} options={steps} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <ErpSection title={steps.find((item) => item.value === step)?.label}>
          {step === "identity" ? (
            <div className="grid gap-4 md:grid-cols-2">
              <ErpField label="هویت معیار">
                <ErpSelect
                  value={selectedId}
                  onChange={(event) => onSelect(event.target.value)}
                >
                  {criteria.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.title}
                    </option>
                  ))}
                </ErpSelect>
              </ErpField>
              <ErpField label="نوع تغییر">
                <ErpSelect defaultValue="branch">
                  <option value="branch">نسخه تازه از همین مفهوم</option>
                  <option value="new">مفهوم تازه با هویت مستقل</option>
                </ErpSelect>
              </ErpField>
              <ErpField label="نام فارسی">
                <ErpInput defaultValue={selected.title} />
              </ErpField>
              <ErpField label="دلیل نسخه تازه">
                <ErpInput defaultValue="شفاف‌کردن رفتار قابل مشاهده" />
              </ErpField>
            </div>
          ) : null}
          {step === "structure" ? (
            <div className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <ErpField label="دسته">
                  <ErpSelect defaultValue="quality">
                    <option value="quality">کیفیت و دقت</option>
                    <option>تعهد و نتیجه</option>
                    <option>رفتار حرفه‌ای</option>
                  </ErpSelect>
                </ErpField>
                <ErpField label="وزن دسته">
                  <ErpInput defaultValue="۴۰٫۰۰" inputMode="decimal" />
                </ErpField>
                <ErpField label="وزن معیار">
                  <ErpInput defaultValue="۲۵٫۰۰" inputMode="decimal" />
                </ErpField>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[var(--sds-border-subtle)]">
                <table className="w-full min-w-[620px] text-right text-sm">
                  <thead className="bg-[var(--sds-surface-subtle)]">
                    <tr>
                      <th className="p-3">معیار</th>
                      <th>وزن</th>
                      <th>وضعیت</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-[var(--sds-border-subtle)]">
                      <td className="p-3">کیفیت اجرای مسئولیت</td>
                      <td>۲۵٪</td>
                      <td>
                        <ErpBadge tone="success">کامل</ErpBadge>
                      </td>
                    </tr>
                    <tr className="border-t border-[var(--sds-border-subtle)]">
                      <td className="p-3">دقت ثبت</td>
                      <td>۳۰٪</td>
                      <td>
                        <ErpBadge tone="warning">توصیف ناقص</ErpBadge>
                      </td>
                    </tr>
                    <tr className="border-t border-[var(--sds-border-subtle)]">
                      <td className="p-3">پیشگیری از خطا</td>
                      <td>۴۰٪</td>
                      <td>
                        <ErpBadge tone="success">کامل</ErpBadge>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
          {step === "anchors" ? (
            <AnchorList editable={profile !== "auditor"} />
          ) : null}
          {step === "rules" ? (
            <div className="space-y-4">
              <ErpField label="واقعیت‌های مجاز Snapshot">
                <ErpSelect defaultValue="job">
                  <option value="job">Job و نوع مأموریت</option>
                  <option>واحد و محل</option>
                  <option>شیفت و مسئولیت</option>
                </ErpSelect>
              </ErpField>
              <ErpField label="شرط کنترل‌شده">
                <ErpInput defaultValue="Job در خانواده برنامه‌ریزی باشد" />
              </ErpField>
              <ErpField label="سیاست شاهد">
                <ErpTextarea
                  defaultValue="حداقل یک شاهد قابل اتکا، هم‌پوشان با بخش مأموریت؛ مشاهده ساختاریافته یا ارجاع تغییرناپذیر عملیاتی."
                  rows={3}
                />
              </ErpField>
            </div>
          ) : null}
          {step === "release" ? (
            <div className="space-y-4">
              <ValidationPanel />
              <ErpCard tone="info" className="p-4 text-sm leading-7">
                <p className="font-bold">اثر این انتشار</p>
                <p className="mt-1">
                  این نسخه معیار فقط در Snapshot ارزیابی‌هایی که از تاریخ اثر
                  آغاز می‌شوند قرار می‌گیرد. ارزیابی‌های باز، نتایج مصوب و
                  Badgeهای جاری تغییر نمی‌کنند.
                </p>
              </ErpCard>
              <div className="flex flex-wrap gap-2">
                {profile !== "auditor" ? (
                  <ErpButton
                    label="زمان‌بندی نسخه"
                    icon={FaCalendarAlt}
                    onClick={() => open("schedule")}
                    tone="primary"
                    variant="solid"
                  />
                ) : null}
                <ErpButton
                  label="مشاهده نسب نسخه"
                  icon={FaProjectDiagram}
                  onClick={() => open("editor")}
                  tone="neutral"
                  variant="outline"
                />
              </div>
            </div>
          ) : null}
        </ErpSection>
        <aside className="space-y-4">
          <ValidationPanel />
          <ErpSection title="نمونه زنده">
            <ErpSummaryGrid
              columns={2}
              items={[
                { label: "نگاشت درجه ۳", value: "۵۰ از ۱۰۰" },
                { label: "وزن اصلی", value: "۲۵٪" },
                {
                  label: "وزن مؤثر نمونه",
                  value: "۲۶٫۳۱۵۷۸۹٪",
                  hint: "پس از نامرتبط‌شدن یک معیار",
                },
              ]}
            />
            <ErpButton
              label="دیدن ردپای محاسبه"
              icon={FaCalculator}
              onClick={() => open("trace")}
              tone="neutral"
              variant="ghost"
              disabled={profile === "publisher"}
            />
          </ErpSection>
        </aside>
      </div>
    </div>
  );
}

function SimpleVariant({ selectedId, onSelect, profile, open }: VariantProps) {
  const [showHistory, setShowHistory] = useState(false);
  const openCriterion = (id: string) => {
    onSelect(id);
    open("simple");
  };
  return (
    <div className="space-y-5">
      <ErpCard className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black">معیارهای ارزیابی</h2>
          <p className="mt-1 text-sm leading-7 text-[var(--sds-text-secondary)]">
            معیارهای موجود را ببینید یا یک معیار تازه بسازید.
          </p>
        </div>
        {profile !== "auditor" ? (
          <ErpButton
            label="ساخت معیار جدید"
            icon={FaPlus}
            onClick={() => {
              onSelect("quality");
              open("simpleNew");
            }}
            tone="primary"
            variant="solid"
          />
        ) : (
          <ErpBadge tone="neutral">فقط‌خواندنی</ErpBadge>
        )}
      </ErpCard>

      <ErpField label="جست‌وجوی معیار">
        <ErpInput placeholder="مثلاً کیفیت یا همکاری" />
      </ErpField>

      {profile !== "auditor" ? (
        <ErpSection
          title="نیازمند تکمیل"
          description="فقط کارهایی که اکنون به توجه شما نیاز دارند."
        >
          <ErpPressable
            type="button"
            onClick={() => openCriterion("quality")}
            tone="warning"
            variant="soft"
            className="flex w-full flex-col gap-3 p-4 text-right sm:flex-row sm:items-center sm:justify-between"
          >
            <span>
              <span className="block font-bold">کیفیت اجرای مسئولیت</span>
              <span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">
                دو مورد مانده: جمع وزن‌ها و توضیح امتیاز عالی
              </span>
            </span>
            <span className="font-bold text-[var(--sds-accent)]">
              ادامه تکمیل
            </span>
          </ErpPressable>
        </ErpSection>
      ) : null}

      <ErpSection
        title={showHistory ? "سوابق معیارها" : "معیارهای آماده استفاده"}
        actions={[
          {
            label: showHistory ? "بازگشت به معیارهای جاری" : "سوابق",
            icon: showHistory ? FaArrowRight : FaHistory,
            onClick: () => setShowHistory((current) => !current),
            tone: "neutral",
            variant: "ghost",
          },
        ]}
      >
        {showHistory ? (
          <p className="mb-3 text-sm leading-7 text-[var(--sds-text-secondary)]">
            معیارهای بازنشسته فقط برای مراجعه و حسابرسی نگه‌داری می‌شوند و در
            ارزیابی تازه قابل انتخاب نیستند.
          </p>
        ) : null}
        <div className="overflow-hidden rounded-xl border border-[var(--sds-border-subtle)]">
          {criteria
            .filter((item) =>
              showHistory
                ? item.status === "بازنشسته"
                : item.status !== "پیش‌نویس" && item.status !== "بازنشسته",
            )
            .map((item) => (
              <ErpPressable
                key={item.id}
                type="button"
                onClick={() => openCriterion(item.id)}
                tone={selectedId === item.id ? "primary" : "neutral"}
                variant="ghost"
                className="flex w-full items-center justify-between gap-3 border-b border-[var(--sds-border-subtle)] p-4 text-right last:border-b-0"
              >
                <span>
                  <span className="block font-bold">{item.title}</span>
                  <span className="mt-1 block text-xs text-[var(--sds-text-muted)]">
                    {item.category} · {item.effective}
                  </span>
                </span>
                <ErpBadge tone={statusTone(item.status)} variant="outline">
                  {item.status}
                </ErpBadge>
              </ErpPressable>
            ))}
        </div>
      </ErpSection>
    </div>
  );
}

function LifecycleColumn({
  title,
  status,
  selectedId,
  onSelect,
}: {
  title: string;
  status: Criterion["status"];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const rows = criteria.filter((item) => item.status === status);
  return (
    <ErpCard className="min-h-52 p-3">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="font-bold">{title}</p>
        <ErpBadge tone={statusTone(status)}>
          {rows.length.toLocaleString("fa-IR")}
        </ErpBadge>
      </div>
      <div className="space-y-2">
        {rows.map((item) => (
          <ErpPressable
            key={item.id}
            type="button"
            onClick={() => onSelect(item.id)}
            tone={selectedId === item.id ? "primary" : "neutral"}
            variant={selectedId === item.id ? "soft" : "ghost"}
            className="w-full p-3 text-right"
          >
            <span className="block font-bold">{item.title}</span>
            <span className="mt-1 block text-xs text-[var(--sds-text-muted)]">
              نسخه {item.version} · {item.effective}
            </span>
          </ErpPressable>
        ))}
      </div>
    </ErpCard>
  );
}

function ReleaseVariant({
  selected,
  selectedId,
  onSelect,
  profile,
  open,
}: VariantProps) {
  return (
    <div className="space-y-5">
      <ErpSummaryGrid
        columns={3}
        items={[
          { label: "پیش‌نویس", value: "۱", tone: "warning" },
          { label: "زمان‌بندی‌شده", value: "۱", tone: "info" },
          { label: "فعال", value: "۲", tone: "success" },
          { label: "مانع انتشار", value: "۲", tone: "warning" },
        ]}
      />
      <ErpSection
        title="مسیر نسخه‌ها"
        description="نسخه‌ها جابه‌جا یا بازنویسی نمی‌شوند؛ هر تغییر یک رخداد دلیل‌دار می‌سازد."
      >
        <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-4">
          <LifecycleColumn
            title="پیش‌نویس"
            status="پیش‌نویس"
            selectedId={selectedId}
            onSelect={onSelect}
          />
          <LifecycleColumn
            title="زمان‌بندی‌شده"
            status="زمان‌بندی‌شده"
            selectedId={selectedId}
            onSelect={onSelect}
          />
          <LifecycleColumn
            title="فعال"
            status="فعال"
            selectedId={selectedId}
            onSelect={onSelect}
          />
          <LifecycleColumn
            title="بازنشسته"
            status="بازنشسته"
            selectedId={selectedId}
            onSelect={onSelect}
          />
        </div>
      </ErpSection>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,0.75fr)]">
        <ErpSection
          title={selected.title}
          description={`${selected.code} · نسخه ${selected.version} · ${selected.lineage}`}
        >
          <ErpSummaryGrid
            columns={3}
            items={[
              {
                label: "وضعیت",
                value: selected.status,
                tone: statusTone(selected.status),
              },
              { label: "اثر", value: selected.effective },
              {
                label: "دسته و وزن",
                value: `${selected.category} · ${selected.weight}`,
              },
              { label: "شاهد", value: selected.evidence },
              {
                label: "Snapshot تاریخی",
                value: "بدون تغییر",
                tone: "success",
              },
              { label: "ارزیابی باز", value: "بدون تغییر", tone: "success" },
            ]}
          />
          <div className="mt-5 flex flex-wrap gap-2">
            {profile !== "auditor" && selected.status === "پیش‌نویس" ? (
              <ErpButton
                label="اعتبارسنجی و زمان‌بندی"
                icon={FaClipboardCheck}
                onClick={() => open("schedule")}
                tone="primary"
                variant="solid"
              />
            ) : null}
            {profile !== "auditor" && selected.status === "زمان‌بندی‌شده" ? (
              <ErpButton
                label="لغو زمان‌بندی"
                icon={FaTimesCircle}
                onClick={() => open("cancel")}
                tone="danger"
                variant="outline"
              />
            ) : null}
            {profile !== "auditor" && selected.status === "فعال" ? (
              <ErpButton
                label="بازنشسته‌کردن"
                icon={FaArchive}
                onClick={() => open("retire")}
                tone="warning"
                variant="outline"
              />
            ) : null}
            <ErpButton
              label="تاریخچه نسخه"
              icon={FaHistory}
              onClick={() => open("editor")}
              tone="neutral"
              variant="ghost"
            />
          </div>
        </ErpSection>
        <div className="space-y-5">
          <ErpSection title="سیاست امتیازدهی سازمانی">
            <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">
              پیش‌نویس «تجمیع نتایج ۱۴۰۵/۳» وزن تازگی را تغییر می‌دهد و برخلاف
              نسخه معیار، Badgeهای جاری را باز‌محاسبه می‌کند.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <ErpButton
                label="پیش‌نمایش قطعی اثر"
                icon={FaEye}
                onClick={() => open("impact")}
                tone="primary"
                variant="solid"
              />
              <ErpBadge tone="warning">تأیید اثر لازم است</ErpBadge>
            </div>
          </ErpSection>
          <ErpSection title="بازسازی امتیاز">
            <p className="text-sm leading-7 text-[var(--sds-text-secondary)]">
              برای یک نتیجه مصوب، نسخه‌ها، درجات، وزن اصلی و مؤثر، نامرتبط‌بودن،
              جمع‌های میانی و مقدار دقیق را فقط‌خواندنی ببینید.
            </p>
            <div className="mt-4">
              <ErpButton
                label="بازکردن ردپای محاسبه"
                icon={FaCalculator}
                onClick={() => open("trace")}
                tone="neutral"
                variant="outline"
                disabled={profile === "publisher"}
              />
            </div>
          </ErpSection>
        </div>
      </div>
    </div>
  );
}

function CriterionEditorContent({
  selected,
  profile,
  draftFromActive = false,
  onDraftChange,
}: {
  selected: Criterion;
  profile: PermissionProfile;
  draftFromActive?: boolean;
  onDraftChange?: () => void;
}) {
  const readOnly =
    profile === "auditor" ||
    (selected.status !== "پیش‌نویس" && !draftFromActive);
  return (
    <div className="space-y-5">
      <ErpCard
        tone={readOnly ? "neutral" : "info"}
        className="p-4 text-sm leading-7"
      >
        <p className="font-bold">
          {draftFromActive
            ? `نسخه تازه بر پایه نسخه ${selected.version}`
            : readOnly
              ? "این نسخه و Snapshotهای استفاده‌کننده تغییرناپذیرند"
              : "تنها پیش‌نویس قابل ویرایش است"}
        </p>
        <p className="mt-1">
          {draftFromActive
            ? "نسخه فعال دست‌نخورده می‌ماند؛ تغییرات شما در یک پیش‌نویس تازه ذخیره می‌شوند."
            : "برای تغییر معنای همین مفهوم، نسخه تازه با پیوند نسب بسازید؛ برای معنای کسب‌وکاری متفاوت، هویت معیار تازه لازم است."}
        </p>
      </ErpCard>
      <div className="grid gap-4 md:grid-cols-2">
        <ErpField label="نام فارسی">
          <ErpInput
            defaultValue={selected.title}
            disabled={readOnly}
            onChange={onDraftChange}
          />
        </ErpField>
        <ErpField label="شناسه پایدار">
          <ErpInput defaultValue={selected.code} disabled dir="ltr" />
        </ErpField>
        <ErpField label="دسته">
          <ErpSelect
            defaultValue="quality"
            disabled={readOnly}
            onChange={onDraftChange}
          >
            <option value="quality">{selected.category}</option>
            <option>تعهد و نتیجه</option>
          </ErpSelect>
        </ErpField>
        <ErpField label="وزن">
          <ErpInput
            defaultValue={selected.weight.replace("٪", "")}
            disabled={readOnly}
            inputMode="decimal"
            onChange={onDraftChange}
          />
        </ErpField>
      </div>
      <AnchorList editable={!readOnly} onDraftChange={onDraftChange} />
    </div>
  );
}

function LifecycleActionContent({
  dialog,
  selected,
}: {
  dialog: Dialog;
  selected: Criterion;
}) {
  const isOpen =
    dialog === "schedule" || dialog === "cancel" || dialog === "retire";
  return isOpen ? (
    <div className="space-y-4">
      <ErpCard tone="warning" className="p-4 text-sm leading-7">
        <p className="font-bold">
          {selected.title} · نسخه {selected.version}
        </p>
        <p className="mt-1">
          این اقدام تاریخچه و ارجاع‌های قبلی را حذف یا بازنویسی نمی‌کند.
        </p>
      </ErpCard>
      {dialog === "schedule" || dialog === "retire" ? (
        <ErpField label="تاریخ اثر">
          <ErpInput defaultValue="۱۴۰۵/۰۷/۰۱" />
        </ErpField>
      ) : null}
      {dialog === "cancel" || dialog === "retire" ? (
        <ErpField label="دلیل الزامی">
          <ErpTextarea
            placeholder="دلیل روشن و قابل حسابرسی را بنویسید"
            rows={4}
          />
        </ErpField>
      ) : null}
      {dialog === "retire" ? (
        <ErpCard tone="warning" className="p-4 text-sm leading-7">
          پیش از زمان‌بندی، سیستم بررسی می‌کند که الگوی آینده کامل بماند و هیچ
          ارزیابی آینده بدون معیار معتبر ایجاد نشود. فعال‌شدن نسخه جانشین، نسخه
          فعلی را خودکار بازنشسته می‌کند.
        </ErpCard>
      ) : null}
      {dialog === "cancel" ? (
        <p className="text-xs leading-6 text-[var(--sds-text-muted)]">
          نسخه لغوشده قابل ویرایش نمی‌شود و همراه با دلیل در سوابق باقی می‌ماند.
        </p>
      ) : null}
      <ErpField label="یادداشت انتشار">
        <ErpTextarea placeholder="خلاصه تغییر برای تاریخچه نسخه" rows={3} />
      </ErpField>
    </div>
  ) : null;
}

function ImpactPreview({
  open,
  onClose,
  notice,
}: {
  open: boolean;
  onClose: () => void;
  notice: (message: string) => void;
}) {
  return (
    <ErpSheet
      open={open}
      onClose={onClose}
      title="پیش‌نمایش قطعی اثر سیاست سازمانی"
      presentation="modal"
      size="wide"
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <ErpButton
            label="بازگشت به پیش‌نویس"
            onClick={onClose}
            tone="neutral"
            variant="ghost"
          />
          <ErpButton
            label="تأیید اثر و زمان‌بندی"
            onClick={() =>
              notice(
                "Prototype: تأیید صریح اثر ثبت شد؛ فعال‌سازی واقعی انجام نشد.",
              )
            }
            tone="primary"
            variant="solid"
          />
        </div>
      }
    >
      <div className="space-y-5">
        <ErpCard tone="warning" className="p-4 text-sm leading-7">
          <p className="font-bold">
            این سیاست Badgeهای جاری را باز‌محاسبه می‌کند
          </p>
          <p className="mt-1">
            نتایج و سطح‌های تاریخی تغییر نمی‌کنند. فعال‌سازی فقط پس از رفع خطاها
            و تأیید صریح همین اثر مجاز است.
          </p>
        </ErpCard>
        <ErpSummaryGrid
          columns={3}
          items={[
            { label: "افزایش سطح", value: "۱۲ Personnel", tone: "success" },
            { label: "کاهش سطح", value: "۷ Personnel", tone: "warning" },
            { label: "بدون تغییر", value: "۸۶ Personnel" },
            {
              label: "نیازمند ارزیابی تازه",
              value: "۴ Personnel",
              tone: "warning",
            },
            { label: "انقضا", value: "۳ نتیجه" },
            { label: "خطای مانع", value: "۲ Personnel", tone: "danger" },
          ]}
        />
        <ErpSection title="خطاهای مانع">
          <div className="space-y-2">
            <ErpCard tone="danger" className="p-3 text-sm">
              دو Employment Relationship ورودی معتبر کافی برای باز‌محاسبه
              ندارند؛ فعال‌سازی Fail-closed می‌ماند.
            </ErpCard>
            <ErpCard className="p-3 text-sm">
              شناسه‌های Personnel فقط برای دارنده مجوز تحلیل نام‌دار نمایش داده
              می‌شوند؛ خروجی این پیش‌نمایش جداگانه حسابرسی می‌شود.
            </ErpCard>
          </div>
        </ErpSection>
      </div>
    </ErpSheet>
  );
}

function CalculationTrace({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const rows = [
    [
      "Snapshot بخش مأموریت",
      "Job: کارشناس برنامه‌ریزی · تخصیص ۶۰٪",
      "تغییرناپذیر",
    ],
    ["نسخه معیار", "PERF-QLT-014 · نسخه ۲", "مؤثر در شروع بخش"],
    ["درجه ثبت‌شده", "۴ · بالاتر از انتظار", "۷۵ از ۱۰۰"],
    ["شاهد", "۲ ارجاع قابل اتکا", "محتوا با مجوز مستقل"],
    ["وزن اصلی", "۲۵٫۰۰۰۰۰۰٪", "پیش از نامرتبط‌شدن"],
    ["وزن مؤثر", "۲۶٫۳۱۵۷۸۹٪", "توزیع در همان دسته"],
    ["سهم معیار", "۱۹٫۷۳۶۸۴۲", "بدون گردکردن میانی"],
    ["سهم بخش مأموریت", "۵۸٫۴۲۱۰۵۳", "روز مؤثر × تخصیص"],
    ["مقدار نمایشی", "۵۸٫۴۲", "فقط نمایش مدیریتی"],
  ];
  return (
    <ErpSheet
      open={open}
      onClose={onClose}
      title="ردپای محرمانه محاسبه"
      presentation="modal"
      size="wide"
    >
      <div className="space-y-5">
        <ErpCard
          tone="info"
          className="flex items-start gap-3 p-4 text-sm leading-7"
        >
          <FaLock className="mt-1 shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold">فقط‌خواندنی · نتیجه مصوب «تابستان ۱۴۰۵»</p>
            <p className="mt-1">
              این نما محاسبه تاریخی را بازسازی می‌کند؛ تغییر نسخه امروز، هیچ
              ورودی یا خروجی این نتیجه را عوض نمی‌کند.
            </p>
          </div>
        </ErpCard>
        <div className="overflow-x-auto rounded-xl border border-[var(--sds-border-subtle)]">
          <table className="w-full min-w-[680px] text-right text-sm">
            <thead className="bg-[var(--sds-surface-subtle)]">
              <tr>
                <th className="p-3">مرحله</th>
                <th>مقدار بازسازی‌شده</th>
                <th>قاعده یا نسخه</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(([stage, value, rule]) => (
                <tr
                  key={stage}
                  className="border-t border-[var(--sds-border-subtle)]"
                >
                  <td className="p-3 font-bold">{stage}</td>
                  <td className="py-3">{value}</td>
                  <td className="py-3 text-xs text-[var(--sds-text-muted)]">
                    {rule}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <ErpCard tone="warning" className="p-4 text-xs leading-6">
          مشاهده فراداده حسابرسی، مجوز دیدن روایت Supervisor یا محتوای شاهد را
          ایجاد نمی‌کند. بازکردن این ردپا با عامل، دامنه، زمان و شناسه پیگیری
          ثبت می‌شود.
        </ErpCard>
      </div>
    </ErpSheet>
  );
}

function PrototypeSwitcher({
  variant,
  onChange,
}: {
  variant: Variant;
  onChange: (variant: Variant) => void;
}) {
  const currentIndex = variants.findIndex((item) => item.id === variant);
  const cycle = useCallback(
    (direction: -1 | 1) =>
      onChange(
        variants[(currentIndex + direction + variants.length) % variants.length]
          .id,
      ),
    [currentIndex, onChange],
  );
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']"))
        return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);
  if (process.env.NODE_ENV === "production") return null;
  const current = variants[currentIndex];
  return (
    <div
      className="fixed bottom-20 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-text-primary)] p-2 text-[var(--sds-text-inverse)] shadow-xl lg:bottom-5"
      dir="ltr"
    >
      <ErpPressable
        type="button"
        onClick={() => cycle(-1)}
        aria-label="طرح قبلی"
        tone="neutral"
        variant="ghost"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--sds-border-strong)]"
      >
        <FaArrowLeft />
      </ErpPressable>
      <span className="min-w-44 px-2 text-center text-sm font-bold" dir="rtl">
        {current.id} · {current.label}
        <span className="block text-xs font-normal opacity-80">
          {current.short}
        </span>
      </span>
      <ErpPressable
        type="button"
        onClick={() => cycle(1)}
        aria-label="طرح بعدی"
        tone="neutral"
        variant="ghost"
        className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--sds-border-strong)]"
      >
        <FaArrowRight />
      </ErpPressable>
    </div>
  );
}

export default function PerformanceCriteriaPrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("variant")?.toUpperCase();
  const requestedAccess = searchParams.get("access");
  const variant: Variant =
    requested === "A" || requested === "B" || requested === "C"
      ? requested
      : "D";
  const [profile, setProfile] = useState<PermissionProfile>("administrator");
  const [selectedId, setSelectedId] = useState("quality");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [message, setMessage] = useState("");
  const [draftSaveStatus, setDraftSaveStatus] = useState(
    "همه تغییرات ذخیره شده‌اند",
  );
  const [draftDirty, setDraftDirty] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState("۱۴۰۵/۰۷/۰۱");
  const nextSaveFails = useRef(searchParams.get("save") === "fail");
  const [weightValid, setWeightValid] = useState(false);
  const [anchorFiveValid, setAnchorFiveValid] = useState(false);
  const [activeErrorSection, setActiveErrorSection] = useState<
    "definition" | "anchors" | null
  >(null);
  const [errorAnnouncement, setErrorAnnouncement] = useState("");
  const [reviewMode, setReviewMode] = useState<"new" | "version">("version");
  const [showSecondaryActions, setShowSecondaryActions] = useState(false);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const definitionSectionRef = useRef<HTMLDivElement>(null);
  const anchorsSectionRef = useRef<HTMLDivElement>(null);
  const weightInputRef = useRef<HTMLInputElement>(null);
  const anchorFiveInputRef = useRef<HTMLTextAreaElement>(null);
  const selected = useMemo(
    () => criteria.find((item) => item.id === selectedId) ?? criteria[0],
    [selectedId],
  );
  const effectiveProfile: PermissionProfile =
    variant === "D" && requestedAccess === "read" ? "auditor" : profile;
  const setVariant = useCallback(
    (next: Variant) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("variant", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const markDraftChanged = useCallback(() => {
    setDraftDirty(true);
    setDraftSaveStatus("در حال ذخیره خودکار…");
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      if (nextSaveFails.current) {
        nextSaveFails.current = false;
        setDraftSaveStatus("ذخیره نشد");
        return;
      }
      setDraftDirty(false);
      setDraftSaveStatus("همه تغییرات ذخیره شده‌اند");
    }, 700);
  }, []);
  const saveDraftManually = useCallback(() => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    setDraftDirty(false);
    setDraftSaveStatus("پیش‌نویس با دکمه ذخیره شد");
  }, []);
  const closeDraftEditor = useCallback(() => {
    if (draftDirty) {
      setDraftSaveStatus("ذخیره نشد؛ پیش از خروج «تلاش دوباره» را بزنید");
      return;
    }
    setDialog(null);
  }, [draftDirty]);
  const scrollToErrorSection = useCallback(
    (section: "definition" | "anchors") => {
      const target =
        section === "definition"
          ? definitionSectionRef.current
          : anchorsSectionRef.current;
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
      setActiveErrorSection(section);
      setErrorAnnouncement(
        section === "definition"
          ? "به خطای سهم معیار منتقل شدید"
          : "به خطای توضیح امتیاز ۵ منتقل شدید",
      );
      window.setTimeout(() => {
        const field =
          section === "definition"
            ? weightInputRef.current
            : anchorFiveInputRef.current;
        field?.focus({ preventScroll: true });
      }, 350);
    },
    [],
  );
  const remainingErrorCount = Number(!weightValid) + Number(!anchorFiveValid);
  const openFinalReview = useCallback(() => {
    if (!weightValid) {
      scrollToErrorSection("definition");
      return;
    }
    if (!anchorFiveValid) {
      scrollToErrorSection("anchors");
      return;
    }
    setReviewMode(dialog === "simpleNew" ? "new" : "version");
    setDialog("review");
  }, [anchorFiveValid, dialog, scrollToErrorSection, weightValid]);
  useEffect(
    () => () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    },
    [],
  );
  const notify = (next: string) => {
    setMessage(next);
    setDialog(null);
  };
  const props: VariantProps = {
    selected,
    selectedId,
    onSelect: setSelectedId,
    profile: effectiveProfile,
    open: setDialog,
  };
  const editorReadOnly =
    effectiveProfile === "auditor" ||
    (selected.status !== "پیش‌نویس" && dialog !== "branch");
  const lifecycleOpen =
    dialog === "schedule" || dialog === "cancel" || dialog === "retire";
  const lifecycleTitle =
    dialog === "schedule"
      ? "زمان‌بندی نسخه"
      : dialog === "cancel"
        ? "لغو نسخه زمان‌بندی‌شده"
        : "بازنشسته‌کردن نسخه فعال";
  const lifecycleAction =
    dialog === "schedule"
      ? "ثبت زمان‌بندی"
      : dialog === "cancel"
        ? "تأیید لغو"
        : "تأیید بازنشستگی";
  const lifecycleTone: "danger" | "warning" | "primary" =
    dialog === "cancel"
      ? "danger"
      : dialog === "retire"
        ? "warning"
        : "primary";
  if (variant === "D" && requestedAccess === "none") {
    return (
      <ErpPage
        eyebrow="منابع انسانی"
        title="معیارهای ارزیابی عملکرد"
        description="دسترسی به این صفحه براساس مجوز مؤثر کنترل می‌شود."
        backHref="/dashboard/hr"
      >
        <ErpCard tone="warning" className="p-5 text-sm leading-7">
          <p className="font-bold">شما مجوز مشاهده معیارهای عملکرد را ندارید</p>
          <p className="mt-1">
            برای درخواست دسترسی با مدیر مجوزهای منابع انسانی تماس بگیرید. هیچ
            اطلاعات معیار یا اقدام مدیریتی در این وضعیت نمایش داده نمی‌شود.
          </p>
        </ErpCard>
      </ErpPage>
    );
  }
  return (
    <ErpPage
      eyebrow="Prototype موقت · داده ساختگی"
      title={
        variant === "D"
          ? "معیارهای ارزیابی عملکرد"
          : "مدیریت معیارها و سیاست امتیازدهی عملکرد"
      }
      description={
        variant === "D"
          ? "معیارها را بسازید، کامل کنید و برای استفاده آماده کنید."
          : "سه تجربه فارسی RTL برای ساخت نسخه، انتشار ایمن، پیش‌نمایش اثر و بازسازی محاسبه؛ هیچ تعامل این صفحه داده واقعی را تغییر نمی‌دهد."
      }
      backHref="/dashboard/hr"
      actions={
        variant === "D"
          ? []
          : [
              {
                label: "پیش‌نمایش اثر سیاست",
                icon: FaEye,
                onClick: () => setDialog("impact"),
                tone: "primary",
                variant: "outline",
              },
              {
                label: "ردپای محاسبه",
                icon: FaCalculator,
                onClick: () => setDialog("trace"),
                tone: "neutral",
                variant: "ghost",
                disabled: profile === "publisher",
              },
            ]
      }
    >
      {variant !== "D" ? (
        <PermissionPreview profile={profile} onChange={setProfile} />
      ) : null}
      {message ? (
        <div role="status">
          <ErpCard
            tone="info"
            className="flex items-center justify-between gap-3 p-4"
          >
            <span className="text-sm">{message}</span>
            <ErpButton
              label="بستن"
              onClick={() => setMessage("")}
              tone="neutral"
              variant="ghost"
            />
          </ErpCard>
        </div>
      ) : null}
      {variant !== "D" ? (
        <ErpCard className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-3">
            <FaShieldAlt aria-hidden="true" />
            <div>
              <p className="font-bold">مرز تاریخی و محرمانگی ثابت است</p>
              <p className="mt-1 text-xs leading-6 text-[var(--sds-text-muted)]">
                نسخه معیار فقط آینده را تغییر می‌دهد؛ سیاست سازمانی پیش از
                باز‌محاسبه Badgeهای جاری اثر را نشان می‌دهد؛ ردپای محاسبه مستقل
                و حسابرسی‌شده است.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <ErpBadge tone="success">Snapshot محفوظ</ErpBadge>
            <ErpBadge tone="success">بدون تغییر نتیجه مصوب</ErpBadge>
            <ErpBadge tone="info">مجوز مؤثر مستقل</ErpBadge>
          </div>
        </ErpCard>
      ) : null}
      {variant === "A" ? (
        <LibraryVariant {...props} />
      ) : variant === "B" ? (
        <GuidedVariant {...props} />
      ) : variant === "C" ? (
        <ReleaseVariant {...props} />
      ) : (
        <SimpleVariant {...props} />
      )}
      <ErpSheet
        open={dialog === "simple" || dialog === "simpleNew"}
        onClose={closeDraftEditor}
        title={
          dialog === "simpleNew"
            ? "ساخت معیار جدید"
            : selected.status === "پیش‌نویس"
              ? "تکمیل معیار"
              : "جزئیات معیار"
        }
        presentation="modal"
        size="wide"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {(dialog === "simpleNew" || selected.status === "پیش‌نویس") &&
            effectiveProfile !== "auditor" ? (
              <span
                role="status"
                className="text-xs text-[var(--sds-text-secondary)]"
              >
                {draftSaveStatus}
              </span>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <ErpButton
                label="بستن"
                onClick={closeDraftEditor}
                tone="neutral"
                variant="ghost"
              />
              {(dialog === "simpleNew" || selected.status === "پیش‌نویس") &&
              effectiveProfile !== "auditor" ? (
                <>
                  <ErpButton
                    label={draftSaveStatus.startsWith("ذخیره نشد") ? "تلاش دوباره" : "ذخیره پیش‌نویس"}
                    onClick={saveDraftManually}
                    tone="neutral"
                    variant="outline"
                  />
                  <ErpButton
                    label="بررسی نهایی"
                    onClick={openFinalReview}
                    tone="primary"
                    variant="solid"
                  />
                </>
              ) : selected.status === "زمان‌بندی‌شده" &&
                effectiveProfile !== "auditor" ? (
                <ErpButton
                  label="لغو زمان‌بندی"
                  icon={FaTimesCircle}
                  onClick={() => setDialog("cancel")}
                  tone="danger"
                  variant="outline"
                />
              ) : selected.status === "فعال" &&
                effectiveProfile !== "auditor" ? (
                <>
                  {showSecondaryActions ? (
                    <ErpButton
                      label="بازنشسته‌کردن"
                      icon={FaArchive}
                      onClick={() => setDialog("retire")}
                      tone="warning"
                      variant="outline"
                    />
                  ) : null}
                  <ErpButton
                    label={
                      showSecondaryActions
                        ? "بستن اقدام‌های بیشتر"
                        : "اقدام‌های بیشتر"
                    }
                    onClick={() =>
                      setShowSecondaryActions((current) => !current)
                    }
                    tone="neutral"
                    variant="ghost"
                  />
                  <ErpButton
                    label="ساخت نسخه تازه"
                    icon={FaCodeBranch}
                    onClick={() => setDialog("branch")}
                    tone="primary"
                    variant="solid"
                  />
                </>
              ) : null}
            </div>
          </div>
        }
      >
        <div className="space-y-4">
          {dialog === "simpleNew" ? (
            <ErpCard tone="info" className="p-4 text-sm leading-7">
              <p className="font-bold">یک مفهوم تازه با هویت مستقل</p>
              <p className="mt-1">
                اگر می‌خواهید یک معیار موجود را تغییر دهید، از جزئیات همان معیار
                «ساخت نسخه تازه» را انتخاب کنید.
              </p>
            </ErpCard>
          ) : null}
          <div
            ref={definitionSectionRef}
            className={`scroll-mt-4 rounded-xl transition ${
              activeErrorSection === "definition"
                ? "ring-2 ring-[var(--sds-warning)] ring-offset-2"
                : ""
            }`}
          >
            <ErpCard className="p-4">
              <p className="text-xs font-bold text-[var(--sds-accent)]">
                ۱. این معیار چه چیزی را می‌سنجد؟
              </p>
              <div className="mt-4 grid gap-4 md:grid-cols-3">
                <ErpField label="نام معیار">
                  <ErpInput
                    defaultValue={selected.title}
                    disabled={
                      effectiveProfile === "auditor" ||
                      (dialog !== "simpleNew" && selected.status !== "پیش‌نویس")
                    }
                    onChange={markDraftChanged}
                  />
                </ErpField>
                <ErpField label="دسته">
                  <ErpSelect
                    defaultValue="current"
                    disabled={
                      effectiveProfile === "auditor" ||
                      (dialog !== "simpleNew" && selected.status !== "پیش‌نویس")
                    }
                    onChange={markDraftChanged}
                  >
                    <option value="current">{selected.category}</option>
                  </ErpSelect>
                </ErpField>
                <ErpField
                  label="سهم این معیار"
                  error={
                    !weightValid
                      ? "برای تکمیل نمونه، سهم را به ۳۰٪ تغییر دهید."
                      : undefined
                  }
                >
                  <ErpInput
                    ref={weightInputRef}
                    defaultValue={selected.weight.replace("٪", "")}
                    disabled={
                      effectiveProfile === "auditor" ||
                      (dialog !== "simpleNew" && selected.status !== "پیش‌نویس")
                    }
                    onChange={(event) => {
                      markDraftChanged();
                      setWeightValid(event.target.value.trim() === "۳۰");
                      setActiveErrorSection(null);
                    }}
                  />
                </ErpField>
              </div>
            </ErpCard>
          </div>
          <div
            ref={anchorsSectionRef}
            className={`scroll-mt-4 rounded-xl transition ${
              activeErrorSection === "anchors"
                ? "ring-2 ring-[var(--sds-warning)] ring-offset-2"
                : ""
            }`}
          >
            <ErpCard className="p-4">
              <p className="text-xs font-bold text-[var(--sds-accent)]">
                ۲. چه رفتاری هر امتیاز را می‌گیرد؟
              </p>
              <div className="mt-4 space-y-3">
                {anchors.map((anchor) => (
                  <div
                    key={anchor.score}
                    className="grid gap-2 rounded-lg bg-[var(--sds-surface-subtle)] p-3 text-sm md:grid-cols-[210px_minmax(0,1fr)] md:items-start"
                  >
                    <span className="font-bold">
                      {anchor.score} · {anchor.label}
                    </span>
                    {(dialog === "simpleNew" ||
                      selected.status === "پیش‌نویس") &&
                    effectiveProfile !== "auditor" ? (
                      <ErpTextarea
                        ref={
                          anchor.score === "۵" ? anchorFiveInputRef : undefined
                        }
                        defaultValue={anchor.score === "۵" ? "" : anchor.text}
                        aria-label={`توضیح امتیاز ${anchor.score}`}
                        aria-invalid={anchor.score === "۵" && !anchorFiveValid}
                        placeholder={
                          anchor.score === "۵"
                            ? "رفتار قابل مشاهده برای امتیاز ۵ را بنویسید"
                            : undefined
                        }
                        rows={2}
                        onChange={(event) => {
                          markDraftChanged();
                          if (anchor.score === "۵") {
                            setAnchorFiveValid(
                              event.target.value.trim().length >= 10,
                            );
                            setActiveErrorSection(null);
                          }
                        }}
                      />
                    ) : (
                      <span>{anchor.text}</span>
                    )}
                  </div>
                ))}
              </div>
            </ErpCard>
          </div>
          <ErpCard className="p-4">
            <p className="text-xs font-bold text-[var(--sds-accent)]">
              ۳. کجا استفاده می‌شود و چه شاهدی لازم است؟
            </p>
            <ErpSummaryGrid
              columns={2}
              items={[
                {
                  label: "افراد مشمول",
                  value: "کارشناس و سرپرست برنامه‌ریزی",
                },
                { label: "شاهد لازم", value: selected.evidence },
              ]}
            />
          </ErpCard>
          {(dialog === "simpleNew" || selected.status === "پیش‌نویس") &&
          effectiveProfile !== "auditor" ? (
            <ErpCard
              tone={remainingErrorCount > 0 ? "warning" : "success"}
              className="p-4 text-sm leading-7"
            >
              <p className="font-bold">
                {remainingErrorCount > 0
                  ? `${remainingErrorCount.toLocaleString("fa-IR")} مورد برای تکمیل مانده است`
                  : "معیار آماده بررسی نهایی است"}
              </p>
              <div className="mt-2 space-y-2">
                {!weightValid ? (
                  <ErpPressable
                    type="button"
                    onClick={() => scrollToErrorSection("definition")}
                    tone="warning"
                    variant="ghost"
                    className="flex w-full items-center justify-between gap-3 rounded-lg p-2 text-right"
                  >
                    <span>وزن‌های دسته باید به ۱۰۰٪ برسند.</span>
                    <span className="shrink-0 font-bold">رفتن به بخش</span>
                  </ErpPressable>
                ) : null}
                {!anchorFiveValid ? (
                  <ErpPressable
                    type="button"
                    onClick={() => scrollToErrorSection("anchors")}
                    tone="warning"
                    variant="ghost"
                    className="flex w-full items-center justify-between gap-3 rounded-lg p-2 text-right"
                  >
                    <span>توضیح امتیاز ۵ باید کامل شود.</span>
                    <span className="shrink-0 font-bold">رفتن به بخش</span>
                  </ErpPressable>
                ) : null}
              </div>
              <p className="mt-2 text-xs text-[var(--sds-text-muted)]">
                پس از رفع این موارد، «بررسی نهایی» خلاصه تغییرات، تاریخ اثر و
                اثرگذاری فقط بر ارزیابی‌های آینده را نشان می‌دهد؛ سپس می‌توانید
                نسخه را زمان‌بندی کنید.
              </p>
            </ErpCard>
          ) : null}
          <p className="sr-only" aria-live="assertive">
            {errorAnnouncement}
          </p>
        </div>
      </ErpSheet>
      <ErpSheet
        open={dialog === "review"}
        onClose={() => setDialog(null)}
        title="بررسی نهایی"
        presentation="modal"
        size="wide"
        footer={
          <div className="flex flex-wrap justify-end gap-2">
            <ErpButton
              label="بازگشت و ویرایش"
              onClick={() =>
                setDialog(reviewMode === "new" ? "simpleNew" : "simple")
              }
              tone="neutral"
              variant="ghost"
            />
            <ErpButton
              label="زمان‌بندی نسخه"
              icon={FaCalendarAlt}
              onClick={() => {
                if (!isFuturePersianDate(effectiveDate)) {
                  setMessage("تاریخ اثر باید یک تاریخ معتبر در آینده باشد.");
                  return;
                }
                notify("Prototype: نسخه برای تاریخ انتخاب‌شده زمان‌بندی شد؛ هیچ داده واقعی تغییر نکرد.");
              }}
              tone="primary"
              variant="solid"
            />
          </div>
        }
      >
        <div className="space-y-5">
          <ErpCard tone="info" className="p-4 text-sm leading-7">
            <p className="font-bold">
              این نسخه فقط بر ارزیابی‌های آینده اثر می‌گذارد
            </p>
            <p className="mt-1">
              ارزیابی‌های قبلی، ارزیابی‌های جاری و Snapshotهای ثبت‌شده تغییر
              نمی‌کنند. فعال‌سازی فوری در این مسیر وجود ندارد.
            </p>
          </ErpCard>
          {reviewMode === "version" ? (
            <ErpSection
              title="تغییرات این نسخه"
              description={`نسخه تازه بر پایه نسخه ${selected.version}`}
            >
              <div className="overflow-hidden rounded-xl border border-[var(--sds-border-subtle)] text-sm">
                <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 bg-[var(--sds-surface-subtle)] p-3 font-bold">
                  <span>مورد</span>
                  <span>مقدار قبلی</span>
                  <span>مقدار جدید</span>
                </div>
                <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-t border-[var(--sds-border-subtle)] p-3">
                  <span className="font-bold">سهم معیار</span>
                  <span>۲۵٪</span>
                  <span>۳۰٪</span>
                </div>
                <div className="grid grid-cols-[minmax(120px,0.7fr)_minmax(0,1fr)_minmax(0,1fr)] gap-3 border-t border-[var(--sds-border-subtle)] p-3">
                  <span className="font-bold">توضیح امتیاز ۵</span>
                  <span>کامل نشده بود</span>
                  <span>توضیح رفتاری تازه</span>
                </div>
              </div>
            </ErpSection>
          ) : (
            <ErpSection title="خلاصه معیار جدید">
              <ErpSummaryGrid
                columns={2}
                items={[
                  { label: "نام معیار", value: selected.title },
                  { label: "دسته", value: selected.category },
                  { label: "سهم معیار", value: "۳۰٪" },
                  { label: "توصیف امتیازها", value: "۵ مورد کامل" },
                  {
                    label: "افراد مشمول",
                    value: "کارشناس و سرپرست برنامه‌ریزی",
                  },
                  { label: "شاهد لازم", value: selected.evidence },
                ]}
              />
            </ErpSection>
          )}
          <ErpField label="تاریخ اثر">
            <ErpInput value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} aria-invalid={!isFuturePersianDate(effectiveDate)} />
          </ErpField>
          <p className="text-xs leading-6 text-[var(--sds-text-muted)]">
            تاریخ اثر باید در آینده باشد؛ تا آن تاریخ نسخه فعال فعلی بدون تغییر
            باقی می‌ماند.
          </p>
        </div>
      </ErpSheet>
      <ErpSheet
        open={dialog === "editor" || dialog === "branch"}
        onClose={closeDraftEditor}
        title={
          dialog === "branch"
            ? "ساخت نسخه تازه"
            : editorReadOnly
              ? "جزئیات تغییرناپذیر نسخه"
              : "ویرایش پیش‌نویس معیار"
        }
        presentation="modal"
        size="wide"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-3">
            {!editorReadOnly ? (
              <span
                role="status"
                className="text-xs text-[var(--sds-text-secondary)]"
              >
                {draftSaveStatus}
              </span>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <ErpButton
                label="بستن"
                onClick={closeDraftEditor}
                tone="neutral"
                variant="ghost"
              />
              {!editorReadOnly ? (
                <ErpButton
                  label={draftSaveStatus.startsWith("ذخیره نشد") ? "تلاش دوباره" : "ذخیره پیش‌نویس"}
                  onClick={saveDraftManually}
                  tone="primary"
                  variant="solid"
                />
              ) : null}
            </div>
          </div>
        }
      >
        <CriterionEditorContent
          selected={selected}
          profile={effectiveProfile}
          draftFromActive={dialog === "branch"}
          onDraftChange={markDraftChanged}
        />
      </ErpSheet>
      <ErpSheet
        open={lifecycleOpen}
        onClose={() => setDialog(null)}
        title={lifecycleTitle}
        presentation="modal"
        pending={false}
        footer={
          <div className="flex justify-end gap-2">
            <ErpButton
              label="انصراف"
              onClick={() => setDialog(null)}
              tone="neutral"
              variant="ghost"
            />
            <ErpButton
              label={lifecycleAction}
              onClick={() =>
                notify(
                  `Prototype: اقدام «${lifecycleAction}» شبیه‌سازی شد و هیچ نسخه واقعی تغییر نکرد.`,
                )
              }
              tone={lifecycleTone}
              variant="solid"
            />
          </div>
        }
      >
        <LifecycleActionContent dialog={dialog} selected={selected} />
      </ErpSheet>
      <ImpactPreview
        open={dialog === "impact"}
        onClose={() => setDialog(null)}
        notice={notify}
      />
      <CalculationTrace
        open={dialog === "trace" && profile !== "publisher"}
        onClose={() => setDialog(null)}
      />
      {dialog === "trace" && profile === "publisher" ? (
        <ErpCard tone="warning" className="p-4">
          <FaExclamationTriangle className="inline" aria-hidden="true" /> این
          پروفایل مجوز مشاهده ردپای محرمانه محاسبه را ندارد.
        </ErpCard>
      ) : null}
      <PrototypeSwitcher variant={variant} onChange={setVariant} />
    </ErpPage>
  );
}
