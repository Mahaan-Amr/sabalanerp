'use client';

import React from 'react';
import { partnerTrackingCode, type CaseState } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpFieldView, ErpMetricGrid, ErpSheet, ErpWorkspacePage, type ErpAction } from '@/components/erp';
import { FaChartLine, FaDownload, FaFileInvoiceDollar, FaWallet } from 'react-icons/fa';
import { formatPartnerMoney, partnerChartMagnitude, subtractPartnerDecimal } from '../presentation';
import { FinancialTrendChart } from '@/components/reporting/FinancialTrendChart';

type Currency = 'IRR' | 'IRT';
type Metrics = { wholesalePurchases: string | null; retailSales: string | null; retailCollected: string | null; netComparableMargin: string | null };
type ChartTransaction = { caseId: string; caseNumber: string; trackingNumber?: number; customerContractNumber: string; effectiveDate: string;
  kind: 'COMMITMENT' | 'CORRECTION' | 'VOID' | 'SABALAN_RECEIPT' | 'CUSTOMER_RECEIPT' | 'CUSTOMER_RECEIPT_REVERSAL';
  debtDelta: string; receivableDelta: string; receiptDelta: string };
type MonthlyPoint = { jalaliMonth: string; debtBalance: string; receivableBalance: string; receipts: string; transactions: ChartTransaction[] };
/** UI-only presentation. The integration owner must create this from the approved strict transport. */
export type PartnerReportPresentation = {
  scopeLabel: string; from: string; effectiveThrough: string;
  totals: Array<{ currency: Currency; metrics: Metrics; accountingBalance: string | null; accountingReceivedAsOf: string | null; accountingCovered: number; accountingEligible: number }>;
  series?: Array<{ currency: Currency; points: MonthlyPoint[] }>;
  rows: Array<{ caseId: string; revision: number; caseNumber: string; trackingNumber?: number; customerContractNumber: string; state: CaseState; currency: Currency; metrics: Metrics;
    accountingBalance?: string | null;
    collectionStatus?: 'UNPAID' | 'PARTIAL' | 'SETTLED' | 'OVERPAID';
    history?: { receiptCount: number; revisionCount: number; superseded: boolean; cancelled: boolean } }>;
};
type PartnerReportRow = PartnerReportPresentation['rows'][number];

export function partnerReportPrimaryAction(canExport: boolean, onExport?: () => void): ErpAction | undefined {
  return canExport ? { label: 'خروجی همین محدوده', icon: FaDownload, variant: 'outline', onClick: onExport } : undefined;
}

const collectionCopy = { UNPAID: ['وصول‌نشده', 'danger'], PARTIAL: ['وصول جزئی', 'warning'], SETTLED: ['تسویه مشتری', 'success'], OVERPAID: ['بیش‌پرداخت', 'info'] } as const;

export function PartnerReportView({ report, canExport, onExport, onOpenCase }: { report: PartnerReportPresentation; canExport: boolean; onExport?: () => void; onOpenCase: (row: PartnerReportRow) => void }) {
  return <ErpWorkspacePage title="گزارش و حساب" context={`${report.from} تا ${report.effectiveThrough} · ${report.scopeLabel}`}
    primaryAction={partnerReportPrimaryAction(canExport, onExport)}>
    <PartnerReportContent report={report} onOpenCase={onOpenCase} />
  </ErpWorkspacePage>;
}

function accountingBalancePresentation(total: PartnerReportPresentation['totals'][number]) {
  if (!total.accountingEligible || !total.accountingCovered) return { value: 'پوشش حسابداری در دسترس نیست', hint: 'مانده‌ای نمایش داده نمی‌شود' };
  if (total.accountingCovered < total.accountingEligible || total.accountingBalance === null) return {
    value: 'پوشش حسابداری ناقص است', hint: `${total.accountingCovered.toLocaleString('fa-IR')} از ${total.accountingEligible.toLocaleString('fa-IR')} پرونده`,
  };
  return { value: formatPartnerMoney(total.accountingBalance, total.currency), hint: total.accountingReceivedAsOf ? `تا ${total.accountingReceivedAsOf}` : 'از حقیقت حسابداری' };
}

function metricPresentation(value: string | null, currency: Currency) {
  return value === null ? 'داده معتبر در دسترس نیست' : formatPartnerMoney(value, currency);
}

export const partnerReportReceivable = (sales: string | null, collected: string | null) =>
  subtractPartnerDecimal(sales, collected);

