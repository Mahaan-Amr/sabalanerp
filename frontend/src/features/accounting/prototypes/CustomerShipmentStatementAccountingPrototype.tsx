'use client';

// PROTOTYPE — three Accounting dispatch-bundle layouts, switchable with
// ?statementPrototype=A|B|C on the existing /dashboard/accounting route.

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { FaBoxOpen, FaCheck, FaDownload, FaExclamationTriangle, FaFileAlt, FaHistory, FaPrint, FaRedo, FaTimes } from 'react-icons/fa';
import {
  ErpActionMenu, ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpFieldView, ErpInlineState,
  ErpInput, ErpPressable, ErpSection, ErpSegmentedControl, ErpSummaryGrid, ErpTwoColumn,
} from '@/components/erp';
import PrototypeVariantSwitcher from '@/features/prototypes/PrototypeVariantSwitcher';

type VariantKey = 'A' | 'B' | 'C';
type ScenarioKey = 'ready' | 'stale' | 'incomplete' | 'issued' | 'history' | 'viewOnly' | 'empty' | 'error';

const variants = [
  { key: 'A', label: 'صف و بازبینی دو ستونه' },
  { key: 'B', label: 'میزکار متمرکز' },
  { key: 'C', label: 'صف استثنامحور' },
];
const scenarios: Array<{ value: ScenarioKey; label: string }> = [
  { value: 'ready', label: 'آماده بررسی' }, { value: 'stale', label: 'قیمت تغییر کرده' },
  { value: 'incomplete', label: 'مدرک ناقص' }, { value: 'issued', label: 'صادرشده' },
  { value: 'history', label: 'جایگزین و اصلاحیه' }, { value: 'viewOnly', label: 'فقط مشاهده' },
  { value: 'empty', label: 'صف خالی' }, { value: 'error', label: 'خطای بازیابی' },
];
const cases = [
  { id: 'ارسال ۱۲۵۸', customer: 'شرکت عمران آریا', destination: 'پروژه ونک', total: '۸٬۷۴۰٬۰۰۰٬۰۰۰ ریال', tone: 'warning' as const },
  { id: 'ارسال ۱۲۶۰', customer: 'سنگ‌سازان پارس', destination: 'کارگاه شهریار', total: '۲٬۱۸۰٬۰۰۰٬۰۰۰ ریال', tone: 'info' as const },
  { id: 'ارسال ۱۲۶۳', customer: 'سازه گستر شرق', destination: 'پروژه نیاوران', total: '۴٬۹۲۰٬۰۰۰٬۰۰۰ ریال', tone: 'danger' as const },
];

function ScenarioFrame({ scenario, onScenarioChange, children }: { scenario: ScenarioKey; onScenarioChange: (scenario: ScenarioKey) => void; children: ReactNode }) {
  return <ErpSection title="نمونه آزمایشی بسته اسناد ارسال" description="داده‌ها ساختگی و فرمان‌ها غیرفعال‌اند؛ این نمونه فقط برای تصمیم‌گیری درباره چیدمان و بازیابی است.">
    <ErpSegmentedControl options={scenarios} value={scenario} onChange={onScenarioChange} />
    <div className="mt-4">{children}</div>
  </ErpSection>;
}

function StateNotice({ scenario }: { scenario: ScenarioKey }) {
  if (scenario === 'stale') return <ErpInlineState kind="stale" title="نسخه قیمت قرارداد ۱۴۰۵-۳۴ پس از نهایی‌سازی تغییر کرده است" action={{ label: 'بازگشت به لجستیک', icon: FaRedo }} />;
  if (scenario === 'incomplete') return <ErpInlineState kind="error" title="صدور مسدود است: شناسه پایدار ردیف و مدرک تخفیف کامل نیست" action={{ label: 'مشاهده موارد ناقص', icon: FaExclamationTriangle }} />;
  if (scenario === 'viewOnly') return <ErpInlineState kind="permission" title="شما دسترسی مشاهده دارید؛ پذیرش، رد و چاپ برای این نقش مجاز نیست" />;
  if (scenario === 'error') return <ErpInlineState kind="error" title="به‌روزرسانی صف انجام نشد؛ آخرین نمایش موفق حفظ شده است" actions={[{ label: 'تلاش دوباره', icon: FaRedo }, { label: 'جزئیات خطا', variant: 'ghost' }]} />;
  if (scenario === 'issued') return <ErpInlineState kind="success" title="بارنامه و صورت‌حساب مشتری با شماره ۱۲۵۸ از یک تصویر ثابت صادر شدند" />;
  if (scenario === 'history') return <ErpInlineState kind="success" title="بسته جایگزین ۱۲۶۶ فعال است؛ اصل ۱۲۵۸ و اصلاحیه ۱ در سابقه حفظ شده‌اند" />;
  return null;
}

