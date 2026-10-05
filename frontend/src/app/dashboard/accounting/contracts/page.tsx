'use client';
import { contractLifecycleLabel, contractLifecycleFilterOptions } from '@/features/sales/contractLifecyclePresentation';
import { ErpButton, ErpPressable } from '@/components/erp';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  FaCheckCircle,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaEye,
  FaDownload,
  FaFileInvoice,
  FaFlag,
  FaPrint,
  FaReceipt,
  FaSync,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpEmptyState,
  ErpListPage,
  ErpPagination,
  ErpSection,
  type ErpAction,
  type ErpColumn,
} from '@/components/erp';
import PersianCalendarComponent from '@/components/PersianCalendar';
import PersianCalendar from '@/lib/persian-calendar';
import api, { accountingAPI } from '@/lib/api';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { operationalStatusLabel } from '@/features/dispatch/operationalStatusPresentation';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import AccountingCustomerCategoryBadge from '@/features/accounting/AccountingCustomerCategoryBadge';
import { financialEvidenceReviewFromConflict } from '@/features/accounting/financialEvidenceReview';
import {
  canonicalizeContractsQuery,
  patchContractsQuery,
  type ContractsQueryState,
} from '@/features/accounting/accountingQueryState';
import {
  AccountingContractRow,
  accountingActionAvailability,
  accountingFailureMessage,
  FinancialInvoiceApprovalForm,
  FinancialInvoiceApprovalPayload,
  StatusBadge,
  dateFa,
  contractStatusLabels,
  contractStatusTones,
  invoiceStatusLabels,
  money,
  receivableStatusLabels,
  sourceStatusLabels,
  taxStatusLabels,
} from '@/features/accounting/accountingUi';

const statusOptions = contractLifecycleFilterOptions;

const sourceStatusOptions = [
  { label: 'همه حالت‌ها', value: 'ALL' },
  { label: 'فقط قابل مشاهده', value: 'VISIBLE_ONLY' },
  { label: 'آماده اقدام مالی', value: 'ELIGIBLE' },
  { label: 'دارای رکورد مالی', value: 'HAS_FINANCIAL_RECORDS' },
  { label: 'نیازمند اصلاح', value: 'NEEDS_CORRECTION' },
];

const toPdfViewerUrl = (url: string) => `${url}#page=1&zoom=page-fit`;

