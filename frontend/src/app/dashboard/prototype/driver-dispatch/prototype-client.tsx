'use client';

// PROTOTYPE ONLY: Three cross-workspace driver-to-exit layouts, switchable via ?variant= on this route.

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  FaBuilding,
  FaCalculator,
  FaCheck,
  FaClock,
  FaExclamationTriangle,
  FaFingerprint,
  FaIdCard,
  FaMapSigns,
  FaMobileAlt,
  FaRoute,
  FaShieldAlt,
  FaSms,
  FaTruck,
  FaUserCheck,
  FaUsers,
  FaWarehouse,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpFieldView,
  ErpInlineState,
  ErpMetricGrid,
  ErpPage,
  ErpPressable,
  ErpSection,
  ErpSegmentedControl,
  ErpStatus,
  ErpSummaryGrid,
  ErpTwoColumn,
  type ErpTone,
} from '@/components/erp';
import { PrototypeSwitcher } from '@/components/prototype/PrototypeSwitcher';

type Role = 'hr' | 'fleet' | 'guard' | 'logistics' | 'accounting';
type Scenario = 'normal' | 'fallback' | 'outage' | 'remaining';
type StageState = 'done' | 'active' | 'waiting' | 'blocked' | 'exception';

type Stage = {
  id: string;
  role: Role;
  title: string;
  detail: string;
  evidence: string;
  state: StageState;
  icon: typeof FaUsers;
};

const variants = [
  { key: 'A', name: 'میزکار نقش‌محور' },
  { key: 'B', name: 'مسیر تحویل کار' },
  { key: 'C', name: 'پرونده و کنترل ایمنی' },
];

const roleMeta: Record<Role, { label: string; short: string; icon: typeof FaUsers; tone: ErpTone }> = {
  hr: { label: 'منابع انسانی', short: 'HR', icon: FaUsers, tone: 'purple' },
  fleet: { label: 'عملیات خودرو', short: 'ناوگان', icon: FaTruck, tone: 'info' },
  guard: { label: 'نگهبانی', short: 'گارد', icon: FaShieldAlt, tone: 'warning' },
  logistics: { label: 'لجستیک', short: 'بارگیری', icon: FaWarehouse, tone: 'primary' },
  accounting: { label: 'حسابداری', short: 'حسابداری', icon: FaCalculator, tone: 'success' },
};

const stateMeta: Record<StageState, { label: string; tone: ErpTone }> = {
  done: { label: 'تکمیل شده', tone: 'success' },
  active: { label: 'اقدام شما', tone: 'primary' },
  waiting: { label: 'در انتظار', tone: 'neutral' },
  blocked: { label: 'مسدود', tone: 'danger' },
  exception: { label: 'مسیر استثنا', tone: 'warning' },
};

