'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaMoneyCheckAlt, FaSync } from 'react-icons/fa';
import { ErpCard, ErpEmptyState, ErpInlineState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money, PartnerAccountingIdentity, accountingFailureMessage } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';
import { accountingEventInstant, partnerAccountingTimeFields } from '@/features/accounting/accountingEventTime';
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
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0);

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
    const version = ++requestVersion.current;
    setRows([]); setFocus(null); setCheckTarget(null); setLoadError(null);
    try {
      setLoading(true);
      const response = await accountingAPI.getPayments({
        view: query.view || undefined,
        due: query.due || undefined,
        period: query.period || undefined,
        date: query.date || undefined,
        cutoff: query.cutoff || undefined,
        recordId: query.recordId || undefined,
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
        setFocus(response.data.data?.focus || null);
      }
    } catch (error) {
      if (version !== requestVersion.current) return;
      setPagination(current => ({ ...current, total: 0 }));
      setLoadError(accountingFailureMessage(error, 'دریافت‌ها بارگیری نشد؛ دسترسی و اتصال را بررسی کنید و دوباره به‌روزرسانی کنید.'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [pagination.pageSize, query.cutoff, query.date, query.due, query.page, query.period, query.recordId, query.search, query.status, query.view]);

  useEffect(() => {
    loadRows();
    return () => { requestVersion.current += 1; };
  }, [loadRows]);

  const updateCheck = async (values: Record<string, string | number>) => {
    if (!checkTarget) return;
    try {
      setActionError(null);
      setActionLoading(`${checkTarget.row.id}:${checkTarget.status}`);
      await accountingAPI.executeAction({
        kind: checkTarget.status === 'REVERSE_RECEIPT' ? 'REVERSE_RECEIPT' : 'UPDATE_CHECK_STATUS',
        paymentEventId: checkTarget.row.id,
        ...(checkTarget.status !== 'REVERSE_RECEIPT' ? { status: checkTarget.status } : { reason: String(values.reason || '') }),
        occurredAt: checkTarget.row.sourceKind === 'PARTNER_INTERNAL_RECORD'
          ? accountingEventInstant({ timing: values.timing, date: values.eventDate, time: values.eventTime })
          : PersianCalendar.toGregorian(String(values.occurredAt)).toISOString(),
        note: String(values.note || ''),
      });
      setCheckTarget(null);
      await loadRows();
    } catch (error) {
      console.error('Error updating check:', error);
      setActionError(accountingFailureMessage(error, error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
        ? error.message : 'ثبت تغییر دریافت انجام نشد؛ اطلاعات و مجوز خود را بررسی کنید.'));
    } finally {
      setActionLoading(null);
    }
  };

  const columns: ErpColumn<any>[] = [
    { id: 'payment', header: 'دریافت / چک', priority: 'primary', cell: (row) => <div><p className="font-semibold">{row.method === 'CHECK' ? `چک ${row.checkNumber || ''}` : 'دریافت'}</p>
      {row.sourceKind === 'PARTNER_INTERNAL_RECORD' ? <PartnerAccountingIdentity context={row.partnerContext} />
        : <p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.contractNumber || row.contractId || '—'} · {row.contract?.customer?.displayName || 'مشتری ثبت نشده'}</p>}</div> },
    { id: 'amount', header: 'مبلغ', mobileLabel: 'مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.collectionEffectAmount ?? row.amount, row.currency) },
    { id: 'due', header: query.view === 'received' ? 'تاریخ اثر' : 'سررسید چک', mobileLabel: query.view === 'received' ? 'تاریخ اثر' : 'سررسید چک', priority: 'meta', cell: (row) => dateFa(row.collectionEffectiveAt || row.checkDueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'secondary', cell: (row) => <StatusBadge status={row.checkStatus || row.status} /> },
  ];

  const rowActions = (row: any): ErpAction[] => row.sourceKind === 'PARTNER_INTERNAL_RECORD'
    ? [
      ...(row.partnerActions?.checkStatuses || []).map((status: string): ErpAction => ({
        label: ({ RECEIVED: 'دریافت شد', DEPOSITED: 'واگذار شد', CLEARED: 'وصول شد', BOUNCED: 'برگشت خورد', RETURNED: 'عودت چک' } as Record<string, string>)[status],
        icon: FaMoneyCheckAlt, tone: ['BOUNCED', 'RETURNED'].includes(status) ? 'danger' : 'info',
        disabled: Boolean(actionLoading), onClick: () => { setActionError(null); setCheckTarget({ row, status }); },
      })),
      ...(row.partnerActions?.reverseReceipt ? [{ label: 'برگشت دریافت', icon: FaMoneyCheckAlt, tone: 'danger' as const,
        disabled: Boolean(actionLoading), onClick: () => { setActionError(null); setCheckTarget({ row, status: 'REVERSE_RECEIPT' }); } }] : []),
    ] : row.method === 'CHECK'
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
      {loadError && <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش دوباره', onClick: loadRows }} />}
      {focus?.state === 'missing' && <ErpInlineState kind="stale" title="این رکورد دریافت دیگر در دسترس نیست؛ فهرست، وضعیت فعلی را نشان می‌دهد." />}
      {focus?.state === 'current-truth' && <ErpInlineState kind="stale" title="وضعیت دریافت تغییر کرده است؛ رکورد فعلی بدون تغییر جمعیت فیلترشده بازیابی شد." />}
      {(focus?.state === 'current-truth' || (focus?.state === 'focused' && !focus.inPage)) && focus.record && (
        <ErpCard className="p-4">
          <p className="font-semibold text-[var(--sds-text-primary)]">{focus.record.checkNumber ? `چک ${focus.record.checkNumber}` : 'دریافت'}</p>
          {focus.record.sourceKind === 'PARTNER_INTERNAL_RECORD' && <PartnerAccountingIdentity context={focus.record.partnerContext} />}
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--sds-text-secondary)]">
            <span>{money(focus.record.amount, focus.record.currency)}</span>
            <StatusBadge status={focus.record.checkStatus || focus.record.status} />
          </div>
        </ErpCard>
      )}
      {focus?.state === 'focused' && <ErpInlineState kind="success" title="رکورد دریافت پیوندشده در جمعیت فعلی پیدا شد." />}
      <AccountingActionModal
        open={Boolean(checkTarget)}
        title={checkTarget?.status === 'REVERSE_RECEIPT' ? 'برگشت دریافت' : checkTarget?.status === 'RETURNED' ? 'عودت چک' : 'به‌روزرسانی وضعیت چک'}
        description={checkTarget?.row.sourceKind === 'PARTNER_INTERNAL_RECORD'
          ? `پرونده ${checkTarget.row.partnerContext?.caseNumber} · ${money(checkTarget.row.amount, checkTarget.row.currency)}${['RETURNED', 'REVERSE_RECEIPT'].includes(checkTarget.status) ? ' — با تأیید این اقدام، اثر وصول برگشت می‌خورد و مانده حساب به‌روزرسانی می‌شود.' : ''}`
          : checkTarget ? `چک ${checkTarget.row.checkNumber || ''} - ${checkTarget.row.contract?.contractNumber || ''}` : undefined}
        fields={[
          ...(checkTarget?.row.sourceKind === 'PARTNER_INTERNAL_RECORD' ? partnerAccountingTimeFields
            : [{ id: 'occurredAt', label: 'تاریخ رخداد', type: 'date' as const, required: true }]),
          checkTarget?.status === 'REVERSE_RECEIPT' ? { id: 'reason', label: 'دلیل برگشت دریافت', type: 'textarea', required: true }
            : { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel={checkTarget?.status === 'REVERSE_RECEIPT' ? 'تأیید برگشت دریافت' : checkTarget?.status === 'RETURNED' ? 'تأیید عودت چک' : 'ثبت وضعیت'}
        destructive={['RETURNED', 'BOUNCED', 'REVERSE_RECEIPT'].includes(checkTarget?.status || '')}
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setCheckTarget(null)}
        onSubmit={updateCheck}
      />
    </ErpListPage>
  );
}
