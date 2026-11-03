'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { FaDownload, FaFilter, FaSyncAlt } from 'react-icons/fa';
import moment from 'moment-jalaali';
import {
  ErpBadge, ErpButton, ErpCard, ErpEmptyState, ErpInlineState,
  ErpInput, ErpPage, ErpPagination, ErpPressable, ErpSection, ErpSelect, ErpSheet, ErpSkeleton,
} from '@/components/erp';
import { RtlTrendChart } from '@/components/reporting/RtlCharts';
import PersianCalendarPicker from '@/components/PersianCalendar';
import { biAPI, departmentsAPI } from '@/lib/api';
import { formatPrice } from '@/lib/numberFormat';
import {
  applyBiFilters, beginBiRefresh, completeBiRefresh, failBiRefresh,
  resolveBiDestination, type BiFilters, type BiLoadState,
} from './biWorkspaceState';
import type { BiContractEvidence, BiSnapshot, BiSourceHealth } from './biTypes';

export type BiView = 'overview' | 'realized-sales' | 'pipeline' | 'collections' | 'delivery' | 'recommendations' | 'reconciliation' | 'sellers' | 'commercial-mix';

const viewNames: Record<BiView, string> = {
  overview: 'هوش تجاری', 'realized-sales': 'فروش قطعی', pipeline: 'پایپ‌لاین',
  collections: 'وصول', delivery: 'تحویل', recommendations: 'پیشنهادها',
  reconciliation: 'تطبیق', sellers: 'فروشندگان', 'commercial-mix': 'ترکیب تجاری',
};
const periods = [
  ['month', 'ماه جاری'], ['quarter', 'فصل جاری'], ['year', 'سال جاری'],
  ['last12', '۱۲ ماه اخیر'], ['all', 'از ابتدا تا امروز'], ['custom', 'بازه سفارشی'],
];
const sourceLabels: Record<BiSourceHealth['source'], string> = {
  SALES: 'فروش', CRM: 'ارتباط با مشتری', ACCOUNTING: 'حسابداری', LOGISTICS: 'لجستیک', SECURITY: 'نگهبانی',
};
const stateLabels: Record<BiSourceHealth['state'], string> = {
  complete: 'کامل', partial: 'ناقص', unavailable: 'در دسترس نیست', unauthorized: 'بدون دسترسی',
};
const stateTones: Record<BiSourceHealth['state'], 'success' | 'warning' | 'neutral'> = {
  complete: 'success', partial: 'warning', unavailable: 'neutral', unauthorized: 'neutral',
};
const money = (value: number | null | undefined) => value == null ? '—' : formatPrice(value);
const number = (value: number | null | undefined) => value == null ? '—' : value.toLocaleString('fa-IR');
const freshness = (value: string | null) => value
  ? new Intl.DateTimeFormat('fa-IR-u-ca-persian', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
  : '—';

const requestFilters = (filters: BiFilters) => ({
  ...filters,
  ...(filters.period === 'custom' && filters.from ? { from: moment(filters.from, 'jYYYY/jMM/jDD').startOf('day').toISOString() } : {}),
  ...(filters.period === 'custom' && filters.to ? { to: moment(filters.to, 'jYYYY/jMM/jDD').endOf('day').toISOString() } : {}),
});

const queryFor = (filters: BiFilters, signal?: string) => {
  const query = new URLSearchParams();
  query.set('period', filters.period);
  if (filters.departmentId) query.set('departmentId', filters.departmentId);
  if (filters.sellerId) query.set('sellerId', filters.sellerId);
  const request = requestFilters(filters);
  if (request.from) query.set('from', request.from);
  if (request.to) query.set('to', request.to);
  if (signal) query.set('signal', signal);
  return query.toString();
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

function SourceHealthStrip({ sources }: { sources: BiSourceHealth[] }) {
  return <section aria-label="وضعیت منابع" className="sds-neumorphic-card grid grid-cols-2 overflow-hidden sm:grid-cols-5">
    {sources.map((source) => <div key={source.source} className="min-w-0 border-b border-l border-[var(--sds-border-subtle)] p-3 last:border-l-0 sm:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-bold text-[var(--sds-text-primary)]">{sourceLabels[source.source]}</span>
        <ErpBadge tone={stateTones[source.state]}>{stateLabels[source.state]}</ErpBadge>
      </div>
      <p className="mt-2 text-[11px] text-[var(--sds-text-muted)]">تازه‌سازی {freshness(source.refreshedAt)}</p>
      {source.coverage && source.state === 'partial' && <p className="mt-2 text-[11px] text-[var(--sds-text-muted)]">پوشش {number(source.coverage.covered)} از {number(source.coverage.total)}</p>}
    </div>)}
  </section>;
}

function MetricLink({ label, value, meta, href, tone }: { label: string; value: string; meta: React.ReactNode; href: string; tone: 'primary' | 'warning' | 'danger' | 'info' }) {
  return <Link href={href} className="block rounded-2xl outline-none focus-visible:ring-2 focus-visible:ring-[var(--sds-focus-ring)]">
    <ErpCard interactive tone={tone} className="h-full p-4">
      <p className="text-xs font-semibold text-[var(--sds-text-muted)]">{label}</p>
      <p className="mt-3 text-xl font-black tabular-nums text-[var(--sds-text-primary)]">{value}</p>
      <p className="mt-2 text-xs text-[var(--sds-text-secondary)]">{meta}</p>
    </ErpCard>
  </Link>;
}

function EvidenceTable({ rows }: { rows: BiContractEvidence[] }) {
  if (!rows.length) return <ErpEmptyState title="شاهدی در این دامنه وجود ندارد" />;
  return <div id="evidence" className="overflow-x-auto"><table className="w-full min-w-[720px] text-right text-sm">
    <thead><tr className="border-b border-[var(--sds-border-subtle)] text-xs text-[var(--sds-text-muted)]">
      <th className="px-3 py-3">قرارداد</th><th className="px-3 py-3">مشتری</th><th className="px-3 py-3">وضعیت</th><th className="px-3 py-3">مبلغ</th><th className="px-3 py-3">مسئول فروش</th><th className="px-3 py-3">عملیات</th>
    </tr></thead>
    <tbody>{rows.map((row) => <tr key={row.id} className="border-b border-[var(--sds-border-subtle)]">
      <td className="px-3 py-3 font-bold">{row.contractNumber}</td><td className="px-3 py-3">{row.customer}</td><td className="px-3 py-3">{row.statusLabel}</td><td className="px-3 py-3 tabular-nums">{money(row.amount)}</td><td className="px-3 py-3">{row.responsibleSeller}</td>
      <td className="px-3 py-3">{row.canOpenSource ? <ErpButton label="مشاهده در فروش" href={`/dashboard/sales/contracts/${row.id}`} variant="ghost" /> : <span className="text-xs text-[var(--sds-text-muted)]">بدون دسترسی</span>}</td>
    </tr>)}</tbody>
  </table></div>;
}

function ServerEvidence({ view, filters }: { view: string; filters: BiFilters }) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('createdAt');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ rows: BiContractEvidence[]; page: number; pageSize: number; totalItems: number; totalPages: number } | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let current = true;
    setLoading(true);
    const timer = window.setTimeout(() => {
      biAPI.getSalesAnalysis(view, { ...requestFilters(filters), search, sort, direction: 'desc', page, pageSize: 25 })
        .then((response) => { if (current) setResult(response.data.data); })
        .finally(() => { if (current) setLoading(false); });
    }, 250);
    return () => { current = false; window.clearTimeout(timer); };
  }, [filters, page, search, sort, view]);
  return <ErpSection title="شواهد قراردادها">
    <div className="mb-4 grid gap-3 sm:grid-cols-2">
      <ErpInput value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="جستجو در قرارداد یا مشتری" aria-label="جستجو در شواهد" />
      <ErpSelect value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }} aria-label="مرتب‌سازی شواهد"><option value="createdAt">جدیدترین</option><option value="amount">بیشترین مبلغ</option><option value="contractNumber">شماره قرارداد</option></ErpSelect>
    </div>
    {loading && !result ? <ErpSkeleton lines={5} /> : <EvidenceTable rows={result?.rows || []} />}
    {result && <ErpPagination currentPage={result.page} totalPages={result.totalPages} totalItems={result.totalItems} itemsPerPage={result.pageSize} onPageChange={setPage} itemLabel="قرارداد" />}
  </ErpSection>;
}