function EvidenceSummary({ blocked = false }: { blocked?: boolean }) {
  return <ErpSummaryGrid columns={3} items={[
    { label: 'بار قطعی', value: '۲۸٫۵۰۰ متر مربع', hint: 'ویرایش‌ناپذیر در حسابداری', tone: 'neutral' },
    { label: 'نسخه‌های قیمت', value: blocked ? '۱ مورد نامعتبر' : '۲ نسخه تأییدشده', hint: blocked ? 'نیازمند نهایی‌سازی جانشین' : 'منطبق با زمان نهایی‌سازی', tone: blocked ? 'danger' : 'success' },
    { label: 'جمع ارسال', value: '۸٬۷۴۰٬۰۰۰٬۰۰۰ ریال', hint: 'یک ارز؛ با تخصیص تخفیف و هزینه', tone: 'primary' },
  ]} />;
}

function DocumentActions({ scenario }: { scenario: ScenarioKey }) {
  const history = scenario === 'history';
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2"><ErpBadge tone="success">بسته فعال {history ? '۱۲۶۶' : '۱۲۵۸'}</ErpBadge>{history && <ErpBadge tone="purple">اصلاحیه ۱</ErpBadge>}</div>
    <div className="flex flex-wrap gap-2">
      <ErpButton label="چاپ بارنامه" icon={FaPrint} /><ErpButton label="چاپ صورت‌حساب" icon={FaPrint} variant="outline" />
      <ErpButton label="چاپ هر دو" icon={FaPrint} variant="soft" /><ErpButton label="دانلود" icon={FaDownload} variant="ghost" />
      <ErpActionMenu label="اقدامات بیشتر" actions={[{ label: 'جایگزینی بسته اسناد', icon: FaRedo, tone: 'warning' }, { label: 'مشاهده اثرانگشت فایل‌ها', icon: FaFileAlt }, { label: 'سابقه چاپ', icon: FaHistory }]} />
    </div>
    <p className="text-xs text-[var(--sds-text-secondary)]">چاپ و دانلود همان فایل صادرشده را برمی‌گرداند؛ «چاپ هر دو» فایل سومی ذخیره نمی‌کند.</p>
  </div>;
}

function ReviewActions({ scenario }: { scenario: ScenarioKey }) {
  const blocked = ['stale', 'incomplete', 'viewOnly', 'error'].includes(scenario);
  if (['issued', 'history'].includes(scenario)) return <DocumentActions scenario={scenario} />;
  return <div className="space-y-3">
    <ErpInput aria-label="دلیل رد نامزد ارسال" placeholder="دلیل رد را برای بازگشت به منبع وارد کنید" disabled={blocked} />
    <div className="flex flex-wrap gap-2"><ErpButton label="پذیرش و صدور هر دو سند" icon={FaCheck} tone="success" disabled={blocked} /><ErpButton label="رد برای اصلاح در منبع" icon={FaTimes} tone="danger" variant="outline" disabled={blocked} /></div>
    {!blocked && <p className="text-xs text-[var(--sds-text-secondary)]">پذیرش یک فرمان اتمی است: شماره دائمی، تصویر ثابت و هر دو PDF با هم ایجاد می‌شوند.</p>}
  </div>;
}

