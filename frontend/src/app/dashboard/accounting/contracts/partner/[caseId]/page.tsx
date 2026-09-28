'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpButton, ErpInlineState, ErpLoading, ErpSheet, ErpTextarea } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { defaultCustomPrintSettings, type SalesPdfVariant, type CustomPrintSettings, type CustomPrintPreset } from '@/features/accounting/AccountingCustomPrintSettings';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import type { FinancialInvoiceApprovalPayload } from '@/features/accounting/accountingUi';
import { PartnerAccountingDetailView, type PartnerInternalDocument as InternalDocument, type PartnerDetailSection } from '@/features/accounting/PartnerAccountingDetailView';

export default function PartnerInternalAccountingContractPage() {
  const { caseId } = useParams<{ caseId: string }>();
  const [document, setDocument] = useState<InternalDocument>();
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [flagTarget, setFlagTarget] = useState<InternalDocument['flags'][number]>();
  const [resolutionReason, setResolutionReason] = useState('');
  const [section, setSection] = useState<PartnerDetailSection>('summary');
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const openInvoice = () => { setSection('financial'); setInvoiceOpen(true); setError(undefined); };
  const approveInvoice = async (payload: FinancialInvoiceApprovalPayload) => {
    if (!document || pending || !document.actions.canReviewInvoice || payload.invoiceId !== document.id) return;
    setPending(true); setError(undefined);
    try {
      await accountingAPI.executeAction({ kind: 'APPROVE_FINANCIAL_INVOICE', ...payload });
      await load();
    } catch (failure) {
      const response = (failure as { response?: { data?: { error?: string; message?: string } } }).response?.data;
      setError(response?.message || response?.error || 'تأیید مالی ثبت نشد؛ وضعیت سند را بررسی و دوباره تلاش کنید.');
    } finally { setPending(false); }
  };
  const [printVariant, setPrintVariant] = useState<SalesPdfVariant>('accounting');
  const [customPrintSettings, setCustomPrintSettings] = useState<CustomPrintSettings>(defaultCustomPrintSettings);
  const applyCustomPreset = (preset: CustomPrintPreset) => setCustomPrintSettings(current => ({ ...current, preset,
    productRowsMode: preset === 'summarized' ? 'summarized' : 'detailed', showPrices: preset !== 'workshop',
    showPaymentSection: preset !== 'workshop', showTotals: preset !== 'workshop',
    columns: { ...current.columns, rate: preset !== 'workshop', total: preset !== 'workshop' } }));
  const [action, setAction] = useState<'flag' | 'correction'>();
  const [requestKey, setRequestKey] = useState('');
  const openAction = (kind: 'flag' | 'correction') => { setAction(kind); setRequestKey(crypto.randomUUID()); setError(undefined); };
  const submitAction = async (values: Record<string, string | number>) => {
    if (!action || pending) return;
    setPending(true); setError(undefined);
    try {
      if (action === 'correction') await accountingAPI.createPartnerInternalCorrectionRequest(caseId,
        { category: 'OTHER', priority: 'MEDIUM', reason: String(values.reason).trim() }, requestKey);
      else await accountingAPI.flagPartnerInternalRecord(caseId,
        { category: 'OTHER', severity: 'MEDIUM', title: String(values.title), note: String(values.reason).trim() });
      setAction(undefined); await load();
    } catch { setError('اقدام ثبت نشد؛ وضعیت پرونده را تازه‌سازی و دوباره بررسی کنید.'); }
    finally { setPending(false); }
  };
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
      const params: Record<string, string | boolean> = { variant: printVariant };
      if (printVariant === 'custom') {
        const { columns, ...sections } = customPrintSettings; Object.assign(params, sections);
        for (const [key, value] of Object.entries(columns)) params[`column_${key}`] = value;
      }
      if (print) {
        const response = await accountingAPI.getPartnerInternalPdf(caseId, params);
        const url = response.data?.data?.url;
        if (!response.data?.success || !url) throw new Error('PDF URL missing');
        const opened = window.open(`${url}#page=1&zoom=page-fit`, '_blank', 'noopener,noreferrer');
        if (opened) opened.addEventListener('load', () => opened.print(), { once: true });
        else window.location.href = `${url}#page=1&zoom=page-fit`;
      } else {
        const response = await accountingAPI.downloadPartnerInternalPdf(caseId, params);
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
  return <>
    <PartnerAccountingDetailView document={document} section={section} onSection={setSection}
      invoiceOpen={invoiceOpen} onOpenInvoice={openInvoice} onApproveInvoice={approveInvoice}
      printVariant={printVariant} onPrintVariant={setPrintVariant} customPrintSettings={customPrintSettings}
      setCustomPrintSettings={setCustomPrintSettings} applyCustomPreset={applyCustomPreset}
      pending={pending} error={action ? undefined : error} onRefresh={() => void load()} onPdf={print => void pdf(print)}
      onFlag={() => openAction('flag')} onCorrection={() => openAction('correction')}
      onResolve={flag => { setFlagTarget(flag); setResolutionReason(''); }} />
    <AccountingActionModal open={Boolean(action)} title={action === 'flag' ? 'پرچم حسابداری' : 'درخواست اصلاح سند داخلی'}
      fields={[...(action === 'flag' ? [{ id: 'title', label: 'عنوان', type: 'text' as const, required: true }] : []),
        { id: 'reason', label: 'توضیح و دلیل', type: 'textarea', required: true }]}
      busy={pending} error={error} onClose={() => { if (!pending) setAction(undefined); }} onSubmit={submitAction} />
    <ErpSheet open={Boolean(flagTarget)} onClose={() => { if (!pending) setFlagTarget(undefined); }}
      title="رفع پرچم حسابداری" presentation="modal" pending={pending}
      footer={<ErpButton label="ثبت رفع پرچم" disabled={pending || resolutionReason.trim().length < 3}
        onClick={() => void resolveFlag()} />}>
      <ErpTextarea aria-label="دلیل رفع پرچم" value={resolutionReason}
        onChange={event => setResolutionReason(event.target.value)} placeholder="نتیجهٔ بررسی و اصلاح را بنویسید" />
    </ErpSheet>
  </>;
}
