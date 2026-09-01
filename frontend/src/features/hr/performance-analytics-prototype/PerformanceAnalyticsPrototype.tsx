"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  FaArrowLeft,
  FaArrowRight,
  FaBalanceScale,
  FaChartBar,
  FaChartLine,
  FaCheckCircle,
  FaFileExcel,
  FaFilePdf,
  FaFilter,
  FaLock,
  FaShieldAlt,
  FaTasks,
  FaUsers,
} from "react-icons/fa";
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpField,
  ErpInput,
  ErpMetricGrid,
  ErpPage,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
  ErpSheet,
  ErpSummaryGrid,
} from "@/components/erp";
import {
  PersonnelPerformanceBadgePrototype,
  type PerformanceLevelId,
} from "@/features/hr/performance-badge-prototype/PerformanceBadgePrototype";

type Variant = "A" | "B" | "C";
type PermissionProfile = "hr" | "company" | "admin";
type Surface = "overview" | "people" | "quality" | "followups";

type PersonRow = {
  id: string;
  name: string;
  employee: string;
  job: string;
  unit: string;
  level: PerformanceLevelId;
  levelLabel: string;
  approvedScore: string;
  peerBand: string;
  trend: string;
  followup: string;
};

const variants: Array<{ id: Variant; label: string; short: string }> = [
  { id: "A", label: "اتاق تصمیم", short: "اقدام‌محور" },
  { id: "B", label: "گزارش روایی", short: "گزارش‌محور" },
  { id: "C", label: "فهرست تحلیلی", short: "پرسنل‌محور" },
];

const levelDistribution = [
  { label: "الماس", count: 5, percent: 10, tone: "purple" as const },
  { label: "یاقوت", count: 11, percent: 23, tone: "primary" as const },
  { label: "زمرد", count: 21, percent: 44, tone: "success" as const },
  { label: "کهربا", count: 8, percent: 17, tone: "warning" as const },
  { label: "عقیق", count: 3, percent: 6, tone: "danger" as const },
];

const people: PersonRow[] = [
  { id: "p-1", name: "سارا احمدی", employee: "۱۰۲۴", job: "کارشناس برنامه‌ریزی", unit: "برنامه‌ریزی", level: "outstanding", levelLabel: "الماس", approvedScore: "۸۶٫۴", peerBand: "هم‌سطح با ۲ نفر", trend: "پایدار", followup: "بدون پیگیری" },
  { id: "p-2", name: "علی رضایی", employee: "۱۰۸۷", job: "کارشناس فروش", unit: "فروش", level: "exceeds", levelLabel: "یاقوت", approvedScore: "۷۱٫۲", peerBand: "هم‌سطح با ۳ نفر", trend: "کاهش یک سطح", followup: "پیشنهاد بهبود" },
  { id: "p-3", name: "مریم کریمی", employee: "۱۱۲۰", job: "کارشناس منابع انسانی", unit: "منابع انسانی", level: "meets", levelLabel: "زمرد", approvedScore: "۵۵٫۸", peerBand: "هم‌سطح با ۴ نفر", trend: "افزایش یک سطح", followup: "اصلاح در جریان" },
  { id: "p-4", name: "رضا محمدی", employee: "۱۱۵۹", job: "کارشناس فروش", unit: "فروش", level: "meets", levelLabel: "زمرد", approvedScore: "۵۱٫۹", peerBand: "هم‌سطح با ۴ نفر", trend: "پایدار", followup: "اعتراض ثبت‌شده" },
  { id: "p-5", name: "ناهید جعفری", employee: "۱۲۰۳", job: "کارشناس خرید", unit: "تدارکات", level: "improve", levelLabel: "کهربا", approvedScore: "۳۴٫۱", peerBand: "گروه کوچک؛ رتبه ندارد", trend: "تازه ارزیابی‌شده", followup: "پیشنهاد آموزشی" },
  { id: "p-6", name: "امیر نادری", employee: "۱۲۴۸", job: "کارشناس فروش", unit: "فروش", level: "renew", levelLabel: "نیازمند ارزیابی جدید", approvedScore: "—", peerBand: "واجد رتبه‌بندی نیست", trend: "نتیجه منقضی", followup: "ارزیابی ناقص" },
];

