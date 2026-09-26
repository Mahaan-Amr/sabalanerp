import React from 'react';
import { ErpButton, ErpCard, ErpInlineState, ErpSection, ErpSummaryGrid } from '@/components/erp';
import {
  FinancialInvoiceApprovalForm,
  type FinancialInvoiceApprovalPayload,
  StatusBadge,
  dateFa,
  money,
} from './accountingUi';

type Payment = { id: string; amount: string; status: string; method: string; createdAt?: string };
type Receivable = { id: string; originalAmount: string; paidAmount: string; remainingAmount: string;
  status: string; paymentStatuses?: Payment[] };
type TaxRecord = { id: string; submissionStatus: string; vatAmount?: string | null };
type InvoiceItem = { id: string; description: string; quantity: string; totalPrice: string };
type AuditRow = { id: string; action: string; createdAt: string; note?: string | null };

export type FinancialRecordForReview = {
  id: string;
  sourceKind: string;
  status: string;
  amount: string;
  currency: string;
  createdAt: string;
  contractId?: string | null;
  contract?: { contractNumber?: string | null; customer?: { displayName?: string | null } | null } | null;
  partnerContext?: { caseNumber: string; internalRecordNumber: string; debtor: { displayName: string } } | null;
  systemInvoiceNumber?: string | null;
  systemInvoiceDate?: string | null;
  sepidarAmount?: string | null;
  metadata?: { mode?: string } | null;
  sourceSnapshot?: { partnerPreparation?: { evidenceHash?: string; products?: Array<{
    productRowId: string; description: string; quantity: string; unit: string }>; paymentPlan?: {
    installments?: Array<{ installmentId: string; amount: { amount: string; currency: string };
      dueDate: string; method: string }> } } } | null;
  invoiceItems?: InvoiceItem[];
  receivables?: Receivable[];
  taxRecords?: TaxRecord[];
};

const paymentMethodLabel: Record<string, string> = {
  CASH: 'نقدی', BANK_TRANSFER: 'واریز بانکی', CHECK: 'چک', CARD: 'کارت', OTHER: 'سایر',
};

const unitLabel: Record<string, string> = {
  m: 'متر', meter: 'متر', meters: 'متر', sqm: 'متر مربع', m2: 'متر مربع',
  square_meter: 'متر مربع', squaremeter: 'متر مربع',
  piece: 'عدد', pieces: 'عدد', physicalpiece: 'عدد', readypiece: 'عدد', pcs: 'عدد', count: 'عدد', number: 'عدد',
  kg: 'کیلوگرم', kilogram: 'کیلوگرم', ton: 'تن', tonne: 'تن',
};

const exactPersianDecimal = (value: string) => value.replace(/\d/g, digit => '۰۱۲۳۴۵۶۷۸۹'[Number(digit)]).replace('.', '٫');

const auditActionLabel: Record<string, string> = {
  CREATE_INVOICE: 'ایجاد پیش‌نویس صورتحساب',
  CREATE_REPLACEMENT_INVOICE: 'ایجاد پیش‌نویس جایگزین',
  APPROVE_FINANCIAL_INVOICE: 'تأیید مالی صورتحساب',
  CREATE_RECEIVABLE: 'ایجاد دریافتنی',
  REGISTER_RECEIPT: 'ثبت دریافت',
  REVERSE_RECEIPT: 'برگشت دریافت',
  START_ACCOUNTING_VOID_CASE: 'شروع پرونده ابطال',
  VOID_ACCOUNTING_RECORD: 'ابطال رکورد مالی',
};