function buildStages(scenario: Scenario): Stage[] {
  const fallback = scenario === 'fallback';
  const outage = scenario === 'outage';
  return [
    {
      id: 'eligibility', role: 'hr', title: 'تأیید صلاحیت رانندگی داخلی',
      detail: 'پرسنل فعال، رضایت زیست‌سنجی و تاریخ اعتبار صلاحیت ثبت شده است.',
      evidence: 'صلاحیت HR-DR-018 · معتبر تا ۱۴۰۵/۱۲/۲۹', state: 'done', icon: FaIdCard,
    },
    {
      id: 'assignment', role: 'fleet', title: 'تخصیص راننده به خودروی شرکتی',
      detail: 'فقط یک تخصیص فعال؛ راننده و پلاک در ادامه به‌صورت snapshot حفظ می‌شوند.',
      evidence: 'رضا احمدی · ولوو FH · ۱۲ع۳۴۵ ایران ۱۱', state: 'done', icon: FaTruck,
    },
    {
      id: 'queue', role: 'guard', title: 'ورود به صف مشترک نگهبانی',
      detail: 'حضور فیزیکی ثبت شده و زوج راننده–خودرو برای انتخاب لجستیک آماده است.',
      evidence: 'نوبت GQ-1042 · ورود ۰۸:۴۶', state: 'done', icon: FaShieldAlt,
    },
    {
      id: 'allocation', role: 'logistics', title: 'تخصیص بار و نهایی‌سازی',
      detail: '۲۴ تن از ردیف قرارداد برای این راننده رزرو و snapshot بارگیری نهایی شده است.',
      evidence: 'بارگیری LG-2506 · قرارداد SC-1405-091', state: 'done', icon: FaWarehouse,
    },
    {
      id: 'waybill', role: 'accounting', title: 'صدور حواله حمل داخلی',
      detail: 'حواله از snapshot تغییرناپذیر لجستیک ساخته شده و آماده تأیید راننده است.',
      evidence: 'حواله DW-1405-0088 · ۲۴٫۰۰۰ تن', state: outage ? 'exception' : 'done', icon: FaCalculator,
    },
    {
      id: 'confirm', role: 'accounting', title: outage ? 'ثبت خروج دستی هنگام قطعی سراسری' : fallback ? 'تأیید جایگزین با کنترل دو نفره' : 'تأیید دریافت با اثر انگشت',
      detail: outage
        ? 'فرم اضطراری پیش‌شماره‌دار با تأیید مستقل حسابداری و سرپرست نگهبانی لازم است.'
        : fallback
          ? 'OTP راننده، دلیل اجباری، خطای دستگاه و تأیید سرپرست نگهبانیِ متفاوت لازم است.'
          : 'قالب ذخیره‌شده فقط تطبیق داده می‌شود؛ تصویر خام یا نسخه قالب در حواله ذخیره نمی‌شود.',
      evidence: outage ? 'OUT-0041 · ثبت پس از بازیابی اجباری' : fallback ? 'سه تلاش ناموفق · خطای CONNECTOR_TIMEOUT' : 'اسکنر ورودی حسابداری · کیفیت ۸۷٪',
      state: 'active', icon: outage ? FaExclamationTriangle : fallback ? FaMobileAlt : FaFingerprint,
    },
    {
      id: 'exit', role: 'guard', title: 'ثبت خروج فیزیکی',
      detail: 'نگهبانی مجوز فعال و یک‌بارمصرف را کنترل می‌کند؛ اسکن دوم راننده لازم نیست.',
      evidence: outage ? 'پس از بازیابی: ثبت زمان واقعی خروج' : 'اعتبار مجوز: ۱۲ ساعت · هنوز مصرف نشده',
      state: outage ? 'exception' : 'waiting', icon: FaRoute,
    },
    {
      id: 'sms', role: 'guard', title: 'اعلام نتیجه و بستن نوبت',
      detail: 'پس از خروج، نوبت بسته و پیامک شامل فقط شماره حواله و پلاک صف‌بندی می‌شود.',
      evidence: 'خطای ارسال مانع خروج نیست؛ تکرار و هشدار مستقل', state: 'waiting', icon: FaSms,
    },
  ];
}

function ScenarioControls({ role, scenario, onRole, onScenario }: {
  role: Role;
  scenario: Scenario;
  onRole: (role: Role) => void;
  onScenario: (scenario: Scenario) => void;
}) {
  return (
    <ErpSection title="زاویه بررسی نمونه" description="نقش و وضعیت را عوض کنید؛ داده‌ها نمایشی و همه اقدام‌ها بدون ذخیره‌سازی‌اند.">
      <div className="space-y-4">
        <div>
          <p className="sds-text-muted mb-2 text-xs font-semibold">نقش فعال</p>
          <ErpSegmentedControl
            value={role}
            onChange={onRole}
            options={(Object.entries(roleMeta) as Array<[Role, typeof roleMeta[Role]]>).map(([value, meta]) => ({ value, label: meta.short, icon: meta.icon }))}
          />
        </div>
        <div>
          <p className="sds-text-muted mb-2 text-xs font-semibold">سناریو</p>
          <ErpSegmentedControl
            value={scenario}
            onChange={onScenario}
            options={[
              { value: 'normal', label: 'خروج عادی' },
              { value: 'fallback', label: 'خرابی اسکنر' },
              { value: 'outage', label: 'قطعی سراسری' },
              { value: 'remaining', label: 'مانده قرارداد' },
            ]}
          />
        </div>
      </div>
    </ErpSection>
  );
}

