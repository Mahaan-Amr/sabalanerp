"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FaArrowLeft,
  FaArrowRight,
  FaCheck,
  FaClock,
  FaEdit,
  FaExclamationTriangle,
  FaEye,
  FaFlag,
  FaHistory,
  FaLock,
  FaRedo,
  FaShieldAlt,
  FaTimes,
  FaUserCheck,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpActionMenu,
  ErpButton,
  ErpCard,
  ErpField,
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
type Persona = "supervisor" | "reviewer" | "dual";
type Scenario = "draft" | "ready" | "review" | "rejected" | "accepted" | "overdue";
type Decision = "accept" | "reject" | "nonEvaluable" | "extend" | "cancel" | "correct";

type MissionSection = {
  id: string;
  title: string;
  range: string;
  supervisor: string;
  status: "accepted" | "active" | "waiting" | "rejected";
  version: number;
};

const variants: Array<{ id: Variant; label: string; note: string }> = [
  { id: "A", label: "راهنمای مرحله‌ای", note: "اقدام بعدی روشن" },
  { id: "B", label: "پرونده و خط زمانی", note: "چرایی و سابقه روشن" },
  { id: "C", label: "میز کار دوپنجره‌ای", note: "بررسی پرتعداد سریع" },
  { id: "D", label: "ترکیب توافق‌شده", note: "تطبیقی بر پایه اختیار" },
];

const scenarioLabels: Record<Scenario, string> = {
  draft: "پیش‌نویس در جریان",
  ready: "بخش پایان‌یافته و آماده ارسال",
  review: "ارسال‌شده و در انتظار بررسی",
  rejected: "ردشده و آماده ارسال مجدد",
  accepted: "پذیرفته‌شده",
  overdue: "بررسی عقب‌افتاده",
};

const scenarioTone: Record<Scenario, "neutral" | "info" | "success" | "warning" | "danger"> = {
  draft: "neutral",
  ready: "info",
  review: "warning",
  rejected: "danger",
  accepted: "success",
  overdue: "danger",
};

const sections: MissionSection[] = [
  { id: "s1", title: "آماده‌سازی و برنامه‌ریزی", range: "۱ تا ۲۵ خرداد ۱۴۰۵", supervisor: "محمد مرادی", status: "accepted", version: 1 },
  { id: "s2", title: "اجرای مأموریت فروش", range: "۲۶ خرداد تا ۲۰ مرداد ۱۴۰۵", supervisor: "محمد مرادی", status: "active", version: 2 },
  { id: "s3", title: "تحویل و جمع‌بندی", range: "۲۱ تا ۳۱ مرداد ۱۴۰۵", supervisor: "لیلا رضایی", status: "waiting", version: 1 },
];

const decisionLabels: Record<Decision, string> = {
  accept: "پذیرش بدون ویرایش",
  reject: "رد برای بازنگری سرپرست",
  nonEvaluable: "غیرقابل‌ارزیابی در این دوره",
  extend: "تمدید مهلت",
  cancel: "لغو ارزیابی",
  correct: "آغاز اصلاح زمینه",
};

function StatusBadge({ scenario }: { scenario: Scenario }) {
  return <ErpBadge tone={scenarioTone[scenario]}>{scenarioLabels[scenario]}</ErpBadge>;
}