export function AccountingFinancialRecordReview({ record, auditRows, auditTotal = auditRows.length, auditLoading = false,
  onLoadMoreAudit, canApprove, showAccountingDetails, busy = false,
  onApprove }: { record: FinancialRecordForReview; auditRows: AuditRow[]; auditTotal?: number; auditLoading?: boolean;
  onLoadMoreAudit?: () => void; canApprove: boolean;
  showAccountingDetails: boolean; busy?: boolean;
  onApprove: (payload: FinancialInvoiceApprovalPayload) => Promise<void> | void }) {
  const partner = record.sourceKind === 'PARTNER_INTERNAL_RECORD';
  const installments = record.sourceSnapshot?.partnerPreparation?.paymentPlan?.installments ?? [];
  const receivables = record.receivables ?? [];
  const paymentCount = receivables.reduce((count, receivable) => count +
    (receivable.paymentStatuses ?? []).filter(payment => ['RECEIVED', 'RECONCILED'].includes(payment.status)).length, 0);
  const outstandingLabel = receivables.length === 1
    ? money(receivables[0].remainingAmount, record.currency)
    : receivables.length > 1 ? 'مانده هر دریافتنی در پایین آمده است' : 'هنوز دریافتنی ثبت نشده';
  const approvalOpen = !['ISSUED', 'POSTED', 'VOIDED'].includes(record.status);

  return <div className="space-y-4">
    <ErpSection title="مبلغ و وضعیت">
      <ErpSummaryGrid columns={3} items={[
        { label: partner ? 'پرونده همکاری' : 'قرارداد', value: partner
          ? record.partnerContext?.caseNumber || '—' : record.contract?.contractNumber || '—' },
        { label: 'طرف حساب', value: partner
          ? record.partnerContext?.debtor.displayName || '—' : record.contract?.customer?.displayName || '—' },
        { label: 'مبلغ صورتحساب', value: money(record.amount, record.currency) },
        { label: 'وضعیت', value: <StatusBadge status={record.status} /> },
        { label: 'تاریخ ایجاد', value: dateFa(record.createdAt) },
        { label: 'مانده دریافتنی ثبت‌شده', value: outstandingLabel },
      ]} />
    </ErpSection>

    <ErpSection title="اقلام و مدرک منشأ">
      {record.invoiceItems?.length ? <div className="space-y-2">{record.invoiceItems.map((item) =>
        <ErpCard key={item.id} className="p-3">
          <p className="sds-text-primary font-semibold">{item.description}</p>
          <p className="sds-text-secondary text-sm">مقدار: {exactPersianDecimal(item.quantity)} · مبلغ: {money(item.totalPrice, record.currency)}</p>
        </ErpCard>)}</div> : partner && record.sourceSnapshot?.partnerPreparation?.products?.length
        ? <div className="space-y-2">{record.sourceSnapshot.partnerPreparation.products.map((item) =>
          <ErpCard key={item.productRowId} className="p-3">
            <p className="sds-text-primary font-semibold">{item.description}</p>
            <p className="sds-text-secondary text-sm">مقدار: {exactPersianDecimal(item.quantity)} {unitLabel[item.unit.toLowerCase()] || item.unit}</p>
          </ErpCard>)}</div> : partner && record.sourceSnapshot?.partnerPreparation
        ? <ErpInlineState kind="empty" title="در شاهد فروش داخلی قلمی ثبت نشده است." />
        : <ErpInlineState kind="empty" title="برای این رکورد قلم صورتحساب ثبت نشده است." />}
      {partner && !record.sourceSnapshot?.partnerPreparation &&
        <ErpInlineState kind="error" title="شاهد فروش داخلی در این رکورد در دسترس نیست؛ پیش از تأیید پرونده را بررسی کنید." />}
    </ErpSection>

    {installments.length > 0 && <ErpSection title="برنامه پرداخت به سبلان">
      <div className="space-y-2">{installments.map((installment) => <ErpCard key={installment.installmentId} className="p-3">
        <p className="sds-text-primary">سررسید {dateFa(installment.dueDate)} · {money(installment.amount.amount, installment.amount.currency)}</p>
        <p className="sds-text-secondary text-sm">روش: {paymentMethodLabel[installment.method] || 'سایر'}</p>
      </ErpCard>)}</div>
    </ErpSection>}

    <ErpSection title="دریافت‌ها و مانده">
      {receivables.length ? <div className="space-y-2">{receivables.map((receivable) => <ErpCard key={receivable.id} className="space-y-2 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusBadge status={receivable.status} />
          <span className="sds-text-primary font-semibold">مانده: {money(receivable.remainingAmount, record.currency)}</span>
        </div>
        <p className="sds-text-secondary text-sm">اصل: {money(receivable.originalAmount, record.currency)} · دریافت‌شده: {money(receivable.paidAmount, record.currency)}</p>
        {(receivable.paymentStatuses ?? []).map((payment) => <p key={payment.id} className="sds-text-secondary text-sm">
          {paymentMethodLabel[payment.method] || 'دریافت'} · {money(payment.amount, record.currency)} · <StatusBadge status={payment.status} />
        </p>)}
      </ErpCard>)}</div> : <ErpInlineState kind="empty" title="هنوز دریافتنی یا دریافت ثبت نشده است." />}
    </ErpSection>

    <ErpSection title="وضعیت مالیات">
      {record.taxRecords?.length ? record.taxRecords.map((tax) => <ErpCard key={tax.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
        <StatusBadge status={tax.submissionStatus} />
        <span className="sds-text-secondary text-sm">مالیات ثبت‌شده: {money(tax.vatAmount, record.currency)}</span>
      </ErpCard>) : <ErpInlineState kind="empty" title="سابقه مالیاتی برای این رکورد ثبت نشده است." />}
    </ErpSection>

    <ErpSection title="تاریخچه">
      {auditRows.length ? <div className="space-y-2">{auditRows.map((row) => <ErpCard key={row.id} className="p-3">
        <p className="sds-text-primary font-medium">{auditActionLabel[row.action] || 'رویداد حسابداری ثبت‌شده'}</p>
        <p className="sds-text-secondary text-sm">{dateFa(row.createdAt)}</p>
      </ErpCard>)}</div> : <ErpInlineState kind="empty" title="رویدادی در تاریخچه این رکورد پیدا نشد." />}
      {auditTotal > auditRows.length && <div className="mt-3 flex flex-wrap items-center gap-3">
        <p className="sds-text-secondary text-sm">{exactPersianDecimal(String(auditRows.length))} رویداد از {exactPersianDecimal(String(auditTotal))} رویداد نمایش داده شده است.</p>
        {onLoadMoreAudit && <ErpButton label="نمایش رویدادهای پیشین" onClick={onLoadMoreAudit} disabled={auditLoading} variant="outline" />}
      </div>}
    </ErpSection>

    {showAccountingDetails && <ErpSection title="جزئیات حسابداری">
      <ErpSummaryGrid columns={2} items={[
        { label: 'شناسه رکورد مالی', value: record.id },
        { label: 'شماره سند داخلی همکاری', value: partner ? record.partnerContext?.internalRecordNumber || '—' : '—' },
        { label: 'شماره فاکتور سیستمی', value: record.systemInvoiceNumber || 'ثبت نشده' },
        { label: 'تاریخ فاکتور سیستمی', value: dateFa(record.systemInvoiceDate) },
        { label: 'تعداد دریافت‌های ثبت‌شده', value: paymentCount.toLocaleString('fa-IR') },
        { label: 'اثر دفترکل رسمی', value: 'از اسناد قطعی دفترکل بررسی شود' },
      ]} />
    </ErpSection>}

    {canApprove && approvalOpen && <ErpSection title="تأیید مالی">
      <FinancialInvoiceApprovalForm invoice={record} busy={busy} onApprove={onApprove} />
    </ErpSection>}
  </div>;
}
