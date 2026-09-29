'use client';
import React from 'react';
import { FaBalanceScale, FaFileInvoice, FaFlag, FaMoneyCheckAlt, FaReceipt, FaSync, FaTrashAlt, FaExclamationTriangle } from 'react-icons/fa';
import { partnerTrackingCode } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpCard, ErpInlineState, ErpPage, ErpSection, ErpSegmentedControl, ErpSummaryGrid, ErpTwoColumn } from '@/components/erp';
import { CompactQueueItem, FinancialInvoiceApprovalForm, type FinancialInvoiceApprovalPayload, StatusBadge, dateFa, invoiceStatusLabels, money, receivableStatusLabels, taxStatusLabels } from './accountingUi';
import { operationalStatusLabel } from '@/features/dispatch/operationalStatusPresentation';
import AccountingCustomPrintSettings, { defaultCustomPrintSettings, salesPdfVariantLabels, type SalesPdfVariant, type CustomPrintSettings, type CustomPrintPreset } from './AccountingCustomPrintSettings';
import AccountingContractPrintActions, { accountingContractTabs } from './AccountingContractPrintActions';

export type PartnerInternalDocument = {
  owner?: { caseId: string; revision: number; integrityHash: string };
  id: string; caseState?: string; status: string; amount: string; receivedAmount: string; remainingAmount: string;
  currency: string; systemInvoiceNumber: string | null; contractDate?: string; technicalEvidenceAvailable?: boolean;
  systemInvoiceDate?: string | null; sepidarAmount?: string | null; metadata?: { mode?: string };
  project?: { title?: string; address?: string };
  actions: { canCreateInvoice?: boolean; canResolveFlag: boolean; canFlag: boolean; canRequestCorrection: boolean; canReviewInvoice: boolean; canCreateReceivable: boolean };
  partnerContext: { caseId: string; caseNumber: string; trackingNumber?: number; customerContractNumber: string;
    internalRecordNumber: string; debtor: { displayName: string }; endCustomer: { displayName: string } };
  items: Array<{ productRowId?: string; description: string; quantity: string; unit: string; unitPrice: string; totalPrice: string; details?: string[] }>;
  totals?: { net: string; discount: string; tax: string; charges: string; payable: string };
  paymentPlan?: { installments: Array<{ installmentId: string; dueDate: string; amount: { amount: string; currency: string }; method: string }> };
  deliveries?: Array<{ deliveryId: string; date: string; destination: string; receiverName?: string; items: Array<{ productRowId: string; quantity: string }> }>;
  receivables: Array<{ id: string; status: string; paidAmount: string; remainingAmount: string; dueDate: string;
    payments: Array<{ id: string; amount: string; method: string; status: string; occurredAt: string | null }> }>;
  taxRecords: Array<{ id: string; readinessStatus: string; submissionStatus: string; taxableAmount: string; vatAmount: string }>;
  flags: Array<{ id: string; title: string; note: string | null; severity: string; status: string }>;
};
export type PartnerDetailSection = typeof accountingContractTabs[number]['value'];
export const partnerQuantityLabel = (unit: string) => ({ meter: 'متر طول', count: 'عدد', squareMeter: 'متر مربع', ton: 'تن' } as Record<string, string>)[unit] || unit;