function AuthorityNotice({ persona }: { persona: Persona }) {
  if (persona === "dual") {
    return (
      <ErpCard tone="warning" className="flex items-start gap-3 p-4">
        <FaShieldAlt className="mt-1 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-bold">هر دو اختیار مؤثر برای همین شخص فعال است</p>
          <p className="mt-1 text-sm leading-7 text-[var(--sds-text-secondary)]">محمد مرادی می‌تواند ارسال خودش را بررسی کند. تصمیم با نشان «خودبررسی» و دو اختیار مستقل در سابقه ثبت می‌شود؛ تأیید شخص دوم لازم نیست.</p>
        </div>
      </ErpCard>
    );
  }
  return (
    <ErpCard tone="info" className="flex items-start gap-3 p-4">
      <FaUserCheck className="mt-1 shrink-0" aria-hidden="true" />
      <div>
        <p className="font-bold">نمای {persona === "supervisor" ? "سرپرست مسئول" : "بازبین مجاز منابع انسانی"}</p>
        <p className="mt-1 text-sm text-[var(--sds-text-secondary)]">دسترسی فقط از اختیار مؤثر همین ارزیابی می‌آید و با دسترسی عمومی به فضای کاری جایگزین نمی‌شود.</p>
      </div>
    </ErpCard>
  );
}

function PrototypeControls({ persona, scenario, onPersona, onScenario }: { persona: Persona; scenario: Scenario; onPersona: (value: Persona) => void; onScenario: (value: Scenario) => void }) {
  return (
    <ErpCard className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
      <ErpField label="نقش نمایشی در نمونه">
        <ErpSegmentedControl
          value={persona}
          onChange={onPersona}
          options={[
            { value: "supervisor", label: "سرپرست" },
            { value: "reviewer", label: "منابع انسانی" },
            { value: "dual", label: "هر دو اختیار" },
          ]}
        />
      </ErpField>
      <ErpField label="وضعیت پرونده برای آزمایش">
        <ErpSelect value={scenario} onChange={(event) => onScenario(event.target.value as Scenario)}>
          {(Object.keys(scenarioLabels) as Scenario[]).map((id) => <option key={id} value={id}>{scenarioLabels[id]}</option>)}
        </ErpSelect>
      </ErpField>
    </ErpCard>
  );
}

