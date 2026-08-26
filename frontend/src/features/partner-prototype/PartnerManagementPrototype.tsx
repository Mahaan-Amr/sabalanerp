"use client";

import {
  ErpBadge, ErpButton, ErpIconButton, ErpNeumorphicCard,
  ErpNeumorphicInteractiveCard, ErpNeumorphicMetricGrid, ErpSegmentedControl,
} from "@/components/erp";
import { useTheme } from "@/contexts/ThemeContext";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  FaArrowLeft, FaArrowRight, FaBars, FaBell, FaBriefcase, FaChartLine,
  FaCheck, FaChevronLeft, FaClock, FaExchangeAlt, FaFileInvoiceDollar,
  FaHome, FaMoon, FaPause, FaSearch, FaSearchDollar, FaShieldAlt, FaSun,
  FaUser, FaUserCheck, FaUsers, FaWallet,
} from "react-icons/fa";

type Variant = "A" | "B" | "C";
type Persona = "ADMIN" | "HR" | "SALES" | "PARTNER";
type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "info" | "purple";
type Decision = { id: string; owner: Persona; title: string; partner: string; detail: string; status: string; tone: Tone; age: string; icon: typeof FaClock };

const variants: Variant[] = ["A", "B", "C"];
const variantNames: Record<Variant, string> = { A: "مرکز عملیات", B: "پرونده Partner", C: "گزارش و حساب" };
const personaOptions = [
  { value: "ADMIN" as const, label: "مدیر", icon: FaShieldAlt },
  { value: "HR" as const, label: "منابع انسانی", icon: FaUserCheck },
  { value: "SALES" as const, label: "فروش و CRM", icon: FaUsers },
  { value: "PARTNER" as const, label: "فروشنده همکار", icon: FaWallet },
];
const personaCopy: Record<Persona, { eyebrow: string; title: string; subtitle: string; scope: string }> = {
  ADMIN: { eyebrow: "فروش · کانال همکار", title: "مرکز فروشندگان همکار", subtitle: "مدیریت چرخه، مسئولیت‌ها و سلامت کانال فروش", scope: "دید سراسری شرکت" },
  HR: { eyebrow: "منابع انسانی · فروشنده همکار", title: "پروفایل‌های فروشنده همکار", subtitle: "هویت تجاری، فعال‌سازی و چرخه همکاری", scope: "محدوده مجاز منابع انسانی" },
  SALES: { eyebrow: "فروش و CRM · کانال همکار", title: "عملیات فروشندگان همکار", subtitle: "پاسخ‌دهنده قیمت، مشتریان و پرونده‌های تجاری", scope: "محدوده دپارتمان فروش" },
  PARTNER: { eyebrow: "فضای فروشنده همکار", title: "کسب‌وکار من", subtitle: "فروش، وصول مشتری و حساب من با سبلان", scope: "فقط اطلاعات حساب من" },
};
const decisions: Decision[] = [
  { id: "activation", owner: "HR", title: "تکمیل فعال‌سازی", partner: "سنگ آریا", detail: "شرایط پرداخت و پاسخ‌دهنده قیمت هنوز تکمیل نشده‌اند.", status: "۲ مانع", tone: "warning", age: "از دیروز", icon: FaUserCheck },
  { id: "suspension", owner: "HR", title: "بررسی درخواست تعلیق", partner: "پارس سازه", detail: "۴ پرونده قطعی پس از تعلیق برای حسابداری و تحویل ادامه می‌یابد.", status: "نیازمند تصمیم", tone: "danger", age: "۴۵ دقیقه", icon: FaPause },
  { id: "assignment", owner: "SALES", title: "تعیین پاسخ‌دهنده قیمت", partner: "گروه سپید", detail: "ارسال استعلام جدید تا assignment رسمی متوقف است.", status: "فوری", tone: "danger", age: "۲ ساعت", icon: FaSearchDollar },
  { id: "transfer", owner: "SALES", title: "درخواست انتقال مشتری", partner: "سنگ آریا", detail: "مریم احمدی · شخص حقیقی · تهران · تلفن •••• ۴۸۱۲", status: "بررسی CRM", tone: "info", age: "امروز", icon: FaExchangeAlt },
  { id: "audit", owner: "ADMIN", title: "بازبینی اقدام حساس", partner: "پارس سازه", detail: "تعلیق، scope و revision مؤثر در audit trail ثبت شده‌اند.", status: "بدون تعارض", tone: "success", age: "امروز", icon: FaShieldAlt },
  { id: "inquiry", owner: "PARTNER", title: "استعلام‌های نزدیک انقضا", partner: "حساب من", detail: "۲ ردیف تا کمتر از شش ساعت دیگر منقضی می‌شوند.", status: "۲ مورد", tone: "warning", age: "تا ۵ ساعت", icon: FaClock },
];
const profiles = [
  { name: "سنگ آریا", person: "علی اکبری", initials: "س‌آ", lifecycle: "در انتظار تکمیل", tone: "warning" as Tone, responder: "تعیین نشده", blocker: "۲ درگاه ناقص", cases: "۰", balance: "۰ ریال", city: "تهران" },
  { name: "پارس سازه", person: "نازنین یوسفی", initials: "پ‌س", lifecycle: "معلق", tone: "danger" as Tone, responder: "سارا محمدی", blocker: "بررسی تعلیق", cases: "۱۲", balance: "۳۲۰ میلیون ریال", city: "کرج" },
  { name: "گروه سپید", person: "حسین رضایی", initials: "گ‌س", lifecycle: "فعال", tone: "success" as Tone, responder: "فاقد پاسخ‌دهنده فعال", blocker: "بازانتساب", cases: "۸", balance: "۱۶۰ میلیون ریال", city: "تهران" },
];
const toneSurface: Record<Tone, string> = { neutral: "sds-tone-neutral", primary: "sds-tone-primary", success: "sds-tone-success", warning: "sds-tone-warning", danger: "sds-tone-danger", info: "sds-tone-info", purple: "sds-tone-purple" };