function CaseDetail({ scenario, compact = false }: { scenario: ScenarioKey; compact?: boolean }) {
  const blocked = scenario === 'stale' || scenario === 'incomplete';
  return <div className="space-y-4">
    <StateNotice scenario={scenario} />
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-lg font-bold text-[var(--sds-text-primary)]">ارسال ۱۲۵۸ · شرکت عمران آریا</h3><p className="mt-1 text-sm text-[var(--sds-text-secondary)]">پروژه ونک · پلاک ۷۸ الف ۴۵۶ ایران ۱۱ · راننده: علی رضایی</p></div><ErpBadge tone={blocked ? 'danger' : scenario === 'ready' ? 'warning' : 'success'}>{blocked ? 'مسدود' : scenario === 'ready' ? 'در انتظار بررسی' : 'صادرشده'}</ErpBadge></div>
    {!compact && <EvidenceSummary blocked={blocked} />}
    <ErpCard className="p-4"><div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><ErpFieldView label="منابع" value="۲ قرارداد · ۴ ردیف پایدار" hint="ردیف‌های مشابه ادغام نشده‌اند" /><ErpFieldView label="تصویر قیمت" value={blocked ? 'نیازمند رسیدگی' : 'کامل و تازه'} hint="ثبت‌شده هنگام نهایی‌سازی لجستیک" tone={blocked ? 'danger' : 'success'} /></div></ErpCard>
    <ReviewActions scenario={scenario} />
    {scenario === 'history' && <ErpCard className="p-4"><h4 className="font-semibold text-[var(--sds-text-primary)]">سابقه تغییرناپذیر</h4><div className="mt-3 space-y-2 text-sm text-[var(--sds-text-secondary)]"><p>بسته ۱۲۶۶ · فعال · جایگزین بسته ۱۲۵۸</p><p>اصلاحیه ۱۲۵۸ / اصلاحیه ۱ · تغییر مقدار ردیف قرارداد ۱۴۰۵-۳۴</p><p>بسته ۱۲۵۸ · باطل‌شده · فایل‌ها و سابقه چاپ حفظ شده‌اند</p></div></ErpCard>}
  </div>;
}

function QueueCards({ selectedId = 'ارسال ۱۲۵۸' }: { selectedId?: string }) {
  return <div className="space-y-2">{cases.map((item) => <ErpPressable key={item.id} className={`min-h-11 w-full rounded-lg border p-3 text-right transition ${selectedId === item.id ? 'border-[var(--sds-accent)] bg-[var(--sds-accent-soft)]' : 'border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)]'}`}><span className="flex items-start justify-between gap-2"><strong className="text-sm text-[var(--sds-text-primary)]">{item.id} · {item.customer}</strong><ErpBadge tone={item.tone}>{item.id === 'ارسال ۱۲۶۳' ? 'مسدود' : 'در انتظار'}</ErpBadge></span><span className="mt-1 block text-xs text-[var(--sds-text-secondary)]">{item.destination} · {item.total}</span></ErpPressable>)}</div>;
}

function VariantA({ scenario }: { scenario: ScenarioKey }) {
  return <ErpTwoColumn main={scenario === 'empty' ? <ErpEmptyState icon={FaBoxOpen} title="نامزد آماده بررسی وجود ندارد" description="نامزدهای تازه پس از نهایی‌سازی معتبر لجستیک اینجا ظاهر می‌شوند." /> : <CaseDetail scenario={scenario} />} aside={<ErpCard className="p-4"><h3 className="mb-3 font-semibold text-[var(--sds-text-primary)]">صف بررسی · ۳ مورد</h3>{scenario === 'empty' ? <p className="text-sm text-[var(--sds-text-secondary)]">صف خالی است.</p> : <QueueCards />}</ErpCard>} />;
}

