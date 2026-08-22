'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaCheckCircle, FaClipboardCheck, FaExclamationTriangle, FaEye, FaSync, FaTimesCircle } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import {
  canonicalizeCorrectionRequestsQuery,
  patchCorrectionRequestsQuery,
  type StatusDrilldownQueryState,
} from '@/features/accounting/accountingQueryState';

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'در انتظار بررسی مدیر', value: 'OPEN' },
  { label: 'در جریان', value: 'ACKNOWLEDGED' },
  { label: 'تایید شده برای اصلاح فروش', value: 'APPROVED_FOR_SALES_EDIT' },
  { label: 'اصلاح شده توسط فروش', value: 'SALES_EDITED' },
  { label: 'بسته شده', value: 'RESOLVED' },
  { label: 'رد یا لغو شده', value: 'CANCELLED' },
];

export default function AccountingCorrectionRequestsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizeCorrectionRequestsQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [approveTarget, setApproveTarget] = useState<any | null>(null);
  const [declineTarget, setDeclineTarget] = useState<any | null>(null);
  const [resolveTarget, setResolveTarget] = useState<any | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionAvailability, setActionAvailability] = useState<any>({});

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizeCorrectionRequestsQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<StatusDrilldownQueryState<'active'>>) => {
    replaceQuery(patchCorrectionRequestsQuery(new URLSearchParams(searchParams.toString()), patch));
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

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getCorrectionRequests({
        view: query.view || undefined,
        search: query.search || undefined,
        status: query.status,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
        setActionAvailability(response.data.data?.actionAvailability || {});
      }
    } catch (error) {
      console.error('Error loading correction requests:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, query.page, query.search, query.status, query.view]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const approveCorrection = async (values: Record<string, string | number>) => {
    if (!approveTarget) return;
    setActionLoading(approveTarget.id);
    try {
      setActionError(null);
      await accountingAPI.executeAction({
        kind: 'APPROVE_CORRECTION_FOR_SALES_EDIT',
        correctionRequestId: approveTarget.id,
        note: String(values.note || '').trim() || undefined,
      });
      setApproveTarget(null);
      await loadRows();
    } catch (error) {
      console.error('Approve correction failed:', error);
      setActionError((error as any)?.response?.data?.error || 'تایید درخواست اصلاح انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const declineCorrection = async (values: Record<string, string | number>) => {
    if (!declineTarget) return;
    setActionLoading(declineTarget.id);
    try {
      setActionError(null);
      await accountingAPI.executeAction({
        kind: 'DECLINE_CORRECTION',
        correctionRequestId: declineTarget.id,
        resolutionNote: String(values.resolutionNote || '').trim(),
      });
      setDeclineTarget(null);
      await loadRows();
    } catch (error) {
      console.error('Decline correction failed:', error);
      setActionError((error as any)?.response?.data?.error || 'رد درخواست اصلاح انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

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
      await loadRows();
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
    ] : []),
    ...(row.accountingDutyId ? [{
      label: 'رسیدگی به درخواست',
      href: `/dashboard/accounting/duties/${row.accountingDutyId}`,
      icon: FaClipboardCheck,
      tone: 'info' as const,
    }] : []),
    ...(!row.requestIdempotencyKey && actionAvailability.approve?.visible ? [{
      label: 'تایید اصلاح فروش',
      icon: FaCheckCircle,
      tone: 'success' as const,
      disabled: row.status !== 'OPEN' || actionLoading === row.id,
      onClick: () => setApproveTarget(row),
    },
    {
      label: 'رد درخواست',
      icon: FaTimesCircle,
      tone: 'danger' as const,
      disabled: !['OPEN', 'APPROVED_FOR_SALES_EDIT'].includes(row.status) || actionLoading === row.id,
      onClick: () => setDeclineTarget(row),
    },
    ] : []),
    ...(!row.requestIdempotencyKey && actionAvailability.verify?.visible ? [{
      label: 'بستن پس از بررسی',
      icon: FaCheckCircle,
      tone: 'success' as const,
      disabled: row.status !== 'SALES_EDITED' || actionLoading === row.id,
      onClick: () => setResolveTarget(row),
    } as ErpAction
    ] : []),
  ];

  const columns: ErpColumn<any>[] = [
    { id: 'request', header: 'درخواست اصلاح', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.accountantNote}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p></div> },
    { id: 'category', header: 'دسته', mobileLabel: 'دسته', priority: 'secondary', cell: (row) => row.category },
    { id: 'priority', header: 'اولویت', mobileLabel: 'اولویت', priority: 'secondary', cell: (row) => row.priority },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'date', header: 'ثبت', mobileLabel: 'ثبت', priority: 'meta', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="بررسی اصلاحات"
      description="درخواست حسابداری پس از تصمیم مدیر به فروش ارجاع می‌شود و نتیجه برای بازبینی نهایی به صف وظایف حسابداری بازمی‌گردد."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'status', label: 'وضعیت', type: 'select', value: query.status, onChange: (value) => updateQuery({ status: value }), options: statusOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="درخواست" />}
      emptyState={<ErpEmptyState icon={FaExclamationTriangle} title="درخواست اصلاح بازی وجود ندارد" description="از رجیستر قراردادها یا پرونده قرارداد می‌توانید درخواست اصلاح ثبت کنید." />}
    >
      <AccountingActionModal
        open={Boolean(approveTarget)}
        title="تایید اصلاح فروش"
        description={approveTarget?.accountantNote}
        fields={[{ id: 'note', label: 'یادداشت تایید', type: 'textarea', required: false }]}
        submitLabel="باز کردن اصلاح فروش"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setApproveTarget(null)}
        onSubmit={approveCorrection}
      />
      <AccountingActionModal
        open={Boolean(declineTarget)}
        title="رد درخواست اصلاح"
        description={declineTarget?.accountantNote}
        fields={[{ id: 'resolutionNote', label: 'دلیل رد', type: 'textarea', required: true }]}
        submitLabel="رد درخواست"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setDeclineTarget(null)}
        onSubmit={declineCorrection}
      />
      <AccountingActionModal
        open={Boolean(resolveTarget)}
        title="بستن درخواست اصلاح پس از بررسی"
        description={resolveTarget?.accountantNote}
        fields={[{ id: 'resolutionNote', label: 'یادداشت بررسی حسابداری', type: 'textarea', required: true }]}
        submitLabel="بستن اصلاح"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setResolveTarget(null)}
        onSubmit={resolveCorrection}
      />
    </ErpListPage>
  );
}
