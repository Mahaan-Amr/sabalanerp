'use client';
import { ErpInput, ErpPressable, ErpSelect, ErpTextarea } from '@/components/erp';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import moment from 'moment-jalaali';
import {
  FaBoxes, FaChartLine, FaDownload, FaFileContract, FaFilePdf, FaFilter,
  FaMoneyBillWave, FaPrint, FaSave, FaSync, FaTruck, FaUsers
} from 'react-icons/fa';
import PersianCalendarPicker from '@/components/PersianCalendar';
import { PersianCalendar } from '@/lib/persian-calendar';
import { biAPI, departmentsAPI, salesReportsAPI } from '@/lib/api';
import { resolveChartLabel, RtlHorizontalBarChart, RtlTrendChart } from './RtlCharts';

type Mode = 'sales' | 'bi';
type Report = any;
type ExportConfig = {
  title: string; subtitle: string; note: string; orientation: 'portrait' | 'landscape'; pageSize: 'A4' | 'A3'; sections: string[];
  includeCharts: boolean; includeTables: boolean; contractColumns: string[];
};

const rangeOptions = [
  ['today', 'امروز'], ['yesterday', 'دیروز'], ['week', '۷ روز اخیر'], ['month', 'ماه جاری'],
  ['quarter', 'فصل جاری'], ['year', 'سال جاری'], ['last12', '۱۲ ماه اخیر'], ['custom', 'بازه سفارشی']
] as const;

const sectionOptions = [
  ['overview', 'نمای کلی'], ['contracts', 'قراردادها'], ['customers', 'مشتریان و پروژه‌ها'],
  ['products', 'محصولات و خدمات'], ['finance', 'پرداخت و وصول'], ['delivery', 'تحویل و بارگیری'], ['sellers', 'عملکرد فروشندگان']
] as const;

const contractColumnOptions = [
  ['contractNumber', 'شماره قرارداد'], ['customer', 'مشتری'], ['project', 'پروژه'], ['status', 'وضعیت'],
  ['statusDescription', 'معنی وضعیت'], ['amount', 'مبلغ'], ['responsibleSeller', 'مسئول فروش'], ['realizedSeller', 'اعتبار فروش قطعی']
] as const;

const tabs = [
  ['overview', 'نمای کلی', FaChartLine], ['contracts', 'قراردادها', FaFileContract], ['customers', 'مشتریان و پروژه‌ها', FaUsers],
  ['products', 'محصولات و خدمات', FaBoxes], ['finance', 'پرداخت و وصول', FaMoneyBillWave], ['delivery', 'تحویل و بارگیری', FaTruck],
  ['sellers', 'عملکرد فروشندگان', FaUsers], ['export', 'خروجی گزارش', FaFilePdf]
] as const;

const money = (value: unknown) => `${Number(value || 0).toLocaleString('fa-IR')} تومان`;
const count = (value: unknown) => Number(value || 0).toLocaleString('fa-IR');
const dateFa = (value?: string | null) => value ? PersianCalendar.formatForDisplay(value) : 'ثبت نشده';
const trendKeyForDate = (value: string, monthly: boolean) => {
  const date = new Date(value);
  return monthly
    ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
    : date.toISOString().slice(0, 10);
};

const contractsForTrendPoint = (contracts: any[], row: any) => {
  const monthly = /^\d{4}-\d{2}$/.test(row.key);
  return contracts.filter((contract) => [contract.createdAt, ...(contract.reportingEventDates || [])]
    .filter(Boolean)
    .some((value) => trendKeyForDate(value, monthly) === row.key));
};

