"use client";

import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpInlineState,
  ErpIconButton,
  ErpMetricGrid,
  ErpPage,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpSummaryGrid,
} from "@/components/erp";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  FaArrowLeft,
  FaArrowRight,
  FaChartLine,
  FaCheck,
  FaClock,
  FaExchangeAlt,
  FaPause,
  FaSearchDollar,
  FaShieldAlt,
  FaUserCheck,
  FaUsers,
  FaWallet,
} from "react-icons/fa";

type Variant = "A" | "B" | "C";
type Persona = "ADMIN" | "HR" | "SALES" | "PARTNER";
type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "purple";

type WorkItem = {
  id: string;
  owner: Persona;
  title: string;
  partner: string;
  detail: string;
  status: string;
  tone: Tone;
  action: string;
  age: string;
};

const variants: Variant[] = ["A", "B", "C"];
const variantNames: Record<Variant, string> = {
  A: "صف تصمیم",
  B: "پرونده Partner",
  C: "هاب نقش‌ها",
};

const personaOptions = [
  { value: "ADMIN" as const, label: "Admin", icon: FaShieldAlt },
  { value: "HR" as const, label: "HR", icon: FaUserCheck },
  { value: "SALES" as const, label: "Sales / CRM", icon: FaUsers },
  { value: "PARTNER" as const, label: "Partner", icon: FaWallet },
];

const personaCopy: Record<Persona, { title: string; scope: string; boundary: string }> = {
  ADMIN: {
    title: "دید سراسری و اقدام‌های نام‌دار",
    scope: "COMPANY",
    boundary: "مشاهده کامل؛ بدون impersonation و بدون پاسخ به استعلام مگر پس از assignment ممیزی‌شده.",
  },
  HR: {
    title: "هویت و چرخه پروفایل",
    scope: "DEPARTMENT / COMPANY صریح",
    boundary: "فقط activation gates، تعلیق و خاتمه؛ بدون قیمت، margin یا پرداخت.",
  },
  SALES: {
    title: "مدیریت تجاری و مالکیت مشتری",
    scope: "DEPARTMENT پیش‌فرض",
    boundary: "assignment و مدیریت تجاری از Sales؛ تصمیم انتقال از مجوز صریح CRM. فروشنده عادی دسترسی ضمنی ندارد.",
  },
  PARTNER: {
    title: "فروش، گزارش شخصی و حساب من",
    scope: "OWN",
    boundary: "فقط مشتریان و پرونده‌های خود؛ حساب سبلان read-only و جدا از وصول مشتری.",
  },
};