function PrototypeFrame({ children }: { children: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const rail = [FaHome, FaChartLine, FaUsers, FaBriefcase, FaFileInvoiceDollar];
  return <div className="sds-neumorphic-scope min-h-screen bg-[var(--sds-surface-canvas)] text-[var(--sds-text-primary)]">
    <header className="sds-dashboard-topbar sticky top-0 z-40 flex h-16 items-center justify-between px-4 lg:pr-28">
      <div className="flex items-center gap-3"><ErpIconButton label="منو" icon={FaBars} /><div className="sds-dashboard-brand h-11 w-11 overflow-hidden rounded-xl">{/* eslint-disable-next-line @next/next/no-img-element */}<img src="/brand/logo-project.png" alt="Sabalan ERP" className="h-full w-full object-cover" /></div><div><p className="text-lg font-black">فروش</p><p className="text-xs text-[var(--sds-text-muted)]">مدیریت فروش و قراردادها</p></div></div>
      <div className="flex items-center gap-1"><ErpIconButton label={theme === "dark" ? "حالت روشن" : "حالت تیره"} icon={theme === "dark" ? FaSun : FaMoon} onClick={() => setTheme(theme === "dark" ? "light" : "dark")} /><ErpIconButton label="اعلان‌ها" icon={FaBell} /><ErpIconButton label="حساب کاربری" icon={FaUser} /></div>
    </header>
    <aside className="sds-dashboard-sidebar fixed bottom-0 right-0 top-16 z-30 hidden w-20 flex-col items-center py-4 lg:flex">{rail.map((Icon, index) => <span key={index} className={`sds-dashboard-nav-icon mb-3 inline-flex h-12 w-12 items-center justify-center ${index === 1 ? "sds-dashboard-nav-active" : ""}`}><Icon /></span>)}</aside>
    <main className="mx-auto w-full max-w-[1540px] px-4 pb-32 pt-6 sm:px-6 lg:pr-28 xl:px-10">{children}</main>
    <nav className="sds-neumorphic-bottom-nav fixed inset-x-3 bottom-3 z-30 grid grid-cols-5 p-1.5 lg:hidden" aria-label="ناوبری نمونه">{["داشبورد", "Partnerها", "استعلام", "گزارش", "حساب من"].map((label, index) => <span key={label} className={`flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl text-[11px] font-bold ${index === 1 ? "bg-[var(--sds-accent-soft)] text-[var(--sds-accent)]" : "text-[var(--sds-text-secondary)]"}`}>{index === 0 ? <FaHome /> : index === 1 ? <FaUsers /> : index === 2 ? <FaSearchDollar /> : index === 3 ? <FaChartLine /> : <FaWallet />}{label}</span>)}</nav>
  </div>;
}

function PageHeading({ persona }: { persona: Persona }) {
  const copy = personaCopy[persona];
  return <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-xs font-bold text-[var(--sds-accent)]">{copy.eyebrow}</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">{copy.title}</h1><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{copy.subtitle}</p></div><ErpBadge tone="info">{copy.scope}</ErpBadge></div>;
}

function PersonaControl({ persona, onChange }: { persona: Persona; onChange: (value: Persona) => void }) {
  return <ErpNeumorphicCard className="p-2.5"><div className="mb-2 flex items-center justify-between px-1"><span className="text-xs font-bold text-[var(--sds-text-muted)]">نمایش نمونه برای</span><span className="text-xs text-[var(--sds-text-muted)]">داده آزمایشی</span></div><ErpSegmentedControl options={personaOptions} value={persona} onChange={onChange} /></ErpNeumorphicCard>;
}

function DecisionItem({ item, selected, onClick }: { item: Decision; selected: boolean; onClick: () => void }) {
  const Icon = item.icon;
  return <ErpNeumorphicInteractiveCard onClick={onClick} className={`flex min-h-20 w-full items-center gap-3 p-3 text-right ${selected ? "outline outline-2 outline-[var(--sds-accent)]" : ""}`}><span className={`sds-neumorphic-icon sds-tone-surface inline-flex h-11 w-11 shrink-0 items-center justify-center ${toneSurface[item.tone]}`}><Icon /></span><span className="min-w-0 flex-1"><span className="block font-bold">{item.title}</span><span className="mt-1 block truncate text-xs text-[var(--sds-text-muted)]">{item.partner} · {item.age}</span></span><ErpBadge tone={item.tone}>{item.status}</ErpBadge></ErpNeumorphicInteractiveCard>;
}

function OperationsView({ persona }: { persona: Persona }) {
  const visible = decisions.filter((item) => persona === "ADMIN" || item.owner === persona);
  const [selectedId, setSelectedId] = useState(visible[0]?.id || "activation");
  const selected = visible.find((item) => item.id === selectedId) || visible[0];
  useEffect(() => setSelectedId(visible[0]?.id || "activation"), [persona]);
  const SelectedIcon = selected?.icon;
  return <div className="space-y-5">
    <ErpNeumorphicMetricGrid items={[
      { id: "active", label: persona === "PARTNER" ? "پرونده‌های فعال من" : "Partner فعال", value: persona === "PARTNER" ? "۸" : "۲۴", icon: FaUserCheck, tone: "success", hint: "در محدوده مجاز" },
      { id: "waiting", label: "در انتظار اقدام", value: visible.length.toLocaleString("fa-IR"), icon: FaClock, tone: "warning", hint: "اولویت‌بندی‌شده" },
      { id: "responder", label: "بدون پاسخ‌دهنده", value: persona === "PARTNER" ? "—" : "۳", icon: FaSearchDollar, tone: "danger", hint: "ارسال استعلام متوقف" },
      { id: "transfer", label: persona === "PARTNER" ? "مانده به سبلان" : "درخواست انتقال", value: persona === "PARTNER" ? "۴۸۰ م.ر" : "۲", icon: persona === "PARTNER" ? FaWallet : FaExchangeAlt, tone: "info", hint: persona === "PARTNER" ? "به‌روز از حسابداری" : "projection محدود" },
    ]} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(20rem,.8fr)]">
      <ErpNeumorphicCard className="p-4 sm:p-5"><div className="mb-4 flex items-center justify-between"><div><h2 className="text-lg font-black">صف عملیات</h2><p className="mt-1 text-sm text-[var(--sds-text-muted)]">مواردی که بدون تصمیم متوقف مانده‌اند</p></div><ErpButton label="مشاهده همه" variant="ghost" /></div><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">{visible.map((item) => <DecisionItem key={item.id} item={item} selected={item.id === selected?.id} onClick={() => setSelectedId(item.id)} />)}</div></ErpNeumorphicCard>
      {selected && SelectedIcon ? <ErpNeumorphicCard className="p-5"><div className="flex items-start justify-between gap-3"><span className={`sds-neumorphic-icon sds-tone-surface inline-flex h-12 w-12 items-center justify-center ${toneSurface[selected.tone]}`}><SelectedIcon /></span><ErpBadge tone={selected.tone}>{selected.status}</ErpBadge></div><h2 className="mt-5 text-xl font-black">{selected.title}</h2><p className="mt-1 font-bold text-[var(--sds-accent)]">{selected.partner}</p><p className="mt-4 leading-7 text-[var(--sds-text-secondary)]">{selected.detail}</p><div className="my-5 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[var(--sds-surface-subtle)] p-3"><span className="text-xs text-[var(--sds-text-muted)]">مالک اقدام</span><b className="mt-1 block">{personaOptions.find((item) => item.value === selected.owner)?.label}</b></div><div className="rounded-xl bg-[var(--sds-surface-subtle)] p-3"><span className="text-xs text-[var(--sds-text-muted)]">زمان انتظار</span><b className="mt-1 block">{selected.age}</b></div></div><ErpButton label="بازکردن پرونده" icon={FaChevronLeft} tone="primary" className="w-full" /></ErpNeumorphicCard> : null}
    </div>
  </div>;
}

