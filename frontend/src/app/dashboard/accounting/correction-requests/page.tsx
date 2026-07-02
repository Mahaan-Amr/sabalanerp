'use client';

import { useCallback, useEffect, useState } from 'react';
import { FaCheckCircle, FaEdit, FaExclamationTriangle, FaEye, FaSync } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'باز', value: 'OPEN' },
  { label: 'در جریان', value: 'ACKNOWLEDGED' },
  { label: 'بسته شده', value: 'RESOLVED' },
  { label: 'لغو شده', value: 'CANCELLED' },
];

export default function AccountingCorrectionRequestsPage() {
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadRows = useCallback(async (page = 1) => {
    try {
      setLoading(true);
      const response = await accountingAPI.getCorrectionRequests({ search, status, page, pageSize: pagination.pageSize });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading correction requests:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, search, status]);

  useEffect(() => {
    loadRows(1);
  }, [loadRows]);

  const resolveCorrection = async (values: Record<string, string | number>) => {
    if (!resolveTarget) return;
    setActionLoading(resolveTarget.id);
    try {
      setActionError(null);
      await accountingAPI.executeAction({
        kind: 'RESOLVE_CORRECTION',
        correctionRequestId: resolveTarget.id,
        resolutionNote: String(values.resolutionNote || '').trim() || undefined,
      });
      setResolveTarget(null);
      await loadRows(pagination.page);
    } catch (error) {
      console.error('Resolve correction failed:', error);
      setActionError((error as any)?.response?.data?.error || 'بستن درخواست اصلاح انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const rowActions = (row: any): ErpAction[] => [
    ...(row.contractId ? [
      { label: 'مشاهده پرونده', href: `/dashboard/accounting/contracts/${row.contractId}`, icon: FaEye, tone: 'primary' as const },
      ...(!row.accountingEditLocked ? [{ label: 'ویرایش فروش', href: `/dashboard/sales/contracts/${row.contractId}/edit`, icon: FaEdit, tone: 'info' as const }] : []),
    ] : []),
    {
      label: 'بستن اصلاح',
      icon: FaCheckCircle,
      tone: 'success',
      disabled: !['OPEN', 'ACKNOWLEDGED'].includes(row.status) || actionLoading === row.id,
      onClick: () => setResolveTarget(row),
    },
  ];

  const columns: ErpColumn<any>[] = [
    { id: 'request', header: 'درخواست اصلاح', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.accountantNote}</p><p className="mt-1 text-xs text-slate-500">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p></div> },
    { id: 'category', header: 'دسته', mobileLabel: 'دسته', priority: 'secondary', cell: (row) => row.category },
    { id: 'priority', header: 'اولویت', mobileLabel: 'اولویت', priority: 'secondary', cell: (row) => row.priority },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'date', header: 'ثبت', mobileLabel: 'ثبت', priority: 'meta', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="درخواست‌های اصلاح"
      description="اصلاحیه‌های سبک برای برگشت دادن نقص‌های مشتری، مبلغ، پرداخت، تحویل، مالیات یا اسناد به فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(pagination.page), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: search, onChange: setSearch, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'status', label: 'وضعیت', type: 'select', value: status, onChange: setStatus, options: statusOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={loadRows} itemLabel="درخواست" />}
      emptyState={<ErpEmptyState icon={FaExclamationTriangle} title="درخواست اصلاح بازی وجود ندارد" description="از رجیستر قراردادها یا پرونده قرارداد می‌توانید درخواست اصلاح ثبت کنید." />}
    >
      <AccountingActionModal
        open={Boolean(resolveTarget)}
        title="بستن درخواست اصلاح"
        description={resolveTarget?.accountantNote}
        fields={[{ id: 'resolutionNote', label: 'یادداشت بستن درخواست', type: 'textarea', required: true }]}
        submitLabel="بستن اصلاح"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setResolveTarget(null)}
        onSubmit={resolveCorrection}
      />
    </ErpListPage>
  );
}