function SafetyBanner({ scenario }: { scenario: Scenario }) {
  if (scenario === 'fallback') {
    return <ErpInlineState kind="stale" title="مسیر جایگزین فقط پس از خطای دستگاه یا سه تلاش زنده فعال است؛ آغازکننده و تأییدکننده باید دو کاربر متفاوت باشند." />;
  }
  if (scenario === 'outage') {
    return <ErpInlineState kind="error" title="این مسیر فقط برای قطعی تأییدشده کل ERP است؛ پس از بازیابی، ثبت گذشته‌نگر با زمان واقعی خروج اجباری است." />;
  }
  if (scenario === 'remaining') {
    return <ErpInlineState kind="success" title="مانده قابل بارگیری از ردیف قرارداد محاسبه می‌شود و فقط داده سالم اجازه نهایی‌سازی می‌دهد." />;
  }
  return <ErpInlineState kind="success" title="زنجیره هویت، تخصیص، صف، بار، حواله و مجوز خروج کامل و قابل ردیابی است." />;
}

function RemainingLoad() {
  return (
    <ErpSection title="حقیقت مانده قرارداد" description="ردیف محصول SC-1405-091 / سنگ طولی تراورتن">
      <ErpSummaryGrid
        columns={3}
        items={[
          { label: 'مقدار قرارداد', value: '۱۲۰٫۰۰۰ تن', hint: 'نسخه مالی مؤثر' },
          { label: 'نهایی / رزرو', value: '۲۴٫۰۰۰ تن', hint: 'بارگیری LG-2506', tone: 'warning' },
          { label: 'خروج فیزیکی', value: '۷۲٫۰۰۰ تن', hint: 'سه خروج ثبت‌شده', tone: 'success' },
          { label: 'قابل بارگیری', value: '۲۴٫۰۰۰ تن', hint: '۱۲۰ − ۲۴ − ۷۲', tone: 'primary' },
          { label: 'سلامت تصویر', value: 'CURRENT', hint: 'محاسبه مجدد هنگام نهایی‌سازی', tone: 'success' },
          { label: 'واحد', value: 'تن', hint: 'بدون تبدیل یا تجمیع واحد' },
        ]}
      />
    </ErpSection>
  );
}

function VariantA({ stages, role, scenario }: { stages: Stage[]; role: Role; scenario: Scenario }) {
  const roleStages = stages.filter((stage) => stage.role === role);
  const before = stages.filter((stage) => stage.state === 'done').length;
  const RoleIcon = roleMeta[role].icon;
  return (
    <div className="space-y-5">
      <SafetyBanner scenario={scenario} />
      <ErpMetricGrid items={[
        { label: 'هویت راننده', value: 'داخلی · فعال', icon: FaUserCheck, tone: 'success' },
        { label: 'مرحله جاری', value: 'تأیید حواله', icon: FaFingerprint, tone: 'primary' },
        { label: 'پیشرفت زنجیره', value: `${before.toLocaleString('fa-IR')} از ${stages.length.toLocaleString('fa-IR')}`, icon: FaMapSigns, tone: 'info' },
        { label: 'ریسک باز', value: scenario === 'normal' ? 'بدون مانع' : 'نیازمند کنترل', icon: FaShieldAlt, tone: scenario === 'normal' ? 'success' : 'warning' },
      ]} />
      <ErpTwoColumn
        main={
          <ErpSection title={`صف کار ${roleMeta[role].label}`} description="فقط تصمیم‌ها و اقدام‌های متعلق به نقش فعال پررنگ شده‌اند.">
            <div className="space-y-3">
              {roleStages.map((stage) => {
                const meta = stateMeta[stage.state];
                const Icon = stage.icon;
                return (
                  <ErpCard key={stage.id} tone={stage.state === 'active' ? 'primary' : meta.tone} className="p-4">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="flex min-w-0 gap-3">
                        <span className="sds-tone-info sds-tone-surface inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"><Icon /></span>
                        <div><h2 className="sds-text-primary font-bold">{stage.title}</h2><p className="sds-text-secondary mt-1 text-sm leading-6">{stage.detail}</p><p className="sds-text-muted mt-2 text-xs">{stage.evidence}</p></div>
                      </div>
                      <ErpBadge tone={meta.tone}>{meta.label}</ErpBadge>
                    </div>
                    {stage.state === 'active' && <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--sds-border-default)] pt-4"><ErpButton label={scenario === 'normal' ? 'شروع تطبیق اثر انگشت' : 'باز کردن کنترل استثنا'} icon={RoleIcon} variant="solid" /><ErpButton label="مشاهده شواهد قبلی" tone="neutral" /></div>}
                  </ErpCard>
                );
              })}
              {roleStages.length === 0 && <ErpInlineState kind="permission" title="در این مرحله اقدامی برای نقش شما وجود ندارد." />}
            </div>
          </ErpSection>
        }
        aside={
          <>
            <ErpSection title="پرونده جاری">
              <div className="space-y-3">
                <ErpFieldView label="راننده" value="رضا احمدی · پرسنلی ۱۰۸۴" hint="هویت داخلی از HR" />
                <ErpFieldView label="خودرو" value="ولوو FH · ۱۲ع۳۴۵ ایران ۱۱" hint="تخصیص فعال از عملیات خودرو" />
                <ErpFieldView label="بار" value="۲۴٫۰۰۰ تن تراورتن" hint="snapshot بارگیری LG-2506" />
                <ErpFieldView label="حواله" value="DW-1405-0088" hint="هنوز تأیید نشده" tone="warning" />
              </div>
            </ErpSection>
            <ErpSection title="تحویل بعدی"><p className="sds-text-secondary text-sm leading-6">پس از تأیید موفق، مجوز یک‌بارمصرف ۱۲ ساعته ساخته می‌شود و کار به نگهبانی می‌رسد.</p></ErpSection>
          </>
        }
      />
      {scenario === 'remaining' && <RemainingLoad />}
    </div>
  );
}