function PartnerDirectoryView({ persona }: { persona: Persona }) {
  const [index, setIndex] = useState(persona === "PARTNER" ? 2 : 0);
  const profile = persona === "PARTNER" ? profiles[2] : profiles[index];
  return <div className="grid min-w-0 gap-5 xl:grid-cols-[22rem_minmax(0,1fr)]"><div className="min-w-0 space-y-4"><ErpNeumorphicCard className="flex items-center gap-3 p-3"><FaSearch className="text-[var(--sds-text-muted)]" /><span className="text-sm text-[var(--sds-text-muted)]">جست‌وجوی نام، مسئول یا شهر…</span></ErpNeumorphicCard><div className="flex min-w-0 gap-3 overflow-x-auto pb-2 xl:block xl:space-y-3 xl:overflow-visible">{(persona === "PARTNER" ? [profile] : profiles).map((item, itemIndex) => <ErpNeumorphicInteractiveCard key={item.name} onClick={() => setIndex(itemIndex)} className={`min-w-[16rem] p-4 text-right xl:w-full ${item.name === profile.name ? "outline outline-2 outline-[var(--sds-accent)]" : ""}`}><div className="flex items-center gap-3"><span className="sds-neumorphic-icon inline-flex h-12 w-12 items-center justify-center bg-[var(--sds-accent-soft)] font-black text-[var(--sds-accent)]">{item.initials}</span><span className="min-w-0 flex-1"><b className="block text-base">{item.name}</b><small className="text-[var(--sds-text-muted)]">{item.person} · {item.city}</small></span><ErpBadge tone={item.tone}>{item.lifecycle}</ErpBadge></div></ErpNeumorphicInteractiveCard>)}</div></div>
    <div className="min-w-0 space-y-5"><ErpNeumorphicCard className="p-5 sm:p-6"><div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-4"><span className="sds-neumorphic-icon inline-flex h-16 w-16 items-center justify-center bg-[var(--sds-accent-soft)] text-xl font-black text-[var(--sds-accent)]">{profile.initials}</span><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-2xl font-black">{profile.name}</h2><ErpBadge tone={profile.tone}>{profile.lifecycle}</ErpBadge></div><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">{profile.person} · {profile.city}</p></div></div><div className="flex gap-2"><ErpButton label="تاریخچه" variant="outline" /><ErpButton label="اقدام جدید" /></div></div><div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">{[["پاسخ‌دهنده", profile.responder], ["مانع جاری", profile.blocker], ["پرونده قطعی", profile.cases], ["مانده", profile.balance]].map(([label, value]) => <div key={label} className="rounded-xl bg-[var(--sds-surface-subtle)] p-4"><span className="text-xs text-[var(--sds-text-muted)]">{label}</span><b className="mt-2 block text-sm">{value}</b></div>)}</div></ErpNeumorphicCard>
      <div className="grid gap-5 lg:grid-cols-2"><ErpNeumorphicCard className="p-5"><h3 className="text-lg font-black">درگاه‌های فعال‌سازی</h3><div className="mt-4 space-y-4">{[["هویت تجاری", "HR", true], ["شرایط پرداخت", "Accounting", true], ["شرایط تجاری", "Sales", false], ["پاسخ‌دهنده قیمت", "Sales", false]].map(([label, owner, done]) => <div key={String(label)} className="flex items-center gap-3"><span className={`inline-flex h-9 w-9 items-center justify-center rounded-full ${done ? "bg-[var(--sds-success-surface)] text-[var(--sds-success)]" : "bg-[var(--sds-warning-surface)] text-[var(--sds-warning)]"}`}>{done ? <FaCheck /> : <FaClock />}</span><span className="flex-1"><b className="block text-sm">{label}</b><small className="text-[var(--sds-text-muted)]">{owner}</small></span><ErpBadge tone={done ? "success" : "warning"}>{done ? "تکمیل" : "ناقص"}</ErpBadge></div>)}</div></ErpNeumorphicCard><ErpNeumorphicCard className="p-5"><h3 className="text-lg font-black">فعالیت اخیر</h3><div className="mt-4 space-y-4">{["درخواست انتقال مشتری ثبت شد", "پاسخ‌دهنده قبلی غیرفعال شد", "پرداخت حسابداری ثبت شد"].map((label, row) => <div key={label} className="flex gap-3 border-b border-[var(--sds-border-subtle)] pb-4 last:border-0"><span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--sds-accent)]" /><span><b className="block text-sm">{label}</b><small className="text-[var(--sds-text-muted)]">{row === 0 ? "امروز، ۱۰:۴۵" : row === 1 ? "دیروز" : "۳ روز پیش"}</small></span></div>)}</div></ErpNeumorphicCard></div>
    </div></div>;
}

