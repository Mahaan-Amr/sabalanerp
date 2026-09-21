'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ErpBadge,
  ErpButton,
  ErpCard,
  ErpEmptyState,
  ErpInlineState,
  ErpInput,
  ErpLoading,
  ErpMetricGrid,
  ErpPage,
  ErpSection,
  ErpSegmentedControl,
  ErpSelect,
} from '@/components/erp';
import { accountingAPI } from '@/lib/api';

type Tab = 'assets' | 'payroll' | 'schedules' | 'reports' | 'tax' | 'close' | 'archive';
type Notice = { kind: 'success' | 'error'; title: string };

const statusFa: Record<string, string> = {
  ACTIVE: 'فعال', UNDER_CONSTRUCTION: 'در جریان تکمیل', DISPOSED: 'واگذار‌شده', LOST: 'مفقود',
  OPEN: 'باز', PARTIALLY_SETTLED: 'تسویه جزئی', SETTLED: 'تسویه‌شده', FAILED: 'ناموفق',
  POSTED: 'ثبت قطعی', RETURNED: 'برگشت به منابع انسانی', IN_PROGRESS: 'در حال کنترل',
  BLOCKED: 'مسدود', READY: 'آماده بستن', HARD_CLOSED: 'بسته قطعی', INVALIDATED: 'نیازمند بازآزمایی',
  ACCEPTED: 'پذیرفته', WAITING: 'در انتظار', RECOGNIZED_PROVISION: 'ذخیره شناسایی‌شده',
  DISCLOSURE_ONLY: 'فقط افشا', REMOTE_ITEM: 'بعید',
  COMPLETED: 'تکمیل‌شده', SUCCEEDED: 'موفق', REVERSED: 'برگشت‌شده',
};
const reportTypeFa: Record<string, string> = {
  T_ACCOUNT: 'حساب تی', TRIAL_BALANCE: 'تراز آزمایشی', FINANCIAL_STATEMENT: 'صورت‌های مالی',
  CASH_FLOW: 'صورت جریان وجوه نقد', LEGAL_BOOK: 'دفاتر قانونی',
};
const closeStepFa: Record<string, string> = {
  DOCUMENTS: 'اسناد', SUBLEDGERS: 'معین‌ها', TREASURY: 'خزانه', INVENTORY: 'موجودی و بهای تمام‌شده',
  FIXED_ASSETS: 'دارایی ثابت', PAYROLL: 'حقوق', SCHEDULES: 'برنامه‌های شناسایی', TAX: 'مالیات',
  SUSPENSE: 'حساب‌های معلق', TRIAL_BALANCE: 'تراز آزمایشی', REPORT_SNAPSHOT: 'گزارش رسمی منجمد',
};
const evidenceTypeFa: Record<string, string> = {
  REPORT: 'گزارش رسمی', RECEIPT: 'رسید قانونی', ATTACHMENT: 'پیوست', VALIDATION: 'نتیجه اعتبارسنجی',
};
const malwareStatusFa: Record<string, string> = { CLEAN: 'پاک', PENDING: 'در انتظار بررسی', REJECTED: 'ردشده' };
const toneOf = (status: string) => status === 'READY' || status === 'ACTIVE' || status === 'POSTED' || status === 'ACCEPTED' || status === 'SETTLED'
  ? 'success' : status === 'BLOCKED' || status === 'FAILED' ? 'danger' : 'warning';
const digits = (value: unknown) => {
  try { return BigInt(String(value ?? 0)).toLocaleString('fa-IR'); } catch { return '۰'; }
};
const dateFa = (value?: string | null) => value ? new Date(value).toLocaleDateString('fa-IR') : '—';