const followups = [
  { title: "بررسی‌های ناقص", value: "۷", hint: "۴ ارسال عقب‌افتاده · ۳ مانع ساختاری", tone: "warning" as const },
  { title: "پیشنهادهای پیامد", value: "۴", hint: "مستقل از امتیاز و در انتظار تصمیم", tone: "info" as const },
  { title: "اعتراض و اصلاح", value: "۳", hint: "۲ اعتراض · ۱ نسخه اصلاحی", tone: "purple" as const },
];

function GlobalFilters({
  profile,
  onProfileChange,
  period,
  onPeriodChange,
  unit,
  onUnitChange,
  query,
  onQueryChange,
}: {
  profile: PermissionProfile;
  onProfileChange: (value: PermissionProfile) => void;
  period: string;
  onPeriodChange: (value: string) => void;
  unit: string;
  onUnitChange: (value: string) => void;
  query: string;
  onQueryChange: (value: string) => void;
}) {
  return (
    <ErpCard className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-[1.15fr_1fr_1fr_1fr]">
      <ErpField label="پروفایل نمایشی مجوز مؤثر">
        <ErpSelect value={profile} onChange={(event) => onProfileChange(event.target.value as PermissionProfile)}>
          <option value="hr">مدیر منابع انسانی</option>
          <option value="company">مدیر شرکت</option>
          <option value="admin">مدیر سامانه</option>
        </ErpSelect>
      </ErpField>
      <ErpField label="بازه گزارش عملکرد">
        <ErpSelect value={period} onChange={(event) => onPeriodChange(event.target.value)}>
          <option value="summer">تابستان ۱۴۰۵</option>
          <option value="spring">بهار ۱۴۰۵</option>
          <option value="year">سال ۱۴۰۵ تا امروز</option>
        </ErpSelect>
      </ErpField>
      <ErpField label="واحد سازمانی">
        <ErpSelect value={unit} onChange={(event) => onUnitChange(event.target.value)}>
          <option value="all">همه واحدهای مجاز</option>
          <option value="sales">فروش</option>
          <option value="hr">منابع انسانی</option>
          <option value="planning">برنامه‌ریزی</option>
        </ErpSelect>
      </ErpField>
      <ErpField label="جست‌وجوی Personnel">
        <ErpInput value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="نام یا شماره پرسنلی" />
      </ErpField>
    </ErpCard>
  );
}

function AccessBoundary({ profile }: { profile: PermissionProfile }) {
  const label = profile === "hr" ? "مدیر منابع انسانی" : profile === "company" ? "مدیر شرکت" : "مدیر سامانه";
  return (
    <ErpCard tone="info" className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-3">
        <FaShieldAlt className="mt-1 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-bold">پیش‌نمایش محرمانه برای {label}</p>
          <p className="mt-1 text-xs leading-6 text-[var(--sds-text-secondary)]">
            این انتخاب نقش سازمانی را به مجوز تبدیل نمی‌کند؛ فقط مجموعه‌ای از مجوزهای مؤثر مستقل را برای ارزیابی رابط شبیه‌سازی می‌کند.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <ErpBadge tone="success">تحلیل نام‌دار</ErpBadge>
        <ErpBadge tone="success">خروجی مجاز</ErpBadge>
        <ErpBadge tone={profile === "company" ? "neutral" : "success"} variant="outline">
          {profile === "company" ? "کالیبراسیون پنهان" : "کالیبراسیون مجاز"}
        </ErpBadge>
      </div>
    </ErpCard>
  );
}