function FilterBar({ draft, onDraft, onApply, applying, report, departments }: { draft: BiFilters; onDraft: (next: BiFilters) => void; onApply: () => void; applying: boolean; report: BiSnapshot; departments: Array<{ id: string; name?: string; namePersian?: string }> }) {
  return <ErpSection><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5 xl:items-end">
    <label className="block text-xs font-bold text-[var(--sds-text-secondary)]">بازه
      <ErpSelect value={draft.period} onChange={(event) => onDraft({ ...draft, period: event.target.value })} className="mt-2">
        {periods.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </ErpSelect>
    </label>
    {draft.period === 'custom' && <>
      <label className="block text-xs font-bold text-[var(--sds-text-secondary)]">از<PersianCalendarPicker value={draft.from || ''} onChange={(from) => onDraft({ ...draft, from })} /></label>
      <label className="block text-xs font-bold text-[var(--sds-text-secondary)]">تا<PersianCalendarPicker value={draft.to || ''} onChange={(to) => onDraft({ ...draft, to })} /></label>
    </>}
    {report.permissions.canCompany && <label className="block text-xs font-bold text-[var(--sds-text-secondary)]">دپارتمان
      <ErpSelect value={draft.departmentId} onChange={(event) => onDraft({ ...draft, departmentId: event.target.value, sellerId: '' })} className="mt-2"><option value="">کل شرکت</option>{departments.map((department) => <option key={department.id} value={department.id}>{department.namePersian || department.name}</option>)}</ErpSelect>
    </label>}
    {report.permissions.canSelectSeller && <label className="block text-xs font-bold text-[var(--sds-text-secondary)]">فروشنده
      <ErpSelect value={draft.sellerId} onChange={(event) => onDraft({ ...draft, sellerId: event.target.value })} className="mt-2"><option value="">همه فروشندگان مجاز</option>{report.sellers.filter((seller) => seller.id !== 'legacy-unassigned').map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}</ErpSelect>
    </label>}
    <ErpButton label="اعمال فیلتر" icon={FaFilter} onClick={onApply} disabled={applying} variant="solid" />
  </div></ErpSection>;
}

function Overview({ report, filters }: { report: BiSnapshot; filters: BiFilters }) {
  const q = (signal: string) => queryFor(filters, signal);
  const recommendations = report.recommendations || [];
  const accountingState = report.sourceHealth.find((row) => row.source === 'ACCOUNTING')?.state;
  const [selected, setSelected] = useState<
    | { kind: 'trend'; datum: BiSnapshot['trend'][number] }
    | { kind: 'recommendation'; datum: NonNullable<BiSnapshot['recommendations']>[number] }
    | null
  >(null);
  const selectedHref = selected?.kind === 'trend'
    ? `/dashboard/bi/realized-sales?${q(`trend-${selected.datum.key}`)}`
    : selected?.datum.destination ? `${selected.datum.destination}?${q(selected.datum.id)}` : '/dashboard/bi';
  return <div className="space-y-5">
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <MetricLink label="فروش قطعی خالص" value={money(report.cards.netRealized)} meta={report.cards.growthPercent == null ? 'مقایسه در دسترس نیست' : `${number(report.cards.growthPercent)}٪ نسبت به دوره قبل`} href={`/dashboard/bi/realized-sales?${q('net-realized')}`} tone="primary" />
      <MetricLink label="پایپ‌لاین فعال" value={money(report.cards.currentPipelineValue)} meta={`${number(report.cards.currentPipelineCount)} قرارداد باز`} href={`/dashboard/bi/pipeline?${q('active-pipeline')}`} tone="warning" />
      <MetricLink label="مانده وصول" value={accountingState === 'unavailable' || accountingState === 'unauthorized' ? '—' : money(report.finance.receivableAmount)} meta={accountingState === 'partial' ? <ErpBadge tone="warning">پوشش {number(report.finance.coverage.coveredContracts)} از {number(report.finance.coverage.totalContracts)} قرارداد</ErpBadge> : 'شواهد تأییدشده حسابداری'} href={`/dashboard/bi/collections?${q('receivable')}`} tone="danger" />
      <MetricLink label="ریسک اجرای تحویل" value={number(report.riskEvidence.overdueDeliveries.count)} meta="تحویل وعده‌داده‌شده و سررسیدگذشته" href={`/dashboard/bi/delivery?${q('delivery-risk')}`} tone="info" />
    </div>
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)]">
      <ErpSection title="روند تجاری" className="min-w-0 overflow-hidden"><RtlTrendChart data={report.trend} valueAxisSide="left" onSelect={(datum) => setSelected({ kind: 'trend', datum })} /><label className="mt-3 block text-xs font-bold text-[var(--sds-text-secondary)]">انتخاب نقطه روند<ErpSelect value="" onChange={(event) => { const datum = report.trend.find((row) => row.key === event.target.value); if (datum) setSelected({ kind: 'trend', datum }); }} className="mt-2"><option value="">انتخاب تاریخ</option>{report.trend.map((datum) => <option key={datum.key} value={datum.key}>{datum.label}</option>)}</ErpSelect></label></ErpSection>
      <ErpSection title="پیشنهادهای مدیریتی" actions={[{ label: 'مشاهده همه', href: `/dashboard/bi/recommendations?${queryFor(filters)}`, variant: 'ghost' }]}>
        {recommendations.length ? <div className="space-y-2">{recommendations.slice(0, 4).map((item) => <ErpPressable key={item.id} onClick={() => setSelected({ kind: 'recommendation', datum: item })} className="sds-card-interactive flex min-h-16 w-full items-center justify-between gap-3 rounded-xl border border-[var(--sds-border-subtle)] p-3 text-right">
          <span><span className="block text-sm font-bold text-[var(--sds-text-primary)]">{item.title}</span><span className="mt-1 block text-xs text-[var(--sds-text-muted)]">{item.evidence}</span></span>
          <ErpBadge tone={item.priority === 'breached' ? 'danger' : item.priority === 'reconciliation' ? 'warning' : 'info'}>{number(item.count)}</ErpBadge>
        </ErpPressable>)}</div> : <ErpEmptyState title="پیشنهاد فعالی وجود ندارد" />}
      </ErpSection>
    </div>
    <ErpSheet open={Boolean(selected)} onClose={() => setSelected(null)} title={selected?.kind === 'trend' ? `روند ${selected.datum.label}` : selected?.datum.title || 'شواهد'} footer={<ErpButton label="مشاهده شواهد" href={selectedHref} variant="solid" />}>
      {selected?.kind === 'trend' ? <div className="space-y-3"><p className="text-sm text-[var(--sds-text-secondary)]">{report.scope.label} · {report.period.label}</p><div className="grid gap-3"><ErpCard className="p-3">فروش قطعی خالص: <strong>{money(selected.datum.net)}</strong></ErpCard><ErpCard className="p-3">پایپ‌لاین ایجادشده: <strong>{money(selected.datum.pipeline)}</strong></ErpCard><ErpCard className="p-3">تعدیلات: <strong>{money(selected.datum.adjustments)}</strong></ErpCard></div></div> : selected ? <div className="space-y-3"><p className="text-sm leading-7 text-[var(--sds-text-secondary)]">{selected.datum.evidence}</p><ErpCard className="p-3">تعداد شواهد: <strong>{number(selected.datum.count)}</strong></ErpCard>{selected.datum.value != null && <ErpCard className="p-3">مبلغ در معرض: <strong>{money(selected.datum.value)}</strong></ErpCard>}<p className="text-xs text-[var(--sds-text-muted)]">{report.scope.label} · {report.period.label}</p></div> : null}
    </ErpSheet>
  </div>;
}

