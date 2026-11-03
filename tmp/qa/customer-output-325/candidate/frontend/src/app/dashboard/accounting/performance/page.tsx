'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { FaSync, FaUserClock } from 'react-icons/fa';
import { ErpEmptyState, ErpListPage, ErpPagination, ErpPersianDateField, ErpSection, type ErpColumn } from '@/components/erp';
import { accountingAPI } from '@/lib/api';
import { emptyAccountingPagination, readAccountingListResponse } from '@/features/accounting/accountingUi';
import PersianCalendar from '@/lib/persian-calendar';
import {
  canonicalizePerformanceQuery,
  patchPerformanceQuery,
  type PerformanceQueryState,
} from '@/features/accounting/accountingQueryState';

const hours = (value?: number | null) => (value == null ? '—' : `${value.toLocaleString('fa-IR')} ساعت`);
const count = (value?: number | null) => (value || 0).toLocaleString('fa-IR');

export default function AccountingPerformancePage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canonicalQuery = useMemo(
    () => canonicalizePerformanceQuery(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );
  const query = canonicalQuery.state;
  const [rows, setRows] = useState<any[]>([]);
  const [pagination, setPagination] = useState(emptyAccountingPagination);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(query.search);

  const replaceQuery = useCallback((next: ReturnType<typeof canonicalizePerformanceQuery>) => {
    const serialized = next.params.toString();
    router.replace(serialized ? `${pathname}?${serialized}` : pathname, { scroll: false });
  }, [pathname, router]);

  const updateQuery = useCallback((patch: Partial<PerformanceQueryState>) => {
    replaceQuery(patchPerformanceQuery(new URLSearchParams(searchParams.toString()), patch));
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

  const jalaliFilterValue = useCallback((value: string) => (
    value ? PersianCalendar.toPersian(`${value}T12:00:00.000Z`) : ''
  ), []);

  const setDateFilter = useCallback((key: 'dateFrom' | 'dateTo', value: string) => {
    updateQuery({ [key]: value ? PersianCalendar.toGregorianDateOnly(value) : '' });
  }, [updateQuery]);

  const loadRows = useCallback(async () => {
    try {
      setLoading(true);
      const response = await accountingAPI.getPerformanceReport({
        view: query.view || undefined,
        search: query.search || undefined,
        dateFrom: query.dateFrom || undefined,
        dateTo: query.dateTo || undefined,
        page: query.page,
        pageSize: pagination.pageSize,
      });
      if (response.data.success) {
        const data = readAccountingListResponse<any>(response.data.data);
        setRows(data.items);
        setPagination({ page: data.page, pageSize: data.pageSize, total: data.total });
      }
    } catch (error) {
      console.error('Error loading accountant performance:', error);
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, query.dateFrom, query.dateTo, query.page, query.search, query.view]);

  useEffect(() => {
    loadRows();
  }, [loadRows]);

  const columns: ErpColumn<any>[] = [
    {
      id: 'accountant',
      header: 'حسابدار',
      priority: 'primary',
      cell: (row) => (
        <div>
          <p className="font-semibold text-[var(--sds-text-primary)] dark:text-[var(--sds-text-primary)]">{row.accountant?.displayName || 'کاربر حسابداری'}</p>
          <p className="mt-1 text-xs text-[var(--sds-text-secondary)] dark:text-[var(--sds-text-muted)]">{row.accountant?.username || row.accountant?.id}</p>
        </div>
      ),
    },
    { id: 'actions', header: 'اقدام‌ها', mobileLabel: 'اقدام‌ها', align: 'center', priority: 'secondary', cell: (row) => count(row.actionsLogged) },
    { id: 'records', header: 'رکورد مالی', mobileLabel: 'رکورد مالی', align: 'center', priority: 'secondary', cell: (row) => count(row.financialRecordsCreated) },
    { id: 'approvals', header: 'تایید مالی', mobileLabel: 'تایید مالی', align: 'center', priority: 'secondary', cell: (row) => count(row.invoicesApproved) },
    { id: 'receipts', header: 'دریافت', mobileLabel: 'دریافت', align: 'center', priority: 'secondary', cell: (row) => count(row.receiptsRegistered) },
    { id: 'firstRecordDelay', header: 'میانگین تا رکورد مالی', mobileLabel: 'تا رکورد مالی', priority: 'meta', cell: (row) => hours(row.averageHoursToFirstFinancialRecord) },
    { id: 'approvalDelay', header: 'میانگین تا تایید', mobileLabel: 'تا تایید', priority: 'meta', cell: (row) => hours(row.averageHoursToApproveInvoice) },
    { id: 'receiptDelay', header: 'میانگین تا دریافت', mobileLabel: 'تا دریافت', priority: 'meta', cell: (row) => hours(row.averageHoursToRegisterReceipt) },
    { id: 'correctionDelay', header: 'بستن اصلاح', mobileLabel: 'بستن اصلاح', priority: 'meta', cell: (row) => hours(row.averageHoursToResolveCorrection) },
  ];

  return (
    <ErpListPage
      eyebrow="حسابداری"
      title="عملکرد حسابداران"
      description="گزارش عملیاتی از سرعت و حجم کار حسابداران بر اساس رخدادهای ثبت شده در گردش کار قراردادهای فروش."
      actions={[{ label: 'به‌روزرسانی', icon: FaSync, onClick: loadRows, tone: 'neutral' }]}
      filters={[
        { id: 'search', label: 'جستجو', type: 'search', value: searchInput, onChange: setSearchInput, placeholder: 'نام یا نام کاربری حسابدار...' },
      ]}
      rows={rows}
      rowKey={(row) => row.accountant?.id || row.accountant?.username}
      columns={columns}
      isLoading={loading}
      footer={<ErpPagination currentPage={pagination.page} totalPages={Math.max(Math.ceil(pagination.total / pagination.pageSize), 1)} totalItems={pagination.total} itemsPerPage={pagination.pageSize} onPageChange={(page) => updateQuery({ page })} itemLabel="حسابدار" />}
      emptyState={<ErpEmptyState icon={FaUserClock} title="داده عملکردی وجود ندارد" description="پس از ثبت اقدام‌های حسابداری، عملکرد حسابداران در این صفحه نمایش داده می‌شود." />}
    >
      <ErpSection>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <ErpPersianDateField
            label="از تاریخ"
            value={jalaliFilterValue(query.dateFrom)}
            onChange={(value) => setDateFilter('dateFrom', value)}
            placeholder="از تاریخ"
          />
          <ErpPersianDateField
            label="تا تاریخ"
            value={jalaliFilterValue(query.dateTo)}
            onChange={(value) => setDateFilter('dateTo', value)}
            placeholder="تا تاریخ"
          />
        </div>
      </ErpSection>
      <div className="rounded-lg border border-[var(--sds-warning-border)] bg-[var(--sds-warning-surface)] p-4 text-sm leading-6 text-[var(--sds-warning)] dark:border-[var(--sds-warning-border)] dark:bg-[var(--sds-warning-surface)] dark:text-[var(--sds-warning)]">
        این گزارش زمان حضور کاربر در مرورگر را اندازه نمی‌گیرد؛ معیارها از رکوردهای حسابداری و سوابق عملیات محاسبه می‌شوند.
      </div>
    </ErpListPage>
  );
}