const resolveRange = (range: string, customFrom: string, customTo: string) => {
  const now = moment();
  let from = moment().startOf('jMonth');
  let to = moment().endOf('day');
  if (range === 'today') from = moment().startOf('day');
  if (range === 'yesterday') { from = moment().subtract(1, 'day').startOf('day'); to = moment().subtract(1, 'day').endOf('day'); }
  if (range === 'week') from = moment().subtract(6, 'day').startOf('day');
  if (range === 'quarter') from = moment().jMonth(Math.floor(now.jMonth() / 3) * 3).startOf('jMonth');
  if (range === 'year') from = moment().startOf('jYear');
  if (range === 'last12') from = moment().subtract(11, 'jMonth').startOf('jMonth');
  if (range === 'custom' && customFrom && customTo) { from = moment(customFrom, 'jYYYY/jMM/jDD').startOf('day'); to = moment(customTo, 'jYYYY/jMM/jDD').endOf('day'); }
  return { from: from.toDate().toISOString(), to: to.toDate().toISOString(), period: range };
};

const downloadBlob = (blob: Blob, filename: string, open = false) => {
  const url = URL.createObjectURL(blob);
  if (open) window.open(url, '_blank', 'noopener,noreferrer');
  else {
    const link = document.createElement('a'); link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
  }
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

function Panel({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 shadow-sm dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
    <div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{description}</p>}</div>{action}</div>{children}
  </section>;
}

function Metric({ label, value, hint, tone = 'teal' }: { label: string; value: React.ReactNode; hint?: string; tone?: string }) {
  const tones: Record<string, string> = { teal: 'border-t-teal-500', amber: 'border-t-amber-400', red: 'border-t-rose-500', blue: 'border-t-sky-500', purple: 'border-t-violet-500' };
  return <div className={`rounded-xl border border-t-4 border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-4 shadow-sm dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] ${tones[tone] || tones.teal}`}>
    <p className="text-xs font-semibold text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{label}</p><p className="mt-3 text-xl font-black text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{value}</p>{hint && <p className="mt-2 text-xs leading-5 text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{hint}</p>}
  </div>;
}

function Table({ columns, rows, onRow }: { columns: Array<{ key: string; label: string; render?: (row: any) => React.ReactNode }>; rows: any[]; onRow?: (row: any) => void }) {
  return <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-right text-sm"><thead><tr className="border-b border-[var(--sds-border-default)] text-xs text-[var(--sds-text-secondary)] dark:border-[var(--sds-border-strong)] dark:text-[var(--sds-text-muted)]">{columns.map((column) => <th key={column.key} className="px-3 py-3 font-bold">{column.label}</th>)}</tr></thead><tbody>
    {rows.length ? rows.map((row, index) => <tr key={row.id || index} onClick={() => onRow?.(row)} className={`border-b border-[var(--sds-border-default)] dark:border-[var(--sds-border-strong)] ${onRow ? 'cursor-pointer hover:bg-[var(--sds-accent-surface)] dark:hover:bg-[var(--sds-accent-surface)]' : ''}`}>{columns.map((column) => <td key={column.key} className="px-3 py-3 align-top text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{column.render ? column.render(row) : row[column.key]}</td>)}</tr>) : <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-[var(--sds-text-secondary)]">داده‌ای در این دامنه وجود ندارد؛ مقدار صفر اختراع نشده است.</td></tr>}
  </tbody></table></div>;
}

function Drilldown({ title, description, rows, onClose }: { title: string; description: string; rows: any[]; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-stretch justify-end" role="dialog" aria-modal="true" aria-label={title}>
    <ErpPressable type="button" aria-label="بستن جزئیات" className="absolute inset-0 bg-[var(--sds-surface-overlay)]" onClick={onClose} />
    <aside dir="rtl" className="relative h-full w-full max-w-3xl overflow-y-auto bg-[var(--sds-surface-raised)] p-5 shadow-2xl">
    <div className="mb-5 flex items-start justify-between gap-3"><div><h2 className="text-xl font-black text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{title}</h2><p className="mt-2 text-sm leading-6 text-[var(--sds-text-secondary)]">{description}</p></div><ErpPressable type="submit" onClick={onClose} className="rounded-lg border px-3 py-2 text-sm">بستن</ErpPressable></div>
    <Table rows={rows} columns={[
      { key: 'contractNumber', label: 'قرارداد', render: (row) => row.canOpenSource ? <Link className="font-bold text-[var(--sds-accent)] underline" href={`/dashboard/sales/contracts/${row.id}`}>{row.contractNumber}</Link> : row.contractNumber },
      { key: 'customer', label: 'مشتری' }, { key: 'statusLabel', label: 'وضعیت' }, { key: 'amount', label: 'مبلغ', render: (row) => money(row.amount) },
      { key: 'responsibleSeller', label: 'مسئول فروش' }, { key: 'realizedAt', label: 'تاریخ تحقق', render: (row) => dateFa(row.realizedAt) }
    ]} />
  </aside></div>;
}

export default function SalesReportingDashboard({ mode = 'sales' }: { mode?: Mode }) {
  const storageKey = `sabalan-report-filters-${mode}`;
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [range, setRange] = useState('month');
  const [customFrom, setCustomFrom] = useState(PersianCalendar.now('jYYYY/jMM/jDD'));
  const [customTo, setCustomTo] = useState(PersianCalendar.now('jYYYY/jMM/jDD'));
  const [departmentId, setDepartmentId] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [departments, setDepartments] = useState<any[]>([]);
  const [drilldown, setDrilldown] = useState<{ title: string; description: string; rows: any[] } | null>(null);
  const [presets, setPresets] = useState<any[]>([]);
  const [presetName, setPresetName] = useState('');
  const [presetVisibility, setPresetVisibility] = useState('PERSONAL');
  const [exporting, setExporting] = useState(false);
  const [config, setConfig] = useState<ExportConfig>({
    title: 'گزارش جامع فروش', subtitle: '', note: '', orientation: 'landscape', pageSize: 'A4',
    sections: sectionOptions.map(([id]) => id), includeCharts: true, includeTables: true,
    contractColumns: contractColumnOptions.map(([id]) => id)
  });

  useEffect(() => {
    try { const saved = JSON.parse(localStorage.getItem(storageKey) || '{}'); if (saved.range) setRange(saved.range); if (saved.customFrom) setCustomFrom(saved.customFrom); if (saved.customTo) setCustomTo(saved.customTo); if (saved.departmentId) setDepartmentId(saved.departmentId); if (saved.sellerId) setSellerId(saved.sellerId); } catch {}
  }, [storageKey]);

  const filters = useMemo(() => ({ ...resolveRange(range, customFrom, customTo), ...(departmentId ? { departmentId } : {}), ...(sellerId ? { sellerId } : {}) }), [range, customFrom, customTo, departmentId, sellerId]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const response = mode === 'bi' ? await biAPI.getSalesOverview(filters) : await salesReportsAPI.getOverview(filters);
      setReport(response.data.data);
      localStorage.setItem(storageKey, JSON.stringify({ range, customFrom, customTo, departmentId, sellerId }));
    } catch (reason: any) { setError(reason?.response?.data?.error || 'خطا در دریافت گزارش'); }
    finally { setLoading(false); }
  }, [mode, filters, storageKey, range, customFrom, customTo, departmentId, sellerId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (report?.permissions?.canCompany && !departments.length) departmentsAPI.getDepartments().then((response) => setDepartments(response.data.data || response.data || [])).catch(() => undefined); }, [report?.permissions?.canCompany, departments.length]);
  useEffect(() => { if (mode === 'sales') salesReportsAPI.getPresets().then((response) => setPresets(response.data.data || [])).catch(() => undefined); }, [mode]);

  const visibleTabs = tabs.filter(([id]) => id !== 'sellers' || report?.permissions?.canViewSellerComparisons).filter(([id]) => mode === 'sales' || id !== 'export');
  const sellerOptions = report?.sellers || [];
  const openRows = (title: string, description: string, rows: any[]) => setDrilldown({ title, description, rows });
  const runExport = async (kind: 'pdf' | 'xlsx' | 'print') => {
    setExporting(true);
    try {
      if (mode === 'bi') return;
      const response = kind === 'xlsx' ? await salesReportsAPI.downloadExcel(filters, config) : await salesReportsAPI.downloadPdf(filters, config);
      downloadBlob(response.data, kind === 'xlsx' ? 'sales-report.xlsx' : 'sales-report.pdf', kind === 'print');
    } finally { setExporting(false); }
  };
  const savePreset = async () => {
    if (!presetName.trim()) return;
    const response = await salesReportsAPI.createPreset({ name: presetName.trim(), visibility: presetVisibility, configuration: config });
    setPresets((rows) => [...rows, response.data.data]); setPresetName('');
  };
  const moveSection = (id: string, delta: number) => setConfig((current) => {
    const sections = [...current.sections]; const index = sections.indexOf(id); const next = index + delta;
    if (index < 0 || next < 0 || next >= sections.length) return current;
    [sections[index], sections[next]] = [sections[next], sections[index]]; return { ...current, sections };
  });

  const applyPreset = (configuration: Partial<ExportConfig>) => setConfig((current) => ({
    ...current,
    ...configuration,
    includeCharts: configuration.includeCharts ?? true,
    includeTables: configuration.includeTables ?? true,
    contractColumns: configuration.contractColumns?.length ? configuration.contractColumns : current.contractColumns
  }));

  return <main dir="rtl" className="sds-workspace min-h-screen text-right">
    <div className="mx-auto max-w-[1600px] space-y-5">
      <header className="rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 shadow-sm dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-wider text-[var(--sds-accent)]">{mode === 'bi' ? 'BI' : 'فروش'}</p><h1 className="mt-1 text-2xl font-black text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{mode === 'bi' ? 'هوش تجاری فروش' : 'گزارش جامع فروش'}</h1><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{report?.scope?.label || 'در حال تعیین دامنه مجاز'} · آخرین به‌روزرسانی: {report?.generatedAtLabel || '—'}</p></div><ErpPressable type="submit" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-lg bg-[var(--sds-accent)] px-4 py-2 text-sm font-bold text-[var(--sds-text-inverse)] disabled:opacity-50"><FaSync className={loading ? 'animate-spin' : ''} />به‌روزرسانی</ErpPressable></div></header>

      <Panel title="فیلتر مشترک گزارش" description="این فیلترها روی همه بخش‌ها، جزئیات و خروجی‌ها اعمال می‌شوند."><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <label className="text-xs font-bold text-[var(--sds-text-secondary)]">بازه<ErpSelect value={range} onChange={(event) => setRange(event.target.value)} className="mt-1 w-full rounded-lg border bg-[var(--sds-surface-raised)] p-2.5 dark:bg-[var(--sds-surface-raised)]">{rangeOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</ErpSelect></label>
        {range === 'custom' && <><label className="text-xs font-bold text-[var(--sds-text-secondary)]">از<PersianCalendarPicker value={customFrom} onChange={setCustomFrom} /></label><label className="text-xs font-bold text-[var(--sds-text-secondary)]">تا<PersianCalendarPicker value={customTo} onChange={setCustomTo} /></label></>}
        {report?.permissions?.canCompany && <label className="text-xs font-bold text-[var(--sds-text-secondary)]">دپارتمان<ErpSelect value={departmentId} onChange={(event) => { setDepartmentId(event.target.value); setSellerId(''); }} className="mt-1 w-full rounded-lg border bg-[var(--sds-surface-raised)] p-2.5 dark:bg-[var(--sds-surface-raised)]"><option value="">کل شرکت</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.namePersian || department.name}</option>)}</ErpSelect></label>}
        {report?.permissions?.canSelectSeller && <label className="text-xs font-bold text-[var(--sds-text-secondary)]">فروشنده<ErpSelect value={sellerId} onChange={(event) => setSellerId(event.target.value)} className="mt-1 w-full rounded-lg border bg-[var(--sds-surface-raised)] p-2.5 dark:bg-[var(--sds-surface-raised)]"><option value="">همه فروشندگان مجاز</option>{sellerOptions.filter((seller: any) => seller.id !== 'legacy-unassigned').map((seller: any) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</ErpSelect></label>}
      </div></Panel>

      <nav className="flex gap-2 overflow-x-auto rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-2 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]" aria-label="بخش‌های گزارش">{visibleTabs.map(([id, label, Icon]) => <ErpPressable type="submit" key={id} onClick={() => setActiveTab(id)} className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold ${activeTab === id ? 'bg-[var(--sds-accent)] text-[var(--sds-text-inverse)]' : 'text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] dark:text-[var(--sds-text-muted)] dark:hover:bg-[var(--sds-surface-raised)]'}`}><Icon />{label}</ErpPressable>)}</nav>

      {error && <div className="rounded-xl border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] p-4 text-sm font-bold text-[var(--sds-danger)]">{error}</div>}
      {loading && !report ? <div className="rounded-xl border bg-[var(--sds-surface-raised)] p-12 text-center text-[var(--sds-text-secondary)]">در حال محاسبه گزارش از منابع معتبر...</div> : report && <>
        {activeTab === 'overview' && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <Metric label="فروش قطعی ناخالص" value={money(report.cards.grossRealized)} hint="رویدادهای تحقق‌یافته در بازه" />
          <Metric label="تعدیلات فروش قطعی" value={money(report.cards.adjustments)} hint="اصلاح یا لغو مؤثر در همین بازه" tone="purple" />
          <Metric label="فروش قطعی خالص" value={money(report.cards.netRealized)} hint={`مقایسه با ${report.period.previousLabel}`} tone="blue" />
          <Metric label="پایپ‌لاین" value={money(report.cards.pipelineValue)} hint={`${count(report.cards.pipelineCount)} قرارداد باز`} tone="amber" />
          <Metric label="از دست رفته" value={money(report.cards.lostValue)} hint={`${count(report.cards.lostCount)} قرارداد لغو یا منقضی`} tone="red" />
          <Metric label="قرارداد قطعی" value={count(report.cards.realizedCount)} hint="امضا یا چاپ تجاری" />
          <Metric label="مشتری قطعی" value={count(report.cards.customerCount)} hint="مشتریان یکتا در فروش قطعی" tone="blue" />
          <Metric label="نرخ موفقیت قراردادهای تعیین‌تکلیف‌شده" value={report.cards.successRate == null ? 'نامشخص' : `${count(report.cards.successRate)}٪`} hint="پیش‌نویس و پایپ‌لاین باز حذف شده‌اند" tone="amber" />
        </div><Panel title="روند فروش" description="قدیمی‌ترین تاریخ در سمت راست و جدیدترین تاریخ در سمت چپ قرار دارد. برای مشاهده شواهد روی نمودار کلیک کنید."><RtlTrendChart data={report.trend} onSelect={(row) => openRows(`جزئیات ${row.label}`, `فیلتر نمودار: ${row.label} در دامنه ${report.scope.label}`, contractsForTrendPoint(report.contracts, row))} /></Panel>
        <Panel title="وضعیت واقعی قراردادها" description="هر وضعیت همراه با معنای عملیاتی خودش نمایش داده می‌شود."><RtlHorizontalBarChart data={report.statusDistribution.map((row: any) => ({ ...row, label: `${resolveChartLabel(row)} · ${count(row.count)}` }))} onSelect={(row) => openRows(resolveChartLabel(row), row.description, report.contracts.filter((contract: any) => contract.status === row.status))} /></Panel></div>}

        {activeTab === 'contracts' && <Panel title="قراردادها" description="برای بازکردن جزئیات و منبع روی یک ردیف کلیک کنید."><Table rows={report.contracts} onRow={(row) => openRows(`قرارداد ${row.contractNumber}`, row.statusDescription, [row])} columns={[
          { key: 'contractNumber', label: 'شماره قرارداد' }, { key: 'customer', label: 'مشتری' }, { key: 'project', label: 'پروژه' },
          { key: 'statusLabel', label: 'وضعیت', render: (row) => <div><strong>{row.statusLabel}</strong><p className="mt-1 max-w-xs text-xs leading-5 text-[var(--sds-text-secondary)]">{row.statusDescription}</p></div> },
          { key: 'amount', label: 'مبلغ', render: (row) => money(row.amount) }, { key: 'responsibleSeller', label: 'مسئول فروش' }, { key: 'realizedSeller', label: 'اعتبار فروش قطعی' }
        ]} /></Panel>}

        {activeTab === 'customers' && <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><Panel title="مشتریان بر اساس فروش قطعی"><RtlHorizontalBarChart data={report.customers.slice(0, 15).map((row: any) => ({ ...row, label: row.name }))} onSelect={(row) => openRows(`مشتری: ${row.name}`, `قراردادهای مجاز مرتبط با مشتری ${row.name}`, report.contracts.filter((contract: any) => contract.customerId === row.id))} /></Panel><Panel title="جزئیات مشتریان"><Table rows={report.customers} onRow={(row) => openRows(`مشتری: ${row.name}`, 'جزئیات قراردادهای مجاز این مشتری', report.contracts.filter((contract: any) => contract.customerId === row.id))} columns={[{ key: 'name', label: 'مشتری' }, { key: 'value', label: 'فروش قطعی', render: (row) => money(row.value) }, { key: 'contracts', label: 'قرارداد', render: (row) => count(row.contracts) }]} /></Panel></div>}

        {activeTab === 'products' && <div className="grid gap-5 xl:grid-cols-[.9fr_1.1fr]"><Panel title="محصولات و خدمات برتر"><RtlHorizontalBarChart data={report.products.slice(0, 15).map((row: any) => ({ ...row, label: row.name }))} onSelect={(row) => openRows(`محصول: ${row.name}`, 'قراردادهای مجاز دارای این محصول', report.contracts.filter((contract: any) => contract.productIds?.includes(row.id)))} /></Panel><Panel title="ترکیب محصول"><Table rows={report.products} onRow={(row) => openRows(`محصول: ${row.name}`, 'قراردادهای مجاز دارای این محصول', report.contracts.filter((contract: any) => contract.productIds?.includes(row.id)))} columns={[{ key: 'name', label: 'محصول' }, { key: 'code', label: 'کد' }, { key: 'value', label: 'ارزش', render: (row) => money(row.value) }, { key: 'quantity', label: 'مقدار', render: (row) => count(row.quantity) }, { key: 'contracts', label: 'قرارداد', render: (row) => count(row.contracts) }]} /></Panel></div>}

        {activeTab === 'finance' && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="برنامه پرداخت" value={money(report.finance.plannedPaymentAmount)} hint="منبع: فروش؛ به معنی دریافت واقعی نیست" tone="amber" /><Metric label="دریافت واقعی" value={money(report.finance.receivedAmount)} hint="منبع: حسابداری" /><Metric label="مانده دریافتنی" value={money(report.finance.receivableAmount)} hint="منبع: حسابداری" tone="red" /></div><Panel title="کامل‌بودن داده حسابداری" description="داده ناقص به‌عنوان صفر نمایش داده نمی‌شود."><p className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-4 text-sm text-[var(--sds-warning)]">{count(report.finance.coverage.coveredContracts)} قرارداد از {count(report.finance.coverage.totalContracts)} قرارداد دارای اطلاعات حسابداری هستند.</p></Panel></div>}

        {activeTab === 'delivery' && <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><Metric label="تحویل وعده‌داده‌شده" value={count(report.delivery.promisedDeliveries)} hint="منبع: فروش" tone="amber" /><Metric label="بارگیری نهایی" value={count(report.delivery.finalizedLoadings)} hint="منبع: لجستیک" /><Metric label="خروج ثبت‌شده" value={count(report.delivery.exitedLoadings)} hint="منبع: گارد" tone="blue" /></div><Panel title="کامل‌بودن داده تحویل"><p className="rounded-lg border border-[var(--sds-info-border)] bg-[var(--sds-info-surface)] p-4 text-sm text-[var(--sds-info)]">{count(report.delivery.coverage.coveredContracts)} قرارداد از {count(report.delivery.coverage.totalContracts)} قرارداد دارای رکورد بارگیری هستند.</p></Panel></div>}

        {activeTab === 'sellers' && report.permissions.canViewSellerComparisons && <div className="space-y-5">{report.legacyUnassigned.count > 0 && <div className="rounded-xl border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-4 text-sm text-[var(--sds-warning)]"><strong>فروش قطعی تخصیص‌نیافته قدیمی:</strong> {count(report.legacyUnassigned.count)} قرارداد به ارزش {money(report.legacyUnassigned.value)}. این مقدار در کل فروش هست اما در رتبه فروشنده وارد نشده است.</div>}<Panel title="مقایسه فروشندگان" description="رتبه‌بندی فقط در دامنه مدیریتی مجاز نمایش داده می‌شود."><RtlHorizontalBarChart data={report.sellers.map((row: any) => ({ ...row, label: row.name, value: row.netRealized }))} onSelect={(row) => openRows(`فروشنده: ${row.name}`, 'قراردادهای مجاز مرتبط با این فروشنده', report.contracts.filter((contract: any) => contract.responsibleSellerId === row.id || contract.realizedSellerId === row.id))} /></Panel><Panel title="شاخص‌های شفاف فروشنده"><Table rows={report.sellers} onRow={(row) => openRows(`فروشنده: ${row.name}`, 'جزئیات عملکرد قابل مشاهده', report.contracts.filter((contract: any) => contract.responsibleSellerId === row.id || contract.realizedSellerId === row.id))} columns={[{ key: 'name', label: 'فروشنده' }, { key: 'createdCount', label: 'قرارداد ایجادشده', render: (row) => count(row.createdCount) }, { key: 'pipelineValue', label: 'پایپ‌لاین', render: (row) => money(row.pipelineValue) }, { key: 'realizedValue', label: 'فروش قطعی', render: (row) => money(row.realizedValue) }, { key: 'adjustments', label: 'تعدیل', render: (row) => money(row.adjustments) }, { key: 'netRealized', label: 'خالص', render: (row) => money(row.netRealized) }, { key: 'lostCount', label: 'از دست رفته', render: (row) => count(row.lostCount) }]} /></Panel></div>}

        {activeTab === 'export' && mode === 'sales' && <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]"><Panel title="سازنده خروجی" description="تنها نحوه نمایش را تغییر می‌دهد؛ ارقام و دسترسی‌ها قابل ویرایش نیستند."><div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-bold">عنوان<ErpInput value={config.title} onChange={(event) => setConfig({ ...config, title: event.target.value })} className="mt-1 w-full rounded-lg border p-2.5" /></label><label className="text-sm font-bold">زیرعنوان<ErpInput value={config.subtitle} onChange={(event) => setConfig({ ...config, subtitle: event.target.value })} className="mt-1 w-full rounded-lg border p-2.5" /></label><label className="text-sm font-bold">جهت<ErpSelect value={config.orientation} onChange={(event) => setConfig({ ...config, orientation: event.target.value as any })} className="mt-1 w-full rounded-lg border p-2.5"><option value="landscape">افقی</option><option value="portrait">عمودی</option></ErpSelect></label><label className="text-sm font-bold">اندازه<ErpSelect value={config.pageSize} onChange={(event) => setConfig({ ...config, pageSize: event.target.value as any })} className="mt-1 w-full rounded-lg border p-2.5"><option>A4</option><option>A3</option></ErpSelect></label><label className="sm:col-span-2 text-sm font-bold">یادداشت اختیاری<ErpTextarea value={config.note} onChange={(event) => setConfig({ ...config, note: event.target.value })} className="mt-1 min-h-24 w-full rounded-lg border p-2.5" /></label></div><div className="mt-5 grid gap-2 sm:grid-cols-2"><label className="flex items-center gap-2 rounded-lg border p-3 text-sm font-bold"><ErpInput type="checkbox" checked={config.includeCharts} onChange={(event) => setConfig({ ...config, includeCharts: event.target.checked })} />نمودارها</label><label className="flex items-center gap-2 rounded-lg border p-3 text-sm font-bold"><ErpInput type="checkbox" checked={config.includeTables} onChange={(event) => setConfig({ ...config, includeTables: event.target.checked })} />جدول‌ها</label></div><h3 className="mt-5 font-bold">ستون‌های جدول قراردادها</h3><div className="mt-2 grid gap-2 sm:grid-cols-2">{contractColumnOptions.map(([id, label]) => <label key={id} className="flex items-center gap-2 rounded-lg border p-2 text-sm"><ErpInput type="checkbox" checked={config.contractColumns.includes(id)} onChange={() => setConfig((current) => ({ ...current, contractColumns: current.contractColumns.includes(id) ? current.contractColumns.filter((column) => column !== id) : [...current.contractColumns, id] }))} />{label}</label>)}</div><h3 className="mt-5 font-bold">بخش‌ها و ترتیب</h3><div className="mt-2 space-y-2">{sectionOptions.filter(([id]) => id !== 'sellers' || report.permissions.canViewSellerComparisons).map(([id, label]) => { const selected = config.sections.includes(id); return <div key={id} className="flex items-center gap-2 rounded-lg border p-2"><ErpInput type="checkbox" checked={selected} onChange={() => setConfig((current) => ({ ...current, sections: selected ? current.sections.filter((section) => section !== id) : [...current.sections, id] }))} /><span className="flex-1 text-sm font-bold">{label}</span>{selected && <><ErpPressable type="submit" onClick={() => moveSection(id, -1)} className="rounded border px-2">↑</ErpPressable><ErpPressable type="submit" onClick={() => moveSection(id, 1)} className="rounded border px-2">↓</ErpPressable></>}</div>; })}</div><div className="mt-5 flex flex-wrap gap-2"><ErpPressable type="submit" disabled={exporting} onClick={() => runExport('pdf')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--sds-danger)] px-4 py-2 font-bold text-[var(--sds-text-inverse)]"><FaFilePdf />PDF</ErpPressable><ErpPressable type="submit" disabled={exporting} onClick={() => runExport('xlsx')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--sds-success)] px-4 py-2 font-bold text-[var(--sds-text-inverse)]"><FaDownload />Excel</ErpPressable><ErpPressable type="submit" disabled={exporting} onClick={() => runExport('print')} className="inline-flex items-center gap-2 rounded-lg bg-[var(--sds-surface-raised)] px-4 py-2 font-bold text-[var(--sds-text-primary)]"><FaPrint />چاپ</ErpPressable></div></Panel><Panel title="پیش‌تنظیم‌ها" description="هنگام استفاده، دسترسی فعلی دوباره اعمال می‌شود."><ErpSelect onChange={(event) => { const preset = presets.find((row) => row.id === event.target.value); if (preset?.configuration) applyPreset(preset.configuration); }} className="w-full rounded-lg border p-2.5"><option value="">انتخاب پیش‌تنظیم</option>{presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name} · {preset.visibility === 'PERSONAL' ? 'شخصی' : preset.visibility === 'DEPARTMENT' ? 'دپارتمان' : 'شرکت'}</option>)}</ErpSelect><div className="mt-4 space-y-3"><ErpInput value={presetName} onChange={(event) => setPresetName(event.target.value)} placeholder="نام پیش‌تنظیم" className="w-full rounded-lg border p-2.5" /><ErpSelect value={presetVisibility} onChange={(event) => setPresetVisibility(event.target.value)} className="w-full rounded-lg border p-2.5"><option value="PERSONAL">شخصی</option>{report.permissions.canManage && <option value="DEPARTMENT">دپارتمان</option>}{report.permissions.canCompany && <option value="COMPANY">کل شرکت</option>}</ErpSelect><ErpPressable type="submit" onClick={savePreset} className="inline-flex items-center gap-2 rounded-lg bg-[var(--sds-accent)] px-4 py-2 font-bold text-[var(--sds-text-inverse)]"><FaSave />ذخیره پیش‌تنظیم</ErpPressable></div></Panel></div>}
      </>}
    </div>{drilldown && <Drilldown {...drilldown} onClose={() => setDrilldown(null)} />}
  </main>;
}