export default function AccountingPeriodEndPage() {
  const [context, setContext] = useState<any>();
  const [overview, setOverview] = useState<any>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<Tab>('assets');
  const [notice, setNotice] = useState<Notice>();
  const [closeReason, setCloseReason] = useState('');
  const [report, setReport] = useState({ reportKind: 'TRIAL_BALANCE', fiscalYearId: '', mappingVersionId: '', statutoryFormatId: '', from: '', to: '', cutoffAt: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const contextResponse = await accountingAPI.getLedgerContext();
      const nextContext = contextResponse.data.data;
      setContext(nextContext);
      const bookId = nextContext?.books?.[0]?.id;
      if (bookId) {
        const response = await accountingAPI.getPeriodEndOverview(bookId);
        setOverview(response.data.data);
        setReport((current) => ({
          ...current,
          fiscalYearId: current.fiscalYearId || nextContext.books[0]?.fiscalYears?.[0]?.id || '',
          mappingVersionId: current.mappingVersionId || response.data.data?.mappings?.[0]?.id || '',
        }));
      }
    } catch (error: any) {
      setNotice({ kind: 'error', title: error.response?.data?.error || 'خواندن اطلاعات پایان دوره ناموفق بود.' });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);
  const book = context?.books?.[0];
  const years = book?.fiscalYears || [];
  const openPayroll = useMemo(() => (overview?.payroll || []).flatMap((handoff: any) => handoff.obligations || []).filter((item: any) => item.status !== 'SETTLED'), [overview]);
  const overdueTaxes = useMemo(() => (overview?.taxes || []).filter((item: any) => item.status !== 'SETTLED' && new Date(item.dueAt) < new Date()), [overview]);
  const dueSchedules = useMemo(() => (overview?.schedules || []).filter((item: any) => item.status === 'ACTIVE' && item.nextReviewAt && new Date(item.nextReviewAt) <= new Date()), [overview]);

  const act = async (operation: () => Promise<unknown>, message: string) => {
    setSaving(true); setNotice(undefined);
    try { await operation(); setNotice({ kind: 'success', title: message }); await load(); }
    catch (error: any) { setNotice({ kind: 'error', title: error.response?.data?.error || 'انجام عملیات ناموفق بود.' }); }
    finally { setSaving(false); }
  };

  if (loading) return <ErpLoading />;
  if (!book) return <ErpPage eyebrow="حسابداری" title="پایان دوره و گزارش‌های قانونی" backHref="/dashboard/accounting"><ErpEmptyState title="دفتر اصلی هنوز راه‌اندازی نشده است." description="ابتدا دفترکل، سال مالی و حساب‌ها را تعریف کنید." action={{ label: 'رفتن به دفترکل', href: '/dashboard/accounting/ledger' }} /></ErpPage>;

  return (
    <ErpPage
      eyebrow="حسابداری"
      title="پایان دوره و گزارش‌های قانونی"
      description="دارایی ثابت، حقوق، برنامه‌های شناسایی، مالیات، گزارش رسمی و بستن دوره از یک زنجیره قابل‌ردیابی"
      backHref="/dashboard/accounting"
      actions={[{ label: 'به‌روزرسانی', onClick: load, tone: 'neutral', variant: 'outline' }]}
    >
      {notice && <ErpInlineState kind={notice.kind} title={notice.title} />}
      <ErpMetricGrid items={[
        { label: 'دارایی‌های ثبت‌شده', value: digits(overview?.assets?.length), tone: 'info' },
        { label: 'تعهدات باز حقوق', value: digits(openPayroll.length), tone: openPayroll.length ? 'warning' : 'success' },
        { label: 'بازبینی سررسیدشده', value: digits(dueSchedules.length), tone: dueSchedules.length ? 'warning' : 'success' },
        { label: 'تکالیف مالیاتی عقب‌افتاده', value: digits(overdueTaxes.length), tone: overdueTaxes.length ? 'danger' : 'success' },
      ]} />
      <ErpSection>
        <ErpSegmentedControl
          value={tab}
          onChange={(value) => setTab(value as Tab)}
          options={[
            { value: 'assets', label: 'دارایی ثابت' }, { value: 'payroll', label: 'حقوق' },
            { value: 'schedules', label: 'برنامه‌ها و برآوردها' }, { value: 'reports', label: 'گزارش رسمی' },
            { value: 'tax', label: 'تقویم مالیاتی' }, { value: 'close', label: 'بستن دوره' }, { value: 'archive', label: 'بایگانی قانونی' },
          ]}
        />
      </ErpSection>

      {tab === 'assets' && <ErpSection title="دفتر دارایی‌های ثابت" description="استهلاک فقط پس از شاهد آماده‌به‌کار آغاز می‌شود و مبنای دفتری از مبنای مالیاتی جدا می‌ماند.">
        {!overview?.assets?.length ? <ErpEmptyState title="هنوز دارایی ثابتی ثبت نشده است." description="سیاست طبقه و هویت پایدار دارایی از مسیر مدیر حسابداری ثبت می‌شود." /> : <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{overview.assets.map((asset: any) => <ErpCard key={asset.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><strong>{asset.registerNumber} · {asset.titlePersian}</strong><span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">{asset.location || 'مکان ثبت نشده'} · {digits(asset.components?.length)} جزء</span></div><ErpBadge tone={toneOf(asset.status) as any}>{statusFa[asset.status] || asset.status}</ErpBadge></div><div className="mt-3 grid gap-1 text-sm"><span>بهای دفتری: {digits(asset.bookCostRials)} ریال</span><span>مبنای مالیاتی: {digits(asset.taxCostRials)} ریال</span><span>آماده‌به‌کار: {dateFa(asset.readyForUseAt)}</span></div></ErpCard>)}</div>}
      </ErpSection>}

      {tab === 'payroll' && <ErpSection title="تحویل و تسویه حقوق" description="جزئیات فردی در منابع انسانی می‌ماند؛ دفترکل فقط خلاصه متوازن و تعهدات کنترل‌شده را می‌بیند.">
        {!overview?.payroll?.length ? <ErpEmptyState title="تحویل تأییدشده‌ای از منابع انسانی دریافت نشده است." /> : <div className="space-y-3">{overview.payroll.map((handoff: any) => <ErpCard key={handoff.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><strong>دوره حقوق {handoff.payrollRunId} · نسخه {Number(handoff.payrollRunVersion).toLocaleString('fa-IR')}</strong><ErpBadge tone={toneOf(handoff.status) as any}>{statusFa[handoff.status] || handoff.status}</ErpBadge></div><div className="mt-3 grid gap-2 md:grid-cols-3"><span>بدهکار: {digits(handoff.debitTotalRials)} ریال</span><span>بستانکار: {digits(handoff.creditTotalRials)} ریال</span><span>تعهد باز: {digits(handoff.obligations?.filter((item: any) => item.status !== 'SETTLED').length)} مورد</span></div></ErpCard>)}</div>}
      </ErpSection>}

      {tab === 'schedules' && <div className="space-y-4"><ErpSection title="برنامه‌های شناسایی">
        {!overview?.schedules?.length ? <ErpEmptyState title="برنامه شناسایی فعالی وجود ندارد." /> : <div className="grid gap-3 md:grid-cols-2">{overview.schedules.map((schedule: any) => <ErpCard key={schedule.id} className="p-4"><div className="flex items-center justify-between gap-3"><strong>{schedule.scheduleIdentity} · نسخه {Number(schedule.version).toLocaleString('fa-IR')}</strong><ErpBadge tone={toneOf(schedule.status) as any}>{statusFa[schedule.status] || schedule.status}</ErpBadge></div><div className="mt-3 grid gap-1 text-sm"><span>کل: {digits(schedule.totalRials)} ریال</span><span>شناسایی‌شده: {digits(schedule.recognizedRials)} ریال</span><span>بازبینی بعدی: {dateFa(schedule.nextReviewAt)}</span></div></ErpCard>)}</div>}
      </ErpSection><ErpSection title="برآوردها، ذخایر و موارد احتمالی">{!overview?.estimates?.length ? <ErpEmptyState title="پرونده برآورد یا احتمال بازی وجود ندارد." /> : <div className="grid gap-3 md:grid-cols-2">{overview.estimates.map((item: any) => <ErpCard key={item.id} className="p-4"><div className="flex items-center justify-between gap-3"><strong>{item.titlePersian}</strong><ErpBadge tone={item.classification === 'RECOGNIZED_PROVISION' ? 'warning' : 'info'}>{statusFa[item.classification] || item.classification}</ErpBadge></div><span className="mt-3 block text-sm">بازبینی: {dateFa(item.nextReviewAt)}</span></ErpCard>)}</div>}</ErpSection></div>}

      {tab === 'reports' && <div className="space-y-4"><ErpSection title="ساخت snapshot رسمی" description="PDF و Excel باید از همین dataset منجمد و یک اثر انگشت واحد ساخته شوند.">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <label><span className="mb-2 block text-sm">نوع گزارش</span><ErpSelect value={report.reportKind} onChange={(event) => setReport({ ...report, reportKind: event.target.value })}><option value="TRIAL_BALANCE">تراز آزمایشی</option><option value="FINANCIAL_STATEMENT">صورت‌های مالی</option><option value="CASH_FLOW">جریان وجوه نقد</option><option value="LEGAL_BOOK">دفاتر قانونی</option></ErpSelect></label>
          <label><span className="mb-2 block text-sm">سال مالی</span><ErpSelect value={report.fiscalYearId} onChange={(event) => setReport({ ...report, fiscalYearId: event.target.value })}>{years.map((year: any) => <option key={year.id} value={year.id}>{year.titlePersian}</option>)}</ErpSelect></label>
          <label><span className="mb-2 block text-sm">نسخه نگاشت</span><ErpSelect value={report.mappingVersionId} onChange={(event) => setReport({ ...report, mappingVersionId: event.target.value })}><option value="">انتخاب نسخه</option>{overview?.mappings?.map((mapping: any) => <option key={mapping.id} value={mapping.id}>{mapping.titlePersian} · نسخه {Number(mapping.version).toLocaleString('fa-IR')}</option>)}</ErpSelect></label>
          {report.reportKind === 'LEGAL_BOOK' && <label><span className="mb-2 block text-sm">نسخه قالب قانونی</span><ErpSelect value={report.statutoryFormatId} onChange={(event) => setReport({ ...report, statutoryFormatId: event.target.value })}><option value="">انتخاب قالب رسمی</option>{overview?.statutoryFormats?.map((format: any) => <option key={format.id} value={format.id}>{format.titlePersian} · نسخه {Number(format.version).toLocaleString('fa-IR')}</option>)}</ErpSelect></label>}
          <label><span className="mb-2 block text-sm">از تاریخ</span><ErpInput type="date" value={report.from} onChange={(event) => setReport({ ...report, from: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">تا تاریخ</span><ErpInput type="date" value={report.to} onChange={(event) => setReport({ ...report, to: event.target.value })} /></label>
          <label><span className="mb-2 block text-sm">زمان برش</span><ErpInput type="datetime-local" value={report.cutoffAt} onChange={(event) => setReport({ ...report, cutoffAt: event.target.value })} /></label>
        </div><div className="mt-4 flex justify-end"><ErpButton label={saving ? 'در حال ساخت…' : 'ساخت نسخه رسمی منجمد'} disabled={saving || !report.fiscalYearId || !report.mappingVersionId || !report.from || !report.to || !report.cutoffAt || (report.reportKind === 'LEGAL_BOOK' && !report.statutoryFormatId)} onClick={() => act(() => accountingAPI.createOfficialReportSnapshot({ request: { ...report, statutoryFormatId: report.statutoryFormatId || undefined, bookId: book.id, columns: 8, level: 'SUBSIDIARY' } }), 'نسخه رسمی با مجموعه‌داده و اثر انگشت واحد ساخته شد.')} /></div>
      </ErpSection><ErpSection title="نسخه‌های رسمی منجمد">{!overview?.snapshots?.length ? <ErpEmptyState title="هنوز نسخه رسمی منجمد ساخته نشده است." /> : <div className="space-y-2">{overview.snapshots.map((snapshot: any) => <ErpCard key={snapshot.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><strong>{snapshot.snapshotIdentity}</strong><ErpBadge tone="success">رسمی و منجمد</ErpBadge></div><div className="mt-2 grid gap-1 text-sm"><span>نوع: {reportTypeFa[snapshot.reportType] || 'گزارش رسمی'}</span><span>برش: {dateFa(snapshot.cutoffAt)}</span><span className="break-all">اثر انگشت مجموعه‌داده: {snapshot.datasetHash}</span></div><div className="mt-3 flex flex-wrap justify-end gap-2"><ErpButton label="دریافت PDF فارسی" variant="outline" onClick={() => window.open(`/api/accounting/period-end/report-snapshots/${snapshot.id}/export.pdf`, '_blank', 'noopener,noreferrer')} /><ErpButton label="دریافت Excel فارسی" variant="outline" onClick={() => window.open(`/api/accounting/period-end/report-snapshots/${snapshot.id}/export.xlsx`, '_blank', 'noopener,noreferrer')} /></div></ErpCard>)}</div>}</ErpSection></div>}

      {tab === 'tax' && <ErpSection title="تقویم تکالیف مالیاتی" description="مالیات ارزش افزوده، حقوق، تکلیفی و عملکرد با تلاش‌ها و رسیدهای مستقل پیگیری می‌شوند.">{!overview?.taxes?.length ? <ErpEmptyState title="تکلیف مالیاتی بازی وجود ندارد." /> : <div className="grid gap-3 md:grid-cols-2">{overview.taxes.map((item: any) => <ErpCard key={item.id} className="p-4"><div className="flex items-center justify-between gap-3"><strong>{item.obligationIdentity}</strong><ErpBadge tone={toneOf(item.status) as any}>{statusFa[item.status] || item.status}</ErpBadge></div><div className="mt-3 grid gap-1 text-sm"><span>مهلت: {dateFa(item.dueAt)}</span><span>پرداختنی: {digits(item.payableRials)} ریال</span><span>پرداخت‌شده: {digits(item.paidRials)} ریال</span><span>آخرین تلاش: {dateFa(item.attempts?.[0]?.attemptedAt)}</span></div></ErpCard>)}</div>}</ErpSection>}

      {tab === 'close' && <ErpSection title="اجرای بستن دوره و سال" description="تغییر هر شاهد upstream کنترل‌های پایین‌دست را باطل می‌کند؛ بستن قطعی فقط پس از پذیرش همه مراحل ممکن است.">
        <label className="mb-4 block"><span className="mb-2 block text-sm">دلیل بستن قطعی</span><ErpInput value={closeReason} onChange={(event) => setCloseReason(event.target.value)} /></label>
        {!overview?.closeRuns?.length ? <ErpEmptyState title="اجرای بستن دوره‌ای آغاز نشده است." /> : <div className="space-y-3">{overview.closeRuns.map((run: any) => <ErpCard key={run.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><strong>{run.runIdentity}</strong><span className="mt-1 block text-sm text-[var(--sds-text-secondary)]">{run.closeType === 'YEAR' ? 'بستن سال' : run.closeType === 'REOPEN' ? 'بازگشایی کنترل‌شده' : 'بستن دوره'}</span></div><ErpBadge tone={toneOf(run.status) as any}>{statusFa[run.status] || 'نیازمند بررسی'}</ErpBadge></div><div className="mt-3 flex flex-wrap gap-2">{run.steps?.map((step: any) => <ErpBadge key={step.id} tone={toneOf(step.status) as any}>{closeStepFa[step.stepCode] || 'کنترل دوره'}: {statusFa[step.status] || 'نیازمند بررسی'}</ErpBadge>)}</div>{run.status === 'READY' && <div className="mt-4 flex justify-end"><ErpButton label="بستن قطعی" tone="danger" disabled={saving || closeReason.trim().length < 8} onClick={() => act(() => accountingAPI.finalizeCloseRun(run.id, { confirmed: true, reason: closeReason.trim() }), 'دوره با شواهد کامل به‌صورت قطعی بسته شد.')} /></div>}{run.status === 'HARD_CLOSED' && <div className="mt-4 flex justify-end"><ErpButton label="بازگشایی کنترل‌شده" tone="warning" variant="outline" disabled={saving || closeReason.trim().length < 8} onClick={() => act(() => accountingAPI.reopenCloseRun(run.id, { confirmed: true, reason: closeReason.trim() }), 'دوره با حفظ کامل شواهد بستن قبلی بازگشایی شد.')} /></div>}</ErpCard>)}</div>}
      </ErpSection>}

      {tab === 'archive' && <ErpSection title="بایگانی قانونی و نگهداری" description="مدرک منجمد، اثر انگشت، نتیجه بررسی بدافزار، سیاست نگهداری و توقف قانونی حذف بدون حذف خودکار حفظ می‌شود.">{!overview?.archiveEvidence?.length ? <ErpEmptyState title="مدرک بایگانی‌شده‌ای وجود ندارد." /> : <div className="grid gap-3 md:grid-cols-2">{overview.archiveEvidence.map((item: any) => <ErpCard key={item.id} className="p-4"><div className="flex items-center justify-between gap-3"><strong>{item.evidenceIdentity}</strong><ErpBadge tone={item.legalHold ? 'danger' : 'info'}>{item.legalHold ? 'توقف قانونی حذف' : 'تحت سیاست نگهداری'}</ErpBadge></div><div className="mt-3 grid gap-1 text-sm"><span>نوع: {evidenceTypeFa[item.evidenceType] || 'مدرک قانونی'}</span><span>بررسی بدافزار: {malwareStatusFa[item.malwareScanStatus] || 'نیازمند بررسی'}</span><span>نگهداری تا: {dateFa(item.retainUntil)}</span><span className="break-all">اثر انگشت: {item.contentHash}</span></div></ErpCard>)}</div>}</ErpSection>}
    </ErpPage>
  );
}
