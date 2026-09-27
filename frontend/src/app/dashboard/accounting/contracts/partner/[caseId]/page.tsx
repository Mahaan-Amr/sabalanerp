'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { FaDownload, FaPrint, FaReceipt } from 'react-icons/fa';
import { partnerTrackingCode } from '@sabalanerp/partner-sales-contracts';
import { ErpButton, ErpFieldView, ErpInlineState, ErpLoading, ErpPage, ErpSection, ErpSegmentedControl, ErpSheet, ErpTextarea } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { invoiceStatusLabels, money, taxStatusLabels } from '@/features/accounting/accountingUi';
import { operationalStatusLabel } from '@/features/dispatch/operationalStatusPresentation';

type InternalDocument = {
  id: string; status: string; amount: string; currency: string; systemInvoiceNumber: string | null;
  partnerContext: { caseId: string; caseNumber: string; trackingNumber?: number; customerContractNumber: string;
    internalRecordNumber: string; debtor: { displayName: string }; endCustomer: { displayName: string } };
  items: Array<{ description: string; quantity: string; unitPrice: string; totalPrice: string }>;
  receivables: Array<{ status: string; paidAmount: string; remainingAmount: string; dueDate: string;
    payments: Array<{ amount: string; method: string; status: string; occurredAt: string | null }> }>;
  taxRecords: Array<{ readinessStatus: string; submissionStatus: string; taxableAmount: string; vatAmount: string }>;
  flags: Array<{ id: string; title: string; note: string | null; severity: string; status: string }>;
};

export default function PartnerInternalAccountingContractPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [document, setDocument] = useState<InternalDocument>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [flagTarget, setFlagTarget] = useState<InternalDocument['flags'][number]>();
  const [resolutionReason, setResolutionReason] = useState('');
  const [section, setSection] = useState<'summary' | 'items' | 'financial' | 'collections' | 'compliance'>('summary');
  const load = useCallback(async () => {
    try {
      const response = await accountingAPI.getPartnerInternalDocument(caseId);
      if (!response.data?.success || response.data.data?.partnerContext?.caseId !== caseId) throw new Error('Invalid document');
      setDocument(response.data.data as InternalDocument); setError(undefined);
    } catch { setError('سند داخلی این پرونده در دسترس نیست.'); }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);
  const pdf = async (print: boolean) => {
    if (!document || pending) return;
    setPending(true); setError(undefined);
    try {
      if (print) {
        const response = await accountingAPI.getPartnerInternalPdf(caseId);
        const url = response.data?.data?.url;
        if (!response.data?.success || !url) throw new Error('PDF URL missing');
        const opened = window.open(`${url}#page=1&zoom=page-fit`, '_blank', 'noopener,noreferrer');
        if (opened) opened.addEventListener('load', () => opened.print(), { once: true });
      } else {
        const response = await accountingAPI.downloadPartnerInternalPdf(caseId);
        downloadBlobResponse(response, `partner_internal_${document.partnerContext.internalRecordNumber}.pdf`);
      }
    } catch { setError(print ? 'چاپ سند داخلی انجام نشد.' : 'دریافت PDF سند داخلی انجام نشد.'); }
    finally { setPending(false); }
  };
  const resolveFlag = async () => {
    if (!flagTarget || !resolutionReason.trim() || pending) return;
    setPending(true); setError(undefined);
    try {
      await accountingAPI.resolvePartnerInternalFlag(caseId, flagTarget.id, resolutionReason.trim());
      setFlagTarget(undefined); setResolutionReason(''); await load();
    } catch { setError('رفع پرچم ثبت نشد. سند را تازه‌سازی و دوباره بررسی کنید.'); }
    finally { setPending(false); }
  };
  if (!document && !error) return <ErpLoading />;
  if (!document) return <ErpInlineState kind="error" title={error!}
    action={{ label: 'تلاش دوباره', onClick: () => void load() }} />;
  const context = document.partnerContext;
  return <ErpPage eyebrow="حسابداری" title={`پرونده حسابداری قرارداد ${context.customerContractNumber}`}
    description={`کد پیگیری ${partnerTrackingCode(context.caseNumber, context.trackingNumber)} · سند داخلی فروش سبلان به همکار`}
    backHref="/dashboard/accounting/contracts"
    actions={[
      { label: 'دریافت PDF سند داخلی', icon: FaDownload, onClick: () => void pdf(false) },
      { label: 'چاپ سند داخلی', icon: FaPrint, variant: 'outline', onClick: () => void pdf(true) },
      { label: 'دریافتنی', icon: FaReceipt, variant: 'outline',
        href: `/dashboard/accounting/receivables?search=${encodeURIComponent(context.caseNumber)}` },
    ]}>
    {error && <ErpInlineState kind="error" title={error} />}
    <ErpSegmentedControl value={section} onChange={setSection} options={[
      { value: 'summary', label: 'خلاصه' }, { value: 'items', label: 'اقلام' },
      { value: 'financial', label: 'رکوردهای مالی' }, { value: 'collections', label: 'دریافت‌ها' },
      { value: 'compliance', label: 'مالیات و اصلاحات' },
    ]} />
    {section === 'summary' && <ErpSection title="خلاصه قرارداد">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <ErpFieldView label="نام مشتری نهایی" value={context.endCustomer.displayName} />
        <ErpFieldView label="طرف‌حساب سبلان" value={context.debtor.displayName} />
        <ErpFieldView label="شماره قرارداد مشتری" value={context.customerContractNumber} />
        <ErpFieldView label="سند داخلی" value={context.internalRecordNumber} />
        <ErpFieldView label="مبلغ خرید از سبلان" value={money(document.amount, document.currency)} />
        <ErpFieldView label="شماره صورتحساب سیستمی" value={document.systemInvoiceNumber || 'ثبت نشده'} />
      </div>
    </ErpSection>}
    {section === 'items' && <ErpSection title="اقلام سند داخلی">
      {!document.items.length ? <p className="sds-text-secondary">ریز اقلام در این سند مالی ثبت نشده است.</p>
        : <div className="space-y-3">{document.items.map((item, index) =>
          <div key={index} className="sds-border-default rounded-xl border p-3">
            <strong>{item.description}</strong>
            <p className="sds-text-secondary mt-1 text-sm">مقدار {item.quantity} · نرخ {money(item.unitPrice, document.currency)}
              {' · '}جمع {money(item.totalPrice, document.currency)}</p>
          </div>)}</div>}
    </ErpSection>}
    {section === 'financial' && <ErpSection title="رکوردهای مالی">
      <div className="grid gap-3 sm:grid-cols-3">
        <ErpFieldView label="شماره صورتحساب" value={document.systemInvoiceNumber || 'ثبت نشده'} />
        <ErpFieldView label="وضعیت رکورد" value={invoiceStatusLabels[document.status] || operationalStatusLabel(document.status)} />
        <ErpFieldView label="مبلغ خرید از سبلان" value={money(document.amount, document.currency)} />
      </div>
    </ErpSection>}
    {section === 'collections' && <ErpSection title="دریافتنی‌ها و دریافت‌ها">
      {!document.receivables.length ? <p className="sds-text-secondary">دریافتنی ثبت نشده است.</p>
        : <div className="space-y-3">{document.receivables.map((item, index) =>
          <div key={index} className="sds-border-default rounded-xl border p-3">
            <ErpFieldView label="مانده" value={money(item.remainingAmount, document.currency)} />
            <p className="sds-text-secondary mt-1 text-sm">دریافت‌شده: {money(item.paidAmount, document.currency)}</p>
            {item.payments.map((payment, paymentIndex) => <p key={paymentIndex} className="sds-text-secondary mt-1 text-sm">
              دریافت {money(payment.amount, document.currency)} · {operationalStatusLabel(payment.method)} · {operationalStatusLabel(payment.status)}
            </p>)}
          </div>)}</div>}
    </ErpSection>}
    {section === 'compliance' && <ErpSection title="مالیات و اصلاحات">
      {document.flags?.map(flag => <div key={flag.id} className="sds-border-default mb-3 rounded-xl border p-3">
        <strong>{flag.title}</strong><p className="sds-text-secondary text-sm">{flag.note || 'بدون توضیح'} · {operationalStatusLabel(flag.status)}</p>
        {flag.status === 'OPEN' && <ErpButton label="رفع پس از بررسی اصلاح" variant="outline"
          disabled={pending} onClick={() => { setFlagTarget(flag); setResolutionReason(''); }} />}
      </div>)}
      {!document.taxRecords.length ? <p className="sds-text-secondary">رکورد مالیاتی ثبت نشده است.</p>
        : <div className="space-y-3">{document.taxRecords.map((item, index) =>
          <div key={index} className="sds-border-default rounded-xl border p-3">
            <ErpFieldView label="وضعیت مالیات" value={taxStatusLabels[item.readinessStatus] || operationalStatusLabel(item.readinessStatus)} />
            <ErpFieldView label="ارسال" value={taxStatusLabels[item.submissionStatus] || operationalStatusLabel(item.submissionStatus)} />
            <ErpFieldView label="مالیات ارزش افزوده" value={money(item.vatAmount, document.currency)} />
          </div>)}</div>}
    </ErpSection>}
    <ErpButton label="به‌روزرسانی" variant="outline" disabled={pending} onClick={() => void load()} />
    <ErpSheet open={Boolean(flagTarget)} onClose={() => { if (!pending) setFlagTarget(undefined); }}
      title="رفع پرچم حسابداری" presentation="modal" pending={pending}
      footer={<ErpButton label="ثبت رفع پرچم" disabled={pending || resolutionReason.trim().length < 3}
        onClick={() => void resolveFlag()} />}>
      <ErpTextarea aria-label="دلیل رفع پرچم" value={resolutionReason}
        onChange={event => setResolutionReason(event.target.value)} placeholder="نتیجهٔ بررسی و اصلاح را بنویسید" />
    </ErpSheet>
  </ErpPage>;
}