const workItems: WorkItem[] = [
  { id: "activation", owner: "HR", title: "تکمیل درگاه فعال‌سازی", partner: "سنگ آریا", detail: "هویت تجاری تأیید شده؛ شرایط پرداخت و پاسخ‌دهنده هنوز ناقص‌اند.", status: "۲ مانع", tone: "warning", action: "بررسی درگاه‌ها", age: "از دیروز" },
  { id: "suspension", owner: "HR", title: "تصمیم تعلیق", partner: "پارس سازه", detail: "درخواست تعلیق با دلیل ثبت شده؛ ۴ پرونده قطعی برای Accounting و Delivery ادامه می‌یابد.", status: "نیازمند تصمیم", tone: "danger", action: "بررسی تعلیق", age: "۴۵ دقیقه" },
  { id: "assignment", owner: "SALES", title: "تعیین پاسخ‌دهنده قیمت", partner: "گروه سپید", detail: "بدون پاسخ‌دهنده فعال؛ ارسال استعلام جدید fail-closed است و تیکت پشتیبانی باز مانده.", status: "فوری", tone: "danger", action: "تعیین پاسخ‌دهنده", age: "۲ ساعت" },
  { id: "transfer", owner: "SALES", title: "تصمیم انتقال مشتری", partner: "سنگ آریا", detail: "تطبیق احتمالی: مریم احمدی · شخص حقیقی · تهران · تلفن •••• ۴۸۱۲",
    status: "projection محدود", tone: "info", action: "بررسی درخواست", age: "امروز" },
  { id: "reassign", owner: "ADMIN", title: "بازانتساب اضطراری", partner: "گروه سپید", detail: "پاسخ‌دهنده قبلی غیرفعال شده؛ فقط ردیف‌های pending منتقل می‌شوند و تاریخچه تصمیم‌ها ثابت می‌ماند.", status: "۳ ردیف pending", tone: "warning", action: "بازانتساب", age: "۲ ساعت" },
  { id: "audit", owner: "ADMIN", title: "بازبینی اقدام حساس", partner: "پارس سازه", detail: "تعلیق، assignment revision و scope مؤثر در یک audit trail قابل مشاهده‌اند.", status: "بدون تعارض", tone: "success", action: "مشاهده ممیزی", age: "امروز" },
  { id: "inquiry", owner: "PARTNER", title: "استعلام‌های من", partner: "حساب من", detail: "۲ ردیف تا کمتر از ۶ ساعت دیگر منقضی می‌شوند؛ expiry در زمان تعلیق متوقف نمی‌شود.", status: "۲ نزدیک انقضا", tone: "warning", action: "مشاهده استعلام‌ها", age: "تا ۵ ساعت" },
  { id: "receivable", owner: "PARTNER", title: "حساب من با سبلان", partner: "حساب من", detail: "مانده حساب از حقیقت Accounting خوانده می‌شود؛ وصول مشتری در این مانده محاسبه نشده است.", status: "۴۸۰ میلیون ریال", tone: "info", action: "مشاهده گردش حساب", age: "به‌روز" },
];

const profiles = [
  { name: "سنگ آریا", owner: "علی اکبری", lifecycle: "در انتظار تکمیل", tone: "warning" as Tone, responder: "تعیین نشده", blockers: "شرایط پرداخت، پاسخ‌دهنده", sales: "۰", balance: "۰ ریال" },
  { name: "پارس سازه", owner: "نازنین یوسفی", lifecycle: "معلق", tone: "danger" as Tone, responder: "سارا محمدی", blockers: "تصمیم تعلیق", sales: "۱۲", balance: "۳۲۰ میلیون ریال" },
  { name: "گروه سپید", owner: "حسین رضایی", lifecycle: "فعال", tone: "success" as Tone, responder: "فاقد پاسخ‌دهنده فعال", blockers: "بازانتساب", sales: "۸", balance: "۱۶۰ میلیون ریال" },
];

function PartnerDecisionRow({ item, selected, onSelect }: { item: WorkItem; selected?: boolean; onSelect: () => void }) {
  return (
    <ErpPressable
      type="button"
      onClick={onSelect}
      variant={selected ? "soft" : "ghost"}
      tone={selected ? "primary" : "neutral"}
      className="flex min-h-16 w-full items-start justify-between gap-3 p-3 text-right"
    >
      <span className="min-w-0">
        <span className="block font-semibold text-[var(--sds-text-primary)]">{item.title}</span>
        <span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{item.partner} · {item.age}</span>
      </span>
      <ErpBadge tone={item.tone}>{item.status}</ErpBadge>
    </ErpPressable>
  );
}

function ActionPreview({ item, onAct }: { item: WorkItem; onAct: (message: string) => void }) {
  return (
    <ErpSection title={item.title} description={`${item.partner} · ${item.age}`}>
      <div className="space-y-4">
        <ErpInlineState kind={item.tone === "danger" ? "error" : item.tone === "warning" ? "stale" : "success"} title={item.detail} />
        <ErpSummaryGrid columns={2} items={[
          { label: "مالک اقدام", value: personaOptions.find((option) => option.value === item.owner)?.label },
          { label: "وضعیت", value: item.status, tone: item.tone },
          { label: "محدوده", value: personaCopy[item.owner].scope },
          { label: "اثر ثبت", value: "دلیل + actor + زمان + revision" },
        ]} />
        <div className="flex flex-wrap justify-end gap-2">
          <ErpButton label="مشاهده تاریخچه" variant="outline" tone="neutral" onClick={() => onAct("تاریخچه فقط برای ارزیابی نمایش داده شد؛ داده‌ای ثبت نشد.")} />
          <ErpButton label={item.action} tone={item.tone === "danger" ? "danger" : "primary"} onClick={() => onAct(`اقدام «${item.action}» در این نمونه ثبت نمی‌شود.`)} />
        </div>
      </div>
    </ErpSection>
  );
}

