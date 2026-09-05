'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaCheckCircle, FaEye, FaFileInvoice, FaSync, FaTrashAlt } from 'react-icons/fa';
import { ErpEmptyState, ErpInlineState, ErpListPage, ErpPagination, ErpSheet, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import PersianCalendar from '@/lib/persian-calendar';
import { emptyAccountingPagination, FinancialInvoiceApprovalForm, type FinancialInvoiceApprovalPayload,
  readAccountingListResponse, StatusBadge, dateFa, money, PartnerAccountingIdentity, accountingFailureMessage } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import {
  canonicalizeInvoiceCandidatesQuery,
  patchInvoiceCandidatesQuery,
  type InvoiceCandidatesQueryState,
} from '@/features/accounting/accountingQueryState';

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'پیش‌نویس', value: 'DRAFT' },
  { label: 'آماده', value: 'READY' },
  { label: 'تأییدشده برای صدور', value: 'APPROVED_FOR_ISSUE' },
  { label: 'صادر شده', value: 'ISSUED' },
  { label: 'ثبت‌شده', value: 'POSTED' },
  { label: 'باطل شده', value: 'VOIDED' },
  { label: 'نیازمند اصلاح', value: 'NEEDS_CORRECTION' },
];

const buildPersianPeriodOptions = (selectedPeriod: string) => {
  const currentPeriod = PersianCalendar.now().slice(0, 7).replace('/', '-');
  const [baseYear, baseMonth] = (selectedPeriod || currentPeriod).split('-').map(Number);
  return Array.from({ length: 13 }, (_, index) => {
    const monthIndex = (baseYear * 12) + (baseMonth - 1) + 6 - index;
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    const value = `${year}-${String(month).padStart(2, '0')}`;
    return { value, label: value.replace('-', '/') };
  }).filter((option) => /^1[2-7]\d{2}-/.test(option.value));
};

export default function AccountingInvoiceCandidatesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizeInvoiceCandidatesQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const periodOptions = useMemo(() => buildPersianPeriodOptions(query.period), [query.period]);
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [approvalTarget, setApprovalTarget] = useState<any | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizeInvoiceCandidatesQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<InvoiceCandidatesQueryState>) => {
    replaceQuery(patchInvoiceCandidatesQuery(new URLSearchParams(searchParams.toString()), patch));
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
    const version = ++requestVersion.current;
    setRows([]); setDeleteTarget(null); setApprovalTarget(null); setLoadError(null);
    try {
      setLoading(true);
      const response = await accountingAPI.getFinancialRecords({
        kind: 'INVOICE_CANDIDATE',
        view: query.view || undefined,
        period: query.period || undefined,
        date: query.date || undefined,
        cutoff: query.cutoff || undefined,
        search: query.search || undefined,
        status: query.status,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (version !== requestVersion.current) return;
      if (!response.data.success) throw new Error('Accounting read failed');
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      setPagination(current => ({ ...current, total: 0 }));
      setLoadError(accountingFailureMessage(error, 'صورتحساب‌ها بارگیری نشد؛ دسترسی و اتصال را بررسی کنید و دوباره به‌روزرسانی کنید.'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [pagination.pageSize, query.cutoff, query.date, query.page, query.period, query.search, query.status, query.view]);

  useEffect(() => {
    loadRows();
    return () => { requestVersion.current += 1; };
  }, [loadRows]);

  const deleteDraftRecord = async (row: any) => {
    setActionError(null);
    setActionLoading(row.id);
    try {
      await accountingAPI.executeAction({
        kind: 'DELETE_DRAFT_ACCOUNTING_RECORD',
        recordId: row.id,
        note: 'Deleted draft from invoice candidates register',
      });
      setDeleteTarget(null);
      await loadRows();
    } catch (error) {
      console.error('Delete draft accounting record failed:', error);
      setActionError((error as any)?.response?.data?.error || 'حذف پیش‌نویس رکورد مالی انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const approveFinancialInvoice = async (payload: FinancialInvoiceApprovalPayload) => {
    if (!approvalTarget) return;
    setActionError(null);
    setActionSuccess(null);
    setActionLoading(approvalTarget.id);
    try {
      await accountingAPI.executeAction({ kind: 'APPROVE_FINANCIAL_INVOICE', ...payload });
      setApprovalTarget(null);
      setActionSuccess('عملیات حسابداری با موفقیت ثبت شد');
      await loadRows();
    } catch (error) {
      console.error('Financial invoice approval failed:', error);
      setActionError((error as any)?.response?.data?.error || (error as any)?.response?.data?.message || 'تایید مالی انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const rowActions = (row: any): ErpAction[] => [
    ...(row.contractId ? [{ label: 'مشاهده پرونده', href: `/dashboard/accounting/contracts/${row.contractId}`, icon: FaEye, tone: 'primary' as const }] : []),
    {
      label: 'تایید مالی',
      icon: FaCheckCircle,
      tone: 'success',
      disabled: ['ISSUED', 'POSTED', 'VOIDED'].includes(row.status) || actionLoading === row.id,
      onClick: () => { setActionError(null); setActionSuccess(null); setApprovalTarget(row); },
    },
    {
      label: 'حذف پیش‌نویس',
      icon: FaTrashAlt,
      tone: 'danger',
      disabled: row.sourceKind === 'PARTNER_INTERNAL_RECORD' || row.status !== 'DRAFT' || actionLoading === row.id,
      onClick: () => setDeleteTarget(row),
    },
  ];

  const columns: ErpColumn<any>[] = [
    {
      id: 'invoice',
      header: 'پیش‌نویس صورتحساب',
      priority: 'primary',
      cell: (row) => row.sourceKind === 'PARTNER_INTERNAL_RECORD' ? <PartnerAccountingIdentity context={row.partnerContext} /> : (
        <div>
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{row.id}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">قرارداد: {row.contract?.contractNumber || row.contractId || '—'}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p>
        </div>
      ),
    },
    { id: 'amount', header: 'مبلغ', mobileLabel: 'مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.amount, row.currency) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.status} /> },
    { id: 'items', header: 'اقلام', mobileLabel: 'اقلام', priority: 'meta', cell: (row) => (row.sourceKind === 'PARTNER_INTERNAL_RECORD'
      ? row.sourceSnapshot?.partnerPreparation?.products?.length ?? 0 : row.invoiceItems?.length || 0).toLocaleString('fa-IR') },
    { id: 'date', header: 'تاریخ ایجاد', mobileLabel: 'تاریخ ایجاد', priority: 'meta', cell: (row) => dateFa(row.createdAt) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title={query.view === 'invoiced' ? 'صورتحساب‌های دوره مالی' : 'پیش‌نویس صورتحساب‌ها'}
      description={query.view === 'invoiced'
        ? `رکوردهای مؤثر در رویدادهای مالی${query.period ? ` دوره شمسی ${query.period.replace('-', '/')}` : ''}.`
        : 'صورتحساب‌های پیشنهادی که حسابداری از قراردادهای تایید شده، امضا شده یا چاپ شده ایجاد کرده است.'}
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'status', label: 'وضعیت', type: 'select', value: query.status, onChange: (value) => updateQuery({ status: value }), options: statusOptions },
        ...(query.view === 'invoiced' ? [{
          id: 'period',
          label: 'دوره مالی شمسی',
          type: 'select' as const,
          value: query.period,
          onChange: (value: string) => updateQuery({ period: value }),
          options: periodOptions,
        }] : []),
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="رکورد" />}
      emptyState={<ErpEmptyState icon={FaFileInvoice} title="صورتحسابی در این فیلتر وجود ندارد" description="این نتیجه خالی، جمعیت انتخاب‌شده در داشبورد یا فیلترهای فعلی را نشان می‌دهد." />}
    >
      {actionSuccess && <ErpInlineState kind="success" title={actionSuccess} />}
      {loadError && <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش دوباره', onClick: loadRows }} />}
      {actionError && !deleteTarget && !approvalTarget && <ErpInlineState kind="error" title={actionError} />}
      <ErpSheet open={Boolean(approvalTarget)} onClose={() => setApprovalTarget(null)} title="تایید مالی صورتحساب"
        presentation="modal" pending={Boolean(actionLoading)}>
        {actionError && <ErpInlineState kind="error" title={actionError} />}
        <FinancialInvoiceApprovalForm invoice={approvalTarget} busy={Boolean(actionLoading)} compact
          onApprove={approveFinancialInvoice} />
      </ErpSheet>
      <AccountingActionModal
        open={Boolean(deleteTarget)}
        title="حذف پیش‌نویس رکورد مالی"
        description="فقط پیش‌نویس‌های تایید نشده و بدون رکورد پایین‌دستی حذف می‌شوند. این اقدام در سوابق حسابداری ثبت می‌شود."
        fields={[{ id: 'note', label: 'یادداشت حذف', type: 'textarea', defaultValue: 'Deleted draft from invoice candidates register' }]}
        submitLabel="حذف پیش‌نویس"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setDeleteTarget(null)}
        onSubmit={(values) => deleteDraftRecord({ ...deleteTarget, note: String(values.note || '') })}
      />
    </ErpListPage>
  );
}
