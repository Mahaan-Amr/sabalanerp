'use client';

import { useEffect, useState } from 'react';
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
import { accountingAPI } from '@/lib/api';
import {
  AccountingContractRow,
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

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'پیش‌نویس', value: 'DRAFT' },
  { label: 'در انتظار تایید', value: 'PENDING_APPROVAL' },
  { label: 'تایید شده', value: 'APPROVED' },
  { label: 'امضا شده', value: 'SIGNED' },
  { label: 'چاپ شده', value: 'PRINTED' },
  { label: 'لغو شده', value: 'CANCELLED' },
  { label: 'منقضی شده', value: 'EXPIRED' },
];

const sourceStatusOptions = [
  { label: 'همه حالت‌ها', value: 'ALL' },
  { label: 'فقط قابل مشاهده', value: 'VISIBLE_ONLY' },
  { label: 'آماده اقدام مالی', value: 'ELIGIBLE' },
  { label: 'دارای رکورد مالی', value: 'HAS_FINANCIAL_RECORDS' },
  { label: 'نیازمند اصلاح', value: 'NEEDS_CORRECTION' },
];

const toPdfViewerUrl = (url: string) => `${url}#page=1&zoom=page-fit`;

export default function AccountingContractsPage() {
  const [rows, setRows] = useState<AccountingContractRow[]>([]);
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sourceStatus, setSourceStatus] = useState('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<{
    contract: AccountingContractRow;
    invoice: NonNullable<AccountingContractRow['financialRecords']>[number];
  } | null>(null);

  const toGregorianFilterDate = (value: string, endOfDay = false) => {
    if (!value) return undefined;
    const date = PersianCalendar.toGregorian(value);
    if (endOfDay) date.setHours(23, 59, 59, 999);
    else date.setHours(0, 0, 0, 0);
    return date.toISOString();
  };

  const loadContracts = async (page = pagination.page) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getContracts({
        search,
        status,
        sourceStatus,
        dateFrom: toGregorianFilterDate(dateFrom),
        dateTo: toGregorianFilterDate(dateTo, true),
        sort: 'attention',
        page,
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
  };

  useEffect(() => {
    loadContracts(1);
  }, [search, status, sourceStatus, dateFrom, dateTo]);

  const execute = async (contract: AccountingContractRow, action: any) => {
    setActionLoading(`${contract.contractId}:${action.kind}`);
    try {
      await accountingAPI.executeAction(action);
      await loadContracts(pagination.page);
    } catch (error) {
      console.error('Accounting action failed:', error);
      window.alert((error as any)?.response?.data?.error || 'اقدام حسابداری انجام نشد');
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
      const response = await accountingAPI.getSalesContractPdf(contract.contractId, { fresh: false });
      const url = response.data?.data?.url;
      if (!response.data?.success || !url) throw new Error('Sales contract PDF url was not returned');
      openPdfUrl(url, tryPrint);
    } catch (error) {
      console.error('Sales contract PDF failed:', error);
      window.alert(tryPrint ? 'پرینت قرارداد انجام نشد' : 'دانلود PDF قرارداد انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const requestCorrection = (contract: AccountingContractRow) => {
    const reason = window.prompt('متن درخواست اصلاح را وارد کنید');
    if (!reason?.trim()) return;
    execute(contract, {
      kind: 'REQUEST_CORRECTION',
      contractId: contract.contractId,
      category: 'OTHER',
      priority: 'MEDIUM',
      reason: reason.trim(),
    });
  };

  const flagContract = (contract: AccountingContractRow) => {
    const note = window.prompt('یادداشت پرچم حسابداری را وارد کنید');
    if (!note?.trim()) return;
    execute(contract, {
      kind: 'FLAG_CONTRACT',
      contractId: contract.contractId,
      category: 'OTHER',
      severity: 'MEDIUM',
      title: 'نیازمند بررسی حسابداری',
      note: note.trim(),
    });
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
      cell: (contract) => contract.customer.displayName,
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
          <p className="font-semibold text-slate-950 dark:text-white">{contract.contractNumber}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{contract.titlePersian}</p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{contract.customer.displayName}</p>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'وضعیت قرارداد',
      mobileLabel: 'وضعیت قرارداد',
      priority: 'secondary',
      cell: (contract) => (
        <ErpBadge tone={contractStatusTones[contract.status] || 'neutral'}>
          {contractStatusLabels[contract.status] || contract.status}
        </ErpBadge>
      ),
    },
    {
      id: 'accounting',
      header: 'وضعیت حسابداری',
      mobileLabel: 'وضعیت حسابداری',
      priority: 'secondary',
      cell: (contract) => (
        <div className="flex flex-wrap gap-1">
          <StatusBadge label={sourceStatusLabels[contract.accounting.sourceStatus] || contract.accounting.sourceStatus} status={contract.accounting.sourceStatus} />
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
          <p>{invoiceStatusLabels[contract.accounting.invoiceStatus] || contract.accounting.invoiceStatus}</p>
          <p>{receivableStatusLabels[contract.accounting.receivableStatus] || contract.accounting.receivableStatus}</p>
          <p>{taxStatusLabels[contract.accounting.taxStatus] || contract.accounting.taxStatus}</p>
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
        <span className="font-semibold text-[#074747] dark:text-teal-200">{money(contract.accounting.remainingAmount)}</span>
      ),
    },
  ];

  const rowActions = (contract: AccountingContractRow): ErpAction[] => [
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
    {
      label: 'پیش‌نویس صورتحساب',
      icon: FaFileInvoice,
      tone: 'info',
      disabled: !contract.accounting.eligibleForFinancialRecords || actionLoading === `${contract.contractId}:CREATE_INVOICE`,
      title: contract.accounting.eligibilityReason,
      onClick: () => createInvoice(contract),
    },
    {
      label: 'دریافتنی',
      icon: FaReceipt,
      tone: 'success',
      disabled: !contract.accounting.eligibleForFinancialRecords || contract.accounting.invoiceStatus !== 'ISSUED' || actionLoading === `${contract.contractId}:CREATE_RECEIVABLE`,
      title: contract.accounting.eligibilityReason || (contract.accounting.invoiceStatus !== 'ISSUED' ? 'ابتدا صورتحساب را تایید مالی کنید' : undefined),
      onClick: () => createReceivable(contract),
    },
    {
      label: 'تایید مالی',
      icon: FaCheckCircle,
      tone: 'success',
      disabled: !contract.accounting.eligibleForFinancialRecords || getPendingInvoiceCandidates(contract).length !== 1 || actionLoading === `${contract.contractId}:APPROVE_FINANCIAL_INVOICE`,
      title: getPendingInvoiceCandidates(contract).length !== 1 ? 'برای تایید سریع باید دقیقا یک صورتحساب تایید نشده وجود داشته باشد' : undefined,
      onClick: () => openApprovalModal(contract),
    },
    { label: 'پرچم', icon: FaFlag, tone: 'warning', onClick: () => flagContract(contract) },
    { label: 'درخواست اصلاح', icon: FaExclamationTriangle, tone: 'danger', onClick: () => requestCorrection(contract) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="قراردادهای قابل بررسی"
      description="همه قراردادها در هر وضعیت دیده می‌شوند؛ اقدام مالی فقط برای قراردادهای تایید شده، امضا شده یا چاپ شده فعال است."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadContracts(pagination.page), tone: 'neutral' }]}
      filters={[
        {
          id: 'search',
          label: 'جستجو',
          type: 'search',
          value: search,
          onChange: setSearch,
          placeholder: 'جستجو در شماره قرارداد، مشتری، کد ملی یا عنوان...',
        },
        {
          id: 'status',
          label: 'وضعیت قرارداد',
          type: 'select',
          value: status,
          onChange: setStatus,
          options: statusOptions,
        },
        {
          id: 'sourceStatus',
          label: 'وضعیت حسابداری',
          type: 'select',
          value: sourceStatus,
          onChange: setSourceStatus,
          options: sourceStatusOptions,
        },
      ]}
      rows={rows}
      rowKey={(contract) => contract.contractId}
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
          onPageChange={loadContracts}
          itemLabel="قرارداد"
        />
      }
    >
      <ErpSection>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">از تاریخ</span>
            <PersianCalendarComponent value={dateFrom} onChange={setDateFrom} placeholder="از تاریخ" />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-500 dark:text-slate-400">تا تاریخ</span>
            <PersianCalendarComponent value={dateTo} onChange={setDateTo} placeholder="تا تاریخ" />
          </label>
        </div>
      </ErpSection>

      {approvalTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4">
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-teal-600 dark:text-teal-300">تایید مالی</p>
                <h2 className="mt-1 text-lg font-bold text-slate-950 dark:text-white">
                  {approvalTarget.contract.contractNumber}
                </h2>
                <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                  {approvalTarget.contract.customer.displayName}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setApprovalTarget(null)}
                className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                بستن
              </button>
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
    </ErpListPage>
  );
}
