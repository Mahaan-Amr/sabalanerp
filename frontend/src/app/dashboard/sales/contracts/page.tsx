'use client';
import { ErpPressable } from '@/components/erp';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  FaCheck,
  FaChevronDown,
  FaClock,
  FaDownload,
  FaEdit,
  FaExclamationTriangle,
  FaEye,
  FaFileContract,
  FaPlus,
  FaPrint,
  FaSignature,
  FaTimes,
} from 'react-icons/fa';
import {
  ErpBadge,
  ErpEmptyState,
  ErpListPage,
  type ErpAction,
  type ErpColumn,
  type ErpMetric,
  type ErpTone,
} from '@/components/erp';
import { salesAPI, dashboardAPI } from '@/lib/api';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import PersianCalendar from '@/lib/persian-calendar';
import { getContractPermissions, User } from '@/lib/permissions';
import { formatPrice, sumNumericValues } from '@/lib/numberFormat';
import { downloadBlobResponse } from '@/lib/downloadFile';
import { sanitizeUiText, sanitizeUiTextWithCandidates } from '@/lib/textSanitizer';
import { sourceStatusLabels, StatusBadge } from '@/features/accounting/accountingUi';
import { parseContractStatusQuery } from '@/features/sales/contractListQuery';

interface Contract {
  id: string;
  contractNumber: string;
  creatorSequenceNumber?: number | null;
  title: string;
  titlePersian: string;
  status: string;
  totalAmount: number | string | null;
  currency: string;
  createdAt: string;
  accountingEditLocked?: boolean;
  canOpenCorrectionEdit?: boolean;
  activeCorrectionRequest?: {
    id: string;
    category: string;
    accountantNote: string;
  } | null;
  accounting?: {
    sourceStatus: string;
    invoiceStatus: string;
    receivableStatus: string;
    taxStatus: string;
    openFlags: number;
    openCorrections: number;
    remainingAmount: string;
  } | null;
  customer: {
    id: string;
    firstName: string;
    lastName: string;
    companyName?: string;
    customerType?: string;
    status?: string;
    nationalCode?: string;
    projectManagerName?: string;
  };
  createdByUser: {
    id: string;
    firstName: string;
    lastName: string;
    username: string;
  };
}

interface ContractPagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

const CONTRACTS_PAGE_SIZE = 10;

const statusLabels: Record<string, string> = {
  DRAFT: 'پیش‌نویس',
  PENDING_APPROVAL: 'در انتظار تایید',
  APPROVED: 'تایید شده',
  SIGNED: 'امضا شده',
  PRINTED: 'چاپ شده',
  CANCELLED: 'لغو شده',
  EXPIRED: 'منقضی شده',
};

const statusTones: Record<string, ErpTone> = {
  DRAFT: 'neutral',
  PENDING_APPROVAL: 'warning',
  APPROVED: 'info',
  SIGNED: 'success',
  PRINTED: 'purple',
  CANCELLED: 'danger',
  EXPIRED: 'neutral',
};

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'پیش‌نویس', value: 'DRAFT' },
  { label: 'در انتظار تایید', value: 'PENDING_APPROVAL' },
  { label: 'تایید شده', value: 'APPROVED' },
  { label: 'امضا شده', value: 'SIGNED' },
  { label: 'چاپ شده', value: 'PRINTED' },
  { label: 'لغو شده', value: 'CANCELLED' },
  { label: 'منقضی شده', value: 'EXPIRED' },
  { label: 'لغو یا منقضی', value: 'CANCELLED,EXPIRED' },
];

const getStatusIcon = (status: string) => {
  switch (status) {
    case 'PENDING_APPROVAL':
    case 'EXPIRED':
      return FaClock;
    case 'APPROVED':
      return FaCheck;
    case 'SIGNED':
      return FaSignature;
    case 'PRINTED':
      return FaPrint;
    case 'CANCELLED':
      return FaExclamationTriangle;
    default:
      return FaFileContract;
  }
};

const formatCurrency = (amount: Contract['totalAmount'], currency: string) => {
  return formatPrice(amount, currency);
};