function SectionCards({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  return (
    <div className="space-y-2">
      {sections.map((section, index) => {
        const active = selected === section.id;
        const label = section.status === "accepted" ? "پذیرفته‌شده" : section.status === "active" ? "نیازمند اقدام" : "هنوز آغاز نشده";
        const tone = section.status === "accepted" ? "success" : section.status === "active" ? "warning" : "neutral";
        return (
          <ErpPressable key={section.id} type="button" onClick={() => onSelect(section.id)} tone={active ? "primary" : "neutral"} variant={active ? "soft" : "outline"} className="w-full p-4 text-right">
            <span className="flex items-start justify-between gap-3">
              <span><span className="block text-xs text-[var(--sds-text-muted)]">بخش {(index + 1).toLocaleString("fa-IR")} · نسخه {section.version.toLocaleString("fa-IR")}</span><span className="mt-1 block font-bold">{section.title}</span><span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{section.range}</span></span>
              <ErpBadge tone={tone}>{label}</ErpBadge>
            </span>
          </ErpPressable>
        );
      })}
    </div>
  );
}

function CriterionSnapshot({ compact = false }: { compact?: boolean }) {
  const rows = [
    { title: "تحقق هدف بخش", value: "خوب · ۴ از ۵", evidence: "گزارش فروش منطقه شمال" },
    { title: "کیفیت اجرا", value: "قابل‌قبول · ۳ از ۵", evidence: "صورت‌جلسه تحویل" },
    { title: "همکاری بین‌واحدی", value: "بسیار خوب · ۵ از ۵", evidence: "بازخورد مدیر برنامه‌ریزی" },
  ];
  return (
    <div className="space-y-2">
      {rows.map((row) => <ErpCard key={row.title} className={compact ? "p-3" : "p-4"}><div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between"><div><p className="font-bold">{row.title}</p><p className="mt-1 text-xs text-[var(--sds-text-muted)]">شاهد: {row.evidence}</p></div><ErpBadge tone="info" variant="outline">{row.value}</ErpBadge></div></ErpCard>)}
    </div>
  );
}

function SupervisorActions({ scenario, onNotice }: { scenario: Scenario; onNotice: (message: string) => void }) {
  if (scenario === "draft") return <div className="flex flex-wrap gap-2"><ErpButton label="ذخیره پیش‌نویس" icon={FaEdit} onClick={() => onNotice("پیش‌نویس ذخیره شد؛ هنوز برای منابع انسانی قابل بررسی نیست.")} /><ErpButton label="بررسی کامل‌بودن" icon={FaCheck} variant="outline" onClick={() => onNotice("دو معیار کامل است؛ برای یک معیار هنوز شاهد الزامی ثبت نشده است.")} /></div>;
  if (scenario === "ready" || scenario === "rejected") return <div className="flex flex-wrap gap-2"><ErpButton label={scenario === "rejected" ? "بازبینی و ارسال نسخه ۳" : "اعتبارسنجی و ارسال"} icon={FaCheck} tone="success" onClick={() => onNotice("Prototype: backend اختیار، زمینه، معیارها، شواهد و محاسبه را دوباره کنترل می‌کند و سپس نسخه تغییرناپذیر می‌سازد.")} /><ErpButton label="ادامه ویرایش" icon={FaEdit} variant="outline" onClick={() => onNotice("ویرایش فقط پیش از ارسال این نسخه مجاز است.")} /></div>;
  return <ErpCard tone="info" className="p-4 text-sm">نسخه ارسال‌شده تغییرناپذیر است. سرپرست فقط تصمیم و مهلت را دنبال می‌کند؛ ویرایش مستقیم ممکن نیست.</ErpCard>;
}

function ReviewerActions({ scenario, onOpen, disabled = false, condensed = false }: { scenario: Scenario; onOpen: (decision: Decision) => void; disabled?: boolean; condensed?: boolean }) {
  if (!(["review", "overdue"] as Scenario[]).includes(scenario)) return <ErpCard className="p-4 text-sm">در این وضعیت تصمیم تازه‌ای برای بازبین فعال نیست.</ErpCard>;
  const secondaryActions = [
    { label: "تمدید مهلت", icon: FaClock, onClick: () => onOpen("extend"), disabled },
    { label: "آغاز اصلاح زمینه", icon: FaRedo, onClick: () => onOpen("correct"), disabled },
    { label: "لغو ارزیابی", icon: FaTimes, tone: "danger" as const, onClick: () => onOpen("cancel"), disabled },
  ];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <ErpButton label="پذیرش بدون ویرایش" icon={FaCheck} tone="success" disabled={disabled} onClick={() => onOpen("accept")} />
        <ErpButton label="رد برای بازنگری" icon={FaTimes} tone="danger" variant="outline" disabled={disabled} onClick={() => onOpen("reject")} />
        <ErpButton label="غیرقابل‌ارزیابی" icon={FaFlag} tone="warning" variant="outline" disabled={disabled} onClick={() => onOpen("nonEvaluable")} />
        {condensed ? <ErpActionMenu label="اقدامات بیشتر" actions={secondaryActions} /> : null}
      </div>
      {!condensed ? <div className="flex flex-wrap gap-2">
        <ErpButton label="تمدید مهلت" icon={FaClock} tone="neutral" variant="ghost" onClick={() => onOpen("extend")} />
        <ErpButton label="آغاز اصلاح زمینه" icon={FaRedo} tone="neutral" variant="ghost" onClick={() => onOpen("correct")} />
        <ErpButton label="لغو ارزیابی" icon={FaTimes} tone="danger" variant="ghost" onClick={() => onOpen("cancel")} />
      </div> : null}
      {disabled ? <p className="text-xs text-[var(--sds-text-muted)]">برای فعال‌شدن تصمیم‌ها، بررسی را تصاحب کنید.</p> : null}
    </div>
  );
}

function RejectionExplanation() {
  return (
    <ErpCard tone="danger" className="p-4">
      <div className="flex items-start gap-3"><FaExclamationTriangle className="mt-1 shrink-0" aria-hidden="true" /><div><p className="font-bold">نسخه ۲ برای بازنگری رد شد</p><p className="mt-2 text-sm leading-7">دسته: شاهد ناکافی · معیار «کیفیت اجرا»</p><p className="text-sm leading-7 text-[var(--sds-text-secondary)]">صورت‌جلسه پیوست، تحویل نهایی این بخش را نشان نمی‌دهد. شاهد مرتبط را جایگزین یا درباره نبود آن توضیح دهید.</p><p className="mt-2 text-xs text-[var(--sds-text-muted)]">نسخه قبلی تغییر نمی‌کند؛ نسخه تازه با پیوند جانشینی ساخته می‌شود.</p></div></div>
    </ErpCard>
  );
}

function VariantA({ persona, scenario, selected, onSelected, onDecision, onNotice }: VariantProps) {
  const isSupervisor = persona === "supervisor" || persona === "dual";
  const isReviewer = persona === "reviewer" || persona === "dual";
  return (
    <div className="grid gap-4 xl:grid-cols-[300px_minmax(0,1fr)_300px]">
      <aside><ErpSection title="بخش‌های مأموریت" description="هر بخش پس از پایان خودش مستقل ارسال می‌شود."><SectionCards selected={selected} onSelect={onSelected} /></ErpSection></aside>
      <main className="space-y-4">
        <ErpSection title="اجرای مأموریت فروش" description="علی احمدی · کارشناس فروش · بخش پایان‌یافته در ۲۰ مرداد ۱۴۰۵">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><StatusBadge scenario={scenario} /><ErpBadge tone="neutral" variant="outline">نسخه ۲ · Snapshot قفل‌شده پس از ارسال</ErpBadge></div>
          {scenario === "rejected" ? <RejectionExplanation /> : null}
          <div className="mt-4"><CriterionSnapshot /></div>
        </ErpSection>
        {isSupervisor ? <ErpSection title="اقدام سرپرست"><SupervisorActions scenario={scenario} onNotice={onNotice} /></ErpSection> : null}
        {isReviewer ? <ErpSection title="تصمیم منابع انسانی" description="امتیاز، روایت و شواهد سرپرست در این نما قابل ویرایش نیست."><ReviewerActions scenario={scenario} onOpen={onDecision} /></ErpSection> : null}
      </main>
      <aside className="space-y-4"><ErpCard tone={scenario === "overdue" ? "danger" : "warning"} className="p-4"><p className="font-bold">{scenario === "overdue" ? "۲ روز از مهلت بررسی گذشته" : "مهلت فعلی"}</p><p className="mt-2 text-sm">۲۷ مرداد ۱۴۰۵ · ساعت تهران</p><p className="mt-1 text-xs text-[var(--sds-text-muted)]">عبور از موعد تصمیم خودکار ایجاد نمی‌کند.</p></ErpCard><ErpCard className="p-4"><p className="font-bold">اثر بر نتیجه</p><p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">تا تعیین تکلیف همه بخش‌ها هیچ Badge، رتبه یا نتیجه‌ای منتشر نمی‌شود.</p></ErpCard></aside>
    </div>
  );
}

function TimelineItem({ title, detail, active, done }: { title: string; detail: string; active?: boolean; done?: boolean }) {
  return <li className="relative grid grid-cols-[36px_1fr] gap-3 pb-7 last:pb-0"><span className={`relative z-10 flex h-9 w-9 items-center justify-center rounded-full border ${done ? "sds-tone-success bg-[var(--sds-tone-surface)] text-[var(--sds-tone-fg)]" : active ? "sds-tone-warning bg-[var(--sds-tone-surface)] text-[var(--sds-tone-fg)]" : "bg-[var(--sds-surface-subtle)] text-[var(--sds-text-muted)]"}`}>{done ? <FaCheck /> : active ? <FaClock /> : "·"}</span><div><p className="font-bold">{title}</p><p className="mt-1 text-sm leading-6 text-[var(--sds-text-secondary)]">{detail}</p></div></li>;
}

function VariantB({ persona, scenario, onDecision, onNotice }: VariantProps) {
  const canReview = persona !== "supervisor";
  const canSubmit = persona !== "reviewer";
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <ErpCard className="p-5"><div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between"><div><p className="text-xs text-[var(--sds-text-muted)]">پرونده عملکرد · علی احمدی · تابستان ۱۴۰۵</p><h2 className="mt-1 text-xl font-black">روایت بخش «اجرای مأموریت فروش»</h2><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">این نما علت، نسخه و رخداد بعدی را پیش از جزئیات معیارها نشان می‌دهد.</p></div><StatusBadge scenario={scenario} /></div></ErpCard>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          {scenario === "rejected" ? <RejectionExplanation /> : null}
          <ErpSection title="قضاوت تغییرناپذیر سرپرست"><CriterionSnapshot compact /></ErpSection>
          <details className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-panel)] p-4"><summary className="min-h-11 cursor-pointer py-2 font-bold">مشاهده Snapshot و زمینه مأموریت</summary><ErpSummaryGrid columns={2} items={[{ label: "Personnel", value: "علی احمدی · ۱۰۸۷" }, { label: "سرپرست مسئول", value: "محمد مرادی" }, { label: "نسخه سیاست", value: "عملکرد ۱۴۰۵/۲" }, { label: "پایان بخش", value: "۲۰ مرداد ۱۴۰۵" }]} /></details>
          {canSubmit ? <ErpSection title="اقدام سرپرست"><SupervisorActions scenario={scenario} onNotice={onNotice} /></ErpSection> : null}
          {canReview ? <ErpSection title="ثبت تصمیم"><ReviewerActions scenario={scenario} onOpen={onDecision} /></ErpSection> : null}
        </div>
        <aside><ErpSection title="خط زمانی نسخه"><ol className="relative before:absolute before:right-[17px] before:top-4 before:h-[calc(100%-36px)] before:w-px before:bg-[var(--sds-border-default)]"><TimelineItem title="بخش پایان یافت" detail="۲۰ مرداد · امکان ارسال فعال شد" done /><TimelineItem title="نسخه ۲ ارسال شد" detail="۲۲ مرداد · Snapshot و محاسبه منجمد شد" done={scenario !== "draft" && scenario !== "ready"} active={scenario === "ready"} /><TimelineItem title={scenario === "rejected" ? "برای بازنگری رد شد" : "بررسی منابع انسانی"} detail={scenario === "rejected" ? "۲۳ مرداد · شاهد ناکافی" : "مهلت تا ۲۷ مرداد"} done={scenario === "accepted" || scenario === "rejected"} active={scenario === "review" || scenario === "overdue"} /><TimelineItem title="ساخت نتیجه نهایی" detail="پس از تعیین تکلیف همه بخش‌های لازم" /></ol></ErpSection></aside>
      </div>
    </div>
  );
}