function VariantB({ scenario }: { scenario: ScenarioKey }) {
  if (scenario === 'empty') return <ErpEmptyState icon={FaBoxOpen} title="کار امروز تمام شده است" description="همه نامزدهای قابل اقدام بررسی شده‌اند." />;
  return <div className="space-y-4"><StateNotice scenario={scenario} /><ErpCard className="overflow-hidden"><div className="border-b border-[var(--sds-border-default)] p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs text-[var(--sds-text-secondary)]">مورد ۱ از ۳</p><h3 className="mt-1 text-xl font-bold text-[var(--sds-text-primary)]">آیا بسته ارسال ۱۲۵۸ قابل صدور است؟</h3></div><ErpBadge tone="warning">در انتظار تصمیم</ErpBadge></div></div><div className="space-y-4 p-4"><EvidenceSummary blocked={scenario === 'stale' || scenario === 'incomplete'} /><div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_20rem]"><div className="space-y-2 text-sm text-[var(--sds-text-secondary)]"><p><strong className="text-[var(--sds-text-primary)]">مشتری:</strong> شرکت عمران آریا · پروژه ونک</p><p><strong className="text-[var(--sds-text-primary)]">بار:</strong> ۲۸٫۵۰۰ متر مربع در ۴ ردیف از ۲ قرارداد</p><p><strong className="text-[var(--sds-text-primary)]">حمل:</strong> علی رضایی · ۷۸ الف ۴۵۶ ایران ۱۱</p></div><ReviewActions scenario={scenario} /></div></div></ErpCard><div className="flex justify-center"><ErpButton label="مورد بعدی صف" variant="ghost" /></div></div>;
}

function VariantC({ scenario }: { scenario: ScenarioKey }) {
  if (scenario === 'empty') return <ErpEmptyState icon={FaBoxOpen} title="هیچ ارسال نیازمند توجه نیست" description="صادرشده‌ها از سابقه اسناد قابل دسترسی‌اند." />;
  const blocking = scenario === 'stale' || scenario === 'incomplete' || scenario === 'error';
  return <div className="space-y-4"><StateNotice scenario={scenario} /><div className="grid grid-cols-1 gap-4 lg:grid-cols-3"><ErpCard className="p-4 lg:col-span-2"><div className="flex items-center justify-between gap-2"><h3 className="font-semibold text-[var(--sds-text-primary)]">نیازمند اقدام</h3><ErpBadge tone={blocking ? 'danger' : 'warning'}>{blocking ? '۱ مسدود' : '۲ آماده'}</ErpBadge></div><div className="mt-3"><QueueCards /></div></ErpCard><div className="space-y-4"><ErpCard className="p-4"><h3 className="font-semibold text-[var(--sds-text-primary)]">صدور امروز</h3><p className="mt-2 text-2xl font-bold text-[var(--sds-text-primary)]">۷ بسته</p><p className="text-xs text-[var(--sds-text-secondary)]">۱۴ فایل تغییرناپذیر</p></ErpCard><ErpCard className="p-4"><h3 className="font-semibold text-[var(--sds-text-primary)]">استثناها</h3><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">۱ قیمت منقضی · ۱ مدرک ناقص · ۱ جایگزینی</p></ErpCard></div></div><ErpCard className="p-4"><CaseDetail scenario={scenario} compact /></ErpCard></div>;
}

export default function CustomerShipmentStatementAccountingPrototype() {
  const [variant, setVariant] = useState<VariantKey>('A');
  const [scenario, setScenario] = useState<ScenarioKey>('ready');
  const [enabled, setEnabled] = useState(false);
  useEffect(() => { const value = new URL(window.location.href).searchParams.get('statementPrototype'); if (value && variants.some((item) => item.key === value)) { setVariant(value as VariantKey); setEnabled(true); } }, []);
  const content = useMemo(() => variant === 'B' ? <VariantB scenario={scenario} /> : variant === 'C' ? <VariantC scenario={scenario} /> : <VariantA scenario={scenario} />, [scenario, variant]);
  if (!enabled) return null;
  return <><ScenarioFrame scenario={scenario} onScenarioChange={setScenario}>{content}</ScenarioFrame>{process.env.NODE_ENV !== 'production' && <PrototypeVariantSwitcher variants={variants} current={variant} parameter="statementPrototype" onChange={(key) => setVariant(key as VariantKey)} />}</>;
}
