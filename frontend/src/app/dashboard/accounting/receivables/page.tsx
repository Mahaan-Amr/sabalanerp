'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaReceipt, FaSync } from 'react-icons/fa';
import { ErpCard, ErpEmptyState, ErpInlineState, ErpListPage, ErpPagination, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money, PartnerAccountingIdentity, accountingFailureMessage } from '@/features/accounting/accountingUi';
import AccountingActionModal from '@/features/accounting/AccountingActionModal';
import PersianCalendar from '@/lib/persian-calendar';
import { accountingEventInstant, partnerAccountingTimeFields } from '@/features/accounting/accountingEventTime';
import { readPartnerDecimalInput } from '@/features/partner-sales/presentation';
import { canonicalizeReceivablesQuery, patchReceivablesQuery, type ReceivablesQueryState } from '@/features/accounting/accountingQueryState';

const statusOptions = [
  { label: 'همه وضعیت‌ها', value: 'ALL' },
  { label: 'باز', value: 'OPEN' },
  { label: 'پرداخت بخشی', value: 'PARTIALLY_PAID' },
  { label: 'تسویه شده', value: 'SETTLED' },
  { label: 'سررسید گذشته', value: 'OVERDUE' },
  { label: 'باطل شده', value: 'VOIDED' },
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

export default function AccountingReceivablesPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizeReceivablesQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(query.search);
  const [focus, setFocus] = useState<any | null>(null);
  const [receiptTarget, setReceiptTarget] = useState<any | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const requestVersion = useRef(0);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizeReceivablesQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<ReceivablesQueryState>) => {
    replaceQuery(patchReceivablesQuery(new URLSearchParams(searchParams.toString()), patch));
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
    setRows([]); setFocus(null); setReceiptTarget(null); setLoadError(null);
    try {
      setLoading(true);
      const response = await accountingAPI.getReceivables({
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
      setLoadError(accountingFailureMessage(error, 'دریافتنی‌ها بارگیری نشد؛ دسترسی و اتصال را بررسی کنید و دوباره به‌روزرسانی کنید.'));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [pagination.pageSize, query.cutoff, query.date, query.due, query.page, query.period, query.recordId, query.search, query.status, query.view]);

  useEffect(() => {
    loadRows();
    return () => { requestVersion.current += 1; };
  }, [loadRows]);

  const columns: ErpColumn<any>[] = [
    { id: 'receivable', header: 'دریافتنی', priority: 'primary', cell: (row) => row.sourceKind === 'PARTNER_INTERNAL_RECORD'
      ? <PartnerAccountingIdentity context={row.partnerContext} />
      : <div><p className="font-semibold">{row.contract?.contractNumber || 'دریافتنی قرارداد'}</p><p className="mt-1 text-xs text-[var(--sds-text-secondary)]">{row.contract?.customer?.displayName || row.contractId || '—'}</p></div> },
    { id: 'original', header: 'اصل مبلغ', mobileLabel: 'اصل مبلغ', priority: 'secondary', align: 'end', cell: (row) => money(row.originalAmount, row.currency) },
    { id: 'paid', header: 'پرداخت شده', mobileLabel: 'پرداخت شده', priority: 'secondary', align: 'end', cell: (row) => money(row.paidAmount, row.currency) },
    { id: 'remaining', header: 'مانده', mobileLabel: 'مانده', priority: 'secondary', align: 'end', cell: (row) => <span className="font-semibold text-[var(--sds-accent)] dark:text-[var(--sds-accent)]">{money(row.remainingAmount, row.currency)}</span> },
    { id: 'due', header: 'سررسید', mobileLabel: 'سررسید', priority: 'meta', cell: (row) => dateFa(row.dueDate) },
    { id: 'status', header: 'وضعیت', mobileLabel: 'وضعیت', priority: 'meta', cell: (row) => <StatusBadge status={row.status} /> },
  ];

  const registerReceipt = async (values: Record<string, string | number>) => {
    if (!receiptTarget) return;
    setActionError(null);
    setActionLoading(receiptTarget.id);
    try {
      await accountingAPI.executeAction({
        kind: 'REGISTER_RECEIPT',
        ...(receiptTarget.contractId ? { contractId: receiptTarget.contractId } : {}),
        receivableId: receiptTarget.id,
        method: values.method,
        amount: receiptTarget.sourceKind === 'PARTNER_INTERNAL_RECORD' ? readPartnerDecimalInput(String(values.amount)) : values.amount,
        receivedAt: receiptTarget.sourceKind === 'PARTNER_INTERNAL_RECORD'
          ? accountingEventInstant({ timing: values.timing, date: values.eventDate, time: values.eventTime })
          : PersianCalendar.toGregorian(String(values.receivedAt)).toISOString(),
        note: String(values.note || ''),
        ...(values.method === 'CHECK' ? {
          check: {
            checkNumber: String(values.checkNumber || '').trim(),
            ownerName: String(values.checkOwnerName || '').trim(),
            dueDate: PersianCalendar.toGregorian(String(values.checkDueDate)).toISOString(),
            handoverDate: PersianCalendar.toGregorian(String(values.checkHandoverDate)).toISOString(),
            nationalCode: String(values.checkNationalCode || '').trim(),
          },
        } : {}),
      });
      setReceiptTarget(null);
      await loadRows();
    } catch (error) {
      console.error('Register receipt failed:', error);
      setActionError(accountingFailureMessage(error, error instanceof Error && /[\u0600-\u06ff]/.test(error.message)
        ? error.message : 'ثبت دریافت انجام نشد؛ اطلاعات و مجوز خود را بررسی کنید.'));
    } finally {
      setActionLoading(null);
    }
  };

  const rowActions = (row: any): ErpAction[] => [
    ...(query.view === 'outstanding' || (row.sourceKind === 'PARTNER_INTERNAL_RECORD' && !row.partnerActions?.registerReceipt) ? [] : [
    {
      label: 'ثبت دریافت',
      icon: FaReceipt,
      tone: 'success' as const,
      disabled: row.status === 'SETTLED' || row.status === 'VOIDED',
      onClick: () => setReceiptTarget(row),
    },
    ]),
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="دریافتنی‌ها"
      description="مانده، سررسید، وصول بخشی و تسویه دریافتنی‌های ایجاد شده از قراردادها."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: () => loadRows(), tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'شماره قرارداد یا مشتری...' },
        { id: 'status', label: 'وضعیت', type: 'select', value: query.status, onChange: (value) => updateQuery({ status: value }), options: statusOptions },
        { id: 'due', label: 'سررسید', type: 'select', value: query.due, onChange: (value) => updateQuery({ due: value }), options: dueOptions },
        ...(query.view === 'outstanding' ? [{ id: 'period', label: 'دوره مالی', type: 'select' as const, value: query.period, onChange: (value: string) => updateQuery({ period: value }), options: periodOptions() }] : []),
      ]}
      rows={rows}
      rowKey={(row) => row.id}
      focusedRowKey={focus?.state === 'focused' && focus.inPage ? query.recordId : undefined}
      columns={columns}
      rowActions={rowActions}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="دریافتنی" />}
      emptyState={<ErpEmptyState icon={FaReceipt} title="دریافتنی ثبت نشده است" description="برای قراردادهای مجاز، دریافتنی برنامه‌ریزی شده ایجاد کنید." />}
    >
      {loadError && <ErpInlineState kind="error" title={loadError} action={{ label: 'تلاش دوباره', onClick: loadRows }} />}
      {focus?.state === 'missing' && <ErpInlineState kind="stale" title="این دریافتنی دیگر در دسترس نیست؛ فهرست، وضعیت فعلی را نشان می‌دهد." />}
      {focus?.state === 'current-truth' && <ErpInlineState kind="stale" title="وضعیت دریافتنی تغییر کرده است؛ رکورد فعلی بدون تغییر جمعیت فیلترشده بازیابی شد." />}
      {(focus?.state === 'current-truth' || (focus?.state === 'focused' && !focus.inPage)) && focus.record && (
        <ErpCard className="p-4">
          <p className="font-semibold text-[var(--sds-text-primary)]">{focus.record.contract?.contractNumber || focus.record.id}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-3 text-sm text-[var(--sds-text-secondary)]">
            <span>{money(focus.record.remainingAmount, focus.record.currency)}</span>
            <StatusBadge status={focus.record.status} />
          </div>
        </ErpCard>
      )}
      {focus?.state === 'focused' && <ErpInlineState kind="success" title="دریافتنی پیوندشده در جمعیت فعلی پیدا شد." />}
      <AccountingActionModal
        open={Boolean(receiptTarget)}
        title="ثبت دریافت"
        description={receiptTarget ? `${receiptTarget.partnerContext?.caseNumber || receiptTarget.contract?.contractNumber || 'قرارداد'} - مانده ${money(receiptTarget.remainingAmount, receiptTarget.currency)}` : undefined}
        fields={[
          { id: 'amount', label: 'مبلغ دریافت', type: receiptTarget?.sourceKind === 'PARTNER_INTERNAL_RECORD' ? 'text' : 'number', required: true, defaultValue: receiptTarget?.remainingAmount || 0 },
          { id: 'method', label: 'روش دریافت', type: 'select', defaultValue: 'CASH', options: [
            { label: 'نقدی', value: 'CASH' },
            { label: 'حواله بانکی', value: 'BANK_TRANSFER' },
            ...(receiptTarget?.sourceKind !== 'PARTNER_INTERNAL_RECORD' ? [{ label: 'کارت', value: 'CARD' }] : []),
            { label: 'چک', value: 'CHECK' },
          ] },
          { id: 'checkNumber', label: 'شماره چک', type: 'text', visibleWhen: { fieldId: 'method', equals: 'CHECK' }, requiredWhen: { fieldId: 'method', equals: 'CHECK' } },
          { id: 'checkOwnerName', label: 'صاحب چک', type: 'text', visibleWhen: { fieldId: 'method', equals: 'CHECK' }, requiredWhen: { fieldId: 'method', equals: 'CHECK' } },
          { id: 'checkDueDate', label: 'تاریخ سررسید چک', type: 'date', visibleWhen: { fieldId: 'method', equals: 'CHECK' }, requiredWhen: { fieldId: 'method', equals: 'CHECK' } },
          { id: 'checkHandoverDate', label: 'تاریخ تحویل چک', type: 'date', visibleWhen: { fieldId: 'method', equals: 'CHECK' }, requiredWhen: { fieldId: 'method', equals: 'CHECK' } },
          { id: 'checkNationalCode', label: 'کد ملی صاحب چک', type: 'text', visibleWhen: { fieldId: 'method', equals: 'CHECK' }, requiredWhen: { fieldId: 'method', equals: 'CHECK' } },
          ...(receiptTarget?.sourceKind === 'PARTNER_INTERNAL_RECORD' ? partnerAccountingTimeFields
            : [{ id: 'receivedAt', label: 'تاریخ دریافت', type: 'date' as const, required: true }]),
          { id: 'note', label: 'یادداشت', type: 'textarea' },
        ]}
        submitLabel="ثبت دریافت"
        busy={Boolean(actionLoading)}
        error={actionError}
        onClose={() => setReceiptTarget(null)}
        onSubmit={registerReceipt}
      />
    </ErpListPage>
  );
}