const queue = [
  { id: "q1", person: "علی احمدی", section: "اجرای مأموریت فروش", state: "عقب‌افتاده", tone: "danger" as const },
  { id: "q2", person: "مریم کریمی", section: "تحویل پروژه مهاباد", state: "امروز", tone: "warning" as const },
  { id: "q3", person: "سارا رضایی", section: "برنامه‌ریزی فصل", state: "۲ روز مانده", tone: "info" as const },
];

function VariantC({ persona, scenario, onDecision, onNotice, claimed, onClaim, recommended = false }: VariantProps & { recommended?: boolean }) {
  const canReview = persona !== "supervisor";
  return (
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside><ErpSection title="صف بررسی" description="کار آماده بر پایه مهلت؛ تصاحب کوتاه‌مدت است."><div className="space-y-2">{queue.map((item, index) => <ErpPressable key={item.id} type="button" tone={index === 0 ? "primary" : "neutral"} variant={index === 0 ? "soft" : "outline"} className="w-full p-4 text-right"><span className="flex items-start justify-between gap-3"><span><span className="block font-bold">{item.person}</span><span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{item.section}</span></span><ErpBadge tone={item.tone}>{item.state}</ErpBadge></span></ErpPressable>)}</div><div className="mt-3"><ErpButton label={claimed ? "تصاحب‌شده تا ۱۵ دقیقه دیگر" : "تصاحب بررسی برای ۱۵ دقیقه"} icon={FaLock} tone={claimed ? "success" : "neutral"} variant="outline" disabled={claimed} className="w-full" onClick={() => { onClaim(); onNotice("پرونده برای ۱۵ دقیقه تصاحب شد؛ نخستین تصمیم معتبر و اتمیک همچنان برنده است."); }} /></div></ErpSection></aside>
      <main className="space-y-4">
        <ErpCard className="p-5"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h2 className="text-xl font-black">علی احمدی</h2><StatusBadge scenario={scenario} />{persona === "dual" ? <ErpBadge tone="warning">خودبررسی</ErpBadge> : null}</div><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">اجرای مأموریت فروش · نسخه ۲ · ارسال محمد مرادی</p></div><div className="flex flex-wrap gap-2"><ErpButton label="مشاهده Snapshot" icon={FaEye} variant="ghost" onClick={() => onNotice("Snapshot سازمانی و نسخه سیاست در یک نمای فقط‌خواندنی باز می‌شود.")} /><ErpButton label="سابقه نسخه‌ها" icon={FaHistory} variant="ghost" onClick={() => onNotice("نسخه‌ها و پیوند جانشینی بدون بازنویسی نسخه قبلی نمایش داده می‌شوند.")} /></div></div></ErpCard>
        {scenario === "rejected" ? <RejectionExplanation /> : null}
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"><ErpSection title="معیارها و شواهد"><CriterionSnapshot compact /></ErpSection><aside className="space-y-4"><ErpCard className="p-4"><p className="font-bold">کنترل پذیرش</p><ul className="mt-3 space-y-2 text-sm text-[var(--sds-text-secondary)]"><li>✓ نسخه آخر و معتبر</li><li>✓ اختیار مؤثر بازبین</li><li>✓ محاسبه بازتولیدشدنی</li><li>✓ بدون تصمیم هم‌زمان</li></ul></ErpCard>{canReview ? <ErpSection title="تصمیم"><ReviewerActions scenario={scenario} onOpen={onDecision} disabled={recommended && !claimed} condensed={recommended} /></ErpSection> : <ErpSection title="اقدام سرپرست"><SupervisorActions scenario={scenario} onNotice={onNotice} /></ErpSection>}</aside></div>
      </main>
    </div>
  );
}