function VariantB({ stages, role, scenario, selected, onSelected }: { stages: Stage[]; role: Role; scenario: Scenario; selected: string; onSelected: (id: string) => void }) {
  const activeStage = stages.find((stage) => stage.id === selected) ?? stages[0];
  const activeIndex = stages.findIndex((stage) => stage.id === activeStage.id);
  return (
    <div className="space-y-5">
      <SafetyBanner scenario={scenario} />
      <ErpSection title="پرونده در یک نگاه" description="هویت و بار ثابت می‌مانند؛ مالک اقدام با حرکت پرونده بین فضای کارها عوض می‌شود.">
        <ErpSummaryGrid
          columns={3}
          items={[
            { label: 'راننده و خودرو', value: 'رضا احمدی · ۱۲ع۳۴۵ ایران ۱۱', hint: 'داخلی · تخصیص فعال' },
            { label: 'بار و قرارداد', value: '۲۴٫۰۰۰ تن تراورتن', hint: 'SC-1405-091 · LG-2506' },
            { label: 'حواله', value: 'DW-1405-0088', hint: 'snapshot تغییرناپذیر', tone: 'primary' },
            { label: 'ایستگاه جاری', value: activeStage.title, hint: `مالک: ${roleMeta[activeStage.role].label}`, tone: stateMeta[activeStage.state].tone },
            { label: 'نقش فعال', value: roleMeta[role].label, hint: activeStage.role === role ? 'اجازه اقدام دارد' : 'فقط مشاهده دارد', tone: activeStage.role === role ? 'success' : 'neutral' },
            { label: 'تحویل بعدی', value: stages[activeIndex + 1]?.title ?? 'پایان فرایند', hint: 'پس از ثبت موفق این ایستگاه' },
          ]}
        />
      </ErpSection>
      <ErpSection title="مسیر یک خروج" description="روی هر ایستگاه بزنید تا مالک، ورودی، مدرک و نتیجه آن را ببینید.">
        <ol className="relative space-y-1 border-r-2 border-[var(--sds-border-default)] pr-5">
          {stages.map((stage, index) => {
            const meta = stateMeta[stage.state];
            const role = roleMeta[stage.role];
            const Icon = stage.icon;
            const isSelected = stage.id === activeStage.id;
            return (
              <li key={stage.id} className="relative pb-3">
                <span className="absolute -right-[1.95rem] top-4 inline-flex h-7 w-7 items-center justify-center rounded-full border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] text-xs font-bold">{(index + 1).toLocaleString('fa-IR')}</span>
                <ErpPressable onClick={() => onSelected(stage.id)} aria-pressed={isSelected} className={`w-full p-3 text-right ${isSelected ? 'sds-tone-primary sds-tone-surface' : ''}`}>
                  <span className="flex items-start gap-3"><Icon className="mt-1 shrink-0" /><span className="min-w-0 flex-1"><span className="flex flex-wrap items-center gap-2"><strong>{stage.title}</strong><ErpBadge tone={role.tone}>{role.short}</ErpBadge><ErpBadge tone={meta.tone}>{meta.label}</ErpBadge></span><span className="sds-text-muted mt-1 block text-xs">{stage.evidence}</span></span></span>
                </ErpPressable>
              </li>
            );
          })}
        </ol>
      </ErpSection>
      <ErpTwoColumn
        main={
          <ErpSection title={`ایستگاه انتخاب‌شده: ${activeStage.title}`} description={`مالک تصمیم: ${roleMeta[activeStage.role].label}`}>
            <div className="space-y-4">
              <p className="sds-text-secondary text-sm leading-7">{activeStage.detail}</p>
              <ErpSummaryGrid items={[
                { label: 'ورودی معتبر', value: activeIndex === 0 ? 'پرونده پرسنلی فعال' : stages[activeIndex - 1].evidence },
                { label: 'مدرک ثبت‌شونده', value: activeStage.evidence, tone: stateMeta[activeStage.state].tone },
              ]} />
              <div className="flex flex-wrap gap-2">
                <ErpButton label={activeStage.state === 'active' ? 'انجام اقدام ایمن' : 'مشاهده رویداد ثبت‌شده'} variant="solid" disabled={activeStage.role !== role} />
                <ErpButton label="نمایش زنجیره شواهد" tone="neutral" />
                <ErpButton label="اعلام مغایرت" tone="warning" />
              </div>
              {activeStage.role !== role && <ErpInlineState kind="permission" title={`نقش فعال فقط مشاهده دارد؛ مالک این ایستگاه ${roleMeta[activeStage.role].label} است.`} />}
            </div>
          </ErpSection>
        }
        aside={
          <>
            <ErpSection title="کنترل‌های ایمنی">
              <div className="space-y-3">
                <ErpFieldView label="تفکیک وظایف" value={scenario === 'fallback' || scenario === 'outage' ? 'دو کاربر مستقل لازم' : 'بدون استثنا'} tone={scenario === 'normal' ? 'success' : 'warning'} />
                <ErpFieldView label="داده حساس" value="فقط نتیجه تطبیق" hint="تصویر خام، OTP و قالب قابل مشاهده نیست" tone="success" />
                <ErpFieldView label="مجوز خروج" value="یک‌بارمصرف · ۱۲ ساعت" hint="ابطال، انقضا و مصرف ثبت می‌شوند" />
                <ErpFieldView label="پیامک" value="پس از خروج" hint="شکست ارسال مانع خروج نیست" />
              </div>
            </ErpSection>
            <ErpSection title="بازیابی امن">
              <p className="sds-text-secondary text-sm leading-6">قبل از تأیید: ابطال و صدور مجدد. بعد از تأیید: لغو مجوز و تأیید دوباره. بعد از خروج: فقط اصلاحیه حسابرسی‌شده.</p>
            </ErpSection>
          </>
        }
      />
      {scenario === 'remaining' && <RemainingLoad />}
    </div>
  );
}