function FocusedView({ view, report, filters }: { view: Exclude<BiView, 'overview'>; report: BiSnapshot; filters: BiFilters }) {
  if (view === 'recommendations') return <ErpSection title="پیشنهادهای فعال">{report.recommendations?.length ? <div className="grid gap-3 lg:grid-cols-2">{report.recommendations.map((item) => <ErpCard key={item.id} tone={item.priority === 'breached' ? 'danger' : 'warning'} className="p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-bold text-[var(--sds-text-primary)]">{item.title}</h2><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{item.evidence}</p></div><ErpBadge tone="warning">{number(item.count)}</ErpBadge></div><div className="mt-4"><ErpButton label="بررسی شواهد" href={`${item.destination}?${queryFor(filters, item.id)}`} variant="ghost" /></div></ErpCard>)}</div> : <ErpEmptyState title="پیشنهاد فعالی وجود ندارد" />}</ErpSection>;
  if (view === 'reconciliation') {
    const incomplete = report.sourceHealth.filter((row) => row.state !== 'complete');
    const issues = (report.recommendations || []).filter((row) => row.priority === 'reconciliation');
    return <div className="space-y-5"><ErpSection title="موارد تطبیق">{issues.length ? <div className="space-y-2">{issues.map((issue) => <ErpCard key={issue.id} tone="warning" className="p-4"><div className="flex items-start justify-between gap-3"><div><strong className="text-[var(--sds-text-primary)]">{issue.title}</strong><p className="mt-2 text-sm text-[var(--sds-text-secondary)]">{issue.evidence}</p></div><ErpBadge tone="warning">{number(issue.count)}</ErpBadge></div></ErpCard>)}</div> : <ErpInlineState kind="success" title="مغایرت تأییدشده‌ای وجود ندارد" />}</ErpSection><ErpSection title="وضعیت منابع">{incomplete.length ? <div className="space-y-2">{incomplete.map((source) => <ErpInlineState key={source.source} kind={source.state === 'partial' ? 'stale' : 'permission'} title={`${sourceLabels[source.source]}: ${stateLabels[source.state]}`} />)}</div> : <ErpInlineState kind="success" title="منابع موجود با دامنه فعلی تطبیق دارند" />}</ErpSection></div>;
  }
  if (view === 'sellers') return <ErpSection title="فروشندگان">{report.legacyUnassigned.count > 0 && <ErpInlineState kind="stale" title={`${number(report.legacyUnassigned.count)} فروش قطعی تخصیص‌نیافته در جمع شرکت هست و وارد مقایسه فروشندگان نشده است.`} />}<div className="mt-3 space-y-2">{report.sellers.map((seller) => <ErpCard key={seller.id} className="p-4"><div className="flex flex-wrap items-center justify-between gap-2"><strong>{seller.name}</strong><div className="flex flex-wrap gap-2">{seller.overdueFollowUpCount > 0 && <ErpBadge tone="danger">{number(seller.overdueFollowUpCount)} پیگیری معوق</ErpBadge>}{seller.stalledPipelineCount > 0 && <ErpBadge tone="warning">{number(seller.stalledPipelineCount)} پایپ‌لاین متوقف</ErpBadge>}</div></div><div className="mt-3 grid gap-2 text-sm sm:grid-cols-4"><span>فروش قطعی: {money(seller.netRealized)}</span><span>پایپ‌لاین: {money(seller.pipelineValue)}</span><span>نرخ از دست‌رفته: {seller.lossRate == null ? '—' : `${number(seller.lossRate)}٪`}</span><span>تغییر دوره: {seller.deteriorationPercent == null ? '—' : `${number(seller.deteriorationPercent)}٪`}</span></div></ErpCard>)}</div></ErpSection>;
  if (view === 'commercial-mix') return <div className="grid gap-5 lg:grid-cols-2"><ErpSection title="مشتریان">{report.customers.map((row) => <div key={row.id} className="flex justify-between border-b border-[var(--sds-border-subtle)] py-3"><span>{row.name}</span><strong>{money(row.value)}</strong></div>)}</ErpSection><ErpSection title="محصولات">{report.products.map((row) => <div key={row.id} className="flex justify-between border-b border-[var(--sds-border-subtle)] py-3"><span>{row.name}</span><strong>{money(row.value)}</strong></div>)}</ErpSection></div>;
  if (view === 'collections') {
    const accountingAvailable = !['unavailable', 'unauthorized'].includes(report.sourceHealth.find((row) => row.source === 'ACCOUNTING')?.state || 'unavailable');
    return <><div className="grid gap-3 sm:grid-cols-3"><MetricLink label="دریافت دوره" value={accountingAvailable ? money(report.finance.receivedAmount) : '—'} meta="منبع: حسابداری" href="#evidence" tone="primary" /><MetricLink label="مانده وصول" value={accountingAvailable ? money(report.finance.receivableAmount) : '—'} meta={`پوشش ${number(report.finance.coverage.coveredContracts)} از ${number(report.finance.coverage.totalContracts)} قرارداد`} href="#evidence" tone="warning" /><MetricLink label="سررسیدگذشته" value={accountingAvailable ? money(report.finance.overdueAmount) : '—'} meta="تعهد وصول نقض‌شده" href="#evidence" tone="danger" /></div><div className="mt-5"><ServerEvidence view={view} filters={filters} /></div></>;
  }
  if (view === 'delivery') {
    const logisticsAvailable = !['unavailable', 'unauthorized'].includes(report.sourceHealth.find((row) => row.source === 'LOGISTICS')?.state || 'unavailable');
    const securityAvailable = !['unavailable', 'unauthorized'].includes(report.sourceHealth.find((row) => row.source === 'SECURITY')?.state || 'unavailable');
    return <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><MetricLink label="سررسیدگذشته" value={number(report.delivery.overdueDeliveries)} meta="تعهد تحویل نقض‌شده" href="#evidence" tone="danger" /><MetricLink label="موعد نزدیک" value={number(report.delivery.dueSoonDeliveries)} meta="۷ روز آینده" href="#evidence" tone="warning" /><MetricLink label="تحویل بدون تأیید مشتری" value={number(report.delivery.deliveredUnconfirmed)} meta="منبع: فروش" href="#evidence" tone="warning" /><MetricLink label="بارگیری بدون خروج" value={logisticsAvailable && securityAvailable ? number(Math.max(0, report.delivery.finalizedLoadings - report.delivery.exitedLoadings)) : '—'} meta="تطبیق لجستیک و گارد" href="#evidence" tone="info" /></div><div className="mt-5"><ServerEvidence view={view} filters={filters} /></div></>;
  }
  return <ServerEvidence view={view} filters={filters} />;
}