function VariantD({ persona, dualContext, onDualContext, ...props }: VariantProps & { dualContext: "supervisor" | "reviewer"; onDualContext: (value: "supervisor" | "reviewer") => void }) {
  const effectivePersona = persona === "dual" ? dualContext : persona;
  const selfReview = persona === "dual" && effectivePersona === "reviewer";
  const effectiveProps = { ...props, persona: effectivePersona };
  return (
    <div className="space-y-4">
      {persona === "dual" ? <ErpCard tone={selfReview ? "warning" : "info"} className="flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between"><div><p className="font-bold">زمینهٔ کاری فعال: {selfReview ? "بررسی منابع انسانی · خودبررسی" : "کار سرپرست"}</p><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">اختیارها مخلوط نمی‌شوند؛ برای تصمیم منابع انسانی باید آگاهانه وارد زمینهٔ بررسی شوید.</p></div><ErpSegmentedControl value={dualContext} onChange={onDualContext} options={[{ value: "supervisor", label: "کار سرپرست" }, { value: "reviewer", label: "ورود به بررسی به‌عنوان منابع انسانی" }]} /></ErpCard> : null}
      {effectivePersona === "supervisor" ? <VariantA {...effectiveProps} /> : <VariantC {...effectiveProps} recommended />}
      <ErpSection title="خط زمانی پرونده" description="نسخه‌ها، موعدها و تصمیم‌ها بدون بازنویسی سابقه دنبال می‌شوند."><ol className="grid gap-3 md:grid-cols-4"><TimelineItem title="بخش پایان یافت" detail="۲۰ مرداد · امکان ارسال فعال شد" done /><TimelineItem title="نسخه ۲ ارسال شد" detail="۲۲ مرداد · Snapshot منجمد شد" done /><TimelineItem title="بررسی منابع انسانی" detail="موعد فعلی ۲۷ مرداد" active /><TimelineItem title="ساخت نتیجه" detail="پس از تعیین تکلیف همه بخش‌ها" /></ol></ErpSection>
    </div>
  );
}

type VariantProps = {
  persona: Persona;
  scenario: Scenario;
  selected: string;
  onSelected: (id: string) => void;
  onDecision: (decision: Decision) => void;
  onNotice: (message: string) => void;
  claimed: boolean;
  onClaim: () => void;
};

function PrototypeState({ variant, persona, scenario }: { variant: Variant; persona: Persona; scenario: Scenario }) {
  return (
    <details className="rounded-xl border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] p-3 text-sm">
      <summary className="min-h-11 cursor-pointer py-2 font-bold">وضعیت کامل نمونه</summary>
      <div className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-4"><span>طرح: {variant}</span><span>نمای اختیار: {persona === "supervisor" ? "سرپرست" : persona === "reviewer" ? "منابع انسانی" : "هر دو اختیار"}</span><span>پرونده: {scenarioLabels[scenario]}</span><span>اثر پایین‌دستی: {scenario === "accepted" ? "منتظر سایر بخش‌ها" : "هیچ"}</span></div>
    </details>
  );
}

function PrototypeSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  const currentIndex = variants.findIndex((item) => item.id === variant);
  const cycle = useCallback((direction: -1 | 1) => onChange(variants[(currentIndex + direction + variants.length) % variants.length].id), [currentIndex, onChange]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "ArrowLeft") cycle(-1);
      if (event.key === "ArrowRight") cycle(1);
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [cycle]);
  if (process.env.NODE_ENV === "production") return null;
  const current = variants[currentIndex];
  return <div className="fixed bottom-20 left-1/2 z-[80] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-text-primary)] p-2 text-[var(--sds-text-inverse)] shadow-xl lg:bottom-5" dir="ltr"><ErpPressable type="button" onClick={() => cycle(-1)} aria-label="طرح قبلی" tone="neutral" variant="ghost" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--sds-border-strong)]"><FaArrowLeft /></ErpPressable><span className="min-w-44 px-2 text-center text-sm font-bold" dir="rtl">{current.id} · {current.label}<span className="block text-xs font-normal opacity-80">{current.note}</span></span><ErpPressable type="button" onClick={() => cycle(1)} aria-label="طرح بعدی" tone="neutral" variant="ghost" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--sds-border-strong)]"><FaArrowRight /></ErpPressable></div>;
}