function VariantC({ stages, role, scenario, selected, onSelected }: { stages: Stage[]; role: Role; scenario: Scenario; selected: string; onSelected: (id: string) => void }) {
  const active = stages.find((stage) => stage.id === selected) ?? stages.find((stage) => stage.state === 'active') ?? stages[0];
  const activeIndex = stages.findIndex((stage) => stage.id === active.id);
  return (
    <div className="space-y-5">
      <SafetyBanner scenario={scenario} />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[18rem_minmax(0,1fr)_20rem]">
        <ErpSection title="اجزای پرونده" className="xl:sticky xl:top-4 xl:self-start">
          <div className="space-y-2">
            {stages.map((stage, index) => {
              const meta = stateMeta[stage.state];
              return <ErpPressable key={stage.id} onClick={() => onSelected(stage.id)} aria-pressed={stage.id === active.id} className={`flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-right ${stage.id === active.id ? 'sds-tone-primary sds-tone-surface' : ''}`}><span className="truncate text-sm font-semibold">{(index + 1).toLocaleString('fa-IR')}. {stage.title}</span><ErpStatus label={meta.label} tone={meta.tone} /></ErpPressable>;
            })}
          </div>
        </ErpSection>
        <ErpSection title={active.title} description={`مالک: ${roleMeta[active.role].label}`}>
          <div className="space-y-5">
            <ErpCard tone={stateMeta[active.state].tone} className="p-5"><p className="sds-text-primary text-lg font-bold">تصمیم این مرحله</p><p className="sds-text-secondary mt-2 leading-7">{active.detail}</p></ErpCard>
            <ErpSummaryGrid items={[
              { label: 'ورودی معتبر', value: activeIndex === 0 ? 'پرونده پرسنلی فعال' : stages[activeIndex - 1].evidence },
              { label: 'خروجی ثبت‌شونده', value: active.evidence, tone: stateMeta[active.state].tone },
              { label: 'اختیار نقش فعال', value: active.role === role ? 'اقدام و مشاهده' : 'فقط مشاهده', tone: active.role === role ? 'success' : 'neutral' },
              { label: 'مرحله بعد', value: stages[activeIndex + 1]?.title ?? 'پایان فرایند' },
            ]} />
            <div className="flex flex-wrap gap-2"><ErpButton label="ثبت تصمیم و ادامه" variant="solid" disabled={active.role !== role || active.state !== 'active'} /><ErpButton label="اعلام مغایرت" tone="warning" /><ErpButton label="مشاهده تاریخچه" tone="neutral" /></div>
          </div>
        </ErpSection>
        <div className="space-y-5 xl:sticky xl:top-4 xl:self-start">
          <ErpSection title="کنترل‌های ایمنی">
            <div className="space-y-3">
              <ErpFieldView label="تفکیک وظایف" value={scenario === 'fallback' || scenario === 'outage' ? 'دو کاربر مستقل لازم' : 'بدون استثنا'} tone={scenario === 'normal' ? 'success' : 'warning'} />
              <ErpFieldView label="اثر زیست‌سنجی" value="فقط نتیجه تطبیق" hint="تصویر خام ذخیره نمی‌شود" tone="success" />
              <ErpFieldView label="مجوز خروج" value="یک‌بارمصرف · ۱۲ ساعت" hint="ابطال یا انقضا قابل مشاهده است" />
              <ErpFieldView label="پیامک" value="پس از خروج" hint="شکست ارسال مانع خروج نیست" />
            </div>
          </ErpSection>
          <ErpSection title="بازیابی"><p className="sds-text-secondary text-sm leading-6">قبل از تأیید: ابطال و صدور مجدد. بعد از تأیید و قبل از خروج: لغو مجوز و تأیید دوباره. بعد از خروج: فقط اصلاحیه حسابرسی‌شده.</p></ErpSection>
        </div>
      </div>
      {scenario === 'remaining' && <RemainingLoad />}
    </div>
  );
}