function DistributionPlot({ compact = false }: { compact?: boolean }) {
  return (
    <figure aria-labelledby="distribution-title" className="space-y-4">
      <figcaption id="distribution-title" className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold">توزیع سطح‌های مصوب</span>
        <span className="text-xs text-[var(--sds-text-muted)]">۴۸ Personnel واجد شرایط</span>
      </figcaption>
      <div role="img" aria-label="الماس ۵ نفر، یاقوت ۱۱ نفر، زمرد ۲۱ نفر، کهربا ۸ نفر و عقیق ۳ نفر" className="space-y-3">
        {levelDistribution.map((item) => (
          <div key={item.label} className={compact ? "space-y-1" : "grid grid-cols-[72px_minmax(0,1fr)_72px] items-center gap-3"}>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span>{item.label}</span>
              {compact ? <span className="text-xs text-[var(--sds-text-muted)]">{item.count.toLocaleString("fa-IR")} نفر</span> : null}
            </div>
            <div className="h-3 overflow-hidden rounded-full bg-[var(--sds-surface-subtle)]" aria-hidden="true">
              <div className={`sds-tone-${item.tone} h-full rounded-full bg-[var(--sds-tone-fg)]`} style={{ width: `${item.percent}%` }} />
            </div>
            {!compact ? <span className="text-left text-xs text-[var(--sds-text-muted)]">{item.count.toLocaleString("fa-IR")} نفر · ٪{item.percent.toLocaleString("fa-IR")}</span> : null}
          </div>
        ))}
      </div>
      <details className="text-xs text-[var(--sds-text-secondary)]">
        <summary className="min-h-11 cursor-pointer py-3 font-semibold">جدول دادهٔ نمودار</summary>
        <table className="w-full text-right">
          <thead><tr><th className="py-2">سطح</th><th>تعداد</th><th>درصد</th></tr></thead>
          <tbody>{levelDistribution.map((item) => <tr key={item.label} className="border-t border-[var(--sds-border-subtle)]"><td className="py-2">{item.label}</td><td>{item.count.toLocaleString("fa-IR")}</td><td>٪{item.percent.toLocaleString("fa-IR")}</td></tr>)}</tbody>
        </table>
      </details>
    </figure>
  );
}

function TrendPlot() {
  return (
    <figure aria-labelledby="trend-title" className="space-y-3">
      <figcaption id="trend-title" className="font-bold">روند جمعیت ثابت قابل‌مقایسه</figcaption>
      <svg role="img" aria-label="سهم سطح‌های زمرد یا بالاتر در چهار بازه: ۶۲، ۶۶، ۶۵ و ۷۱ درصد" viewBox="0 0 480 180" className="h-44 w-full">
        <title>روند چهار بازه برای جمعیت ثابت ۳۸ نفره</title>
        {[35, 75, 115, 155].map((y) => <line key={y} x1="42" x2="462" y1={y} y2={y} stroke="var(--sds-border-subtle)" strokeWidth="1" />)}
        <polyline points="52,115 182,93 312,98 442,62" fill="none" stroke="var(--sds-accent)" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
        {["52,115", "182,93", "312,98", "442,62"].map((point) => {
          const [cx, cy] = point.split(",");
          return <circle key={point} cx={cx} cy={cy} r="7" fill="var(--sds-surface-raised)" stroke="var(--sds-accent)" strokeWidth="4" />;
        })}
        <text x="52" y="145" fill="var(--sds-text-muted)" fontSize="12" textAnchor="middle">پاییز</text>
        <text x="182" y="145" fill="var(--sds-text-muted)" fontSize="12" textAnchor="middle">زمستان</text>
        <text x="312" y="145" fill="var(--sds-text-muted)" fontSize="12" textAnchor="middle">بهار</text>
        <text x="442" y="145" fill="var(--sds-text-muted)" fontSize="12" textAnchor="middle">تابستان</text>
      </svg>
      <p className="text-xs leading-6 text-[var(--sds-text-muted)]">این روند علت یا بهبود فردی را اثبات نمی‌کند. جمعیت هر دوره در نمای جداگانه گزارش می‌شود.</p>
    </figure>
  );
}