function ReviewDecisionPanel({ decision, onClose, onRecorded }: { decision: Decision | null; onClose: () => void; onRecorded: (message: string) => void }) {
  const [reason, setReason] = useState("");
  useEffect(() => setReason(""), [decision]);
  const needsReason = decision !== "accept";
  return (
    <ErpSheet open={Boolean(decision)} onClose={onClose} title={decision ? decisionLabels[decision] : "ثبت تصمیم"} presentation="modal" footer={decision ? <div className="flex flex-wrap justify-end gap-2"><ErpButton label="انصراف" variant="ghost" onClick={onClose} /><ErpButton label="ثبت تصمیم" tone={decision === "reject" || decision === "cancel" ? "danger" : decision === "accept" ? "success" : "warning"} disabled={needsReason && !reason.trim()} onClick={() => { onRecorded(`${decisionLabels[decision]} در نمونه ثبت شد؛ داده سرپرست بدون تغییر باقی ماند.`); onClose(); }} /></div> : undefined}>
      {decision ? <div className="space-y-4"><ErpCard tone="info" className="p-4 text-sm leading-7">این تصمیم روی نسخه ۲ ثبت می‌شود. امتیاز، شاهد، وزن و روایت سرپرست در این فرم قابل ویرایش نیست.</ErpCard><ErpField label={needsReason ? "توضیح فارسی اجباری" : "یادداشت اختیاری"}><ErpTextarea value={reason} onChange={(event) => setReason(event.target.value)} rows={4} placeholder={decision === "reject" ? "دسته مشکل، معیار یا شاهد مرتبط و توضیح قابل‌اقدام…" : "توضیح تصمیم…"} /></ErpField>{decision === "reject" ? <ErpField label="دسته کنترل‌شده"><ErpSelect defaultValue="evidence"><option value="evidence">شاهد ناکافی یا نامرتبط</option><option value="judgment">قضاوت نیازمند توضیح</option><option value="coverage">پوشش ناکافی بخش</option></ErpSelect></ErpField> : null}</div> : null}
    </ErpSheet>
  );
}

