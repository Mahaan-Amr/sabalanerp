'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FaBalanceScale,
  FaClipboardCheck,
  FaExclamationTriangle,
  FaEye,
  FaFileInvoice,
  FaFlag,
  FaReceipt,
  FaSync,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpButton,
  ErpEmptyState,
  ErpListPage,
  ErpPagination,
  type ErpAction,
  type ErpColumn,
  type ErpMetric,
} from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import {
  AccountingContractRow,
  StatusBadge,
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

export default function AccountingContractsPage() {
  const [rows, setRows] = useState<AccountingContractRow[]>([]);
  const [totals, setTotals] = useState<any>({});
  const [pagination, setPagination] = useState({ page: 1, pageSize: 50, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [sourceStatus, setSourceStatus] = useState('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadContracts = async (page = pagination.page) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getContracts({
        search,
        status,
        sourceStatus,
        sort: 'attention',
        page,
        pageSize: pagination.pageSize,
      });
      if (response.data.success) {
        setRows(response.data.data.items);
        setTotals(response.data.data.totals);
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
  }, [search, status, sourceStatus]);

  const execute = async (contract: AccountingContractRow, action: any) => {
    setActionLoading(`${contract.contractId}:${action.kind}`);
    try {
      await accountingAPI.executeAction(action);
      await loadContracts(pagination.page);
    } catch (error) {
      console.error('Accounting action failed:', error);
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

  const metrics: ErpMetric[] = useMemo(() => [
    { label: 'ارزش قراردادها', value: money(totals.contractAmount), icon: FaClipboardCheck, tone: 'primary' },
    { label: 'صورتحساب شده', value: money(totals.invoicedAmount), icon: FaFileInvoice, tone: 'info' },
    { label: 'دریافت شده', value: money(totals.receivedAmount), icon: FaReceipt, tone: 'success' },
    { label: 'مانده', value: money(totals.remainingAmount), icon: FaBalanceScale, tone: 'warning' },
  ], [totals]);

  const columns: ErpColumn<AccountingContractRow>[] = [
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
      disabled: !contract.accounting.eligibleForFinancialRecords || actionLoading === `${contract.contractId}:CREATE_RECEIVABLE`,
      title: contract.accounting.eligibilityReason,
      onClick: () => createReceivable(contract),
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
      metrics={metrics}
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
    />
  );
}