function QueueVariant({ persona, selectedId, onSelect, onAct }: { persona: Persona; selectedId: string; onSelect: (id: string) => void; onAct: (message: string) => void }) {
  const visible = workItems.filter((item) => persona === "ADMIN" ? true : item.owner === persona);
  const selected = visible.find((item) => item.id === selectedId) || visible[0];
  return (
    <div className="space-y-4">
      <ErpMetricGrid items={[
        { label: "در انتظار اقدام من", value: visible.length.toLocaleString("fa-IR"), hint: "فقط actionهای مجاز", icon: FaClock, tone: "warning" },
        { label: "Partner فعال", value: "۲۴", hint: persona === "PARTNER" ? "فقط حساب خودم" : "در scope مؤثر", icon: FaUserCheck, tone: "success" },
        { label: "استعلام بدون responder", value: "۳", hint: "ارسال جدید متوقف است", icon: FaSearchDollar, tone: "danger" },
        { label: "درخواست انتقال", value: "۲", hint: "هویت ماسک‌شده", icon: FaExchangeAlt, tone: "info" },
      ]} />
      <div className="grid gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]">
        <ErpSection title="صف تصمیم" description="اولویت با مواردی است که فروش را fail-closed کرده‌اند.">
          <div className="space-y-2">{visible.map((item) => <PartnerDecisionRow key={item.id} item={item} selected={item.id === selected.id} onSelect={() => onSelect(item.id)} />)}</div>
        </ErpSection>
        <ActionPreview item={selected} onAct={onAct} />
      </div>
    </div>
  );
}

function ProfileVariant({ persona, profileIndex, onProfileChange, onAct }: { persona: Persona; profileIndex: number; onProfileChange: (index: number) => void; onAct: (message: string) => void }) {
  const profile = persona === "PARTNER" ? profiles[2] : profiles[profileIndex];
  return (
    <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <ErpSection title={persona === "PARTNER" ? "حساب تجاری من" : "فهرست Partnerها"} description="پرونده، نقطه ورود همه تصمیم‌های مربوط به یک Partner است.">
        <div className="space-y-2">
          {(persona === "PARTNER" ? [profile] : profiles).map((item, index) => (
            <ErpPressable key={item.name} type="button" onClick={() => onProfileChange(index)} variant={item.name === profile.name ? "soft" : "ghost"} tone={item.name === profile.name ? "primary" : "neutral"} className="flex min-h-14 w-full items-center justify-between px-3 text-right">
              <span><b className="block">{item.name}</b><small className="text-[var(--sds-text-secondary)]">{item.owner}</small></span>
              <ErpBadge tone={item.tone}>{item.lifecycle}</ErpBadge>
            </ErpPressable>
          ))}
        </div>
      </ErpSection>
      <div className="space-y-4">
        <ErpSection title={profile.name} description={`مالک تجاری: ${profile.owner}`} actions={[{ label: "مشاهده audit", variant: "outline", onClick: () => onAct("Audit projection متناسب با نقش نمایش داده شد.") }]}>
          <ErpSummaryGrid columns={3} items={[
            { label: "چرخه پروفایل", value: <ErpBadge tone={profile.tone}>{profile.lifecycle}</ErpBadge> },
            { label: "پاسخ‌دهنده قیمت", value: profile.responder },
            { label: "مانع جاری", value: profile.blockers, tone: profile.blockers === "—" ? "success" : "warning" },
          ]} />
        </ErpSection>
        <div className="grid gap-4 xl:grid-cols-2">
          <ErpSection title="راه‌اندازی و چرخه" description="هر domain فقط gate متعلق به خودش را تکمیل می‌کند.">
            <div className="space-y-3">
              {["هویت تجاری · HR", "شرایط پرداخت · Accounting", "شرایط تجاری · Sales", "پاسخ‌دهنده قیمت · Sales"].map((gate, index) => (
                <div key={gate} className="flex min-h-12 items-center justify-between gap-3 border-b border-[var(--sds-border-subtle)] py-2 last:border-0">
                  <span className="text-sm">{gate}</span><ErpBadge tone={index < 2 ? "success" : "warning"}>{index < 2 ? "تکمیل" : "ناقص"}</ErpBadge>
                </div>
              ))}
            </div>
          </ErpSection>
          <ErpSection title={persona === "PARTNER" ? "گزارش و حساب من" : "نمای مدیریتی"} description="هر عدد از projection مجاز خودش می‌آید.">
            <ErpSummaryGrid items={[
              { label: "فروش retail", value: `${profile.sales} پرونده`, hint: "درآمد سبلان نیست" },
              { label: "مانده به سبلان", value: profile.balance, hint: "read-only از Accounting" },
              { label: "وصول مشتری", value: "۷۴٪", hint: "خصوصی Partner / Sales management" },
              { label: "تحویل", value: "۳ در جریان", hint: "customer-safe status" },
            ]} />
          </ErpSection>
        </div>
      </div>
    </div>
  );
}