const getCustomerName = (contract: Contract) =>
  sanitizeUiTextWithCandidates(
    [
      `${contract.customer.firstName || ''} ${contract.customer.lastName || ''}`.trim(),
      contract.customer.companyName,
    ],
    'نامشخص'
  );

const getContractCreatorName = (contract: Contract) =>
  sanitizeUiTextWithCandidates(
    [
      `${contract.createdByUser.firstName || ''} ${contract.createdByUser.lastName || ''}`.trim(),
      contract.createdByUser.username,
    ],
    'نامشخص'
  );

export default function ContractsPage() {
  useWorkspace();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedStatusFilter = parseContractStatusQuery(searchParams.get('status')).join(',') || 'ALL';
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [contractPermissions, setContractPermissions] = useState({
    canView: false,
    canCreate: false,
    canEdit: false,
    canApprove: false,
    canReject: false,
    canSign: false,
    canPrint: false,
  });
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState(requestedStatusFilter);
  const [pagination, setPagination] = useState<ContractPagination>({
    page: 1,
    limit: CONTRACTS_PAGE_SIZE,
    total: 0,
    pages: 1,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfActionLoading, setPdfActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadCurrentUser();
  }, []);

  useEffect(() => {
    setStatusFilter(requestedStatusFilter);
  }, [requestedStatusFilter]);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedSearchTerm(searchTerm.trim());
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [searchTerm]);

  const loadContracts = useCallback(async (page = 1, options: { append?: boolean } = {}) => {
    const append = options.append === true;
    try {
      if (append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
      }

      const response = await salesAPI.getContracts({
        page,
        limit: CONTRACTS_PAGE_SIZE,
        ...(statusFilter !== 'ALL' ? { status: statusFilter } : {}),
        ...(debouncedSearchTerm ? { search: debouncedSearchTerm } : {}),
      });

      if (response.data.success) {
        setContracts((current) => (append ? [...current, ...response.data.data] : response.data.data));
        if (response.data.pagination) {
          setPagination(response.data.pagination);
        }
      }
    } catch (error) {
      console.error('Error loading contracts:', error);
    } finally {
      if (append) {
        setLoadingMore(false);
      } else {
        setLoading(false);
      }
    }
  }, [debouncedSearchTerm, statusFilter]);

  useEffect(() => {
    loadContracts(1, { append: false });
  }, [loadContracts]);

  const loadCurrentUser = async () => {
    try {
      const response = await dashboardAPI.getProfile();
      if (response.data.success) {
        const user: User = response.data.data;
        setContractPermissions(getContractPermissions(user));
      }
    } catch (error) {
      console.error('Error loading user profile:', error);
    }
  };

  const filteredContracts = useMemo(() => {
    const normalizedSearch = debouncedSearchTerm.toLowerCase();
    const selectedStatuses = parseContractStatusQuery(statusFilter);
    return contracts.filter((contract) => {
      const customerName = `${contract.customer.firstName} ${contract.customer.lastName}`.toLowerCase();
      const companyName = contract.customer.companyName?.toLowerCase() || '';
      const nationalCode = contract.customer.nationalCode?.toLowerCase() || '';
      const projectManager = contract.customer.projectManagerName?.toLowerCase() || '';
      const creatorName = `${contract.createdByUser.firstName || ''} ${contract.createdByUser.lastName || ''}`.trim().toLowerCase();
      const creatorUsername = contract.createdByUser.username?.toLowerCase() || '';
      const creatorSequence = contract.creatorSequenceNumber != null ? String(contract.creatorSequenceNumber) : '';
      const accountingStatus = contract.accounting?.sourceStatus || '';

      const matchesSearch =
        !normalizedSearch ||
        contract.titlePersian.toLowerCase().includes(normalizedSearch) ||
        contract.contractNumber.toLowerCase().includes(normalizedSearch) ||
        creatorSequence.includes(normalizedSearch) ||
        customerName.includes(normalizedSearch) ||
        companyName.includes(normalizedSearch) ||
        nationalCode.includes(normalizedSearch) ||
        projectManager.includes(normalizedSearch) ||
        creatorName.includes(normalizedSearch) ||
        creatorUsername.includes(normalizedSearch) ||
        accountingStatus.toLowerCase().includes(normalizedSearch) ||
        (sourceStatusLabels[accountingStatus] || '').toLowerCase().includes(normalizedSearch);

      const matchesStatus = selectedStatuses.length === 0 || selectedStatuses.includes(contract.status);
      return matchesSearch && matchesStatus;
    });
  }, [contracts, debouncedSearchTerm, statusFilter]);

  const changeStatusFilter = (value: string) => {
    setStatusFilter(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'ALL') params.delete('status');
    else params.set('status', value);
    const query = params.toString();
    router.replace(query ? `/dashboard/sales/contracts?${query}` : '/dashboard/sales/contracts', { scroll: false });
  };

  const hasMoreContracts = pagination.page < pagination.pages;

  const handleLoadMore = () => {
    if (loading || loadingMore || !hasMoreContracts) return;
    loadContracts(pagination.page + 1, { append: true });
  };

  const metrics: ErpMetric[] = useMemo(() => {
    const totalAmount = sumNumericValues(filteredContracts, (contract) => contract.totalAmount);
    return [
      { label: 'کل قراردادها', value: pagination.total.toLocaleString('fa-IR'), icon: FaFileContract, tone: 'primary' },
      { label: 'نتایج فعلی', value: filteredContracts.length.toLocaleString('fa-IR'), hint: statusFilter === 'ALL' ? 'همه وضعیت‌ها' : statusLabels[statusFilter], icon: FaEye, tone: 'info' },
      { label: 'در انتظار تایید', value: contracts.filter((contract) => contract.status === 'PENDING_APPROVAL').length.toLocaleString('fa-IR'), icon: FaClock, tone: 'warning' },
      { label: 'مبلغ نتایج', value: formatCurrency(totalAmount, 'تومان'), icon: FaFileContract, tone: 'success' },
    ];
  }, [contracts, filteredContracts, pagination.total, statusFilter]);

  const openPdfUrl = (url: string, tryPrint: boolean) => {
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win || !tryPrint) return;

    try {
      const triggerPrint = () => {
        try {
          win.focus();
          win.print();
        } catch (error) {
          console.error('Print trigger failed:', error);
        }
      };
      win.addEventListener('load', triggerPrint, { once: true });
      setTimeout(triggerPrint, 1200);
    } catch (error) {
      console.error('Print setup failed:', error);
    }
  };

  const handleDownloadPdf = async (contractId: string) => {
    setPdfActionLoading(contractId);
    try {
      const response = await salesAPI.downloadContractPdf(contractId, { fresh: false });
      downloadBlobResponse(response, `sales_contract_${contractId}.pdf`);
    } catch (error) {
      console.error('Error downloading contract PDF:', error);
    } finally {
      setPdfActionLoading(null);
    }
  };

  const handleStatusAction = async (contractId: string, action: string) => {
    const actionKey = `${contractId}:${action}`;
    setActionLoading(actionKey);
    try {
      let response;
      switch (action) {
        case 'approve':
          response = await salesAPI.approveContract(contractId);
          break;
        case 'reject':
          response = await salesAPI.rejectContract(contractId);
          break;
        case 'sign':
          response = await salesAPI.signContract(contractId);
          break;
        case 'print':
          response = await salesAPI.printContract(contractId);
          break;
        default:
          return;
      }

      if (response.data.success) {
        if (action === 'print') {
          const pdfResponse = await salesAPI.getContractPdf(contractId, { fresh: false });
          if (pdfResponse.data?.success && pdfResponse.data?.data?.url) {
            openPdfUrl(pdfResponse.data.data.url, true);
          }
        }
        await loadContracts(1, { append: false });
      } else {
        console.error('Error:', response.data.error);
      }
    } catch (error: any) {
      console.error(`Error ${action}ing contract:`, error);
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<Contract>[] = [
    {
      id: 'contract',
      header: 'قرارداد',
      priority: 'primary',
      cell: (contract) => {
        const StatusIcon = getStatusIcon(contract.status);
        return (
          <div className="flex items-start gap-3">
            <span className="mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[var(--sds-accent)]/10 text-[var(--sds-accent)] dark:bg-[var(--sds-accent-surface)] dark:text-[var(--sds-accent)]">
              <StatusIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="break-words font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
                {sanitizeUiTextWithCandidates([contract.titlePersian, contract.title, contract.contractNumber], 'قرارداد فروش')}
              </p>
              <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                عمومی: {sanitizeUiText(contract.contractNumber, '—')}
                {contract.creatorSequenceNumber != null ? ` | داخلی من: ${contract.creatorSequenceNumber}` : ''}
              </p>
            </div>
          </div>
        );
      },
    },
    {
      id: 'customer',
      header: 'مشتری',
      mobileLabel: 'مشتری',
      priority: 'secondary',
      cell: (contract) => (
        <div>
          <p className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{getCustomerName(contract)}</p>
          {sanitizeUiText(contract.customer.companyName, '') && (
            <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{sanitizeUiText(contract.customer.companyName, '')}</p>
          )}
        </div>
      ),
    },
    {
      id: 'creator',
      header: 'ثبت‌کننده قرارداد',
      mobileLabel: 'ثبت‌کننده قرارداد',
      priority: 'secondary',
      cell: (contract) => (
        <span className="font-medium text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">
          {getContractCreatorName(contract)}
        </span>
      ),
    },
    {
      id: 'amount',
      header: 'مبلغ',
      mobileLabel: 'مبلغ',
      priority: 'secondary',
      align: 'end',
      cell: (contract) => (
        <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">
          {formatCurrency(contract.totalAmount, sanitizeUiText(contract.currency, 'تومان'))}
        </span>
      ),
    },
    {
      id: 'date',
      header: 'تاریخ',
      mobileLabel: 'تاریخ',
      priority: 'meta',
      cell: (contract) => PersianCalendar.formatForDisplay(contract.createdAt),
    },
    {
      id: 'status',
      header: 'وضعیت',
      mobileLabel: 'وضعیت',
      priority: 'meta',
      cell: (contract) => (
        <ErpBadge tone={statusTones[contract.status] || 'neutral'}>
          {statusLabels[contract.status] || contract.status}
        </ErpBadge>
      ),
    },
    {
      id: 'accounting',
      header: 'وضعیت حسابداری',
      mobileLabel: 'حسابداری',
      priority: 'meta',
      cell: (contract) => {
        const accounting = contract.accounting;
        if (!accounting) return <ErpBadge tone="neutral">ثبت نشده</ErpBadge>;
        return (
          <div className="flex flex-col items-start gap-1">
            <StatusBadge
              status={accounting.sourceStatus}
              label={sourceStatusLabels[accounting.sourceStatus] || accounting.sourceStatus}
            />
            {accounting.openCorrections > 0 && (
              <span className="text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
                {accounting.openCorrections > 0 ? `${accounting.openCorrections.toLocaleString('fa-IR')} اصلاحیه` : ''}
              </span>
            )}
          </div>
        );
      },
    },
  ];

  const downloadPdfActionLabel = '\u062f\u0627\u0646\u0644\u0648\u062f PDF';
  const printContractActionLabel = '\u067e\u0631\u06cc\u0646\u062a \u0642\u0631\u0627\u0631\u062f\u0627\u062f';

  const getRowActions = (contract: Contract): ErpAction[] => {
    const actions: ErpAction[] = [
      { label: 'مشاهده قرارداد', href: `/dashboard/sales/contracts/${contract.id}`, icon: FaEye, tone: 'primary' },
    ];

    if (contractPermissions.canView) {
      actions.push({
        label: downloadPdfActionLabel,
        onClick: () => handleDownloadPdf(contract.id),
        icon: FaDownload,
        tone: 'success',
        disabled: pdfActionLoading === contract.id,
      });
    }
    if (contractPermissions.canPrint) {
      actions.push({
        label: printContractActionLabel,
        onClick: () => handleStatusAction(contract.id, 'print'),
        icon: FaPrint,
        tone: 'purple',
        disabled: actionLoading === `${contract.id}:print`,
      });
    }
    if (contractPermissions.canEdit && (!contract.accountingEditLocked || contract.canOpenCorrectionEdit)) {
      actions.push({
        label: contract.canOpenCorrectionEdit ? 'اصلاح قرارداد' : 'ویرایش قرارداد',
        href: `/dashboard/sales/contracts/${contract.id}/edit`,
        icon: FaEdit,
        tone: contract.canOpenCorrectionEdit ? 'warning' : 'info'
      });
    }

    if ((contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && contractPermissions.canApprove) {
      actions.push({
        label: 'تایید قرارداد',
        onClick: () => handleStatusAction(contract.id, 'approve'),
        icon: FaCheck,
        tone: 'success',
        disabled: actionLoading === `${contract.id}:approve`,
      });
    }

    if ((contract.status === 'DRAFT' || contract.status === 'PENDING_APPROVAL') && contractPermissions.canReject) {
      actions.push({
        label: 'رد قرارداد',
        onClick: () => handleStatusAction(contract.id, 'reject'),
        icon: FaTimes,
        tone: 'danger',
        disabled: actionLoading === `${contract.id}:reject`,
      });
    }

    if (contract.status === 'APPROVED' && contractPermissions.canSign) {
      actions.push({
        label: 'امضای قرارداد',
        onClick: () => handleStatusAction(contract.id, 'sign'),
        icon: FaSignature,
        tone: 'success',
        disabled: actionLoading === `${contract.id}:sign`,
      });
    }

    return actions;
  };

  return (
    <ErpListPage
      eyebrow="فروش"
      title="قراردادهای فروش"
      actions={[
        { label: 'ثبت قرارداد', href: '/dashboard/sales/contracts/create', icon: FaPlus, tone: 'primary', variant: 'solid' },
        { label: 'ایجاد قرارداد همکاری', href: '/dashboard/sales/contracts/collaboration/create', icon: FaPlus, tone: 'info', variant: 'outline' }
      ]}
      metrics={metrics}
      filters={[
        {
          id: 'search',
          label: 'جستجو',
          type: 'search',
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'جستجو در شماره قرارداد، مشتری، ثبت‌کننده، شرکت یا مدیر پروژه...',
        },
        {
          id: 'status',
          label: 'وضعیت',
          type: 'select',
          value: statusFilter,
          onChange: changeStatusFilter,
          options: statusOptions,
        },
      ]}
      rows={filteredContracts}
      rowKey={(contract) => contract.id}
      columns={columns}
      rowActions={getRowActions}
      isLoading={loading}
      footer={
        filteredContracts.length > 0 ? (
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">
              {contracts.length.toLocaleString('fa-IR')} از {pagination.total.toLocaleString('fa-IR')} قرارداد نمایش داده شده است
            </p>
            {hasMoreContracts && (
              <ErpPressable
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-[var(--sds-accent)]/25 bg-[var(--sds-surface-raised)] px-4 py-2 text-sm font-semibold text-[var(--sds-accent)] transition hover:bg-[var(--sds-accent)]/5 disabled:cursor-not-allowed disabled:opacity-60 dark:border-[var(--sds-border-strong)] dark:bg-[var(--sds-surface-raised)] dark:text-[var(--sds-accent)] dark:hover:bg-[var(--sds-accent-surface)]"
              >
                {loadingMore ? (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                ) : (
                  <FaChevronDown className="h-4 w-4" />
                )}
                نمایش قراردادهای بیشتر
              </ErpPressable>
            )}
          </div>
        ) : null
      }
      emptyState={
        <ErpEmptyState
          icon={FaFileContract}
          title={searchTerm || statusFilter !== 'ALL' ? 'قراردادی با این فیلتر یافت نشد' : 'هنوز قراردادی ثبت نشده است'}
          description="با ثبت قرارداد جدید، وضعیت تایید، امضا، چاپ و مبلغ آن همین‌جا قابل پیگیری است."
          action={{ label: 'ایجاد قرارداد جدید', href: '/dashboard/sales/contracts/create', icon: FaPlus, tone: 'primary', variant: 'solid' }}
        />
      }
    />
  );
}
