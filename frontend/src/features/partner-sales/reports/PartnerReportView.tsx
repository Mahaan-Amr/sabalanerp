'use client';

import React from 'react';
import type { CaseState } from '@sabalanerp/partner-sales-contracts';
import { ErpBadge, ErpButton, ErpCard, ErpFieldView, ErpMetricGrid, ErpWorkspacePage, type ErpAction } from '@/components/erp';
import { FaChartLine, FaDownload, FaFileInvoiceDollar, FaWallet } from 'react-icons/fa';
import { formatPartnerMoney, partnerChartMagnitude, subtractPartnerDecimal } from '../presentation';
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

type Currency = 'IRR' | 'IRT';
type Metrics = { wholesalePurchases: string | null; retailSales: string | null; retailCollected: string | null; netComparableMargin: string | null };
/** UI-only presentation. The integration owner must create this from the approved strict transport. */
export type PartnerReportPresentation = {
  scopeLabel: string; from: string; effectiveThrough: string;
  totals: Array<{ currency: Currency; metrics: Metrics; accountingBalance: string | null; accountingReceivedAsOf: string | null; accountingCovered: number; accountingEligible: number }>;
  rows: Array<{ caseId: string; revision: number; caseNumber: string; customerContractNumber: string; state: CaseState; currency: Currency; metrics: Metrics;
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

function PartnerFinancialCharts({ currency, rows }: { currency: Currency; rows: PartnerReportRow[] }) {
  const points = rows.filter(row => row.currency === currency).map(row => ({ label: row.caseNumber,
    debt: partnerChartMagnitude(row.accountingBalance),
    receivable: partnerChartMagnitude(partnerReportReceivable(row.metrics.retailSales, row.metrics.retailCollected)),
    receipts: partnerChartMagnitude(row.metrics.retailCollected) }));
  const tick = (value: number) => value.toLocaleString('fa-IR');
  return <div className="grid gap-4 xl:grid-cols-2">
    <ErpCard className="p-4"><h3 className="mb-3 font-bold">نمودار مانده‌ها</h3>
      <div className="h-64" role="img" aria-label="مقایسه بدهی به سبلان و مطالبات مشتریان"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 256 }}>
        <LineChart data={points}><CartesianGrid stroke="var(--sds-border-subtle)" vertical={false} />
          <XAxis dataKey="label" /><YAxis tickFormatter={tick} /><Tooltip formatter={value => tick(Number(value ?? 0))} /><Legend />
          <Line dataKey="debt" name="بدهی به سبلان" stroke="var(--sds-warning)" strokeWidth={3} />
          <Line dataKey="receivable" name="مطالبات مشتری" stroke="var(--sds-accent)" strokeWidth={3} />
        </LineChart></ResponsiveContainer></div></ErpCard>
    <ErpCard className="p-4"><h3 className="mb-3 font-bold">نمودار دریافتی‌ها</h3>
      <div className="h-64" role="img" aria-label="دریافتی واقعی از مشتریان"><ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 420, height: 256 }}>
        <BarChart data={points}><CartesianGrid stroke="var(--sds-border-subtle)" vertical={false} />
          <XAxis dataKey="label" /><YAxis tickFormatter={tick} /><Tooltip formatter={value => tick(Number(value ?? 0))} />
          <Bar dataKey="receipts" name="دریافتی مشتری" fill="var(--sds-success)" radius={[8, 8, 0, 0]} />
        </BarChart></ResponsiveContainer></div></ErpCard>
  </div>;
}

export function PartnerReportContent({ report, onOpenCase }: { report: PartnerReportPresentation; onOpenCase: (row: PartnerReportRow) => void }) {
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
      <PartnerFinancialCharts currency={total.currency} rows={report.rows} />
    </section>; })}
    <div className="space-y-3">{report.rows.map(row => { const status = row.collectionStatus ? collectionCopy[row.collectionStatus] : null; return <ErpCard key={`${row.caseId}:${row.revision}`} className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>پرونده {row.caseNumber}</strong><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">قرارداد مشتری {row.customerContractNumber} · نسخه {row.revision.toLocaleString('fa-IR')}</p></div>
        <div className="flex flex-wrap gap-2">{status && <ErpBadge tone={status[1]}>{status[0]}</ErpBadge>}{row.history?.superseded && <ErpBadge tone="purple">نسخه جایگزین‌شده</ErpBadge>}{row.history?.cancelled && <ErpBadge tone="danger">لغوشده</ErpBadge>}</div></div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><ErpFieldView label="فروش retail" value={metricPresentation(row.metrics.retailSales, row.currency)} />
        <ErpFieldView label="وصول مشتری" value={metricPresentation(row.metrics.retailCollected, row.currency)} tone={row.metrics.retailCollected === null ? 'neutral' : 'success'} />
        <ErpFieldView label="خرید wholesale" value={metricPresentation(row.metrics.wholesalePurchases, row.currency)} />
        <ErpFieldView label="سود خالص قابل‌مقایسه" value={metricPresentation(row.metrics.netComparableMargin, row.currency)} tone={row.metrics.netComparableMargin === null ? 'neutral' : 'primary'} /></div>
      {row.history && <p className="mt-3 text-xs text-[var(--sds-text-muted)]">{row.history.receiptCount.toLocaleString('fa-IR')} رخداد وصول · {row.history.revisionCount.toLocaleString('fa-IR')} نسخه پرونده</p>}
      <div className="mt-3 flex justify-end"><ErpButton label="مشاهده پرونده" onClick={() => onOpenCase(row)} variant="ghost" /></div>
    </ErpCard>; })}</div>
  </div>;
}
