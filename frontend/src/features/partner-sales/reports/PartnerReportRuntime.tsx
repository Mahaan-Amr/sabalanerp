'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import moment from 'moment-jalaali';
import { ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpLoading, ErpSegmentedControl, ErpSelect, ErpToolbar } from '@/components/erp';
import { FaChartLine } from 'react-icons/fa';
import api from '@/lib/api';
import { PartnerReportView, type PartnerReportPresentation } from './PartnerReportView';

const tehranDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const jalaliRangeFrom = (months: number) => moment().subtract(months - 1, 'jMonth').startOf('jMonth').format('YYYY-MM-DD');
const initialFrom = () => jalaliRangeFrom(6);
type StateFilter = '' | 'DRAFT' | 'AWAITING_CUSTOMER_CONFIRMATION' | 'CUSTOMER_APPROVED' | 'COMMITTED' | 'CANCELLED' | 'VOIDED';
type PeriodPreset = '3' | '6' | '12' | 'custom';

function parseReport(value: unknown): PartnerReportPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const report = value as Record<string, unknown>;
  const scope = report.scope as Record<string, unknown> | undefined;
  if (!scope || !Array.isArray(report.rows) || !Array.isArray(report.totals) || typeof scope.from !== 'string' || typeof scope.effectiveThrough !== 'string') return null;
  const metric = (input: unknown) => { const row = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    return { wholesalePurchases: typeof row.wholesalePurchases === 'string' ? row.wholesalePurchases : null,
      retailSales: typeof row.retailSales === 'string' ? row.retailSales : null,
      retailCollected: typeof row.retailCollected === 'string' ? row.retailCollected : null,
      netComparableMargin: typeof row.netComparableMargin === 'string' ? row.netComparableMargin : null }; };
  try {
    return { scopeLabel: scope.kind === 'OWN' ? 'حساب خودم' : String(scope.kind ?? ''), from: scope.from,
      effectiveThrough: scope.effectiveThrough,
      totals: (report.totals as Record<string, unknown>[]).map(total => ({ currency: total.currency as 'IRR' | 'IRT', metrics: metric(total.metrics),
        accountingBalance: typeof total.accountingBalance === 'string' ? total.accountingBalance : null,
        accountingReceivedAsOf: typeof total.accountingReceivedAsOf === 'string' ? total.accountingReceivedAsOf : null,
        accountingCovered: Number(total.accountingCovered), accountingEligible: Number(total.accountingEligible) })),
      series: Array.isArray(report.series) ? (report.series as Record<string, unknown>[]).map(series => ({
        currency: series.currency as 'IRR' | 'IRT',
        points: Array.isArray(series.points) ? (series.points as Record<string, unknown>[]).map(point => ({
          jalaliMonth: String(point.jalaliMonth), debtBalance: String(point.debtBalance),
          receivableBalance: String(point.receivableBalance), receipts: String(point.receipts),
          transactions: Array.isArray(point.transactions) ? (point.transactions as Record<string, unknown>[]).map(transaction => ({
            caseId: String(transaction.caseId), caseNumber: String(transaction.caseNumber),
            customerContractNumber: String(transaction.customerContractNumber), effectiveDate: String(transaction.effectiveDate),
            kind: transaction.kind as never, debtDelta: String(transaction.debtDelta),
            receivableDelta: String(transaction.receivableDelta), receiptDelta: String(transaction.receiptDelta),
          })) : [],
        })) : [],
      })) : [],
      rows: (report.rows as Record<string, unknown>[]).map(row => ({ caseId: String(row.caseId), revision: Number(row.revision),
        caseNumber: String(row.caseNumber), customerContractNumber: String(row.customerContractNumber), state: row.state as never,
        currency: row.currency as 'IRR' | 'IRT', metrics: metric(row.metrics),
        accountingBalance: row.account && typeof row.account === 'object' && !Array.isArray(row.account)
          && (row.account as Record<string, unknown>).balance && typeof (row.account as Record<string, unknown>).balance === 'object'
          ? String(((row.account as Record<string, unknown>).balance as Record<string, unknown>).amount ?? '') || null : null,
        ...(typeof row.collectionStatus === 'string' ? { collectionStatus: row.collectionStatus as never } : {}) })) };
  } catch { return null; }
}

