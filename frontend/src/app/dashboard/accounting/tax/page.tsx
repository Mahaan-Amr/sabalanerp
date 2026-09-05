'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaBalanceScale, FaCheck, FaSync, FaTimes } from 'react-icons/fa';
import { ErpEmptyState, ErpInlineState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money, taxStatusLabels,
  PartnerAccountingIdentity, accountingFailureMessage } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';
import { accountingEventInstant, partnerAccountingTimeFields } from '@/features/accounting/accountingEventTime';
import {
  canonicalizeTaxQuery,
  patchTaxQuery,
  type StatusDrilldownQueryState,
} from '@/features/accounting/accountingQueryState';

const submissionStatusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'آماده نیست', value: 'NOT_READY' },
  { label: 'آماده', value: 'READY' },
  { label: 'ثبت دستی', value: 'SUBMITTED_MANUALLY' },
  { label: 'پذیرفته شده', value: 'ACCEPTED' },
  { label: 'رد شده', value: 'REJECTED' },
  { label: 'نیازمند اصلاح', value: 'NEEDS_CORRECTION' },
];

export default function AccountingTaxPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizeTaxQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [trackTarget, setTrackTarget] = useState<{ row: any; status: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizeTaxQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<StatusDrilldownQueryState<'needs-attention'>>) => {
    replaceQuery(patchTaxQuery(new URLSearchParams(searchParams.toString()), patch));
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
    setRows([]); setTrackTarget(null); setLoadError(null);
    try {
      setLoading(true);
      const response = await accountingAPI.getTaxRecords({
        view: query.view || undefined,
        search: query.search || undefined,
        status: query.status,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (version !== requestVersion.current) return;
      if (!response.data.success) throw new Error('داده‌های مالیاتی دریافت نشد.');
      {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      setPagination(previous => ({ ...previous, total: 0 }));
      setLoadError(accountingFailureMessage(error, 'اطلاعات مالیاتی در دسترس نیست؛ دوباره تلاش کنید.'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [pagination.pageSize, query.page, query.search, query.status, query.view]);

  useEffect(() => {
    loadRows();
    return () => { requestVersion.current += 1; };
  }, [loadRows]);

  const track = async (values: Record<string, string | number>) => {
    if (!trackTarget) return;
    try {
      setActionError(null);
      setActionLoading(`${trackTarget.row.id}:${trackTarget.status}`);
      await accountingAPI.executeAction({
        kind: 'TRACK_TAX_SUBMISSION',
        invoiceId: trackTarget.row.invoiceRecordId,
        status: trackTarget.status,
        trackingCode: String(values.trackingCode || ''),
        rejectionReason: String(values.rejectionReason || ''),
        note: String(values.note || ''),
        submittedAt: trackTarget.row.sourceKind === 'PARTNER_INTERNAL_RECORD'
          ? ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(trackTarget.status)
            ? accountingEventInstant({ timing: values.timing, date: values.eventDate, time: values.eventTime }) : undefined
          : values.submittedAt ? PersianCalendar.toGregorian(String(values.submittedAt)).toISOString() : new Date().toISOString(),
      });
      setTrackTarget(null);
      await loadRows();
    } catch (error) {
      setActionError(accountingFailureMessage(error, 'به‌روزرسانی مالیات انجام نشد'));
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'tax', header: 'پرونده مالیاتی', priority: 'primary', cell: (row) => row.sourceKind === 'PARTNER_INTERNAL_RECORD'
      ? <PartnerAccountingIdentity context={row.partnerContext} />
      : <div><p className="font-semibold">{taxStatusLabels[row.submissionStatus] || row.submissionStatus}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p></div> },
    { id: 'taxable', header: 'مشمول مالیات', mobileLabel: 'مشمول مالیات', priority: 'secondary', align: 'end', cell: (row) => row.sourceKind === 'PARTNER_INTERNAL_RECORD' ? 'تفکیک مالیاتی ثبت نشده' : money(row.taxableAmount) },
    { id: 'vat', header: 'ارزش افزوده', mobileLabel: 'ارزش افزوده', priority: 'secondary', align: 'end', cell: (row) => row.sourceKind === 'PARTNER_INTERNAL_RECORD'
      ? 'تفکیک مالیاتی ثبت نشده' : money(row.vatAmount) },
    ...(rows.some(row => row.sourceKind === 'PARTNER_INTERNAL_RECORD') ? [{ id: 'partnerTax', header: 'مالیات منبع همکار',
      mobileLabel: 'مالیات منبع همکار', priority: 'secondary' as const, align: 'end' as const,
      cell: (row: any) => row.sourceKind === 'PARTNER_INTERNAL_RECORD' ? money(row.partnerFinancialSource?.tax, row.partnerFinancialSource?.currency) : '—' }] : []),
    { id: 'missing', header: 'کسری اطلاعات', mobileLabel: 'کسری اطلاعات', priority: 'meta', cell: (row) => row.missingFields?.length ? row.missingFields.join('، ') : '—' },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.submissionStatus} /> },
    { id: 'date', header: 'آخرین تغییر', mobileLabel: 'آخرین تغییر', priority: 'meta', cell: (row) => dateFa(row.updatedAt) },
  ];

  const rowActions = (row: any): ErpAction[] => row.sourceKind === 'PARTNER_INTERNAL_RECORD'
    ? (row.partnerActions?.taxStatuses || []).map((status: string) => ({ label: taxStatusLabels[status],
      tone: status === 'REJECTED' ? 'danger' : 'info', disabled: Boolean(actionLoading),
      onClick: () => { setActionError(null); setTrackTarget({ row, status }); } })) : [
    { label: 'ثبت دستی', icon: FaBalanceScale, tone: 'info', disabled: actionLoading === `${row.id}:SUBMITTED_MANUALLY`, onClick: () => setTrackTarget({ row, status: 'SUBMITTED_MANUALLY' }) },
    { label: 'پذیرفته شد', icon: FaCheck, tone: 'success', disabled: actionLoading === `${row.id}:ACCEPTED`, onClick: () => setTrackTarget({ row, status: 'ACCEPTED' }) },
    { label: 'رد شد', icon: FaTimes, tone: 'danger', disabled: actionLoading === `${row.id}:REJECTED`, onClick: () => setTrackTarget({ row, status: 'REJECTED' }) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="مالیات و سامانه مودیان"
      description="آمادگی اطلاعات مالیاتی و پیگیری دستی وضعیت ارسال، پذیرش یا رد صورتحساب در سامانه مودیان."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'submissionStatus', label: 'وضعیت مالیات', type: 'select', value: query.status, onChange: (value) => updateQuery({ status: value }), options: submissionStatusOptions },
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="پرونده" />}
      emptyState={<ErpEmptyState icon={FaBalanceScale} title="پرونده مالیاتی ثبت نشده است" description="با ایجاد پیش‌نویس صورتحساب، پرونده مالیاتی و آمادگی سامانه مودیان ایجاد می‌شود." />}
    >
      {loadError && <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش دوباره', onClick: loadRows }} />}
      <AccountingActionModal
        open={Boolean(trackTarget)}
        title="پیگیری وضعیت سامانه مودیان"
        description={trackTarget ? `${trackTarget.row.partnerContext?.caseNumber || trackTarget.row.contract?.contractNumber || 'قرارداد'} - ${taxStatusLabels[trackTarget.status] || trackTarget.status}` : undefined}
        fields={[
          { id: 'trackingCode', label: 'کد پیگیری یا شماره مرجع', type: 'text', required: ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(trackTarget?.status || ''), defaultValue: trackTarget?.row?.trackingCode || '' },
          ...(trackTarget?.row.sourceKind === 'PARTNER_INTERNAL_RECORD'
            ? ['SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY'].includes(trackTarget.status) ? partnerAccountingTimeFields : []
            : [{ id: 'submittedAt', label: 'تاریخ ارسال', type: 'date' as const, required: trackTarget?.status === 'SUBMITTED_MANUALLY' }]),
          { id: 'rejectionReason', label: 'علت رد', type: 'textarea', required: trackTarget?.status === 'REJECTED' },
          { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel="ثبت پیگیری"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setTrackTarget(null)}
        onSubmit={track}
      />
    </ErpListPage>
  );
}