export function PartnerAccountingDetailView({ document: doc, section, onSection, pending, error, onRefresh, onPdf, onFlag, onCorrection, onResolve, invoiceOpen = false, onOpenInvoice, onApproveInvoice, onCreateReceivable, printVariant = 'accounting', onPrintVariant, customPrintSettings = defaultCustomPrintSettings, setCustomPrintSettings, applyCustomPreset }: {
  onCreateReceivable?: () => void;
  invoiceOpen?: boolean; onOpenInvoice?: () => void; onApproveInvoice?: (payload: FinancialInvoiceApprovalPayload) => void | Promise<void>;
  printVariant?: SalesPdfVariant; onPrintVariant?: (value: SalesPdfVariant) => void; customPrintSettings?: CustomPrintSettings;
  setCustomPrintSettings?: React.Dispatch<React.SetStateAction<CustomPrintSettings>>; applyCustomPreset?: (preset: CustomPrintPreset) => void;
  document: PartnerInternalDocument; section: PartnerDetailSection; onSection: (value: PartnerDetailSection) => void;
  pending: boolean; error?: string; onRefresh: () => void; onPdf: (print: boolean) => void;
  onFlag: () => void; onCorrection: () => void; onResolve: (flag: PartnerInternalDocument['flags'][number]) => void;
}) {
  const context = doc.partnerContext;
  const issued = ['ISSUED', 'POSTED'].includes(doc.status);
  const receivableHref = `/dashboard/accounting/receivables?search=${encodeURIComponent(context.caseNumber)}`;
  const lifecycleReason = 'پرونده همکار قطعی است؛ تغییر آن از مسیر اصلاح یا ابطال بررسی‌شده انجام می‌شود.';
  const quickActions = <ErpSection title="اقدام سریع"><div className="space-y-2">
    <ErpButton label="ایجاد پیش‌نویس صورتحساب" icon={FaFileInvoice} tone="info" onClick={onOpenInvoice}
      disabled={pending || !doc.actions.canCreateInvoice || issued || doc.status === 'VOIDED'}
      title={issued ? 'صورتحساب صادر شده است.' : 'پیش‌نویس سند داخلی برای ثبت رکورد مالی باز می‌شود.'} />
    <ErpButton label="ایجاد دریافتنی" icon={FaReceipt} tone="success" onClick={onCreateReceivable}
      disabled={pending || !doc.actions.canCreateReceivable || !doc.owner || doc.receivables.length > 0 || !issued}
      title={doc.receivables.length ? 'دریافتنی موجود است؛ سند تکراری ایجاد نمی‌شود.' : !issued ? 'ابتدا صورتحساب را تأیید مالی کنید.' : 'دریافتنی با تأیید جداگانه برای این صورتحساب ایجاد می‌شود.'} />
    {doc.receivables.length > 0 && <ErpButton label="مشاهده دریافتنی" icon={FaReceipt} tone="success" variant="outline" href={receivableHref} />}
    <ErpButton label="پرچم حسابداری" icon={FaFlag} tone="warning" onClick={onFlag} disabled={pending || !doc.actions.canFlag} />
    <ErpButton label="درخواست اصلاح" icon={FaExclamationTriangle} tone="danger" onClick={onCorrection} disabled={pending || !doc.actions.canRequestCorrection} />
  </div></ErpSection>;
  const summary = <ErpSection title="خلاصه قرارداد"><ErpSummaryGrid columns={3} items={[
    { label: 'طرف‌حساب سبلان', value: context.debtor.displayName },
    { label: 'وضعیت قرارداد', value: <StatusBadge status={doc.caseState} label={doc.caseState === 'COMMITTED' ? 'قطعی' : operationalStatusLabel(doc.caseState || '')} /> },
    { label: 'وضعیت حسابداری', value: <StatusBadge status={doc.status} label={invoiceStatusLabels[doc.status] || operationalStatusLabel(doc.status)} /> },
    { label: 'صورتحساب', value: doc.systemInvoiceNumber || 'بدون صورتحساب رسمی' },
    { label: 'دریافتنی', value: doc.receivables.length ? 'دریافتنی ثبت شده' : 'بدون دریافتنی' },
    { label: 'مالیات', value: doc.taxRecords.length ? 'پرونده ثبت شده' : 'آماده نیست' },
    { label: 'مشتری نهایی مرتبط', value: context.endCustomer.displayName },
    { label: 'پروژه', value: doc.project?.title || 'ثبت نشده' },
    { label: 'نشانی پروژه', value: doc.project?.address || 'ثبت نشده' },
  ]} /></ErpSection>;
  return <ErpPage eyebrow="حسابداری" title={`پرونده حسابداری قرارداد ${context.customerContractNumber}`}
    description={`کد پیگیری ${partnerTrackingCode(context.caseNumber, context.trackingNumber)} · سند داخلی فروش سبلان به همکار`}
    backHref="/dashboard/accounting/contracts" actions={[{ label: 'به‌روزرسانی', icon: FaSync, variant: 'outline', disabled: pending, onClick: onRefresh }]}
    metrics={[
      { label: 'مبلغ قرارداد', value: money(doc.amount, doc.currency), icon: FaBalanceScale, tone: 'primary' },
      { label: 'صورتحساب شده', value: money(issued ? doc.amount : '0', doc.currency), icon: FaFileInvoice, tone: 'info' },
      { label: 'دریافت شده', value: money(doc.receivedAmount || '0', doc.currency), icon: FaReceipt, tone: 'success' },
      { label: 'مانده', value: money(doc.remainingAmount || doc.amount, doc.currency), icon: FaMoneyCheckAlt, tone: 'warning' },
    ]}>
    {error && <ErpInlineState kind="error" title={error} />}
    <ErpSegmentedControl value={section} onChange={onSection} options={[...accountingContractTabs]} />
    {section === 'summary' && <>
      <ErpSection title="مدیریت وضعیت قرارداد"><div className="flex flex-wrap gap-2">
        <ErpButton label="غیرفعال‌سازی" tone="warning" variant="outline" disabled title={lifecycleReason} />
        <ErpButton label="حذف دائمی" icon={FaTrashAlt} tone="danger" variant="outline" disabled title={lifecycleReason} />
      </div><ErpInlineState kind="permission" title={lifecycleReason} className="mt-3" />
        {doc.flags.filter(flag => flag.status === 'OPEN').map(flag => <ErpInlineState key={flag.id} kind="stale" title={flag.title} className="mt-3" />)}
      </ErpSection>
      <ErpSection title="خروجی چاپ قرارداد"><AccountingContractPrintActions value={printVariant} options={Object.entries(salesPdfVariantLabels).map(([value, label]) => ({ value, label }))}
        onChange={value => onPrintVariant?.(value as SalesPdfVariant)} pending={pending} onDownload={() => onPdf(false)} onPrint={() => onPdf(true)} />
        {printVariant === 'custom' && setCustomPrintSettings && applyCustomPreset && <AccountingCustomPrintSettings
          customPrintSettings={customPrintSettings} setCustomPrintSettings={setCustomPrintSettings} applyCustomPreset={applyCustomPreset} />}
      </ErpSection>
      <ErpTwoColumn main={summary} aside={quickActions} />
    </>}
    {section === 'items' && <ErpTwoColumn main={<ErpSection title="اقلام قرارداد">
      {doc.technicalEvidenceAvailable === false && <ErpInlineState kind="stale" title="جزئیات فنی نسخه قطعی در دسترس نیست." />}
      {!doc.items.length && <ErpInlineState kind="empty" title="ریز اقلام معتبر موجود نیست." />}
      <div className="space-y-3">{doc.items.map((item, index) => <div key={item.productRowId || index}>
        <CompactQueueItem icon={FaFileInvoice} title={item.description}
          meta={`مقدار: ${item.quantity} ${partnerQuantityLabel(item.unit)} · قیمت واحد: ${money(item.unitPrice, doc.currency)}`}
          amount={money(item.totalPrice, doc.currency)} />
        {item.details?.length ? <p className="mt-2 text-sm sds-text-secondary">{item.details.join(' · ')}</p> : null}
      </div>)}</div>
    </ErpSection>} aside={summary} />}
    {section === 'financial' && <ErpTwoColumn main={<ErpSection title="رکوردهای مالی">
      <CompactQueueItem icon={FaFileInvoice} title="صورتحساب قرارداد" meta={`شماره صورتحساب: ${doc.systemInvoiceNumber || 'ثبت نشده'}`}
        amount={money(doc.amount, doc.currency)} status={<StatusBadge status={doc.status} />}
        footer={invoiceOpen && onApproveInvoice ? <ErpCard className="p-3">
          <FinancialInvoiceApprovalForm invoice={{ id: doc.id, amount: doc.amount, status: doc.status,
            currency: doc.currency, sourceKind: 'PARTNER_INTERNAL_RECORD', systemInvoiceNumber: doc.systemInvoiceNumber,
            systemInvoiceDate: doc.systemInvoiceDate, sepidarAmount: doc.sepidarAmount, metadata: doc.metadata }}
            busy={pending || !doc.actions.canReviewInvoice} onApprove={onApproveInvoice} />
        </ErpCard> : undefined} />
      {doc.totals && <div className="mt-3"><ErpSummaryGrid items={[
        { label: 'جمع اقلام', value: money(doc.totals.net, doc.currency) }, { label: 'تخفیف', value: money(doc.totals.discount, doc.currency) },
        { label: 'مالیات', value: money(doc.totals.tax, doc.currency) }, { label: 'هزینه‌های جانبی', value: money(doc.totals.charges, doc.currency) },
      ]} /></div>}
    </ErpSection>} aside={quickActions} />}
    {section === 'collections' && <ErpTwoColumn main={<ErpSection title="دریافتنی‌ها و دریافت‌ها">
      {!doc.receivables.length && <ErpInlineState kind="empty" title="دریافتنی ثبت نشده است." />}
      <div className="grid gap-3 lg:grid-cols-2">{doc.receivables.map(item => <CompactQueueItem key={item.id} icon={FaReceipt} title="دریافتنی"
        meta={`سررسید: ${dateFa(item.dueDate)} · پرداخت شده: ${money(item.paidAmount, doc.currency)}`} amount={money(item.remainingAmount, doc.currency)}
        status={<StatusBadge status={item.status} label={receivableStatusLabels[item.status]} />} />)}
      {doc.receivables.flatMap(item => item.payments).map(payment => <CompactQueueItem key={payment.id} icon={FaMoneyCheckAlt} title="دریافت ثبت‌شده"
        meta={`${operationalStatusLabel(payment.method)} · ${payment.occurredAt ? dateFa(payment.occurredAt) : 'تاریخ ثبت نشده'}`} amount={money(payment.amount, doc.currency)} status={<StatusBadge status={payment.status} />} />)}</div>
      <h3 className="mt-4 font-semibold">برنامه پرداخت همکار به سبلان</h3>
      {!doc.paymentPlan?.installments.length ? <p className="sds-text-secondary">برنامه پرداخت به سبلان هنوز ثبت نشده است.</p> : doc.paymentPlan.installments.map(item => <CompactQueueItem key={item.installmentId}
        icon={FaReceipt} title={`سررسید: ${dateFa(item.dueDate)}`} meta={operationalStatusLabel(item.method)} amount={money(item.amount.amount, item.amount.currency)} />)}
    </ErpSection>} aside={quickActions} />}
    {section === 'compliance' && <ErpTwoColumn main={<ErpSection title="درخواست‌های اصلاح و پرچم‌ها">
      {!doc.flags.length && <ErpInlineState kind="empty" title="درخواست اصلاح یا پرچمی ثبت نشده است." />}
      {doc.flags.map(flag => <ErpCard key={flag.id} className="mb-3 p-3"><strong>{flag.title}</strong>
        <p className="mt-1 text-sm sds-text-secondary">{flag.note || 'بدون توضیح'}</p><StatusBadge status={flag.status} />
        {flag.status === 'OPEN' && doc.actions.canResolveFlag && <ErpButton label="رفع پس از بررسی اصلاح" variant="outline" disabled={pending} onClick={() => onResolve(flag)} />}
      </ErpCard>)}
    </ErpSection>} aside={<><ErpSection title="مالیات و سامانه مودیان">
      {!doc.taxRecords.length && <ErpInlineState kind="empty" title="پرونده مالیاتی هنوز ایجاد نشده است." />}
      {doc.taxRecords.map(item => <ErpSummaryGrid key={item.id} items={[
        { label: 'وضعیت مالیات', value: <StatusBadge status={item.readinessStatus} label={taxStatusLabels[item.readinessStatus]} /> },
        { label: 'ارسال', value: <StatusBadge status={item.submissionStatus} label={taxStatusLabels[item.submissionStatus]} /> },
        { label: 'مبلغ مشمول', value: money(item.taxableAmount, doc.currency) }, { label: 'ارزش افزوده', value: money(item.vatAmount, doc.currency) },
      ]} />)}
    </ErpSection>{quickActions}</>} />}
    {section === 'summary' && doc.deliveries?.length ? <ErpSection title="برنامه تحویل">
      {doc.deliveries.map(delivery => <ErpCard key={delivery.deliveryId} className="p-3"><strong>{dateFa(delivery.date)}</strong>
        <p className="sds-text-secondary">{delivery.destination} · {delivery.receiverName || 'گیرنده ثبت نشده'}</p>
        {delivery.items.map(line => <p key={line.productRowId} className="text-sm sds-text-secondary">{doc.items.find(item => item.productRowId === line.productRowId)?.description} · {line.quantity}</p>)}
      </ErpCard>)}
    </ErpSection> : null}
  </ErpPage>;
}