function ReportBar({ label, value, width }: { label: string; value: string; width: string }) {
  return <div><div className="mb-2 flex items-center justify-between text-sm"><span>{label}</span><b>{value}</b></div><div className="h-2 overflow-hidden rounded-full bg-[var(--sds-surface-subtle)]"><div className="h-full rounded-full bg-[var(--sds-accent)]" style={{ width }} /></div></div>;
}

function ReportingView({ persona }: { persona: Persona }) {
  const partner = persona === "PARTNER";
  return <div className="space-y-5"><ErpNeumorphicCard className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"><ErpSegmentedControl value="month" onChange={() => undefined} options={[{ value: "week", label: "۷ روز" }, { value: "month", label: "ماه جاری" }, { value: "quarter", label: "فصل جاری" }]} /><ErpButton label="خروجی گزارش" icon={FaChartLine} variant="outline" /></ErpNeumorphicCard>
    <ErpNeumorphicMetricGrid items={[{ id: "retail", label: partner ? "فروش من" : "فروش retail Partnerها", value: "۱٫۸ میلیارد", icon: FaChartLine, tone: "primary", hint: "درآمد سبلان نیست" }, { id: "purchase", label: "خرید از سبلان", value: "۱٫۳ میلیارد", icon: FaBriefcase, tone: "info", hint: "wholesale قطعی" }, { id: "margin", label: partner ? "سود بازفروش من" : "سود بازفروش", value: "۴۸۰ میلیون", icon: FaWallet, tone: "success", hint: partner ? "خصوصی حساب من" : "فقط مدیریت مجاز" }, { id: "balance", label: "مانده به سبلان", value: "۲۶۰ میلیون", icon: FaFileInvoiceDollar, tone: "warning", hint: "از حقیقت حسابداری" }]} />
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,.8fr)]"><ErpNeumorphicCard className="p-5"><div className="flex items-center justify-between"><div><h2 className="text-lg font-black">روند فروش و خرید</h2><p className="mt-1 text-sm text-[var(--sds-text-muted)]">مقایسه هفتگی مبالغ قطعی</p></div><ErpBadge tone="success">+۱۲٪</ErpBadge></div><div className="mt-8 flex h-64 items-end justify-between gap-3 border-b border-[var(--sds-border-default)] px-2">{[42, 58, 49, 76, 68, 88, 81].map((height, index) => <div key={index} className="flex h-full flex-1 items-end justify-center gap-1"><span className="w-2.5 rounded-t-full bg-[var(--sds-accent)] sm:w-4" style={{ height: `${height}%` }} /><span className="w-2.5 rounded-t-full bg-[var(--sds-info)] opacity-45 sm:w-4" style={{ height: `${Math.max(22, height - 24)}%` }} /></div>)}</div><div className="mt-3 flex justify-between text-xs text-[var(--sds-text-muted)]"><span>هفته اول</span><span>هفته هفتم</span></div></ErpNeumorphicCard><ErpNeumorphicCard className="p-5"><h2 className="text-lg font-black">وضعیت وصول</h2><p className="mt-1 text-sm text-[var(--sds-text-muted)]">دو جریان مستقل پرداخت</p><div className="mt-6 space-y-6"><ReportBar label="وصول از مشتری" value="۷۴٪" width="74%" /><ReportBar label="پرداخت به سبلان" value="۶۲٪" width="62%" /><ReportBar label="پرونده‌های تحویل‌شده" value="۸۱٪" width="81%" /></div><div className="mt-7 rounded-xl bg-[var(--sds-warning-surface)] p-4 text-sm leading-6 text-[var(--sds-warning)]">وصول مشتری، مانده Partner به سبلان را کاهش نمی‌دهد.</div></ErpNeumorphicCard></div>
    <ErpNeumorphicCard className="p-5"><h2 className="text-lg font-black">ترکیب عملکرد</h2><div className="mt-4 grid gap-5 md:grid-cols-3"><ReportBar label="سنگ اسلب" value="۴۲٪" width="42%" /><ReportBar label="سنگ طولی" value="۳۵٪" width="35%" /><ReportBar label="پله" value="۲۳٪" width="23%" /></div></ErpNeumorphicCard>
  </div>;
}

function PrototypeSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  const cycle = useCallback((delta: number) => { const index = variants.indexOf(variant); onChange(variants[(index + delta + variants.length) % variants.length]); }, [onChange, variant]);
  useEffect(() => { const handler = (event: KeyboardEvent) => { if ((event.target as HTMLElement)?.matches("input, textarea, select, [contenteditable='true']")) return; if (event.key === "ArrowLeft") cycle(-1); if (event.key === "ArrowRight") cycle(1); }; window.addEventListener("keydown", handler); return () => window.removeEventListener("keydown", handler); }, [cycle]);
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_PROTOTYPES !== "1") return null;
  return <div className="sds-neumorphic-card fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 p-1.5 shadow-xl lg:bottom-5"><ErpIconButton label="طرح قبلی" icon={FaArrowRight} onClick={() => cycle(-1)} /><span className="min-w-36 text-center text-xs font-black">{variant} · {variantNames[variant]}</span><ErpIconButton label="طرح بعدی" icon={FaArrowLeft} onClick={() => cycle(1)} /></div>;
}

export default function PartnerManagementPrototype({ standalone = false }: { standalone?: boolean }) {
  const router = useRouter(); const pathname = usePathname(); const searchParams = useSearchParams();
  const requestedVariant = searchParams.get("variant")?.toUpperCase(); const variant: Variant = requestedVariant === "B" || requestedVariant === "C" ? requestedVariant : "A";
  const requestedPersona = searchParams.get("persona")?.toUpperCase(); const persona: Persona = requestedPersona === "HR" || requestedPersona === "SALES" || requestedPersona === "PARTNER" ? requestedPersona : "ADMIN";
  const setQuery = useCallback((key: string, value: string) => { const next = new URLSearchParams(searchParams.toString()); next.set(key, value); router.replace(`${pathname}?${next.toString()}`, { scroll: false }); }, [pathname, router, searchParams]);
  const content = <div className="space-y-5"><PageHeading persona={persona} /><PersonaControl persona={persona} onChange={(value) => setQuery("persona", value)} />{variant === "A" ? <OperationsView persona={persona} /> : variant === "B" ? <PartnerDirectoryView persona={persona} /> : <ReportingView persona={persona} />}<PrototypeSwitcher variant={variant} onChange={(value) => setQuery("variant", value)} /></div>;
  return standalone ? <PrototypeFrame>{content}</PrototypeFrame> : <div className="sds-neumorphic-scope pb-24">{content}</div>;
}