const lanes = [
  { owner: "HR", title: "هویت و lifecycle", icon: FaUserCheck, items: ["تکمیل هویت تجاری", "فعال‌سازی نهایی", "تعلیق / خاتمه"] },
  { owner: "SALES", title: "تجارت و CRM", icon: FaUsers, items: ["شرایط تجاری", "assignment پاسخ‌دهنده", "انتقال مالکیت مشتری"] },
  { owner: "ADMIN", title: "نظارت سراسری", icon: FaShieldAlt, items: ["aggregate reports", "audit حساس", "اقدام نام‌دار با دلیل"] },
  { owner: "PARTNER", title: "کسب‌وکار من", icon: FaWallet, items: ["گزارش شخصی", "وصول مشتری", "حساب من با سبلان"] },
] as const;

function LanesVariant({ persona, onAct }: { persona: Persona; onAct: (message: string) => void }) {
  const visible = persona === "ADMIN" ? lanes : lanes.filter((lane) => lane.owner === persona);
  return (
    <div className="space-y-4">
      <ErpInlineState kind="success" title="این چیدمان مرز اختیار را به‌جای صف یا پرونده، مستقیماً بر اساس workspace نشان می‌دهد." />
      <div className={`grid gap-4 ${visible.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {visible.map((lane) => {
          const Icon = lane.icon;
          return (
            <ErpSection key={lane.owner} title={<span className="flex items-center gap-2"><Icon aria-hidden="true" />{lane.title}</span>} description={`Scope: ${personaCopy[lane.owner].scope}`}>
              <div className="space-y-2">
                {lane.items.map((item, index) => (
                  <ErpPressable key={item} type="button" onClick={() => onAct(`سطح «${item}» برای بررسی باز شد؛ داده‌ای ثبت نشد.`)} variant="ghost" className="flex min-h-14 w-full items-center justify-between px-3 text-right">
                    <span>{item}</span><ErpBadge tone={index === 0 ? "warning" : "neutral"}>{index === 0 ? "۳ مورد" : "مشاهده"}</ErpBadge>
                  </ErpPressable>
                ))}
              </div>
            </ErpSection>
          );
        })}
      </div>
      <ErpSection title="کاتالوگ گزارش" description="گزارش‌ها mutation یا duty ایجاد نمی‌کنند؛ فقط projection نقش‌محورند.">
        <div className="grid gap-3 md:grid-cols-3">
          {[
            ["عملکرد Partner", "retail، خرید از سبلان، سود/زیان", "SALES / ADMIN"],
            ["حساب من با سبلان", "خرید، پرداخت، مانده و وضعیت امن", "PARTNER"],
            ["سلامت عملیاتی", "assignment، suspension و گلوگاه‌ها", "ADMIN"],
          ].map(([title, detail, scope]) => (
            <ErpCard key={title} className="p-4"><FaChartLine className="mb-3 text-[var(--sds-accent)]" /><b>{title}</b><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{detail}</p><ErpBadge tone="info">{scope}</ErpBadge></ErpCard>
          ))}
        </div>
      </ErpSection>
    </div>
  );
}

function PrototypeSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  const cycle = useCallback((delta: number) => {
    const index = variants.indexOf(variant);
    onChange(variants[(index + delta + variants.length) % variants.length]);
  }, [onChange, variant]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [cycle]);

  if (process.env.NODE_ENV === "production") return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[100] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-text-primary)] p-2 text-[var(--sds-surface-canvas)] shadow-xl" aria-label="تعویض طرح نمونه">
      <ErpIconButton label="طرح قبلی" onClick={() => cycle(-1)} icon={FaArrowRight} />
      <span className="min-w-36 text-center text-sm font-bold">{variant} · {variantNames[variant]}</span>
      <ErpIconButton label="طرح بعدی" onClick={() => cycle(1)} icon={FaArrowLeft} />
    </div>
  );
}

export default function PartnerManagementPrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedVariant = searchParams.get("variant")?.toUpperCase();
  const variant: Variant = requestedVariant === "B" || requestedVariant === "C" ? requestedVariant : "A";
  const requestedPersona = searchParams.get("persona")?.toUpperCase();
  const persona: Persona = requestedPersona === "HR" || requestedPersona === "SALES" || requestedPersona === "PARTNER" ? requestedPersona : "ADMIN";
  const [selectedId, setSelectedId] = useState("reassign");
  const [profileIndex, setProfileIndex] = useState(0);
  const [notice, setNotice] = useState("");

  const setQuery = useCallback((key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const stateSummary = useMemo(() => `${personaCopy[persona].title} · ${personaCopy[persona].scope}`, [persona]);

  return (
    <div dir="rtl" className="pb-24">
      <ErpPage
        eyebrow="نمونه آزمایشی · اطلاعات ذخیره نمی‌شود"
        title="مدیریت و گزارش فروشنده همکار"
        description={`طرح ${variant}: ${variantNames[variant]} · ${stateSummary}`}
        backHref="/dashboard/sales"
      >
        <ErpSection title="نقش ارزیابی" description={personaCopy[persona].boundary}>
          <ErpSegmentedControl options={personaOptions} value={persona} onChange={(value) => { setNotice(""); setQuery("persona", value); }} />
        </ErpSection>
        {notice ? <ErpInlineState kind="success" title={notice} action={{ label: "بستن", onClick: () => setNotice("") }} /> : null}
        {variant === "A" ? <QueueVariant persona={persona} selectedId={selectedId} onSelect={setSelectedId} onAct={setNotice} /> : null}
        {variant === "B" ? <ProfileVariant persona={persona} profileIndex={profileIndex} onProfileChange={setProfileIndex} onAct={setNotice} /> : null}
        {variant === "C" ? <LanesVariant persona={persona} onAct={setNotice} /> : null}
        <ErpCard className="p-3 text-xs text-[var(--sds-text-secondary)]">
          <b className="text-[var(--sds-text-primary)]">وضعیت کامل نمونه:</b> persona={persona} · scope={personaCopy[persona].scope} · variant={variant} · mutation=stub-only · selected={selectedId}
        </ErpCard>
      </ErpPage>
      <PrototypeSwitcher variant={variant} onChange={(next) => setQuery("variant", next)} />
    </div>
  );
}