export default function BiWorkspace({ view = 'overview' }: { view?: BiView }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialFilters = useMemo<BiFilters>(() => ({
    period: searchParams.get('period') || 'month', departmentId: searchParams.get('departmentId') || '', sellerId: searchParams.get('sellerId') || '',
    ...(searchParams.get('from') ? { from: moment(searchParams.get('from')!).format('jYYYY/jMM/jDD') } : {}), ...(searchParams.get('to') ? { to: moment(searchParams.get('to')!).format('jYYYY/jMM/jDD') } : {}),
  }), [searchParams]);
  const [committed, setCommitted] = useState(initialFilters);
  const [draft, setDraft] = useState(initialFilters);
  const [state, setState] = useState<BiLoadState<BiSnapshot>>({ data: null, error: null, refreshing: false });
  const [departments, setDepartments] = useState<Array<{ id: string; name?: string; namePersian?: string }>>([]);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const load = useCallback(async (filters: BiFilters) => {
    setState((current) => beginBiRefresh(current));
    try {
      const response = await biAPI.getSalesOverview(requestFilters(filters));
      setState((current) => completeBiRefresh(current, response.data.data as BiSnapshot));
    } catch (reason: unknown) {
      const message = typeof reason === 'object' && reason && 'response' in reason ? ((reason as { response?: { data?: { error?: string } } }).response?.data?.error || 'به‌روزرسانی انجام نشد') : 'به‌روزرسانی انجام نشد';
      setState((current) => failBiRefresh(current, message));
    }
  }, []);
  useEffect(() => {
    const destination = resolveBiDestination({ pathname, legacyTab: searchParams.get('tab') });
    if (destination !== pathname) { const next = new URLSearchParams(searchParams.toString()); next.delete('tab'); router.replace(`${destination}?${next.toString()}`); return; }
    load(committed);
  }, [committed, load, pathname, router, searchParams]);
  useEffect(() => {
    if (!state.data?.permissions.canCompany || departments.length) return;
    departmentsAPI.getDepartments().then((response) => setDepartments(response.data.data || response.data || [])).catch(() => undefined);
  }, [departments.length, state.data?.permissions.canCompany]);
  const apply = () => { const next = applyBiFilters(committed, draft); setCommitted(next); router.replace(`${pathname}?${queryFor(next, searchParams.get('signal') || undefined)}`); };
  const runExport = async (kind: 'pdf' | 'xlsx') => {
    setExporting(true);
    try {
      const response = kind === 'pdf'
        ? await biAPI.downloadSalesSummaryPdf(requestFilters(committed))
        : await biAPI.exportSalesTable('summary', requestFilters(committed));
      downloadBlob(response.data, kind === 'pdf' ? 'bi-snapshot.pdf' : 'bi-snapshot.xlsx');
    } finally {
      setExporting(false);
    }
  };
  const actions = [
    { label: 'به‌روزرسانی', icon: FaSyncAlt, onClick: () => load(committed), disabled: state.refreshing },
    ...(state.data ? [
      { label: 'خروجی', icon: FaDownload, onClick: () => setExportOpen(true), disabled: exporting, variant: 'outline' as const },
    ] : []),
  ];
  if (!state.data && state.refreshing) return <main className="sds-workspace mx-auto w-full max-w-7xl space-y-4"><ErpSkeleton lines={4} /><ErpSkeleton lines={6} /></main>;
  if (!state.data) return <ErpPage title={viewNames[view]} actions={actions}><ErpInlineState kind="error" title={state.error || 'داده‌های هوش تجاری در دسترس نیست'} action={{ label: 'تلاش دوباره', onClick: () => load(committed) }} /></ErpPage>;
  return <>
    <ErpPage eyebrow="هوش تجاری" title={viewNames[view]} description={`${state.data.scope.label} · ${state.data.period.label} · به‌روزرسانی ${state.data.generatedAtLabel}`} actions={actions} backHref={view === 'overview' ? undefined : `/dashboard/bi?${queryFor(committed)}`}>
      {state.error && <ErpInlineState kind="stale" title="به‌روزرسانی ناموفق بود؛ آخرین اطلاعات موفق نمایش داده می‌شود." action={{ label: 'تلاش دوباره', onClick: () => load(committed) }} />}
      <SourceHealthStrip sources={state.data.sourceHealth} />
      <FilterBar draft={draft} onDraft={setDraft} onApply={apply} applying={state.refreshing} report={state.data} departments={departments} />
      {view === 'overview' ? <Overview report={state.data} filters={committed} /> : <FocusedView view={view} report={state.data} filters={committed} />}
    </ErpPage>
    <ErpSheet
      open={exportOpen}
      onClose={() => setExportOpen(false)}
      title="خروجی هوش تجاری"
      footer={<div className="flex flex-wrap gap-2"><ErpButton label="پی‌دی‌اف" icon={FaDownload} onClick={() => runExport('pdf')} disabled={exporting} /><ErpButton label="اکسل" icon={FaDownload} onClick={() => runExport('xlsx')} disabled={exporting} variant="outline" /></div>}
    >
      <div className="space-y-3 text-sm text-[var(--sds-text-secondary)]">
        <p>{state.data.scope.label} · {state.data.period.label}</p>
        <p>فروش قطعی، پایپ‌لاین، وصول، تحویل، وضعیت منابع و پیشنهادها</p>
      </div>
    </ErpSheet>
  </>;
}
