'use client';
import { ErpInput, ErpSelect } from '@/components/erp';
import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FaBalanceScale,
  FaCheckCircle,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaFileInvoice,
  FaFlag,
  FaMoneyCheckAlt,
  FaPrint,
  FaReceipt,
  FaSync,
  FaTimes,
  FaTrashAlt,
} from 'react-icons/fa';
import {
  ErpButton,
  ErpInlineState,
  ErpLoading,
  ErpPage,
  ErpSection,
  ErpSummaryGrid,
  ErpTwoColumn,
} from '@/components/erp';
import { accountingAPI, dashboardAPI } from '@/lib/api';
import { downloadBlobResponse } from '@/lib/downloadFile';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import {
  CompactQueueItem,
  FinancialInvoiceApprovalForm,
  FinancialInvoiceApprovalPayload,
  StatusBadge,
  contractStatusLabels,
  dateFa,
  invoiceStatusLabels,
  money,
  receivableStatusLabels,
  sourceStatusLabels,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';

const toPdfViewerUrl = (url: string) => `${url}#page=1&zoom=page-fit`;

type SalesPdfVariant = 'original' | 'accounting' | 'workshop' | 'custom';
type CustomPrintPreset = 'accounting' | 'workshop' | 'detailed' | 'summarized';
type CustomProductRowsMode = 'detailed' | 'summarized';

type CustomPrintSettings = {
  preset: CustomPrintPreset;
  productRowsMode: CustomProductRowsMode;
  showCustomerSection: boolean;
  showProductsSection: boolean;
  showPrices: boolean;
  showExplanatoryRows: boolean;
  showDeliverySection: boolean;
  showPaymentSection: boolean;
  showTotals: boolean;
  showNotes: boolean;
  columns: {
    index: boolean;
    code: boolean;
    description: boolean;
    category: boolean;
    length: boolean;
    width: boolean;
    measurement: boolean;
    count: boolean;
    rate: boolean;
    total: boolean;
  };
};

const salesPdfVariantLabels: Record<SalesPdfVariant, string> = {
  original: 'چاپ نسخه اصلی',
  accounting: 'چاپ حسابداری',
  workshop: 'چاپ نمره کارگاه',
  custom: 'چاپ سفارشی',
};

const defaultCustomPrintSettings: CustomPrintSettings = {
  preset: 'accounting',
  productRowsMode: 'detailed',
  showCustomerSection: true,
  showProductsSection: true,
  showPrices: true,
  showExplanatoryRows: true,
  showDeliverySection: true,
  showPaymentSection: true,
  showTotals: true,
  showNotes: true,
  columns: {
    index: true,
    code: true,
    description: true,
    category: true,
    length: true,
    width: true,
    measurement: true,
    count: true,
    rate: true,
    total: true,
  },
};

const formatLifecycleBlockers = (blockers: any[]) => blockers.map((item) => {
  const dependencies = (item.details || []).map((detail: any) =>
    [detail.kind, detail.reference || detail.id, detail.status].filter(Boolean).join(' / '),
  );
  return `${item.label} (${item.count})${dependencies.length ? `: ${dependencies.join('، ')}` : ''}`;
}).join('؛ ');

export default function AccountingContractDetailPage({ params }: { params: { contractId: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusKind = searchParams.get('focus') === 'receivable' || searchParams.get('focus') === 'check'
    ? searchParams.get('focus') as 'receivable' | 'check'
    : null;
  const focusedRecordId = (searchParams.get('recordId') || '').trim();
  const [data, setData] = useState<any>(null);
  const [lifecycle, setLifecycle] = useState<any>(null);
  const [userRole, setUserRole] = useState<string>('USER');
  const [lifecycleTarget, setLifecycleTarget] = useState<{
    action: 'DELETE' | 'DEACTIVATE' | 'REACTIVATE';
    mode: 'REQUEST' | 'DIRECT';
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [pdfActionLoading, setPdfActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [voidTarget, setVoidTarget] = useState<any | null>(null);
  const [replacementTarget, setReplacementTarget] = useState<any | null>(null);
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [flagModalOpen, setFlagModalOpen] = useState(false);
  const [flagCloseTarget, setFlagCloseTarget] = useState<{ item: any; mode: 'resolve' | 'cancel' } | null>(null);
  const [correctionModalOpen, setCorrectionModalOpen] = useState(false);
  const [salesPdfVariant, setSalesPdfVariant] = useState<SalesPdfVariant>('accounting');
  const [customPrintSettings, setCustomPrintSettings] = useState<CustomPrintSettings>(defaultCustomPrintSettings);
  const [collectionFocusState, setCollectionFocusState] = useState<'focused' | 'missing' | null>(null);
  const [highlightedCollectionId, setHighlightedCollectionId] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      setLoading(true);
      const [response, lifecycleResponse, profileResponse] = await Promise.all([
        accountingAPI.getContract(params.contractId),
        accountingAPI.getContractLifecycle(params.contractId),
        dashboardAPI.getProfile(),
      ]);
      if (response.data.success) setData(response.data.data);
      if (lifecycleResponse.data.success) setLifecycle(lifecycleResponse.data.data);
      if (profileResponse.data.success) setUserRole(profileResponse.data.data.role || 'USER');
    } catch (error) {
      console.error('Error loading accounting contract detail:', error);
    } finally {
      setLoading(false);
    }
  }, [params.contractId]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    if (!data || !focusKind || !focusedRecordId) {
      setCollectionFocusState(null);
      setHighlightedCollectionId(null);
      return;
    }
    const rows = focusKind === 'receivable' ? data.receivables || [] : data.paymentEvents || [];
    const target = rows.find((row: any) => row.id === focusedRecordId);
    if (!target) {
      setCollectionFocusState('missing');
      setHighlightedCollectionId(null);
      const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      document.getElementById('collections')?.scrollIntoView({ behavior, block: 'start' });
      return;
    }
    const domId = `collection-${focusKind}-${focusedRecordId}`;
    setCollectionFocusState('focused');
    setHighlightedCollectionId(domId);
    const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.requestAnimationFrame(() => document.getElementById(domId)?.scrollIntoView({ behavior, block: 'center' }));
    const timeout = window.setTimeout(() => setHighlightedCollectionId(null), 4000);
    return () => window.clearTimeout(timeout);
  }, [data, focusKind, focusedRecordId]);

  const execute = async (action: any) => {
    try {
      setActionError(null);
      setActionLoading(true);
      await accountingAPI.executeAction(action);
      await loadDetail();
      return true;
    } catch (error) {
      console.error('Accounting action failed:', error);
      setActionError((error as any)?.response?.data?.error || 'اقدام حسابداری انجام نشد');
      return false;
    } finally {
      setActionLoading(false);
    }
  };

  const submitLifecycle = async (values: Record<string, string | number>) => {
    if (!lifecycleTarget) return;
    const reason = String(values.reason || '').trim();
    try {
      setActionError(null);
      setActionLoading(true);
      if (lifecycleTarget.mode === 'DIRECT') {
        await accountingAPI.executeContractLifecycle(params.contractId, {
          action: lifecycleTarget.action,
          reason,
        });
      } else {
        await accountingAPI.requestContractLifecycle(params.contractId, {
          kind: lifecycleTarget.action,
          reason,
        });
      }
      setLifecycleTarget(null);
      if (lifecycleTarget.action === 'DELETE' && lifecycleTarget.mode === 'DIRECT') {
        router.push('/dashboard/accounting/contracts');
        return;
      }
      await loadDetail();
    } catch (error: any) {
      const blockers = error?.response?.data?.blockers || [];
      setActionError(blockers.length
        ? `اقدام متوقف شد: ${formatLifecycleBlockers(blockers)}`
        : error?.response?.data?.error || 'اقدام مدیریت وضعیت قرارداد انجام نشد');
    } finally {
      setActionLoading(false);
    }
  };

  const decideLifecycle = async (requestId: string, decision: 'APPROVE' | 'REJECT') => {
    try {
      setActionLoading(true);
      setActionError(null);
      await accountingAPI.decideContractLifecycleRequest(requestId, {
        decision,
        reason: decision === 'REJECT' ? 'درخواست مدیریت وضعیت رد شد' : undefined,
      });
      await loadDetail();
    } catch (error: any) {
      const blockers = error?.response?.data?.blockers || [];
      setActionError(blockers.length
        ? `اقدام متوقف شد: ${formatLifecycleBlockers(blockers)}`
        : error?.response?.data?.error || 'تصمیم درخواست ثبت نشد');
    } finally {
      setActionLoading(false);
    }
  };

  const approveFinancialInvoice = (payload: FinancialInvoiceApprovalPayload) => {
    execute({
      kind: 'APPROVE_FINANCIAL_INVOICE',
      invoiceId: payload.invoiceId,
      systemInvoiceNumber: payload.systemInvoiceNumber,
      systemInvoiceDate: payload.systemInvoiceDate,
      sepidarAmount: payload.sepidarAmount,
    });
  };

  const deleteDraftRecord = async (values: Record<string, string | number>) => {
    if (!deleteTarget) return;
    const applied = await execute({
      kind: 'DELETE_DRAFT_ACCOUNTING_RECORD',
      recordId: deleteTarget.id,
      note: String(values.note || 'Deleted draft from accounting contract detail'),
    });
    if (applied) setDeleteTarget(null);
  };

  const voidAccountingRecord = async (values: Record<string, string | number>) => {
    if (!voidTarget) return;
    const applied = await execute({
      kind: 'VOID_ACCOUNTING_RECORD',
      recordId: voidTarget.sourceRecordId,
      reason: String(values.note || '').trim(),
      note: String(values.note || '').trim(),
      externalReference: String(values.externalReference || '').trim(),
      downstreamNote: String(values.downstreamNote || '').trim() || undefined,
    });
    if (applied) setVoidTarget(null);
  };

  const createReplacementInvoice = async (values: Record<string, string | number>) => {
    if (!replacementTarget) return;
    const applied = await execute({
      kind: 'CREATE_REPLACEMENT_INVOICE',
      contractId: params.contractId,
      correctionRequestId: replacementTarget.correctionRequestId,
      replacesRecordId: replacementTarget.sourceRecordId,
      note: String(values.note || '').trim() || undefined,
      idempotencyKey: `replacement-invoice:${params.contractId}:${replacementTarget.correctionRequestId}`,
    });
    if (applied) setReplacementTarget(null);
  };

  const resolveCorrection = async (values: Record<string, string | number>) => {
    if (!resolveTarget) return;
    const applied = await execute({
      kind: 'RESOLVE_CORRECTION',
      correctionRequestId: resolveTarget.id,
      resolutionNote: String(values.resolutionNote || '').trim() || undefined,
    });
    if (applied) setResolveTarget(null);
  };

  const flagContract = async (values: Record<string, string | number>) => {
    const note = String(values.note || '').trim();
    if (!note) return;
    const applied = await execute({
      kind: 'FLAG_CONTRACT',
      contractId: params.contractId,
      category: values.category || 'OTHER',
      severity: values.severity || 'MEDIUM',
      title: String(values.title || 'نیازمند بررسی حسابداری'),
      note,
    });
    if (applied) setFlagModalOpen(false);
  };

  const closeFlag = async (values: Record<string, string | number>) => {
    if (!flagCloseTarget) return;
    const note = String(values.note || '').trim();
    if (!note) return;
    const applied = await execute({
      kind: flagCloseTarget.mode === 'resolve' ? 'RESOLVE_CONTRACT_FLAG' : 'CANCEL_CONTRACT_FLAG',
      flagId: flagCloseTarget.item.id,
      ...(flagCloseTarget.mode === 'resolve' ? { resolutionNote: note } : { reason: note }),
    });
    if (applied) setFlagCloseTarget(null);
  };

  const requestCorrection = async (values: Record<string, string | number>) => {
    const reason = String(values.reason || '').trim();
    if (!reason) return;
    const applied = await execute({
      kind: 'REQUEST_CORRECTION',
      contractId: params.contractId,
      category: values.category || 'OTHER',
      priority: values.priority || 'MEDIUM',
      reason,
    });
    if (applied) setCorrectionModalOpen(false);
  };

  const openPdfUrl = (url: string, tryPrint: boolean) => {
    const viewerUrl = toPdfViewerUrl(url);
    const pdfWindow = window.open(viewerUrl, '_blank', 'noopener,noreferrer');
    if (!pdfWindow) {
      window.location.href = viewerUrl;
      return;
    }

    if (!tryPrint) return;

    const triggerPrint = () => {
      try {
        pdfWindow.focus();
        pdfWindow.print();
      } catch (error) {
        console.error('Print trigger failed:', error);
      }
    };

    try {
      pdfWindow.addEventListener('load', triggerPrint, { once: true });
      setTimeout(triggerPrint, 1200);
    } catch (error) {
      console.error('Print setup failed:', error);
    }
  };

  const applyCustomPreset = (preset: CustomPrintPreset) => {
    setCustomPrintSettings((current) => {
      const next: CustomPrintSettings = {
        ...current,
        preset,
        productRowsMode: preset === 'summarized' ? 'summarized' : 'detailed',
      };

      if (preset === 'workshop') {
        return {
          ...next,
          showPrices: false,
          showPaymentSection: false,
          showTotals: false,
          columns: {
            ...next.columns,
            rate: false,
            total: false,
          },
        };
      }

      return {
        ...next,
        showPrices: true,
        showPaymentSection: true,
        showTotals: true,
        columns: {
          ...next.columns,
          rate: true,
          total: true,
        },
      };
    });
  };

  const buildCustomPrintParams = () => {
    if (salesPdfVariant !== 'custom') return {};
    const params: Record<string, any> = {
      preset: customPrintSettings.preset,
      productRowsMode: customPrintSettings.productRowsMode,
      showCustomerSection: customPrintSettings.showCustomerSection,
      showProductsSection: customPrintSettings.showProductsSection,
      showPrices: customPrintSettings.showPrices,
      showExplanatoryRows: customPrintSettings.showExplanatoryRows,
      showDeliverySection: customPrintSettings.showDeliverySection,
      showPaymentSection: customPrintSettings.showPaymentSection,
      showTotals: customPrintSettings.showTotals,
      showNotes: customPrintSettings.showNotes,
    };

    Object.entries(customPrintSettings.columns).forEach(([key, value]) => {
      params[`column_${key}`] = value;
    });

    return params;
  };

  const openSalesContractPdf = async (tryPrint = false) => {
    const actionKey = tryPrint ? 'PRINT_SALES_PDF' : 'DOWNLOAD_SALES_PDF';
    setPdfActionLoading(actionKey);
    try {
      const pdfParams = { fresh: true, variant: salesPdfVariant, ...buildCustomPrintParams() };
      if (!tryPrint) {
        const response = await accountingAPI.downloadSalesContractPdf(params.contractId, pdfParams);
        downloadBlobResponse(response, `sales_contract_${params.contractId}_${salesPdfVariant}.pdf`);
        return;
      }

      const response = await accountingAPI.getSalesContractPdf(params.contractId, pdfParams);
      const url = response.data?.data?.url;
      if (!response.data?.success || !url) throw new Error('Sales contract PDF url was not returned');
      openPdfUrl(url, tryPrint);
    } catch (error) {
      console.error('Sales contract PDF failed:', error);
      setActionError(tryPrint ? 'پرینت قرارداد انجام نشد' : 'دانلود PDF قرارداد انجام نشد');
    } finally {
      setPdfActionLoading(null);
    }
  };

  if (loading) return <ErpLoading />;
  if (!data?.contract) {
    return (
      <ErpPage eyebrow="حسابداری" title="قرارداد یافت نشد" backHref="/dashboard/accounting/contracts">
        <ErpSection>این قرارداد در رجیستر حسابداری پیدا نشد.</ErpSection>
      </ErpPage>
    );
  }

  const contract = data.contract;
  const source = data.sourceSnapshot;
  const canCreateRecords = contract.accounting.eligibleForFinancialRecords;
  const replacementWorkflow = data.replacementWorkflow;
  const replacementRecord = replacementWorkflow?.replacementRecordId
    ? (data.financialRecords || []).find((record: any) => record.id === replacementWorkflow.replacementRecordId)
    : null;

  return (
    <ErpPage
      eyebrow="حسابداری"
      title={`پرونده حسابداری قرارداد ${contract.contractNumber}`}
      description="نمای عملیاتی حسابداری از قرارداد، بدون تغییر دادن اصل قرارداد فروش."
      backHref="/dashboard/accounting/contracts"
      actions={[
        { label: 'به‌روزرسانی', icon: FaSync, onClick: loadDetail, tone: 'neutral' },
      ]}
      metrics={[
        { label: 'مبلغ قرارداد', value: money(contract.accounting.totalContractAmount), icon: FaBalanceScale, tone: 'primary' },
        { label: 'صورتحساب شده', value: money(contract.accounting.invoicedAmount), icon: FaFileInvoice, tone: 'info' },
        { label: 'دریافت شده', value: money(contract.accounting.receivedAmount), icon: FaReceipt, tone: 'success' },
        { label: 'مانده', value: money(contract.accounting.remainingAmount), icon: FaMoneyCheckAlt, tone: contract.accounting.receivableStatus === 'OVERDUE' ? 'danger' : 'warning' },
      ]}
    >
      {actionError && !deleteTarget && !voidTarget && !replacementTarget && !resolveTarget && !flagModalOpen && !correctionModalOpen && (
        <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] px-4 py-3 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
          {actionError}
        </div>
      )}
      <ErpSection title="مدیریت وضعیت قرارداد">
        {contract.isInactive && (
          <ErpInlineState kind="stale" title={`قرارداد غیرفعال است${contract.inactiveReason ? ` — ${contract.inactiveReason}` : ''}`} className="mb-3" />
        )}
        <div className="flex flex-wrap gap-2">
          {!contract.isInactive && (
            <ErpButton
              label={userRole === 'ADMIN' || userRole === 'MANAGER' ? 'غیرفعال‌سازی' : 'درخواست غیرفعال‌سازی'}
              tone="warning"
              variant="outline"
              onClick={() => setLifecycleTarget({ action: 'DEACTIVATE', mode: userRole === 'ADMIN' || userRole === 'MANAGER' ? 'DIRECT' : 'REQUEST' })}
            />
          )}
          {contract.isInactive && (
            <ErpButton
              label={userRole === 'ADMIN' ? 'فعال‌سازی مجدد' : 'درخواست فعال‌سازی مجدد'}
              tone="success"
              variant="outline"
              onClick={() => setLifecycleTarget({ action: 'REACTIVATE', mode: userRole === 'ADMIN' ? 'DIRECT' : 'REQUEST' })}
            />
          )}
          {['DRAFT', 'CANCELLED'].includes(contract.status) && (
            <ErpButton
              label={userRole === 'ADMIN' ? 'حذف دائمی' : 'درخواست حذف دائمی'}
              icon={FaTrashAlt}
              tone="danger"
              variant="outline"
              onClick={() => setLifecycleTarget({ action: 'DELETE', mode: userRole === 'ADMIN' ? 'DIRECT' : 'REQUEST' })}
            />
          )}
        </div>
        {lifecycle && (
          <div className="mt-3 space-y-2">
            {[
              ...(contract.isInactive ? [] : lifecycle.deactivationEligibility?.blockers || []),
              ...(['DRAFT', 'CANCELLED'].includes(contract.status) ? lifecycle.deleteEligibility?.blockers || [] : []),
            ].map((blocker: any) => (
              <ErpInlineState key={blocker.code} kind="stale" title={`${blocker.label}: ${Number(blocker.count).toLocaleString('fa-IR')}`} />
            ))}
          </div>
        )}
        {(data.lifecycleRequests || []).filter((request: any) => request.status === 'PENDING').map((request: any) => {
          const canDecide = userRole === 'ADMIN' || (userRole === 'MANAGER' && request.kind === 'DEACTIVATE');
          return (
            <div key={request.id} className="mt-3 rounded-[var(--sds-radius-lg)] border border-[var(--sds-border-default)] p-3">
              <p className="font-semibold">درخواست {request.kind === 'DELETE' ? 'حذف دائمی' : request.kind === 'DEACTIVATE' ? 'غیرفعال‌سازی' : 'فعال‌سازی مجدد'}</p>
              <p className="mt-1 text-sm sds-text-secondary">{request.reason}</p>
              {canDecide && <div className="mt-3 flex gap-2"><ErpButton label="تأیید" tone="success" onClick={() => void decideLifecycle(request.id, 'APPROVE')} disabled={actionLoading} /><ErpButton label="رد" tone="danger" variant="outline" onClick={() => void decideLifecycle(request.id, 'REJECT')} disabled={actionLoading} /></div>}
            </div>
          );
        })}
      </ErpSection>
      <ErpSection title="خروجی چاپ قرارداد" description="نسخه مورد نیاز حسابداری را انتخاب کنید و سپس چاپ یا دانلود بگیرید.">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
            نسخه چاپ
            <ErpSelect
              value={salesPdfVariant}
              onChange={(event) => setSalesPdfVariant(event.target.value as SalesPdfVariant)}
              className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] shadow-sm outline-none transition focus:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
            >
              <option value="original">{salesPdfVariantLabels.original}</option>
              <option value="accounting">{salesPdfVariantLabels.accounting}</option>
              <option value="workshop">{salesPdfVariantLabels.workshop}</option>
              <option value="custom">{salesPdfVariantLabels.custom}</option>
            </ErpSelect>
          </label>
          <div className="flex flex-wrap gap-2">
            <ErpButton
              label="دانلود PDF"
              icon={FaDownload}
              tone="success"
              disabled={pdfActionLoading === 'DOWNLOAD_SALES_PDF'}
              onClick={() => openSalesContractPdf(false)}
            />
            <ErpButton
              label="چاپ"
              icon={FaPrint}
              tone="purple"
              disabled={pdfActionLoading === 'PRINT_SALES_PDF'}
              onClick={() => openSalesContractPdf(true)}
            />
          </div>
        </div>
        {salesPdfVariant === 'custom' && (
          <div className="mt-4 space-y-4 rounded-xl border border-dashed border-[var(--sds-border-strong)] bg-[var(--sds-accent-surface)] p-4 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-accent-surface)]">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                الگوی چاپ
                <ErpSelect
                  value={customPrintSettings.preset}
                  onChange={(event) => applyCustomPreset(event.target.value as CustomPrintPreset)}
                  className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] shadow-sm outline-none transition focus:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
                >
                  <option value="accounting">حسابداری</option>
                  <option value="workshop">کارگاه بدون قیمت</option>
                  <option value="detailed">جزئیات کامل</option>
                  <option value="summarized">خلاصه گروه‌بندی‌شده افزونه‌ها</option>
                </ErpSelect>
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                نمایش محصولات
                <ErpSelect
                  value={customPrintSettings.productRowsMode}
                  onChange={(event) => setCustomPrintSettings((current) => ({
                    ...current,
                    productRowsMode: event.target.value as CustomProductRowsMode,
                  }))}
                  className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] shadow-sm outline-none transition focus:border-[var(--sds-border-strong)] focus:ring-2 focus:ring-[var(--sds-focus-ring)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]"
                >
                  <option value="detailed">جزئیات کامل</option>
                  <option value="summarized">ردیف‌های خلاصه افزونه‌ها</option>
                </ErpSelect>
              </label>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">بخش‌ها</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['showCustomerSection', 'مشخصات مشتری'],
                  ['showProductsSection', 'جدول محصولات'],
                  ['showPrices', 'قیمت‌ها'],
                  ['showExplanatoryRows', 'ردیف‌های توضیحی'],
                  ['showDeliverySection', 'برنامه تحویل'],
                  ['showPaymentSection', 'برنامه پرداخت'],
                  ['showTotals', 'جمع‌ها و تخفیف'],
                  ['showNotes', 'توضیحات'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]">
                    <ErpInput
                      type="checkbox"
                      checked={Boolean(customPrintSettings[key as keyof CustomPrintSettings])}
                      onChange={(event) => setCustomPrintSettings((current) => ({
                        ...current,
                        [key]: event.target.checked,
                      }))}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">ستون‌های جدول محصولات</p>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                {[
                  ['index', 'ردیف'],
                  ['code', 'کد'],
                  ['description', 'شرح'],
                  ['category', 'دسته'],
                  ['length', 'طول'],
                  ['width', 'عرض'],
                  ['measurement', 'متراژ/مقدار'],
                  ['count', 'تعداد'],
                  ['rate', 'نرخ'],
                  ['total', 'مبلغ کل'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] px-3 py-2 text-sm text-[var(--sds-text-primary)] dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-text-primary)]">
                    <ErpInput
                      type="checkbox"
                      checked={customPrintSettings.columns[key as keyof CustomPrintSettings['columns']]}
                      onChange={(event) => setCustomPrintSettings((current) => ({
                        ...current,
                        columns: {
                          ...current.columns,
                          [key]: event.target.checked,
                        },
                      }))}
                      disabled={!customPrintSettings.showPrices && (key === 'rate' || key === 'total')}
                    />
                    {label}
                  </label>
                ))}
              </div>
            </div>
          </div>
        )}
      </ErpSection>

      <div className="accounting-print-view">
      <ErpTwoColumn
          main={
            <>
            <ErpSection title="خلاصه قرارداد">
              <ErpSummaryGrid
                columns={3}
                items={[
                  { label: 'مشتری', value: contract.customer.displayName },
                  { label: 'وضعیت قرارداد', value: <StatusBadge status={contract.status} label={contractStatusLabels[contract.status] || contract.status} /> },
                  { label: 'وضعیت حسابداری', value: <StatusBadge status={contract.accounting.sourceStatus} label={sourceStatusLabels[contract.accounting.sourceStatus] || contract.accounting.sourceStatus} /> },
                  { label: 'صورتحساب', value: invoiceStatusLabels[contract.accounting.invoiceStatus] || contract.accounting.invoiceStatus },
                  { label: 'دریافتنی', value: receivableStatusLabels[contract.accounting.receivableStatus] || contract.accounting.receivableStatus },
                  { label: 'مالیات', value: taxStatusLabels[contract.accounting.taxStatus] || contract.accounting.taxStatus },
                ]}
              />
            </ErpSection>

            {replacementWorkflow && (
              <ErpSection title="جایگزینی رکورد مالی">
                <div className="space-y-4">
                  <ErpSummaryGrid
                    columns={3}
                    items={[
                      { label: 'مبلغ رکورد قبلی', value: replacementWorkflow.oldAmount ? money(replacementWorkflow.oldAmount) : '-' },
                      { label: 'مبلغ اصلاح‌شده', value: money(replacementWorkflow.correctedAmount) },
                      { label: 'اثر مبلغی', value: replacementWorkflow.amountChanged ? 'دارد' : 'ندارد' },
                    ]}
                  />

                  {!replacementWorkflow.amountChanged ? (
                    <div className="rounded-lg border border-[var(--sds-success-border)] bg-[var(--sds-success-surface)] p-3 text-sm text-[var(--sds-success)] dark:border-[var(--sds-success-border)] dark:bg-[var(--sds-success-surface)] dark:text-[var(--sds-success)]">
                      مبلغ تایید شده با مبلغ اصلاح‌شده برابر است. پس از بررسی مدیریتی، اصلاح را با یادداشت بستن ثبت کنید.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid gap-3 lg:grid-cols-4">
                        <CompactQueueItem
                          icon={FaFileInvoice}
                          title="۱. ابطال رکورد قبلی"
                          meta={replacementWorkflow.sourceRecordStatus === 'VOIDED' ? 'انجام شده' : 'نیازمند شاهد خارجی'}
                          status={<StatusBadge status={replacementWorkflow.sourceRecordStatus} />}
                        />
                        <CompactQueueItem
                          icon={FaFileInvoice}
                          title="۲. پیش‌نویس جایگزین"
                          meta={replacementWorkflow.replacementRecordId ? 'ایجاد شده' : 'در انتظار'}
                          status={<StatusBadge status={replacementWorkflow.replacementRecordStatus || 'PENDING'} />}
                        />
                        <CompactQueueItem
                          icon={FaCheckCircle}
                          title="۳. تایید مالی جایگزین"
                          meta={replacementWorkflow.replacementFinanciallyApprovedAt ? dateFa(replacementWorkflow.replacementFinanciallyApprovedAt) : 'در انتظار'}
                          status={<StatusBadge status={replacementWorkflow.replacementFinanciallyApprovedAt ? 'ISSUED' : 'PENDING'} />}
                        />
                        <CompactQueueItem
                          icon={FaCheckCircle}
                          title="۴. بستن اصلاح"
                          meta={replacementWorkflow.canResolve ? 'آماده بستن' : 'ناتمام'}
                          status={<StatusBadge status={replacementWorkflow.canResolve ? 'READY' : 'NEEDS_CORRECTION'} />}
                        />
                      </div>

                      {replacementWorkflow.blockingReasons?.length > 0 && (
                        <div className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                          {replacementWorkflow.blockingReasons.join('، ')}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        <ErpButton
                          label="ابطال رکورد قبلی"
                          icon={FaExclamationTriangle}
                          tone="danger"
                          disabled={!replacementWorkflow.canVoidSource || actionLoading}
                          onClick={() => setVoidTarget(replacementWorkflow)}
                        />
                        <ErpButton
                          label="ایجاد پیش‌نویس جایگزین"
                          icon={FaFileInvoice}
                          tone="info"
                          disabled={!replacementWorkflow.canCreateReplacement || actionLoading}
                          onClick={() => setReplacementTarget(replacementWorkflow)}
                        />
                        <ErpButton
                          label="بستن اصلاح"
                          icon={FaCheckCircle}
                          tone="success"
                          disabled={!replacementWorkflow.canResolve || actionLoading}
                          onClick={() => setResolveTarget({ id: replacementWorkflow.correctionRequestId })}
                        />
                      </div>

                      {replacementWorkflow.canApproveReplacement && replacementRecord && (
                        <div className="rounded-lg border border-[var(--sds-border-default)] bg-[var(--sds-surface-subtle)] p-3 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
                          {actionError && (
                            <div className="mb-3 rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] px-3 py-2 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
                              {actionError}
                            </div>
                          )}
                          <FinancialInvoiceApprovalForm
                            invoice={replacementRecord}
                            busy={actionLoading}
                            onApprove={approveFinancialInvoice}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ErpSection>
            )}

            <ErpSection title="اقلام قرارداد" description="این اطلاعات از قرارداد فروش خوانده می‌شود و در رکوردهای حسابداری به صورت Snapshot نگهداری می‌شود.">
              <div className="space-y-3">
                {(source.items || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaFileInvoice}
                    title={item.productName}
                    meta={`مقدار: ${item.quantityPresentation?.status === 'RECONCILED'
                      ? `${item.quantityPresentation.quantity} متر`
                      : item.quantityPresentation?.status === 'REVIEW_REQUIRED'
                        ? 'نیازمند بررسی مقدار'
                        : item.quantity} · قیمت واحد: ${money(item.unitPrice)}`}
                    amount={money(item.totalPrice)}
                  />
                ))}
                {(!source.items || source.items.length === 0) && (
                  <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">قلمی برای قرارداد ثبت نشده است.</p>
                )}
              </div>
            </ErpSection>

            <ErpSection title="رکوردهای مالی">
              <div className="space-y-3">
                {(data.financialRecords || []).map((record: any) => (
                  <CompactQueueItem
                    key={record.id}
                    icon={FaFileInvoice}
                    title={record.kind}
                    meta={[
                      `ایجاد: ${dateFa(record.createdAt)}`,
                      record.systemInvoiceNumber ? `شماره فاکتور سیستمی: ${record.systemInvoiceNumber}` : null,
                      record.systemInvoiceDate ? `تاریخ فاکتور سیستمی: ${dateFa(record.systemInvoiceDate)}` : null,
                    ].filter(Boolean).join(' · ')}
                    amount={money(record.amount, record.currency)}
                    status={<StatusBadge status={record.status} />}
                    footer={record.kind === 'INVOICE_CANDIDATE' ? (
                      <div className="space-y-3">
                        {(contract.accounting.openCorrections > 0 || contract.accounting.openBlockerFlags > 0) && !['ISSUED', 'POSTED', 'VOIDED'].includes(record.status) ? (
                          <div className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-3 text-sm text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
                            ابتدا درخواست‌های اصلاح و پرچم‌های مسدودکننده باز را بررسی و ببندید؛ سپس تایید مالی انجام می‌شود.
                          </div>
                        ) : (
                          <FinancialInvoiceApprovalForm
                            invoice={record}
                            busy={actionLoading}
                            onApprove={approveFinancialInvoice}
                          />
                        )}
                        {record.status === 'DRAFT' && (
                          <div className="flex justify-end">
                            <ErpButton
                              label="حذف پیش‌نویس"
                              icon={FaTrashAlt}
                              tone="danger"
                              variant="outline"
                              disabled={actionLoading}
                              onClick={() => setDeleteTarget(record)}
                            />
                          </div>
                        )}
                      </div>
                    ) : undefined}
                  />
                ))}
                {(!data.financialRecords || data.financialRecords.length === 0) && (
                  <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">هنوز رکورد مالی برای این قرارداد ایجاد نشده است.</p>
                )}
              </div>
            </ErpSection>

            <div id="collections" className="scroll-mt-6">
            <ErpSection title="دریافتنی‌ها و دریافت‌ها">
              {collectionFocusState === 'missing' && (
                <ErpInlineState kind="stale" title="رکورد پیوندشده دیگر در این پرونده در دسترس نیست؛ اطلاعات فعلی قرارداد نمایش داده می‌شود." />
              )}
              {collectionFocusState === 'focused' && (
                <ErpInlineState kind="success" title="رکورد پیوندشده در وضعیت فعلی پرونده پیدا و متمرکز شد." />
              )}
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {(data.receivables || []).map((item: any) => (
                  <div
                    id={`collection-receivable-${item.id}`}
                    key={item.id}
                    className={`scroll-mt-24 rounded-[var(--sds-radius-lg)] transition ${highlightedCollectionId === `collection-receivable-${item.id}` ? 'ring-2 ring-[var(--sds-focus-ring)] shadow-[var(--sds-shadow-raised)]' : ''}`}
                  >
                  <CompactQueueItem
                    icon={FaReceipt}
                    title="دریافتنی"
                    meta={`سررسید: ${dateFa(item.dueDate)} · پرداخت شده: ${money(item.paidAmount, item.currency)}`}
                    amount={money(item.remainingAmount, item.currency)}
                    status={<StatusBadge status={item.status} />}
                  />
                  </div>
                ))}
                {(data.paymentEvents || []).map((item: any) => (
                  <div
                    id={`collection-check-${item.id}`}
                    key={item.id}
                    className={`scroll-mt-24 rounded-[var(--sds-radius-lg)] transition ${highlightedCollectionId === `collection-check-${item.id}` ? 'ring-2 ring-[var(--sds-focus-ring)] shadow-[var(--sds-shadow-raised)]' : ''}`}
                  >
                  <CompactQueueItem
                    icon={FaMoneyCheckAlt}
                    title={item.method === 'CHECK' ? `چک ${item.checkNumber || ''}` : 'دریافت'}
                    meta={`تاریخ: ${dateFa(item.occurredAt || item.createdAt)}`}
                    amount={money(item.amount, item.currency)}
                    status={<StatusBadge status={item.checkStatus || item.status} />}
                  />
                  </div>
                ))}
              </div>
            </ErpSection>
            </div>
            </>
          }
          aside={
            <>
            <ErpSection title="اقدام سریع">
              <div className="space-y-2">
                <ErpButton
                  label="ایجاد پیش‌نویس صورتحساب"
                  icon={FaFileInvoice}
                  tone="info"
                  disabled={!canCreateRecords || actionLoading}
                  title={contract.accounting.eligibilityReason}
                  onClick={() => execute({
                    kind: 'CREATE_INVOICE',
                    contractId: contract.contractId,
                    mode: 'FROM_CONTRACT_TOTAL',
                    issueDate: new Date().toISOString(),
                    idempotencyKey: `invoice-candidate:${contract.contractId}:full`,
                  })}
                />
                <ErpButton
                  label="ایجاد دریافتنی"
                  icon={FaReceipt}
                  tone="success"
                  disabled={!canCreateRecords || contract.accounting.invoiceStatus !== 'ISSUED' || actionLoading}
                  title={contract.accounting.eligibilityReason || (contract.accounting.invoiceStatus !== 'ISSUED' ? 'ابتدا صورتحساب را تایید مالی کنید' : undefined)}
                  onClick={() => execute({
                    kind: 'CREATE_RECEIVABLE',
                    contractId: contract.contractId,
                    amount: contract.accounting.remainingAmount || contract.accounting.totalContractAmount,
                    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
                    idempotencyKey: `receivable:${contract.contractId}:planned`,
                  })}
                />
                <ErpButton
                  label="پرچم حسابداری"
                  icon={FaFlag}
                  tone="warning"
                  disabled={actionLoading}
                  onClick={() => setFlagModalOpen(true)}
                />
                <ErpButton
                  label="درخواست اصلاح"
                  icon={FaExclamationTriangle}
                  tone="danger"
                  disabled={actionLoading}
                  onClick={() => setCorrectionModalOpen(true)}
                />
              </div>
            </ErpSection>

            <ErpSection title="مالیات و سامانه مودیان">
              <div className="space-y-3">
                {(data.tax || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaBalanceScale}
                    title={taxStatusLabels[item.submissionStatus] || item.submissionStatus}
                    meta={item.missingFields?.length ? `کسری: ${item.missingFields.join('، ')}` : item.trackingCode || 'بدون کد پیگیری'}
                    amount={money(item.taxableAmount)}
                    status={<StatusBadge status={item.submissionStatus} />}
                  />
                ))}
                {(!data.tax || data.tax.length === 0) && <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">پرونده مالیاتی هنوز ایجاد نشده است.</p>}
              </div>
            </ErpSection>

            <ErpSection title="درخواست‌های اصلاح و پرچم‌ها">
              <div className="space-y-3">
                {(data.flags || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaFlag}
                    title={item.title}
                    meta={item.resolutionNote || item.cancellationReason || item.note}
                    status={<StatusBadge status={item.status} />}
                    footer={item.status === 'OPEN' ? <div className="flex flex-wrap gap-2">
                      <ErpButton label="بستن پرچم" icon={FaCheckCircle} tone="success" variant="soft" onClick={() => setFlagCloseTarget({ item, mode: 'resolve' })} />
                      <ErpButton label="لغو پرچم" icon={FaTimes} tone="danger" variant="soft" onClick={() => setFlagCloseTarget({ item, mode: 'cancel' })} />
                    </div> : undefined}
                  />
                ))}
                {(data.correctionRequests || []).map((item: any) => (
                  <CompactQueueItem
                    key={item.id}
                    icon={FaExclamationTriangle}
                    title={item.accountantNote}
                    meta={`اولویت: ${item.priority}`}
                    status={<StatusBadge status={item.status} />}
                    footer={['APPROVED_FOR_SALES_EDIT', 'SALES_EDITED'].includes(item.status) ? (
                      <div className="flex flex-wrap gap-2">
                        {item.status === 'APPROVED_FOR_SALES_EDIT' && (
                          <ErpButton
                            label="اصلاح قرارداد"
                            href={`/dashboard/sales/contracts/${contract.contractId}/edit`}
                            icon={FaEdit}
                            tone="info"
                            variant="outline"
                          />
                        )}
                        {item.status === 'SALES_EDITED' && <ErpButton
                          label="بستن اصلاح"
                          icon={FaCheckCircle}
                          tone="success"
                          disabled={actionLoading || (replacementWorkflow?.correctionRequestId === item.id && !replacementWorkflow.canResolve)}
                          onClick={() => setResolveTarget(item)}
                        />}
                      </div>
                    ) : undefined}
                  />
                ))}
              </div>
            </ErpSection>
            </>
          }
        />
      </div>
      <AccountingActionModal
        open={Boolean(deleteTarget)}
        title="حذف پیش‌نویس رکورد مالی"
        description="فقط رکوردهای پیش‌نویس، تایید نشده و بدون رکورد پایین‌دستی حذف می‌شوند."
        fields={[{ id: 'note', label: 'یادداشت حذف', type: 'textarea', defaultValue: 'Deleted draft from accounting contract detail' }]}
        submitLabel="حذف پیش‌نویس"
        busy={actionLoading}
        error={actionError}
        onClose={() => setDeleteTarget(null)}
        onSubmit={deleteDraftRecord}
      />
      <AccountingActionModal
        open={Boolean(lifecycleTarget)}
        title={lifecycleTarget?.action === 'DELETE' ? 'حذف دائمی قرارداد' : lifecycleTarget?.action === 'DEACTIVATE' ? 'غیرفعال‌سازی قرارداد' : 'فعال‌سازی مجدد قرارداد'}
        description={lifecycleTarget?.action === 'DELETE' ? 'حذف دائمی برگشت‌پذیر نیست و فقط در نبود وابستگی مسدودکننده انجام می‌شود.' : undefined}
        fields={[{ id: 'reason', label: 'دلیل', type: 'textarea', required: true }]}
        submitLabel={lifecycleTarget?.mode === 'REQUEST' ? 'ثبت درخواست' : lifecycleTarget?.action === 'DELETE' ? 'حذف دائمی' : 'ثبت اقدام'}
        busy={actionLoading}
        error={actionError}
        onClose={() => setLifecycleTarget(null)}
        onSubmit={submitLifecycle}
      />
      <AccountingActionModal
        open={Boolean(voidTarget)}
        title="ابطال رکورد مالی قبلی"
        description="برای رکورد مالی تایید شده، دلیل ابطال و شاهد ابطال یا برگشت در سیستم خارجی الزامی است."
        fields={[
          { id: 'note', label: 'دلیل ابطال', type: 'textarea', required: true },
          { id: 'externalReference', label: 'شاهد ابطال/برگشت خارجی', type: 'text', required: true },
          { id: 'downstreamNote', label: 'یادداشت وابستگی‌های دریافتنی/مالیات', type: 'textarea' },
        ]}
        submitLabel="ابطال رکورد"
        busy={actionLoading}
        error={actionError}
        onClose={() => setVoidTarget(null)}
        onSubmit={voidAccountingRecord}
      />
      <AccountingActionModal
        open={Boolean(replacementTarget)}
        title="ایجاد پیش‌نویس جایگزین"
        description="پیش‌نویس جایگزین با مبلغ اصلاح‌شده قرارداد و پیوند به اصلاح جاری ساخته می‌شود."
        fields={[{ id: 'note', label: 'یادداشت جایگزینی', type: 'textarea' }]}
        submitLabel="ایجاد پیش‌نویس جایگزین"
        busy={actionLoading}
        error={actionError}
        onClose={() => setReplacementTarget(null)}
        onSubmit={createReplacementInvoice}
      />
      <AccountingActionModal
        open={Boolean(resolveTarget)}
        title="بستن درخواست اصلاح"
        description={resolveTarget?.accountantNote}
        fields={[{ id: 'resolutionNote', label: 'یادداشت بستن درخواست', type: 'textarea', required: true }]}
        submitLabel="بستن اصلاح"
        busy={actionLoading}
        error={actionError}
        onClose={() => setResolveTarget(null)}
        onSubmit={resolveCorrection}
      />
      <AccountingActionModal
        open={flagModalOpen}
        title="پرچم حسابداری"
        description={`${contract.contractNumber} - ${contract.customer.displayName}`}
        fields={[
          { id: 'title', label: 'عنوان پرچم', type: 'text', required: true, defaultValue: 'نیازمند بررسی حسابداری' },
          { id: 'category', label: 'دسته', type: 'select', defaultValue: 'OTHER', options: [
            { label: 'هویت مشتری', value: 'CUSTOMER_IDENTITY' },
            { label: 'مبلغ و قیمت', value: 'AMOUNT_PRICING' },
            { label: 'برنامه پرداخت', value: 'PAYMENT_PLAN' },
            { label: 'برنامه تحویل', value: 'DELIVERY_SCHEDULE' },
            { label: 'مالیات', value: 'TAX_INFO' },
            { label: 'اسناد و امضا', value: 'DOCUMENT_SIGNATURE' },
            { label: 'سایر', value: 'OTHER' },
          ] },
          { id: 'severity', label: 'شدت', type: 'select', defaultValue: 'MEDIUM', options: [
            { label: 'کم', value: 'LOW' },
            { label: 'متوسط', value: 'MEDIUM' },
            { label: 'زیاد', value: 'HIGH' },
            { label: 'مسدودکننده', value: 'BLOCKER' },
          ] },
          { id: 'note', label: 'یادداشت', type: 'textarea', required: true },
        ]}
        submitLabel="ثبت پرچم"
        busy={actionLoading}
        error={actionError}
        onClose={() => setFlagModalOpen(false)}
        onSubmit={flagContract}
      />
      <AccountingActionModal
        open={Boolean(flagCloseTarget)}
        title={flagCloseTarget?.mode === 'resolve' ? 'بستن پرچم' : 'لغو پرچم'}
        description={flagCloseTarget?.item?.title}
        fields={[{ id: 'note', label: flagCloseTarget?.mode === 'resolve' ? 'یادداشت نتیجه بررسی' : 'دلیل لغو', type: 'textarea', required: true }]}
        submitLabel={flagCloseTarget?.mode === 'resolve' ? 'بستن پرچم' : 'لغو پرچم'}
        busy={actionLoading}
        error={actionError}
        onClose={() => setFlagCloseTarget(null)}
        onSubmit={closeFlag}
      />
      <AccountingActionModal
        open={correctionModalOpen}
        title="درخواست اصلاح"
        description={`${contract.contractNumber} - ${contract.customer.displayName}`}
        fields={[
          { id: 'category', label: 'دسته اصلاح', type: 'select', defaultValue: 'OTHER', options: [
            { label: 'هویت مشتری', value: 'CUSTOMER_IDENTITY' },
            { label: 'مبلغ و قیمت', value: 'AMOUNT_PRICING' },
            { label: 'برنامه پرداخت', value: 'PAYMENT_PLAN' },
            { label: 'برنامه تحویل', value: 'DELIVERY_SCHEDULE' },
            { label: 'مالیات', value: 'TAX_INFO' },
            { label: 'اسناد و امضا', value: 'DOCUMENT_SIGNATURE' },
            { label: 'سایر', value: 'OTHER' },
          ] },
          { id: 'priority', label: 'اولویت', type: 'select', defaultValue: 'MEDIUM', options: [
            { label: 'کم', value: 'LOW' },
            { label: 'متوسط', value: 'MEDIUM' },
            { label: 'زیاد', value: 'HIGH' },
            { label: 'فوری', value: 'URGENT' },
          ] },
          { id: 'reason', label: 'متن درخواست اصلاح', type: 'textarea', required: true },
        ]}
        submitLabel="ثبت درخواست"
        busy={actionLoading}
        error={actionError}
        onClose={() => setCorrectionModalOpen(false)}
        onSubmit={requestCorrection}
      />
    </ErpPage>
  );
}