export default function DriverDispatchPrototype() {
  const searchParams = useSearchParams();
  const variant = variants.some((item) => item.key === searchParams.get('variant')) ? searchParams.get('variant')! : 'A';
  const [role, setRole] = useState<Role>('accounting');
  const [scenario, setScenario] = useState<Scenario>('normal');
  const [selected, setSelected] = useState('confirm');
  const stages = useMemo(() => buildStages(scenario), [scenario]);

  return (
    <ErpPage
      eyebrow="نمونه دورریختنی · مسئله Wayfinder"
      title="از راننده تا خروج کارخانه"
      description="آیا مسیر کامل بین منابع انسانی، عملیات خودرو، نگهبانی، لجستیک و حسابداری برای هر نقش قابل فهم و ایمن است؟"
      backHref="/dashboard"
      actions={[{ label: 'داده نمایشی است', icon: FaBuilding, tone: 'neutral', disabled: true }]}
    >
      <ScenarioControls role={role} scenario={scenario} onRole={setRole} onScenario={setScenario} />
      {variant === 'A' && <VariantA stages={stages} role={role} scenario={scenario} />}
      {variant === 'B' && <VariantB stages={stages} role={role} scenario={scenario} selected={selected} onSelected={setSelected} />}
      {variant === 'C' && <VariantC stages={stages} role={role} scenario={scenario} selected={selected} onSelected={setSelected} />}
      <PrototypeSwitcher variants={variants} current={variant} />
      <div className="h-20" aria-hidden="true" />
    </ErpPage>
  );
}