export default function AccountingContractsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizeContractsQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<AccountingContractRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(query.search);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewActionUrl, setReviewActionUrl] = useState<string | null>(null);
  const [correctionTarget, setCorrectionTarget] = useState<AccountingContractRow | null>(null);
  const [flagTarget, setFlagTarget] = useState<AccountingContractRow | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<{
    contract: AccountingContractRow;
    invoice: NonNullable<AccountingContractRow['financialRecords']>[number];
  } | null>(null);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizeContractsQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<ContractsQueryState>) => {
    replaceQuery(patchContractsQuery(new URLSearchParams(searchParams.toString()), patch));
  }, [replaceQuery, searchParams]);

  useEffect(() => {
    if (canonicalQuery.params.toString() !== searchParams.toString()) replaceQuery(canonicalQuery);
  }, [canonicalQuery, replaceQuery, searchParams]);

  useEffect(() => setSearchInput(query.search), [query.search]);

  useEffect(() => {
    if (searchInput.trim() === query.search) return;
    const timeout = window.setTimeout(() => updateQuery({ search: searchInput }), 350);
    return () => window.clearTimeout(timeout);
  }, [query.search, searchInput, updateQuery]);

  const jalaliFilterValue = useCallback((value: string) => (
    value ? PersianCalendar.toPersian(`${value}T12:00:00.000Z`) : ''
  ), []);

  const setDateFilter = useCallback((key: 'dateFrom' | 'dateTo', value: string) => {
    updateQuery({ [key]: value ? PersianCalendar.toGregorianDateOnly(value) : '' });
  }, [updateQuery]);

  const loadContracts = useCallback(async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getContracts({
        view: query.view || undefined,
        lifecycleView: query.lifecycleView,
        search: query.search || undefined,
        status: query.status,
        sourceStatus: query.sourceStatus,
        dateFrom: query.dateFrom || undefined,
        dateTo: query.dateTo || undefined,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (response.data.success) {
        setRows(response.data.data.items);
        setPagination({
          page: response.data.data.page,
          pageSize: response.data.data.pageSize,
          total: response.data.data.total,
        });
      }
    } catch (error) {
      console.error('Error loading accounting contracts:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, query.dateFrom, query.dateTo, query.lifecycleView, query.page, query.search, query.sourceStatus, query.status, query.view]);

  useEffect(() => {
    loadContracts();
  }, [loadContracts]);

  const execute = async (contract: AccountingContractRow, action: any) => {
    setActionLoading(`${contract.contractId}:${action.kind}`);
    try {
      setActionError(null);
      setReviewActionUrl(null);
      await accountingAPI.executeAction(action);
      await loadContracts();
      return true;
    } catch (error) {
      console.error('Accounting action failed:', error);
      const response = (error as any)?.response?.data;
      const reviewUrl = financialEvidenceReviewFromConflict(response);
      if (reviewUrl) await loadContracts();
      setActionError(response?.error || 'اقدام حسابداری انجام نشد');
      setReviewActionUrl(reviewUrl);
      return false;
    } finally {
      setActionLoading(null);
    }
  };

  const createInvoice = (contract: AccountingContractRow) => execute(contract, {
    kind: 'CREATE_INVOICE',
    contractId: contract.contractId,
    mode: 'FROM_CONTRACT_TOTAL',
    issueDate: new Date().toISOString(),
    idempotencyKey: `invoice-candidate:${contract.contractId}:full`,
  });

  const createReceivable = (contract: AccountingContractRow) => execute(contract, {
    kind: 'CREATE_RECEIVABLE',
    contractId: contract.contractId,
    amount: contract.accounting.remainingAmount || contract.accounting.totalContractAmount,
    dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    idempotencyKey: `receivable:${contract.contractId}:planned`,
  });

  const getPendingInvoiceCandidates = (contract: AccountingContractRow) =>
    (contract.financialRecords || []).filter((record) => (
      record.kind === 'INVOICE_CANDIDATE' &&
      !['ISSUED', 'POSTED', 'VOIDED'].includes(record.status)
    ));

  const openApprovalModal = (contract: AccountingContractRow) => {
    const pendingInvoices = getPendingInvoiceCandidates(contract);
    if (pendingInvoices.length !== 1) return;
    setApprovalTarget({ contract, invoice: pendingInvoices[0] });
  };

  const approveFinancialInvoice = async (payload: FinancialInvoiceApprovalPayload) => {
    if (!approvalTarget) return;
    await execute(approvalTarget.contract, {
      kind: 'APPROVE_FINANCIAL_INVOICE',
      invoiceId: payload.invoiceId,
      systemInvoiceNumber: payload.systemInvoiceNumber,
      systemInvoiceDate: payload.systemInvoiceDate,
      sepidarAmount: payload.sepidarAmount,
    });
    setApprovalTarget(null);
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

  const openSalesContractPdf = async (contract: AccountingContractRow, tryPrint = false) => {
    const actionKey = `${contract.contractId}:${tryPrint ? 'PRINT_SALES_PDF' : 'DOWNLOAD_SALES_PDF'}`;
    setActionLoading(actionKey);
    try {
      if (!tryPrint) {
        const response = await accountingAPI.downloadSalesContractPdf(contract.contractId, { fresh: true });
        downloadBlobResponse(response, `sales_contract_${contract.contractNumber || contract.contractId}.pdf`);
        return;
      }

      const response = await accountingAPI.getSalesContractPdf(contract.contractId, { fresh: true });
      const url = response.data?.data?.url;
      if (!response.data?.success || !url) throw new Error('Sales contract PDF url was not returned');
      openPdfUrl(url, tryPrint);
    } catch (error) {
      console.error('Sales contract PDF failed:', error);
      setActionError(tryPrint ? 'پرینت قرارداد انجام نشد' : 'دانلود PDF قرارداد انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const openPartnerInternalPdf = async (contract: AccountingContractRow, tryPrint = false) => {
    const caseId = contract.partnerContext?.caseId;
    if (!caseId) return;
    const actionKey = `${contract.contractId}:${tryPrint ? 'PRINT_SALES_PDF' : 'DOWNLOAD_SALES_PDF'}`;
    setActionLoading(actionKey); setActionError(null);
    try {
      if (tryPrint) {
        const response = await accountingAPI.getPartnerInternalPdf(caseId);
        const url = response.data?.data?.url;
        if (!response.data?.success || !url) throw new Error('Internal PDF URL missing');
        openPdfUrl(url, true);
      } else {
        const response = await accountingAPI.downloadPartnerInternalPdf(caseId);
        downloadBlobResponse(response, `partner_internal_${contract.partnerContext?.internalRecordNumber}.pdf`);
      }
    } catch {
      setActionError(tryPrint ? 'چاپ سند داخلی انجام نشد.' : 'دریافت PDF سند داخلی انجام نشد.');
    } finally { setActionLoading(null); }
  };

  const requestCorrection = async (values: Record<string, string | number>) => {
    if (!correctionTarget) return;
    const reason = String(values.reason || '').trim();
    if (!reason) return;
    setActionLoading(`${correctionTarget.contractId}:CREATE_CORRECTION_REQUEST`);
    try {
      setActionError(null);
      const request = {
        category: String(values.category || 'OTHER'),
        priority: String(values.priority || 'MEDIUM'),
        reason,
      };
      const idempotencyKey = crypto.randomUUID();
      if (correctionTarget.sourceKind === 'PARTNER_INTERNAL_RECORD' && correctionTarget.partnerContext?.caseId)
        await accountingAPI.createPartnerInternalCorrectionRequest(correctionTarget.partnerContext.caseId, request, idempotencyKey);
      else await accountingAPI.createCorrectionRequest(correctionTarget.contractId, request, idempotencyKey);
      await loadContracts();
      setCorrectionTarget(null);
    } catch (error) {
      const response = (error as any)?.response?.data;
      setActionError(response?.message || (error as Error).message || 'ثبت درخواست اصلاح انجام نشد. دوباره تلاش کنید.');
    } finally {
      setActionLoading(null);
    }
  };

  const flagContract = async (values: Record<string, string | number>) => {
    if (!flagTarget) return;
    const note = String(values.note || '').trim();
    if (!note) return;
    if (flagTarget.sourceKind === 'PARTNER_INTERNAL_RECORD' && flagTarget.partnerContext?.caseId) {
      setActionLoading(`${flagTarget.contractId}:FLAG_CONTRACT`); setActionError(null);
      try {
        await accountingAPI.flagPartnerInternalRecord(flagTarget.partnerContext.caseId, {
          category: values.category || 'OTHER', severity: values.severity || 'MEDIUM',
          title: String(values.title || 'نیازمند بررسی حسابداری'), note,
        });
        await loadContracts(); setFlagTarget(null);
      } catch (error) {
        setActionError(accountingFailureMessage(error, 'ثبت پرچم سند داخلی انجام نشد.'));
      } finally { setActionLoading(null); }
      return;
    }
    const applied = await execute(flagTarget, {
      kind: 'FLAG_CONTRACT',
      contractId: flagTarget.contractId,
      category: values.category || 'OTHER',
      severity: values.severity || 'MEDIUM',
      title: String(values.title || 'نیازمند بررسی حسابداری'),
      note,
    });
    if (applied) setFlagTarget(null);
  };

  const columns: ErpColumn<AccountingContractRow>[] = [
    {
      id: 'rowNumber',
      header: 'ردیف',
      mobileLabel: 'ردیف',
      align: 'center',
      priority: 'secondary',
      cell: (contract) => ((pagination.page - 1) * pagination.pageSize + rows.findIndex((row) => row.contractId === contract.contractId) + 1).toLocaleString('fa-IR'),
    },
    {
      id: 'customerName',
      header: 'نام مشتری',
      mobileLabel: 'نام مشتری',
      priority: 'secondary',
      cell: (contract) => <div><div className="flex flex-wrap items-center gap-2">
        <span>{contract.customer.displayName}</span><AccountingCustomerCategoryBadge contract={contract} />
      </div>{contract.partnerContext &&
        <p className="mt-1 text-xs sds-text-secondary">طرف‌حساب سبلان: {contract.partnerContext.debtor.displayName}</p>}</div>,
    },
    {
      id: 'date',
      header: 'تاریخ',
      mobileLabel: 'تاریخ',
      priority: 'secondary',
      cell: (contract) => dateFa(contract.contractDate || contract.signedAt || contract.createdAt),
    },
    {
      id: 'contract',
      header: 'قرارداد',
      priority: 'primary',
      cell: (contract) => (
        <div className="min-w-0">
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{contract.contractNumber}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{contract.titlePersian}</p>
          <ErpBadge tone={contract.sourceKind === 'PARTNER_INTERNAL_RECORD' ? 'purple' : 'warning'}>
            {contract.sourceKind === 'PARTNER_INTERNAL_RECORD' ? 'همکار' : 'داخلی'}
          </ErpBadge>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'وضعیت قرارداد',
      mobileLabel: 'وضعیت قرارداد',
      priority: 'secondary',
      cell: (contract) => (
        <div className="flex flex-wrap gap-1">
          <ErpBadge tone={contractStatusTones[contract.status] || 'neutral'}>
            {contractLifecycleLabel(contract)}
          </ErpBadge>
          {contract.isInactive && <ErpBadge tone="warning">غیرفعال</ErpBadge>}
        </div>
      ),
    },
    {
      id: 'accounting',
      header: 'وضعیت حسابداری',
      mobileLabel: 'وضعیت حسابداری',
      priority: 'secondary',
      cell: (contract) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge label={sourceStatusLabels[contract.accounting.sourceStatus] || operationalStatusLabel(contract.accounting.sourceStatus)} status={contract.accounting.sourceStatus} />
          {contract.accounting.openCorrections > 0 && <StatusBadge label={`${contract.accounting.openCorrections.toLocaleString('fa-IR')} اصلاحیه`} tone="danger" />}
          {contract.accounting.openFlags > 0 && <StatusBadge label={`${contract.accounting.openFlags.toLocaleString('fa-IR')} پرچم`} tone="warning" />}
        </div>
      ),
    },
    {
      id: 'invoice',
      header: 'صورتحساب / دریافتنی',
      mobileLabel: 'صورتحساب / دریافتنی',
      priority: 'meta',
      cell: (contract) => (
        <div className="space-y-1 text-xs">
          <p>{invoiceStatusLabels[contract.accounting.invoiceStatus] || operationalStatusLabel(contract.accounting.invoiceStatus)}</p>
          <p>{receivableStatusLabels[contract.accounting.receivableStatus] || operationalStatusLabel(contract.accounting.receivableStatus)}</p>
          <p>{contract.sourceKind === 'PARTNER_INTERNAL_RECORD' ? 'کاربرد ندارد' : taxStatusLabels[contract.accounting.taxStatus] || operationalStatusLabel(contract.accounting.taxStatus)}</p>
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'مانده',
      mobileLabel: 'مانده',
      align: 'end',
      priority: 'secondary',
      cell: (contract) => (
        <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{contract.amountKnown === false ? 'پس از پذیرش قیمت‌ها' : money(contract.accounting.remainingAmount, contract.accounting.currency)}</span>
      ),
    },
  ];

  const rowActions = (contract: AccountingContractRow): ErpAction[] => contract.preparationOnly ? [
    { label: 'مشاهده', icon: FaEye, href: `/dashboard/accounting/contracts/partner/${encodeURIComponent(contract.partnerContext!.caseId)}` },
    { label: 'پرینت', icon: FaPrint, onClick: () => void openPartnerInternalPdf(contract, true) },
    ...(contract.partnerCommercialStatus === 'FINAL' && accountingActionAvailability(contract, 'CREATE_INVOICE')?.enabled ? [{
      label: 'ثبت رکورد مالی', icon: FaFileInvoice, disabled: Boolean(actionLoading),
      onClick: () => { if (!contract.owner || actionLoading) return; setActionLoading(`${contract.contractId}:CREATE_INVOICE`);
        void api.post('/partner/accounting/enqueue', contract.owner).then(() => loadContracts())
          .catch(() => setActionError('ثبت پیش‌نویس مالی انجام نشد؛ وضعیت قرارداد را تازه‌سازی کنید.'))
          .finally(() => setActionLoading(null)); },
    } as ErpAction] : []),
  ] : contract.sourceKind === 'PARTNER_INTERNAL_RECORD' ? [
    { label: 'مشاهده', href: contract.partnerContext?.caseId
      ? `/dashboard/accounting/contracts/partner/${encodeURIComponent(contract.partnerContext.caseId)}` : undefined,
      icon: FaEye, tone: 'primary' },
    { label: 'دانلود PDF سند داخلی', icon: FaDownload, tone: 'success',
      disabled: actionLoading === `${contract.contractId}:DOWNLOAD_SALES_PDF`,
      onClick: () => void openPartnerInternalPdf(contract) },
    { label: 'پرینت سند داخلی', icon: FaPrint, tone: 'neutral',
      disabled: actionLoading === `${contract.contractId}:PRINT_SALES_PDF`,
      onClick: () => void openPartnerInternalPdf(contract, true) },
    ...(accountingActionAvailability(contract, 'APPROVE_FINANCIAL_INVOICE')?.visible ? [{
      label: 'تایید مالی', icon: FaCheckCircle, tone: 'success',
      disabled: accountingActionAvailability(contract, 'APPROVE_FINANCIAL_INVOICE')?.enabled !== true,
      title: accountingActionAvailability(contract, 'APPROVE_FINANCIAL_INVOICE')?.reason ?? undefined,
      onClick: () => openApprovalModal(contract),
    } as ErpAction] : []),
    { label: 'دریافتنی', icon: FaReceipt, tone: 'success',
      disabled: (Boolean(contract.partnerCommercialStatus) && contract.partnerCommercialStatus !== 'FINAL') || !['ISSUED', 'POSTED'].includes(contract.accounting.invoiceStatus),
      title: !['ISSUED', 'POSTED'].includes(contract.accounting.invoiceStatus) ? 'ابتدا سند را تأیید مالی کنید.' : undefined,
      href: `/dashboard/accounting/receivables?search=${encodeURIComponent(contract.partnerContext?.caseNumber ?? '')}` },
    { label: 'پیش‌نویس صورتحساب', icon: FaFileInvoice, tone: 'info',
      disabled: Boolean(contract.partnerCommercialStatus) && contract.partnerCommercialStatus !== 'FINAL',
      href: `/dashboard/accounting/invoice-candidates?search=${encodeURIComponent(contract.partnerContext?.caseNumber ?? '')}` },
    ...(accountingActionAvailability(contract, 'FLAG_CONTRACT')?.visible ? [
      { label: 'پرچم', icon: FaFlag, tone: 'warning',
        disabled: accountingActionAvailability(contract, 'FLAG_CONTRACT')?.enabled !== true,
        title: accountingActionAvailability(contract, 'FLAG_CONTRACT')?.reason || undefined,
        onClick: () => setFlagTarget(contract) } as ErpAction] : []),
    ...(accountingActionAvailability(contract, 'CREATE_CORRECTION_REQUEST')?.visible ? [
      { label: 'درخواست اصلاح', icon: FaExclamationTriangle, tone: 'danger',
        disabled: accountingActionAvailability(contract, 'CREATE_CORRECTION_REQUEST')?.enabled !== true,
        title: accountingActionAvailability(contract, 'CREATE_CORRECTION_REQUEST')?.reason || undefined,
        onClick: () => setCorrectionTarget(contract) } as ErpAction] : []),
  ] : [
    { label: 'مشاهده', href: `/dashboard/accounting/contracts/${contract.contractId}`, icon: FaEye, tone: 'primary' },
    {
      label: 'دانلود PDF قرارداد',
      icon: FaDownload,
      tone: 'success',
      title: 'دانلود PDF قرارداد فروش با جزئیات کامل',
      disabled: actionLoading === `${contract.contractId}:DOWNLOAD_SALES_PDF`,
      onClick: () => openSalesContractPdf(contract, false),
    },
    {
      label: 'پرینت قرارداد',
      icon: FaPrint,
      tone: 'neutral',
      title: 'پرینت قرارداد فروش با جزئیات کامل',
      disabled: actionLoading === `${contract.contractId}:PRINT_SALES_PDF`,
      onClick: () => openSalesContractPdf(contract, true),
    },
    ...(accountingActionAvailability(contract, 'CREATE_INVOICE')?.visible ? [{
      label: 'پیش‌نویس صورتحساب',
      icon: FaFileInvoice,
      tone: 'info',
      disabled: accountingActionAvailability(contract, 'CREATE_INVOICE')?.enabled !== true || !contract.accounting.eligibleForFinancialRecords || actionLoading === `${contract.contractId}:CREATE_INVOICE`,
      title: accountingActionAvailability(contract, 'CREATE_INVOICE')?.reason || contract.accounting.eligibilityReason,
      onClick: () => createInvoice(contract),
    } as ErpAction] : []),
    ...(accountingActionAvailability(contract, 'CREATE_RECEIVABLE')?.visible ? [{
      label: 'دریافتنی',
      icon: FaReceipt,
      tone: 'success',
      disabled: accountingActionAvailability(contract, 'CREATE_RECEIVABLE')?.enabled !== true || !contract.accounting.eligibleForFinancialRecords || contract.accounting.invoiceStatus !== 'ISSUED' || actionLoading === `${contract.contractId}:CREATE_RECEIVABLE`,
      title: accountingActionAvailability(contract, 'CREATE_RECEIVABLE')?.reason || contract.accounting.eligibilityReason || (contract.accounting.invoiceStatus !== 'ISSUED' ? 'ابتدا صورتحساب را تایید مالی کنید' : undefined),
      onClick: () => createReceivable(contract),
    } as ErpAction] : []),
    ...(accountingActionAvailability(contract, 'APPROVE_FINANCIAL_INVOICE')?.visible ? [{
      label: 'تایید مالی',
      icon: FaCheckCircle,
      tone: 'success',
      disabled: accountingActionAvailability(contract, 'APPROVE_FINANCIAL_INVOICE')?.enabled !== true || !contract.accounting.eligibleForFinancialRecords || contract.accounting.openCorrections > 0 || contract.accounting.openBlockerFlags > 0 || getPendingInvoiceCandidates(contract).length !== 1 || actionLoading === `${contract.contractId}:APPROVE_FINANCIAL_INVOICE`,
      title: contract.accounting.openCorrections > 0
        ? 'ابتدا درخواست‌های اصلاح باز را ببندید'
        : getPendingInvoiceCandidates(contract).length !== 1 ? 'برای تایید سریع باید دقیقا یک صورتحساب تایید نشده وجود داشته باشد' : undefined,
      onClick: () => openApprovalModal(contract),
    } as ErpAction] : []),
    ...(accountingActionAvailability(contract, 'FLAG_CONTRACT')?.visible
      ? [{ label: 'پرچم', icon: FaFlag, tone: 'warning', disabled: accountingActionAvailability(contract, 'FLAG_CONTRACT')?.enabled !== true, title: accountingActionAvailability(contract, 'FLAG_CONTRACT')?.reason || undefined, onClick: () => setFlagTarget(contract) } as ErpAction]
      : []),
    ...(accountingActionAvailability(contract, 'CREATE_CORRECTION_REQUEST')?.visible
      ? [{ label: 'درخواست اصلاح', icon: FaExclamationTriangle, tone: 'danger', disabled: accountingActionAvailability(contract, 'CREATE_CORRECTION_REQUEST')?.enabled !== true || contract.isInactive, title: accountingActionAvailability(contract, 'CREATE_CORRECTION_REQUEST')?.reason || (contract.isInactive ? 'قرارداد غیرفعال و فقط‌خواندنی است' : undefined), onClick: () => setCorrectionTarget(contract) } as ErpAction]
      : []),
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="قراردادهای قابل بررسی"
      description="قراردادهای همکار از یادداشت نمایش داده می‌شوند؛ اقدامات مالی آن‌ها پس از قطعی‌شدن فعال است."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadContracts, tone: 'neutral' }]}
      filters={[
        {
          id: 'lifecycleView',
          label: 'نمای قراردادها',
          type: 'select',
          value: query.lifecycleView,
          onChange: (value) => updateQuery({ lifecycleView: value as ContractsQueryState['lifecycleView'] }),
          options: [
            { label: 'فعال', value: 'active' },
            { label: 'غیرفعال', value: 'inactive' },
            { label: 'درخواست‌های در انتظار', value: 'pending' },
          ],
        },
        {
          id: 'search',
          label: 'جستجو',
          type: 'search',
          value: searchInput,
          onChange: setSearchInput,
          placeholder: 'جستجو در شماره قرارداد، مشتری، کد ملی یا عنوان...',
        },
        {
          id: 'status',
          label: 'وضعیت قرارداد',
          type: 'select',
          value: query.status,
          onChange: (value) => updateQuery({ status: value }),
          options: statusOptions,
        },
        {
          id: 'sourceStatus',
          label: 'وضعیت حسابداری',
          type: 'select',
          value: query.sourceStatus,
          onChange: (value) => updateQuery({ sourceStatus: value }),
          options: sourceStatusOptions,
        },
      ]}
      rows={rows}
      rowKey={(contract) => contract.contractId}
      rowClassName={(contract) => contract.sourceKind === 'PARTNER_INTERNAL_RECORD'
        ? 'border-2 border-[var(--sds-purple-border)]'
        : 'border-2 border-[var(--sds-warning-border)]'}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      emptyState={<ErpEmptyState icon={FaClipboardCheck} title="قراردادی یافت نشد" description="فیلترها را تغییر دهید یا بعد از ثبت قرارداد جدید دوباره بررسی کنید." />}
      footer={
        <ErpPagination
          currentPage={pagination.page}
          totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)}
          totalItems={pagination.total}
          itemsPerPage={pagination.pageSize}
          onPageChange={(page) => updateQuery({ page })}
          itemLabel="قرارداد"
        />
      }
    >
      {actionError && !flagTarget && !correctionTarget && !approvalTarget && (
        <div className="rounded-lg border border-[var(--sds-danger-border)] bg-[var(--sds-danger-surface)] px-4 py-3 text-sm text-[var(--sds-danger)] dark:border-[var(--sds-danger-border)] dark:bg-[var(--sds-danger-surface)] dark:text-[var(--sds-danger)]">
          {actionError}
          {reviewActionUrl && (
            <div className="mt-3">
              <ErpButton label="رفتن به پرونده بررسی" tone="danger" variant="outline" href={reviewActionUrl} />
            </div>
          )}
        </div>
      )}
      <ErpSection>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">از تاریخ</span>
            <PersianCalendarComponent
              value={jalaliFilterValue(query.dateFrom)}
              onChange={(value) => setDateFilter('dateFrom', value)}
              placeholder="از تاریخ"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">تا تاریخ</span>
            <PersianCalendarComponent
              value={jalaliFilterValue(query.dateTo)}
              onChange={(value) => setDateFilter('dateTo', value)}
              placeholder="تا تاریخ"
            />
          </label>
        </div>
      </ErpSection>

      {approvalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--sds-surface-raised)] p-4">
          <div className="w-full max-w-2xl rounded-xl border border-[var(--sds-border-default)] bg-[var(--sds-surface-raised)] p-5 shadow-2xl dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)]">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">تایید مالی</p>
                <h2 className="mt-1 text-lg font-bold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                  {approvalTarget.contract.contractNumber}
                </h2>
                <p className="mt-1 text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                  {approvalTarget.contract.customer.displayName}
                </p>
              </div>
              <ErpPressable
                type="button"
                onClick={() => setApprovalTarget(null)}
                className="rounded-lg border border-[var(--sds-border-default)] px-3 py-2 text-sm text-[var(--sds-text-secondary)] hover:bg-[var(--sds-surface-subtle)] dark:border-[var(--sds-border-strong)] dark:text-[var(--sds-text-primary)] dark:hover:bg-[var(--sds-surface-raised)]"
              >
                بستن
              </ErpPressable>
            </div>
            <FinancialInvoiceApprovalForm
              invoice={approvalTarget.invoice}
              busy={actionLoading === `${approvalTarget.contract.contractId}:APPROVE_FINANCIAL_INVOICE`}
              compact
              onApprove={approveFinancialInvoice}
            />
          </div>
        </div>
      )}
      <AccountingActionModal
        open={Boolean(flagTarget)}
        title="پرچم حسابداری"
        description={flagTarget ? `${flagTarget.contractNumber} - ${flagTarget.customer.displayName}` : undefined}
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
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setFlagTarget(null)}
        onSubmit={flagContract}
      />
      <AccountingActionModal
        open={Boolean(correctionTarget)}
        title="درخواست اصلاح"
        description={correctionTarget ? `${correctionTarget.contractNumber} - ${correctionTarget.customer.displayName}` : undefined}
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
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setCorrectionTarget(null)}
        onSubmit={requestCorrection}
      />
    </ErpListPage>
  );
}