export default function PerformanceLifecyclePrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("variant")?.toUpperCase();
  const variant: Variant = requested === "B" || requested === "C" || requested === "D" ? requested : "A";
  const [persona, setPersona] = useState<Persona>("dual");
  const [scenario, setScenario] = useState<Scenario>("review");
  const [selected, setSelected] = useState("s2");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [notice, setNotice] = useState("");
  const [claimed, setClaimed] = useState(false);
  const [dualContext, setDualContext] = useState<"supervisor" | "reviewer">("supervisor");
  const setVariant = useCallback((next: Variant) => { const params = new URLSearchParams(searchParams.toString()); params.set("variant", next); router.replace(`${pathname}?${params.toString()}`, { scroll: false }); }, [pathname, router, searchParams]);
  const props = useMemo<VariantProps>(() => ({ persona, scenario, selected, onSelected: setSelected, onDecision: setDecision, onNotice: setNotice, claimed, onClaim: () => setClaimed(true) }), [claimed, persona, scenario, selected]);
  return (
    <div dir="rtl" className="pb-28">
      <ErpPage eyebrow="Prototype موقت · داده ساختگی · بدون ذخیره" title="ارسال ارزیابی سرپرست و بررسی منابع انسانی" description={`طرح ${variant}: ${variants.find((item) => item.id === variant)?.label} · ارزیابی تابستان ۱۴۰۵`} backHref="/dashboard/hr" actions={[{ label: "بازگشت به منابع انسانی", href: "/dashboard/hr", tone: "neutral", variant: "ghost" }]}>
        <PrototypeControls persona={persona} scenario={scenario} onPersona={setPersona} onScenario={setScenario} />
        <AuthorityNotice persona={persona} />
        {notice ? <div role="status"><ErpCard tone="info" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><span className="text-sm">{notice}</span><ErpButton label="بستن" variant="ghost" onClick={() => setNotice("")} /></ErpCard></div> : null}
        {variant === "A" ? <VariantA {...props} /> : null}
        {variant === "B" ? <VariantB {...props} /> : null}
        {variant === "C" ? <VariantC {...props} /> : null}
        {variant === "D" ? <VariantD {...props} dualContext={dualContext} onDualContext={setDualContext} /> : null}
        <PrototypeState variant={variant} persona={persona} scenario={scenario} />
      </ErpPage>
      <ReviewDecisionPanel decision={decision} onClose={() => setDecision(null)} onRecorded={setNotice} />
      <PrototypeSwitcher variant={variant} onChange={setVariant} />
    </div>
  );
}