function PartnerFinancialCharts({ points, currency, onOpenPoint }: { points: MonthlyPoint[]; currency: Currency; onOpenPoint: (point: MonthlyPoint) => void }) {
  const chartPoints = points.map(point => ({ ...point, label: point.jalaliMonth,
    debt: partnerChartMagnitude(point.debtBalance), receivable: partnerChartMagnitude(point.receivableBalance),
    receiptValue: partnerChartMagnitude(point.receipts) }));
  const chart = (title: string, series: Array<{ key: string; label: string; color: string }>) => <ErpCard className="overflow-hidden">
    <div className="flex items-start justify-between gap-3 p-4 sm:p-5">
      <div><h3 className="sds-text-primary text-base font-semibold">{title}</h3>
        <p className="sds-text-muted mt-1 text-sm">روند ماهانه · {currency === 'IRT' ? 'تومان' : 'ریال'}</p></div>
      <span className="sds-neumorphic-icon sds-tone-primary inline-flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true"><FaChartLine className="h-4 w-4" /></span>
    </div>
    <div className="px-2 pb-4 sm:px-4" aria-label={title}>
      <FinancialTrendChart points={chartPoints} series={series} onSelect={onOpenPoint}
        formatValue={(_value, key, point) => formatPartnerMoney(key === 'debt' ? point.debtBalance
          : key === 'receivable' ? point.receivableBalance : point.receipts, currency)} />
      <div className="mt-3 flex max-h-40 flex-wrap gap-2 overflow-y-auto rounded-[var(--sds-radius-card)] border border-[var(--sds-border-subtle)] bg-[var(--sds-surface-subtle)] p-2" aria-label={`جزئیات ماه‌های ${title}`}>
        {points.map(point => <ErpButton key={point.jalaliMonth} variant="ghost" label={`جزئیات ${point.jalaliMonth}`} onClick={() => onOpenPoint(point)} />)}
      </div>
    </div>
  </ErpCard>;
  return <div className="grid gap-4 xl:grid-cols-2">
    {chart('نمودار مانده‌ها', [
      { key: 'debt', label: 'بدهی به سبلان', color: 'var(--sds-warning)' },
      { key: 'receivable', label: 'مطالبات مشتری', color: 'var(--sds-accent)' },
    ])}
    {chart('نمودار دریافتی‌ها', [{ key: 'receiptValue', label: 'دریافتی مشتری', color: 'var(--sds-success)' }])}
  </div>;
}

const transactionLabel: Record<ChartTransaction['kind'], string> = {
  COMMITMENT: 'ثبت قرارداد', CORRECTION: 'اصلاح قرارداد', VOID: 'ابطال قرارداد',
  SABALAN_RECEIPT: 'پرداخت به سبلان', CUSTOMER_RECEIPT: 'دریافت از مشتری',
  CUSTOMER_RECEIPT_REVERSAL: 'برگشت دریافت مشتری',
};