export function PartnerReportRuntime() {
  const router = useRouter();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(tehranDate);
  const [periodPreset, setPeriodPreset] = useState<PeriodPreset>('6');
  const [search, setSearch] = useState('');
  const [state, setState] = useState<StateFilter>('');
  const [report, setReport] = useState<PartnerReportPresentation>();
  const [pending, setPending] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string>();
  const query = useMemo(() => ({ purpose: 'PARTNER' as const, from, to, ...(search.trim() ? { search: search.trim() } : {}), ...(state ? { state } : {}), limit: 500 }), [from, to, search, state]);
  const load = useCallback(async () => {
    if (!from || !to || from > to) { setError('بازه تاریخ معتبر نیست.'); return; }
    setPending(true); setError(undefined);
    try { const response = await api.get('/partner/reports', { params: query }); const parsed = parseReport((response.data as { data?: unknown })?.data);
      if (!parsed) throw new Error('invalid'); setReport(parsed); }
    catch { setError('دریافت گزارش و حساب انجام نشد.'); }
    finally { setPending(false); }
  }, [from, query, to]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 250); return () => window.clearTimeout(timer); }, [load]);
  const exportReport = async () => {
    if (exporting) return; setExporting(true); setError(undefined);
    try {
      const created = await api.post('/partner/reports/exports', query);
      const exportId = ((created.data as { data?: { exportId?: unknown } })?.data?.exportId);
      if (typeof exportId !== 'string') throw new Error('invalid');
      const downloaded = await api.get(`/partner/reports/exports/${encodeURIComponent(exportId)}`);
      const blob = new Blob([JSON.stringify((downloaded.data as { data?: unknown }).data, null, 2)], { type: 'application/json;charset=utf-8' });
      const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url;
      anchor.download = `partner-report-${from}-${to}.json`; anchor.click(); URL.revokeObjectURL(url);
    } catch { setError('ساخت خروجی امن گزارش انجام نشد.'); }
    finally { setExporting(false); }
  };
  const choosePeriod = (value: PeriodPreset) => {
    setPeriodPreset(value);
    if (value === 'custom') return;
    setFrom(jalaliRangeFrom(Number(value))); setTo(tehranDate());
  };
  const periodControl = <div className="space-y-3"><ErpSegmentedControl value={periodPreset} onChange={choosePeriod}
    options={[{ value: '3', label: '۳ ماه' }, { value: '6', label: '۶ ماه' }, { value: '12', label: '۱۲ ماه' }, { value: 'custom', label: 'بازه دلخواه' }]} />
    {periodPreset === 'custom' && <div className="grid gap-4 sm:grid-cols-2"><ErpField label="از"><ErpInput type="date" value={from}
      onChange={event => setFrom(event.target.value)} /></ErpField><ErpField label="تا"><ErpInput type="date" value={to}
      onChange={event => setTo(event.target.value)} /></ErpField></div>}</div>;
  const filters = <ErpToolbar search={{ value: search, placeholder: 'شماره پرونده یا قرارداد مشتری', onChange: setSearch }}
    filters={<ErpSelect aria-label="وضعیت" value={state} onChange={event => setState(event.target.value as StateFilter)}>
      <option value="">همه وضعیت‌ها</option><option value="DRAFT">پیش‌نویس</option><option value="AWAITING_CUSTOMER_CONFIRMATION">در انتظار تأیید مشتری</option>
      <option value="CUSTOMER_APPROVED">تأیید مشتری</option><option value="COMMITTED">قطعی</option><option value="CANCELLED">لغوشده</option><option value="VOIDED">باطل‌شده</option>
    </ErpSelect>} actions={[]} />;
  if (pending && !report) return <>{periodControl}{filters}<ErpLoading /></>;
  if (!report) return <ErpInlineState kind="error" title={error || 'گزارش در دسترس نیست.'} action={{ label: 'تلاش مجدد', onClick: () => void load() }} />;
  return <div className="space-y-4">{periodControl}{filters}
    {error && <ErpInlineState kind="error" title={error} />}
    {report.rows.length ? <PartnerReportView report={report} canExport={!exporting} onExport={() => void exportReport()}
      onOpenCase={row => router.push(`/dashboard/sales/partner-cases?caseId=${encodeURIComponent(row.caseId)}`)} />
      : <ErpEmptyState icon={FaChartLine} title="در این محدوده گزارشی وجود ندارد" description="بازه تاریخ، وضعیت یا عبارت جست‌وجو را تغییر دهید." />}</div>;
}