function FollowupQueue({ onOpen }: { onOpen: (kind: "reviews" | "proposals" | "corrections") => void }) {
  return (
    <div className="space-y-3">
      {followups.map((item, index) => {
        const kind = index === 0 ? "reviews" : index === 1 ? "proposals" : "corrections";
        return (
          <ErpPressable key={item.title} type="button" onClick={() => onOpen(kind)} tone={item.tone} variant="soft" className="flex min-h-20 w-full items-center justify-between gap-3 p-4 text-right">
            <span>
              <span className="block font-bold">{item.title}</span>
              <span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{item.hint}</span>
            </span>
            <span className="text-2xl font-black">{item.value}</span>
          </ErpPressable>
        );
      })}
    </div>
  );
}

function PeopleTable({ rows, onSelect, dense = false }: { rows: PersonRow[]; onSelect: (person: PersonRow) => void; dense?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[var(--sds-border-subtle)]">
      <table className="w-full min-w-[780px] text-right text-sm">
        <thead className="bg-[var(--sds-surface-subtle)] text-xs text-[var(--sds-text-muted)]">
          <tr><th className="px-3 py-3">Personnel</th><th>Job و واحد</th><th>سطح جاری</th><th>گروه همتا</th><th>روند</th>{!dense && <th>پیگیری مستقل</th>}<th><span className="sr-only">جزئیات</span></th></tr>
        </thead>
        <tbody>
          {rows.map((person) => (
            <tr key={person.id} className="border-t border-[var(--sds-border-subtle)]">
              <td className="px-3 py-3"><span className="block font-bold">{person.name}</span><span className="text-xs text-[var(--sds-text-muted)]">پرسنلی {person.employee}</span></td>
              <td className="py-3"><span className="block">{person.job}</span><span className="text-xs text-[var(--sds-text-muted)]">{person.unit}</span></td>
              <td className="py-2"><PersonnelPerformanceBadgePrototype levelId={person.level} onOpen={() => onSelect(person)} /></td>
              <td className="py-3 text-xs">{person.peerBand}</td>
              <td className="py-3"><ErpBadge tone={person.trend.includes("کاهش") ? "warning" : "neutral"} variant="outline">{person.trend}</ErpBadge></td>
              {!dense && <td className="py-3 text-xs">{person.followup}</td>}
              <td className="p-3"><ErpButton label="بررسی" onClick={() => onSelect(person)} tone="neutral" variant="ghost" /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CalibrationPanel({ profile }: { profile: PermissionProfile }) {
  if (profile === "company") {
    return (
      <ErpCard className="flex min-h-48 flex-col items-center justify-center p-5 text-center">
        <FaLock className="mb-3" aria-hidden="true" />
        <p className="font-bold">کالیبراسیون در این پروفایل نمایش داده نمی‌شود</p>
        <p className="mt-2 max-w-md text-xs leading-6 text-[var(--sds-text-muted)]">مجوز تحلیل مدیریتی یا خروجی، مجوز مشاهده کالیبراسیون ارزیاب نیست.</p>
      </ErpCard>
    );
  }
  return (
    <ErpCard className="space-y-4 p-4">
      <div className="flex items-center justify-between gap-3"><p className="font-bold">تنوع ارزیاب</p><ErpBadge tone="warning">۲ هشدار تشخیصی</ErpBadge></div>
      <div className="space-y-3 text-sm">
        <div className="flex items-center justify-between gap-3"><span>تمرکز افراطی بر یک درجه</span><span className="font-bold">۳۶٪</span></div>
        <div className="flex items-center justify-between gap-3"><span>پراکندگی نامتعارف</span><span className="font-bold">۱ مورد</span></div>
        <div className="flex items-center justify-between gap-3"><span>داده ناکافی</span><span className="font-bold">۴ ارزیاب</span></div>
      </div>
      <p className="text-xs leading-6 text-[var(--sds-text-muted)]">هشدار فقط برای بررسی و آموزش است؛ امتیاز را نرمال یا اصلاح نمی‌کند و ارزیاب‌ها را رتبه‌بندی نمی‌کند.</p>
    </ErpCard>
  );
}

function ExportActions({ onExport }: { onExport: (format: "PDF" | "Excel") => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ErpButton label="خروجی PDF" icon={FaFilePdf} onClick={() => onExport("PDF")} tone="neutral" variant="outline" />
      <ErpButton label="خروجی Excel" icon={FaFileExcel} onClick={() => onExport("Excel")} tone="success" variant="outline" />
    </div>
  );
}

function OverviewVariant({ profile, rows, onSelect, onFollowup, onExport }: VariantProps) {
  return (
    <div className="space-y-5">
      <ErpMetricGrid items={[
        { label: "نتایج مصوب واجد گزارش", value: "۴۸", hint: "از ۵۶ رابطه در دامنه", icon: FaUsers, tone: "primary" },
        { label: "پوشش ارزیابی", value: "۸۵٫۷٪", hint: "۸ مورد خارج‌شده یا ناقص", icon: FaCheckCircle, tone: "success" },
        { label: "نیازمند تصمیم", value: "۱۴", hint: "بررسی، پیشنهاد یا اصلاح", icon: FaTasks, tone: "warning" },
        { label: "گروه‌های سرکوب‌شده", value: "۳", hint: "زیر حداقل جمعیت یا قابل استنتاج", icon: FaShieldAlt, tone: "neutral" },
      ]} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.75fr)]">
        <ErpSection title="تصویر تصمیم" description="ابتدا وضعیت کل، سپس فقط موارد قابل اقدام."><DistributionPlot /></ErpSection>
        <ErpSection title="صف پیگیری"><FollowupQueue onOpen={onFollowup} /></ErpSection>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <ErpSection title="روند قابل‌مقایسه"><TrendPlot /></ErpSection>
        <ErpSection title="کیفیت قضاوت"><CalibrationPanel profile={profile} /></ErpSection>
      </div>
      <ErpSection title="تحلیل نام‌دار گروه همتا" description="افراد یک سطح هم‌سطح‌اند؛ امتیاز دقیق ترتیب درون سطح نمی‌سازد." actions={[{ label: "مشاهده مرز رتبه‌بندی", icon: FaBalanceScale, onClick: () => onFollowup("reviews"), tone: "neutral", variant: "ghost" }]}>
        <PeopleTable rows={rows} onSelect={onSelect} />
      </ErpSection>
      <ErpCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="font-bold">خروجی همین نمای مجاز</p><p className="mt-1 text-xs text-[var(--sds-text-muted)]">بازه، فیلترها، تعداد ردیف، نسخه سیاست و هش فایل حسابرسی می‌شوند.</p></div><ExportActions onExport={onExport} /></ErpCard>
    </div>
  );
}

function ReportVariant({ profile, rows, onSelect, onFollowup, onExport }: VariantProps) {
  return (
    <div className="space-y-5">
      <ErpCard tone="primary" className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <div><ErpBadge tone="primary" variant="solid">گزارش مدیریتی · تابستان ۱۴۰۵</ErpBadge><h2 className="mt-4 text-2xl font-black">پوشش ارزیابی بالاست؛ ۱۴ مورد هنوز تصمیم مستقل می‌خواهند</h2><p className="mt-2 max-w-3xl text-sm leading-7 text-[var(--sds-text-secondary)]">۷ بررسی ناقص، ۴ پیشنهاد پیامد و ۳ اعتراض یا اصلاح از نتیجه مصوب جدا نگه داشته شده‌اند.</p></div>
        <ExportActions onExport={onExport} />
      </ErpCard>
      <ErpSection title="۱. جمع‌بندی دامنه و پوشش"><ErpSummaryGrid columns={3} items={[{ label: "دامنه مجاز", value: "۵۶ رابطه استخدامی" }, { label: "نتیجه مصوب", value: "۴۸ Personnel", tone: "success" }, { label: "خارج از تحلیل", value: "۸ مورد", hint: "بدون صفر یا مقدار تخمینی", tone: "warning" }]} /></ErpSection>
      <ErpSection title="۲. توزیع و روند" description="هر نمودار یک جدول داده و تفسیر محدود دارد."><div className="grid gap-6 lg:grid-cols-2"><DistributionPlot /><TrendPlot /></div></ErpSection>
      <ErpSection title="۳. برابری مقایسه و تنوع ارزیاب"><div className="grid gap-5 lg:grid-cols-2"><ErpCard className="p-4"><p className="font-bold">سلامت گروه‌های همتا</p><ul className="mt-3 space-y-3 text-sm"><li>۸ گروه واجد حداقل ۵ Personnel</li><li>۲ گروه کوچک بدون رتبه</li><li>۱ نتیجه چندخانواده‌ای خارج از رتبه‌بندی</li><li>۳ برش تجمیعی برای منع استنتاج سرکوب شد</li></ul></ErpCard><CalibrationPanel profile={profile} /></div></ErpSection>
      <ErpSection title="۴. افراد و پیگیری‌های مستقل"><PeopleTable rows={rows} onSelect={onSelect} /></ErpSection>
      <ErpSection title="۵. تصمیم‌های باز"><div className="grid gap-3 md:grid-cols-3"><FollowupQueue onOpen={onFollowup} /></div></ErpSection>
    </div>
  );
}

function RosterVariant({ profile, rows, onSelect, onFollowup, onExport }: VariantProps) {
  return (
    <div className="space-y-5">
      <div className="grid gap-5 2xl:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <ErpSection title="فشردهٔ تحلیل"><DistributionPlot compact /></ErpSection>
          <CalibrationPanel profile={profile} />
          <ErpSection title="کارهای باز"><FollowupQueue onOpen={onFollowup} /></ErpSection>
        </aside>
        <ErpSection title="فهرست تحلیلی Personnel" description="برای دیدن جزئیات عملکرد فرد، نشان یا دکمهٔ «بررسی» را انتخاب کنید."><PeopleTable rows={rows} onSelect={onSelect} dense /></ErpSection>
      </div>
      <ErpCard className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><p className="text-sm font-bold">خروجی از فهرست فیلترشده و فقط با فیلدهای همین مجوز</p><ExportActions onExport={onExport} /></ErpCard>
    </div>
  );
}

type VariantProps = {
  profile: PermissionProfile;
  rows: PersonRow[];
  onSelect: (person: PersonRow) => void;
  onFollowup: (kind: "reviews" | "proposals" | "corrections") => void;
  onExport: (format: "PDF" | "Excel") => void;
};

function PersonnelDrillDown({ person, onClose }: { person: PersonRow | null; onClose: () => void }) {
  return (
    <ErpSheet open={Boolean(person)} onClose={onClose} title="جزئیات عملکرد فرد" presentation="modal" size="wide">
      {person ? <div className="space-y-5"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xl font-black">{person.name}</p><p className="mt-1 text-sm text-[var(--sds-text-muted)]">پرسنلی {person.employee} · {person.job} · {person.unit}</p></div><PersonnelPerformanceBadgePrototype levelId={person.level} onOpen={() => undefined} /></div><ErpSummaryGrid columns={3} items={[{ label: "امتیاز نهایی مصوب", value: person.approvedScore, hint: "فقط برای مجوز تحلیل نام‌دار" }, { label: "گروه همتا", value: person.peerBand }, { label: "روند", value: person.trend }, { label: "تازه‌ترین پایان بازه", value: "۳۱ مرداد ۱۴۰۵" }, { label: "پیگیری مستقل", value: person.followup }, { label: "نسخه سیاست", value: "سطح‌بندی ۱۴۰۵/۲" }]} /><ErpCard tone="warning" className="p-4"><p className="font-bold">محدودهٔ جزئیات قابل مشاهده</p><p className="mt-2 text-sm leading-7 text-[var(--sds-text-secondary)]">این نما نتیجه مصوب، زمینه سازمانی، روند و رتبه مجاز را نشان می‌دهد. معیارها، شواهد، روایت Supervisor و یادداشت داخلی بررسی فقط با مجوز مستقل سابقه محرمانه باز می‌شوند.</p></ErpCard></div> : null}
    </ErpSheet>
  );
}

function PerformanceFollowupDetails({ kind, onClose }: { kind: "reviews" | "proposals" | "corrections" | null; onClose: () => void }) {
  const content = kind === "reviews" ? { title: "بررسی‌های ناقص", lines: ["۴ ارسال از مهلت بررسی گذشته‌اند", "۲ پرونده مانع ساختار سازمانی دارند", "۱ بخش با شاهد ناکافی منتظر تصمیم دلیل‌دار است"] } : kind === "proposals" ? { title: "پیشنهادهای پیامد", lines: ["۲ پیشنهاد آموزش", "۱ پیشنهاد برنامه بهبود", "۱ پیشنهاد بازبینی مسئولیت", "هیچ پیشنهاد، حقوق یا استخدام را خودکار تغییر نمی‌دهد"] } : { title: "اعتراض و اصلاح", lines: ["۲ اعتراض در انتظار بررسی", "۱ نتیجه معتبر در چرخه اصلاح", "نسخه فعلی تا پذیرش جانشین مؤثر می‌ماند"] };
  return <ErpSheet open={Boolean(kind)} onClose={onClose} title={content.title} presentation="modal">{kind ? <div className="space-y-3">{content.lines.map((line) => <ErpCard key={line} className="p-4 text-sm">{line}</ErpCard>)}</div> : null}</ErpSheet>;
}

function PrototypeSwitcher({ variant, onChange }: { variant: Variant; onChange: (variant: Variant) => void }) {
  const currentIndex = variants.findIndex((item) => item.id === variant);
  const cycle = useCallback((direction: -1 | 1) => {
    const next = (currentIndex + direction + variants.length) % variants.length;
    onChange(variants[next].id);
  }, [currentIndex, onChange]);
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
  const current = variants[currentIndex];
  return (
    <div className="fixed bottom-20 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2 rounded-full border border-[var(--sds-border-strong)] bg-[var(--sds-text-primary)] p-2 text-[var(--sds-text-inverse)] shadow-xl lg:bottom-5" dir="ltr">
      <ErpPressable type="button" onClick={() => cycle(-1)} aria-label="طرح قبلی" tone="neutral" variant="ghost" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--sds-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"><FaArrowLeft /></ErpPressable>
      <span className="min-w-40 px-2 text-center text-sm font-bold" dir="rtl">{current.id} · {current.label}<span className="block text-xs font-normal opacity-80">{current.short}</span></span>
      <ErpPressable type="button" onClick={() => cycle(1)} aria-label="طرح بعدی" tone="neutral" variant="ghost" className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[var(--sds-border-strong)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]"><FaArrowRight /></ErpPressable>
    </div>
  );
}

export default function PerformanceAnalyticsPrototype() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requested = searchParams.get("variant")?.toUpperCase();
  const variant: Variant = requested === "B" || requested === "C" ? requested : "A";
  const [profile, setProfile] = useState<PermissionProfile>("hr");
  const [period, setPeriod] = useState("summer");
  const [unit, setUnit] = useState("all");
  const [query, setQuery] = useState("");
  const [surface, setSurface] = useState<Surface>("overview");
  const [selectedPerson, setSelectedPerson] = useState<PersonRow | null>(null);
  const [followupKind, setFollowupKind] = useState<"reviews" | "proposals" | "corrections" | null>(null);
  const [notice, setNotice] = useState("");
  const filteredRows = useMemo(() => people.filter((person) => {
    const matchesUnit = unit === "all" || (unit === "sales" && person.unit === "فروش") || (unit === "hr" && person.unit === "منابع انسانی") || (unit === "planning" && person.unit === "برنامه‌ریزی");
    const normalized = `${person.name} ${person.employee}`;
    return matchesUnit && normalized.includes(query.trim());
  }), [query, unit]);
  const setVariant = useCallback((next: Variant) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("variant", next);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);
  const handleExport = (format: "PDF" | "Excel") => setNotice(`Prototype: خروجی ${format} با دامنه و فیلترهای فعلی ساخته و دانلود آن حسابرسی می‌شود.`);
  const props: VariantProps = { profile, rows: filteredRows, onSelect: setSelectedPerson, onFollowup: setFollowupKind, onExport: handleExport };
  return (
    <ErpPage eyebrow="Prototype موقت · محرمانه" title="تحلیل و گزارش عملکرد Personnel" description="سه ساختار برای تصمیم‌گیری درباره تجربه مدیریتی؛ داده‌ها ساختگی و همه تعامل‌ها فقط‌خواندنی‌اند." backHref="/dashboard/hr" actions={[{ label: "بازگشت به منابع انسانی", href: "/dashboard/hr", tone: "neutral", variant: "ghost" }]}>
      <AccessBoundary profile={profile} />
      <GlobalFilters profile={profile} onProfileChange={setProfile} period={period} onPeriodChange={setPeriod} unit={unit} onUnitChange={setUnit} query={query} onQueryChange={setQuery} />
      <ErpCard className="flex flex-col gap-3 p-3 lg:flex-row lg:items-center lg:justify-between">
        <ErpSegmentedControl value={surface} onChange={setSurface} options={[{ value: "overview", label: "نمای کلی", icon: FaChartBar }, { value: "people", label: "Personnel", icon: FaUsers }, { value: "quality", label: "کیفیت ارزیابی", icon: FaBalanceScale, disabled: profile === "company" }, { value: "followups", label: "پیگیری‌ها", icon: FaTasks, count: 14, countTone: "warning" }]} />
        <p className="flex items-center gap-2 text-xs text-[var(--sds-text-muted)]"><FaFilter aria-hidden="true" />حالت Prototype: {variant} · بازه {period} · {filteredRows.length.toLocaleString("fa-IR")} ردیف نمونه</p>
      </ErpCard>
      {notice ? <div role="status"><ErpCard tone="info" className="flex items-center justify-between gap-3 p-4"><span>{notice}</span><ErpButton label="بستن" onClick={() => setNotice("")} tone="neutral" variant="ghost" /></ErpCard></div> : null}
      {surface !== "overview" ? <ErpCard tone="warning" className="p-4 text-sm"><p className="font-bold">این کنترل در Prototype مرز اطلاعاتی را نشان می‌دهد</p><p className="mt-1 text-xs leading-6 text-[var(--sds-text-secondary)]">ساختار اصلی هر طرح پایین ثابت مانده است تا مقایسهٔ سه جهت طراحی ممکن باشد؛ جزئیات عملکرد این بخش پس از انتخاب طرح نهایی تکمیل می‌شود.</p></ErpCard> : null}
      {variant === "A" ? <OverviewVariant {...props} /> : variant === "B" ? <ReportVariant {...props} /> : <RosterVariant {...props} />}
      <ErpCard className="flex items-start gap-3 p-4 text-xs leading-6 text-[var(--sds-text-secondary)]"><FaLock className="mt-1 shrink-0" aria-hidden="true" /><span>کاربر عادی و Supervisor فضای کاری این صفحه، شمارش‌ها، فیلترها، نمودارها، رتبه‌ها یا خروجی‌ها را دریافت نمی‌کنند. نبود مجوز هیچ وجود یا وضعیت محرمانه‌ای را تأیید نمی‌کند.</span></ErpCard>
      <PersonnelDrillDown person={selectedPerson} onClose={() => setSelectedPerson(null)} />
      <PerformanceFollowupDetails kind={followupKind} onClose={() => setFollowupKind(null)} />
      <PrototypeSwitcher variant={variant} onChange={setVariant} />
    </ErpPage>
  );
}
