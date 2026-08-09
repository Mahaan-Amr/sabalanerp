'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaMoneyCheckAlt, FaSync } from 'react-icons/fa';
import { ErpCard, ErpEmptyState, ErpInlineState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';
import { canonicalizePaymentsQuery, patchPaymentsQuery, type PaymentsQueryState } from '@/features/accounting/accountingQueryState';

const checkStatusOptions = [
  { label: 'همه چک‌ها', value: 'ALL' },
  { label: 'در انتظار تحویل', value: 'PENDING_HANDOVER' },
  { label: 'دریافت شده', value: 'RECEIVED' },
  { label: 'واگذار شده', value: 'DEPOSITED' },
  { label: 'وصول شده', value: 'CLEARED' },
  { label: 'برگشت خورده', value: 'BOUNCED' },
  { label: 'عودت‌شده', value: 'RETURNED' },
  { label: 'جایگزین‌شده', value: 'REPLACED' },
];

const dueOptions = [
  { label: 'همه سررسیدها', value: '' },
  { label: 'سررسید گذشته', value: 'overdue' },
  { label: 'امروز تا ۷ روز آینده', value: 'next7' },
  { label: '۸ تا ۳۰ روز آینده', value: 'days8to30' },
  { label: 'بیش از ۳۰ روز آینده', value: 'later30' },
];

const periodOptions = () => {
  const [year, month] = PersianCalendar.now().slice(0, 7).replace('/', '-').split('-').map(Number);
  return Array.from({ length: 13 }, (_, index) => {
    const monthIndex = (year * 12) + month - 1 - index;
    const value = `${Math.floor(monthIndex / 12)}-${String((monthIndex % 12) + 1).padStart(2, '0')}`;
    return { label: value.replace('-', '/'), value };
  });
};

export default function AccountingPaymentsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizePaymentsQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [focus, setFocus] = useState<any | null>(null);
  const [checkTarget, setCheckTarget] = useState<{ row: any; status: string } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizePaymentsQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<PaymentsQueryState>) => {
    replaceQuery(patchPaymentsQuery(new URLSearchParams(searchParams.toString()), patch));
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
      const response = await accountingAPI.getPayments({
        view: query.view || undefined,
        due: query.due || undefined,
        period: query.period || undefined,
        date: query.date || undefined,
        recordId: query.recordId || undefined,
        search: query.search || undefined,
        status: query.status,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
        setFocus(response.data.data?.focus || null);
      }
    } catch (error) {
      console.error('Error loading payments:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, query.date, query.due, query.page, query.period, query.recordId, query.search, query.status, query.view]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const updateCheck = async (values: Record<string, string | number>) => {
    if (!checkTarget) return;
    try {
      setActionError(null);
      setActionLoading(`${checkTarget.row.id}:${checkTarget.status}`);
      await accountingAPI.executeAction({
        kind: 'UPDATE_CHECK_STATUS',
        paymentEventId: checkTarget.row.id,
        status: checkTarget.status,
        occurredAt: PersianCalendar.toGregorian(String(values.occurredAt)).toISOString(),
        note: String(values.note || ''),
      });
      setCheckTarget(null);
      await loadRows();
    } catch (error) {
      console.error('Error updating check:', error);
      setActionError((error as any)?.response?.data?.error || 'به‌روزرسانی وضعیت چک انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'payment', header: 'دریافت / چک', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.method === 'CHECK' ? `چک ${row.checkNumber || ''}` : 'دریافت'}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p></div> },
    { id: 'amount', header: 'مبلغ', mobileLabel: 'مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.collectionEffectAmount ?? row.amount, row.currency) },
    { id: 'due', header: query.view === 'received' ? 'تاریخ اثر' : 'سررسید چک', mobileLabel: query.view === 'received' ? 'تاریخ اثر' : 'سررسید چک', priority: 'meta', cell: (row) => dateFa(row.collectionEffectiveAt || row.checkDueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.checkStatus || row.status} /> },
  ];

  const rowActions = (row: any): ErpAction[] => row.method === 'CHECK'
    ? [
        { label: 'واگذار شد', icon: FaMoneyCheckAlt, tone: 'info', disabled: actionLoading === `${row.id}:DEPOSITED`, onClick: () => setCheckTarget({ row, status: 'DEPOSITED' }) },
        { label: 'وصول شد', icon: FaMoneyCheckAlt, tone: 'success', disabled: actionLoading === `${row.id}:CLEARED`, onClick: () => setCheckTarget({ row, status: 'CLEARED' }) },
        { label: 'برگشت خورد', icon: FaMoneyCheckAlt, tone: 'danger', disabled: actionLoading === `${row.id}:BOUNCED`, onClick: () => setCheckTarget({ row, status: 'BOUNCED' }) },
      ]
    : [];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="دریافت‌ها و چک‌ها"
      description="پیگیری وضعیت دریافت نقدی، کارت، حواله و چک بدون تغییر دادن برنامه پرداخت ثبت شده در فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'checkStatus', label: 'وضعیت چک', type: 'select', value: query.status, onChange: (value) => updateQuery({ status: value }), options: checkStatusOptions },
        { id: 'due', label: 'سررسید', type: 'select', value: query.due, onChange: (value) => updateQuery({ due: value }), options: dueOptions },
        ...(query.view === 'received' ? [{ id: 'period', label: 'دوره مالی', type: 'select' as const, value: query.period, onChange: (value: string) => updateQuery({ period: value }), options: periodOptions() }] : []),
      ]}
      rows={rows}
      rowKey={(row) => row.projectionId || row.id}
      focusedRowKey={focus?.state === 'focused' && focus.inPage ? (rows.find((row) => row.id === query.recordId)?.projectionId || query.recordId) : undefined}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="دریافت" />}
      emptyState={<ErpEmptyState icon={FaMoneyCheckAlt} title="دریافت یا چکی ثبت نشده است" description="دریافت‌ها از پرونده حسابداری قرارداد ثبت و پیگیری می‌شوند." />}
    >
      {focus?.state === 'missing' && <ErpInlineState kind="stale" title="این رکورد دریافت دیگر در دسترس نیست؛ فهرست، وضعیت فعلی را نشان می‌دهد." />}
      {focus?.state === 'current-truth' && <ErpInlineState kind="stale" title="وضعیت دریافت تغییر کرده است؛ رکورد فعلی بدون تغییر جمعیت فیلترشده بازیابی شد." />}
      {(focus?.state === 'current-truth' || (focus?.state === 'focused' && !focus.inPage)) && focus.record && (
        <ErpCard className="p-4">
          <p className="font-semibold text-[var(--sds-text-primary)]">{focus.record.checkNumber ? `چک ${focus.record.checkNumber}` : focus.record.id}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--sds-text-secondary)]">
            <span>{money(focus.record.amount, focus.record.currency)}</span>
            <StatusBadge status={focus.record.checkStatus || focus.record.status} />
          </div>
        </ErpCard>
      )}
      {focus?.state === 'focused' && <ErpInlineState kind="success" title="رکورد دریافت پیوندشده در جمعیت فعلی پیدا شد." />}
      <AccountingActionModal
        open={Boolean(checkTarget)}
        title="به‌روزرسانی وضعیت چک"
        description={checkTarget ? `چک ${checkTarget.row.checkNumber || ''} - ${checkTarget.row.contract?.contractNumber || ''}` : undefined}
        fields={[
          { id: 'occurredAt', label: 'تاریخ رخداد', type: 'date', required: true },
          { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel="ثبت وضعیت"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setCheckTarget(null)}
        onSubmit={updateCheck}
      />
    </ErpListPage>
  );
}