export function PartnerReportContent({ report, onOpenCase }: { report: PartnerReportPresentation; onOpenCase: (row: PartnerReportRow) => void }) {
  const [selectedPoint, setSelectedPoint] = React.useState<{ currency: Currency; point: MonthlyPoint } | null>(null);
  return <div className="space-y-5">
    {report.totals.map(total => { const accounting = accountingBalancePresentation(total); return <section key={total.currency} aria-label={`جمع‌های ${total.currency}`} className="space-y-3">
      <ErpBadge tone="neutral">{total.currency === 'IRT' ? 'تومان' : 'ریال'}</ErpBadge>
      <ErpMetricGrid items={[
        { label: 'مطالبات فعلی از مشتریان', value: metricPresentation(partnerReportReceivable(total.metrics.retailSales, total.metrics.retailCollected), total.currency), icon: FaChartLine, tone: 'primary', hint: 'فروش منهای دریافتی‌ها' },
        { label: 'دریافتی واقعی از مشتریان', value: metricPresentation(total.metrics.retailCollected, total.currency), icon: FaWallet, tone: 'success', hint: 'فقط وصول‌های تأییدشده' },
        { label: 'خرید از سبلان', value: metricPresentation(total.metrics.wholesalePurchases, total.currency), icon: FaFileInvoiceDollar, tone: 'info', hint: 'wholesale قطعی' },
        { label: 'سود بازفروش من', value: metricPresentation(total.metrics.netComparableMargin, total.currency), icon: FaWallet, tone: total.metrics.netComparableMargin === null ? 'neutral' : 'success', hint: 'خصوصی حساب من' },
        { label: 'بدهی فعلی به سبلان', value: accounting.value, icon: FaFileInvoiceDollar, tone: 'warning', hint: accounting.hint },
      ]} />
      <p className="text-xs text-[var(--sds-text-secondary)]">
        سود بازفروش، درآمد سبلان نیست و فقط در حساب فروشنده همکار و دید مدیریتی مجاز نمایش داده می‌شود.
      </p>
      <PartnerFinancialCharts currency={total.currency} points={report.series?.find(series => series.currency === total.currency)?.points || []}
        onOpenPoint={point => setSelectedPoint({ currency: total.currency, point })} />
    </section>; })}
    <div className="space-y-3">{report.rows.map(row => { const cancelled = ['CANCELLED', 'VOIDED'].includes(row.state) || row.history?.cancelled;
      const status = cancelled ? ['لغو شده', 'danger'] as const : row.collectionStatus ? collectionCopy[row.collectionStatus] : null; return <ErpCard key={`${row.caseId}:${row.revision}`} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>پرونده {partnerTrackingCode(row.caseNumber, row.trackingNumber)}</strong><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">قرارداد مشتری {row.customerContractNumber} · نسخه {row.revision.toLocaleString('fa-IR')}</p></div>
        <div className="flex flex-wrap gap-2">{status && <ErpBadge tone={status[1]}>{status[0]}</ErpBadge>}{row.history?.superseded && <ErpBadge tone="purple">نسخه جایگزین‌شده</ErpBadge>}</div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ErpFieldView label="فروش retail" value={metricPresentation(row.metrics.retailSales, row.currency)} />
        <ErpFieldView label="وصول مشتری" value={metricPresentation(row.metrics.retailCollected, row.currency)} tone={row.metrics.retailCollected === null ? 'neutral' : 'success'} />
        <ErpFieldView label="خرید wholesale" value={metricPresentation(row.metrics.wholesalePurchases, row.currency)} />
        <ErpFieldView label="سود خالص قابل‌مقایسه" value={metricPresentation(row.metrics.netComparableMargin, row.currency)} tone={row.metrics.netComparableMargin === null ? 'neutral' : 'primary'} /></div>
      {row.history && <p className="mt-3 text-xs text-[var(--sds-text-muted)]">{row.history.receiptCount.toLocaleString('fa-IR')} رخداد وصول · {row.history.revisionCount.toLocaleString('fa-IR')} نسخه پرونده</p>}
      <div className="mt-3 flex justify-end"><ErpButton label="مشاهده پرونده" onClick={() => onOpenCase(row)} variant="ghost" /></div>
    </ErpCard>; })}</div>
    <ErpSheet open={Boolean(selectedPoint)} onClose={() => setSelectedPoint(null)}
      title={selectedPoint ? `جزئیات ماه ${selectedPoint.point.jalaliMonth}` : 'جزئیات نمودار'} presentation="sheet">
      {selectedPoint && <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <ErpFieldView label="بدهی به سبلان" value={formatPartnerMoney(selectedPoint.point.debtBalance, selectedPoint.currency)} />
          <ErpFieldView label="مطالبات مشتریان" value={formatPartnerMoney(selectedPoint.point.receivableBalance, selectedPoint.currency)} />
          <ErpFieldView label="دریافتی ماه" value={formatPartnerMoney(selectedPoint.point.receipts, selectedPoint.currency)} />
        </div>
        {selectedPoint.point.transactions.length ? selectedPoint.point.transactions.map((transaction, index) => <ErpCard
          key={`${transaction.caseId}:${transaction.effectiveDate}:${index}`} className="p-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><strong>{transactionLabel[transaction.kind]}</strong><span>{transaction.effectiveDate}</span></div>
          <p className="mt-2 text-sm">پرونده {partnerTrackingCode(transaction.caseNumber, transaction.trackingNumber)} · قرارداد {transaction.customerContractNumber}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {transaction.debtDelta !== '0' && <ErpBadge tone="warning">تغییر بدهی: {formatPartnerMoney(transaction.debtDelta, selectedPoint.currency)}</ErpBadge>}
            {transaction.receivableDelta !== '0' && <ErpBadge tone="info">تغییر مطالبات: {formatPartnerMoney(transaction.receivableDelta, selectedPoint.currency)}</ErpBadge>}
            {transaction.receiptDelta !== '0' && <ErpBadge tone="success">دریافتی: {formatPartnerMoney(transaction.receiptDelta, selectedPoint.currency)}</ErpBadge>}
          </div>
          <div className="mt-2 flex justify-end"><ErpButton label="مشاهده پرونده" variant="ghost" onClick={() => {
            const row = report.rows.find(item => item.caseId === transaction.caseId); if (row) onOpenCase(row);
          }} /></div>
        </ErpCard>) : <p className="text-sm text-[var(--sds-text-secondary)]">در این ماه تراکنشی ثبت نشده است.</p>}
      </div>}
    </ErpSheet>
  </div>;
}
