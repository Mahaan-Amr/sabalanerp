'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  FaCheck,
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
import { sanitizeUiText, sanitizeUiTextWithCandidates } from '@/lib/textSanitizer';

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
}

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

export default function ContractsPage() {
  useWorkspace();
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
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pdfActionLoading, setPdfActionLoading] = useState<string | null>(null);

  useEffect(() => {
    loadContracts();
    loadCurrentUser();
  }, []);

  const loadContracts = async () => {
    try {
      setLoading(true);
      const response = await salesAPI.getContracts();
      if (response.data.success) {
        setContracts(response.data.data);
      }
    } catch (error) {
      console.error('Error loading contracts:', error);
    } finally {
      setLoading(false);
    }
  };

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
    const normalizedSearch = searchTerm.trim().toLowerCase();
    return contracts.filter((contract) => {
      const customerName = `${contract.customer.firstName} ${contract.customer.lastName}`.toLowerCase();
      const companyName = contract.customer.companyName?.toLowerCase() || '';
      const projectManager = contract.customer.projectManagerName?.toLowerCase() || '';
      const creatorSequence = contract.creatorSequenceNumber != null ? String(contract.creatorSequenceNumber) : '';

      const matchesSearch =
        !normalizedSearch ||
        contract.titlePersian.toLowerCase().includes(normalizedSearch) ||
        contract.contractNumber.toLowerCase().includes(normalizedSearch) ||
        creatorSequence.includes(normalizedSearch) ||
        customerName.includes(normalizedSearch) ||
        companyName.includes(normalizedSearch) ||
        projectManager.includes(normalizedSearch);

      const matchesStatus = statusFilter === 'ALL' || contract.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [contracts, searchTerm, statusFilter]);

  const metrics: ErpMetric[] = useMemo(() => {
    const totalAmount = sumNumericValues(filteredContracts, (contract) => contract.totalAmount);
    return [
      { label: 'کل قراردادها', value: contracts.length.toLocaleString('fa-IR'), icon: FaFileContract, tone: 'primary' },
      { label: 'نتایج فعلی', value: filteredContracts.length.toLocaleString('fa-IR'), hint: statusFilter === 'ALL' ? 'همه وضعیت‌ها' : statusLabels[statusFilter], icon: FaEye, tone: 'info' },
      { label: 'در انتظار تایید', value: contracts.filter((contract) => contract.status === 'PENDING_APPROVAL').length.toLocaleString('fa-IR'), icon: FaClock, tone: 'warning' },
      { label: 'مبلغ نتایج', value: formatCurrency(totalAmount, 'تومان'), icon: FaFileContract, tone: 'success' },
    ];
  }, [contracts, filteredContracts, statusFilter]);

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
      const response = await salesAPI.getContractPdf(contractId, { fresh: false });
      if (response.data?.success && response.data?.data?.url) {
        openPdfUrl(response.data.data.url, false);
      }
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
        await loadContracts();
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
            <span className="mt-0.5 inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#074747]/10 text-[#074747] dark:bg-teal-900/30 dark:text-teal-100">
              <StatusIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="break-words font-semibold text-slate-950 dark:text-white">
                {sanitizeUiTextWithCandidates([contract.titlePersian, contract.title, contract.contractNumber], 'قرارداد فروش')}
              </p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
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
          <p className="font-medium text-slate-800 dark:text-slate-100">{getCustomerName(contract)}</p>
          {sanitizeUiText(contract.customer.companyName, '') && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sanitizeUiText(contract.customer.companyName, '')}</p>
          )}
        </div>
      ),
    },
    {
      id: 'amount',
      header: 'مبلغ',
      mobileLabel: 'مبلغ',
      priority: 'secondary',
      align: 'end',
      cell: (contract) => (
        <span className="font-semibold text-[#074747] dark:text-teal-200">
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
  ];

  const getRowActions = (contract: Contract): ErpAction[] => {
    const actions: ErpAction[] = [
      { label: 'مشاهده قرارداد', href: `/dashboard/sales/contracts/${contract.id}`, icon: FaEye, tone: 'primary' },
    ];

    if (contract.status === 'DRAFT') {
      actions.push({ label: 'ویرایش قرارداد', href: `/dashboard/sales/contracts/${contract.id}/edit`, icon: FaEdit, tone: 'info' });
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

    if ((contract.status === 'SIGNED' || contract.status === 'PRINTED') && contractPermissions.canPrint) {
      actions.push({
        label: 'دانلود PDF',
        onClick: () => handleDownloadPdf(contract.id),
        icon: FaDownload,
        tone: 'success',
        disabled: pdfActionLoading === contract.id,
      });
      actions.push({
        label: 'پرینت قرارداد',
        onClick: () => handleStatusAction(contract.id, 'print'),
        icon: FaPrint,
        tone: 'purple',
        disabled: actionLoading === `${contract.id}:print`,
      });
    }

    return actions;
  };

  return (
    <ErpListPage
      eyebrow="فروش"
      title="قراردادهای فروش"
      description="مرور، جستجو، تایید، امضا و چاپ قراردادهای فروش با نمای موبایل‌فرست."
      actions={[{ label: 'ثبت قرارداد', href: '/dashboard/sales/contracts/create', icon: FaPlus, tone: 'primary', variant: 'solid' }]}
      metrics={metrics}
      filters={[
        {
          id: 'search',
          label: 'جستجو',
          type: 'search',
          value: searchTerm,
          onChange: setSearchTerm,
          placeholder: 'جستجو در شماره قرارداد، مشتری، شرکت یا مدیر پروژه...',
        },
        {
          id: 'status',
          label: 'وضعیت',
          type: 'select',
          value: statusFilter,
          onChange: setStatusFilter,
          options: statusOptions,
        },
      ]}
      rows={filteredContracts}
      rowKey={(contract) => contract.id}
      columns={columns}
      rowActions={getRowActions}
      isLoading={loading}
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
