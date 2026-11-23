'use client';
import { ErpPersianDateField } from '@/components/erp';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaExclamationTriangle, FaEye, FaFileInvoice, FaPlus, FaSave, FaSync, FaTrashAlt } from 'react-icons/fa';
import { ErpButton, ErpCard, ErpEmptyState, ErpField, ErpInlineState, ErpInput, ErpListPage, ErpPagination, ErpRialInput, ErpSearchableSelect, ErpSheet, type ErpAction, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { useAccountingRegister, type AccountingRegisterRequest } from '@/features/accounting/useAccountingRegister';
import { AccountingRegisterFeedback } from '@/features/accounting/AccountingRegisterFeedback';
import { isCurrentAccountingRegisterRow } from '@/features/accounting/accountingRegisterLoader';
import { partnerTrackingCode, type SabalanPaymentPlanCandidate } from '@sabalanerp/partner-sales-contracts';
import PersianCalendar from '@/lib/persian-calendar';
import { emptyAccountingPagination, readAccountingListResponse, StatusBadge, dateFa, money,
  PartnerAccountingIdentity, accountingFailureMessage } from '@/features/accounting/accountingUi';
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
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState(query.search);
  const [savedDeleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [savedVoidTarget, setVoidTarget] = useState<any | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [savedPlanTarget, setPlanTarget] = useState<SabalanPaymentPlanCandidate | null>(null);
  const [planEffectiveDate, setPlanEffectiveDate] = useState('');
  const [planInstallments, setPlanInstallments] = useState<Array<{ id: string; dueDate: string; amount: string;
    method: 'CASH' | 'BANK_TRANSFER' | 'CHECK'; checkNumber?: string; checkBank?: string }>>([]);

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

  const readRows = useCallback(async (request: AccountingRegisterRequest) => {
    const response = await accountingAPI.getFinancialRecords({
      kind: 'INVOICE_CANDIDATE',
      cutoff: query.cutoff || undefined,
      date: query.date || undefined,
      page: query.page,
      period: query.period || undefined,
      search: query.search || undefined,
      status: query.status,
      view: query.view || undefined,
      pageSize: emptyAccountingPagination.pageSize,
    }, request);
    if (!response.data.success) throw new Error('Accounting read failed');
    return { ...readAccountingListResponse<any>(response.data.data) };
  }, [query.cutoff, query.date, query.page, query.period, query.search, query.status, query.view]);
  const register = useAccountingRegister(readRows, 'صورتحساب‌ها بارگیری نشد؛ دوباره تلاش کنید.');
  const { state: invoiceState, load: loadRows } = register;
  const readPlanCandidates = useCallback(async (request: AccountingRegisterRequest) => {
    const response = await accountingAPI.getPartnerSabalanPlanCandidates(request);
    if (!response.data.success) throw new Error('Accounting payment plan candidates read failed');
    return response.data.data as SabalanPaymentPlanCandidate[];
  }, []);
  const planRegister = useAccountingRegister(readPlanCandidates, 'نامزدهای برنامه پرداخت بارگیری نشد؛ دوباره تلاش کنید.', invoiceState.data !== null);
  const planCandidates = planRegister.state.data;
  const planTarget = savedPlanTarget && isCurrentAccountingRegisterRow(planCandidates ?? undefined,
    savedPlanTarget, candidate => candidate.expected.caseId) ? savedPlanTarget : null;
  const { clearOnDenial } = register;
  const planState = planRegister.state;
  const actorDenied = planState.status === 'denied' && planState.reason === 'actor' ? planState : null;
  useEffect(() => {
    if (actorDenied) clearOnDenial({ code: 'AUTH_CONTEXT_CHANGED' });
  }, [actorDenied, clearOnDenial]);
  const state = actorDenied ?? invoiceState;
  const rows = state.data?.items ?? [];
  const pagination = state.data ?? emptyAccountingPagination;

  const deleteTarget = savedDeleteTarget && isCurrentAccountingRegisterRow(state.data?.items, savedDeleteTarget,
    row => row.id) ? savedDeleteTarget : null;
  const voidTarget = savedVoidTarget && isCurrentAccountingRegisterRow(state.data?.items, savedVoidTarget,
    row => row.id) ? savedVoidTarget : null;
  useEffect(() => {
    if (!deleteTarget) setDeleteTarget(null);
    if (!voidTarget) setVoidTarget(null);
    if (!planTarget) {
      setPlanTarget(null);
      setPlanEffectiveDate('');
      setPlanInstallments(previous => previous.length ? [] : previous);
    }
    if (state.data === null) setActionError(null);
    if (state.data === null) setActionSuccess(null);
  }, [state.data, deleteTarget, voidTarget, planTarget]);
  const actionsBlocked = state.status !== 'ready';
  const planBlocked = actionsBlocked || planRegister.state.status !== 'ready';
  const refresh = () => { void loadRows(); void planRegister.load(); };

  const openPlan = (candidate: SabalanPaymentPlanCandidate) => {
    if (actionLoading || !register.canAct() || !planRegister.canAct()) return;
    const today = new Date().toISOString().slice(0, 10);
    setActionError(null); setPlanTarget(candidate); setPlanEffectiveDate(today);
    setPlanInstallments([{ id: crypto.randomUUID(), dueDate: today, amount: candidate.payable.amount, method: 'BANK_TRANSFER' }]);
  };

  const savePlan = async () => {
    if (!planTarget || actionLoading || !register.canAct() || !planRegister.canAct()) return;
    setActionError(null); setActionLoading(`plan:${planTarget.expected.caseId}`);
    try {
      await accountingAPI.setPartnerSabalanPaymentPlan({ expected: planTarget.expected,
        idempotencyKey: `partner-plan-${crypto.randomUUID()}`,
        plan: { effectiveDate: planEffectiveDate, installments: planInstallments.map(item => ({
          installmentId: `partner-sabalan-installment-${item.id}`, dueDate: item.dueDate,
          amount: { amount: item.amount, currency: planTarget.payable.currency }, method: item.method,
          ...(item.method === 'CHECK' ? { check: { number: item.checkNumber, bank: item.checkBank, dueDate: item.dueDate } } : {}),
        })) } }, register.mutationRequest);
      setPlanTarget(null);
      if (register.isActive()) setActionSuccess('برنامه پرداخت ثبت و پیش‌نویس صورتحساب ساخته شد.');
      refresh();
    } catch (error) {
      if (!register.isActive() || planRegister.clearOnDenial(error)) return;
      setActionError((error as any)?.response?.data?.error || 'ثبت برنامه پرداخت انجام نشد.');
    } finally { setActionLoading(null); }
  };

  const deleteDraftRecord = async (row: any) => {
    if (!deleteTarget || actionLoading || !register.canAct()) return;
    setActionError(null);
    setActionLoading(row.id);
    try {
      await accountingAPI.executeAction({
        kind: 'DELETE_DRAFT_ACCOUNTING_RECORD',
        recordId: row.id,
        note: 'Deleted draft from invoice candidates register',
      }, register.mutationRequest);
      setDeleteTarget(null);
      await loadRows();
    } catch (error) {
      if (!register.isActive() || register.clearOnDenial(error)) return;
      console.error('Delete draft accounting record failed:', error);
      setActionError((error as any)?.response?.data?.error || 'حذف پیش‌نویس رکورد مالی انجام نشد');
    } finally {
      setActionLoading(null);
    }
  };

  const startVoidCase = async (values: Record<string, string | number>) => {
    if (!voidTarget || actionLoading || !register.canAct()) return;
    setActionError(null); setActionLoading(voidTarget.id);
    try {
      const reasonKind = String(values.reasonKind || 'OTHER');
      await accountingAPI.executeAction({
        kind: 'START_ACCOUNTING_VOID_CASE', recordId: voidTarget.id, reasonKind,
        reason: String(values.reason || '').trim(),
        effectiveAt: PersianCalendar.toGregorian(String(values.effectiveAt)).toISOString(),
        ...(reasonKind === 'DUPLICATE_ISSUE' ? { retainedRecordId: String(values.retainedRecordId || '') } : {}),
      }, register.mutationRequest);
      setVoidTarget(null);
      if (voidTarget.contractId && register.isActive()) router.push(`/dashboard/accounting/contracts/${voidTarget.contractId}#financial-void-cases`);
      else await loadRows();
    } catch (error) {
      if (!register.isActive() || register.clearOnDenial(error)) return;
      setActionError(accountingFailureMessage(error, 'شروع پرونده ابطال انجام نشد؛ دلیل و فاکتور معتبر را بررسی کنید.'));
    } finally { setActionLoading(null); }
  };

  const returnTo = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const rowActions = (row: any): ErpAction[] => [
    ...(row.contractId ? [{ label: 'مشاهده پرونده', href: `/dashboard/accounting/contracts/${row.contractId}`, icon: FaEye, tone: 'primary' as const }] : []),
    {
      label: ['ISSUED', 'POSTED', 'VOIDED'].includes(row.status) ? 'مشاهده رکورد مالی' : 'بررسی و تأیید مالی',
      icon: FaEye,
      tone: 'primary',
      href: `/dashboard/accounting/invoice-candidates/${encodeURIComponent(row.id)}?returnTo=${encodeURIComponent(returnTo)}`,
    },
    {
      label: 'حذف پیش‌نویس',
      icon: FaTrashAlt,
      tone: 'danger',
      disabled: row.status !== 'DRAFT' || actionLoading === row.id,
      onClick: () => setDeleteTarget(row),
    },
    ...(['ISSUED', 'POSTED'].includes(row.status) && row.sourceKind !== 'PARTNER_INTERNAL_RECORD' ? [{
      label: 'شروع ابطال', icon: FaExclamationTriangle, tone: 'danger' as const,
      disabled: actionLoading === row.id, onClick: () => { setActionError(null); setVoidTarget(row); },
    }] : []),
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
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: refresh, tone: 'neutral' }]}
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
      isLoading={state.status === 'loading'}
      suspendRowActions={actionsBlocked || Boolean(actionLoading)}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="رکورد" />}
      emptyState={state.data !== null ? <ErpEmptyState icon={FaFileInvoice} title="صورتحسابی در این فیلتر وجود ندارد" description="این نتیجه خالی، جمعیت انتخاب‌شده در داشبورد یا فیلترهای فعلی را نشان می‌دهد." /> : null}
    >
      {Boolean(planCandidates?.length) && <div className="space-y-3">
        {planCandidates?.map(candidate => <ErpCard key={candidate.expected.caseId} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="font-semibold">{partnerTrackingCode(candidate.caseNumber, candidate.trackingNumber)} · {candidate.partnerDisplayName}</p>
            <p className="sds-text-muted text-sm">{money(candidate.payable.amount, candidate.payable.currency)}</p></div>
          <ErpButton label="ثبت برنامه پرداخت به سبلان" icon={FaPlus} ariaDisabled={planBlocked || Boolean(actionLoading)} onClick={() => openPlan(candidate)} />
        </ErpCard>)}
      </div>}
      {actionSuccess && <ErpInlineState kind="success" title={actionSuccess} />}
      <AccountingRegisterFeedback state={state} retry={loadRows} />
      {(planRegister.state.status === 'error' || planRegister.state.status === 'refreshing') &&
        <AccountingRegisterFeedback state={planRegister.state} retry={planRegister.load} />}
      {actionError && !deleteTarget && !voidTarget && <ErpInlineState kind="error" title={actionError} />}
      {planTarget && <ErpSheet open onClose={() => setPlanTarget(null)} title="برنامه پرداخت فروشنده به سبلان"
        presentation="modal" pending={Boolean(actionLoading)} footer={<ErpButton label="ثبت برنامه پرداخت" icon={FaSave}
          disabled={planBlocked || Boolean(actionLoading) || !planEffectiveDate || !planInstallments.length || planInstallments.some(item => !item.dueDate || !item.amount ||
            (item.method === 'CHECK' && (!item.checkNumber?.trim() || !item.checkBank?.trim())))} onClick={() => void savePlan()} />}>
        <div className="space-y-4">
          {planBlocked && <ErpInlineState kind="stale" title="برای ثبت برنامه، ابتدا باید اطلاعات تازه دریافت شود."
            action={state.status === 'error' || planState.status === 'error' ? { label: 'تلاش دوباره', onClick: refresh } : undefined} />}
          {actionError && <ErpInlineState kind="error" title={actionError} />}
          <ErpField label="تاریخ شروع" required><ErpPersianDateField valueFormat="iso-date" value={planEffectiveDate} onChange={(value) => setPlanEffectiveDate(value)} /></ErpField>
          {planInstallments.map((item, index) => <ErpCard key={item.id} className="space-y-3 p-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <ErpField label={`سررسید ${(index + 1).toLocaleString('fa-IR')}`} required><ErpPersianDateField valueFormat="iso-date" value={item.dueDate}
                onChange={(value) => setPlanInstallments(rows => rows.map(row => row.id === item.id ? { ...row, dueDate: value } : row))} /></ErpField>
              <ErpField label="مبلغ" required><ErpRialInput value={item.amount}
                onValueChange={amount => setPlanInstallments(rows => rows.map(row => row.id === item.id ? { ...row, amount } : row))} /></ErpField>
              <ErpField label="روش"><ErpSearchableSelect value={item.method} onChange={event => setPlanInstallments(rows => rows.map(row => row.id === item.id
                ? { ...row, method: event.target.value as typeof item.method } : row))}>
                <option value="BANK_TRANSFER">واریز بانکی</option><option value="CASH">نقدی</option><option value="CHECK">چک</option>
              </ErpSearchableSelect></ErpField>
            </div>
            {item.method === 'CHECK' && <div className="grid gap-3 sm:grid-cols-2">
              <ErpField label="شماره چک" required><ErpInput value={item.checkNumber ?? ''} onChange={event => setPlanInstallments(rows => rows.map(row => row.id === item.id ? { ...row, checkNumber: event.target.value } : row))} /></ErpField>
              <ErpField label="بانک" required><ErpInput value={item.checkBank ?? ''} onChange={event => setPlanInstallments(rows => rows.map(row => row.id === item.id ? { ...row, checkBank: event.target.value } : row))} /></ErpField>
            </div>}
            {planInstallments.length > 1 && <ErpButton label="حذف قسط" icon={FaTrashAlt} tone="danger" variant="outline"
              onClick={() => setPlanInstallments(rows => rows.filter(row => row.id !== item.id))} />}
          </ErpCard>)}
          <ErpButton label="افزودن قسط" icon={FaPlus} variant="outline" onClick={() => setPlanInstallments(rows => [...rows,
            { id: crypto.randomUUID(), dueDate: planEffectiveDate, amount: '', method: 'BANK_TRANSFER' }])} />
        </div>
      </ErpSheet>}
      {deleteTarget && <AccountingActionModal
        open
        title="حذف پیش‌نویس رکورد مالی"
        description="فقط پیش‌نویس‌های تایید نشده و بدون رکورد پایین‌دستی حذف می‌شوند. این اقدام در سوابق حسابداری ثبت می‌شود."
        fields={[{ id: 'note', label: 'یادداشت حذف', type: 'textarea', defaultValue: 'Deleted draft from invoice candidates register' }]}
        submitLabel="حذف پیش‌نویس"
        busy={Boolean(actionLoading)}
        blocked={actionsBlocked}
        onRetry={state.status === 'error' ? loadRows : undefined}
        error={actionError}
        onClose={() => setDeleteTarget(null)}
        onSubmit={(values) => deleteDraftRecord({ ...deleteTarget, note: String(values.note || '') })}
      />}
      {voidTarget && <AccountingActionModal
        open
        title="شروع پرونده ابطال مالی"
        description="سامانه مراحل تعیین‌تکلیف دریافت‌ها، چک‌ها و دریافتنی را به‌ترتیب نشان می‌دهد."
        fields={[
          { id: 'reasonKind', label: 'نوع دلیل', type: 'select', required: true, defaultValue: 'DUPLICATE_ISSUE', options: [
            { label: 'صدور تکراری', value: 'DUPLICATE_ISSUE' }, { label: 'اشتباه ثبت', value: 'ENTRY_ERROR' },
            { label: 'لغو معامله', value: 'SALE_CANCELLED' }, { label: 'سایر', value: 'OTHER' },
          ] },
          { id: 'retainedRecordId', label: 'فاکتور معتبر باقی‌مانده', type: 'select',
            visibleWhen: { fieldId: 'reasonKind', equals: 'DUPLICATE_ISSUE' },
            requiredWhen: { fieldId: 'reasonKind', equals: 'DUPLICATE_ISSUE' },
            options: rows.filter(row => row.id !== voidTarget?.id && row.contractId === voidTarget?.contractId &&
              ['ISSUED', 'POSTED'].includes(row.status)).map(row => ({
                label: row.systemInvoiceNumber ? `فاکتور ${row.systemInvoiceNumber}` : row.id, value: row.id,
              })) },
          { id: 'reason', label: 'دلیل ابطال', type: 'textarea', required: true },
          { id: 'effectiveAt', label: 'تاریخ مؤثر', type: 'date', required: true },
        ]}
        submitLabel="شروع ابطال"
        destructive
        busy={Boolean(actionLoading)}
        blocked={actionsBlocked}
        onRetry={state.status === 'error' ? loadRows : undefined}
        error={actionError}
        onClose={() => setVoidTarget(null)}
        onSubmit={startVoidCase}
      />}
    </ErpListPage>
  );
}
