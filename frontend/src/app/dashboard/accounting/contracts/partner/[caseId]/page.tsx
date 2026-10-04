'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { ErpButton, ErpInlineState, ErpLoading, ErpSheet, ErpSummaryGrid, ErpTextarea } from '@/components/erp';
import api, { accountingAPI } from '@/lib/api';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { defaultCustomPrintSettings, type SalesPdfVariant, type CustomPrintSettings, type CustomPrintPreset } from '@/features/accounting/AccountingCustomPrintSettings';
import PartnerFinancialVoidPanel from '@/features/accounting/PartnerFinancialVoidPanel';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import { money, type FinancialInvoiceApprovalPayload } from '@/features/accounting/accountingUi';
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
  const openInvoice = async () => {
    if (!document?.actions.canCreateInvoice || pending) return;
    setError(undefined);
    if (document.preparationOnly) {
      if (!document.owner) return;
      setPending(true);
      try { await api.post('/partner/accounting/enqueue', document.owner); await load(); setSection('financial'); setInvoiceOpen(true); }
      catch { setError('ایجاد پیش‌نویس مالی انجام نشد؛ وضعیت قرارداد را تازه‌سازی کنید.'); }
      finally { setPending(false); }
    } else { setSection('financial'); setInvoiceOpen(true); }
  };
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
  const [receivableOpen, setReceivableOpen] = useState(false);
  const createReceivable = async () => {
    if (!document?.owner || pending || !document.actions.canCreateReceivable) return;
    setPending(true); setError(undefined);
    try {
      const response = await accountingAPI.createPartnerReceivable(document.id, document.owner);
      if (!response.data?.success) throw new Error('Receivable creation failed');
      setReceivableOpen(false); setSection('collections'); await load();
    } catch (failure) {
      const response = (failure as { response?: { data?: { error?: string; message?: string } } }).response?.data;
      setError(response?.message || response?.error || 'دریافتنی ثبت نشد؛ وضعیت صورتحساب را تازه‌سازی و دوباره بررسی کنید.');
    } finally { setPending(false); }
  };
  const [printVariant, setPrintVariant] = useState<SalesPdfVariant>('accounting');
  const [customPrintSettings, setCustomPrintSettings] = useState<CustomPrintSettings>(defaultCustomPrintSettings);
  const applyCustomPreset = (preset: CustomPrintPreset) => setCustomPrintSettings(current => ({ ...current, preset,
    productRowsMode: preset === 'summarized' ? 'summarized' : 'detailed', showPrices: preset !== 'workshop',
    showPaymentSection: preset !== 'workshop', showTotals: preset !== 'workshop',
    columns: { ...current.columns, rate: preset !== 'workshop', total: preset !== 'workshop' } }));
  const [action, setAction] = useState<'flag' | 'correction' | 'edit'>();
  const [requestKey, setRequestKey] = useState('');
  const openAction = (kind: 'flag' | 'correction' | 'edit') => { setAction(kind); setRequestKey(crypto.randomUUID()); setError(undefined); };
  const submitAction = async (values: Record<string, string | number>) => {
    if (!action || pending) return;
    setPending(true); setError(undefined);
    try {
      if (action === 'edit') await api.post(`/accounting/contracts/partner/${encodeURIComponent(caseId)}/edit-permission`, { reason: String(values.reason).trim() }, { headers: { 'X-Idempotency-Key': requestKey } });
      else if (action === 'correction') await accountingAPI.createPartnerInternalCorrectionRequest(caseId,
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
    <PartnerAccountingDetailView financialVoidPanel={<PartnerFinancialVoidPanel document={document} pending={pending} refresh={load} />} document={document} section={section} onSection={setSection}
      invoiceOpen={invoiceOpen} onOpenInvoice={openInvoice} onApproveInvoice={approveInvoice}
      onCreateReceivable={() => { setError(undefined); setReceivableOpen(true); }}
      printVariant={printVariant} onPrintVariant={setPrintVariant} customPrintSettings={customPrintSettings}
      setCustomPrintSettings={setCustomPrintSettings} applyCustomPreset={applyCustomPreset}
      pending={pending} error={action ? undefined : error} onRefresh={() => void load()} onPdf={print => void pdf(print)}
      onOpenEdit={() => openAction('edit')} onFlag={() => openAction('flag')} onCorrection={() => openAction('correction')}
      onResolve={flag => { setFlagTarget(flag); setResolutionReason(''); }} />
    <ErpSheet open={receivableOpen} onClose={() => { if (!pending) setReceivableOpen(false); }}
      title="ایجاد دریافتنی" presentation="modal" pending={pending}
      footer={<ErpButton label="تأیید و ایجاد دریافتنی" disabled={pending} onClick={() => void createReceivable()} />}>
      <ErpSummaryGrid items={[
        { label: 'طرف‌حساب سبلان', value: document.partnerContext.debtor.displayName },
        { label: 'صورتحساب', value: document.systemInvoiceNumber || '—' },
        { label: 'مبلغ دریافتنی', value: money(document.amount, document.currency) },
      ]} />
      {error && <ErpInlineState kind="error" title={error} />}
    </ErpSheet>
    <AccountingActionModal open={Boolean(action)} title={action === 'flag' ? 'پرچم حسابداری' : action === 'edit' ? 'بازکردن مجوز ویرایش و لغو قرارداد' : 'درخواست اصلاح سند داخلی'}
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
